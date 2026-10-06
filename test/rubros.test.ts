/**
 * RUBROS: detección (Google → nombre), normalización, rubros creados por el usuario (guardados en la
 * base, sin duplicar), filtro dinámico, asignación automática y manual, "Siguiente" por rubro,
 * estados nuevos y PRESERVACIÓN de los datos al migrar una base de la versión anterior.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { buildAnalysis } from '../src/analyzer.js';
import { CrmRepository } from '../src/crm/repository.js';
import { openDatabase, SCHEMA_VERSION } from '../src/db/database.js';
import type { BusinessProfile } from '../src/domain/types.js';
import type { PriceList } from '../src/proposal/budget.js';
import { DEFAULT_CATALOG, RubroCatalog } from '../src/rubros/catalog.js';
import { type Client, loggedClient, startApp } from './helpers.js';
import { barberias, FakeMaps, petShops, veterinarias } from './prospectingFixtures.js';

// ------------------------------------------------------------------ catálogo

test('Normalización: Veterinaria / Veterinarias / Veterinario / Clínica veterinaria → Veterinarias', () => {
  for (const v of ['Veterinaria', 'Veterinarias', 'veterinario', 'Clínica veterinaria', 'VETERINARIAS']) {
    assert.equal(DEFAULT_CATALOG.resolve(v)?.key, 'veterinarias', v);
  }
  assert.equal(DEFAULT_CATALOG.resolve('Barbería')?.key, 'barberias');
  assert.equal(DEFAULT_CATALOG.resolve('pet shop')?.key, 'pet-shops');
  assert.equal(DEFAULT_CATALOG.resolve('Algo que no existe'), undefined, 'no inventa un rubro');
});

test('Detección: la categoría de Google manda; el nombre ayuda; si no alcanza, no se inventa', () => {
  const g = DEFAULT_CATALOG.detect({ category: 'Veterinario', name: 'Laprida' });
  assert.deepEqual([g?.key, g?.source, g?.confidence], ['veterinarias', 'google', 'alta']);
  const n = DEFAULT_CATALOG.detect({ category: undefined, name: 'Veterinaria Los Andes' });
  assert.deepEqual([n?.key, n?.source, n?.confidence], ['veterinarias', 'nombre', 'media']);
  const both = DEFAULT_CATALOG.detect({ category: 'Tienda de mascotas', name: 'Veterinaria y Pet Shop Tito' });
  assert.equal(both?.key, 'pet-shops', 'la categoría de Google tiene prioridad sobre el nombre');
  assert.equal(DEFAULT_CATALOG.detect({ category: 'Empresa', name: 'Los Primos SRL' }), undefined);
});

test('Rubros personalizados: se detectan por sus palabras y tienen su propio modelo', () => {
  const cat = new RubroCatalog([{ key: 'viveros', label: 'Viveros', model: 'productos', keywords: ['plantas', 'jardín'] }]);
  assert.equal(cat.resolve('vivero')?.key, 'viveros');
  assert.equal(cat.detect({ category: 'Vivero', name: 'Verde' })?.key, 'viveros');
  assert.equal(cat.detect({ category: undefined, name: 'Plantas del Sur' })?.key, 'viveros');
  assert.equal(cat.profileFor('viveros').booking, null, 'un rubro de productos no habla de turnos ni reservas');
});

// ------------------------------------------------------------------ API real con Google Maps simulado

let app: Awaited<ReturnType<typeof startApp>>;
let admin: Client;

async function search(rubro: string, cantidad: number) {
  await admin.post('/api/prospeccion/buscar', { rubro, zona: 'Quilmes', cantidad });
  for (let i = 0; i < 400; i++) {
    const { body } = await admin.get('/api/prospeccion/trabajo');
    if (body.job?.phase === 'terminado' && body.job.rubro === rubro) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`no terminó la búsqueda de ${rubro}`);
}

before(async () => {
  const maps = new FakeMaps({ barberías: barberias(), veterinarias: veterinarias(), 'pet shops': petShops() });
  app = await startApp({}, { generate: maps.generate, analyze: maps.analyze });
  admin = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván Bologna');
});
after(() => app.close());

test('Filtro dinámico: después de buscar veterinarias, "Veterinarias" aparece con su cantidad', async () => {
  let r = await admin.get('/api/rubros');
  assert.equal(r.body.items.find((x: any) => x.key === 'veterinarias').count, 0);
  await search('Veterinarias', 4);
  await search('Barberías', 3);
  r = await admin.get('/api/rubros');
  assert.equal(r.body.items.find((x: any) => x.key === 'veterinarias').count, 4);
  assert.equal(r.body.items.find((x: any) => x.key === 'barberias').count, 3);
  const list = await admin.get('/api/prospeccion/prospectos?rubro=veterinarias');
  assert.equal(list.body.total, 4);
  assert.ok(list.body.items.every((p: any) => p.rubroLabel === 'Veterinarias' && p.rubroSource === 'google' && p.rubroConfidence === 'alta'));
  assert.ok(list.body.items.every((p: any) => p.opportunities.length > 0), 'cada uno llega con sus oportunidades');
});

test('Siguiente prospecto respeta el rubro y ordena alta → media → baja', async () => {
  const q = await admin.get('/api/prospeccion/cola?rubro=veterinarias');
  assert.equal(q.body.items.length, 4);
  const all = (await admin.get('/api/prospeccion/prospectos?rubro=veterinarias')).body.items;
  const byId = new Map(all.map((p: any) => [p.id, p]));
  assert.ok(q.body.items.every((x: any) => (byId.get(x.id) as any).rubroKey === 'veterinarias'), 'nunca una barbería');
  const order = { alto: 0, medio: 1, bajo: 2 } as Record<string, number>;
  const lv = q.body.items.map((x: any) => order[(byId.get(x.id) as any).potentialLevel ?? 'bajo']);
  assert.deepEqual(lv, [...lv].sort((a, b) => a - b));
  // Contactado sale de la cola; el resto queda.
  await admin.post(`/api/prospeccion/${q.body.items[0].id}/resultado`, { estado: 'contactado' });
  assert.equal((await admin.get('/api/prospeccion/cola?rubro=veterinarias')).body.items.length, 3);
});

test('Agregar rubro: se guarda, no se duplica, aparece en los filtros y se puede asignar', async () => {
  const c = await admin.post('/api/rubros', { label: 'Ópticas', model: 'productos' });
  assert.equal(c.status, 200);
  assert.equal(c.body.key, 'opticas');
  assert.equal(c.body.created, false, '"Ópticas" ya es un rubro de fábrica: no se duplica');
  const v = await admin.post('/api/rubros', { label: 'viveros', model: 'productos', keywords: 'plantas, jardín' });
  assert.deepEqual([v.body.key, v.body.label, v.body.created], ['viveros', 'Viveros', true]);
  const again = await admin.post('/api/rubros', { label: 'Vivero', model: 'productos' });
  assert.deepEqual([again.body.key, again.body.created], ['viveros', false], 'singular/plural = el mismo');
  assert.equal((await admin.post('/api/rubros', { label: 'X', model: 'productos' })).status, 400);
  assert.equal((await admin.post('/api/rubros', { label: 'Algo raro', model: 'inventado' })).status, 400);
  const items = (await admin.get('/api/rubros')).body.items;
  assert.ok(items.some((x: any) => x.key === 'viveros' && x.custom && x.model === 'productos'));
  assert.ok((await admin.get('/api/prospeccion')).body.rubros.includes('Viveros'), 'aparece en el buscador');

  // Asignación manual: queda fija aunque se reanalice.
  const barber = (await admin.get('/api/prospeccion/prospectos?rubro=barberias')).body.items[0];
  const p = await admin.patch(`/api/prospects/${barber.id}`, { rubro: 'viveros' });
  assert.equal(p.status, 200);
  let list = (await admin.get('/api/prospeccion/prospectos?rubro=viveros')).body.items;
  assert.deepEqual(list.map((x: any) => [x.id, x.rubroSource]), [[barber.id, 'manual']]);
  assert.equal((await admin.get('/api/rubros')).body.items.find((x: any) => x.key === 'viveros').count, 1);
  const detail = app.repo.get(barber.id);
  app.repo.saveAnalysis(detail.analysis!, { rubroHint: 'Barberías' });
  list = (await admin.get('/api/prospeccion/prospectos?rubro=viveros')).body.items;
  assert.equal(list.length, 1, 'un reanálisis no pisa el rubro asignado a mano');
  assert.equal((await admin.patch(`/api/prospects/${barber.id}`, { rubro: 'no-existe' })).status, 400);
  // Sin rubro
  await admin.patch(`/api/prospects/${barber.id}`, { rubro: null });
  assert.equal((await admin.get('/api/prospeccion/prospectos?rubro=none')).body.total, 1);
  assert.equal((await admin.get('/api/rubros')).body.sinRubro, 1);
});

test('Estados simplificados: Sin respuesta y el filtro "Respondieron"', async () => {
  const items = (await admin.get('/api/prospeccion/prospectos?rubro=barberias')).body.items;
  await admin.patch(`/api/prospects/${items[0].id}`, { status: 'sin_respuesta' });
  await admin.patch(`/api/prospects/${items[1].id}`, { status: 'respondio' });
  assert.deepEqual((await admin.get('/api/prospeccion/prospectos?estado=sin_respuesta')).body.items.map((x: any) => x.id), [items[0].id]);
  assert.deepEqual((await admin.get('/api/prospeccion/prospectos?estado=respondieron')).body.items.map((x: any) => x.id), [items[1].id]);
});

test('Pet shops: oportunidades de catálogo, nunca turnos ni reservas', async () => {
  await search('Pet Shops', 3);
  const items = (await admin.get('/api/prospeccion/prospectos?rubro=pet-shops')).body.items;
  assert.equal(items.length, 3);
  for (const p of items) {
    assert.doesNotMatch(p.opportunities.join(' '), /turno|reserv/i);
    const card = (await admin.get(`/api/prospeccion/ficha/${p.id}`)).body;
    for (const t of Object.values(card.messages) as string[]) assert.doesNotMatch(t, /turno|reserv/i);
  }
});

// ------------------------------------------------------------------ preservación de datos

const prices: PriceList = {
  moneda: 'ARS', mesesContrato: 12,
  servicios: { 'maps-optimization': { pagoInicial: 100000, mensual: 10000 }, website: { pagoInicial: 300000, mensual: 20000 } },
};
const prof = (over: Partial<BusinessProfile>): BusinessProfile => ({
  sourceUrl: 'https://maps.app.goo.gl/x', name: 'X', category: 'Veterinario', additionalCategories: [], rating: 4.6, reviewCount: 168,
  address: 'Laprida 100, Quilmes', phone: '011 15 3100-5000', services: [], hasBooking: false, hasMenu: false, photoCount: 10,
  photoCountIsEstimate: false, photoUrls: [], posts: [], reviews: [{ rating: 2, ageDays: 40, hasOwnerResponse: false }],
  permanentlyClosed: false, socialLinks: [], scrapedAt: new Date().toISOString(), warnings: [], isClaimed: true, ...over,
});

test('Migración desde la versión anterior: conserva prospectos, estados, notas e historial y completa rubro/oportunidades/prioridad', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  const file = path.join(dir, 'crm.db');
  try {
    // 1) Una base "como la de antes" (versión 5) con datos reales de uso.
    let db = openDatabase(file);
    let repo = new CrmRepository(db, () => prices, () => {});
    const vet = repo.saveAnalysis(buildAnalysis('https://maps.app.goo.gl/vet', prof({ name: 'Veterinaria Laprida' }), undefined, { durationMs: 1 })).id;
    const otro = repo.saveAnalysis(buildAnalysis('https://maps.app.goo.gl/otro', prof({ name: 'Los Primos SRL', category: 'Empresa', address: 'Mitre 1', phone: '011 4222-0000' }), undefined, { durationMs: 1 })).id;
    repo.update(vet, { status: 'contactado', notes: 'Llamar el martes. Ñandú 🐾' });
    repo.addActivity(vet, 'nota', 'Le gustó la propuesta');
    repo.setSetting('sellerName', 'Iván');
    const before = repo.get(vet);
    db.exec(`DROP INDEX idx_prospects_rubro; DROP TABLE rubros;
      ALTER TABLE prospects DROP COLUMN rubro_key; ALTER TABLE prospects DROP COLUMN rubro_source; ALTER TABLE prospects DROP COLUMN rubro_confidence;
      ALTER TABLE prospects DROP COLUMN opps_json; ALTER TABLE prospects DROP COLUMN contact_json;
      UPDATE prospects SET potential_level = NULL, potential_reason = NULL; PRAGMA user_version = 5;`);
    db.close();

    // 2) Se abre con la versión nueva: migra y completa sin tocar lo demás.
    db = openDatabase(file);
    assert.equal(Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), SCHEMA_VERSION);
    repo = new CrmRepository(db, () => prices, () => {});
    const after = repo.get(vet);
    assert.equal(after.status, 'contactado');
    assert.equal(after.notes, 'Llamar el martes. Ñandú 🐾');
    assert.equal(after.name, before.name);
    assert.equal(after.reviewCount, 168);
    assert.ok(after.activities.some((a) => a.content === 'Le gustó la propuesta'), 'historial intacto');
    assert.equal(after.audits.length, before.audits.length);
    assert.equal(repo.getSetting('sellerName'), 'Iván');
    assert.deepEqual([after.rubroKey, after.rubroSource, after.rubroConfidence], ['veterinarias', 'google', 'alta']);
    assert.equal(after.potentialLevel, 'alto', '4,6 ⭐ y 168 reseñas sin web ni WhatsApp → prioridad alta');
    assert.ok(after.opportunities.length > 0);
    const o = repo.get(otro);
    assert.equal(o.rubroKey, null, 'si no se puede detectar, queda sin rubro (no se inventa)');
    assert.equal(repo.list().length, 2, 'no se borró ningún prospecto');

    // 3) Un rubro creado sobrevive al reinicio.
    repo.createRubro({ label: 'Viveros', model: 'productos' });
    db.close();
    db = openDatabase(file);
    repo = new CrmRepository(db, () => prices, () => {});
    assert.ok(repo.catalog().get('viveros'));
    assert.equal(repo.get(vet).status, 'contactado');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
