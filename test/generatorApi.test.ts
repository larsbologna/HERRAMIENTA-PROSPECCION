/**
 * API del Generador de Prospectos: progreso en vivo, no repetición entre búsquedas, permisos
 * por rol, seguimiento comercial, estadísticas y vínculo con el análisis existente.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { Client, loggedClient, startApp } from './helpers.js';

let app: Awaited<ReturnType<typeof startApp>>;
let admin: Client;
let vera: Client;
before(async () => {
  app = await startApp();
  admin = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván');
  vera = await loggedClient(app.base, app.users, 'vera', 'vendedor', 'Vera');
});
after(() => {
  app.close();
  rmSync(app.webDir, { recursive: true, force: true });
});

test('generar: progreso, resultado ordenado por score y sin repetir en la búsqueda siguiente', async () => {
  const first = await vera.generate({ rubro: 'Barberías', zona: 'Quilmes', cantidad: 2 });
  assert.equal(first[0].tipo, 'progreso');
  const r1 = first.at(-1);
  assert.equal(r1.tipo, 'resultado', JSON.stringify(r1));
  assert.equal(r1.encontrados, 2);
  assert.equal(r1.agotado, false);
  assert.deepEqual(r1.items.map((i: any) => i.score), r1.items.map((i: any) => i.score).sort((a: number, b: number) => b - a));
  assert.ok(r1.items.every((i: any) => i.status === 'nuevo' && i.rubro === 'Barberías' && i.zona === 'Quilmes' && i.mapsUrl));

  // Otro usuario pide más: nunca recibe los ya entregados (a nadie).
  const r2 = (await admin.generate({ rubro: 'Barberías', zona: 'Quilmes', cantidad: 5 })).at(-1);
  assert.equal(r2.encontrados, 1);
  assert.equal(r2.agotado, true);
  assert.equal(r2.mensaje, 'Se encontraron 1 prospectos nuevos. No quedan más negocios sin analizar para este rubro y ubicación.');
  const names = [...r1.items, ...r2.items].map((i: any) => i.name);
  assert.equal(new Set(names).size, 3);
  const r3 = (await vera.generate({ rubro: 'Barberías', zona: 'Quilmes', cantidad: 5 })).at(-1);
  assert.equal(r3.encontrados, 0);
});

test('validación de la solicitud', async () => {
  for (const body of [{ rubro: '', zona: 'Quilmes', cantidad: 5 }, { rubro: 'Bares', zona: '', cantidad: 5 }, { rubro: 'Bares', zona: 'Bernal', cantidad: 0 }, { rubro: 'Bares', zona: 'Bernal', cantidad: 51 }]) {
    const r = (await admin.generate(body))[0];
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test('permisos: el vendedor ve y gestiona solo lo que generó; el admin ve todo', async () => {
  const mine = (await vera.get('/api/generador')).body;
  assert.equal(mine.items.length, 2);
  assert.equal(mine.statuses.length, 7);
  assert.equal((await admin.get('/api/generador')).body.items.length, 3);
  assert.equal((await admin.get('/api/generador?usuario=me')).body.items.length, 1);
  const adminItem = (await admin.get('/api/generador?usuario=me')).body.items[0];
  assert.equal((await vera.patch(`/api/generador/${adminItem.id}`, { status: 'contactado' })).status, 404, 'no puede tocar uno ajeno');
  const anon = new Client(app.base);
  assert.equal((await anon.get('/api/generador')).status, 401);
});

test('seguimiento comercial, estadísticas y vínculo con el análisis existente', async () => {
  const [a, b] = (await vera.get('/api/generador')).body.items;
  assert.equal((await vera.patch(`/api/generador/${a.id}`, { status: 'contactado' })).body.item.status, 'contactado');
  await vera.patch(`/api/generador/${a.id}`, { status: 'interesado' });
  await vera.patch(`/api/generador/${a.id}`, { status: 'propuesta' });
  await vera.patch(`/api/generador/${a.id}`, { status: 'ganado' });
  await vera.patch(`/api/generador/${b.id}`, { status: 'perdido' });
  assert.equal((await vera.patch(`/api/generador/${a.id}`, { status: 'otro' })).status, 400);
  const s = (await vera.get('/api/generador/estadisticas')).body.stats;
  assert.deepEqual(s, { found: 2, pending: 0, contacted: 1, interested: 1, proposals: 1, won: 1, lost: 1, closeRate: 100 });
  assert.equal((await admin.get('/api/generador/estadisticas')).body.stats.found, 3);
  assert.equal((await vera.get('/api/generador?estado=ganado')).body.items.length, 1);
  assert.equal((await vera.get('/api/generador/busquedas')).body.items.length, 2);

  // "Analizar": el flujo existente (/api/analizar) crea el prospecto del CRM y se vincula.
  const done = (await vera.analyze(a.mapsUrl)).at(-1);
  assert.equal(done.tipo, 'resultado');
  const linked = (await vera.post(`/api/generador/${a.id}/vincular`, { prospectId: done.prospectId })).body.item;
  assert.equal(linked.prospectId, done.prospectId);
  // No se puede vincular un análisis ajeno.
  const other = (await admin.analyze('https://maps.app.goo.gl/Ajeno')).at(-1);
  assert.equal((await vera.post(`/api/generador/${b.id}/vincular`, { prospectId: other.prospectId })).status, 404);
  // Queda en el registro de actividad.
  const log = (await admin.get('/api/activity?type=generador')).body.items;
  assert.ok(log.some((x: any) => /Generó 2 prospecto/.test(x.content)));
});
