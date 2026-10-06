/**
 * PROSPECCIÓN con Chromium real (interfaz verdadera, Google Maps simulado):
 * lista limpia sin tarjetas pisadas (1440 · 1280 · 1024 · 768 · 390), ficha de UN prospecto,
 * CONTACTAR según el canal real (WhatsApp con mensaje cargado en una sola pestaña, Instagram con
 * la versión corta copiada, Llamar, Web, Google Maps), Marcar contactado y Siguiente por rubro.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { ROOT_DIR } from '../src/config/index.js';
import { launchBrowser } from '../src/scraper/browser.js';
import { loggedClient, startApp } from './helpers.js';
import { barberias, FakeMaps, opticas, petShops, veterinarias } from './prospectingFixtures.js';

let app: Awaited<ReturnType<typeof startApp>>;
let browser: Browser;
const ids: Record<string, string> = {};

before(async () => {
  const maps = new FakeMaps({ barberías: barberias(), veterinarias: veterinarias(), 'pet shops': petShops(), ópticas: opticas() });
  app = await startApp({}, { generate: maps.generate, analyze: maps.analyze }, { webDir: path.join(ROOT_DIR, 'web') });
  const admin = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván Bologna');
  for (const [rubro, cantidad] of [['Barberías', 6], ['Veterinarias', 4], ['Pet Shops', 3], ['Ópticas', 6]] as const) {
    await admin.post('/api/prospeccion/buscar', { rubro, zona: 'Quilmes', cantidad });
    let done = false;
    for (let i = 0; i < 400 && !done; i++) {
      const { body } = await admin.get('/api/prospeccion/trabajo');
      done = body.job?.phase === 'terminado' && body.job.rubro === rubro;
      if (!done) await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(done, `terminó la búsqueda de ${rubro}`);
  }
  for (const p of (await admin.get('/api/prospeccion/prospectos?estado=todos')).body.items) ids[p.name] = p.id;
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
async function newPage(w = 1366, h = 900, clipboard = false): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(clipboard ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  return { ctx, page, errors };
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
/** Ningún par de elementos se pisa, y cada hijo queda DENTRO de su tarjeta. */
const NO_OVERLAP = (sel: string, inside?: string) => `(() => {
  const els = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter((e) => e.getBoundingClientRect().width);
  const issues = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) issues.push((els[i].id || els[i].textContent.trim().slice(0, 30)) + ' pisa a ' + (els[j].id || els[j].textContent.trim().slice(0, 30)));
  }
  ${inside ? `for (const card of document.querySelectorAll(${JSON.stringify(inside)})) { const c = card.getBoundingClientRect();
    for (const k of card.querySelectorAll('*')) { if (k.closest('details:not([open])') && !k.closest('summary')) continue; const r = k.getBoundingClientRect(); if (r.width && (r.right > c.right + 1 || r.bottom > c.bottom + 1 || r.left < c.left - 1)) { issues.push('se sale de la tarjeta: ' + (k.className || k.tagName)); break; } } }` : ''}
  return { issues, count: els.length };
})()`;

for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844]] as const) {
  test(`PROSPECCIÓN ${w}x${h}: lista limpia y ficha sin superposiciones ni desbordes`, { timeout: 90_000 }, async () => {
    const { ctx, page, errors } = await newPage(w, h);
    await page.goto(`${app.base}/prospeccion`);
    await page.waitForSelector('.pc');
    assert.equal(await page.textContent('.pp-title'), 'PROSPECCIÓN');
    assert.match(await page.textContent('#nav') ?? '', /Prospección/);
    assert.equal(await page.locator('#nav a[href="/pipeline"]').count(), 0);
    // Lo esencial: sin oportunidades, mensajes ni paneles en la lista.
    assert.equal(await page.locator('#pros-list .opp-chip, #pros-list textarea, #pros-list .pl-drawer').count(), 0, 'la lista no muestra análisis ni mensajes');
    const cards = (await page.evaluate(NO_OVERLAP('.pc', '.pc'))) as { issues: string[]; count: number };
    assert.deepEqual(cards.issues, [], `tarjetas ${w}`);
    const btns = (await page.evaluate(NO_OVERLAP('.pc .btn, .pc .pot, .pc .st-pill'))) as { issues: string[] };
    assert.deepEqual(btns.issues, [], `botones de la lista ${w}`);
    assert.deepEqual(await page.evaluate(NO_OVERFLOW), [], `lista ${w}`);
    await page.click('#toggle-search');
    assert.ok(await page.isVisible('#pros-form'), 'Buscar negocios abre el buscador');
    assert.deepEqual(await page.evaluate(NO_OVERFLOW), [], `buscador ${w}`);
    if (process.env.LAYOUT_SHOTS) await page.screenshot({ path: `${process.env.LAYOUT_SHOTS}/prospeccion-${w}.png`, fullPage: true });

    await page.goto(`${app.base}/prospeccion/p/${ids['Óptica Con WhatsApp']}`);
    await page.waitForSelector('.pv-card');
    const f = (await page.evaluate(NO_OVERLAP('.pv-card .btn, .pv-sec h2, .pv-head .pot, .pv-head .st-pill', '.pv-sec'))) as { issues: string[]; count: number };
    assert.deepEqual(f.issues, [], `ficha ${w}`);
    assert.deepEqual(await page.evaluate(NO_OVERFLOW), [], `ficha ${w}`);
    const ta = await page.$eval('.cp-text', (t) => ({ w: t.getBoundingClientRect().width, h: t.scrollHeight - t.clientHeight }));
    assert.ok(ta.w >= Math.min(320, w - 80), `el mensaje se lee cómodo (${ta.w}px)`);
    assert.ok(ta.h <= 2, 'el mensaje entra entero, sin scroll interno');
    if (process.env.LAYOUT_SHOTS) await page.screenshot({ path: `${process.env.LAYOUT_SHOTS}/ficha-${w}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('CASOS 1–6 en la ficha: CONTACTAR elige el canal real y nunca deja al prospecto sin acción', { timeout: 120_000 }, async () => {
  const { ctx, page, errors } = await newPage(1366, 900, true);
  const opened: string[] = [];
  await ctx.route(/^https:\/\/wa\.me\//, (route) => { opened.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: 'Click to Chat' }); });
  await ctx.route(/^https:\/\/(www\.instagram\.com|opticaweb\.com\.ar|www\.google\.com)\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
  const open = async (name: string) => {
    await page.goto(`${app.base}/prospeccion/p/${ids[name]}`);
    await page.waitForSelector('.pv-main-action .btn');
    return { act: await page.getAttribute('.pv-main-action .btn', 'data-act'), label: (await page.textContent('.pv-main-action .btn'))!.trim(), datos: (await page.textContent('#datos'))! };
  };

  // CASO 1 · Teléfono + WhatsApp confirmado → CONTACTAR POR WHATSAPP con el mensaje cargado.
  let c = await open('Óptica Con WhatsApp');
  assert.deepEqual([c.act, c.label], ['whatsapp', 'Contactar por WhatsApp']);
  assert.match(c.datos, /WhatsApp\s*✓?\s*\+5491132001111/);
  const href = (await page.getAttribute('.pv-main-action .btn', 'href'))!;
  assert.match(href, /^https:\/\/wa\.me\/5491132001111\?text=/);
  assert.equal(new URL(href).searchParams.get('text'), await page.inputValue('.cp-text'), 'CASO 9: el texto va prellenado');
  assert.equal(await page.getAttribute('.pv-main-action .btn', 'target'), 'wa_prospeccion');
  assert.equal(await page.isVisible('#rq-prompt'), false);
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('.pv-main-action .btn')]);
  await popup.waitForLoadState();
  assert.equal(popup.url(), href);
  assert.equal(await page.textContent('#rq-status'), 'No contactado', 'abrir el canal NO marca contactado');
  assert.ok(await page.isVisible('#rq-prompt'), 'pregunta si pudo contactarlo');
  await page.click('#rq-prompt [data-mark]');
  await page.waitForFunction(() => document.querySelector('#rq-status')?.textContent === 'Contactado');
  assert.ok(await page.getAttribute('[data-act="waweb"]', 'href'), 'alternativa WhatsApp Web');
  await page.click('[data-copy-wa]');
  assert.equal(await page.evaluate('navigator.clipboard.readText()'), '+5491132001111', '"Usar número"');

  // CASO 2 · Teléfono fijo sin WhatsApp → LLAMAR; WhatsApp "No detectado" y ningún botón de WhatsApp.
  c = await open('Óptica Teléfono Fijo');
  assert.deepEqual([c.act, c.label], ['telefono', 'Llamar · 011 4253-1234']);
  assert.equal(await page.getAttribute('.pv-main-action .btn', 'href'), 'tel:01142531234');
  assert.match(c.datos, /WhatsApp\s*✕\s*No detectado/);
  assert.equal(await page.locator('[data-act="whatsapp"], [data-act="watry"]').count(), 0, 'no hay botón de WhatsApp que falle');
  assert.ok(await page.isVisible('[data-copy-phone]'));
  assert.equal(await page.getAttribute('.cp-tabs .on', 'data-k'), 'telefono', 'muestra el guion para llamar');
  assert.match(await page.inputValue('.cp-text'), /¿Con quién podría hablar sobre eso\?$/);

  // CASO 3 · Instagram sin WhatsApp → CONTACTAR POR INSTAGRAM; copia la versión corta (CASO 10).
  c = await open('Óptica Instagram');
  assert.deepEqual([c.act, c.label], ['instagram', 'Contactar por Instagram']);
  await page.click('.cp-tabs [data-k="primerContacto"]');
  const wa = await page.inputValue('.cp-text');
  const [ig] = await Promise.all([ctx.waitForEvent('page'), page.click('.pv-main-action .btn')]);
  await ig.waitForLoadState();
  assert.match(ig.url(), /instagram\.com\/opticaig/);
  assert.equal(await page.getAttribute('.cp-tabs .on', 'data-k'), 'instagram');
  const igText = await page.inputValue('.cp-text');
  assert.ok(igText.length < wa.length / 1.8, 'Instagram más corto que WhatsApp');
  assert.equal(await page.evaluate('navigator.clipboard.readText()'), igText, 'queda copiado para pegar');
  assert.ok(await page.isVisible('#rq-prompt'));

  // CASO 4 · Celular sin confirmar → LLAMAR; se puede PROBAR WhatsApp, marcado como no confirmado.
  c = await open('Óptica Celular');
  assert.equal(c.act, 'telefono');
  assert.match(c.datos, /WhatsApp\s*\?\s*No confirmado/);
  assert.match((await page.getAttribute('[data-act="watry"]', 'href'))!, /^https:\/\/wa\.me\/5491132004444\?text=/);

  // CASO 5 · Sin WhatsApp, Instagram ni teléfono, con web → ABRIR WEB.
  c = await open('Óptica Solo Web');
  assert.deepEqual([c.act, c.label], ['web', 'Abrir web']);
  assert.equal(await page.getAttribute('.pv-main-action .btn', 'href'), 'https://opticaweb.com.ar');
  assert.match(c.datos, /Sin canal directo detectado/);

  // CASO 6 · Sin canales → Google Maps + información + copiar nombre.
  c = await open('Óptica Sin Canales');
  assert.deepEqual([c.act, c.label], ['maps', 'Abrir Google Maps']);
  assert.match(c.datos, /Sin canal directo detectado/);
  await page.click('[data-copy-name]');
  assert.equal(await page.evaluate('navigator.clipboard.readText()'), 'Óptica Sin Canales');
  assert.ok(await page.inputValue('.cp-text'), 'el mensaje sigue disponible');

  // La lista muestra lo mismo, como característica (no error).
  await page.goto(`${app.base}/prospeccion`);
  await page.selectOption('#fl-rubro', 'opticas');
  await page.waitForFunction(() => document.querySelectorAll('.pc').length === 5);
  assert.match(await page.textContent('#pros-list') ?? '', /Sin canal directo detectado/);
  assert.deepEqual(opened, [href]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('CASO 7: filtro Veterinarias → Ver prospecto → Contactar → Contactado y siguiente → otra veterinaria', { timeout: 120_000 }, async () => {
  const { ctx, page, errors } = await newPage(1280, 900, true);
  await ctx.route(/^https:\/\/wa\.me\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
  await page.goto(`${app.base}/prospeccion`);
  await page.waitForSelector('.pc');
  const opts = await page.$$eval('#fl-rubro option', (os) => os.map((o) => o.textContent));
  assert.ok(opts.includes('Veterinarias (4)'), opts.join(' | '));
  await page.selectOption('#fl-rubro', 'veterinarias');
  await page.waitForFunction(() => document.querySelectorAll('.pc').length === 4);
  assert.equal(await page.getAttribute('[data-estado="pendientes"]', 'class'), 'on', 'por defecto: No contactados');
  assert.match((await page.getAttribute('#next-btn', 'href'))!, /rubro=veterinarias/);

  // Contactar desde la lista abre la ficha con el contacto a la vista.
  await page.click('.pc [data-contact]');
  await page.waitForSelector('.pv-contact.pv-focus');
  assert.match(await page.textContent('#rq-camp') ?? '', /VETERINARIAS/);
  assert.match(await page.textContent('#rq-left') ?? '', /4 pendientes/);
  const seen = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const name = (await page.textContent('.rq-name'))!;
    assert.match(name, /^Veterinaria Laprida/, 'siempre una veterinaria');
    assert.ok(!seen.has(name), 'no repite un contactado');
    seen.add(name);
    assert.doesNotMatch(await page.inputValue('.cp-text'), /reserv/i, 'veterinaria: turnos, no reservas');
    await page.click('.pv-main-action .btn');
    await page.click('#rq-prompt [data-mark-next]');
    await page.waitForFunction((n) => { const el = document.querySelector('.rq-card .rq-name'); return !!el && el.textContent !== n; }, name);
  }
  assert.match(await page.textContent('#rq-left') ?? '', /1 pendiente\b/);
  // "Siguiente" sin marcar no cuenta como contactado.
  const last = await page.textContent('.rq-name');
  await page.evaluate(() => document.querySelector('.rq-card')!.setAttribute('data-old', '1'));
  await page.click('#rq-next');
  await page.waitForSelector('.rq-card:not([data-old])');
  assert.equal(await page.textContent('.rq-name'), last, 'queda uno solo: vuelve a ofrecer el mismo');
  await page.click('#rq-done');
  await page.waitForFunction(() => document.querySelector('#rq-status')?.textContent === 'Contactado');
  await page.click('#rq-next');
  await page.waitForSelector('.empty');
  assert.match(await page.textContent('.empty') ?? '', /No quedan prospectos sin contactar en Veterinarias/);

  // CASO 8: "Otra versión" cambia el mensaje (y su cierre).
  await page.goto(`${app.base}/prospeccion/p/${ids['Pet Shop Mundo Animal 1']}`);
  await page.waitForSelector('.cp-text');
  const v0 = await page.inputValue('.cp-text');
  assert.doesNotMatch(v0, /turno|reserv/i);
  await page.click('[data-regen]');
  await page.waitForFunction((t) => (document.querySelector('.cp-text') as HTMLTextAreaElement).value !== t, v0);
  assert.notEqual((await page.inputValue('.cp-text')).split('\n\n').at(-1), v0.split('\n\n').at(-1), 'otro CTA');

  // De vuelta en la lista: las 4 veterinarias figuran como contactadas.
  await page.goto(`${app.base}/prospeccion`);
  await page.click('[data-estado="contactado"]');
  await page.selectOption('#fl-rubro', 'veterinarias');
  await page.waitForFunction(() => document.querySelectorAll('.pc').length === 4);
  assert.deepEqual(errors, []);
  await ctx.close();
});
