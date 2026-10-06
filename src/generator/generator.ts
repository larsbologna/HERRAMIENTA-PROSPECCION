import type { Browser, Page } from 'playwright';
import { config } from '../config/index.js';
import { detectVertical } from '../domain/verticals.js';
import { launchBrowser, newDesktopContext } from '../scraper/browser.js';
import { handleConsent, parseReviewCount, scrollPanelToEnd, withLanguage } from '../scraper/mapsScraper.js';
import { EXTRACT_OVERVIEW, type RawOverview } from '../scraper/scripts/mapsScripts.js';
import { clean, stripLabel } from '../utils/text.js';
import { keysFor, mapsUrlIds, SeenIndex, type DedupeKeys } from './dedupe.js';
import { factsFromOverview, opportunityScore, type CandidateFacts, type ScoreReason } from './score.js';

/**
 * GENERADOR INTELIGENTE DE PROSPECTOS
 *
 * Busca negocios reales en Google Maps por rubro y zona, descarta los que ya se entregaron
 * (o ya están en el CRM), los puntúa por oportunidad comercial y devuelve los nuevos.
 *
 *  - Recorre la lista de resultados hasta el final (scroll), no solo la primera página.
 *  - Si no alcanza, prueba variantes de la búsqueda ("barberías en Quilmes", "barbería en Quilmes"…).
 *  - Lee cada ficha con el MISMO script del analizador (EXTRACT_OVERVIEW): nada se inventa.
 *  - Si no hay suficientes negocios nuevos, devuelve los que hay y lo informa.
 */

export interface GenerateRequest {
  rubro: string;
  zona: string;
  cantidad: number;
}

export interface GeneratedCandidate {
  name: string;
  mapsUrl: string;
  address?: string;
  phone?: string;
  website?: string;
  category?: string;
  rating?: number;
  reviewCount?: number;
  placeId?: string;
  keys: DedupeKeys;
  facts: CandidateFacts;
  score: number;
  points: number;
  reasons: ScoreReason[];
  unverified: string[];
}

export interface GenerateStats {
  /** Resultados de la lista de Maps revisados. */
  scanned: number;
  /** Fichas abiertas para leer sus datos. */
  opened: number;
  duplicates: number;
  outOfZone: number;
  closed: number;
  errors: number;
  /** Negocios de otro rubro que Google mezcló en los resultados (descartados). */
  outOfRubro?: number;
  queries: string[];
}

export interface GenerateResult {
  items: GeneratedCandidate[];
  /** true si se recorrieron todos los resultados posibles y no hay más negocios nuevos. */
  exhausted: boolean;
  /** true si se cortó por tiempo máximo (se puede volver a generar para seguir). */
  timedOut: boolean;
  message: string;
  stats: GenerateStats;
}

export interface GenerateDeps {
  /** Negocios ya conocidos (entregados antes o en el CRM): nunca se vuelven a entregar. */
  known: DedupeKeys[];
  browser?: Browser;
  /** URL de búsqueda para una consulta (los tests la apuntan a una ficha simulada). */
  searchUrl?: (query: string) => string;
  onProgress?: (p: { percent: number; message: string }) => void;
  onFound?: (c: GeneratedCandidate) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Solo negocios cuya dirección menciona la zona pedida (por defecto true). */
  strictZone?: boolean;
  /** Solo negocios del rubro pedido (categoría de Google o nombre). Sin filtro se aceptan todos. */
  rubroFilter?: (c: { name: string; category?: string }) => boolean;
}

export const MAX_CANTIDAD = 50;

export function defaultSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=${config.browser.mapsLanguage}`;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** "barberías" → "barbería", "bares" → "bar", "restaurantes" → "restaurante". */
export function singular(word: string): string {
  return word
    .split(/\s+/)
    .map((w) => {
      if (w.length < 4 || !/s$/i.test(w)) return w;
      if (/ces$/i.test(w)) return w.replace(/ces$/i, 'z');
      if (/[lrndj]es$/i.test(w)) return w.replace(/es$/i, '');
      return w.replace(/s$/i, '');
    })
    .join(' ');
}

/** Variantes de búsqueda para explorar más resultados cuando la primera lista no alcanza. */
export function searchQueries(rubro: string, zona: string): string[] {
  const r = rubro.trim().replace(/\s+/g, ' ');
  const z = zona.trim().replace(/\s+/g, ' ');
  const s = singular(r);
  const out = [`${r} en ${z}`, `${s} en ${z}`, `${r} ${z}`, `${s} cerca de ${z}`];
  return [...new Set(out.map((q) => q.trim()))];
}

/** ¿La dirección está en la zona pedida? (normalizado, sin acentos). */
export function inZone(address: string | undefined, zona: string, plusCode?: string): boolean {
  const z = norm(zona);
  if (!z) return true;
  const hay = norm(`${address ?? ''} ${plusCode ?? ''}`);
  return new RegExp(`(^| )${z.replace(/ /g, ' +')}( |$)`).test(hay);
}

// ------------------------------------------------------------------ lectura de la lista de resultados

interface FeedCard {
  name: string;
  url: string;
  text: string;
}
interface FeedState {
  cards: FeedCard[];
  end: boolean;
  hasFeed: boolean;
  single: boolean;
  noResults: boolean;
  blocked: boolean;
}

const READ_FEED = String.raw`(() => {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
  const feed = document.querySelector('div[role="feed"]');
  const cards = Array.from(document.querySelectorAll('a.hfpxzc')).map((a) => {
    const card = a.closest('div.Nv2PK') || a.parentElement;
    return { name: (a.getAttribute('aria-label') || '').trim(), url: a.href, text: txt(card).slice(0, 500) };
  }).filter((c) => c.url);
  const body = txt(document.body).slice(0, 50000);
  return {
    cards,
    end: !!document.querySelector('span.HlvSq') || /llegaste al final de la lista|you've reached the end of the list/i.test(body),
    hasFeed: !!feed,
    single: !feed && !!document.querySelector('h1.DUwDvf'),
    noResults: /no se encontraron resultados|google maps no encuentra|no results found|can't find/i.test(body),
    blocked: /\/sorry\//.test(location.href) || /tráfico inusual|unusual traffic|no soy un robot|not a robot/i.test(body.slice(0, 3000)),
  };
})()`;

const SCROLL_FEED = `(() => { const f = document.querySelector('div[role="feed"]'); if (!f) return false; f.scrollTop = f.scrollHeight; return true; })()`;

async function readFeed(page: Page): Promise<FeedState> {
  return (await page.evaluate(READ_FEED)) as FeedState;
}

// ------------------------------------------------------------------ lectura de cada ficha

async function readPlace(page: Page, url: string): Promise<{ raw: RawOverview; panelFullyLoaded: boolean; url: string } | undefined> {
  await page.goto(withLanguage(url), { waitUntil: 'domcontentloaded' });
  await handleConsent(page, () => {});
  const found = await page.waitForSelector('h1.DUwDvf, div[role="main"] h1', { timeout: 15_000 }).then(() => true).catch(() => false);
  if (!found) return undefined;
  await page.waitForTimeout(1_000);
  const panelFullyLoaded = await scrollPanelToEnd(page, 6);
  const raw = (await page.evaluate(EXTRACT_OVERVIEW)) as RawOverview;
  return { raw, panelFullyLoaded, url: page.url() };
}

function candidateFrom(raw: RawOverview, finalUrl: string, cardUrl: string, panelFullyLoaded: boolean, rubro: string): GeneratedCandidate | undefined {
  const name = clean(raw.name);
  if (!name) return undefined;
  const address = stripLabel(raw.address);
  const phone = stripLabel(raw.phone) ?? clean(raw.phone);
  let website: string | undefined;
  if (raw.website) {
    try {
      const u = new URL(raw.website);
      website = /google\./.test(u.hostname) && u.pathname === '/url' ? (u.searchParams.get('q') ?? raw.website) : u.toString();
    } catch {
      website = raw.website;
    }
  }
  // La URL de la tarjeta trae los identificadores de la ficha; la final puede perderlos.
  const ids = { ...mapsUrlIds(finalUrl), ...Object.fromEntries(Object.entries(mapsUrlIds(cardUrl)).filter(([, v]) => v)) };
  const placeId = ids.placeId ?? raw.meta?.placeIdFromUrl ?? (raw.meta?.placeIdCandidates.length === 1 ? raw.meta.placeIdCandidates[0] : undefined);
  const facts = factsFromOverview(raw, panelFullyLoaded);
  const vertical = detectVertical(clean(raw.category), name);
  const sc = opportunityScore(facts, { bookingRelevant: vertical.bookingRelevant || /turno|reserv|barber|peluq|spa|estetic|odont|consult|restaur/i.test(rubro) });
  const keys = keysFor({ name, address, phone, website, mapsUrl: cardUrl, placeId });
  if (!keys.featureId && ids.featureId) keys.featureId = ids.featureId;
  return {
    name,
    mapsUrl: cardUrl,
    address,
    phone: phone || undefined,
    website,
    category: clean(raw.category),
    rating: facts.rating,
    reviewCount: facts.reviewCount ?? parseReviewCount(raw.reviewsText),
    placeId,
    keys,
    facts,
    score: sc.score,
    points: sc.points,
    reasons: sc.reasons,
    unverified: sc.unverified,
  };
}

// ------------------------------------------------------------------ orquestación

export async function generateProspects(req: GenerateRequest, deps: GenerateDeps): Promise<GenerateResult> {
  const rubro = req.rubro.trim();
  const zona = req.zona.trim();
  const cantidad = Math.max(1, Math.min(MAX_CANTIDAD, Math.floor(req.cantidad) || 0));
  if (!rubro || !zona) throw new Error('Indicá el rubro y la zona.');

  const progress = deps.onProgress ?? (() => {});
  const searchUrl = deps.searchUrl ?? defaultSearchUrl;
  const strictZone = deps.strictZone ?? true;
  const seen = new SeenIndex(deps.known);
  /** Tarjetas ya revisadas en esta búsqueda (aunque se hayan descartado por zona o cierre). */
  const visited = new Set<string>();
  const items: GeneratedCandidate[] = [];
  const stats: GenerateStats = { scanned: 0, opened: 0, duplicates: 0, outOfZone: 0, closed: 0, errors: 0, queries: [] };

  const ownBrowser = !deps.browser;
  const browser = deps.browser ?? (await launchBrowser());
  const context = await newDesktopContext(browser);
  const list = await context.newPage();
  const detail = await context.newPage();
  const started = Date.now();
  const timeoutMs = deps.timeoutMs ?? config.generatorTimeoutMs;
  let timedOut = false;
  let blocked = false;
  let allQueriesExhausted = true;
  const cancelled = () => deps.signal?.aborted ?? false;
  const outOfTime = () => {
    if (Date.now() - started > timeoutMs) timedOut = true;
    return timedOut;
  };
  const report = (message: string) => progress({ percent: Math.min(97, Math.round((items.length / cantidad) * 95) + 2), message });

  const consider = async (card: FeedCard): Promise<void> => {
    const ids = mapsUrlIds(card.url);
    const visitKey = ids.placeId ?? ids.featureId ?? ids.urlKey ?? card.url;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    stats.scanned++;
    // Descarte rápido (sin abrir la ficha) solo por identificadores exactos de Google.
    // El nombre solo se compara después de leer la ficha (con dirección, teléfono y web).
    if (seen.match(keysFor({ mapsUrl: card.url }))) {
      stats.duplicates++;
      return;
    }
    if (/cerrado permanentemente|permanently closed/i.test(card.text)) {
      stats.closed++;
      return;
    }
    report(`Revisando ${card.name || 'negocio'}… (${items.length} de ${cantidad})`);
    let read: Awaited<ReturnType<typeof readPlace>>;
    try {
      stats.opened++;
      read = await readPlace(detail, card.url);
    } catch (err) {
      if (cancelled() || outOfTime()) return;
      stats.errors++;
      deps.onProgress?.({ percent: Math.min(97, Math.round((items.length / cantidad) * 95) + 2), message: `No se pudo abrir ${card.name}: ${(err as Error).message.split('\n')[0]}` });
      return;
    }
    if (!read) {
      stats.errors++;
      return;
    }
    if (read.raw.meta?.blocked) {
      blocked = true;
      return;
    }
    const c = candidateFrom(read.raw, read.url, card.url, read.panelFullyLoaded, rubro);
    if (!c) {
      stats.errors++;
      return;
    }
    if (c.facts.permanentlyClosed) {
      stats.closed++;
      return;
    }
    if (strictZone && !inZone(c.address, zona, read.raw.plusCode)) {
      stats.outOfZone++;
      return;
    }
    if (deps.rubroFilter && !deps.rubroFilter(c)) {
      stats.outOfRubro = (stats.outOfRubro ?? 0) + 1;
      return;
    }
    const dup = seen.match(c.keys);
    if (dup) {
      stats.duplicates++;
      return;
    }
    seen.add(c.keys);
    items.push(c);
    deps.onFound?.(c);
    report(`Encontrado: ${c.name} (score ${c.score}) · ${items.length} de ${cantidad}`);
  };

  try {
    for (const query of searchQueries(rubro, zona)) {
      if (items.length >= cantidad || cancelled() || outOfTime() || blocked) break;
      stats.queries.push(query);
      report(`Buscando "${query}" en Google Maps…`);
      await list.goto(searchUrl(query), { waitUntil: 'domcontentloaded' });
      await handleConsent(list, () => {});
      await list.waitForSelector('div[role="feed"], h1.DUwDvf', { timeout: 15_000 }).catch(() => {});
      await list.waitForTimeout(1_200);

      let state = await readFeed(list);
      if (state.blocked) {
        blocked = true;
        break;
      }
      if (state.single) {
        // La búsqueda abrió directamente una ficha (un solo resultado).
        await consider({ name: '', url: list.url(), text: '' });
        continue;
      }
      if (!state.hasFeed) continue;

      let idle = 0;
      let lastCount = -1;
      for (;;) {
        for (const card of state.cards) {
          if (items.length >= cantidad || cancelled() || outOfTime() || blocked) break;
          await consider(card);
        }
        if (items.length >= cantidad || cancelled() || outOfTime() || blocked) {
          if (!state.end) allQueriesExhausted = false;
          break;
        }
        if (state.end) break;
        // Más resultados: desplazar la lista y esperar que Google cargue la siguiente tanda.
        await list.evaluate(SCROLL_FEED).catch(() => false);
        await list.waitForTimeout(1_500);
        state = await readFeed(list);
        if (state.cards.length === lastCount) {
          if (++idle >= 3) break; // la lista no crece más: se considera agotada
        } else {
          idle = 0;
        }
        lastCount = state.cards.length;
      }
    }
  } finally {
    await context.close().catch(() => {});
    if (ownBrowser) await browser.close().catch(() => {});
  }

  if (cancelled()) throw new Error('Generación cancelada.');
  if (blocked && !items.length) throw new Error('Google pidió una verificación (anti-robots). Esperá unos minutos y volvé a intentar.');

  items.sort((a, b) => b.score - a.score || b.points - a.points || a.name.localeCompare(b.name));
  const exhausted = items.length < cantidad && !timedOut && !blocked && allQueriesExhausted;
  const n = items.length;
  let message: string;
  if (n >= cantidad) message = `Se encontraron ${n} prospectos nuevos.`;
  else if (timedOut) message = `Se encontraron ${n} prospectos nuevos antes del tiempo máximo. Volvé a generar para seguir buscando.`;
  else if (blocked) message = `Se encontraron ${n} prospectos nuevos. Google pidió una verificación y se detuvo la búsqueda: probá de nuevo en unos minutos.`;
  else if (n === 0) message = `No se encontraron prospectos nuevos. No quedan más negocios sin analizar para este rubro y ubicación.`;
  else message = `Se encontraron ${n} prospecto${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'}. No quedan más negocios sin analizar para este rubro y ubicación.`;
  progress({ percent: 100, message });
  return { items, exhausted, timedOut, message, stats };
}
