/**
 * Revisión de Instagram con Chromium real contra un Instagram SIMULADO (sin internet):
 * perfil con Linktree (Booksy + WhatsApp), perfil con web y WhatsApp en la bio, perfil que pide
 * iniciar sesión y perfil inexistente.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { buildAnalysis } from '../src/analyzer.js';
import { buildChannelReport, channelOf } from '../src/channels/crossCheck.js';
import { analyzeInstagram } from '../src/channels/instagram.js';
import { config } from '../src/config/index.js';
import { profile } from './helpers.js';

const USERS: Record<string, object | null> = {
  '12navajas': {
    full_name: 'Barbería 12 Navajas', biography: 'Barbería clásica 💈 Rosario', external_url: 'http://linktr.ee/12navajas',
    is_business_account: true, edge_followed_by: { count: 2350 }, edge_owner_to_timeline_media: { count: 180 },
  },
  lolapelu: {
    full_name: 'Lola Peluquería', biography: 'Color y cortes. Turnos por WhatsApp 📲 WhatsApp: 341 15 555-0000 · www.lolapelu.com.ar',
    external_url: 'https://l.instagram.com/?u=https%3A%2F%2Fwww.lolapelu.com.ar%2F&e=x', business_phone_number: '+5493415550000',
    business_contact_method: 'WHATSAPP', is_business_account: true,
  },
  borrado: null,
};

let server: http.Server;
let base = '';
let browser: Browser;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/api/v1/users/web_profile_info/') {
      const u = url.searchParams.get('username')!;
      if (u === 'privado') return void res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"message":"login_required"}');
      if (!(u in USERS)) return void res.writeHead(404).end();
      return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: { user: USERS[u] } }));
    }
    if (url.pathname === '/privado/') return void res.writeHead(302, { Location: '/accounts/login/' }).end();
    if (url.pathname === '/accounts/login/') return void res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h1>Iniciá sesión</h1>');
    // Linktree (el navegador resuelve linktr.ee a este servidor).
    if (req.headers.host?.startsWith('linktr.ee') && url.pathname === '/12navajas') {
      return void res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><title>12navajas</title>
        <a href="https://booksy.com/es-ar/123_12-navajas">Reservá tu turno</a>
        <a href="https://wa.me/5493415551111?text=Hola">WhatsApp</a>
        <a href="https://www.facebook.com/12navajas">Facebook</a>`);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath: config.browser.executablePath,
    args: [`--host-resolver-rules=MAP linktr.ee 127.0.0.1:${port}`, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  });
});

after(async () => {
  await browser?.close();
  server.close();
});

test('Instagram con Linktree: encuentra reservas (Booksy), WhatsApp y Facebook', { timeout: 60_000 }, async () => {
  const ig = await analyzeInstagram(browser, 'https://www.instagram.com/12navajas/', { baseUrl: base });
  assert.equal(ig.status, 'ok');
  assert.equal(ig.followers, 2350);
  assert.equal(ig.linktree, 'http://linktr.ee/12navajas');
  assert.ok(ig.linktreeChecked);
  assert.equal(ig.bookingProvider, 'Booksy');
  assert.equal(ig.whatsappNumber, '5493415551111');
  assert.equal(ig.facebook, 'https://www.facebook.com/12navajas');
  assert.equal(ig.website, undefined, 'Booksy, WhatsApp o Facebook no son "la web"');

  const p = { ...profile('Barbería 12 Navajas'), category: 'Barbería', socialLinks: ['https://www.instagram.com/12navajas/'] };
  const a = buildAnalysis('u', p, undefined, { durationMs: 0 }, buildChannelReport(p, undefined, ig));
  assert.ok(!a.audit.findings.some((f) => f.id === 'booking-none' || f.id === 'wa-not-visible'));
  assert.equal(a.channels?.instagram?.instagram_booking_available, true);
  assert.equal(a.channels?.instagram?.instagram_whatsapp_available, true);
});

test('Instagram con web y WhatsApp en la bio (link envuelto por Instagram)', { timeout: 60_000 }, async () => {
  const ig = await analyzeInstagram(browser, 'instagram.com/LolaPelu', { baseUrl: base });
  assert.equal(ig.status, 'ok');
  assert.equal(ig.username, 'lolapelu');
  assert.equal(ig.externalUrl, 'https://www.lolapelu.com.ar/', 'se desenvuelve l.instagram.com');
  assert.equal(ig.website, 'https://www.lolapelu.com.ar/');
  assert.equal(ig.whatsappNumber, '341155550000');
  assert.ok(ig.manualBooking, 'toma turnos por WhatsApp');
  assert.ok(ig.contactAvailable);

  const r = buildChannelReport({ ...profile('Lola'), socialLinks: ['https://instagram.com/lolapelu'] }, undefined, ig);
  assert.equal(r.whatsappNumber, '5493415550000', 'listo para wa.me');
  assert.equal(channelOf(r, 'web')?.status, 'encontrado');
  assert.equal(channelOf(r, 'reservas')?.detail, 'Toma turnos/reservas por WhatsApp o mensaje, sin sistema online');
  assert.equal(r.instagram?.instagram_website_url, 'https://www.lolapelu.com.ar/');
});

test('Instagram que pide iniciar sesión queda "bloqueado" y nada se afirma', { timeout: 60_000 }, async () => {
  const ig = await analyzeInstagram(browser, 'https://www.instagram.com/privado/', { baseUrl: base });
  assert.equal(ig.status, 'bloqueado');
  assert.match(ig.notes.join(' '), /no verificado/);
  const r = buildChannelReport({ ...profile('Privado'), socialLinks: ['https://www.instagram.com/privado/'] }, undefined, ig);
  assert.equal(channelOf(r, 'reservas')?.status, 'no_verificado');
  assert.equal(channelOf(r, 'whatsapp')?.status, 'no_verificado');
});

test('perfil inexistente y enlaces que no son perfiles', { timeout: 60_000 }, async () => {
  assert.equal((await analyzeInstagram(browser, 'https://www.instagram.com/borrado/', { baseUrl: base })).status, 'no_encontrado');
  assert.equal((await analyzeInstagram(browser, 'https://www.instagram.com/noexiste/', { baseUrl: base })).status, 'no_encontrado');
  const post = await analyzeInstagram(browser, 'https://www.instagram.com/p/Cx123/', { baseUrl: base });
  assert.equal(post.status, 'error');
  assert.equal(post.username, undefined);
});
