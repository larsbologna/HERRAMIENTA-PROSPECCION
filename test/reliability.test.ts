/**
 * CONFIABILIDAD DEL DATO contra fichas de Maps SIMULADAS con trampas reales:
 * reseñas con estadísticas del autor ("12 reseñas · 340 fotos"), reseñas que mencionan
 * "cerrado permanentemente", contador de reseñas ilegible, ficha sin reseñas, pestañas
 * que no abren y bloqueo de Google.
 *
 * Regla que se verifica: un problema solo se afirma (y genera argumento comercial) si
 * el dato en el que se apoya está verificado.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';
import { buildAnalysis } from '../src/analyzer.js';
import type { DataField } from '../src/domain/reliability.js';
import type { BusinessProfile } from '../src/domain/types.js';
import { launchBrowser } from '../src/scraper/browser.js';
import { scrapeMapsProfile } from '../src/scraper/mapsScraper.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let server: http.Server;
let base = '';
let browser: Browser;
let fixture = '';

/** Reseña de muestra para la descripción general (Maps muestra algunas con datos del autor). */
const TRAP_REVIEWS = `
  <div class="jftiEf" data-review-id="t1" aria-label="Carlos M.">
    <div class="RfnDt">Local Guide · 12 reseñas · 340 fotos</div>
    <span class="kvMYJc" role="img" aria-label="1 estrella"></span>
    <span class="wiI7pd">Pensé que estaba cerrado permanentemente, pero abrieron. 5 fotos subidas.</span>
    <div class="CDe7pd">Respuesta del propietario: gracias Carlos.</div>
  </div>`;

const VARIANTS: Record<string, (html: string) => string> = {
  normal: (h) => h,
  // Sin reseñas: Maps muestra "Sin reseñas" y no hay bloque de calificación.
  'sin-resenas': (h) => h
    .replace(/<div class="F7nice">[\s\S]*?<\/div>/, '<div class="skqShb"><span>Sin reseñas</span></div>')
    .replace(/<div class="jftiEf"[\s\S]*?<\/section>/, '</section>'),
  // Google cambió la clase del bloque de calificación: no se puede leer el contador.
  'contador-ilegible': (h) => h.replace('<div class="F7nice">', '<div class="X9nueva"><span>(reseñas)</span>').replace('aria-label="23 reseñas">(23)', 'aria-label="">'),
  // Reseñas en la descripción general con estadísticas del autor y textos engañosos; sin total de fotos.
  'resenas-trampa': (h) => h
    .replace('<button aria-label="Ver fotos (7)">Fotos</button>', '')
    .replace('<a href="https://business.google.com/create">¿Es el propietario de este negocio? Reclamar este negocio</a>', TRAP_REVIEWS),
  // Las pestañas no aparecen (la ficha cargó a medias).
  'sin-pestanas': (h) => h.replace(/<div role="tablist">[\s\S]*?<\/div>/, ''),
  // Google pide verificación.
  bloqueo: () => '<!doctype html><html><body><div role="main">Nuestros sistemas detectaron tráfico inusual. No soy un robot.</div></body></html>',
};

before(async () => {
  fixture = await fs.readFile(path.join(here, 'fixtures/maps.html'), 'utf8');
  server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '').split('/').pop() ?? 'normal');
    const html = (VARIANTS[name] ?? VARIANTS.normal!)(fixture).replace('__SITE__', `${base}/site`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  server.close();
});

async function scrape(variant: string): Promise<BusinessProfile> {
  const { profile } = await scrapeMapsProfile(browser, `${base}/maps/place/${variant}`, { maxReviews: 20 });
  assert.ok(profile.dataQuality, 'falta dataQuality');
  return profile;
}
const q = (p: BusinessProfile, f: DataField) => p.dataQuality!.fields[f];
/** Análisis sin web (para aislar las reglas de Maps y reputación). */
const audit = (p: BusinessProfile) => buildAnalysis('x', { ...p, website: undefined }, undefined, { durationMs: 0 });
const ids = (p: BusinessProfile) => audit(p).audit.findings.map((f) => f.id);

test('ficha normal: cada dato con valor, estado, confianza, fuente y método', { timeout: 90_000 }, async () => {
  const p = await scrape('normal');
  const dq = p.dataQuality!;
  assert.equal(dq.pageLoaded, true);
  assert.equal(dq.blocked, false);
  assert.equal(Object.keys(dq.fields).length, 19);
  for (const f of Object.values(dq.fields)) {
    assert.ok(f.label && f.status && f.value && f.confidence && f.source && f.method, `dato incompleto: ${f.field}`);
  }
  assert.deepEqual([q(p, 'reviewCount').status, q(p, 'reviewCount').confidence, q(p, 'reviewCount').value], ['encontrado', 'alta', '23 reseñas']);
  assert.match(q(p, 'reviewCount').method, /F7nice/);
  assert.equal(q(p, 'rating').confidence, 'alta');
  assert.equal(q(p, 'phone').confidence, 'alta');
  assert.deepEqual([q(p, 'photos').status, q(p, 'photos').value, q(p, 'photos').confidence], ['encontrado', '7 fotos', 'media']);
  // Única Place ID en la página → media; no reclamada por enlace → alta.
  assert.equal(q(p, 'placeId').confidence, 'media');
  assert.equal(p.placeId, 'ChIJTestPlaceId_1234567890abc');
  assert.deepEqual([q(p, 'claimed').value, q(p, 'claimed').confidence], ['No (Google ofrece reclamarla)', 'alta']);
  // El resumen de la ficha puede escribirlo Google: no se usa para decir que es "breve".
  assert.equal(q(p, 'description').confidence, 'baja');
  // Ficha recorrida completa sin sección Novedades → 0 publicaciones comprobado.
  assert.equal(q(p, 'posts').status, 'cero');
  assert.equal(q(p, 'reviewsSample').status, 'encontrado');
  assert.equal(q(p, 'reviewsRecency').status, 'encontrado');

  const a = audit(p);
  const found = a.audit.findings.map((f) => f.id);
  assert.ok(found.includes('maps-few-photos') && found.includes('rep-few-reviews') && found.includes('maps-unclaimed'));
  assert.ok(!found.includes('maps-poor-description'), 'no debe afirmar descripción breve con un dato no verificado');
  assert.ok(a.audit.unverified?.some((u) => u.findingId === 'maps-poor-description' && u.fields.includes('description')));
  // Cada argumento lleva el dato que lo respalda.
  const arg = a.proposal.salesArguments.find((x) => x.findingId === 'rep-few-reviews');
  assert.deepEqual(arg?.basis?.map((b) => [b.field, b.value, b.confidence]), [['reviewCount', '23 reseñas', 'alta']]);
  for (const s of a.proposal.salesArguments) {
    for (const b of s.basis ?? []) assert.notEqual(b.confidence, 'baja', `${s.findingId} se apoya en un dato de confianza baja`);
  }
});

test('ficha sin reseñas: valor real 0 (no "dato no encontrado")', { timeout: 90_000 }, async () => {
  const p = await scrape('sin-resenas');
  assert.deepEqual([q(p, 'reviewCount').status, q(p, 'reviewCount').confidence, q(p, 'reviewCount').value], ['cero', 'alta', '0 reseñas']);
  assert.equal(p.reviewCount, 0);
  assert.equal(q(p, 'rating').status, 'cero');
  assert.equal(q(p, 'reviewsSample').status, 'cero');
  const found = ids(p);
  assert.ok(found.includes('rep-very-few-reviews'), 'con 0 reseñas comprobadas sí se argumenta');
  assert.ok(!found.includes('rep-no-responses') && !found.includes('rep-stale-reviews'));
});

test('contador de reseñas ilegible: NO se dice "0 reseñas"', { timeout: 90_000 }, async () => {
  const p = await scrape('contador-ilegible');
  assert.equal(p.reviewCount, undefined);
  assert.equal(q(p, 'reviewCount').status, 'no_encontrado');
  const a = audit(p);
  const found = a.audit.findings.map((f) => f.id);
  assert.ok(!found.some((id) => /^rep-(very-few|few|moderate)-reviews$/.test(id)), found.join(', '));
  assert.ok(!a.audit.qr.reasons.some((r) => /Solo 0 reseñas/.test(r)), 'el QR no debe argumentar con 0 reseñas inventadas');
  // Los argumentos no mencionan una cantidad de reseñas.
  assert.ok(!a.proposal.salesArguments.some((s) => /\(0\)|0 reseñas/.test(s.problem)));
});

test('reseñas trampa: estadísticas del autor y textos de reseñas no se toman como datos de la ficha', { timeout: 90_000 }, async () => {
  const p = await scrape('resenas-trampa');
  // "Local Guide · 12 reseñas · 340 fotos" es del autor, no de la ficha.
  assert.notEqual(p.photoCount, 340);
  assert.equal(q(p, 'photos').status, 'no_encontrado');
  assert.equal(p.reviewCount, 23);
  // "Pensé que estaba cerrado permanentemente" está en una reseña.
  assert.equal(p.permanentlyClosed, false);
  // Una respuesta del propietario NO es una publicación de Novedades.
  assert.equal(p.posts.length, 0);
  // Sí demuestra que la ficha está reclamada.
  assert.equal(p.isClaimed, true);
  assert.equal(q(p, 'claimed').confidence, 'alta');
  const found = ids(p);
  assert.ok(!found.includes('maps-few-photos') && !found.includes('maps-low-photos'), 'sin total de fotos no se afirma que tenga pocas');
  assert.ok(!found.includes('maps-closed') && !found.includes('maps-unclaimed'));
});

test('pestañas que no abren: no se afirma nada que dependa de ellas', { timeout: 90_000 }, async () => {
  const p = await scrape('sin-pestanas');
  assert.equal(q(p, 'reviewsSample').status, 'no_encontrado');
  assert.equal(q(p, 'reviewsRecency').status, 'no_encontrado');
  assert.equal(q(p, 'attributes').status, 'no_encontrado');
  const a = audit(p);
  const found = a.audit.findings.map((f) => f.id);
  for (const id of ['rep-no-responses', 'rep-low-responses', 'rep-negative-unanswered', 'rep-stale-reviews', 'rep-low-frequency', 'maps-few-attributes']) {
    assert.ok(!found.includes(id), `no debería afirmar ${id}`);
  }
  assert.ok(a.audit.unverified?.some((u) => u.findingId === 'maps-few-attributes'));
  assert.equal(a.audit.metrics.ownerResponseRate, undefined);
  // Lo que sí se leyó de la ficha se sigue usando.
  assert.ok(found.includes('rep-few-reviews'));
});

test('bloqueo de Google: todos los datos en error y el análisis no inventa problemas', { timeout: 90_000 }, async () => {
  const p = await scrape('bloqueo');
  assert.equal(p.dataQuality!.blocked, true);
  assert.ok(Object.values(p.dataQuality!.fields).every((f) => f.status === 'error'));
  const a = audit(p);
  assert.deepEqual(a.audit.findings, []);
  assert.deepEqual(a.proposal.salesArguments, []);
});

test('análisis guardados sin dataQuality conservan el comportamiento anterior', async () => {
  const { dataQuality: _omit, ...legacy } = await scrape('normal');
  const a = buildAnalysis('x', legacy as BusinessProfile, undefined, { durationMs: 0 });
  assert.equal(a.audit.unverified, undefined);
  assert.ok(a.audit.findings.some((f) => f.id === 'maps-poor-description'));
});
