import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildAnalysis } from '../src/analyzer.js';
import { buildChannelReport, channelOf } from '../src/channels/crossCheck.js';
import type { InstagramAnalysis } from '../src/channels/instagram.js';
import {
  bookingProvider, instagramUsername, isAggregator, isOwnWebsite, isWhatsAppLink, manualBookingInText, waNumber, whatsappNumberFromLink, whatsappNumberInText, whatsappUrl,
} from '../src/channels/links.js';
import type { AnalysisResult, BusinessProfile } from '../src/domain/types.js';
import { BANNED_PHRASES } from '../src/messages/pitch.js';
import { buildMessages, composeSelection, wordCount } from '../src/messages/whatsapp.js';
import { whatsappLink } from '../src/proposal/whatsappMessage.js';
import { emptyAnalysis } from '../src/scraper/websiteAnalyzer.js';
import { Client, loggedClient, startApp } from './helpers.js';

/** Barbería sin web en Google, con Instagram enlazado en la ficha. */
const barberia: BusinessProfile = {
  sourceUrl: 'https://maps.app.goo.gl/x', name: 'Barbería 12 Navajas', category: 'Barbería', additionalCategories: [], rating: 3.9, reviewCount: 41,
  address: 'San Martín 450, Rosario', phone: '0341 456-7890', services: [], hasBooking: false, hasMenu: false, photoCount: 4, photoCountIsEstimate: false,
  photoUrls: [], posts: [], permanentlyClosed: false, socialLinks: ['https://www.instagram.com/12navajas/'], scrapedAt: '', warnings: [], isClaimed: true,
  reviews: [{ rating: 1, ageDays: 20, hasOwnerResponse: false }, { rating: 2, ageDays: 40, hasOwnerResponse: false }, { rating: 5, ageDays: 60, hasOwnerResponse: false }],
};

function ig(over: Partial<InstagramAnalysis> = {}): InstagramAnalysis {
  return {
    url: 'https://www.instagram.com/12navajas/', username: '12navajas', status: 'ok', links: [], contactAvailable: false,
    linktreeLinks: [], linktreeChecked: false, manualBooking: false, notes: [], checkedAt: '', ...over,
  };
}

const analysisWith = (profile: BusinessProfile, instagram?: InstagramAnalysis, extra: { igWebsiteReachable?: boolean } = {}) =>
  buildAnalysis('u', profile, undefined, { durationMs: 0 }, buildChannelReport(profile, undefined, instagram, extra));

const ids = (a: AnalysisResult) => a.audit.findings.map((f) => f.id);
const level = (a: AnalysisResult, id: string) => a.audit.findings.find((f) => f.id === id)?.level;

function messages(a: AnalysisResult, id = 'p1') {
  return buildMessages(
    { id, name: a.profile.name!, verticalId: a.vertical.id, verticalLabel: a.vertical.label, problems: a.proposal.salesArguments, services: a.proposal.services, analysis: a },
    { sellerName: 'Iván Bologna', sellerBusiness: 'Gestor de Presencia Online', sellerCity: 'Rosario' },
  );
}
function selection(a: AnalysisResult, id = 'p1') {
  return composeSelection(
    { seed: id, name: a.profile.name!, verticalId: a.vertical.id, verticalLabel: a.vertical.label, problems: a.proposal.salesArguments, services: a.proposal.services, profile: a.profile, website: a.website, channels: a.channels },
    { sellerName: 'Iván Bologna', sellerBusiness: 'Gestor de Presencia Online' },
  );
}

// ---------------------------------------------------------------- links

test('links: reconoce WhatsApp, agregadores, proveedores de reservas y webs propias', () => {
  assert.ok(isWhatsAppLink('https://wa.me/5493415550000'));
  assert.ok(isWhatsAppLink('https://api.whatsapp.com/send?phone=5493415550000'));
  assert.ok(!isWhatsAppLink('https://www.whatsappbarber.com'));
  assert.ok(isAggregator('https://linktr.ee/12navajas'));
  assert.equal(bookingProvider('https://booksy.com/es-ar/123_barberia'), 'Booksy');
  assert.ok(isOwnWebsite('https://12navajas.com.ar'));
  for (const u of ['https://instagram.com/x', 'https://linktr.ee/x', 'https://wa.me/549', 'https://booksy.com/x', 'https://facebook.com/x']) assert.ok(!isOwnWebsite(u), u);
  assert.equal(whatsappNumberFromLink('https://api.whatsapp.com/send?phone=5493415550000&text=hola'), '5493415550000');
  assert.equal(instagramUsername('https://www.instagram.com/12Navajas/?hl=es'), '12navajas');
  assert.equal(instagramUsername('https://www.instagram.com/p/Cx123/'), undefined, 'un posteo no es un perfil');
});

test('WhatsApp: números en la bio y normalización a formato wa.me (sin inventar móviles)', () => {
  assert.equal(whatsappNumberInText('Turnos 💈 WhatsApp: 341 15 555-0000'), '341155550000');
  assert.equal(whatsappNumberInText('wsp 11 5555-1234'), '1155551234');
  assert.equal(whatsappNumberInText('Llamanos al 4567890'), undefined, 'sin la palabra WhatsApp no se asume');
  assert.equal(waNumber('341155550000'), '5493415550000', 'con el 15 queda claro que es un celular');
  assert.equal(waNumber('1155551234'), undefined, 'sin 15 ni contexto no se asume celular');
  assert.equal(waNumber('1155551234', { assumeMobile: true }), '5491155551234');
  assert.equal(waNumber('0341 15 555-0000'), '5493415550000', 'se quita el 0 y el 15');
  assert.equal(waNumber('+54 9 341 555-0000'), '5493415550000');
  assert.equal(waNumber('011 4567-8901'), undefined, 'un fijo no se convierte en WhatsApp');
  assert.equal(waNumber('011 4567-8901', { assumeMobile: true }), '5491145678901');
  assert.ok(manualBookingInText('Turnos por WhatsApp 📲'));
  assert.ok(manualBookingInText('reservas x DM'));
  assert.ok(!manualBookingInText('Cortes, barba y color'));
});

test('generación de links: wa.me con el mensaje codificado, sin envío automático', () => {
  const text = 'Hola! ¿Cómo andás? Señal & "comillas" 100% #1\nSegunda línea / ñandú?=sí';
  const url = whatsappUrl('+54 9 341 555-0000', text);
  assert.ok(url.startsWith('https://wa.me/5493415550000?text='));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('text'), text, 'el texto llega exacto');
  assert.equal([...parsed.searchParams.keys()].length, 1, '& y = no rompen los parámetros');
  assert.doesNotMatch(url.split('?text=')[1]!, /[\s&#?\n]/, 'sin espacios, &, #, ? ni saltos sin codificar');
  assert.match(url, /%0A/, 'los saltos de línea se conservan');
  assert.doesNotMatch(url, /send|auto/i);
  // El enlace de siempre (sin número confirmado) sigue igual.
  assert.equal(whatsappLink('0341 456-7890', 'hola'), 'https://wa.me/?text=hola');
  assert.equal(whatsappLink('+54 341 456-7890', 'hola'), 'https://wa.me/543414567890?text=hola');
});

// ---------------------------------------------------------------- verificación cruzada

test('verificación cruzada: canales encontrados, no encontrados y no verificados', () => {
  const r = buildChannelReport(barberia, undefined, ig({ links: ['https://linktr.ee/12navajas'], linktree: 'https://linktr.ee/12navajas', linktreeChecked: true,
    linktreeLinks: ['https://booksy.com/es-ar/1_12navajas', 'https://wa.me/5493415550000', 'https://facebook.com/12navajas'],
    bookingUrl: 'https://booksy.com/es-ar/1_12navajas', bookingProvider: 'Booksy', whatsappLink: 'https://wa.me/5493415550000', whatsappNumber: '5493415550000', facebook: 'https://facebook.com/12navajas' }));
  assert.equal(channelOf(r, 'instagram')?.status, 'encontrado');
  assert.equal(channelOf(r, 'reservas')?.status, 'encontrado');
  assert.deepEqual(channelOf(r, 'reservas')?.sources, ['Instagram (Linktree)']);
  assert.match(channelOf(r, 'reservas')?.detail ?? '', /Booksy/);
  assert.equal(channelOf(r, 'whatsapp')?.status, 'encontrado');
  assert.equal(channelOf(r, 'facebook')?.status, 'encontrado');
  assert.equal(channelOf(r, 'web')?.status, 'no_encontrado', 'se revisó Maps e Instagram (con su Linktree)');
  assert.equal(r.whatsappNumber, '5493415550000');
  assert.equal(r.instagram?.instagram_booking_provider, 'Booksy');
  assert.equal(r.instagram?.instagram_linktree, 'https://linktr.ee/12navajas');
  assert.equal(r.instagram?.instagram_analysis_status, 'ok');

  // Instagram bloqueado: nada de lo que dependa de él se afirma.
  const blocked = buildChannelReport(barberia, undefined, ig({ status: 'bloqueado' }));
  for (const c of ['web', 'whatsapp', 'reservas', 'facebook'] as const) assert.equal(channelOf(blocked, c)?.status, 'no_verificado', c);
  assert.equal(blocked.instagram?.instagram_whatsapp_available, null, 'desconocido no es "false"');

  // Linktree sin revisar: tampoco se afirma la ausencia.
  const tree = buildChannelReport(barberia, undefined, ig({ links: ['https://linktr.ee/12navajas'], linktree: 'https://linktr.ee/12navajas' }));
  assert.equal(channelOf(tree, 'reservas')?.status, 'no_verificado');
});

test('contradicciones entre canales quedan marcadas para revisión', () => {
  const p = { ...barberia, website: 'https://12navajas.com.ar' };
  const r = buildChannelReport(p, { ...emptyAnalysis(p.website), reachable: true }, ig({ links: ['https://navajas-nueva.com'], website: 'https://navajas-nueva.com' }));
  assert.ok(r.review.some((x) => /revisar cuál es la web actual/.test(x)));
  const gone = buildChannelReport(barberia, undefined, ig({ status: 'no_encontrado' }));
  assert.ok(gone.review.some((x) => /no existe/.test(x)));
});

// ---------------------------------------------------------------- no recomendar lo que ya tiene

test('sin falsos problemas de reservas: Booksy en el Linktree descarta "no tiene reservas"', () => {
  const sin = analysisWith(barberia, ig());
  assert.ok(ids(sin).includes('booking-none'), 'sin reservas en ningún canal, el problema existe');
  const con = analysisWith(barberia, ig({ links: ['https://linktr.ee/12navajas'], linktree: 'https://linktr.ee/12navajas', linktreeChecked: true,
    linktreeLinks: ['https://booksy.com/es-ar/1_12navajas'], bookingUrl: 'https://booksy.com/es-ar/1_12navajas', bookingProvider: 'Booksy' }));
  assert.ok(!ids(con).includes('booking-none'));
  assert.ok(con.audit.contradicted?.some((f) => f.findingId === 'booking-none'), 'queda como "descartado: ya lo tiene"');
  assert.ok(!con.proposal.salesArguments.some((s) => s.findingId === 'booking-none'));
  // No se VENDEN reservas (ni el problema ni el servicio); sí se reconoce que ya las tienen.
  const NO_SELL = /forma de reservar|sistemas? de reservas|turnos? online|agenda online|necesita.*reserv/i;
  for (const t of Object.values(messages(con))) assert.doesNotMatch(t, NO_SELL);
  assert.match(messages(con).primerContacto, /ya tienen [^.]*reservas online/i);
});

test('reservas manuales por WhatsApp: el problema queda como probable y no va al mensaje', () => {
  const a = analysisWith(barberia, ig({ biography: 'Cortes y barba. Turnos por WhatsApp 📲', manualBooking: true }));
  const f = a.audit.findings.find((x) => x.id === 'booking-none');
  if (f) assert.equal(f.level, 'probable');
  assert.ok(!selection(a).some((s) => s.findingId === 'booking-none'));
});

test('Instagram bloqueado: las ausencias quedan probables, nunca en el mensaje', () => {
  const a = analysisWith(barberia, ig({ status: 'bloqueado' }));
  for (const id of ['booking-none', 'web-none', 'wa-not-visible']) {
    if (ids(a).includes(id)) assert.equal(level(a, id), 'probable', id);
  }
  const sel = selection(a).map((s) => s.findingId);
  for (const id of ['booking-none', 'web-none', 'wa-not-visible']) assert.ok(!sel.includes(id), id);
});

test('web encontrada en Instagram: no se dice "no tiene web", se propone vincularla en Google', () => {
  const a = analysisWith(barberia, ig({ links: ['https://12navajas.com.ar'], externalUrl: 'https://12navajas.com.ar', website: 'https://12navajas.com.ar' }), { igWebsiteReachable: true });
  assert.ok(!ids(a).includes('web-none'));
  assert.ok(a.audit.contradicted?.some((f) => f.findingId === 'web-none'));
  assert.ok(ids(a).includes('web-not-in-maps'));
  assert.equal(level(a, 'web-not-in-maps'), 'confirmado');
  assert.equal(channelOf(a.channels, 'web')?.status, 'encontrado');
  assert.match(channelOf(a.channels, 'web')?.detail ?? '', /No está vinculada en Google Maps/);
  for (const t of Object.values(messages(a))) assert.doesNotMatch(t, /no (tiene|encontré) (una )?(página|web)/i, t);

  // Si la web de Instagram no carga, no se recomienda vincularla y se pide revisión.
  const down = analysisWith(barberia, ig({ links: ['https://12navajas.com.ar'], website: 'https://12navajas.com.ar' }), { igWebsiteReachable: false });
  assert.ok(!ids(down).includes('web-not-in-maps'));
  assert.ok(down.channels?.review.some((x) => /no carga/.test(x)));
});

test('WhatsApp en Instagram: descarta "no tiene WhatsApp" y deja el número listo para contactar', () => {
  const a = analysisWith(barberia, ig({ biography: 'Cortes · WhatsApp 0341 15 555-0000', whatsappNumber: '0341155550000' }));
  assert.ok(!ids(a).includes('wa-not-visible'));
  assert.equal(channelOf(a.channels, 'whatsapp')?.status, 'encontrado');
  assert.equal(a.channels?.whatsappNumber, '5493415550000');
  assert.equal(a.channels?.whatsappSource, 'Instagram');
  assert.ok(!selection(a).some((s) => /^wa-/.test(s.findingId)));
});

// ---------------------------------------------------------------- mensajes

test('mensaje personalizado: estructura, 120–220 palabras, máximo 3 problemas, sin frases prohibidas', () => {
  const a = analysisWith(barberia, ig());
  const m = messages(a);
  const t = m.primerContacto;
  assert.match(t, /^(Hola|Buenas|Buen día)/);
  assert.match(t, /Soy Iván Bologna, Gestor de Presencia Online/);
  assert.match(t, /Barbería 12 Navajas/);
  assert.match(t, /audio corto/);
  const n = wordCount(t);
  assert.ok(n >= 120 && n <= 220, `${n} palabras:\n${t}`);
  const sel = selection(a);
  assert.ok(sel.length >= 1 && sel.length <= 3);
  assert.ok(sel.every((s) => a.audit.findings.find((f) => f.id === s.findingId)?.level === 'confirmado'), 'solo argumentos confirmados');
  const sorted = [...sel].sort((x, y) => x.priority - y.priority);
  assert.deepEqual(sel.map((s) => s.findingId), sorted.map((s) => s.findingId), 'ordenados por prioridad comercial');
  for (const text of Object.values(m)) {
    for (const b of BANNED_PHRASES) assert.ok(!text.toLowerCase().includes(b), `frase prohibida "${b}" en:\n${text}`);
    assert.doesNotMatch(text, /undefined|null|NaN|\.\./);
  }
  // Mensajes distintos para negocios distintos.
  const otro = messages(analysisWith({ ...barberia, name: 'Peluquería Lola', category: 'Peluquería', reviewCount: 3, rating: 5, reviews: [] }, ig()), 'p2');
  assert.notEqual(otro.primerContacto, t);
  assert.match(otro.primerContacto, /Peluquería Lola/);
});

test('no se inventan problemas: sin nada confirmado, el mensaje lo dice con honestidad', () => {
  const ok: BusinessProfile = {
    ...barberia, rating: 4.9, reviewCount: 380, photoCount: 120, hasBooking: true, bookingUrl: 'https://booksy.com/x', website: 'https://12navajas.com.ar',
    description: 'Barbería clásica en el centro de Rosario desde 1998.', hours: { lunes: '9–20' } as never, posts: [{ ageDays: 3 }] as never,
    reviews: Array.from({ length: 10 }, (_, i) => ({ rating: 5, ageDays: i * 5, hasOwnerResponse: true })),
  };
  const site = { ...emptyAnalysis(ok.website!), reachable: true, https: true, whatsapp: { hasLink: true, links: ['https://wa.me/5493415550000'], hasFloatingButton: true },
    booking: { hasOnlineBooking: true, providers: ['Booksy'] }, scores: { visual: 90, mobile: 90, speed: 90, contact: 90 } };
  const a = buildAnalysis('u', ok, site, { durationMs: 0 }, buildChannelReport(ok, site, ig({ status: 'bloqueado' })));
  const sel = selection(a);
  for (const s of sel) assert.equal(a.audit.findings.find((f) => f.id === s.findingId)?.level, 'confirmado');
  for (const id of ['booking-none', 'web-none', 'wa-not-visible']) assert.ok(!ids(a).includes(id), `${id} no debería existir`);
  if (sel.length === 0) assert.doesNotMatch(messages(a).primerContacto, /no tiene|no encontré|te faltan?/i);
});

test('prospectos anteriores (sin canales) siguen funcionando igual', () => {
  const legacy = buildAnalysis('u', barberia, undefined, { durationMs: 0 });
  assert.equal(legacy.channels, undefined);
  assert.ok(ids(legacy).includes('web-none'), 'sin verificación cruzada se comporta como antes');
  assert.ok(legacy.audit.findings.every((f) => (f.level ?? 'confirmado') === 'confirmado'));
  const m = messages(legacy);
  assert.match(m.primerContacto, /Barbería 12 Navajas/);
  assert.ok(selection(legacy).length >= 1, 'sin canales los argumentos se usan como confirmados');
  // Un análisis guardado con el formato viejo (sin level ni contradicted) se lee sin errores.
  const old = JSON.parse(JSON.stringify(legacy)) as AnalysisResult;
  for (const f of old.audit.findings) delete (f as { level?: string }).level;
  for (const s of old.proposal.salesArguments) delete (s as { level?: string }).level;
  delete (old.audit as { contradicted?: unknown }).contradicted;
  assert.equal(messages(old).primerContacto, m.primerContacto);
});

// ---------------------------------------------------------------- API

test('API: "Verificar presencia online" actualiza canales, argumentos y mensaje; los viejos se siguen viendo', async () => {
  const app = await startApp();
  try {
    const admin: Client = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván Bologna');
    const created = (await admin.analyze('https://maps.app.goo.gl/Barbería Centro')).at(-1);
    const before = (await admin.get(`/api/prospects/${created.prospectId}`)).body;
    assert.equal(before.analysis.channels, undefined, 'el prospecto viejo no tiene canales y se ve igual');
    assert.ok(Array.isArray(before.messageSelection));
    assert.ok(before.messages.primerContacto.length > 0);

    const res = await admin.req('POST', `/api/prospects/${created.prospectId}/verificar`, {});
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines[0].tipo, 'progreso');
    assert.equal(lines.at(-1).tipo, 'resultado');
    assert.equal(lines.at(-1).prospectId, created.prospectId, 'actualiza el mismo prospecto, no crea otro');

    const after = (await admin.get(`/api/prospects/${created.prospectId}`)).body;
    assert.equal(after.analysis.channels.whatsappNumber, '5493415550000');
    assert.equal(channelOf(after.analysis.channels, 'reservas')?.status, 'encontrado');
    assert.ok(!after.analysis.audit.findings.some((f: { id: string }) => f.id === 'booking-none'));
    assert.doesNotMatch(after.messages.primerContacto, /forma de reservar|sistemas? de reservas/i, "no vende reservas");
    assert.match(after.messages.primerContacto, /ya tienen [^.]*reservas online/i, "reconoce que ya las tiene");
    assert.ok(after.activities.some((x: { content: string }) => /Presencia online verificada/.test(x.content)));

    // Ajeno → 404 (como el resto del CRM).
    const vend = await loggedClient(app.base, app.users, 'lucia', 'vendedor', 'Lucía');
    assert.equal((await vend.json('POST', `/api/prospects/${created.prospectId}/verificar`, {})).status, 404);
  } finally {
    app.close();
    rmSync(app.webDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- datos del usuario

test('los tests no tocan data/prospeccion.db ni precios.json', () => {
  // Este archivo corre junto a toda la suite: si algún test escribiera los archivos reales,
  // el hash cambiaría entre el inicio y el final del proceso.
  const files = ['precios.json', 'data/prospeccion.db'].map((f) => path.resolve(import.meta.dirname, '..', f));
  const hash = (f: string) => (existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : 'ausente');
  const start = files.map(hash);
  process.once('beforeExit', () => {
    const end = files.map(hash);
    assert.deepEqual(end, start, 'precios.json o data/prospeccion.db cambiaron durante los tests');
  });
  assert.ok(true);
});

type UiWa = { waPhone: (p: string) => string; waMeUrl: (n: string, t: string) => string; waWebUrl: (n: string, t: string) => string; waLink: (p: string, t: string) => string };
const uiWa = async () => (await import('../web/assets/js/ui.js')) as UiWa;

test('E. número argentino válido → formato internacional para wa.me', async () => {
  const { waPhone } = await uiWa();
  assert.equal(waPhone('0341 15-555-0000'), '5493415550000', 'celular: 54 + 9, sin 0 ni 15');
  assert.equal(waPhone('011 15 2345-6789'), '5491123456789');
  assert.equal(waPhone('+54 9 341 555-0000'), '5493415550000');
  assert.equal(waPhone('5493415550000'), '5493415550000', 'ya internacional: queda igual');
  assert.equal(waPhone('0341 456-7890'), '543414567890', 'fijo (WhatsApp Business)');
  assert.equal(waPhone('+54 341 456-7890'), '543414567890');
  assert.equal(waPhone('+1 415 555 0101'), '14155550101', 'otro país: se respeta');
  // No duplicar el código de país.
  assert.equal(waPhone('+54 54 9 341 555-0000'), '5493415550000');
  assert.equal(waPhone('0054 9 341 555-0000'), '5493415550000');
  assert.equal(waPhone('+54 9 341 15 555-0000'), '5493415550000', '9 y 15 a la vez');
  assert.equal(waPhone('+54 (0341) 15-555-0000'), '5493415550000');
  // No inventar números.
  for (const bad of ['', '123', '555-0000', '4567890', 'sin teléfono', '+54 341 456']) assert.equal(waPhone(bad), '', bad);
});

test('F. número con espacios, guiones, paréntesis y puntos', async () => {
  const { waPhone } = await uiWa();
  assert.equal(waPhone('(0341) 15-555-0000'), '5493415550000');
  assert.equal(waPhone(' (011)  4567.8901 '), '541145678901');
  assert.equal(waPhone('+54 (9) 11 2345-6789'), '5491123456789');
  assert.equal(waPhone('0221-15-456-7890'), '5492214567890');
  assert.equal(waPhone('+54-9-351-123-4567'), '5493511234567');
});

test('G. mensaje con tildes, ñ, signos, saltos de línea, emojis y caracteres especiales', async () => {
  const { waMeUrl, waWebUrl, waLink } = await uiWa();
  const text = 'Hola, ¿cómo andás? Soy Iván 👋\nAñoranza, pingüino & "comillas" 100% #1 / a+b=c?\n\nSaludos 🙌🏽';
  const url = waMeUrl('5493415550000', text);
  assert.ok(url.startsWith('https://wa.me/5493415550000?text='), 'enlace oficial Click to Chat');
  const u = new URL(url);
  assert.equal(u.searchParams.get('text'), text, 'llega exacto');
  assert.deepEqual([...u.searchParams.keys()], ['text'], '& = # ? + no rompen el enlace');
  assert.doesNotMatch(url.split('?text=')[1]!, /[\s&#?+=%](?![0-9A-F]{2})|[^\x21-\x7e]/, 'todo codificado (sin espacios, ñ, emojis ni & sueltos)');
  assert.match(url, /%0A%0A/, 'saltos de línea conservados');
  assert.match(url, /%F0%9F%91%8B/, 'emoji en UTF-8');
  const web = new URL(waWebUrl('5493415550000', text));
  assert.equal(web.origin + web.pathname, 'https://web.whatsapp.com/send');
  assert.equal(web.searchParams.get('phone'), '5493415550000');
  assert.equal(web.searchParams.get('text'), text);
  assert.equal(waLink('(0341) 15-555-0000', 'Hola'), 'https://wa.me/5493415550000?text=Hola');
  assert.equal(waMeUrl('', 'Hola'), 'https://wa.me/?text=Hola', 'sin número: WhatsApp pide elegir el contacto');
});
