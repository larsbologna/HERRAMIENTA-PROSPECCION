/**
 * Prueba de punta a punta con Chromium real contra una ficha de Maps SIMULADA
 * (test/fixtures/maps.html replica la estructura DOM de Google Maps) y una web local.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prospeccion-'));
process.env.DATA_DIR = dataDir;

const { runPipeline } = await import('../src/pipeline/pipeline.js');
const { exportPdf } = await import('../src/report/pdfExporter.js');
const { createApp } = await import('../src/server/app.js');
type Report = Awaited<ReturnType<typeof runPipeline>>;

let fixtures: http.Server;
let base = '';
let report: Report;

before(async () => {
  fixtures = http.createServer(async (req, res) => {
    if (req.url?.startsWith('/maps')) {
      const html = (await fs.readFile(path.join(here, 'fixtures/maps.html'), 'utf8')).replace('__SITE__', `${base}/site`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    } else if (req.url === '/site') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(await fs.readFile(path.join(here, 'fixtures/site.html')));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => fixtures.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(fixtures.address() as AddressInfo).port}`;
});

after(async () => {
  fixtures.close();
  if (!process.env.KEEP_E2E_DATA) await fs.rm(dataDir, { recursive: true, force: true });
  else console.log(`Datos de prueba conservados en ${dataDir}`);
});

test('pipeline completo: Maps → web → auditoría → agente → informe', { timeout: 180_000 }, async () => {
  const events: string[] = [];
  report = await runPipeline(`${base}/maps/place/peluqueria-lola`, {
    skipUrlValidation: true,
    emit: (e) => events.push(e.type === 'step' ? `${e.step}:${e.status}` : e.type),
    agents: [{
      id: 'test-agent', name: 'Agente de prueba', description: 'añade un hallazgo',
      run: async (input) => {
        assert.equal(input.vertical.id, 'belleza');
        return { findings: [{ id: 'ai-test', area: 'maps', severity: 'low', title: 'Hallazgo IA', detail: 'De un agente', source: 'test-agent' }], notes: 'ok' };
      },
    }],
  });

  const p = report.profile;
  assert.equal(p.name, 'Peluquería Lola');
  assert.equal(p.category, 'Peluquería');
  assert.equal(p.rating, 4.1);
  assert.equal(p.reviewCount, 23);
  assert.equal(p.address, 'Calle Mayor 12, 28013 Madrid');
  assert.equal(p.phone, '+34911222333');
  assert.equal(p.website, `${base}/site`);
  assert.equal(p.placeId, 'ChIJTestPlaceId_1234567890abc');
  assert.equal(Object.keys(p.hours?.days ?? {}).length, 5);
  assert.equal(p.description, 'Peluquería de barrio.');
  assert.equal(p.photoCount, 7);
  assert.equal(p.isClaimed, false);
  assert.equal(p.reviews.length, 4);
  assert.equal(p.reviews.filter((r) => r.hasOwnerResponse).length, 1);
  assert.equal(p.reviews[0]?.ageDays, 90);
  assert.equal(p.services.length, 2);

  const w = report.website!;
  assert.ok(w.reachable);
  assert.equal(w.mobile.hasViewportMeta, false);
  assert.ok(w.visual.legacyTech.some((t) => t.startsWith('jQuery 1.')));
  assert.equal(w.visual.copyrightYear, 2015);
  assert.equal(w.whatsapp.hasLink, false);

  const ids = report.audit.findings.map((f) => f.id);
  for (const id of ['maps-unclaimed', 'maps-incomplete-hours', 'maps-poor-description', 'maps-few-photos', 'rep-few-reviews', 'rep-low-responses', 'rep-negative-unanswered', 'rep-stale-reviews', 'web-not-mobile', 'web-no-https', 'web-no-booking', 'wa-not-visible', 'ai-test']) {
    assert.ok(ids.includes(id), `falta hallazgo ${id}; hay: ${ids.join(', ')}`);
  }
  const services = report.proposal.services.map((s) => s.id);
  for (const s of ['maps-optimization', 'qr-reviews', 'website', 'whatsapp-ai-bot', 'booking-system']) assert.ok(services.includes(s as never), `falta servicio ${s}`);
  assert.equal(report.proposal.salesArguments.length, report.audit.findings.length);
  assert.ok(report.proposal.salesArguments.some((a) => a.findingId === 'ai-test'), 'el hallazgo del agente también tiene argumento');
  assert.ok(report.agentContributions[0]?.ok);
  assert.equal(report.screenshots.length >= 4, true, `capturas: ${report.screenshots.map((s) => s.id)}`);
  for (const s of report.screenshots) await fs.access(path.join(dataDir, 'reports', report.id, s.file));

  assert.deepEqual(events.filter((e) => e.includes(':done')), ['maps:done', 'website:done', 'audit:done', 'agents:done', 'report:done']);
  assert.ok(events.includes('screenshot') && events.at(-1) === 'done');
});

test('API: informe HTML, página QR, feedback y PDF', { timeout: 120_000 }, async () => {
  const server = createApp().listen(0);
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const html = await fetch(`${api}/api/audits/${report.id}/html`).then((r) => r.text());
    assert.match(html, /Resumen ejecutivo/);
    assert.match(html, /Mensaje comercial para WhatsApp/);

    assert.match(html, /Problema detectado/);
    assert.match(html, /Beneficio para el cliente/);
    const txt = await fetch(`${api}/api/audits/${report.id}/arguments.txt`).then((r) => r.text());
    assert.match(txt, /^ARGUMENTOS COMERCIALES · Peluquería Lola/);
    assert.match(txt, /Problema detectado:\nLa ficha de Google Maps no está reclamada por el dueño\.\nImpacto estimado:\nAlto/);

    const list = await fetch(`${api}/api/audits`).then((r) => r.json());
    assert.equal(list[0].id, report.id);

    assert.match(await fetch(`${api}/r/${report.id}`).then((r) => r.text()), /Peluquería Lola/);
    const five = await fetch(`${api}/api/r/${report.id}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 5 }) }).then((r) => r.json());
    assert.equal(five.redirect, 'https://search.google.com/local/writereview?placeid=ChIJTestPlaceId_1234567890abc');
    const two = await fetch(`${api}/api/r/${report.id}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 2, comment: 'Tardaron mucho' }) }).then((r) => r.json());
    assert.equal(two.saved, true);
    const fb = await fetch(`${api}/api/audits/${report.id}/feedback`).then((r) => r.json());
    assert.equal(fb.length, 2);
    assert.equal(fb[1].comment, 'Tardaron mucho');

    const bad = await fetch(`${api}/api/audits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com' }) });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${api}/api/audits/..%2F..%2Fetc`)).status, 400);
  } finally {
    server.close();
  }
  const pdf = await exportPdf(report);
  const head = (await fs.readFile(pdf)).subarray(0, 5).toString();
  assert.equal(head, '%PDF-');
  if (process.env.KEEP_E2E_PDF) await fs.copyFile(pdf, process.env.KEEP_E2E_PDF);
});
