/**
 * Sección PROSPECTOS unificada y "Siguiente prospecto" con Chromium real (interfaz web verdadera,
 * datos de un Google Maps simulado): filtro de rubros dinámico, "Agregar rubro", vocabulario por
 * rubro (veterinaria = turnos, pet shop = productos), Copiar mensaje, WhatsApp en UNA sola pestaña,
 * Instagram con su versión corta, Siguiente que respeta el rubro y sin desbordes en 1366 y móvil.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { ROOT_DIR } from '../src/config/index.js';
import { launchBrowser } from '../src/scraper/browser.js';
import { loggedClient, startApp } from './helpers.js';
import { barberias, FakeMaps, petShops, veterinarias } from './prospectingFixtures.js';

let app: Awaited<ReturnType<typeof startApp>>;
let browser: Browser;

before(async () => {
  const maps = new FakeMaps({ barberías: barberias(), veterinarias: veterinarias(), 'pet shops': petShops() });
  app = await startApp({}, { generate: maps.generate, analyze: maps.analyze }, { webDir: path.join(ROOT_DIR, 'web') });
  const admin = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván Bologna');
  for (const [rubro, cantidad] of [['Barberías', 6], ['Veterinarias', 4], ['Pet Shops', 3]] as const) {
    await admin.post('/api/prospeccion/buscar', { rubro, zona: 'Quilmes', cantidad });
    let done = false;
    for (let i = 0; i < 400 && !done; i++) {
      const { body } = await admin.get('/api/prospeccion/trabajo');
      done = body.job?.phase === 'terminado' && body.job.rubro === rubro;
      if (!done) await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(done, `terminó la búsqueda de ${rubro}`);
  }
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  app.close(); // (webDir es la interfaz real: no se borra)
});

async function login(page: Page) {
  await page.goto(`${app.base}/`);
  await page.fill('input[name=username]', 'ivan');
  await page.fill('input[name=password]', 'secreta123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#nav a');
}

const NO_OVERFLOW = `(() => {
  const issues = [];
  if (document.scrollingElement.scrollWidth > innerWidth + 1) issues.push('scroll horizontal ' + document.scrollingElement.scrollWidth);
  const main = document.querySelector('.main').getBoundingClientRect();
  const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX + getComputedStyle(p).overflowY) && p !== document.body) return true; return false; };
  for (const el of document.querySelectorAll('.main *')) {
    const r = el.getBoundingClientRect();
    if (r.width && !inScroller(el) && (r.right > main.right + 1 || r.left < main.left - 1)) { issues.push('se sale: ' + (el.id || el.className || el.tagName)); break; }
  }
  return issues;
})()`;
const BUTTONS_OK = (sel: string) => `(() => {
  const els = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter((e) => e.getBoundingClientRect().width);
  const issues = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) issues.push((els[i].id || els[i].textContent.trim()) + ' pisa a ' + (els[j].id || els[j].textContent.trim()));
  }
  return { issues, count: els.length };
})()`;
const optionTexts = (page: Page, sel: string) => page.$$eval(`${sel} option`, (os) => os.map((o) => o.textContent ?? ''));
const names = (page: Page) => page.$$eval('.pros-row .pros-name', (as) => as.map((a) => a.textContent ?? ''));

for (const [w, h] of [[1366, 768], [390, 844]] as const) {
  test(`Prospectos y Siguiente ${w}x${h}: sin superposiciones ni desbordes`, { timeout: 90_000 }, async () => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await login(page);

    await page.goto(`${app.base}/prospectos`);
    await page.waitForSelector('.pros-row');
    assert.equal(await page.locator('.pros-row').count(), 13);
    assert.equal(await page.locator('#nav a[href="/pipeline"]').count(), 0, 'Pipeline ya no está en el menú');
    assert.equal(await page.locator('#nav a[href="/generador"]').count(), 0);
    assert.deepEqual(await page.evaluate(NO_OVERFLOW), [], `prospectos ${w}`);
    await page.click('.pros-row [data-msg]');
    await page.waitForSelector('.pl-drawer:not([hidden]) .cp-text');
    const b = (await page.evaluate(BUTTONS_OK('.pl-drawer:not([hidden]) .btn'))) as { issues: string[]; count: number };
    assert.deepEqual(b.issues, [], `botones del mensaje ${w}`);
    assert.deepEqual(await page.evaluate(NO_OVERFLOW), [], `mensaje abierto ${w}`);
    if (process.env.LAYOUT_SHOTS) await page.screenshot({ path: `${process.env.LAYOUT_SHOTS}/prospectos-${w}.png`, fullPage: true });

    await page.click('#next-btn');
    await page.waitForSelector('.rq-card');
    const r = (await page.evaluate(BUTTONS_OK('.rq-panel .btn, .rq-result .btn'))) as { issues: string[]; count: number };
    assert.deepEqual(r.issues, [], `botones siguiente ${w}`);
    assert.ok(r.count >= 8, 'Copiar, WhatsApp, Instagram, Maps, Contactado, No interesado, Ver análisis, Siguiente');
    assert.deepEqual(await page.evaluate(NO_OVERFLOW), [], `siguiente ${w}`);
    if (process.env.LAYOUT_SHOTS) await page.screenshot({ path: `${process.env.LAYOUT_SHOTS}/siguiente-${w}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('Filtro de rubros dinámico, vocabulario por rubro y "Agregar rubro"', { timeout: 90_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto(`${app.base}/prospectos`);
  await page.waitForSelector('.pros-row');

  // El filtro muestra SOLO los rubros que tienen prospectos, con su cantidad.
  const opts = await optionTexts(page, '#fl-rubro');
  assert.ok(opts.includes('Veterinarias (4)'), opts.join(' | '));
  assert.ok(opts.includes('Pet Shops (3)'), opts.join(' | '));
  assert.ok(opts.some((o) => /^Barberías \(6\)$/.test(o)), opts.join(' | '));
  assert.ok(!opts.some((o) => /^Gimnasios/.test(o)), 'sin prospectos no aparece en el filtro');

  // Filtrar Veterinarias → solo veterinarias; el botón Siguiente lleva el filtro.
  await page.selectOption('#fl-rubro', 'veterinarias');
  await page.waitForFunction(() => document.querySelectorAll('.pros-row').length === 4);
  assert.ok((await names(page)).every((n) => n.startsWith('Veterinaria Laprida')));
  assert.match((await page.getAttribute('#next-btn', 'href'))!, /rubro=veterinarias/);

  // Veterinaria: habla de turnos, nunca de reservas.
  await page.click('.pros-row [data-msg]');
  await page.waitForSelector('.pl-drawer:not([hidden]) .cp-text');
  const tabs = await page.$$eval('.pl-drawer:not([hidden]) .cp-tabs [data-k]', (bs) => bs.map((b) => b.textContent));
  assert.deepEqual(tabs, ['Completo', 'Mediano', 'Corto', 'Instagram']);
  for (const k of ['primerContacto', 'primerContactoMedio', 'primerContactoCorto', 'instagram']) {
    await page.click(`.pl-drawer:not([hidden]) .cp-tabs [data-k="${k}"]`);
    const t = await page.inputValue('.pl-drawer:not([hidden]) .cp-text');
    assert.doesNotMatch(t, /reserv/i, `veterinaria ${k}`);
  }
  assert.match(await page.textContent('.pl-drawer:not([hidden]) .cp-opps') ?? '', /Fuente:[\s\S]*Evidencia:[\s\S]*Confianza/);

  // Pet shop: ni turnos ni reservas en ninguna versión.
  await page.selectOption('#fl-rubro', 'pet-shops');
  await page.waitForFunction(() => document.querySelectorAll('.pros-row').length === 3);
  await page.click('.pros-row [data-msg]');
  await page.waitForSelector('.pl-drawer:not([hidden]) .cp-text');
  for (const k of ['primerContacto', 'primerContactoMedio', 'primerContactoCorto', 'instagram']) {
    await page.click(`.pl-drawer:not([hidden]) .cp-tabs [data-k="${k}"]`);
    const t = await page.inputValue('.pl-drawer:not([hidden]) .cp-text');
    assert.doesNotMatch(t, /turno|reserv/i, `pet shop ${k}`);
  }

  // Agregar rubro: queda en la búsqueda y en el selector para asignarlo.
  await page.click('#add-rubro');
  await page.fill('#rubro-form [name=label]', 'Viveros');
  await page.selectOption('#rubro-form [name=model]', 'productos');
  await page.fill('#rubro-form [name=keywords]', 'plantas, jardín');
  await page.click('#rubro-form button[type=submit]');
  await page.waitForFunction(() => (document.querySelector('#f-rubro') as HTMLSelectElement).value === 'Viveros');
  assert.ok((await optionTexts(page, '#f-rubro')).includes('Viveros'));
  assert.ok((await optionTexts(page, '.pl-drawer:not([hidden]) [data-rubro]')).length > 0);

  // Persiste: después de recargar sigue estando.
  await page.reload();
  await page.waitForSelector('#f-rubro option', { state: 'attached' });
  assert.ok((await optionTexts(page, '#f-rubro')).includes('Viveros'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Copiar, WhatsApp en una sola pestaña, Instagram y Siguiente que respeta el rubro', { timeout: 90_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const opened: string[] = [];
  await ctx.route(/^https:\/\/wa\.me\//, (route) => { opened.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: 'Click to Chat' }); });
  await ctx.route(/^https:\/\/www\.instagram\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'Instagram' }));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto(`${app.base}/prospectos/siguiente?rubro=veterinarias`);
  await page.waitForSelector('.rq-card');
  assert.match(await page.textContent('#rq-camp') ?? '', /VETERINARIAS/);
  assert.match(await page.textContent('#rq-left') ?? '', /4 pendientes/);

  // Copiar mensaje: lo que queda en el portapapeles es exactamente el mensaje (editable).
  await page.fill('.rq-panel .cp-text', `${await page.inputValue('.rq-panel .cp-text')}\n\n¿Sí? Ñandú 🐾`);
  await page.click('.rq-panel [data-copy]');
  assert.equal(await page.evaluate('navigator.clipboard.readText()'), await page.inputValue('.rq-panel .cp-text'));

  // WhatsApp: wa.me con número y mensaje, en la pestaña única "wa_prospeccion"; no se envía solo.
  const href = (await page.getAttribute('.rq-panel [data-wa]', 'href'))!;
  assert.match(href, /^https:\/\/wa\.me\/549\d{10}\?text=/);
  assert.equal(new URL(href).searchParams.get('text'), await page.inputValue('.rq-panel .cp-text'));
  assert.equal(await page.getAttribute('.rq-panel [data-wa]', 'target'), 'wa_prospeccion');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('.rq-panel [data-wa]')]);
  await popup.waitForLoadState();
  assert.equal(popup.url(), href);

  // Contactado → pasa solo al siguiente, siempre otra veterinaria.
  const first = await page.textContent('.rq-name');
  await page.click('#rq-done');
  await page.waitForFunction((name) => { const el = document.querySelector('.rq-card .rq-name'); return !!el && el.textContent !== name; }, first);
  assert.match(await page.textContent('#rq-left') ?? '', /3 pendientes/);
  assert.match(await page.textContent('.rq-name') ?? '', /^Veterinaria/);

  // WhatsApp del segundo: MISMA pestaña.
  const pagesBefore = ctx.pages().length;
  const href2 = (await page.getAttribute('.rq-panel [data-wa]', 'href'))!;
  await page.click('.rq-panel [data-wa]');
  await popup.waitForURL(href2);
  assert.equal(ctx.pages().length, pagesBefore, 'no se abrió una pestaña nueva');
  assert.deepEqual(opened, [href, href2]);

  // Siguiente → salta sin marcar; nunca aparece una barbería ni un pet shop.
  for (let i = 0; i < 4; i++) {
    const cur = await page.textContent('.rq-name');
    await page.click('#rq-next');
    await page.waitForFunction((name) => { const el = document.querySelector('.rq-card .rq-name'); return !!el && el.textContent !== name; }, cur);
    assert.match(await page.textContent('.rq-name') ?? '', /^Veterinaria/);
  }
  assert.match(await page.textContent('#rq-left') ?? '', /3 pendientes/, 'saltear no cuenta como contactado');

  // Instagram (pet shops): abre el perfil y copia la versión corta para Instagram.
  await page.goto(`${app.base}/prospectos/siguiente?rubro=pet-shops`);
  await page.waitForSelector('.rq-card');
  assert.match(await page.textContent('.rq-name') ?? '', /^Pet Shop/);
  const igHref = (await page.getAttribute('.rq-panel [data-ig]', 'href'))!;
  assert.match(igHref, /^https:\/\/www\.instagram\.com\/mundoanimal\d\/$/);
  const completo = await page.inputValue('.rq-panel .cp-text');
  const [ig] = await Promise.all([ctx.waitForEvent('page'), page.click('.rq-panel [data-ig]')]);
  await ig.waitForLoadState();
  const igText = await page.inputValue('.rq-panel .cp-text');
  assert.equal(await page.getAttribute('.rq-panel .cp-tabs [data-k="instagram"]', 'class'), 'on');
  assert.ok(igText.length < completo.length, 'la versión de Instagram es más corta');
  assert.equal(await page.evaluate('navigator.clipboard.readText()'), igText);

  // De vuelta en Prospectos: el contactado figura como tal.
  await page.goto(`${app.base}/prospectos`);
  await page.selectOption('#fl-estado', 'contactado');
  await page.waitForFunction((name) => Array.from(document.querySelectorAll('.pros-row .pros-name')).some((a) => a.textContent === name), first);
  assert.deepEqual(errors, []);
  await ctx.close();
});
