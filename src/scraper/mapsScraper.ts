import path from 'node:path';
import type { Browser, Page } from 'playwright';
import type { BusinessProfile, MapsPost, OpeningHours, ReviewSample, Screenshot } from '../domain/types.js';
import { config } from '../config/index.js';
import { clean, parseLocaleNumber, parseRating, stripLabel, unique } from '../utils/text.js';
import { relativeDateToDays } from '../utils/relativeDate.js';
import { newDesktopContext } from './browser.js';
import {
  EXTRACT_ABOUT,
  EXTRACT_OVERVIEW,
  EXTRACT_REVIEWS,
  type RawOverview,
  type RawReview,
} from './scripts/mapsScripts.js';

export interface ScrapeOptions {
  screenshotDir: string;
  onProgress?: (message: string) => void;
  onScreenshot?: (shot: Screenshot) => void;
  /** Máximo de reseñas a muestrear para calcular frecuencia y tasa de respuesta. */
  maxReviews?: number;
}

export interface MapsScrapeResult {
  profile: BusinessProfile;
  screenshots: Screenshot[];
}

const MAPS_HOST = /(^|\.)google\.[a-z.]+$|maps\.app\.goo\.gl|goo\.gl/i;

export function isMapsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return false;
    if (/maps\.app\.goo\.gl|goo\.gl/i.test(url.hostname)) return true;
    return MAPS_HOST.test(url.hostname) && (url.pathname.startsWith('/maps') || url.searchParams.has('cid'));
  } catch {
    return false;
  }
}

/** Fuerza el idioma configurado para que los textos (y regex) sean previsibles. */
function withLanguage(raw: string): string {
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
    await scrollPanel(page, 4);

    progress('Extrayendo datos de la ficha…');
    const raw = (await page.evaluate(EXTRACT_OVERVIEW)) as RawOverview;
    await scrollPanelTop(page);
    await shoot('maps-ficha', 'Ficha de Google Maps');

    progress('Leyendo reseñas recientes…');
    const reviews = await extractReviews(page, opts.maxReviews ?? 40, warnings);
    if (reviews.length) await shoot('maps-resenas', 'Reseñas en Google Maps');

    progress('Revisando información y servicios…');
    const about = await extractAbout(page, warnings);
    if (about.items.length) await shoot('maps-informacion', 'Información y servicios');

    const profile = normalizeProfile(inputUrl, page.url(), raw, reviews, about, warnings);
    return { profile, screenshots };
  } finally {
    await context.close().catch(() => {});
  }
}

async function handleConsent(page: Page, progress: (m: string) => void): Promise<void> {
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

async function extractReviews(page: Page, max: number, warnings: string[]): Promise<RawReview[]> {
  const opened = await clickTab(page, /reseñas|opiniones|reviews/i);
  if (!opened) {
    warnings.push('No se encontró la pestaña de reseñas.');
    return [];
  }
  // Ordenar por más recientes para medir frecuencia real.
  const sort = page.locator('button[aria-label*="Ordenar" i], button[aria-label*="Sort" i]').first();
  if ((await sort.count()) > 0) {
    await sort.click().catch(() => {});
    await page.waitForTimeout(800);
    const newest = page.getByRole('menuitemradio', { name: /más recientes|newest|recientes/i }).first();
    if ((await newest.count()) > 0) {
      await newest.click().catch(() => {});
      await page.waitForTimeout(2_000);
    }
  }
  let reviews: RawReview[] = [];
  for (let i = 0; i < 8 && reviews.length < max; i++) {
    reviews = (await page.evaluate(EXTRACT_REVIEWS)) as RawReview[];
    await scrollPanel(page, 1);
  }
  await scrollPanelTop(page);
  return reviews.slice(0, max);
}

async function extractAbout(page: Page, warnings: string[]): Promise<{ items: string[]; description: string }> {
  const opened = await clickTab(page, /información|acerca de|about/i);
  if (!opened) {
    warnings.push('No se encontró la pestaña "Información".');
    return { items: [], description: '' };
  }
  return (await page.evaluate(EXTRACT_ABOUT)) as { items: string[]; description: string };
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
  about: { items: string[]; description: string },
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

  const description = clean(raw.description) || clean(about.description);
  const website = cleanWebsite(raw.website);
  const profile: BusinessProfile = {
    sourceUrl,
    resolvedUrl,
    name: clean(raw.name),
    category: clean(raw.category),
    additionalCategories: [],
    rating: parseRating(raw.ratingText),
    reviewCount: parseLocaleNumber(raw.reviewsText),
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
    isClaimed: raw.unclaimed ? false : raw.claimedSignals ? true : undefined,
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
