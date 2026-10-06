/**
 * Layout responsive con Chromium real: ningún contenido se sale de su columna, la columna principal
 * del perfil nunca queda debajo de los paneles laterales y no hay scroll horizontal.
 * Resoluciones: 1920x1080, 1366x768, 1280x800 y móvil (390x844).
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import type { Browser } from 'playwright';
import { buildAnalysis } from '../src/analyzer.js';
import { buildChannelReport } from '../src/channels/crossCheck.js';
import type { InstagramAnalysis } from '../src/channels/instagram.js';
import { createApp } from '../src/api/app.js';
import { UserRepository } from '../src/auth/users.js';
import { CrmRepository } from '../src/crm/repository.js';
import { openDatabase } from '../src/db/database.js';
import { FIELD_LABELS, type DataField, type DataQuality } from '../src/domain/reliability.js';
import { loadPriceList } from '../src/proposal/budget.js';
import { launchBrowser } from '../src/scraper/browser.js';
import { profile } from './helpers.js';

let browser: Browser;
let server: ReturnType<typeof createApp>;
let base = '';
let prospectId = '';

/** Confiabilidad con textos largos sin espacios (el caso que estiraba la columna principal). */
function wideQuality(): DataQuality {
  const fields = Object.fromEntries((Object.keys(FIELD_LABELS) as DataField[]).map((f) => [f, {
    field: f, label: FIELD_LABELS[f], status: 'encontrado', value: 'https://www.ejemplo-de-negocio-con-dominio-largo.com.ar/contacto',
    confidence: 'alta', source: 'Encabezado de la ficha (nombre, calificación, categoría)', method: 'Selector button.DkEaL[data-item-id="authority"]',
  }])) as DataQuality['fields'];
  return { version: 1, pageLoaded: true, blocked: false, panelFullyLoaded: true, fields };
}

before(async () => {
  let prices = loadPriceList();
  const db = openDatabase(':memory:');
  const repo = new CrmRepository(db, () => prices, (p) => { prices = p; });
  const users = new UserRepository(db);
  const admin = await users.create({ name: 'Ivan Bologna', username: 'ivan', password: 'secreta123', role: 'admin' });
  const prof = { ...profile('Estética Bella Vista Centro de Estética Integral y Spa'), dataQuality: wideQuality(), socialLinks: ['https://www.instagram.com/esteticabellavista.centro.integral/'] };
  // Instagram con Linktree (reservas y WhatsApp) y una web con dominio largo: tarjeta de canales completa y botones de contacto.
  const ig: InstagramAnalysis = {
    url: prof.socialLinks[0]!, username: 'esteticabellavista.centro.integral', status: 'ok', links: ['https://linktr.ee/esteticabellavista'], contactAvailable: true,
    linktree: 'https://linktr.ee/esteticabellavista', linktreeChecked: true, manualBooking: false, notes: [], checkedAt: '', followers: 12850,
    linktreeLinks: ['https://www.agendapro.com/ar/esteticabellavistacentrointegralyspa', 'https://wa.me/5493415550000', 'https://www.ejemplo-de-negocio-con-dominio-largo.com.ar/'],
    bookingUrl: 'https://www.agendapro.com/ar/esteticabellavistacentrointegralyspa', bookingProvider: 'AgendaPro', whatsappLink: 'https://wa.me/5493415550000',
    whatsappNumber: '5493415550000', website: 'https://www.ejemplo-de-negocio-con-dominio-largo.com.ar/',
  };
  const channels = buildChannelReport(prof, undefined, ig, { igWebsiteReachable: true });
  prospectId = repo.saveAnalysis(buildAnalysis('https://maps.app.goo.gl/x', prof, undefined, { durationMs: 0 }, channels), { userId: admin.id }).id;
  repo.addFollowup(prospectId, { dueAt: new Date(Date.now() + 86_400_000).toISOString(), note: 'Llamar para mandar el presupuesto y confirmar la reunión del jueves' }, admin.id);
  server = createApp({ repo, users, log: () => {} }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  server.close();
});

const CHECK = `(() => {
  const issues = [];
  if (document.scrollingElement.scrollWidth > innerWidth + 1) issues.push('scroll horizontal: ' + document.scrollingElement.scrollWidth);
  const main = document.querySelector('.main'), mr = main.getBoundingClientRect();
  const inScroller = (el) => { for (let p = el.parentElement; p && p !== main; p = p.parentElement) if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) return true; return false; };
  for (const el of main.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width && !inScroller(el) && (r.right > mr.right + 1 || r.left < mr.left - 1)) { issues.push('se sale: ' + (el.className || el.tagName) + ' ' + (el.textContent || '').slice(0, 80)); break; }
  }
  for (const sel of ['#logout', '#account']) { const r = document.querySelector(sel)?.getBoundingClientRect(); if (!r || !r.width || r.right > innerWidth + 1) issues.push(sel + ' fuera de pantalla'); }
  const prof = document.querySelector('.profile');
  if (prof) {
    const [a, b] = prof.children, ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    let right = ra.right;
    for (const el of a.querySelectorAll('*')) { if (!inScroller(el)) { const r = el.getBoundingClientRect(); if (r.width) right = Math.max(right, r.right); } }
    const side = rb.top < ra.bottom && rb.left > ra.left;
    if (side && right > rb.left + 1) issues.push('la columna principal pasa debajo del panel lateral');
    if (side && ra.width < 560) issues.push('columna principal angosta: ' + Math.round(ra.width));
    return { issues, side, mainWidth: Math.round(ra.width) };
  }
  return { issues };
})()`;

/** Botones de contacto y de verificación: visibles, sin pisarse entre sí y dentro de su tarjeta. */
const BUTTONS = `(() => {
  const issues = [];
  const ids = ['#verify', '#wa', '#ig', '#copy', '#sent', ...(document.querySelector('#wa-mode') ? ['#wa-mode'] : [])];
  const rects = ids.map((s) => [s, document.querySelector(s)?.getBoundingClientRect()]);
  for (const [s, r] of rects) if (!r || !r.width || !r.height) issues.push(s + ' no visible');
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [sa, a] = rects[i], [sb, b] = rects[j];
    if (a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) issues.push(sa + ' se superpone con ' + sb);
  }
  for (const [s, r] of rects) {
    const card = document.querySelector(s)?.closest('.card')?.getBoundingClientRect();
    if (r && card && (r.right > card.right + 1 || r.left < card.left - 1)) issues.push(s + ' se sale de su tarjeta');
  }
  const wa = document.querySelector('#wa');
  const href = (wa && wa.getAttribute('href')) || '';
  if (wa && !href.includes('wa.me/5493415550000') && !href.includes('phone=5493415550000')) issues.push('#wa no abre el chat del negocio: ' + href);
  if (document.querySelectorAll('.ch-row').length < 8) issues.push('faltan filas de canales');
  return issues;
})()`;

for (const [w, h, expectSide] of [[1920, 1080, true], [1366, 768, true], [1280, 800, false], [390, 844, false]] as const) {
  test(`layout ${w}x${h}: perfil y configuración sin superposiciones ni desbordes`, { timeout: 60_000 }, async () => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/`);
    await page.fill('input[name=username]', 'ivan');
    await page.fill('input[name=password]', 'secreta123');
    await page.click('#login button[type=submit]');
    await page.waitForSelector('#nav a');

    await page.goto(`${base}/prospectos/${prospectId}`);
    await page.waitForSelector('#datos');
    const r = (await page.evaluate(CHECK)) as { issues: string[]; side: boolean; mainWidth: number };
    assert.deepEqual(r.issues, [], `perfil ${w}: ${r.issues.join(' | ')}`);
    assert.equal(r.side, expectSide, `paneles ${expectSide ? 'al costado' : 'debajo'} en ${w}px`);
    const b = (await page.evaluate(BUTTONS)) as string[];
    assert.deepEqual(b, [], `botones ${w}: ${b.join(' | ')}`);
    if (process.env.LAYOUT_SHOTS) {
      for (const sel of ['#canales', '#mensajes']) await page.locator(sel).first().screenshot({ path: `${process.env.LAYOUT_SHOTS}/${w}-${sel.slice(1)}.png` }).catch(() => {});
    }

    await page.goto(`${base}/configuracion`);
    await page.waitForSelector('#edit-prices');
    const c = (await page.evaluate(CHECK)) as { issues: string[] };
    assert.deepEqual(c.issues, [], `configuración ${w}: ${c.issues.join(' | ')}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

/**
 * "Abrir WhatsApp" con WhatsApp Desktop en distintos estados. La app de escritorio no existe en este
 * entorno (Linux, sin pantalla): lo que se prueba es el lado de la herramienta, que tiene que ser
 * IDÉNTICO en todos los casos: un enlace normal a https://wa.me/… abierto por el navegador, sin
 * whatsapp://, sin cambiar la página actual y sin depender del foco ni de si la app está abierta.
 * Cada caso simula lo que el navegador "ve" cuando Windows le pasa el enlace a WhatsApp Desktop.
 */
const WA_STATES: Array<[string, string]> = [
  ['A. WhatsApp Desktop cerrado', 'none'],
  ['B. WhatsApp Desktop abierto y funcionando', 'app-takes-focus'],
  ['C. WhatsApp Desktop minimizado', 'app-restored-browser-hidden'],
  ['D. WhatsApp Desktop abierto en segundo plano', 'browser-keeps-focus'],
];
for (const [name, state] of WA_STATES) {
  test(`${name}: "Abrir WhatsApp" abre el chat oficial wa.me con el mensaje`, { timeout: 60_000 }, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    // Sin internet: wa.me y WhatsApp Web se responden con páginas simuladas.
    const opened: string[] = [];
    await ctx.route(/^https:\/\/(wa\.me|web\.whatsapp\.com)\//, (route) => {
      opened.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>WhatsApp</title>Click to Chat' });
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/`);
    await page.fill('input[name=username]', 'ivan');
    await page.fill('input[name=password]', 'secreta123');
    await page.click('#login button[type=submit]');
    await page.waitForSelector('#nav a');
    await page.goto(`${base}/prospectos/${prospectId}`);
    await page.waitForSelector('#wa');
    const toolUrl = page.url();
    const mainNavigations: string[] = [];
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) mainNavigations.push(f.url()); });

    const message = await page.inputValue('#msg');
    const expected = `https://wa.me/5493415550000?text=${encodeURIComponent(message)}`;
    assert.equal(await page.getAttribute('#wa', 'href'), expected, 'enlace oficial Click to Chat con el número y el mensaje');
    assert.equal(await page.getAttribute('#wa', 'target'), 'wa_prospeccion', 'siempre la misma pestaña (no una nueva por prospecto)');

    if (state === 'browser-keeps-focus') await page.bringToFront();
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#wa')]);
    // Lo que pasa en el navegador cuando Windows le entrega el enlace a WhatsApp Desktop.
    if (state === 'app-takes-focus' || state === 'app-restored-browser-hidden') {
      // (como texto: el transpilador de los tests no debe tocar el código que corre en la página)
      await page.evaluate(`(() => {
        window.dispatchEvent(new Event('blur'));
        if (${state === 'app-restored-browser-hidden'}) {
          Object.defineProperty(document, 'hidden', { configurable: true, get() { return true; } });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get() { return 'hidden'; } });
          document.dispatchEvent(new Event('visibilitychange'));
        }
      })()`);
    }
    await popup.waitForLoadState();
    await page.waitForTimeout(3000); // más que cualquier temporizador: no tiene que pasar nada más

    assert.equal(popup.url(), expected, 'se abrió exactamente el enlace wa.me');
    assert.deepEqual(opened, [expected], 'una sola apertura, sin whatsapp:// ni reintentos');
    assert.equal(page.url(), toolUrl, 'la herramienta no navega a otro lado');
    assert.deepEqual(mainNavigations, []);
    // Respaldo siempre disponible después del clic, sin depender del foco.
    assert.ok(await page.isVisible('#wa-fallback #wa-web'));
    const web = new URL((await page.getAttribute('#wa-web', 'href'))!);
    assert.equal(web.origin + web.pathname, 'https://web.whatsapp.com/send');
    assert.equal(web.searchParams.get('phone'), '5493415550000');
    assert.equal(web.searchParams.get('text'), message);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('"Abrir WhatsApp" no usa whatsapp://, window.location, window.open ni maneja el proceso de WhatsApp', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(js|ts|html|bat|command)$/.test(e.name) ? [path.join(dir, e.name)] : []);
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
  const front = walk(path.join(root, 'web'));
  for (const f of front) {
    const code = strip(readFileSync(f, 'utf8'));
    assert.doesNotMatch(code, /whatsapp:\/\//i, `${f}: protocolo whatsapp://`);
    assert.doesNotMatch(code, /window\.open\s*\(|window\.location|location\.(href|assign|replace)\s*[=(]/, `${f}: apertura manual`);
  }
  for (const f of [...front, ...walk(path.join(root, 'src')), ...['iniciar.bat', 'iniciar.command'].map((x) => path.join(root, x))].filter((x) => { try { return !!readFileSync(x); } catch { return false; } })) {
    const code = strip(readFileSync(f, 'utf8'));
    assert.doesNotMatch(code, /WhatsApp\.exe|taskkill|Stop-Process|openExternal|electron|tauri|ms-windows-store/i, `${f}: manejo del proceso de WhatsApp`);
  }
});
