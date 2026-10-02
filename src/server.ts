/**
 * Servidor local mínimo de la herramienta.
 *
 *   GET  /           → index.html
 *   POST /analizar   → { "url": "…" }  responde línea a línea (NDJSON):
 *                      {"tipo":"progreso","porcentaje":40,"mensaje":"…"}
 *                      {"tipo":"resultado","datos":{…}}   o   {"tipo":"error","mensaje":"…"}
 *   GET  /estado     → { ok, ocupado }
 *
 * Solo escucha en 127.0.0.1 (no es accesible desde otros equipos) y hace un análisis a la vez.
 * Uso: npm start   (con --abrir abre el navegador automáticamente)
 */
import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyze } from './analyzer.js';
import { ROOT_DIR, config } from './config/index.js';

const HOST = '127.0.0.1';
const url = `http://localhost:${config.port}`;
let busy = false;

/** Orígenes permitidos: la propia página servida y index.html abierto con doble clic (origin "null"). */
function allowedOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  if (origin === 'null') return 'null';
  if (origin === `http://localhost:${config.port}` || origin === `http://127.0.0.1:${config.port}`) return origin;
  return undefined;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, origin?: string): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage, limit = 10_000): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('Petición demasiado grande.');
  }
  return body;
}

type AnalyzeFn = typeof analyze;

async function handleAnalyze(req: http.IncomingMessage, res: http.ServerResponse, origin: string | undefined, run: AnalyzeFn): Promise<void> {
  if (busy) return sendJson(res, 409, { error: 'Ya hay un análisis en curso. Esperá a que termine.' }, origin);

  let target: string;
  try {
    target = String((JSON.parse(await readBody(req)) as { url?: unknown }).url ?? '').trim();
  } catch {
    return sendJson(res, 400, { error: 'Petición inválida.' }, origin);
  }
  if (!target) return sendJson(res, 400, { error: 'Pegá el enlace de Google Maps del negocio.' }, origin);

  busy = true;
  const controller = new AbortController();
  // Si el usuario cierra o recarga la página, se cancela el análisis y se cierra el navegador.
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  const line = (obj: unknown) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
  };

  const label = target.slice(0, 80);
  console.log(`→ Analizando ${label}`);
  try {
    const datos = await run(target, {
      signal: controller.signal,
      onProgress: (p) => line({ tipo: 'progreso', porcentaje: p.percent, mensaje: p.message }),
    });
    line({ tipo: 'resultado', datos });
    console.log(`✔ ${datos.profile.name} (${(datos.durationMs / 1000).toFixed(1)} s)`);
  } catch (err) {
    const mensaje = (err as Error).message;
    line({ tipo: 'error', mensaje });
    console.log(`✖ ${mensaje}`);
  } finally {
    busy = false;
    res.end();
  }
}

/** @param run función de análisis (se puede sustituir en tests). */
export function createServer(run: AnalyzeFn = analyze): http.Server {
  return http.createServer((req, res) => {
    const origin = allowedOrigin(req.headers.origin);
    const route = (req.url ?? '/').split('?')[0];

    if (req.method === 'OPTIONS') {
      res.writeHead(origin ? 204 : 403, origin
        ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
        : {});
      return res.end();
    }
    // Una web cualquiera abierta en el navegador no puede lanzar análisis en tu equipo.
    if (req.headers.origin && !origin) return sendJson(res, 403, { error: 'Origen no permitido.' });

    if (req.method === 'GET' && (route === '/' || route === '/index.html')) {
      readFile(path.join(ROOT_DIR, 'index.html'))
        .then((html) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          res.end(html);
        })
        .catch(() => sendJson(res, 500, { error: 'No se encontró index.html' }));
      return;
    }
    if (req.method === 'GET' && route === '/estado') return sendJson(res, 200, { ok: true, ocupado: busy }, origin);
    if (req.method === 'POST' && route === '/analizar') {
      handleAnalyze(req, res, origin, run).catch((err) => {
        busy = false;
        if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message }, origin);
        else res.end();
      });
      return;
    }
    sendJson(res, 404, { error: 'No encontrado' }, origin);
  });
}

function openBrowser(target: string): void {
  const cmd = process.platform === 'win32' ? `start "" "${target}"` : process.platform === 'darwin' ? `open "${target}"` : `xdg-open "${target}"`;
  exec(cmd, () => {});
}

// Arranque solo cuando se ejecuta directamente (no al importarlo en tests).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const open = process.argv.includes('--abrir');
  const server = createServer();
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`La herramienta ya está abierta en ${url}`);
      if (open) openBrowser(url);
      process.exit(0);
    }
    throw err;
  });
  server.listen(config.port, HOST, () => {
    console.log(`\n  Herramienta de prospección lista: ${url}\n  (cerrá esta ventana para detenerla)\n`);
    if (open) openBrowser(url);
  });
}
