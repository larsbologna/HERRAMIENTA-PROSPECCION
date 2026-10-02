/**
 * Modo diagnóstico contra la ficha de Maps SIMULADA (test/fixtures/maps.html) y variantes
 * que reproducen los riesgos conocidos del scraper.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';
import { buildDiagnosticReport, runMapsDiagnostic, type DiagnosticReport } from '../src/diagnostics/mapsDiagnostic.js';
import { launchBrowser } from '../src/scraper/browser.js';
import type { BusinessProfile } from '../src/domain/types.js';
import type { RawOverview } from '../src/scraper/scripts/mapsScripts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let server: http.Server;
let base = '';
let browser: Browser;
let tmp = '';

/** Variante "riesgos": sin aria-label en la cantidad, dos Place ID y sin total de fotos. */
function riskyVariant(html: string): string {
  return html
    .replace('<span aria-label="23 reseñas">(23)</span>', '<span>(23)</span>')
    .replace('<button aria-label="Ver fotos (7)">Fotos</button>', '<button>Fotos</button>')
    .replace('ChIJTestPlaceId_1234567890abc</span>', 'ChIJOtroNegocioCercano_000000000</span><span style="display:none">ChIJTestPlaceId_1234567890abc</span>');
}

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'diag-'));
  server = http.createServer(async (req, res) => {
    let html = await fs.readFile(path.join(here, 'fixtures/maps.html'), 'utf8');
    html = html.replace('__SITE__', `${base}/site`);
    if (req.url?.includes('riesgos')) html = riskyVariant(html);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const field = (r: DiagnosticReport, clave: string) => {
  const f = r.campos.find((x) => x.clave === clave);
  assert.ok(f, `falta el campo ${clave}`);
  return f;
};

test('ficha normal: cada dato con valor, selector, confianza y fuente; sin discrepancias', { timeout: 90_000 }, async () => {
  const out = path.join(tmp, 'normal');
  const r = await runMapsDiagnostic(browser, `${base}/maps/place/lola`, { outDir: out });

  assert.equal(r.error, undefined);
  assert.deepEqual(r.resumen.discrepancias, [], 'la sonda debe reproducir exactamente al scraper');
  assert.ok(r.campos.length >= 20);
  for (const f of r.campos) {
    assert.ok('valor' in f && 'selector' in f && f.confianza && f.fuente.pestaña && f.fuente.estrategia, `campo incompleto: ${f.clave}`);
    assert.ok(f.intentos.length > 0, `sin intentos registrados: ${f.clave}`);
  }

  const address = field(r, 'address');
  assert.equal(address.valor, 'Calle Mayor 12, 28013 Madrid');
  assert.equal(address.selector, '[data-item-id="address"]');
  assert.equal(address.lectura, 'aria-label');
  assert.equal(address.confianza, 'alta');
  assert.match(address.fuente.html ?? '', /data-item-id="address"/);

  assert.equal(field(r, 'phone').valor, '+34911222333');
  assert.equal(field(r, 'phone').confianza, 'alta');
  assert.equal(field(r, 'reviewCount').valor, 23);
  assert.equal(field(r, 'reviewCount').fuente.estrategia, '1 de 3');
  assert.equal(field(r, 'placeId').confianza, 'alta');
  assert.equal(field(r, 'photoCount').valor, 7);
  assert.equal(field(r, 'photoCount').fuente.textoCoincidente, 'fotos (7)');

  // Riesgos conocidos señalados aunque el valor exista
  assert.equal(field(r, 'description').estado, 'REVISAR');
  assert.match(field(r, 'description').avisos.join(' '), /resumen editorial/);
  // Booleanos: "no reclamada" y "no cerrada" son resultados determinados, no "no encontrado"
  assert.equal(field(r, 'isClaimed').valor, false);
  assert.equal(field(r, 'isClaimed').estado, 'OK');
  assert.equal(field(r, 'isClaimed').fuente.textoCoincidente, '¿Es el propietari');
  assert.equal(field(r, 'permanentlyClosed').estado, 'OK');
  assert.equal(field(r, 'hasBooking').estado, 'NO ENCONTRADO');

  const reviews = field(r, 'reviews');
  assert.equal(reviews.valor, 4);
  assert.equal(reviews.estado, 'OK');
  assert.equal(r.reseñas?.subfields.estrellas?.attempts[0]?.aciertos, 4);

  // Archivos
  const json = JSON.parse(await fs.readFile(path.join(out, 'diagnostico.json'), 'utf8')) as DiagnosticReport;
  assert.equal(json.tipo, 'diagnostico-scraper-maps');
  assert.equal(json.campos.length, r.campos.length);
  for (const f of ['ficha', 'resenas', 'informacion']) await fs.access(path.join(out, 'html', `${f}.html`));
  assert.ok(r.archivos.capturas.length >= 3);
});

test('ficha con riesgos: los marca como REVISAR con el motivo', { timeout: 90_000 }, async () => {
  const r = await runMapsDiagnostic(browser, `${base}/maps/place/riesgos`, { outDir: path.join(tmp, 'riesgos') });
  assert.deepEqual(r.resumen.discrepancias, []);

  // Cantidad de reseñas leída del texto completo del bloque ("4,1(23)"): el valor se corrige
  // tomando el número entre paréntesis, pero el diagnóstico la marca para revisar por la fuente.
  const count = field(r, 'reviewCount');
  assert.equal(count.valor, 23);
  assert.equal(count.valorCrudo, '4,1(23)');
  assert.equal(count.fuente.estrategia, '2 de 3');
  assert.equal(count.estado, 'REVISAR');
  assert.match(count.motivoConfianza.join(' '), /texto completo del bloque/);

  // Dos Place ID en la página
  const pid = field(r, 'placeId');
  assert.equal(pid.valor, 'ChIJOtroNegocioCercano_000000000');
  assert.equal(pid.estado, 'REVISAR');
  assert.equal(pid.extra?.distintos, 2);
  assert.match(pid.avisos.join(' '), /otro negocio/);

  // Fotos: estimación por imágenes visibles
  const photos = field(r, 'photoCount');
  assert.equal(photos.estado, 'REVISAR');
  assert.match(photos.motivoConfianza.join(' '), /imágenes visibles/);
  assert.ok(r.resumen.revisar.includes('Cantidad de reseñas'));
});

test('detecta DISCREPANCIA si la sonda y el scraper no leen lo mismo', () => {
  const raw = { name: 'Nombre que leyó el scraper', category: '', ratingText: '', reviewsText: '', address: '', phone: '', website: '', plusCode: '',
    menuUrl: '', bookingUrl: '', bookingButton: false, orderUrl: '', hoursRows: [], hoursAria: '', description: '', unclaimed: false,
    claimedSignals: false, permanentlyClosed: false, photoUrls: [], photoCountText: '', posts: [], socialLinks: [], histogram: [], placeId: '', panelText: '' } satisfies RawOverview;
  const probe = { container: { selector: 'x' }, pageTitle: '', fields: {
    name: { attempts: [{ orden: 1, selector: 'h1.DUwDvf', lectura: 'innerText', confianzaBase: 'media' as const, coincidencias: 1, valor: 'Otro nombre' }], winner: 0, value: 'Otro nombre' },
  } };
  const profile = { name: 'Nombre que leyó el scraper', services: [], posts: [], reviews: [], socialLinks: [], warnings: [], photoCountIsEstimate: false, hasBooking: false, permanentlyClosed: false } as unknown as BusinessProfile;
  const r = buildDiagnosticReport('u', { consent: false, overview: { probe, raw, url: 'u', title: 't', blocked: false } }, profile, { durationMs: 0, chromium: '', files: { capturas: [], html: [] } });
  const name = field(r, 'name');
  assert.equal(name.estado, 'DISCREPANCIA');
  assert.equal(name.coherenteConScraper, false);
  assert.deepEqual(r.resumen.discrepancias, ['Nombre']);
});
