import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { analyze as defaultAnalyze } from '../analyzer.js';
import { ROOT_DIR, config } from '../config/index.js';
import { DB_FILE } from '../crm/index.js';
import type { CrmRepository } from '../crm/repository.js';
import { dashboard, metrics } from '../crm/stats.js';
import { ACTIVITY_TYPES, MANUAL_ACTIVITY_TYPES, STATUSES, isStatus, type ProspectFilter, type Settings } from '../crm/types.js';
import { VERTICALS, DEFAULT_VERTICAL } from '../domain/verticals.js';
import { buildMessages } from '../messages/whatsapp.js';
import { SERVICE_CATALOG } from '../proposal/services.js';
import { HttpError, Router, readJson, sendJson } from './http.js';

export interface AppDeps {
  repo: CrmRepository;
  /** Función de análisis (se sustituye en tests). */
  analyze?: typeof defaultAnalyze;
  /** Carpeta de la interfaz web. */
  webDir?: string;
  /** Registro de actividad en la consola (se silencia en tests). */
  log?: (message: string) => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SELLER_DEFAULTS: Settings = {
  sellerName: config.seller.name === '[tu nombre]' ? '' : config.seller.name,
  sellerBusiness: config.seller.business,
  sellerCity: '',
};

/** Orígenes de la propia app. Las peticiones de otras webs abiertas en el navegador se rechazan. */
function sameApp(origin: string | undefined, port: number): boolean {
  if (!origin) return true; // curl, tests, navegación directa
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}

export function createApp(deps: AppDeps): http.Server {
  const { repo } = deps;
  const runAnalysis = deps.analyze ?? defaultAnalyze;
  const webDir = deps.webDir ?? path.join(ROOT_DIR, 'web');
  const log = deps.log ?? ((m: string) => console.log(m));
  let busy = false;
  const settings = () => repo.settings(SELLER_DEFAULTS);

  const router = new Router()
    .on('GET', '/api/estado', () => ({ ok: true, ocupado: busy }))

    .on('GET', '/api/meta', () => ({
      statuses: STATUSES,
      activityTypes: MANUAL_ACTIVITY_TYPES.map((id) => ({ id, label: ACTIVITY_TYPES[id] })),
      verticals: [...VERTICALS, DEFAULT_VERTICAL].map((v) => ({ id: v.id, label: v.label })),
      services: Object.values(SERVICE_CATALOG).map((s) => ({ id: s.id, name: s.name })),
    }))

    // ---------------- Análisis (progreso en streaming, una línea JSON por evento)
    .on('POST', '/api/analizar', async ({ req, res }) => {
      if (busy) throw new HttpError(409, 'Ya hay un análisis en curso. Esperá a que termine.');
      const body = await readJson<{ url?: unknown }>(req);
      const target = String(body.url ?? '').trim();
      if (!target) throw new HttpError(400, 'Pegá el enlace de Google Maps del negocio.');

      busy = true;
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
      const line = (obj: unknown) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
      };
      log(`→ Analizando ${target.slice(0, 80)}`);
      try {
        const result = await runAnalysis(target, {
          signal: controller.signal,
          onProgress: (p) => line({ tipo: 'progreso', porcentaje: Math.min(p.percent, 98), mensaje: p.message }),
        });
        const saved = repo.saveAnalysis(result);
        line({ tipo: 'progreso', porcentaje: 100, mensaje: saved.created ? 'Prospecto guardado.' : 'Prospecto actualizado con el nuevo análisis.' });
        line({ tipo: 'resultado', prospectId: saved.id, creado: saved.created, nombre: result.profile.name, score: result.audit.overallScore });
        log(`✔ ${result.profile.name} (${(result.durationMs / 1000).toFixed(1)} s) ${saved.created ? 'nuevo' : 'reanalizado'}`);
      } catch (err) {
        line({ tipo: 'error', mensaje: (err as Error).message });
        log(`✖ ${(err as Error).message}`);
      } finally {
        busy = false;
        res.end();
      }
      return undefined;
    })

    // ---------------- Prospectos
    .on('GET', '/api/prospects', ({ query }) => {
      const num = (k: string) => (query.has(k) && query.get(k) !== '' ? Number(query.get(k)) : undefined);
      const filter: ProspectFilter = {
        q: query.get('q') ?? undefined,
        status: query.get('status') ?? undefined,
        vertical: query.get('vertical') || undefined,
        minScore: num('minScore'),
        maxScore: num('maxScore'),
        sort: (query.get('sort') as ProspectFilter['sort']) ?? undefined,
        dir: query.get('dir') === 'asc' ? 'asc' : 'desc',
      };
      return { items: repo.list(filter) };
    })
    .on('GET', '/api/prospects/:id', ({ params }) => {
      const detail = repo.get(params.id!);
      return { ...detail, messages: buildMessages(detail, settings()) };
    })
    .on('PATCH', '/api/prospects/:id', async ({ req, params }) => {
      const body = await readJson<Record<string, unknown>>(req);
      if (body.status !== undefined && !isStatus(body.status)) throw new HttpError(400, 'Estado inválido.');
      const detail = repo.update(params.id!, {
        status: body.status as never,
        notes: body.notes === undefined ? undefined : String(body.notes),
        closedValue: body.closedValue === undefined ? undefined : body.closedValue === null || body.closedValue === '' ? null : Number(body.closedValue),
      });
      return { ...detail, messages: buildMessages(detail, settings()) };
    })
    .on('DELETE', '/api/prospects/:id', ({ params }) => {
      repo.delete(params.id!);
      return { ok: true };
    })
    .on('POST', '/api/prospects/:id/activities', async ({ req, params }) => {
      const body = await readJson<{ type?: unknown; content?: unknown }>(req);
      return repo.addActivity(params.id!, String(body.type ?? ''), String(body.content ?? ''));
    })

    // ---------------- Vistas agregadas
    .on('GET', '/api/dashboard', () => dashboard(repo.allForStats(), repo.statusChanges()))
    .on('GET', '/api/metrics', () => metrics(repo.allForStats()))
    .on('GET', '/api/audits', () => ({ items: repo.audits({ limit: 1000 }) }))

    // ---------------- Configuración
    .on('GET', '/api/settings', () => {
      const prices = repo.prices();
      return {
        settings: settings(),
        prices: prices ?? null,
        priceError: repo.priceError ?? null,
        pricesFile: path.join(ROOT_DIR, 'precios.json'),
        databaseFile: DB_FILE,
        services: Object.values(SERVICE_CATALOG).map((s) => ({ id: s.id, name: s.name })),
      };
    })
    .on('PUT', '/api/settings', async ({ req }) => {
      const body = await readJson<Partial<Settings>>(req);
      repo.saveSettings(body);
      return { settings: settings() };
    })
    .on('GET', '/api/export', ({ res }) => {
      const date = new Date().toISOString().slice(0, 10);
      sendJson(res, 200, repo.exportAll(), { 'Content-Disposition': `attachment; filename="prospectos-${date}.json"` });
      return undefined;
    });

  async function serveStatic(res: http.ServerResponse, pathname: string): Promise<void> {
    // Rutas de la app (sin extensión) → index.html; archivos → web/
    const rel = path.extname(pathname) ? pathname : '/index.html';
    const file = path.resolve(webDir, `.${decodeURIComponent(rel)}`);
    if (!file.startsWith(path.resolve(webDir) + path.sep)) return sendJson(res, 403, { error: 'Prohibido.' });
    try {
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(content);
    } catch {
      sendJson(res, 404, { error: 'No encontrado.' });
    }
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const port = (req.socket.localPort ?? config.port) as number;
    const origin = req.headers.origin;

    // index.html abierto con doble clic (origin "null") solo puede consultar si la herramienta está iniciada.
    if (origin === 'null' && req.method === 'GET' && url.pathname === '/api/estado') {
      return sendJson(res, 200, { ok: true, ocupado: busy }, { 'Access-Control-Allow-Origin': 'null' });
    }
    if (!sameApp(origin, port)) return sendJson(res, 403, { error: 'Origen no permitido.' });

    if (url.pathname.startsWith('/api/')) {
      router
        .handle(req, res, url)
        .then((handled) => {
          if (!handled) sendJson(res, 404, { error: 'Ruta no encontrada.' });
        })
        .catch((err) => sendJson(res, 500, { error: (err as Error).message }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Método no permitido.' });
    void serveStatic(res, url.pathname);
  });
}
