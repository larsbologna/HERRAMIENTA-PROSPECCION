import path from 'node:path';
import type { Browser, Page } from 'playwright';
import type { Screenshot, WebsiteAnalysis } from '../domain/types.js';
import { unique } from '../utils/text.js';
import { newDesktopContext, newMobileContext } from './browser.js';
import { EXTRACT_WEBSITE, type RawWebsite } from './scripts/websiteScripts.js';

export interface WebsiteOptions {
  screenshotDir: string;
  onProgress?: (message: string) => void;
  onScreenshot?: (shot: Screenshot) => void;
}

/** Dominios que no cuentan como "sitio web propio" (redes sociales, directorios, delivery…). */
const SOCIAL_OR_DIRECTORY_DOMAINS = [
  'facebook.com', 'fb.com', 'instagram.com', 'tiktok.com', 'linktr.ee', 'linkin.bio', 'wa.me', 'whatsapp.com',
  'twitter.com', 'x.com', 'youtube.com', 'tripadvisor.com', 'tripadvisor.es', 'yelp.com', 'booking.com',
  'thefork.com', 'eltenedor.es', 'rappi.com', 'pedidosya.com', 'ubereats.com', 'glovoapp.com', 'just-eat.es',
  'doctoralia.es', 'doctoralia.com', 'business.site', 'g.page', 'sites.google.com', 'google.com', 'beacons.ai',
];

export function isSocialOrDirectory(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  return SOCIAL_OR_DIRECTORY_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

export async function analyzeWebsite(browser: Browser, url: string, opts: WebsiteOptions): Promise<WebsiteAnalysis> {
  const progress = opts.onProgress ?? (() => {});
  const base = emptyAnalysis(url);
  if (base.isSocialOrDirectory) {
    progress('El "sitio web" es una red social o directorio, no una web propia.');
  }

  // --- Pasada escritorio: rendimiento, contenido y captura ---
  progress('Abriendo el sitio web (escritorio)…');
  const desktop = await newDesktopContext(browser);
  let desktopRaw: RawWebsite | undefined;
  try {
    const page = await desktop.newPage();
    let bytes = 0;
    let requests = 0;
    page.on('response', async (res) => {
      requests++;
      const len = Number(res.headers()['content-length'] ?? 0);
      if (len) bytes += len;
    });
    const started = Date.now();
    const response = await page.goto(url, { waitUntil: 'load', timeout: 40_000 });
    const wallLoad = Date.now() - started;
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await dismissCookieBanners(page);

    base.reachable = !!response && response.status() < 400;
    base.httpStatus = response?.status();
    base.finalUrl = page.url();
    base.https = base.finalUrl.startsWith('https://');
    base.isSocialOrDirectory = isSocialOrDirectory(base.finalUrl) || base.isSocialOrDirectory;

    desktopRaw = (await page.evaluate(EXTRACT_WEBSITE)) as RawWebsite;
    base.loadTimeMs = Math.round(desktopRaw.nav.loadEventEnd || wallLoad);
    base.domContentLoadedMs = Math.round(desktopRaw.nav.domContentLoaded) || undefined;
    const transferred = desktopRaw.nav.transferSize + desktopRaw.resources.transferSize;
    base.pageWeightKb = Math.round((transferred || bytes) / 1024) || undefined;
    base.requestCount = Math.max(requests, desktopRaw.resources.count + 1);

    await capture(page, 'web-escritorio', 'Sitio web (escritorio)', 'website-desktop', opts);
  } catch (err) {
    base.reachable = false;
    base.error = (err as Error).message.split('\n')[0];
  } finally {
    await desktop.close().catch(() => {});
  }

  if (!base.reachable || !desktopRaw) {
    base.scores = { visual: 0, mobile: 0, speed: 0, contact: 0 };
    return base;
  }

  // --- Pasada móvil: adaptación y captura ---
  progress('Comprobando la versión móvil…');
  const mobile = await newMobileContext(browser);
  let mobileRaw: RawWebsite | undefined;
  try {
    const page = await mobile.newPage();
    await page.goto(base.finalUrl ?? url, { waitUntil: 'load', timeout: 40_000 });
    await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {});
    await dismissCookieBanners(page);
    mobileRaw = (await page.evaluate(EXTRACT_WEBSITE)) as RawWebsite;
    await capture(page, 'web-movil', 'Sitio web (móvil)', 'website-mobile', opts);
  } catch (err) {
    progress(`No se pudo cargar la versión móvil: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    await mobile.close().catch(() => {});
  }

  return mergeRaw(base, desktopRaw, mobileRaw);
}

async function capture(page: Page, id: string, label: string, source: Screenshot['source'], opts: WebsiteOptions) {
  const file = path.join('screenshots', `${id}.png`);
  await page.screenshot({ path: path.join(opts.screenshotDir, `${id}.png`), fullPage: false });
  opts.onScreenshot?.({ id, label, file, source });
}

async function dismissCookieBanners(page: Page): Promise<void> {
  const button = page
    .getByRole('button', { name: /^(aceptar|aceptar todo|aceptar todas|accept|accept all|entendido|ok|de acuerdo|allow all)$/i })
    .first();
  if ((await button.count().catch(() => 0)) > 0) {
    await button.click({ timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

export function emptyAnalysis(url: string): WebsiteAnalysis {
  return {
    url,
    reachable: false,
    https: url.startsWith('https://'),
    isSocialOrDirectory: isSocialOrDirectory(url),
    mobile: { hasViewportMeta: false, horizontalOverflow: false },
    contact: { phoneLinks: [], emailLinks: [], hasContactForm: false, hasAddress: false, contactAboveFold: false },
    whatsapp: { hasLink: false, links: [], hasFloatingButton: false },
    booking: { hasOnlineBooking: false, providers: [] },
    hasChatWidget: false,
    chatProviders: [],
    socialLinks: [],
    visual: { imageCount: 0, brokenImages: 0, hasH1: false, fontFamilies: [], usesModernLayout: false, legacyTech: [] },
    scores: { visual: 0, mobile: 0, speed: 0, contact: 0 },
    analyzedAt: new Date().toISOString(),
  };
}

/** Combina las pasadas de escritorio y móvil y calcula las puntuaciones. Función pura (testeable). */
export function mergeRaw(base: WebsiteAnalysis, d: RawWebsite, m?: RawWebsite): WebsiteAnalysis {
  const mob = m ?? d;
  const result: WebsiteAnalysis = {
    ...base,
    title: d.title || undefined,
    metaDescription: d.metaDescription || undefined,
    mobile: {
      hasViewportMeta: mob.hasViewportMeta,
      horizontalOverflow: m ? m.horizontalOverflow : false,
      smallTextRatio: m ? Math.round(m.smallTextRatio * 100) / 100 : undefined,
      tapTargetsTooSmall: m?.tapTargetsTooSmall,
    },
    contact: {
      phoneLinks: unique([...d.phoneLinks, ...mob.phoneLinks]),
      emailLinks: unique([...d.emailLinks, ...mob.emailLinks]),
      hasContactForm: d.hasContactForm || mob.hasContactForm,
      hasAddress: d.hasAddress,
      contactAboveFold: d.contactAboveFold || mob.contactAboveFold,
    },
    whatsapp: {
      links: unique([...d.whatsappLinks, ...mob.whatsappLinks]),
      hasLink: d.whatsappLinks.length + mob.whatsappLinks.length > 0,
      hasFloatingButton: d.hasFloatingWhatsapp || mob.hasFloatingWhatsapp,
    },
    booking: {
      providers: d.bookingProviders,
      hasOnlineBooking: d.bookingProviders.length > 0 || d.bookingKeywords,
    },
    chatProviders: d.chatProviders,
    hasChatWidget: d.chatProviders.length > 0,
    socialLinks: d.socialLinks,
    visual: {
      imageCount: d.imageCount,
      brokenImages: d.brokenImages,
      hasH1: d.hasH1,
      fontFamilies: d.fontFamilies,
      usesModernLayout: d.usesModernLayout,
      copyrightYear: d.copyrightYear || undefined,
      legacyTech: d.legacyTech,
    },
  };
  result.scores = scoreWebsite(result);
  return result;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function scoreWebsite(w: WebsiteAnalysis): WebsiteAnalysis['scores'] {
  if (!w.reachable) return { visual: 0, mobile: 0, speed: 0, contact: 0 };

  let visual = 100;
  if (!w.visual.usesModernLayout) visual -= 25;
  if (w.visual.legacyTech.length) visual -= 10 * w.visual.legacyTech.length;
  if (w.visual.imageCount < 3) visual -= 15;
  if (w.visual.brokenImages > 0) visual -= 10;
  if (!w.visual.hasH1) visual -= 5;
  if (!w.title) visual -= 5;
  if (!w.metaDescription) visual -= 5;
  if (!w.https) visual -= 10;
  const year = new Date().getFullYear();
  if (w.visual.copyrightYear && year - w.visual.copyrightYear >= 3) visual -= 15;
  if (w.isSocialOrDirectory) visual = Math.min(visual, 30);

  let mobile = 100;
  if (!w.mobile.hasViewportMeta) mobile -= 45;
  if (w.mobile.horizontalOverflow) mobile -= 25;
  if ((w.mobile.smallTextRatio ?? 0) > 0.3) mobile -= 15;
  if ((w.mobile.tapTargetsTooSmall ?? 0) > 15) mobile -= 10;

  let speed = 100;
  const load = w.loadTimeMs ?? 0;
  if (load > 8000) speed -= 60;
  else if (load > 5000) speed -= 40;
  else if (load > 3000) speed -= 20;
  else if (load > 2000) speed -= 8;
  const weight = w.pageWeightKb ?? 0;
  if (weight > 5000) speed -= 25;
  else if (weight > 3000) speed -= 15;
  else if (weight > 2000) speed -= 8;
  if ((w.requestCount ?? 0) > 150) speed -= 10;

  let contact = 0;
  if (w.contact.phoneLinks.length) contact += 25;
  if (w.whatsapp.hasLink) contact += 25;
  if (w.contact.emailLinks.length || w.contact.hasContactForm) contact += 20;
  if (w.contact.contactAboveFold) contact += 15;
  if (w.contact.hasAddress) contact += 15;

  return { visual: clamp(visual), mobile: clamp(mobile), speed: clamp(speed), contact: clamp(contact) };
}
