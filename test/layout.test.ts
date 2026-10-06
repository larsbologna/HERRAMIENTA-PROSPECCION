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
  const ids = ['#verify', '#wa', '#ig', '#copy', '#sent'];
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
  if (wa && !(wa.getAttribute('href') || '').startsWith('https://wa.me/5493415550000?text=')) issues.push('#wa sin el número confirmado: ' + wa.getAttribute('href'));
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
