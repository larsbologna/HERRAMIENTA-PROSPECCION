/**
 * CONTACTO: WhatsApp confirmado ≠ teléfono, normalización de números argentinos, canal recomendado
 * (orden configurable) y que NINGÚN prospecto quede sin una acción. Casos 1 a 7 de la fase 2.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { contactPlan, normalizeWhatsapp, parseContactOrder, telHref } from '../src/prospecting/contact.js';
import { type Client, loggedClient, startApp } from './helpers.js';
import { barberias, FakeMaps, opticas, veterinarias } from './prospectingFixtures.js';

test('Números argentinos para WhatsApp: sin duplicar el 54 ni romper celulares', () => {
  assert.equal(normalizeWhatsapp('5491131005000'), '5491131005000', 'ya correcto');
  assert.equal(normalizeWhatsapp('+54 9 11 3100-5000'), '5491131005000');
  assert.equal(normalizeWhatsapp('1131005000'), '5491131005000', 'enlace sin código de país');
  assert.equal(normalizeWhatsapp('011 15 3100-5000'), '5491131005000', 'con 0 y 15');
  assert.equal(normalizeWhatsapp('54111531005000'), '5491131005000', '54 + 15 local');
  assert.equal(normalizeWhatsapp('549111531005000'), '5491131005000', '549 + 15 local');
  assert.equal(normalizeWhatsapp('545491131005000'), '5491131005000', '54 duplicado');
  assert.equal(normalizeWhatsapp('5495491131005000'), '5491131005000', 'nunca 549549…');
  assert.equal(normalizeWhatsapp('0341 15 555-0000'), '5493415550000', 'interior');
  assert.equal(normalizeWhatsapp('541142531234'), '541142531234', 'WhatsApp Business en un fijo: se respeta lo que publicó el negocio');
  assert.equal(normalizeWhatsapp('123'), undefined, 'incompleto: no se inventa');
  assert.equal(normalizeWhatsapp(undefined), undefined);
  assert.equal(telHref('011 4253-1234'), 'tel:01142531234');
  assert.equal(telHref('+54 11 4253-1234'), 'tel:+541142531234');
  assert.equal(telHref('12'), undefined);
});

const MAPS = 'https://www.google.com/maps/place/x';
test('Canal recomendado: WhatsApp → Instagram → Teléfono → Web → Google Maps, y nunca sin acción', () => {
  // CASO 1: teléfono + WhatsApp confirmado
  let p = contactPlan({ phone: '011 15 3100-5000', whatsappNumber: '5491131005000', whatsappSource: 'Instagram', mapsUrl: MAPS });
  assert.deepEqual([p.recommended, p.action, p.whatsapp.state], ['whatsapp', 'Contactar por WhatsApp', 'confirmado']);
  assert.match(p.reason, /WhatsApp confirmado en Instagram/);
  // CASO 2: teléfono fijo, sin WhatsApp → LLAMAR (un fijo NO es WhatsApp)
  p = contactPlan({ phone: '011 4253-1234', mapsUrl: MAPS });
  assert.deepEqual([p.recommended, p.action, p.whatsapp.state, p.whatsapp.number], ['telefono', 'Llamar', 'no_detectado', null]);
  assert.equal(p.phone?.tel, 'tel:01142531234');
  // Celular sin confirmar: sigue siendo LLAMAR, con WhatsApp "sin confirmar" (no ✓)
  p = contactPlan({ phone: '011 15 3200-4444', mapsUrl: MAPS });
  assert.deepEqual([p.recommended, p.whatsapp.state, p.whatsapp.number], ['telefono', 'sin_confirmar', '5491132004444']);
  assert.ok(!p.available.includes('whatsapp'));
  // CASO 3: Instagram sin WhatsApp → Instagram primero
  p = contactPlan({ phone: '011 4253-5678', instagramUrl: 'https://www.instagram.com/x/', mapsUrl: MAPS });
  assert.deepEqual([p.recommended, p.action], ['instagram', 'Contactar por Instagram']);
  assert.deepEqual(p.available, ['instagram', 'telefono', 'maps']);
  // CASO 5: solo web → ABRIR WEB, sin canal directo
  p = contactPlan({ websiteUrl: 'https://x.com.ar', mapsUrl: MAPS });
  assert.deepEqual([p.recommended, p.action, p.direct], ['web', 'Abrir web', false]);
  // CASO 6: sin canales → Google Maps (siempre hay una acción)
  p = contactPlan({ mapsUrl: MAPS });
  assert.deepEqual([p.recommended, p.action, p.direct], ['maps', 'Abrir Google Maps', false]);
  assert.match(p.reason, /Sin canal directo detectado/);
  // Orden configurable
  p = contactPlan({ phone: '011 4253-1234', instagramUrl: 'https://www.instagram.com/x/', mapsUrl: MAPS }, parseContactOrder('telefono,whatsapp'));
  assert.equal(p.recommended, 'telefono');
  assert.deepEqual(parseContactOrder('basura,web'), ['web', 'whatsapp', 'instagram', 'telefono', 'maps']);
});

// ------------------------------------------------------------------ API

let app: Awaited<ReturnType<typeof startApp>>;
let admin: Client;
async function search(rubro: string, cantidad: number) {
  await admin.post('/api/prospeccion/buscar', { rubro, zona: 'Quilmes', cantidad });
  for (let i = 0; i < 400; i++) {
    const { body } = await admin.get('/api/prospeccion/trabajo');
    if (body.job?.phase === 'terminado' && body.job.rubro === rubro) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`no terminó ${rubro}`);
}
before(async () => {
  const maps = new FakeMaps({ ópticas: opticas(), veterinarias: veterinarias(), barberías: barberias() });
  app = await startApp({}, { generate: maps.generate, analyze: maps.analyze });
  admin = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván Bologna');
  await search('Ópticas', 6);
  await search('Veterinarias', 4);
  await search('Barberías', 4);
});
after(() => app.close());

test('Casos 1–6 desde la API: cada prospecto trae su plan de contacto y ninguno queda colgado', async () => {
  const items = (await admin.get('/api/prospeccion/prospectos?rubro=opticas')).body.items as any[];
  const by = (n: string) => items.find((x) => x.name === n).contactPlan;
  assert.equal(items.length, 6);
  assert.deepEqual([by('Óptica Con WhatsApp').recommended, by('Óptica Con WhatsApp').whatsapp.number], ['whatsapp', '5491132001111']);
  assert.deepEqual([by('Óptica Teléfono Fijo').recommended, by('Óptica Teléfono Fijo').whatsapp.state], ['telefono', 'no_detectado']);
  assert.equal(by('Óptica Instagram').recommended, 'instagram');
  assert.deepEqual([by('Óptica Celular').recommended, by('Óptica Celular').whatsapp.state], ['telefono', 'sin_confirmar']);
  assert.equal(by('Óptica Solo Web').recommended, 'web');
  assert.deepEqual([by('Óptica Sin Canales').recommended, by('Óptica Sin Canales').direct], ['maps', false]);
  for (const it of items) assert.ok(it.contactPlan.action, `${it.name} tiene una acción`);
  // La ficha trae lo mismo, más el mensaje para cada canal (WhatsApp completo, Instagram corto, guion para llamar).
  const id = items.find((x) => x.name === 'Óptica Con WhatsApp').id;
  const card = (await admin.get(`/api/prospeccion/ficha/${id}`)).body;
  assert.equal(card.contactPlan.recommended, 'whatsapp');
  assert.ok(card.messages.primerContacto.length > card.messages.instagram.length * 1.8, 'Instagram es más corto');
  assert.match(card.messages.telefono, /¿Con quién podría hablar sobre eso\?$/);
  assert.ok(card.messageInsight.cta, 'informa la familia del CTA');
});

test('El orden de canales se configura y se aplica', async () => {
  assert.equal((await admin.get('/api/settings')).body.settings.contactOrder, 'whatsapp,instagram,telefono,web,maps');
  assert.equal((await admin.put('/api/settings', { contactOrder: 'telefono,instagram,whatsapp,web,maps' })).status, 200);
  const items = (await admin.get('/api/prospeccion/prospectos?rubro=opticas')).body.items as any[];
  assert.equal(items.find((x) => x.name === 'Óptica Instagram').contactPlan.recommended, 'telefono');
  assert.equal((await admin.put('/api/settings', { contactOrder: 'whatsapp,fax' })).status, 400);
  await admin.put('/api/settings', { contactOrder: 'whatsapp,instagram,telefono,web,maps' });
});

test('CASO 7: Siguiente respeta rubro, estado y prioridad; los contactados no vuelven', async () => {
  let q = (await admin.get('/api/prospeccion/cola?rubro=veterinarias')).body.items;
  assert.equal(q.length, 4);
  await admin.post(`/api/prospeccion/${q[0].id}/resultado`, { estado: 'contactado', mensaje: 'Hola', canal: 'telefono' });
  q = (await admin.get('/api/prospeccion/cola?rubro=veterinarias')).body.items;
  assert.equal(q.length, 3, 'el contactado sale de "No contactados"');
  const contacted = (await admin.get('/api/prospeccion/cola?rubro=veterinarias&estado=contactado')).body.items;
  assert.equal(contacted.length, 1, 'con el filtro "Contactados" recorre los contactados');
  const all = (await admin.get('/api/prospeccion/cola?rubro=veterinarias&estado=todos')).body.items;
  assert.equal(all.length, 4);
  assert.notEqual(all[0].id, contacted[0].id, 'con "Todos", primero los no contactados');
  assert.equal(all.at(-1).id, contacted[0].id);
  const vets = new Set((await admin.get('/api/prospeccion/prospectos?rubro=veterinarias&estado=todos')).body.items.map((x: any) => x.id));
  for (const x of all) assert.ok(vets.has(x.id), 'nunca salta a otro rubro');
  // La llamada queda registrada como llamada.
  const detail = (await admin.get(`/api/prospects/${contacted[0].id}`)).body;
  assert.ok(detail.activities.some((a: any) => a.type === 'llamada' && /Llamada \(guion usado\)/.test(a.content)));
});
