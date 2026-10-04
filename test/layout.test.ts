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
  const prof = { ...profile('Estética Bella Vista Centro de Estética Integral y Spa'), dataQuality: wideQuality() };
  prospectId = repo.saveAnalysis(buildAnalysis('https://maps.app.goo.gl/x', prof, undefined, { durationMs: 0 }), { userId: admin.id }).id;
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
    if (r.width && !inScroller(el) && (r.right > mr.right + 1 || r.left < mr.left - 1)) { issues.push('se sale: ' + (el.className || el.tagName)); break; }
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

    await page.goto(`${base}/configuracion`);
    await page.waitForSelector('#edit-prices');
    const c = (await page.evaluate(CHECK)) as { issues: string[] };
    assert.deepEqual(c.issues, [], `configuración ${w}: ${c.issues.join(' | ')}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
