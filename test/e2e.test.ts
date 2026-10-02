/**
 * Prueba de punta a punta con Chromium real contra una ficha de Maps SIMULADA
 * (test/fixtures/maps.html replica la estructura DOM de Google Maps) y una web local.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/analyzer.js';
import type { AnalysisResult } from '../src/domain/types.js';
import { createServer } from '../src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let fixtures: http.Server;
let base = '';

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

after(() => {
  fixtures.close();
});

test('análisis completo: datos, problemas con argumento, mensaje y presupuesto', { timeout: 120_000 }, async () => {
  const progress: number[] = [];
  const r = await analyze(`${base}/maps/place/peluqueria-lola`, { skipUrlValidation: true, onProgress: (p) => progress.push(p.percent) });

  // 1. Datos del negocio
  const p = r.profile;
  assert.equal(p.name, 'Peluquería Lola');
  assert.equal(p.category, 'Peluquería');
  assert.equal(p.rating, 4.1);
  assert.equal(p.reviewCount, 23);
  assert.equal(p.address, 'Calle Mayor 12, 28013 Madrid');
  assert.equal(p.phone, '+34911222333');
  assert.equal(p.website, `${base}/site`);
  assert.equal(Object.keys(p.hours?.days ?? {}).length, 5);
  assert.equal(p.photoCount, 7);
  assert.equal(p.isClaimed, false);
  assert.equal(p.reviews.length, 4);
  assert.equal(r.vertical.id, 'belleza');
  assert.ok(r.website?.reachable);

  // 2–6. Un argumento completo por problema
  const ids = r.proposal.salesArguments.map((a) => a.findingId);
  for (const id of ['maps-unclaimed', 'maps-incomplete-hours', 'maps-few-photos', 'rep-few-reviews', 'rep-negative-unanswered', 'web-not-mobile', 'web-no-booking', 'wa-not-visible', 'wa-no-auto-reply']) {
    assert.ok(ids.includes(id), `falta ${id}; hay: ${ids.join(', ')}`);
  }
  assert.equal(r.proposal.salesArguments.length, r.audit.findings.length);
  for (const a of r.proposal.salesArguments) assert.ok(a.problem && a.impact && a.reason && a.service && a.benefit, a.findingId);

  // 7. Mensaje
  assert.match(r.proposal.whatsappMessage, /Peluquería Lola/);

  // 8. Presupuesto
  assert.ok(r.budget.recommended.items.length > 0);
  assert.ok(r.budget.complete.items.length >= r.budget.recommended.items.length);
  assert.ok(r.budget.recommended.setupAfterDiscount > 0);
  assert.ok(r.budget.recommended.items.length <= 3);
  assert.ok(r.budget.recommended.items.every((i) => r.proposal.services.find((s) => s.id === i.id)?.priority === 'alta'));

  // Progreso creciente hasta 100
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b));
  assert.equal(progress.at(-1), 100);
});

test('el análisis respeta el tiempo máximo y cierra el navegador', { timeout: 60_000 }, async () => {
  await assert.rejects(
    analyze(`${base}/maps/place/lento`, { skipUrlValidation: true, timeoutMs: 1_500 }),
    /tiempo máximo/,
  );
});

test('enlaces que no son de Google Maps se rechazan sin abrir el navegador', async () => {
  await assert.rejects(analyze('https://google.evil.com/maps/x'), /no es de Google Maps/);
});

// ---------------- Servidor local ----------------

async function withServer(run: Parameters<typeof createServer>[0], fn: (url: string) => Promise<void>) {
  const server = createServer(run).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

async function readLines(res: Response): Promise<Array<Record<string, unknown>>> {
  return (await res.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('servidor: index.html, progreso en streaming, resultado, errores y orígenes', { timeout: 120_000 }, async () => {
  const fake = (async (_url, opts) => {
    opts?.onProgress?.({ percent: 50, message: 'mitad' });
    await new Promise((r) => setTimeout(r, 300));
    return { profile: { name: 'Fake' } } as unknown as AnalysisResult;
  }) as typeof analyze;

  await withServer(fake, async (api) => {
    const page = await fetch(`${api}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Analizar negocio/);

    const ok = await fetch(`${api}/analizar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'x' }) });
    assert.equal(ok.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
    const lines = await readLines(ok);
    assert.deepEqual(lines[0], { tipo: 'progreso', porcentaje: 50, mensaje: 'mitad' });
    assert.equal(lines.at(-1)?.tipo, 'resultado');

    // Un análisis a la vez
    const first = fetch(`${api}/analizar`, { method: 'POST', body: JSON.stringify({ url: 'x' }) });
    await new Promise((r) => setTimeout(r, 100));
    const second = await fetch(`${api}/analizar`, { method: 'POST', body: JSON.stringify({ url: 'x' }) });
    assert.equal(second.status, 409);
    await (await first).text();

    assert.equal((await fetch(`${api}/analizar`, { method: 'POST', body: '{mal' })).status, 400);
    assert.equal((await fetch(`${api}/analizar`, { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await fetch(`${api}/no-existe`)).status, 404);

    // Una web ajena no puede lanzar análisis; index.html abierto con doble clic (origin "null") sí.
    assert.equal((await fetch(`${api}/analizar`, { method: 'POST', headers: { Origin: 'https://sitio-malicioso.com' }, body: '{}' })).status, 403);
    const fromFile = await fetch(`${api}/estado`, { headers: { Origin: 'null' } });
    assert.equal(fromFile.headers.get('access-control-allow-origin'), 'null');
  });

  // Con el analizador real, un enlace inválido devuelve un error legible en el stream.
  await withServer(undefined, async (api) => {
    const res = await fetch(`${api}/analizar`, { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) });
    const lines = await readLines(res);
    assert.equal(lines.at(-1)?.tipo, 'error');
    assert.match(String(lines.at(-1)?.mensaje), /no es de Google Maps/);
  });
});
