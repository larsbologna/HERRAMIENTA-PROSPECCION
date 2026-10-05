/**
 * GENERADOR DE PROSPECTOS: deduplicación, score, persistencia, búsqueda hasta agotar resultados
 * e integración con el analizador existente. La parte con navegador usa un Google Maps simulado
 * (test/fixtures/mapsSearch.ts) con carga progresiva, duplicados, fuera de zona y cerrados.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Browser } from 'playwright';
import { analyze } from '../src/analyzer.js';
import { CrmRepository } from '../src/crm/repository.js';
import { openDatabase } from '../src/db/database.js';
import { addressKey, duplicateReason, keysFor, mapsUrlIds, SeenIndex, websiteKey } from '../src/generator/dedupe.js';
import { generateProspects, inZone, searchQueries, singular, type GenerateResult } from '../src/generator/generator.js';
import { GeneratorRepository } from '../src/generator/repository.js';
import { opportunityScore, SCORE_WEIGHTS } from '../src/generator/score.js';
import { loadPriceList } from '../src/proposal/budget.js';
import { launchBrowser } from '../src/scraper/browser.js';
import { barberiasQuilmes, placePage, placeUrl, searchPage } from './fixtures/mapsSearch.js';

// ===================================================================== deduplicación

describe('deduplicación conservadora', () => {
  const k = keysFor;
  test('Place ID, ficha de Maps y URL', () => {
    assert.equal(duplicateReason(k({ placeId: 'ChIJaaaaaaaaaaaaaaaaaaaaaa' }), k({ placeId: 'ChIJaaaaaaaaaaaaaaaaaaaaaa' })), 'mismo Place ID');
    const url = 'https://www.google.com/maps/place/X/data=!4m7!3m6!1s0x95a3:0xabc!8m2!3d1!4d2!16s%2Fg%2F11abc!19sChIJbbbbbbbbbbbbbbbbbbbbbb';
    assert.deepEqual(mapsUrlIds(url), { placeId: 'ChIJbbbbbbbbbbbbbbbbbbbbbb', featureId: '0x95a3:0xabc', urlKey: '/g/11abc' });
    assert.equal(duplicateReason(k({ mapsUrl: url }), k({ placeId: 'ChIJbbbbbbbbbbbbbbbbbbbbbb' })), 'mismo Place ID');
    assert.equal(duplicateReason(k({ mapsUrl: url.replace('!19sChIJbbbbbbbbbbbbbbbbbbbbbb', '') }), k({ mapsUrl: url.replace(/!19s.*/, '') })), 'misma ficha de Google Maps');
  });

  test('fichas duplicadas del mismo negocio (otro Place ID): teléfono, web o nombre + dirección', () => {
    const a = k({ placeId: 'ChIJ1111111111111111111111', name: 'Barbería El Faro', phone: '+54 11 4253-1234' });
    const b = k({ placeId: 'ChIJ2222222222222222222222', name: 'El Faro Barber', phone: '011 4253-1234' });
    assert.equal(duplicateReason(a, b), 'mismo teléfono');
    assert.equal(duplicateReason(k({ website: 'https://www.elfaro.com.ar/turnos' }), k({ website: 'http://elfaro.com.ar' })), 'mismo sitio web');
    assert.equal(
      duplicateReason(
        k({ name: 'Barbería Don Pepe S.R.L.', address: 'Av. Calchaquí 1234, B1878 Quilmes, Provincia de Buenos Aires' }),
        k({ name: 'Barbería Don Pepe', address: 'Avenida Calchaqui 1234, Quilmes, Argentina' }),
      ),
      'mismo nombre y dirección',
    );
    assert.equal(duplicateReason(k({ name: 'Corte Fino' }), k({ name: 'Corte Fino', address: 'Mitre 55, Quilmes' })), 'mismo nombre (una ficha sin dirección)');
  });

  test('sucursales reales (otra dirección y otro teléfono) son negocios distintos; redes sociales no se comparan por dominio', () => {
    const a = k({ name: 'Barbería Norte', address: 'Rivadavia 100, Quilmes', phone: '1155550001' });
    const b = k({ name: 'Barbería Norte', address: 'Mitre 900, Quilmes', phone: '1155550002' });
    assert.equal(duplicateReason(a, b), undefined);
    assert.equal(websiteKey('https://instagram.com/barberia.norte'), 'instagram.com/barberia.norte');
    assert.equal(duplicateReason(k({ website: 'https://instagram.com/uno' }), k({ website: 'https://instagram.com/otro' })), undefined);
    assert.equal(addressKey('Mitre 123 esq. Rivadavia, B1878 Quilmes'), 'mitre 123');
  });

  test('índice de vistos', () => {
    const idx = new SeenIndex([k({ placeId: 'ChIJ3333333333333333333333' }), k({ name: 'Peluquería Lola', address: 'Calle 1 100, Quilmes' })]);
    assert.equal(idx.match(k({ placeId: 'ChIJ3333333333333333333333' })), 'mismo Place ID');
    assert.equal(idx.match(k({ name: 'Peluqueria  LOLA', address: 'Calle 1 100, B1878 Quilmes' })), 'mismo nombre y dirección');
    assert.equal(idx.match(k({ name: 'Otra', address: 'Calle 2 200' })), undefined);
  });
});

// ===================================================================== score

describe('score de oportunidad', () => {
  test('suma los puntos de cada carencia verificada y ordena los motivos', () => {
    const all = opportunityScore(
      { hasWebsite: false, hasWhatsApp: false, hasBooking: false, claimed: false, hoursDays: 3, hasPosts: false, hasPhone: false, reviewCount: 5, rating: 3.5 },
      { bookingRelevant: true },
    );
    assert.equal(all.score, 100);
    assert.equal(all.points, all.maxPoints);
    assert.deepEqual(all.reasons.slice(0, 3).map((r) => r.points), [SCORE_WEIGHTS.noWebsite, SCORE_WEIGHTS.unclaimed, SCORE_WEIGHTS.noWhatsApp]);
    const none = opportunityScore({ hasWebsite: true, hasWhatsApp: true, hasBooking: true, claimed: true, hoursDays: 7, hasPosts: true, hasPhone: true, reviewCount: 300, rating: 4.8 }, { bookingRelevant: true });
    assert.equal(none.score, 0);
    assert.deepEqual(none.reasons, []);
  });

  test('lo que no se pudo verificar no suma (no se inventan carencias)', () => {
    const s = opportunityScore({ hasWebsite: true, hasWhatsApp: undefined, claimed: undefined, hasPhone: true }, { bookingRelevant: false });
    assert.equal(s.points, 0);
    assert.ok(s.unverified.some((u) => /WhatsApp/.test(u)) && s.unverified.includes('Ficha reclamada'));
    const web = opportunityScore({ hasWebsite: false }, { bookingRelevant: false });
    assert.deepEqual(web.reasons.map((r) => [r.id, r.points]), [['no-website', 30]]);
  });
});

describe('búsqueda: variantes y zona', () => {
  test('variantes de consulta y singular', () => {
    assert.equal(singular('Barberías'), 'Barbería');
    assert.equal(singular('restaurantes'), 'restaurante');
    assert.equal(singular('bares'), 'bar');
    assert.equal(singular('kioscos'), 'kiosco');
    assert.deepEqual(searchQueries('Barberías', 'Quilmes'), ['Barberías en Quilmes', 'Barbería en Quilmes', 'Barberías Quilmes', 'Barbería cerca de Quilmes']);
  });
  test('zona', () => {
    assert.ok(inZone('Av. Calchaquí 1234, B1878 Quilmes, Provincia de Buenos Aires', 'Quilmes'));
    assert.ok(inZone('Belgrano 50, Bernal Oeste', 'bernal'));
    assert.ok(!inZone('Calle 14 500, Berazategui', 'Quilmes'));
    assert.ok(!inZone(undefined, 'Quilmes'));
  });
});

// ===================================================================== con navegador (Google Maps simulado)

const { P, FEEDS, VALID } = barberiasQuilmes();

let server: http.Server;
let base = '';
let browser: Browser;
let tmp = '';

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gen-'));
  server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]!);
    const send = (html: string) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    const search = url.match(/^\/maps\/search\/(.+)$/);
    if (search) return send(searchPage((FEEDS[search[1]!] ?? []).map((s) => ({ place: P[s]!, url: placeUrl(base, P[s]!) }))));
    const pl = url.match(/^\/maps\/place\/([^/]+)/);
    if (pl && P[pl[1]!]) return send(placePage(P[pl[1]!]!, base));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
});

const searchUrl = (q: string) => `${base}/maps/search/${encodeURIComponent(q)}`;
const slugOf = (url: string) => url.match(/\/maps\/place\/([^/]+)/)?.[1];

async function runAndSave(gen: GeneratorRepository, cantidad: number, userId: string | null = null): Promise<GenerateResult & { saved: string[] }> {
  const runId = gen.startRun({ rubro: 'Barberías', zona: 'Quilmes', requested: cantidad, userId });
  const result = await generateProspects({ rubro: 'Barberías', zona: 'Quilmes', cantidad }, { known: gen.knownKeys(), browser, searchUrl });
  const saved = gen.saveRun(runId, { rubro: 'Barberías', zona: 'Quilmes', userId }, result);
  return { ...result, saved: saved.map((s) => slugOf(s.mapsUrl)!) };
}

test('genera hasta la cantidad pedida, sin repetir, y sigue al día siguiente con los que faltan (persistente)', { timeout: 300_000 }, async () => {
  const file = path.join(tmp, 'prospeccion.db');

  // "Hoy": 5 prospectos.
  const gen1 = new GeneratorRepository(openDatabase(file));
  const r1 = await runAndSave(gen1, 5);
  assert.equal(r1.items.length, 5, r1.message);
  assert.equal(r1.exhausted, false);
  assert.equal(r1.message, 'Se encontraron 5 prospectos nuevos.');
  assert.deepEqual([...r1.items].map((i) => i.score), [...r1.items].map((i) => i.score).sort((a, b) => b - a), 'ordenados por oportunidad');

  // "Mañana" (nueva sesión: se reabre la base): pide 20, solo quedan 8 nuevos.
  const gen2 = new GeneratorRepository(openDatabase(file));
  const r2 = await runAndSave(gen2, 20);
  const all = [...r1.saved, ...r2.saved];
  assert.equal(new Set(all).size, all.length, 'ningún negocio se entrega dos veces');
  assert.deepEqual([...all].sort(), [...VALID].sort(), `entregados: ${all.join(', ')}`);
  assert.equal(r2.items.length, 8);
  assert.equal(r2.exhausted, true);
  assert.equal(r2.message, 'Se encontraron 8 prospectos nuevos. No quedan más negocios sin analizar para este rubro y ubicación.');
  // Nunca se entregan: ficha duplicada (d2), fuera de zona (oz), cerrado (cl), mismo negocio escrito distinto (n3).
  for (const s of ['d2', 'oz', 'cl', 'n3']) assert.ok(!all.includes(s), `no debería entregarse ${s}`);
  assert.ok(r2.stats.duplicates >= 3 && r2.stats.outOfZone === 1 && r2.stats.closed === 1, JSON.stringify(r2.stats));
  assert.ok(r2.stats.queries.length === 4, 'exploró todas las variantes de búsqueda');
  assert.deepEqual(r2.items.map((i) => i.score), r2.items.map((i) => i.score).sort((a, b) => b - a));

  // Tercera vez: no queda nada. No se inventa ni se repite.
  const r3 = await runAndSave(new GeneratorRepository(openDatabase(file)), 3);
  assert.equal(r3.items.length, 0);
  assert.equal(r3.message, 'No se encontraron prospectos nuevos. No quedan más negocios sin analizar para este rubro y ubicación.');

  // Score con datos reales de la ficha: Corte Fino (sin web, sin reclamar, sin horarios, sin publicaciones, pocas reseñas).
  const db = openDatabase(file);
  const gen = new GeneratorRepository(db);
  const corte = gen.list({ q: 'Corte Fino' })[0]!;
  assert.deepEqual(corte.reasons.map((r) => r.id).sort(), ['few-reviews', 'hours', 'low-rating', 'no-booking', 'no-posts', 'no-website', 'no-whatsapp', 'unclaimed'].sort());
  const norte = gen.list().find((i) => i.name === 'Barbería Norte' && i.website);
  assert.ok(norte && norte.score < corte.score, 'una barbería con web y ficha completa tiene menos oportunidad');
  assert.ok(norte.unverified.some((u) => /WhatsApp/.test(u)), 'con web, el WhatsApp queda sin verificar (no suma)');
  assert.equal(gen.list().length, 13);
  assert.equal(gen.list()[0]!.score, Math.max(...gen.list().map((i) => i.score)));
});

test('seguimiento comercial y estadísticas persistentes', () => {
  const db = openDatabase(path.join(tmp, 'prospeccion.db'));
  const gen = new GeneratorRepository(db);
  const [a, b, c, d] = gen.list();
  gen.setStatus(a!.id, 'contactado');
  gen.setStatus(b!.id, 'interesado');
  gen.setStatus(c!.id, 'propuesta');
  gen.setStatus(c!.id, 'ganado');
  gen.setStatus(d!.id, 'contactado');
  gen.setStatus(d!.id, 'perdido');
  assert.throws(() => gen.setStatus(a!.id, 'inventado'), /Estado inválido/);
  const s = new GeneratorRepository(openDatabase(path.join(tmp, 'prospeccion.db'))).stats();
  assert.deepEqual(s, { found: 13, pending: 9, contacted: 4, interested: 2, proposals: 1, won: 1, lost: 1, closeRate: 25 });
  assert.equal(gen.list({ status: 'pendientes' }).length, 9);
  assert.equal(gen.runs().length, 3);
});

test('integración con el analizador existente: el prospecto generado se analiza y se vincula al CRM', { timeout: 120_000 }, async () => {
  const db = openDatabase(path.join(tmp, 'prospeccion.db'));
  const gen = new GeneratorRepository(db);
  const crm = new CrmRepository(db, () => loadPriceList(), () => {});
  const target = gen.list({ q: 'Corte Fino' })[0]!;
  // Mismo flujo que el botón "Analizar": la URL de Maps del prospecto va al análisis completo existente.
  const result = await analyze(target.mapsUrl, { skipUrlValidation: true });
  assert.equal(result.profile.name, 'Corte Fino');
  assert.ok(result.proposal.salesArguments.some((a) => a.findingId === 'web-none'), 'informe comercial existente con sus argumentos');
  const saved = crm.saveAnalysis(result);
  const linked = gen.linkProspect(target.id, saved.id);
  assert.equal(linked.prospectId, saved.id);
  assert.throws(() => gen.linkProspect(target.id, 'no-existe'), /no existe/);
  // Lo analizado a mano (CRM) también cuenta como conocido.
  const known = new SeenIndex(gen.knownKeys());
  assert.ok(known.match(keysFor({ name: 'Corte Fino', address: 'Mitre 200, Quilmes' })));
});
