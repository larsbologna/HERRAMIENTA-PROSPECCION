import type { Browser } from 'playwright';
import { buildContext, runAudit } from './auditor/auditor.js';
import { buildChannelReport, type ChannelReport } from './channels/crossCheck.js';
import { analyzeInstagram, type InstagramAnalysis } from './channels/instagram.js';
import { isInstagram, isOwnWebsite } from './channels/links.js';
import { config } from './config/index.js';
import type { AnalysisResult, BusinessProfile, WebsiteAnalysis } from './domain/types.js';
import { buildBudget } from './proposal/budget.js';
import { buildProposal } from './proposal/proposalEngine.js';
import { launchBrowser } from './scraper/browser.js';
import { isMapsUrl, scrapeMapsProfile } from './scraper/mapsScraper.js';
import { analyzeWebsite, emptyAnalysis, isSocialOrDirectory } from './scraper/websiteAnalyzer.js';

export interface Progress {
  /** 0–100 */
  percent: number;
  message: string;
}

export interface AnalyzeOptions {
  onProgress?: (p: Progress) => void;
  /** Cancela el análisis (p. ej. si el usuario cierra la página). */
  signal?: AbortSignal;
  /** Solo para tests con fichas simuladas. */
  skipUrlValidation?: boolean;
  timeoutMs?: number;
  /** Revisión de Instagram: desactivar o apuntar a un Instagram simulado (tests). */
  instagram?: { enabled?: boolean; baseUrl?: string };
}

/**
 * Analiza un negocio a partir de su enlace de Google Maps:
 * ficha de Maps → sitio web → auditoría → argumentos comerciales → mensaje → presupuesto.
 *
 * Abre un navegador propio y SIEMPRE lo cierra al terminar, fallar, cancelarse o agotar el tiempo.
 */
export async function analyze(url: string, opts: AnalyzeOptions = {}): Promise<AnalysisResult> {
  if (!opts.skipUrlValidation && !isMapsUrl(url)) {
    throw new Error('El enlace no es de Google Maps. Copiá el enlace desde el botón "Compartir" de la ficha del negocio.');
  }
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? config.analysisTimeoutMs;
  const browser = await launchBrowser();

  // Cerrar el navegador interrumpe cualquier paso de Playwright en curso: sirve para cancelar y para el timeout.
  let stopReason: string | undefined;
  const stop = (reason: string) => {
    stopReason ??= reason;
    void browser.close().catch(() => {});
  };
  const timer = setTimeout(() => stop(`El análisis superó el tiempo máximo (${Math.round(timeoutMs / 1000)} s).`), timeoutMs);
  const onAbort = () => stop('Análisis cancelado.');
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    return await run(browser, url, opts.onProgress ?? (() => {}), started, opts.instagram);
  } catch (err) {
    throw new Error(stopReason ?? friendlyError(err as Error));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    await browser.close().catch(() => {});
  }
}

async function run(browser: Browser, url: string, report: (p: Progress) => void, started: number, instagramOpts?: AnalyzeOptions['instagram']): Promise<AnalysisResult> {
  // Avance de la barra durante la lectura de Maps (los mensajes los emite el scraper).
  let mapsPercent = 5;
  report({ percent: mapsPercent, message: 'Abriendo Google Maps…' });
  const { profile } = await scrapeMapsProfile(browser, url, {
    onProgress: (message) => {
      mapsPercent = Math.min(55, mapsPercent + 10);
      report({ percent: mapsPercent, message });
    },
  });
  if (profile.dataQuality?.blocked) {
    throw new Error('Google pidió una verificación (anti-robots) y no se pudo leer la ficha. Esperá unos minutos y volvé a intentar.');
  }
  if (!profile.name) {
    throw new Error('No se pudo leer la ficha. Comprobá que el enlace sea de un negocio (no de una búsqueda o una zona).');
  }

  let website: WebsiteAnalysis | undefined;
  if (!profile.website) {
    report({ percent: 75, message: 'El negocio no tiene sitio web.' });
  } else if (isSocialOrDirectory(profile.website)) {
    report({ percent: 75, message: 'El "sitio web" es una red social o directorio.' });
    website = emptyAnalysis(profile.website);
  } else {
    report({ percent: 60, message: 'Analizando el sitio web…' });
    website = await analyzeWebsite(browser, profile.website, {
      onProgress: (message) => report({ percent: 68, message }),
    });
  }

  report({ percent: 78, message: 'Revisando Instagram y cruzando canales…' });
  const channels = await verifyChannels(browser, profile, website, instagramOpts, (m) => report({ percent: 80, message: m }));

  report({ percent: 85, message: 'Detectando problemas y oportunidades…' });
  const result = buildAnalysis(url, profile, website, { durationMs: Date.now() - started }, channels);
  report({ percent: 100, message: 'Análisis completado.' });
  return result;
}

/**
 * Auditoría → argumentos comerciales → mensaje → presupuesto, a partir de datos ya leídos.
 * Pura (sin navegador): la usa el análisis en vivo y la importación de informes antiguos.
 */
export function buildAnalysis(
  url: string,
  profile: BusinessProfile,
  website: WebsiteAnalysis | undefined,
  meta: { durationMs: number; analyzedAt?: string },
  channels?: ChannelReport,
): AnalysisResult {
  const ctx = buildContext(profile, website, undefined, channels);
  const audit = runAudit(ctx);
  const proposal = buildProposal(ctx, audit);
  const budget = buildBudget(proposal.services);
  return {
    url,
    analyzedAt: meta.analyzedAt ?? new Date().toISOString(),
    durationMs: meta.durationMs,
    profile,
    website,
    vertical: { id: ctx.vertical.id, label: ctx.vertical.label },
    audit,
    proposal,
    budget,
    ...(channels ? { channels } : {}),
  };
}

/**
 * Revisa los canales del negocio fuera de Google Maps (Instagram y la web que enlaza) y arma la
 * verificación cruzada. Nunca falla: si algo no se puede revisar, queda como "no verificado".
 */
export async function verifyChannels(
  browser: Browser,
  profile: BusinessProfile,
  website: WebsiteAnalysis | undefined,
  opts: AnalyzeOptions['instagram'] = {},
  progress: (m: string) => void = () => {},
): Promise<ChannelReport> {
  const igUrl = [...profile.socialLinks, profile.website ?? '', ...(website?.reachable ? website.socialLinks : [])].find((l) => l && isInstagram(l));
  let ig: InstagramAnalysis | undefined;
  if (igUrl && opts.enabled !== false && config.instagramCheck) {
    progress('Revisando el perfil de Instagram…');
    ig = await analyzeInstagram(browser, igUrl, { baseUrl: opts.baseUrl ?? config.instagramBaseUrl }).catch(() => undefined);
  }
  // Web que solo aparece en Instagram: ¿carga? (para no recomendar vincular una web caída).
  let igWebsiteReachable: boolean | undefined;
  const ownOnMaps = profile.website && isOwnWebsite(profile.website);
  if (ig?.status === 'ok' && ig.website && !ownOnMaps) {
    progress('Comprobando la web enlazada en Instagram…');
    const ctx = await browser.newContext();
    try {
      const res = await ctx.request.get(ig.website, { timeout: 15_000, failOnStatusCode: false, maxRedirects: 5 });
      igWebsiteReachable = res.status() < 400;
    } catch {
      igWebsiteReachable = false;
    } finally {
      await ctx.close().catch(() => {});
    }
  }
  return buildChannelReport(profile, website, ig, { igWebsiteReachable });
}

/**
 * "Verificar presencia online": vuelve a revisar web e Instagram con los datos de Google ya leídos
 * y rearma argumentos y mensajes, para no usar información vieja (sin volver a leer Google Maps).
 */
export async function reverifyAnalysis(previous: AnalysisResult, opts: Pick<AnalyzeOptions, 'onProgress' | 'instagram'> = {}): Promise<AnalysisResult> {
  const started = Date.now();
  const report = opts.onProgress ?? (() => {});
  const browser = await launchBrowser();
  try {
    const profile = previous.profile;
    let website: WebsiteAnalysis | undefined = previous.website;
    if (profile.website && isOwnWebsite(profile.website)) {
      report({ percent: 20, message: 'Revisando la página web…' });
      website = await analyzeWebsite(browser, profile.website, {}).catch(() => previous.website);
    }
    report({ percent: 60, message: 'Revisando Instagram y cruzando canales…' });
    const channels = await verifyChannels(browser, profile, website, opts.instagram, (m) => report({ percent: 70, message: m }));
    report({ percent: 90, message: 'Rearmando argumentos y mensajes…' });
    return buildAnalysis(previous.url, profile, website, { durationMs: Date.now() - started }, channels);
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Traduce errores técnicos de Playwright a mensajes comprensibles. */
function friendlyError(err: Error): string {
  const msg = err.message ?? String(err);
  if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
    return 'Falta el navegador de Playwright. Ejecutá una vez: npx playwright install chromium';
  }
  if (/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ENOTFOUND/i.test(msg)) return 'Sin conexión a internet o la dirección no existe.';
  if (/Timeout|timed out/i.test(msg)) return 'Google Maps tardó demasiado en responder. Probá de nuevo en unos segundos.';
  if (/Target (page, context or browser )?closed|browser has been closed/i.test(msg)) return 'El navegador se cerró inesperadamente. Probá de nuevo.';
  return msg.split('\n')[0] ?? 'Error desconocido.';
}
