import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { agentRegistry } from '../agents/registry.js';
import { REPORT_CSS, renderReportBody } from '../report/htmlRenderer.js';
import { exportPdf } from '../report/pdfExporter.js';
import { googleReviewUrl, qrDataUri, qrPageUrl, qrPng } from '../report/qrAssets.js';
import { isMapsUrl } from '../scraper/mapsScraper.js';
import { addFeedback, listFeedback } from '../storage/feedbackStore.js';
import { listReports, loadReport, reportDir, reportsDir, safeId } from '../storage/reportStore.js';
import { JobManager } from '../pipeline/jobManager.js';
import { STEPS } from '../pipeline/events.js';
import { renderQrPage } from './qrPage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../../public');

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

function idParam(req: Request): string {
  return safeId(String(req.params.id));
}

export function createApp(jobs = new JobManager()) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(publicDir));
  app.use('/files', express.static(reportsDir(), { fallthrough: false, index: false, dotfiles: 'deny' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, agents: agentRegistry.list().length });
  });

  app.get('/report.css', (_req, res) => {
    res.type('text/css').send(REPORT_CSS);
  });

  app.get('/api/steps', (_req, res) => {
    res.json(STEPS);
  });

  app.get('/api/agents', (_req, res) => {
    res.json(agentRegistry.list().map(({ id, name, description }) => ({ id, name, description })));
  });

  // --- Auditorías ---
  app.post('/api/audits', (req, res) => {
    const url = String(req.body?.url ?? '').trim();
    if (!isMapsUrl(url)) {
      res.status(400).json({ error: 'Pega un enlace válido de Google Maps (google.com/maps/… o maps.app.goo.gl/…).' });
      return;
    }
    const job = jobs.create(url);
    res.status(202).json({ id: job.id, status: job.status, events: `/api/audits/${job.id}/events` });
  });

  app.get('/api/audits', wrap(async (_req, res) => {
    res.json(await listReports());
  }));

  app.get('/api/audits/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const report = await loadReport(id);
    if (report) return res.json(report);
    const job = jobs.get(id);
    if (job) return res.status(202).json({ id, status: job.status, error: job.error });
    res.status(404).json({ error: 'Informe no encontrado' });
  }));

  // Progreso en tiempo real (Server-Sent Events).
  app.get('/api/audits/:id/events', (req, res) => {
    const id = idParam(req);
    const job = jobs.get(id);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    if (!job) {
      void loadReport(id).then((r) => {
        send(r ? { type: 'done', reportId: id, progress: 100 } : { type: 'error', message: 'Análisis no encontrado' });
        res.end();
      });
      return;
    }
    job.events.forEach(send);
    if (job.status === 'done' || job.status === 'error') {
      res.end();
      return;
    }
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);
    const unsubscribe = jobs.subscribe(id, (e) => {
      send(e);
      if (e.type === 'done' || e.type === 'error') {
        cleanup();
        res.end();
      }
    });
    const cleanup = () => {
      clearInterval(keepAlive);
      unsubscribe();
    };
    req.on('close', cleanup);
  });

  app.get('/api/audits/:id/html', wrap(async (req, res) => {
    const id = idParam(req);
    const report = await loadReport(id);
    if (!report) return res.status(404).send('Informe no encontrado');
    const qr = report.audit.qr.recommended;
    res.type('html').send(
      renderReportBody(report, {
        imageSrc: (s) => `/files/${id}/${s.file}`,
        qrPageUrl: qr ? qrPageUrl(id) : undefined,
        qrImage: qr ? await qrDataUri(qrPageUrl(id)) : undefined,
      }),
    );
  }));

  app.get('/api/audits/:id/pdf', wrap(async (req, res) => {
    const id = idParam(req);
    const report = await loadReport(id);
    if (!report) return res.status(404).json({ error: 'Informe no encontrado' });
    const file = await exportPdf(report);
    const name = (report.profile.name ?? id).normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
    res.download(file, `auditoria-${name || id}.pdf`);
  }));

  app.get('/api/audits/:id/qr.png', wrap(async (req, res) => {
    const id = idParam(req);
    if (!(await loadReport(id))) return res.status(404).end();
    res.type('png').send(await qrPng(qrPageUrl(id)));
  }));

  app.get('/api/audits/:id/feedback', wrap(async (req, res) => {
    res.json(await listFeedback(idParam(req)));
  }));

  // --- Sistema QR de reseñas (demo funcional por negocio) ---
  app.get('/r/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const report = await loadReport(id);
    if (!report) return res.status(404).send('Página no encontrada');
    res.type('html').send(renderQrPage({ reportId: id, businessName: report.profile.name ?? 'nuestro negocio' }));
  }));

  app.post('/api/r/:id/feedback', wrap(async (req, res) => {
    const id = idParam(req);
    const report = await loadReport(id);
    if (!report) return res.status(404).json({ error: 'No encontrado' });
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Valoración inválida' });
    const five = rating === 5;
    await addFeedback(id, {
      id: randomUUID(),
      rating,
      comment: five ? undefined : String(req.body?.comment ?? '').slice(0, 2000) || undefined,
      contact: five ? undefined : String(req.body?.contact ?? '').slice(0, 200) || undefined,
      redirectedToGoogle: five,
      createdAt: new Date().toISOString(),
    });
    res.json(five ? { redirect: googleReviewUrl(report) } : { saved: true });
  }));

  app.get('/api/audits/:id/files', wrap(async (req, res) => {
    const id = idParam(req);
    const files = await fs.readdir(reportDir(id)).catch(() => []);
    res.json(files);
  }));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = /inválido/i.test(err.message) ? 400 : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message });
  });

  return app;
}
