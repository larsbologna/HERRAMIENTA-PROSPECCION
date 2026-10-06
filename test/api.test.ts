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
  assert.match((await admin.get(`/api/prospects/${any.id}`)).body.messages.primerContacto, /Soy Iván, Gestor de Presencia Online acá en Rosario\./);
});

test('editar precios y datos del negocio desde Configuración: se aplica al instante', async () => {
  await admin.analyze('https://maps.app.goo.gl/Precios Test');
  const before = (await admin.get('/api/prospects')).body.items;
  const target = before.find((p: any) => p.potentialValue > 0);
  assert.ok(target, 'hace falta un prospecto con valor');
  const s = (await admin.get('/api/settings')).body;

  // Duplicar todos los precios.
  const doubled = Object.fromEntries(Object.entries(s.prices.servicios).map(([id, v]: [string, any]) => [id, { pagoInicial: v.pagoInicial * 2, mensual: v.mensual * 2 }]));
  const saved = await admin.put('/api/settings/prices', { prices: { ...s.prices, servicios: doubled } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.ok(saved.body.recalculated >= 1);
  const after = (await admin.get(`/api/prospects/${target.id}`)).body;
  assert.equal(after.potentialValue, target.potentialValue * 2, 'el valor potencial se recalcula al instante');
  assert.equal((await admin.get('/api/settings')).body.prices.servicios['website'].pagoInicial, s.prices.servicios['website'].pagoInicial * 2);

  // Validación y permisos.
  const bad = await admin.put('/api/settings/prices', { prices: { ...s.prices, servicios: { website: { pagoInicial: -5, mensual: 1 } } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Pago inicial/);
  assert.equal((await admin.put('/api/settings/prices', { prices: { ...s.prices, moneda: 'pesos' } })).status, 400);
  const seller = await loggedClient(app.base, app.users, 'vera', 'vendedor', 'Vera');
  assert.equal((await seller.put('/api/settings/prices', { prices: s.prices })).status, 403);
  assert.equal((await seller.put('/api/settings', { sellerBusiness: 'X' })).status, 403);

  // Datos del negocio → mensajes de WhatsApp.
  const info = await admin.put('/api/settings', { sellerBusiness: 'Presencia Total', sellerCity: 'Córdoba', sellerIntro: '', sellerLink: '@presenciatotal' });
  assert.equal(info.status, 200, JSON.stringify(info.body));
  let msg = (await admin.get(`/api/prospects/${target.id}`)).body.messages;
  assert.match(msg.primerContacto, /Soy Iván, Presencia Total acá en Córdoba\./);
  assert.match(msg.primerContacto, /Si querés ver lo que hago: https:\/\/instagram\.com\/presenciatotal/);
  assert.match(msg.primerContactoCorto, /Soy Iván, Presencia Total acá en Córdoba\./);
  await admin.put('/api/settings', { sellerIntro: 'Ayudo a comercios a conseguir más clientes desde Google' });
  msg = (await admin.get(`/api/prospects/${target.id}`)).body.messages;
  assert.match(msg.primerContacto, /Soy Iván, Presencia Total acá en Córdoba\. Ayudo a comercios a conseguir más clientes desde Google\./);
  assert.equal((await admin.put('/api/settings', { sellerLink: 'no es un enlace' })).status, 400);

  // Queda registrado en la actividad.
  const log = (await admin.get('/api/activity?type=configuracion')).body.items;
  assert.ok(log.some((a: any) => /Precios actualizados/.test(a.content)));
  assert.ok(log.some((a: any) => /Datos del negocio/.test(a.content)));
});

test('catálogo de servicios (agregar, quitar, renombrar) y presupuesto personalizado por prospecto', async () => {
  await admin.analyze('https://maps.app.goo.gl/Catalogo Test');
  const target = (await admin.get('/api/prospects?q=Catalogo')).body.items[0];
  let d = (await admin.get(`/api/prospects/${target.id}`)).body;
  assert.ok(!('contractMonths' in d.budget.recommended) || d.budget.recommended.contractMonths === 0, 'sin meses de contrato');
  assert.equal(d.potentialValue, d.budget.recommended.setupAfterDiscount, 'el valor potencial es el pago inicial');
  const removed = d.services[0].id;
  const s = (await admin.get('/api/settings')).body;
  assert.ok(s.catalog.length >= 7);

  // Quitar el servicio principal, renombrar otro y agregar uno propio.
  const servicios = { ...s.prices.servicios };
  servicios[removed] = { ...(servicios[removed] ?? { pagoInicial: 0, mensual: 0 }), activo: false };
  servicios['custom-logo'] = { pagoInicial: 90000, mensual: 0, nombre: 'Diseño de logo', descripcion: 'Logo y paleta de colores' };
  const saved = await admin.put('/api/settings/prices', { prices: { moneda: 'ARS', servicios, descuentoPaquete: s.prices.descuentoPaquete } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const cat = (await admin.get('/api/settings')).body.catalog;
  assert.ok(cat.find((c: any) => c.id === 'custom-logo' && c.name === 'Diseño de logo' && !c.builtIn));
  assert.equal(cat.find((c: any) => c.id === removed).active, false);

  d = (await admin.get(`/api/prospects/${target.id}`)).body;
  assert.ok(!d.services.some((x: any) => x.id === removed), 'el servicio quitado ya no se recomienda');
  assert.ok(!d.budget.recommended.items.some((x: any) => x.id === removed), 'ni se presupuesta');
  assert.ok(!d.problems.some((a: any) => a.serviceIds.includes(removed)), 'ni figura en los argumentos');
  assert.ok(d.catalog.some((c: any) => c.id === 'custom-logo') && !d.catalog.some((c: any) => c.id === removed));

  // Presupuesto personalizado con un servicio propio.
  const other = ['website', 'maps-optimization', 'qr-reviews'].find((x) => x !== removed)!;
  const custom = await admin.put(`/api/prospects/${target.id}/presupuesto`, { override: { items: [{ id: 'custom-logo', setup: 80000, monthly: 0 }, { id: other, setup: 500000, monthly: 30000 }], discountPct: 10 } });
  assert.equal(custom.status, 200, JSON.stringify(custom.body));
  assert.equal(custom.body.budget.custom, true);
  assert.equal(custom.body.potentialValue, Math.round(580000 * 0.9));
  assert.equal(custom.body.budget.recommended.monthly, 30000);
  assert.equal((await admin.put(`/api/prospects/${target.id}/presupuesto`, { override: { items: [{ id: removed, setup: 1, monthly: 1 }] } })).status, 400, 'no se puede usar un servicio quitado');
  assert.equal((await admin.put(`/api/prospects/${target.id}/presupuesto`, { override: { items: [] } })).status, 400);

  // Reanalizar conserva el presupuesto personalizado; cambiar precios del catálogo no lo pisa.
  await admin.analyze('https://maps.app.goo.gl/Catalogo Test');
  assert.equal((await admin.get(`/api/prospects/${target.id}`)).body.potentialValue, Math.round(580000 * 0.9));

  // Un vendedor no puede tocar el presupuesto de un prospecto ajeno.
  const seller = await loggedClient(app.base, app.users, 'lucia', 'vendedor', 'Lucía');
  assert.equal((await seller.put(`/api/prospects/${target.id}/presupuesto`, { override: null })).status, 404);

  // Volver al automático.
  const back = (await admin.put(`/api/prospects/${target.id}/presupuesto`, { override: null })).body;
  assert.equal(back.budget.custom, undefined);
  assert.equal(back.budgetOverride, null);
  const log = (await admin.get(`/api/prospects/${target.id}`)).body.activities.map((a: any) => a.type);
  assert.ok(log.includes('presupuesto'));

  // Restaurar el catálogo para los tests siguientes.
  await admin.put('/api/settings/prices', { prices: s.prices });
});

test('"Otra versión" del mensaje de WhatsApp', async () => {
  const any = (await admin.get('/api/prospects')).body.items[0];
  const base = (await admin.get(`/api/prospects/${any.id}`)).body.messages.primerContacto;
  const r1 = (await admin.get(`/api/prospects/${any.id}/mensaje?tipo=primerContacto&variante=1`)).body;
  assert.ok(r1.variante >= 1);
  assert.notEqual(r1.texto, base, 'la nueva versión es distinta de la actual');
  const r2 = (await admin.get(`/api/prospects/${any.id}/mensaje?tipo=primerContacto&variante=${r1.variante + 1}`)).body;
  assert.notEqual(r2.texto, r1.texto);
  const corto = (await admin.get(`/api/prospects/${any.id}/mensaje?tipo=primerContactoCorto&variante=1`)).body;
  assert.equal(corto.tipo, 'primerContactoCorto');
  assert.equal((await admin.get(`/api/prospects/${any.id}/mensaje?tipo=otro&variante=1`)).status, 400);
  assert.equal((await admin.get('/api/prospects/no-existe/mensaje?tipo=seguimiento&variante=1')).status, 404);
  // Un vendedor no puede generar mensajes de prospectos ajenos.
  const seller = await loggedClient(app.base, app.users, 'nico', 'vendedor', 'Nico');
  assert.equal((await seller.get(`/api/prospects/${any.id}/mensaje?tipo=primerContacto&variante=1`)).status, 404);
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
