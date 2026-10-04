import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { buildAnalysis, type analyze } from '../src/analyzer.js';
import { createApp } from '../src/api/app.js';
import { CrmRepository } from '../src/crm/repository.js';
import { openDatabase } from '../src/db/database.js';
import type { BusinessProfile } from '../src/domain/types.js';
import { loadPriceList } from '../src/proposal/budget.js';

const profile = (name: string): BusinessProfile => ({
  sourceUrl: 'x', name, category: 'Peluquería', additionalCategories: [], rating: 4.2, reviewCount: 20, address: `Calle ${name}`,
  phone: '+54 341 555-0000', services: [], hasBooking: false, hasMenu: false, photoCount: 5, photoCountIsEstimate: false, photoUrls: [],
  posts: [], reviews: [], permanentlyClosed: false, socialLinks: [], scrapedAt: '', warnings: [],
});

let api = '';
let close: () => void;
let webDir = '';
const fakeAnalyze = (async (url, opts) => {
  opts?.onProgress?.({ percent: 50, message: 'mitad' });
  await new Promise((r) => setTimeout(r, 200));
  if (url.includes('falla')) throw new Error('Google Maps tardó demasiado');
  return buildAnalysis(url, profile(decodeURIComponent(url.split('/').pop()!)), undefined, { durationMs: 10 });
}) as typeof analyze;

before(async () => {
  webDir = mkdtempSync(path.join(os.tmpdir(), 'web-'));
  writeFileSync(path.join(webDir, 'index.html'), '<h1>App</h1>');
  mkdirSync(path.join(webDir, 'assets'));
  writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log(1)');
  const repo = new CrmRepository(openDatabase(':memory:'), () => loadPriceList());
  const server = createApp({ repo, analyze: fakeAnalyze, webDir, log: () => {} }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(() => {
  close();
  rmSync(webDir, { recursive: true, force: true });
});

const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });
const post = (p: string, body: unknown) => fetch(api + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patch = (p: string, body: unknown) => fetch(api + p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function analyzeVia(url: string) {
  const lines = (await (await post('/api/analizar', { url })).text()).trim().split('\n').map((l) => JSON.parse(l));
  return lines;
}

test('analizar guarda el prospecto y devuelve su id por el stream', async () => {
  const lines = await analyzeVia('https://maps.app.goo.gl/Peluquería Lola');
  assert.deepEqual(lines[0], { tipo: 'progreso', porcentaje: 50, mensaje: 'mitad' });
  const result = lines.at(-1);
  assert.equal(result.tipo, 'resultado');
  assert.equal(result.creado, true);
  const { body } = await json(await fetch(`${api}/api/prospects/${result.prospectId}`));
  assert.equal(body.name, 'Peluquería Lola');
  assert.equal(body.budget.currency, 'ARS');
  assert.match(body.messages.primerContacto, /Peluquería Lola/);
  assert.ok(body.problems.length > 0 && body.services.length > 0);
  // Reanalizar: mismo prospecto
  const again = (await analyzeVia('https://maps.app.goo.gl/Peluquería Lola')).at(-1);
  assert.equal(again.prospectId, result.prospectId);
  assert.equal(again.creado, false);
  // Error legible
  const fail = (await analyzeVia('https://maps.app.goo.gl/falla')).at(-1);
  assert.deepEqual(fail, { tipo: 'error', mensaje: 'Google Maps tardó demasiado' });
});

test('un análisis a la vez', async () => {
  const first = post('/api/analizar', { url: 'https://maps.app.goo.gl/Uno' });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal((await post('/api/analizar', { url: 'https://maps.app.goo.gl/Dos' })).status, 409);
  await (await first).text();
});

test('CRM: listado, estados, notas, actividades, dashboard, métricas, auditorías', async () => {
  await analyzeVia('https://maps.app.goo.gl/Barbería Sur');
  const list = (await json(await fetch(`${api}/api/prospects?sort=name&dir=asc`))).body.items;
  assert.ok(list.length >= 2);
  const id = list.find((p: any) => p.name === 'Barbería Sur').id;

  const moved = await json(await patch(`/api/prospects/${id}`, { status: 'reunion', notes: 'Le interesa la web' }));
  assert.equal(moved.body.status, 'reunion');
  assert.equal(moved.body.notes, 'Le interesa la web');
  assert.equal((await json(await patch(`/api/prospects/${id}`, { status: 'x' }))).status, 400);

  const act = await json(await post(`/api/prospects/${id}/activities`, { type: 'llamada', content: 'Atendió la secretaria' }));
  assert.equal(act.body.label, 'Llamada');
  assert.equal((await json(await post(`/api/prospects/${id}/activities`, { type: 'llamada', content: '' }))).status, 400);

  assert.equal((await json(await fetch(`${api}/api/prospects?status=reunion`))).body.items.length, 1);
  const dash = (await json(await fetch(`${api}/api/dashboard`))).body;
  assert.equal(dash.kpis.meetings, 1);
  assert.ok(dash.kpis.potentialValue > 0);
  const met = (await json(await fetch(`${api}/api/metrics`))).body;
  assert.ok(met.totals.prospects >= 2);
  assert.ok((await json(await fetch(`${api}/api/audits`))).body.items.length >= 3);

  assert.equal((await json(await fetch(`${api}/api/prospects/no-existe`))).status, 404);
  assert.equal((await json(await fetch(`${api}/api/prospects/${id}`, { method: 'DELETE' }))).body.ok, true);
  assert.equal((await json(await fetch(`${api}/api/prospects/${id}`))).status, 404);
});

test('configuración, meta y exportación', async () => {
  const saved = await json(await fetch(`${api}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sellerName: 'Martín', sellerCity: 'Rosario' }) }));
  assert.equal(saved.body.settings.sellerName, 'Martín');
  const s = (await json(await fetch(`${api}/api/settings`))).body;
  assert.equal(s.prices.moneda, 'ARS');
  assert.equal(s.priceError, null);
  const meta = (await json(await fetch(`${api}/api/meta`))).body;
  assert.equal(meta.statuses.length, 7);
  const exp = await fetch(`${api}/api/export`);
  assert.match(exp.headers.get('content-disposition') ?? '', /prospectos-\d{4}-\d{2}-\d{2}\.json/);
  assert.ok(Array.isArray(((await exp.json()) as any).prospects));
  // El mensaje usa el nombre configurado
  const any = (await json(await fetch(`${api}/api/prospects`))).body.items[0];
  assert.match((await json(await fetch(`${api}/api/prospects/${any.id}`))).body.messages.primerContacto, /Soy Martín, de Rosario/);
});

test('seguridad y archivos estáticos', async () => {
  assert.match(await (await fetch(`${api}/`)).text(), /App/);
  assert.match(await (await fetch(`${api}/pipeline`)).text(), /App/, 'rutas de la app devuelven index.html');
  assert.equal((await fetch(`${api}/assets/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.doesNotMatch(await (await fetch(`${api}/assets/../../etc/passwd`)).text(), /root:/, 'nunca sirve archivos fuera de web/');
  assert.equal((await fetch(`${api}/assets/..%2f..%2fpackage.json`)).status, 403, 'barra codificada para salir de web/');
  assert.equal((await fetch(`${api}/%2e%2e/%2e%2e/package.json`)).status, 404);
  assert.equal((await json(await fetch(`${api}/api/nada`))).status, 404);
  assert.equal((await json(await fetch(`${api}/api/prospects`, { method: 'PUT' }))).status, 405);
  assert.equal((await fetch(`${api}/api/analizar`, { method: 'POST', body: '{mal' })).status, 400);
  // Otras webs no pueden usar la API; index.html con doble clic solo puede consultar el estado
  assert.equal((await fetch(`${api}/api/prospects`, { headers: { Origin: 'https://malicioso.com' } })).status, 403);
  assert.equal((await fetch(`${api}/api/prospects`, { headers: { Origin: 'null' } })).status, 403);
  const st = await fetch(`${api}/api/estado`, { headers: { Origin: 'null' } });
  assert.equal(st.headers.get('access-control-allow-origin'), 'null');
});
