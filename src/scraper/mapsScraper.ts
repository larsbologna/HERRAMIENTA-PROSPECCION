import path from 'node:path';
import type { Browser, Page } from 'playwright';
import type { BusinessProfile, MapsPost, OpeningHours, ReviewSample, Screenshot } from '../domain/types.js';
import { config } from '../config/index.js';
import { clean, parseLocaleNumber, parseRating, stripLabel, unique } from '../utils/text.js';
import { relativeDateToDays } from '../utils/relativeDate.js';
import { newDesktopContext } from './browser.js';
import { assessDataQuality, type ScrapeSteps } from './dataQuality.js';
import {
  EXTRACT_ABOUT,
  EXTRACT_OVERVIEW,
  EXTRACT_REVIEWS,
  type RawAbout,
  type RawOverview,
  type RawReview,
} from './scripts/mapsScripts.js';

export interface ScrapeOptions {
  /** Carpeta para capturas. Si no se indica, no se hacen capturas (más rápido). */
  screenshotDir?: string;
  onProgress?: (message: string) => void;
  onScreenshot?: (shot: Screenshot) => void;
  /** Máximo de reseñas a muestrear para calcular frecuencia y tasa de respuesta. */
  maxReviews?: number;
  /**
   * Solo para el modo diagnóstico: se invoca justo después de cada extracción, con la página
   * en el mismo estado y con el resultado crudo obtenido. No altera el scraping.
   */
  inspect?: ScrapeInspector;
}

export interface ScrapeInspector {
  overview?: (page: Page, raw: RawOverview) => Promise<void>;
  reviews?: (page: Page, raw: RawReview[]) => Promise<void>;
  about?: (page: Page, raw: RawAbout) => Promise<void>;
}

export interface MapsScrapeResult {
  profile: BusinessProfile;
  screenshots: Screenshot[];
}

/** Dominios de Google: google.com, google.es, google.com.ar, google.co.uk… (y nada más). */
const GOOGLE_HOST = /^(www\.|maps\.)?google\.(com|[a-z]{2}|com?\.[a-z]{2})$/i;
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);

export function isMapsUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    if (SHORT_HOSTS.has(host)) return host === 'maps.app.goo.gl' || url.pathname.startsWith('/maps');
    if (!GOOGLE_HOST.test(host)) return false;
    return host.startsWith('maps.') || url.pathname.startsWith('/maps') || url.searchParams.has('cid');
  } catch {
    return false;
  }
}

/** Fuerza el idioma configurado para que los textos (y regex) sean previsibles. */
export function withLanguage(raw: string): string {
  try {
    const url = new URL(raw);
    if (/google\./i.test(url.hostname)) url.searchParams.set('hl', config.browser.mapsLanguage);
    return url.toString();
  } catch {
    return raw;
  }
}

export async function scrapeMapsProfile(browser: Browser, inputUrl: string, opts: ScrapeOptions): Promise<MapsScrapeResult> {
  const progress = opts.onProgress ?? (() => {});
  const screenshots: Screenshot[] = [];
  const warnings: string[] = [];
  const context = await newDesktopContext(browser);
  const page = await context.newPage();

  const shoot = async (id: string, label: string, fullPage = false) => {
    if (!opts.screenshotDir) return;
    const file = path.join('screenshots', `${id}.png`);
    try {
      await page.screenshot({ path: path.join(opts.screenshotDir, `${id}.png`), fullPage });
      const shot: Screenshot = { id, label, file, source: 'maps' };
      screenshots.push(shot);
      opts.onScreenshot?.(shot);
    } catch (err) {
      warnings.push(`No se pudo capturar "${label}": ${(err as Error).message}`);
    }
  };

  try {
    progress('Abriendo Google Maps…');
    await page.goto(withLanguage(inputUrl), { waitUntil: 'domcontentloaded' });
    await handleConsent(page, progress);
    await openFirstResultIfList(page, progress);

    const found = await page
      .waitForSelector('h1.DUwDvf, div[role="main"] h1', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!found) warnings.push('No se encontró el encabezado de la ficha: puede que la URL no sea de un negocio.');
    await page.waitForTimeout(2_000);
    // Se recorre el panel hasta el final: las secciones (fotos, novedades…) cargan al hacerse visibles.
    const panelFullyLoaded = await scrollPanelToEnd(page, 12);

    progress('Extrayendo datos de la ficha…');
    const raw = (await page.evaluate(EXTRACT_OVERVIEW)) as RawOverview;
    await opts.inspect?.overview?.(page, raw);
    await scrollPanelTop(page);
    await shoot('maps-ficha', 'Ficha de Google Maps');

    const steps: ScrapeSteps = { headerFound: found, panelFullyLoaded, reviews: { state: 'no_abierta', sortedByNewest: false }, about: { state: 'no_abierta' } };

    progress('Leyendo reseñas recientes…');
    let reviews: RawReview[] = [];
    try {
      const r = await extractReviews(page, opts.maxReviews ?? 40, warnings);
      reviews = r.reviews;
      steps.reviews = { state: r.opened ? 'ok' : 'no_abierta', sortedByNewest: r.sortedByNewest };
    } catch (err) {
      steps.reviews = { state: 'error', sortedByNewest: false, error: (err as Error).message.split('\n')[0] };
      warnings.push(`Error al leer las reseñas: ${steps.reviews.error}`);
    }
    await opts.inspect?.reviews?.(page, reviews);
    if (reviews.length) await shoot('maps-resenas', 'Reseñas en Google Maps');

    progress('Revisando información y servicios…');
    let about: RawAbout = { items: [], description: '', sections: 0 };
    try {
      const a = await extractAbout(page, warnings);
      if (a) about = a;
      steps.about = { state: a ? 'ok' : 'no_abierta' };
    } catch (err) {
      steps.about = { state: 'error', error: (err as Error).message.split('\n')[0] };
      warnings.push(`Error al leer la pestaña Información: ${steps.about.error}`);
    }
    await opts.inspect?.about?.(page, about);
    if (about.items.length) await shoot('maps-informacion', 'Información y servicios');

    const profile = normalizeProfile(inputUrl, page.url(), raw, reviews, about, warnings);
    profile.dataQuality = assessDataQuality(raw, reviews, about, steps, profile);
    // Un Place ID dudoso (varios en la página) no se usa: podría ser de un negocio cercano.
    if (profile.dataQuality.fields.placeId.confidence === 'baja') profile.placeId = undefined;
    // "Sin reseñas" comprobado → valor real 0 (distinto de "no se pudo leer").
    if (profile.dataQuality.fields.reviewCount.status === 'cero' && profile.reviewCount === undefined) profile.reviewCount = 0;
    if (profile.reviewCount === 0) profile.warnings = profile.warnings.filter((w) => !/cantidad de reseñas|calificación/.test(w));
    if (profile.dataQuality.blocked) warnings.push('Google mostró una verificación o bloqueo: los datos no son confiables.');
    return { profile, screenshots };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function handleConsent(page: Page, progress: (m: string) => void): Promise<void> {
  if (!/consent\.google\./.test(page.url())) {
    const dialog = await page.$('form[action*="consent"] button, div[role="dialog"] button[aria-label*="Rechazar" i]');
    if (!dialog) return;
  }
  progress('Aceptando aviso de cookies de Google…');
  const button = page
    .getByRole('button', { name: /rechazar todo|reject all|aceptar todo|accept all/i })
    .first();
  await button.click({ timeout: 8_000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1_500);
}

/** Si la URL es una búsqueda con varios resultados, abre el primero. */
async function openFirstResultIfList(page: Page, progress: (m: string) => void): Promise<void> {
  const hasHeader = await page.waitForSelector('h1.DUwDvf', { timeout: 6_000 }).catch(() => null);
  if (hasHeader) return;
  const first = await page.$('a.hfpxzc');
  if (first) {
    progress('La URL es una búsqueda: abriendo el primer resultado…');
    await first.click();
    await page.waitForTimeout(2_500);
  }
}

const SCROLLABLE_PANEL = 'div[role="main"] div.m6QErb.DxyBCb, div[role="main"] div.m6QErb[tabindex="-1"]';

/** Desplaza el panel hasta el final (o hasta `max` intentos). Devuelve true si llegó al final. */
export async function scrollPanelToEnd(page: Page, max: number): Promise<boolean> {
  let lastHeight = -1;
  for (let i = 0; i < max; i++) {
    const state = (await page
      .evaluate(
        `(() => { const el = document.querySelector('${SCROLLABLE_PANEL}'); if (!el) return null; el.scrollBy(0, 1500); return { h: el.scrollHeight, end: el.scrollTop + el.clientHeight >= el.scrollHeight - 8 }; })()`,
      )
      .catch(() => null)) as { h: number; end: boolean } | null;
    if (!state) return false;
    await page.waitForTimeout(700);
    // Al final y sin contenido nuevo cargado tras la espera.
    if (state.end && state.h === lastHeight) return true;
    lastHeight = state.h;
  }
  return false;
}

async function scrollPanel(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page
      .evaluate(`(() => { const el = document.querySelector('${SCROLLABLE_PANEL}'); if (el) el.scrollBy(0, 1200); })()`)
      .catch(() => {});
    await page.waitForTimeout(600);
  }
}

async function scrollPanelTop(page: Page): Promise<void> {
  await page
    .evaluate(`(() => { const el = document.querySelector('${SCROLLABLE_PANEL}'); if (el) el.scrollTo(0, 0); })()`)
    .catch(() => {});
  await page.waitForTimeout(400);
}

async function clickTab(page: Page, name: RegExp): Promise<boolean> {
  const tab = page.getByRole('tab', { name }).first();
  if ((await tab.count()) === 0) return false;
  await tab.click().catch(() => {});
  await page.waitForTimeout(2_000);
  return true;
}

async function extractReviews(page: Page, max: number, warnings: string[]): Promise<{ reviews: RawReview[]; opened: boolean; sortedByNewest: boolean }> {
  const opened = await clickTab(page, /reseñas|opiniones|reviews/i);
  if (!opened) {
    warnings.push('No se encontró la pestaña de reseñas.');
    return { reviews: [], opened: false, sortedByNewest: false };
  }
  // Ordenar por más recientes para medir frecuencia real. Si no se logra, las fechas
  // de la muestra NO sirven para afirmar nada sobre la frecuencia (son las "más relevantes").
  let sortedByNewest = false;
  const sort = page.locator('button[aria-label*="Ordenar" i], button[aria-label*="Sort" i]').first();
  if ((await sort.count()) > 0) {
    await sort.click().catch(() => {});
    await page.waitForTimeout(800);
    const newest = page.getByRole('menuitemradio', { name: /más recientes|newest|recientes/i }).first();
    if ((await newest.count()) > 0) {
      sortedByNewest = await newest.click().then(() => true).catch(() => false);
      await page.waitForTimeout(2_000);
    }
  }
  if (!sortedByNewest) warnings.push('No se pudieron ordenar las reseñas por "Más recientes": no se evalúa la frecuencia de reseñas.');
  let reviews: RawReview[] = [];
  for (let i = 0; i < 8 && reviews.length < max; i++) {
    reviews = (await page.evaluate(EXTRACT_REVIEWS)) as RawReview[];
    await scrollPanel(page, 1);
  }
  await scrollPanelTop(page);
  return { reviews: reviews.slice(0, max), opened: true, sortedByNewest };
}

/** Devuelve undefined si la pestaña "Información" no se pudo abrir. */
async function extractAbout(page: Page, warnings: string[]): Promise<RawAbout | undefined> {
  const opened = await clickTab(page, /información|acerca de|about/i);
  if (!opened) {
    warnings.push('No se encontró la pestaña "Información".');
    return undefined;
  }
  return (await page.evaluate(EXTRACT_ABOUT)) as RawAbout;
}

function parseHours(raw: RawOverview): OpeningHours | undefined {
  const days: Record<string, string> = {};
  for (const [day, hours] of raw.hoursRows) {
    const d = clean(day);
    const h = clean(hours?.replace(/\.?\s*Ocultar.*$/i, '').replace(/,?\s*copiar.*$/i, ''));
    if (d && h) days[d.toLowerCase()] = h;
  }
  if (!Object.keys(days).length && raw.hoursAria) {
    // "lunes, 9:00 a 18:00; martes, …"
    for (const part of raw.hoursAria.split(/;/)) {
      const m = part.match(/^\s*([^,]+),\s*(.+?)(\.|$)/);
      if (m?.[1] && m[2]) days[m[1].trim().toLowerCase()] = clean(m[2]) ?? m[2];
    }
  }
  if (!Object.keys(days).length && !raw.hoursAria) return undefined;
  return { days, raw: clean(raw.hoursAria) };
}

function normalizeProfile(
  sourceUrl: string,
  resolvedUrl: string,
  raw: RawOverview,
  rawReviews: RawReview[],
  about: RawAbout,
  warnings: string[],
): BusinessProfile {
  const reviews: ReviewSample[] = rawReviews.map((r) => ({
    author: clean(r.author),
    rating: parseRating(r.ratingText),
    text: clean(r.text),
    relativeDate: clean(r.date),
    ageDays: relativeDateToDays(r.date),
    hasOwnerResponse: r.hasOwnerResponse,
  }));

  const posts: MapsPost[] = raw.posts.map((p) => ({
    text: clean(p.text),
    relativeDate: clean(p.date) || undefined,
    ageDays: relativeDateToDays(p.date),
  }));

  const photoCount = parseLocaleNumber(raw.photoCountText);
  const histogram = raw.histogram.length
    ? Object.fromEntries(raw.histogram.map(([stars, count]) => [stars, parseLocaleNumber(count) ?? 0]))
    : undefined;

  // La descripción del propietario (pestaña Información) tiene prioridad sobre el resumen de la ficha,
  // que a veces escribe Google.
  const description = clean(about.description) || clean(raw.description);
  const ownerReplies = reviews.some((r) => r.hasOwnerResponse);
  const claimed = raw.claimedSignals || ownerReplies;
  const website = cleanWebsite(raw.website);
  const profile: BusinessProfile = {
    sourceUrl,
    resolvedUrl,
    name: clean(raw.name),
    category: clean(raw.category),
    additionalCategories: [],
    rating: parseRating(raw.ratingText),
    reviewCount: parseReviewCount(raw.reviewsText),
    address: stripLabel(raw.address),
    phone: stripLabel(raw.phone) ?? clean(raw.phone),
    website,
    plusCode: stripLabel(raw.plusCode),
    placeId: raw.placeId || undefined,
    hours: parseHours(raw),
    description,
    services: unique(about.items.map((i) => clean(i)).filter((i): i is string => !!i)),
    bookingUrl: raw.bookingUrl || undefined,
    hasBooking: !!raw.bookingUrl || raw.bookingButton,
    menuUrl: raw.menuUrl || undefined,
    hasMenu: !!raw.menuUrl,
    orderUrl: raw.orderUrl || undefined,
    photoCount: photoCount ?? raw.photoUrls.length,
    photoCountIsEstimate: photoCount === undefined,
    photoUrls: raw.photoUrls,
    posts,
    reviews,
    ratingHistogram: histogram,
    // Señales contradictorias (ofrece reclamarla y a la vez hay actividad del propietario) → sin determinar.
    isClaimed: raw.unclaimed && claimed ? undefined : raw.unclaimed ? false : claimed ? true : undefined,
    permanentlyClosed: raw.permanentlyClosed,
    socialLinks: raw.socialLinks,
    scrapedAt: new Date().toISOString(),
    warnings,
  };

  if (!profile.name) warnings.push('No se pudo leer el nombre del negocio.');
  if (profile.rating === undefined) warnings.push('No se pudo leer la calificación.');
  if (profile.reviewCount === undefined) warnings.push('No se pudo leer la cantidad de reseñas.');
  return profile;
}

/**
 * "23 reseñas" → 23. Si el texto es el bloque completo de calificación ("4,1(23)"),
 * la cantidad es el número entre paréntesis, no el primero (que es la calificación).
 */
export function parseReviewCount(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const inParens = text.match(/\(\s*(\d[\d.,]*\s*(?:mil|k)?)\s*\)/i);
  if (inParens?.[1]) return parseLocaleNumber(inParens[1]);
  if (/^\s*[0-5][.,]\d\s*$/.test(text)) return undefined; // solo una calificación suelta
  return parseLocaleNumber(text);
}

/** Maps envuelve algunos enlaces en /url?q=… : se desenvuelven. */
function cleanWebsite(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (/google\./.test(url.hostname) && url.pathname === '/url') {
      return url.searchParams.get('q') ?? url.searchParams.get('url') ?? raw;
    }
    return url.toString();
  } catch {
    const text = stripLabel(raw);
    return text ? (text.startsWith('http') ? text : `https://${text}`) : undefined;
  }
}
