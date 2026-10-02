import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { config } from '../config/index.js';
import type { BusinessProfile } from '../domain/types.js';
import { scrapeMapsProfile } from '../scraper/mapsScraper.js';
import type { RawOverview, RawReview } from '../scraper/scripts/mapsScripts.js';
import {
  PROBE_ABOUT,
  PROBE_OVERVIEW,
  PROBE_REVIEWS,
  type AboutProbe,
  type BaseConfidence,
  type OverviewProbe,
  type ProbeAttempt,
  type ProbeField,
  type ReviewsProbe,
} from './probeScripts.js';

/**
 * MODO DIAGNÓSTICO del scraper de Google Maps.
 *
 * Ejecuta el scraper REAL (mismo recorrido, mismas pestañas) y, en cada paso, inspecciona la
 * página para documentar de dónde salió cada dato. No cambia lo que extrae el scraper.
 */

export type Confidence = 'alta' | 'media' | 'baja' | 'ninguna';
export type FieldStatus = 'OK' | 'REVISAR' | 'NO ENCONTRADO' | 'DISCREPANCIA';

export interface FieldDiagnostic {
  campo: string;
  clave: string;
  estado: FieldStatus;
  /** Valor final que usa la herramienta (ya normalizado). */
  valor: unknown;
  /** Texto/atributo tal como se leyó de la página. */
  valorCrudo: unknown;
  selector: string | null;
  lectura: string | null;
  confianza: Confidence;
  motivoConfianza: string[];
  fuente: {
    pestaña: string;
    contenedor: string;
    estrategia: string;
    html?: string;
    textoCoincidente?: string;
  };
  /** true si la sonda reproduce exactamente el valor crudo que obtuvo el scraper. */
  coherenteConScraper: boolean;
  intentos: ProbeAttempt[];
  avisos: string[];
  extra?: Record<string, unknown>;
}

export interface DiagnosticReport {
  tipo: 'diagnostico-scraper-maps';
  version: 1;
  generadoEn: string;
  duracionMs: number;
  entorno: { playwright: string; chromium: string; idioma: string; headless: boolean; node: string };
  pagina: { urlEntrada: string; urlFinal?: string; titulo?: string; bloqueoDetectado: boolean; consentimiento: boolean };
  resumen: {
    campos: number;
    porConfianza: Record<Confidence, number>;
    porEstado: Record<FieldStatus, number>;
    discrepancias: string[];
    revisar: string[];
  };
  campos: FieldDiagnostic[];
  reseñas?: ReviewsProbe & { muestraScraper: number };
  informacion?: AboutProbe & { itemsScraper: number };
  avisosDelScraper: string[];
  archivos: { capturas: string[]; html: string[] };
  error?: string;
  /** Perfil normalizado completo, tal como lo usaría el resto de la herramienta. */
  perfil?: BusinessProfile;
}

const RANK: Record<Confidence, number> = { ninguna: 0, baja: 1, media: 2, alta: 3 };
const lower = (a: Confidence, b: Confidence): Confidence => (RANK[a] <= RANK[b] ? a : b);
const norm = (v: unknown): unknown => (v === null || v === undefined ? '' : v);

const TAB_OVERVIEW = 'Descripción general';
const TAB_REVIEWS = 'Reseñas';
const TAB_ABOUT = 'Información';

export interface DiagnosticCapture {
  overview?: { probe: OverviewProbe; raw: RawOverview; url: string; title: string; blocked: boolean };
  reviews?: { probe: ReviewsProbe; raw: RawReview[] };
  about?: { probe: AboutProbe; raw: { items: string[]; description: string } };
  consent: boolean;
}

export interface DiagnoseOptions {
  outDir: string;
  onProgress?: (msg: string) => void;
}

export async function runMapsDiagnostic(browser: Browser, url: string, opts: DiagnoseOptions): Promise<DiagnosticReport> {
  const started = Date.now();
  const captured: DiagnosticCapture = { consent: false };
  const htmlFiles: string[] = [];
  const shotsDir = path.join(opts.outDir, 'screenshots');
  const htmlDir = path.join(opts.outDir, 'html');
  await fs.mkdir(shotsDir, { recursive: true });
  await fs.mkdir(htmlDir, { recursive: true });

  const snapshot = async (page: Page, name: string) => {
    const file = path.join('html', `${name}.html`);
    await fs.writeFile(path.join(opts.outDir, file), await page.content(), 'utf8');
    htmlFiles.push(file);
  };

  let profile: BusinessProfile | undefined;
  let error: string | undefined;
  const screenshots: string[] = [];
  try {
    const result = await scrapeMapsProfile(browser, url, {
      screenshotDir: shotsDir,
      onProgress: (m) => {
        if (/cookies/i.test(m)) captured.consent = true;
        opts.onProgress?.(m);
      },
      onScreenshot: (s) => screenshots.push(s.file),
      inspect: {
        overview: async (page, raw) => {
          const probe = (await page.evaluate(PROBE_OVERVIEW)) as OverviewProbe;
          const pageUrl = page.url();
          const title = await page.title();
          const blocked = /\/sorry\/|consent\.google\./.test(pageUrl) || /tráfico inusual|unusual traffic|no soy un robot|not a robot/i.test(raw.panelText);
          captured.overview = { probe, raw, url: pageUrl, title, blocked };
          await snapshot(page, 'ficha');
        },
        reviews: async (page, raw) => {
          captured.reviews = { probe: (await page.evaluate(PROBE_REVIEWS)) as ReviewsProbe, raw };
          await snapshot(page, 'resenas');
        },
        about: async (page, raw) => {
          captured.about = { probe: (await page.evaluate(PROBE_ABOUT)) as AboutProbe, raw };
          await snapshot(page, 'informacion');
        },
      },
    });
    profile = result.profile;
  } catch (err) {
    error = (err as Error).message.split('\n')[0];
  }

  const report = buildDiagnosticReport(url, captured, profile, {
    durationMs: Date.now() - started,
    chromium: browser.version(),
    files: { capturas: screenshots, html: htmlFiles },
    error,
  });
  await fs.writeFile(path.join(opts.outDir, 'diagnostico.json'), JSON.stringify(report, null, 2), 'utf8');
  return report;
}

function playwrightVersion(): string {
  try {
    return (createRequire(import.meta.url)('playwright/package.json') as { version: string }).version;
  } catch {
    return 'desconocida';
  }
}

/** Construye el informe de diagnóstico. Función pura (se testea con la ficha simulada). */
export function buildDiagnosticReport(
  url: string,
  c: DiagnosticCapture,
  profile: BusinessProfile | undefined,
  meta: { durationMs: number; chromium: string; files: DiagnosticReport['archivos']; error?: string },
): DiagnosticReport {
  const campos: FieldDiagnostic[] = [];
  const ov = c.overview;
  if (ov && profile) campos.push(...overviewFields(ov.probe, ov.raw, profile, c));
  if (profile) campos.push(...reviewsAndAboutFields(c, profile));

  const porConfianza: Record<Confidence, number> = { alta: 0, media: 0, baja: 0, ninguna: 0 };
  const porEstado: Record<FieldStatus, number> = { OK: 0, REVISAR: 0, 'NO ENCONTRADO': 0, DISCREPANCIA: 0 };
  for (const f of campos) {
    porConfianza[f.confianza]++;
    porEstado[f.estado]++;
  }

  return {
    tipo: 'diagnostico-scraper-maps',
    version: 1,
    generadoEn: new Date().toISOString(),
    duracionMs: meta.durationMs,
    entorno: {
      playwright: playwrightVersion(),
      chromium: meta.chromium,
      idioma: config.browser.mapsLanguage,
      headless: config.browser.headless,
      node: process.version,
    },
    pagina: {
      urlEntrada: url,
      urlFinal: ov?.url,
      titulo: ov?.title,
      bloqueoDetectado: ov?.blocked ?? false,
      consentimiento: c.consent,
    },
    resumen: {
      campos: campos.length,
      porConfianza,
      porEstado,
      discrepancias: campos.filter((f) => f.estado === 'DISCREPANCIA').map((f) => f.campo),
      revisar: campos.filter((f) => f.estado === 'REVISAR').map((f) => f.campo),
    },
    campos,
    reseñas: c.reviews ? { ...c.reviews.probe, muestraScraper: c.reviews.raw.length } : undefined,
    informacion: c.about ? { ...c.about.probe, itemsScraper: c.about.raw.items.length } : undefined,
    avisosDelScraper: profile?.warnings ?? [],
    archivos: meta.files,
    error: meta.error,
    perfil: profile,
  };
}

// ---------------------------------------------------------------------------------------------

interface FieldSpec {
  campo: string;
  clave: string;
  probe: ProbeField | undefined;
  /** Valor crudo que obtuvo el scraper real, para comprobar coherencia. */
  scraperRaw: unknown;
  /** Valor normalizado final. */
  valor: unknown;
  pestaña: string;
  contenedor: string;
  /** Ajustes de confianza específicos del campo. */
  checks?: (f: FieldDiagnostic) => void;
  /**
   * Si el dato quedó determinado. Por defecto: hay estrategia ganadora y valor no vacío.
   * Para booleanos, "false" también es un resultado válido.
   */
  found?: boolean;
  /** Explicación cuando el resultado se deduce de la AUSENCIA de un texto (p. ej. "no está cerrado"). */
  absentNote?: string;
  /** Campo de lista: todas las coincidencias se usan (no solo la primera). */
  multi?: boolean;
}

function makeField(spec: FieldSpec): FieldDiagnostic {
  const p = spec.probe ?? { attempts: [], winner: -1, value: '' };
  const w = p.winner >= 0 ? p.attempts[p.winner] : undefined;
  const found = spec.found ?? (!!w && spec.valor !== undefined && spec.valor !== '' && spec.valor !== null && spec.valor !== false && spec.valor !== 0);
  // Sin sonda para el campo no hay con qué comparar: no se informa como discrepancia.
  const coherent = !spec.probe || JSON.stringify(norm(p.value)) === JSON.stringify(norm(spec.scraperRaw));

  const f: FieldDiagnostic = {
    campo: spec.campo,
    clave: spec.clave,
    estado: 'OK',
    valor: spec.valor ?? null,
    valorCrudo: norm(p.value),
    selector: w?.selector ?? null,
    lectura: w?.lectura ?? null,
    confianza: found ? (w ? w.confianzaBase : 'media') : 'ninguna',
    motivoConfianza: [],
    fuente: {
      pestaña: spec.pestaña,
      contenedor: spec.contenedor,
      estrategia: w ? `${w.orden} de ${p.attempts.length}` : `ninguna de ${p.attempts.length}`,
      html: w?.html,
      textoCoincidente: w?.textoCoincidente,
    },
    coherenteConScraper: coherent,
    intentos: p.attempts,
    avisos: [],
    extra: p.extra,
  };
  if (w && found) {
    f.motivoConfianza.push(`Estrategia ${w.orden}/${p.attempts.length}: ${w.nota ?? w.selector} (confianza base ${w.confianzaBase}).`);
    if (w.orden > 1) f.motivoConfianza.push('Fallaron las estrategias anteriores de la cadena.');
    if (w.coincidencias > 1 && !spec.multi) f.avisos.push(`El selector coincide con ${w.coincidencias} elementos; se usó el primero.`);
  } else if (found) {
    f.motivoConfianza.push(spec.absentNote ?? 'Resultado deducido por ausencia de coincidencias.');
  } else {
    f.motivoConfianza.push('Ninguna estrategia encontró el dato (puede no existir en la ficha o el selector puede estar roto).');
  }
  if (!spec.probe) f.avisos.push('Sin datos de la sonda para este campo: no se pudo verificar el origen.');
  spec.checks?.(f);
  if (!coherent) {
    f.confianza = lower(f.confianza, 'baja');
    f.avisos.push(`DISCREPANCIA: la sonda leyó ${JSON.stringify(norm(p.value))} y el scraper ${JSON.stringify(norm(spec.scraperRaw))}. Revisar que probeScripts.ts refleje mapsScripts.ts.`);
  }
  return settle(f);
}

/** Estado final a partir de la coherencia y la confianza (se recalcula tras cada ajuste). */
function settle(f: FieldDiagnostic): FieldDiagnostic {
  f.estado = !f.coherenteConScraper ? 'DISCREPANCIA' : f.confianza === 'ninguna' ? 'NO ENCONTRADO' : f.confianza === 'baja' ? 'REVISAR' : 'OK';
  return f;
}

const downgrade = (f: FieldDiagnostic, to: Confidence, reason: string) => {
  if (RANK[f.confianza] > RANK[to]) f.confianza = to;
  f.motivoConfianza.push(reason);
};
const upgrade = (f: FieldDiagnostic, to: Confidence, reason: string) => {
  if (f.confianza !== 'ninguna' && RANK[f.confianza] < RANK[to]) f.confianza = to;
  f.motivoConfianza.push(reason);
};

function overviewFields(probe: OverviewProbe, raw: RawOverview, p: BusinessProfile, c: DiagnosticCapture): FieldDiagnostic[] {
  const F = probe.fields;
  const base = { pestaña: TAB_OVERVIEW, contenedor: probe.container.selector };
  const histogramTotal = p.ratingHistogram ? Object.values(p.ratingHistogram).reduce((a, b) => a + b, 0) : undefined;
  const out: FieldDiagnostic[] = [];

  out.push(makeField({ ...base, campo: 'Nombre', clave: 'name', probe: F.name, scraperRaw: raw.name, valor: p.name }));
  out.push(makeField({ ...base, campo: 'Categoría', clave: 'category', probe: F.category, scraperRaw: raw.category, valor: p.category }));

  out.push(makeField({
    ...base, campo: 'Calificación', clave: 'rating', probe: F.rating, scraperRaw: raw.ratingText, valor: p.rating,
    checks: (f) => {
      if (raw.ratingText && p.rating === undefined) downgrade(f, 'baja', `Se leyó "${raw.ratingText}" pero no se pudo convertir a número.`);
      if (p.rating !== undefined && (p.rating < 1 || p.rating > 5)) downgrade(f, 'baja', 'Valor fuera del rango 1–5.');
    },
  }));

  out.push(makeField({
    ...base, campo: 'Cantidad de reseñas', clave: 'reviewCount', probe: F.reviewCount, scraperRaw: raw.reviewsText, valor: p.reviewCount,
    checks: (f) => {
      if (F.reviewCount?.winner === 1) downgrade(f, 'baja', 'Se obtuvo del texto completo del bloque de calificación: puede estar leyendo la calificación en vez de la cantidad.');
      if (p.reviewCount !== undefined && (!Number.isInteger(p.reviewCount) || p.reviewCount === p.rating)) {
        downgrade(f, 'baja', `El valor ${p.reviewCount} parece la calificación, no una cantidad de reseñas.`);
        f.avisos.push('Valor probablemente incorrecto: no usar en argumentos comerciales sin verificar.');
      }
      if (histogramTotal !== undefined && p.reviewCount !== undefined && p.reviewCount > 0) {
        const diff = Math.abs(histogramTotal - p.reviewCount) / p.reviewCount;
        if (diff <= 0.05) upgrade(f, 'alta', `Confirmado por el histograma de estrellas (suma ${histogramTotal}).`);
        else downgrade(f, 'baja', `No coincide con la suma del histograma de estrellas (${histogramTotal}).`);
      } else {
        f.motivoConfianza.push('Sin histograma visible para validar el número.');
      }
      if (c.reviews && p.reviewCount !== undefined && c.reviews.raw.length > p.reviewCount) {
        downgrade(f, 'baja', `Se leyeron ${c.reviews.raw.length} reseñas en la pestaña, más que la cantidad informada.`);
      }
    },
  }));

  out.push(makeField({ ...base, campo: 'Dirección', clave: 'address', probe: F.address, scraperRaw: raw.address, valor: p.address }));

  out.push(makeField({
    ...base, campo: 'Teléfono', clave: 'phone', probe: F.phone, scraperRaw: raw.phone, valor: p.phone,
    checks: (f) => {
      const digits = (p.phone ?? '').replace(/\D/g, '');
      if (p.phone && digits.length < 6) downgrade(f, 'baja', 'Tiene menos de 6 dígitos.');
      if (p.phone && !/^\+|^00/.test(p.phone.trim())) f.avisos.push('Sin prefijo internacional: el enlace de WhatsApp se abrirá sin destinatario.');
    },
  }));

  out.push(makeField({
    ...base, campo: 'Sitio web', clave: 'website', probe: F.website, scraperRaw: raw.website, valor: p.website,
    checks: (f) => {
      if (p.website) {
        try {
          new URL(p.website);
        } catch {
          downgrade(f, 'baja', 'No es una URL válida.');
        }
        if (raw.website !== p.website) f.motivoConfianza.push(`URL normalizada desde "${raw.website}".`);
      }
    },
  }));

  out.push(makeField({ ...base, campo: 'Plus Code', clave: 'plusCode', probe: F.plusCode, scraperRaw: raw.plusCode, valor: p.plusCode }));

  out.push(makeField({
    ...base, campo: 'Place ID (enlace "escribir reseña")', clave: 'placeId', probe: F.placeId, scraperRaw: raw.placeId, valor: p.placeId,
    checks: (f) => {
      const distinct = Number(F.placeId?.extra?.distintos ?? 0);
      if (distinct === 1) upgrade(f, 'alta', 'Es el único Place ID presente en la página.');
      if (distinct > 1) {
        downgrade(f, 'baja', `Hay ${distinct} Place ID distintos en la página y se tomó el primero.`);
        f.avisos.push('Riesgo: el QR de reseñas podría enviar a los clientes a otro negocio.');
      }
    },
  }));

  // Horarios: dos cadenas (tabla y resumen accesible).
  const daysCount = Object.keys(p.hours?.days ?? {}).length;
  const hoursProbe: ProbeField = {
    attempts: [
      ...(F.hoursRows?.attempts ?? []),
      ...(F.hoursAria?.attempts ?? []).map((a) => ({ ...a, orden: (F.hoursRows?.attempts.length ?? 0) + a.orden })),
    ],
    winner: (F.hoursRows?.winner ?? -1) >= 0 && Number(F.hoursRows?.value) > 0
      ? F.hoursRows!.winner
      : (F.hoursAria?.winner ?? -1) >= 0 ? (F.hoursRows?.attempts.length ?? 0) + F.hoursAria!.winner : -1,
    value: `${Number(F.hoursRows?.value ?? 0)} filas | ${String(F.hoursAria?.value ?? '')}`,
  };
  out.push(makeField({
    ...base, campo: 'Horarios', clave: 'hours', probe: hoursProbe, scraperRaw: `${raw.hoursRows.length} filas | ${raw.hoursAria}`,
    valor: p.hours ? p.hours.days : undefined,
    checks: (f) => {
      if (p.hours && daysCount === 0) downgrade(f, 'baja', 'Hay resumen de horario pero no se pudieron separar los días.');
      if (daysCount > 0 && daysCount < 7) f.avisos.push(`Solo ${daysCount} días: verificar en la ficha si realmente faltan días o si el selector no los leyó.`);
      if (daysCount > 0 && hoursProbe.winner >= (F.hoursRows?.attempts.length ?? 0)) downgrade(f, 'media', 'Días obtenidos del resumen accesible, no de la tabla.');
    },
  }));

  // Descripción: el scraper usa la del panel y, si no hay, la de la pestaña Información.
  const usedAbout = !raw.description && !!p.description;
  out.push(makeField({
    ...base,
    pestaña: usedAbout ? TAB_ABOUT : TAB_OVERVIEW,
    campo: 'Descripción', clave: 'description',
    probe: usedAbout && c.about
      ? { attempts: [{ orden: 1, selector: c.about.probe.description.selector, lectura: 'innerText', confianzaBase: 'media', nota: 'pestaña Información', coincidencias: 1, valor: c.about.probe.description.valor, html: c.about.probe.description.html }], winner: 0, value: c.about.probe.description.valor }
      : F.description,
    scraperRaw: usedAbout ? c.about?.raw.description : raw.description,
    valor: p.description,
    checks: (f) => {
      if (!usedAbout && F.description?.winner === 0 && p.description) {
        f.avisos.push('Proviene de div.PYvSYb, que suele ser el resumen editorial de Google y no la descripción escrita por el dueño.');
      }
      if (!p.description) f.avisos.push('No detectado no significa que no exista: comprobar la pestaña "Información" de la ficha.');
    },
  }));

  // Fotos
  const photoFromCount = !p.photoCountIsEstimate;
  out.push(makeField({
    ...base, campo: 'Fotos (cantidad)', clave: 'photoCount',
    probe: photoFromCount ? F.photoCountText : F.photoUrls,
    scraperRaw: photoFromCount ? raw.photoCountText : Math.min(raw.photoUrls.length, 40),
    valor: p.photoCount,
    checks: (f) => {
      if (p.photoCountIsEstimate) {
        downgrade(f, 'baja', 'Maps no mostró el total: es la cantidad de imágenes visibles en pantalla, no el total de la ficha.');
        f.avisos.push('Estimación: no usar como "tiene pocas fotos" sin verificar en la ficha.');
      }
    },
  }));

  out.push(makeField({
    ...base, campo: 'Reservas', clave: 'hasBooking', probe: F.bookingButton, scraperRaw: raw.bookingButton,
    valor: p.hasBooking ? (p.bookingUrl ?? true) : false,
    found: p.hasBooking,
    checks: (f) => {
      if (!p.hasBooking) f.avisos.push('No detectado no significa que no exista: Maps muestra reservas de proveedores integrados con formatos variables.');
    },
  }));
  out.push(makeField({ ...base, campo: 'Menú / carta', clave: 'menuUrl', probe: F.menuUrl, scraperRaw: raw.menuUrl, valor: p.menuUrl }));
  out.push(makeField({ ...base, campo: 'Pedidos online', clave: 'orderUrl', probe: F.orderUrl, scraperRaw: raw.orderUrl, valor: p.orderUrl }));

  out.push(makeField({
    ...base, campo: 'Publicaciones', clave: 'posts', probe: F.posts, scraperRaw: raw.posts.length, valor: p.posts.length,
    checks: (f) => {
      if (p.posts.some((x) => /respuesta del propietario|response from the owner/i.test(x.text ?? ''))) {
        downgrade(f, 'baja', 'Alguna "publicación" contiene "Respuesta del propietario": probablemente es una respuesta a reseña.');
      }
      if (!p.posts.length) f.avisos.push('No detectado no significa que no exista: la sección de novedades no siempre se carga en la vista inicial.');
    },
  }));

  // Ficha reclamada: combinación de dos señales.
  const claimProbe = p.isClaimed === false ? F.unclaimed : F.claimedSignals;
  out.push(makeField({
    ...base, campo: 'Ficha reclamada', clave: 'isClaimed', probe: claimProbe,
    scraperRaw: p.isClaimed === false ? raw.unclaimed : raw.claimedSignals,
    valor: p.isClaimed === undefined ? 'sin determinar' : p.isClaimed,
    found: p.isClaimed !== undefined,
    checks: (f) => {
      if (p.isClaimed === undefined) {
        f.motivoConfianza.push('No apareció el aviso "Reclamar este negocio" ni respuestas del dueño.');
      } else if (p.isClaimed === true) {
        downgrade(f, 'baja', 'Se infiere solo porque aparece texto del propietario, no por un indicador explícito.');
      } else {
        f.motivoConfianza.push('Se encontró el aviso para reclamar el negocio → la ficha NO está reclamada.');
      }
    },
  }));
  out.push(makeField({
    ...base, campo: 'Cerrado permanentemente', clave: 'permanentlyClosed', probe: F.permanentlyClosed,
    scraperRaw: raw.permanentlyClosed, valor: p.permanentlyClosed,
    found: true,
    absentNote: 'No aparece el texto "Cerrado permanentemente" en el panel → se considera abierto.',
  }));
  out.push(makeField({ ...base, campo: 'Redes sociales', clave: 'socialLinks', probe: F.socialLinks, scraperRaw: raw.socialLinks.length, valor: p.socialLinks, multi: true, found: p.socialLinks.length > 0 }));
  out.push(makeField({
    ...base, campo: 'Histograma de estrellas', clave: 'ratingHistogram', probe: F.histogram, scraperRaw: raw.histogram.length, valor: p.ratingHistogram, multi: true,
    checks: (f) => {
      if (F.histogram && Number(F.histogram.value) > 0 && Number(F.histogram.value) !== 5) downgrade(f, 'baja', `Se esperaban 5 filas y hay ${String(F.histogram.value)}.`);
    },
  }));
  return out;
}

function reviewsAndAboutFields(c: DiagnosticCapture, p: BusinessProfile): FieldDiagnostic[] {
  const out: FieldDiagnostic[] = [];
  if (c.reviews) {
    const r = c.reviews.probe;
    const n = r.container.nodes;
    const attempts: ProbeAttempt[] = [
      { orden: 1, selector: 'div.jftiEf[data-review-id]', lectura: 'nodos de reseña', confianzaBase: 'media', nota: 'clase CSS + atributo data-review-id', coincidencias: r.container.selector === 'div.jftiEf[data-review-id]' ? n : 0, valor: r.container.selector === 'div.jftiEf[data-review-id]' ? n : 0, html: r.sampleHtml },
      { orden: 2, selector: 'div[data-review-id][aria-label]', lectura: 'nodos de reseña', confianzaBase: 'baja', nota: 'solo atributos (puede incluir nodos internos)', coincidencias: r.container.selector !== 'div.jftiEf[data-review-id]' ? n : 0, valor: r.container.selector !== 'div.jftiEf[data-review-id]' ? n : 0 },
    ];
    const f = makeField({
      campo: 'Reseñas muestreadas', clave: 'reviews', pestaña: TAB_REVIEWS, contenedor: r.container.selector,
      // El scraper muestrea como máximo 40 reseñas (maxReviews por defecto).
      probe: { attempts, winner: n ? (r.container.selector === 'div.jftiEf[data-review-id]' ? 0 : 1) : -1, value: Math.min(n, 40) },
      scraperRaw: c.reviews.raw.length, valor: p.reviews.length, multi: true,
    });
    f.extra = { subcampos: r.subfields };
    for (const [key, sf] of Object.entries(r.subfields)) {
      // Que una reseña no tenga respuesta del dueño es un resultado normal, no un fallo del selector.
      if (key === 'respuestaDueño') continue;
      if (n && sf.sinValor > 0) {
        const pct = Math.round((sf.sinValor / n) * 100);
        downgrade(f, pct > 50 ? 'baja' : 'media', `"${key}" sin valor en ${sf.sinValor} de ${n} reseñas (${pct}%).`);
      }
    }
    const withDate = p.reviews.filter((x) => x.ageDays !== undefined).length;
    if (p.reviews.length && withDate < p.reviews.length) {
      f.avisos.push(`${p.reviews.length - withDate} fecha(s) no se pudieron convertir a días: afecta a la frecuencia de reseñas.`);
    }
    if (!n && p.warnings.some((w) => /pestaña de reseñas/i.test(w))) f.avisos.push('No se encontró la pestaña de reseñas.');
    out.push(settle(f));
  }
  if (c.about) {
    const a = c.about.probe;
    const winnerIdx = a.items.findIndex((i) => i.coincidencias > 0);
    const f = makeField({
      campo: 'Servicios y atributos', clave: 'services', pestaña: TAB_ABOUT, contenedor: 'document',
      probe: {
        attempts: a.items.map((i, idx) => ({ orden: idx + 1, selector: i.selector, lectura: 'aria-label|innerText', confianzaBase: i.confianzaBase, coincidencias: i.coincidencias, valor: i.coincidencias })),
        winner: winnerIdx,
        value: a.total,
      },
      scraperRaw: c.about.raw.items.length,
      valor: p.services,
      multi: true,
    });
    f.motivoConfianza.push('Los tres selectores se combinan: la "estrategia ganadora" es el primero con coincidencias.');
    out.push(f);
  }
  return out;
}
