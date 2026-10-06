/**
 * Interfaz del Generador de Prospectos con Chromium real (Google Maps simulado):
 * generar → lista ordenada por oportunidad → estado comercial → Analizar (flujo existente)
 * → informe → vínculo "Ver análisis". Más el layout en 1366 px y móvil.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { analyze } from '../src/analyzer.js';
import { createApp } from '../src/api/app.js';
import { UserRepository } from '../src/auth/users.js';
import { CrmRepository } from '../src/crm/repository.js';
import { openDatabase } from '../src/db/database.js';
import { generateProspects } from '../src/generator/generator.js';
import { GeneratorRepository } from '../src/generator/repository.js';
import { loadPriceList } from '../src/proposal/budget.js';
import { launchBrowser } from '../src/scraper/browser.js';
import { barberiasQuilmes, placePage, placeUrl, searchPage } from './fixtures/mapsSearch.js';

const { P, FEEDS } = barberiasQuilmes();
let maps: http.Server;
let mapsBase = '';
let app: ReturnType<typeof createApp>;
let base = '';
let browser: Browser;
let gen: GeneratorRepository;

before(async () => {
  maps = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]!);
    const send = (html: string) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    const search = url.match(/^\/maps\/search\/(.+)$/);
    if (search) return send(searchPage((FEEDS[search[1]!] ?? []).map((s) => ({ place: P[s]!, url: placeUrl(mapsBase, P[s]!) }))));
    const pl = url.match(/^\/maps\/place\/([^/]+)/);
    if (pl && P[pl[1]!]) return send(placePage(P[pl[1]!]!, mapsBase));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => maps.listen(0, '127.0.0.1', r));
  mapsBase = `http://127.0.0.1:${(maps.address() as AddressInfo).port}`;

  const db = openDatabase(':memory:');
  let prices = loadPriceList();
  const repo = new CrmRepository(db, () => prices, (p) => { prices = p; });
  const users = new UserRepository(db);
  await users.create({ name: 'Ivan Bologna', username: 'ivan', password: 'secreta123', role: 'admin' });
  gen = new GeneratorRepository(db);
  app = createApp({
    repo, users, generator: gen, log: () => {},
    // Mismo motor y mismo analizador reales, apuntando al Google Maps simulado.
    generate: (req, deps) => generateProspects(req, { ...deps, searchUrl: (q) => `${mapsBase}/maps/search/${encodeURIComponent(q)}` }),
    analyze: (url, opts) => analyze(url, { ...opts, skipUrlValidation: true }),
  }).listen(0, '127.0.0.1');
  await new Promise((r) => app.once('listening', r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  browser = await launchBrowser();
});

after(async () => {
  await browser.close();
  app.close();
  maps.close();
});

async function login(page: Page) {
  await page.goto(`${base}/`);
  await page.fill('input[name=username]', 'ivan');
  await page.fill('input[name=password]', 'secreta123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#nav a');
}

const LAYOUT = `(() => {
  const issues = [];
  if (document.scrollingElement.scrollWidth > innerWidth + 1) issues.push('scroll horizontal: ' + document.scrollingElement.scrollWidth);
  const main = document.querySelector('.main'), mr = main.getBoundingClientRect();
  const inScroller = (el) => { for (let p = el.parentElement; p && p !== main; p = p.parentElement) if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) return true; return false; };
  for (const el of main.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width && !inScroller(el) && (r.right > mr.right + 1 || r.left < mr.left - 1)) { issues.push('se sale: ' + (el.className || el.tagName)); break; } }
  return issues;
})()`;

test('generar, seguir y analizar desde la interfaz', { timeout: 240_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  const menu = await page.$$eval('#nav a', (as) => as.map((a) => a.textContent?.trim()));
  assert.ok(!menu.includes('Generador') && !menu.includes('Pipeline') && menu.includes('Prospección'), 'el menú: Prospección es el centro (sin Generador ni Pipeline)');

  await page.goto(`${base}/generador`); // ya no está en el menú: se entra desde Prospección
  await page.waitForSelector('#gen-form');
  await page.fill('input[name=rubro]', 'Barberías');
  await page.fill('input[name=zona]', 'Quilmes');
  await page.fill('input[name=cantidad]', '4');
  await page.click('#gen-go');
  await page.waitForSelector('.gen-alert', { timeout: 120_000 });
  assert.match((await page.textContent('.gen-alert'))!, /Se encontraron 4 prospectos nuevos/);

  const rows = await page.$$('.gen-item');
  assert.equal(rows.length, 4);
  const scores = await page.$$eval('.gen-item .gen-score', (els) => els.map((el) => Number(el.textContent?.replace(/\D/g, ''))));
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'ordenados de mayor a menor oportunidad');
  assert.equal(await page.$$eval('.gen-new', (b) => b.length), 4, 'marcados como "Nuevo hoy"');
  assert.match((await page.textContent('.gen-stats'))!, /Prospectos encontrados\s*4/);
  // Cada prospecto muestra: nombre, Maps, dirección, teléfono, sitio web, score, estado y "Analizar"…
  for (const sel of ['.gen-name', '[data-k=maps] a', '[data-k=address]', '[data-k=phone]', '[data-k=website]', '.gen-score', '.gen-status', '[data-analyze]']) {
    assert.equal(await page.$$eval(`.gen-item ${sel}`, (els) => els.length), 4, `falta ${sel}`);
  }
  // …y las acciones quedan dentro de la pantalla (sin scroll horizontal oculto).
  const offscreen = await page.$$eval('.gen-item [data-analyze], .gen-item .gen-status', (els) => els.filter((e) => e.getBoundingClientRect().right > innerWidth).length);
  assert.equal(offscreen, 0, 'Analizar y Estado visibles sin desplazar');

  // Estado comercial persistente.
  const first = await page.$eval('.gen-item', (el) => el.getAttribute('data-id'));
  await page.selectOption(`[data-status="${first}"]`, 'contactado');
  await page.waitForFunction(() => /Contactados\s*1/.test(document.querySelector('.gen-stats')?.textContent ?? ''));
  assert.equal(gen.get(first!).status, 'contactado');

  // Analizar: abre el análisis completo existente y termina en el informe del prospecto.
  const name = await page.$eval('.gen-item .gen-name', (el) => el.textContent!.trim());
  await page.click(`[data-analyze="${first}"]`);
  await page.waitForURL(/\/prospectos\/[^/]+$/, { timeout: 120_000 });
  await page.waitForSelector('#problemas');
  assert.equal((await page.textContent('.profile-head h1'))!.trim(), name);
  assert.ok(gen.get(first!).prospectId, 'el análisis queda vinculado al prospecto generado');

  await page.goto(`${base}/generador`); // ya no está en el menú: se entra desde Prospección
  await page.waitForSelector('.gen-list');
  assert.ok(await page.$(`.gen-item[data-id="${first}"] a[href^="/prospectos/"]`), 'muestra "Ver análisis"');
  assert.deepEqual(await page.evaluate(LAYOUT), []);
  assert.deepEqual(errors, []);
  await page.close();
});

test('layout del generador en móvil', { timeout: 60_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page);
  await page.goto(`${base}/generador`);
  await page.waitForSelector('.gen-list');
  const offscreen = await page.$$eval('.gen-item [data-analyze], .gen-item a[href^="/prospectos/"], .gen-item .gen-status', (els) => els.filter((e) => e.getBoundingClientRect().right > innerWidth).length);
  assert.equal(offscreen, 0);
  assert.deepEqual(await page.evaluate(LAYOUT), []);
  await page.close();
});
