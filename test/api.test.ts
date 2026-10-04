import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { Client, loggedClient, startApp } from './helpers.js';

let app: Awaited<ReturnType<typeof startApp>>;
let admin: Client;
before(async () => {
  app = await startApp();
  admin = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván');
});
after(() => {
  app.close();
  rmSync(app.webDir, { recursive: true, force: true });
});

test('analizar guarda el prospecto y devuelve su id por el stream', async () => {
  const lines = await admin.analyze('https://maps.app.goo.gl/Peluquería Lola');
  assert.deepEqual(lines[0], { tipo: 'progreso', porcentaje: 50, mensaje: 'mitad' });
  const result = lines.at(-1);
  assert.equal(result.tipo, 'resultado');
  assert.equal(result.creado, true);
  const { body } = await admin.get(`/api/prospects/${result.prospectId}`);
  assert.equal(body.name, 'Peluquería Lola');
  assert.equal(body.budget.currency, 'ARS');
  assert.equal(body.assignedUserName, 'Iván', 'queda asignado a quien lo analizó');
  assert.match(body.messages.primerContacto, /Peluquería Lola/);
  assert.match(body.messages.primerContacto, /Soy Iván/, 'el mensaje firma con el usuario conectado');
  const again = (await admin.analyze('https://maps.app.goo.gl/Peluquería Lola')).at(-1);
  assert.equal(again.prospectId, result.prospectId);
  assert.equal(again.creado, false);
  const fail = (await admin.analyze('https://maps.app.goo.gl/falla')).at(-1);
  assert.deepEqual(fail, { tipo: 'error', mensaje: 'Google Maps tardó demasiado' });
});

test('un análisis a la vez', async () => {
  const first = admin.req('POST', '/api/analizar', { url: 'https://maps.app.goo.gl/Uno' });
  await new Promise((r) => setTimeout(r, 40));
  const second = await admin.json('POST', '/api/analizar', { url: 'https://maps.app.goo.gl/Dos' });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /Iván/);
  await (await first).text();
});

test('CRM: listado, estados, notas, actividades, dashboard, métricas, auditorías', async () => {
  await admin.analyze('https://maps.app.goo.gl/Barbería Sur');
  const list = (await admin.get('/api/prospects?sort=name&dir=asc')).body.items;
  assert.ok(list.length >= 2);
  const id = list.find((p: any) => p.name === 'Barbería Sur').id;

  const moved = await admin.patch(`/api/prospects/${id}`, { status: 'reunion', notes: 'Le interesa la web' });
  assert.equal(moved.body.status, 'reunion');
  assert.equal(moved.body.notes, 'Le interesa la web');
  assert.equal((await admin.patch(`/api/prospects/${id}`, { status: 'x' })).status, 400);

  const act = await admin.post(`/api/prospects/${id}/activities`, { type: 'llamada', content: 'Atendió la secretaria' });
  assert.equal(act.body.label, 'Llamada');
  assert.equal(act.body.userName, 'Iván');
  assert.equal((await admin.post(`/api/prospects/${id}/activities`, { type: 'llamada', content: '' })).status, 400);

  assert.equal((await admin.get('/api/prospects?status=reunion')).body.items.length, 1);
  const dash = (await admin.get('/api/dashboard')).body;
  assert.equal(dash.kpis.meetings, 1);
  assert.ok(dash.kpis.potentialValue > 0);
  assert.equal(dash.scope, 'equipo');
  assert.ok((await admin.get('/api/metrics')).body.totals.prospects >= 2);
  const audits = (await admin.get('/api/audits')).body.items;
  assert.ok(audits.length >= 3 && audits[0].userName === 'Iván');

  assert.equal((await admin.get('/api/prospects/no-existe')).status, 404);
  assert.equal((await admin.del(`/api/prospects/${id}`)).body.ok, true);
  assert.equal((await admin.get(`/api/prospects/${id}`)).status, 404);
});

test('configuración, meta y exportación', async () => {
  const saved = await admin.put('/api/settings', { sellerCity: 'Rosario' });
  assert.equal(saved.body.settings.sellerCity, 'Rosario');
  const s = (await admin.get('/api/settings')).body;
  assert.equal(s.prices.moneda, 'ARS');
  assert.equal(s.priceError, null);
  const meta = (await admin.get('/api/meta')).body;
  assert.equal(meta.statuses.length, 7);
  assert.ok(meta.users.some((u: any) => u.name === 'Iván'));
  const exp = await admin.req('GET', '/api/export');
  assert.match(exp.headers.get('content-disposition') ?? '', /prospectos-\d{4}-\d{2}-\d{2}\.json/);
  assert.ok(Array.isArray(((await exp.json()) as any).prospects));
  const any = (await admin.get('/api/prospects')).body.items[0];
  assert.match((await admin.get(`/api/prospects/${any.id}`)).body.messages.primerContacto, /Soy Iván, de Rosario/);
});

test('seguridad, cabeceras y archivos estáticos', async () => {
  const anon = new Client(app.base);
  const page = await anon.req('GET', '/');
  assert.match(await page.text(), /App/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.match(await (await anon.req('GET', '/pipeline')).text(), /App/, 'rutas de la app devuelven index.html');
  assert.equal((await anon.req('GET', '/assets/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.doesNotMatch(await (await anon.req('GET', '/assets/../../etc/passwd')).text(), /root:/);
  assert.equal((await anon.req('GET', '/assets/..%2f..%2fpackage.json')).status, 403);
  assert.equal((await anon.req('GET', '/%2e%2e/%2e%2e/package.json')).status, 404);
  assert.equal((await admin.get('/api/nada')).status, 404);
  assert.equal((await admin.json('PUT', '/api/prospects')).status, 405);
  assert.equal((await admin.json('POST', '/api/analizar', '{mal')).status, 400);
  // Otras webs no pueden usar la API; index.html con doble clic solo puede consultar el estado
  assert.equal((await admin.json('GET', '/api/prospects', undefined, { Origin: 'https://malicioso.com' })).status, 403);
  assert.equal((await admin.json('GET', '/api/prospects', undefined, { Origin: 'null' })).status, 403);
  const st = await anon.req('GET', '/api/estado', undefined, { Origin: 'null' });
  assert.equal(st.headers.get('access-control-allow-origin'), 'null');
});
