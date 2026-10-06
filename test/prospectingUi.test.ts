/**
 * Interfaz de Prospección y Modo Prospección Rápida con Chromium real (interfaz web verdadera,
 * datos de un Google Maps simulado): flujo completo, botones sin superposición, "Copiar mensaje",
 * WhatsApp en UNA sola pestaña reutilizada, Contactado → siguiente, y sin desbordes en 1366 y móvil.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { ROOT_DIR } from '../src/config/index.js';
import { launchBrowser } from '../src/scraper/browser.js';
import { loggedClient, startApp } from './helpers.js';
import { barberias, FakeMaps } from './prospectingFixtures.js';

let app: Awaited<ReturnType<typeof startApp>>;
let browser: Browser;
let campaignId = '';

before(async () => {
  const maps = new FakeMaps({ barberías: barberias() });
  app = await startApp({}, { generate: maps.generate, analyze: maps.analyze }, { webDir: path.join(ROOT_DIR, 'web') });
  const admin = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván Bologna');
  await admin.post('/api/prospeccion/buscar', { rubro: 'Barberías', zona: 'Quilmes', cantidad: 6 });
  for (let i = 0; i < 200; i++) {
    const { body } = await admin.get('/api/prospeccion/trabajo');
    if (body.job?.phase === 'terminado') { campaignId = body.job.campaignId; break; }
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(campaignId, 'la búsqueda de prueba terminó');
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

for (const [w, h] of [[1366, 768], [390, 844]] as const) {
  test(`Prospección y modo rápido ${w}x${h}: sin superposiciones ni desbordes`, { timeout: 90_000 }, async () => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await login(page);

    await page.goto(`${app.base}/prospeccion`);
    await page.waitForSelector('.camp');
    assert.match(await page.textContent('.camp-head h3') ?? '', /BARBERÍAS — QUILMES/);
    assert.match(await page.textContent('.camp-stats') ?? '', /6\s*encontrados[\s\S]*6\s*analizados/);
    await page.waitForSelector('.pros-row');
    assert.equal(await page.locator('.pros-row').count(), 6);
    assert.equal(await page.locator('#nav a[href="/generador"]').count(), 0, 'el Generador no está en el menú');
    assert.equal(await page.getAttribute('.gen-footlink a', 'href'), '/generador', 'se llega desde Prospección');
    assert.deepEqual(await page.evaluate(NO_OVERFLOW), [], `prospección ${w}`);
    if (process.env.LAYOUT_SHOTS) await page.screenshot({ path: `${process.env.LAYOUT_SHOTS}/prospeccion-${w}.png`, fullPage: true });

    await page.click('.camp-actions a.btn-primary');
    await page.waitForSelector('.rq-card');
    assert.match(await page.textContent('#rq-camp') ?? '', /BARBERÍAS — QUILMES/);
    assert.match(await page.textContent('#rq-left') ?? '', /6 pendientes/);
    const b = (await page.evaluate(BUTTONS_OK('.rq-contact .btn, .rq-result .btn'))) as { issues: string[]; count: number };
    assert.deepEqual(b.issues, [], `botones ${w}`);
    assert.ok(b.count >= 9, 'Copiar, WhatsApp, Instagram, Maps, Web, Contactado, Después, No interesado, Siguiente');
    assert.deepEqual(await page.evaluate(NO_OVERFLOW), [], `modo rápido ${w}`);
    if (process.env.LAYOUT_SHOTS) await page.screenshot({ path: `${process.env.LAYOUT_SHOTS}/rapida-${w}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('20. "Copiar mensaje", WhatsApp en una sola pestaña, Contactado → siguiente, Siguiente salta', { timeout: 90_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const opened: string[] = [];
  await ctx.route(/^https:\/\/wa\.me\//, (route) => { opened.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: 'Click to Chat' }); });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto(`${app.base}/prospeccion/rapida?campana=${encodeURIComponent(campaignId)}`);
  await page.waitForSelector('.rq-card');

  // Tamaños del mensaje (completo, mediano, corto), "Otra versión" y por qué dice lo que dice.
  assert.deepEqual(await page.$$eval('.rq-tabs [data-k]', (bs) => bs.map((b) => b.textContent)), ['Completo', 'Mediano', 'Corto']);
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const completo = await page.inputValue('#rq-text');
  await page.click('.rq-tabs [data-k="primerContactoMedio"]');
  const medio = await page.inputValue('#rq-text');
  await page.click('.rq-tabs [data-k="primerContactoCorto"]');
  const corto = await page.inputValue('#rq-text');
  assert.ok(words(corto) < words(medio) && words(medio) < words(completo), `${words(corto)} < ${words(medio)} < ${words(completo)}`);
  assert.ok(words(completo) >= 80 && words(completo) <= 150);
  for (const t of [completo, medio, corto]) assert.match(t, /\?$/, 'termina con una pregunta');
  assert.match(await page.textContent('#rq-insight') ?? '', /Motivo comercial[\s\S]*Dolor económico[\s\S]*Beneficio comunicado/);
  await page.click('.rq-tabs [data-k="primerContacto"]');
  await page.click('#rq-regen');
  await page.waitForFunction((t) => (document.querySelector('#rq-text') as HTMLTextAreaElement).value !== t, completo);
  const otra = await page.inputValue('#rq-text');
  assert.ok(words(otra) >= 80 && words(otra) <= 150, 'la otra versión respeta el largo');
  assert.equal(await page.getAttribute('#rq-wa', 'href'), (await page.getAttribute('#rq-wa', 'href'))!.replace(/text=.*/, `text=${encodeURIComponent(otra)}`), 'WhatsApp lleva la versión nueva');

  // Copiar mensaje: lo que queda en el portapapeles es exactamente el mensaje (editable) del prospecto.
  const first = await page.textContent('.rq-name');
  await page.fill('#rq-text', `${await page.inputValue('#rq-text')}\n\n¿Sí? Ñandú 💈`);
  await page.click('#rq-copy');
  assert.equal(await page.evaluate('navigator.clipboard.readText()'), await page.inputValue('#rq-text'));

  // WhatsApp: enlace oficial wa.me con número y mensaje, en la pestaña única "wa_prospeccion".
  const href = (await page.getAttribute('#rq-wa', 'href'))!;
  assert.match(href, /^https:\/\/wa\.me\/549\d{10}\?text=/);
  assert.equal(new URL(href).searchParams.get('text'), await page.inputValue('#rq-text'));
  assert.equal(await page.getAttribute('#rq-wa', 'target'), 'wa_prospeccion');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#rq-wa')]);
  await popup.waitForLoadState();
  assert.equal(popup.url(), href);
  assert.equal(await page.evaluate('navigator.clipboard.readText()'), await page.inputValue('#rq-text'), 'al tocar WhatsApp también se copia');

  // Contactado → pasa solo al siguiente (y el contactado no vuelve).
  await page.click('#rq-done');
  await page.waitForFunction((name) => { const el = document.querySelector('.rq-card .rq-name'); return !!el && el.textContent !== name; }, first);
  assert.match(await page.textContent('#rq-left') ?? '', /5 pendientes/);
  const second = await page.textContent('.rq-name');

  // WhatsApp del segundo prospecto: MISMA pestaña, sin abrir otra.
  const pagesBefore = ctx.pages().length;
  const href2 = (await page.getAttribute('#rq-wa', 'href'))!;
  await page.click('#rq-wa');
  await popup.waitForURL(href2);
  assert.equal(ctx.pages().length, pagesBefore, 'no se abrió una pestaña nueva');
  assert.deepEqual(opened, [href, href2]);

  // Siguiente → salta sin marcar (sigue pendiente).
  await page.click('#rq-next');
  await page.waitForFunction((name) => { const el = document.querySelector('.rq-card .rq-name'); return !!el && el.textContent !== name; }, second);
  assert.match(await page.textContent('#rq-left') ?? '', /5 pendientes/, 'saltear no cuenta como contactado');

  // Contactar después: pide fecha y lo agenda.
  const third = await page.textContent('.rq-name');
  await page.click('#rq-later');
  await page.click('#rq-later-ok');
  await page.waitForFunction((name) => { const el = document.querySelector('.rq-card .rq-name'); return !!el && el.textContent !== name; }, third);
  assert.match(await page.textContent('#rq-left') ?? '', /4 pendientes/);

  // De vuelta en Prospección: Próximos contactos y resumen de campaña al día.
  await page.goto(`${app.base}/prospeccion`);
  await page.waitForSelector('.next-list li');
  assert.match(await page.textContent('.next-list') ?? '', new RegExp(third!.trim()));
  assert.match(await page.textContent('.camp-stats') ?? '', /4\s*no contactados[\s\S]*1\s*contactados[\s\S]*1\s*para después/);
  assert.deepEqual(errors, []);
  await ctx.close();
});
