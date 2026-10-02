import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from 'playwright';
import { config } from '../config/index.js';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: config.browser.headless,
    executablePath: config.browser.executablePath,
    // El sandbox de Chromium aísla las webs visitadas. Solo se desactiva cuando el sistema
    // no lo permite (ejecución como root, p. ej. contenedores).
    args: ['--disable-blink-features=AutomationControlled', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  });
}

function baseContext(): BrowserContextOptions {
  const lang = config.browser.mapsLanguage;
  return {
    locale: lang === 'es' ? 'es-ES' : lang,
    extraHTTPHeaders: { 'Accept-Language': `${lang},es;q=0.9,en;q=0.8` },
    ignoreHTTPSErrors: true,
  };
}

export async function newDesktopContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    ...baseContext(),
    userAgent: DESKTOP_UA,
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 1,
  });
  ctx.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs);
  ctx.setDefaultTimeout(15_000);
  return ctx;
}

export async function newMobileContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    ...baseContext(),
    userAgent: MOBILE_UA,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  ctx.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs);
  ctx.setDefaultTimeout(15_000);
  return ctx;
}
