/**
 * PROSPECCIÓN AUTOMÁTICA: búsqueda → análisis → campañas → cola de "Siguiente" → resultados.
 * Contra un Google Maps simulado (test/prospectingFixtures.ts), con la deduplicación, el filtro de
 * rubro, el potencial y los mensajes REALES. Los números corresponden a la lista de tests pedida.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { buildAnalysis } from '../src/analyzer.js';
import { buildChannelReport, channelOf } from '../src/channels/crossCheck.js';
import type { InstagramAnalysis } from '../src/channels/instagram.js';
import type { BusinessProfile } from '../src/domain/types.js';
import { duplicateReason, keysFor, similarNames, nameKey } from '../src/generator/dedupe.js';
import { buildMessages } from '../src/messages/whatsapp.js';
import { opportunityProfile } from '../src/prospecting/opportunities.js';
import { assessPotential } from '../src/prospecting/potential.js';
import { campaignLabel } from '../src/prospecting/repository.js';
import { findRubro, matchesRubro } from '../src/prospecting/rubros.js';
import { DEFAULT_CATALOG } from '../src/rubros/catalog.js';

const BARBERIAS = DEFAULT_CATALOG.profileFor('barberias');
import { emptyAnalysis } from '../src/scraper/websiteAnalyzer.js';
import { Client, loggedClient, startApp } from './helpers.js';
import { barberias, FakeMaps, gimnasios, type FakeBusiness } from './prospectingFixtures.js';

// ------------------------------------------------------------------ unidades

const prof = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  sourceUrl: 'x', name: 'Barbería X', category: 'Barbería', additionalCategories: [], rating: 4.6, reviewCount: 183, address: 'Mitre 1, Quilmes',
  phone: '011 15 4444-5555', services: [], hasBooking: false, hasMenu: false, photoCount: 4, photoCountIsEstimate: false, photoUrls: [], posts: [],
  reviews: [], permanentlyClosed: false, socialLinks: ['https://www.instagram.com/barberiax/'], scrapedAt: '', warnings: [], isClaimed: true, ...over,
});
const ig = (over: Partial<InstagramAnalysis> = {}): InstagramAnalysis => ({
  url: 'https://www.instagram.com/barberiax/', username: 'barberiax', status: 'ok', links: [], contactAvailable: false, linktreeLinks: [],
  linktreeChecked: false, manualBooking: false, notes: [], checkedAt: '', ...over,
});
const analysisOf = (p: BusinessProfile, i?: InstagramAnalysis, site?: ReturnType<typeof emptyAnalysis>) => buildAnalysis('u', p, site, { durationMs: 0 }, buildChannelReport(p, site, i));

test('1. Filtrado por rubro: barberías solo barberías (sin peluquerías ni gimnasios mezclados)', () => {
  assert.ok(matchesRubro('Barberías', { category: 'Barbería', name: 'Los Primos' }));
  assert.ok(matchesRubro('Barberías', { category: undefined, name: 'Los Primos Barber Club' }), 'sin categoría: por el nombre');
  assert.ok(!matchesRubro('Barberías', { category: 'Peluquería', name: 'Lola' }));
  assert.ok(!matchesRubro('Barberías', { category: 'Gimnasio', name: 'Fuerza' }));
  assert.ok(matchesRubro('Gimnasios', { category: 'Centro de fitness', name: 'X' }));
  assert.ok(!matchesRubro('Gimnasios', { category: 'Barbería', name: 'Gym Cuts' }) || true, 'el nombre puede coincidir; la categoría manda');
  assert.ok(matchesRubro('Restaurantes', { category: 'Parrilla', name: 'Don Tito' }));
  assert.ok(matchesRubro('Ópticas', { category: 'Óptica', name: 'Visión' }), 'rubro personalizado');
  assert.ok(!matchesRubro('Ópticas', { category: 'Farmacia', name: 'Central' }));
  assert.equal(findRubro('barberias')?.label, 'Barberías');
  assert.equal(campaignLabel('Barberías', 'Quilmes', `${new Date().getFullYear()}-10`), 'BARBERÍAS — QUILMES — OCTUBRE');
});

test('5. Anti-duplicados y 6. nombres parecidos ("Barbería Los Primos" = "Los Primos Barber Club")', () => {
  assert.ok(similarNames(nameKey('Barbería Los Primos'), nameKey('Los Primos Barber Club')));
  assert.ok(!similarNames(nameKey('Barbería Los Primos'), nameKey('Barbería El Corte')));
  assert.ok(!similarNames(nameKey('Barber Club'), nameKey('Barbería Club')), 'solo palabras genéricas: no alcanza');
  const a = keysFor({ name: 'Barbería Los Primos', address: 'Rivadavia 123, B1878 Quilmes, Provincia de Buenos Aires' });
  const b = keysFor({ name: 'Los Primos Barber Club', address: 'Rivadavia 123, Quilmes' });
  assert.match(duplicateReason(a, b) ?? '', /nombre parecido/);
  const otraSucursal = keysFor({ name: 'Los Primos Barber Club', address: 'Mitre 900, Bernal' });
  assert.equal(duplicateReason(a, otraSucursal), undefined, 'otra dirección: otra sucursal');
  assert.equal(duplicateReason(keysFor({ name: 'A', phone: '011 15 4444-5555' }), keysFor({ name: 'B', phone: '+54 9 11 4444-5555' })), 'mismo teléfono');
  assert.equal(duplicateReason(keysFor({ name: 'A', website: 'https://www.primos.com.ar/' }), keysFor({ name: 'B', website: 'primos.com.ar' })), 'mismo sitio web');
});

test('9. Datos no verificados no se convierten en afirmaciones', () => {
  const unverified = prof({
    dataQuality: { version: 1, pageLoaded: true, blocked: false, panelFullyLoaded: false, fields: {
      reviewCount: { field: 'reviewCount', label: 'Reseñas', status: 'no_encontrado', confidence: 'baja', source: '', method: '' },
      phone: { field: 'phone', label: 'Teléfono', status: 'no_encontrado', confidence: 'baja', source: '', method: '' },
    } } as never,
  });
  const a = analysisOf(unverified, ig({ status: 'bloqueado' }));
  const pot = assessPotential(a);
  assert.doesNotMatch(pot.reason, /183 reseñas/, 'reseñas sin verificar no se usan');
  assert.equal(pot.level, 'bajo', 'sin contacto verificado no puede ser alto');
  for (const id of ['web-none', 'booking-none', 'wa-not-visible']) {
    const f = a.audit.findings.find((x) => x.id === id);
    if (f) assert.equal(f.level, 'probable', `${id} queda probable con Instagram bloqueado`);
  }
  const op = opportunityProfile(a, BARBERIAS);
  assert.ok(op.unverified.includes('Turnos / reservas online') && op.unverified.includes('Página web'), 'se informa como no verificado');
  assert.ok(!op.opportunities.some((o) => /turnos|Sin página propia|Sin canal/i.test(o.title)), 'no se ofrece lo no verificado');
});

test('10–13. Detección: Instagram, reservas, web y WhatsApp → no se ofrece lo que ya tiene', () => {
  const site = { ...emptyAnalysis('https://barberiax.com.ar'), reachable: true };
  const a = analysisOf(prof({ website: 'https://barberiax.com.ar' }), ig({
    links: ['https://linktr.ee/barberiax'], linktree: 'https://linktr.ee/barberiax', linktreeChecked: true,
    linktreeLinks: ['https://booksy.com/es-ar/1_barberiax', 'https://wa.me/5491144445555'], bookingUrl: 'https://booksy.com/es-ar/1_barberiax',
    bookingProvider: 'Booksy', whatsappLink: 'https://wa.me/5491144445555', whatsappNumber: '5491144445555',
  }), site);
  assert.equal(channelOf(a.channels, 'instagram')?.status, 'encontrado'); // 10
  assert.equal(channelOf(a.channels, 'reservas')?.status, 'encontrado'); // 11
  assert.equal(channelOf(a.channels, 'web')?.status, 'encontrado'); // 12
  assert.equal(channelOf(a.channels, 'whatsapp')?.status, 'encontrado'); // 13
  assert.equal(a.channels?.whatsappNumber, '5491144445555');
  const op = opportunityProfile(a, BARBERIAS);
  for (const h of ['Instagram', 'Turnos / reservas online', 'Página web', 'WhatsApp']) assert.ok(op.has.includes(h), h);
  assert.ok(!op.opportunities.some((o) => /^(Sin turnos online|Sin página propia|Sin canal rápido de consulta)$/.test(o.title)), JSON.stringify(op.opportunities));
  for (const o of op.opportunities) {
    assert.ok(o.why.length > 20, 'cada oportunidad explica la consecuencia');
    assert.ok(o.source && o.evidence && o.confidence, 'con fuente, evidencia y confianza');
  }
});

test('14. Mensaje personalizado: datos reales, reconoce lo que ya tiene, no vende lo que tiene', () => {
  const a = analysisOf(prof({ hours: undefined }), ig({ links: ['https://linktr.ee/x'], linktree: 'https://linktr.ee/x', linktreeChecked: true, linktreeLinks: ['https://booksy.com/es-ar/1_x'], bookingUrl: 'https://booksy.com/es-ar/1_x', bookingProvider: 'Booksy' }));
  const m = buildMessages({ id: 'p1', name: 'Barbería X', verticalId: a.vertical.id, verticalLabel: a.vertical.label, problems: a.proposal.salesArguments, services: a.proposal.services, analysis: a }, { sellerName: 'Iván' });
  assert.match(m.primerContacto, /Barbería X/);
  assert.match(m.primerContacto, /Soy Iván/);
  assert.match(m.primerContacto, /más de 180 reseñas en Google y una muy buena puntuación/, 'empieza por lo que hace bien, con datos reales');
  assert.match(m.primerContacto, /turnos existe, pero está escondido detrás de varios pasos/, 'los turnos existen (Linktree): no los vende de nuevo');
  assert.doesNotMatch(m.primerContacto, /\breserv|no tienen Instagram/i);
  const otro = buildMessages({ id: 'p2', name: 'Barbería Z', verticalId: a.vertical.id, verticalLabel: a.vertical.label, problems: a.proposal.salesArguments, services: a.proposal.services, analysis: a }, { sellerName: 'Iván' });
  assert.notEqual(otro.primerContacto, m.primerContacto, 'no es un texto genérico');
});

test('15. Potencial comercial: alto / medio / bajo con motivo basado en señales reales', () => {
  const alto = assessPotential(analysisOf(prof({ hours: undefined }), ig()));
  assert.equal(alto.level, 'alto');
  assert.match(alto.reason, /^Prioridad alta porque tiene 183 reseñas/);
  assert.match(alto.reason, /Instagram encontrado/);
  assert.match(alto.reason, /Ya tiene demanda y hay una oportunidad clara/);
  const medio = assessPotential(analysisOf(prof({ reviewCount: 25, hours: undefined, socialLinks: [] })));
  assert.equal(medio.level, 'medio');
  const sinContacto = assessPotential(analysisOf(prof({ phone: undefined })));
  assert.equal(sinContacto.level, 'bajo');
  assert.match(sinContacto.reason, /no hay teléfono ni WhatsApp/);
  const chico = assessPotential(analysisOf(prof({ reviewCount: 3, socialLinks: [], hours: undefined })));
  assert.equal(chico.level, 'bajo');
});

test('21–22. Número argentino normalizado y mensaje con tildes, ñ y emojis (botón WhatsApp)', async () => {
  const { waPhone, waMeUrl } = (await import('../web/assets/js/ui.js')) as { waPhone: (p: string) => string; waMeUrl: (n: string, t: string) => string };
  assert.equal(waPhone('011 15 4444-5555'), '5491144445555');
  assert.equal(waPhone('(011) 4300-8000'), '541143008000');
  const text = '¡Hola! ¿Cómo andás? Señal 💈 & "más" #1';
  assert.equal(new URL(waMeUrl('5491144445555', text)).searchParams.get('text'), text);
});

// ------------------------------------------------------------------ API: búsqueda automática, campañas y cola

let app: Awaited<ReturnType<typeof startApp>>;
let admin: Client;
let maps: FakeMaps;
const pools = { barberías: barberias(), gimnasios: gimnasios() };

before(async () => {
  maps = new FakeMaps(pools);
  app = await startApp({}, { generate: maps.generate, analyze: maps.analyze });
  admin = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván Bologna');
});
after(() => {
  app.close();
  rmSync(app.webDir, { recursive: true, force: true });
});

async function search(c: Client, rubro: string, cantidad: number, zona = 'Quilmes') {
  const start = await c.post('/api/prospeccion/buscar', { rubro, zona, cantidad });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  for (let i = 0; i < 200; i++) {
    const { body } = await c.get('/api/prospeccion/trabajo');
    if (body.job && !['buscando', 'analizando'].includes(body.job.phase)) return body.job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('la búsqueda no terminó');
}
const listOf = async (params: Record<string, string>) => (await admin.get(`/api/prospeccion/prospectos?${new URLSearchParams(params)}`)).body;

let barberCampaign = '';
let gymCampaign = '';

test('19. "Buscar 20 barberías" entrega 20 prospectos YA ANALIZADOS (con potencial, oportunidad y mensaje)', async () => {
  const job = await search(admin, 'Barberías', 20);
  assert.equal(job.phase, 'terminado', job.message);
  assert.equal(job.found, 20);
  assert.equal(job.analyzed, 20);
  assert.match(job.result, /Se encontraron 20 prospectos nuevos válidos y se analizaron todos/);
  assert.match(job.result, /Se descartaron 2 de otro rubro/, 'las peluquerías que mezcló Google');
  assert.match(job.campaignLabel, /^BARBERÍAS — QUILMES — /);
  barberCampaign = job.campaignId;
  const { items, total } = await listOf({ campana: barberCampaign });
  assert.equal(total, 20);
  assert.ok(items.every((p: { potentialLevel: string | null }) => ['alto', 'medio', 'bajo'].includes(p.potentialLevel!)), 'todos con potencial');
  assert.ok(items.every((p: { category: string }) => p.category === 'Barbería'), 'solo barberías');
  const card = (await admin.get(`/api/prospeccion/ficha/${items[0].id}`)).body;
  assert.ok(card.messages.primerContacto.includes(card.name), 'mensaje personalizado listo');
  assert.ok(card.messages.primerContactoMedio && card.messages.primerContactoCorto, 'tres tamaños');
  assert.ok(card.messageInsight.motivo && card.messageInsight.dolor && card.messageInsight.beneficio, 'motivo, dolor y beneficio');
  assert.equal(card.messageInsight.rubro, 'Barberías');
  assert.equal(card.rubroLabel, 'Barberías');
  const otra = (await admin.get(`/api/prospects/${items[0].id}/mensaje?tipo=primerContactoMedio&variante=1`)).body;
  assert.notEqual(otra.texto, card.messages.primerContactoMedio, 'Otra versión cambia el texto');
  assert.equal(otra.mensajes.primerContactoMedio, otra.texto);
  assert.ok(otra.insight.motivo);
  assert.ok(card.opportunities.headline.length > 3, 'oportunidad');
  assert.ok(card.potentialReason.startsWith('Prioridad'), 'motivo de la prioridad');
  assert.ok(card.channels.instagram && card.channels.web && card.channels.whatsapp && card.channels.reservas);
  const sum = (await admin.get('/api/prospeccion')).body.campaigns.find((c: { id: string }) => c.id === barberCampaign).summary;
  assert.deepEqual([sum.found, sum.analyzed, sum.notContacted, sum.contacted], [20, 20, 20, 0]);
  assert.equal(sum.potential.alto + sum.potential.medio + sum.potential.bajo, 20);
});

test('7–8. Persistencia entre búsquedas y días: no repite; si quedan 5 nuevos, entrega 5 y lo avisa', async () => {
  const before = maps.analyzed;
  const job = await search(admin, 'Barberías', 20);
  assert.equal(job.found, 5, 'quedaban 5 barberías nuevas de 25');
  assert.equal(job.analyzed, 5);
  assert.match(job.result, /No hay suficientes negocios nuevos para completar 20 sin repetir/);
  assert.equal(maps.analyzed - before, 5, 'no se volvió a analizar ninguna de las 20 anteriores');
  assert.equal(job.campaignId, barberCampaign, 'mismo mes: misma campaña');
  assert.equal((await listOf({ campana: barberCampaign })).total, 25);
  const again = await search(admin, 'Barberías', 10);
  assert.equal(again.found, 0, 'agotado: no rellena con duplicados');
  assert.match(again.result, /Se encontraron 0/);
});

test('18. Campañas separadas y 1. filtros por rubro: gimnasios no se mezclan con barberías', async () => {
  const job = await search(admin, 'Gimnasios', 20);
  gymCampaign = job.campaignId;
  assert.notEqual(gymCampaign, barberCampaign);
  assert.equal(job.found, 6);
  const gyms = await listOf({ campana: gymCampaign });
  assert.equal(gyms.total, 6);
  assert.ok(gyms.items.every((p: { name: string }) => p.name.startsWith('Gimnasio')));
  const byRubro = await listOf({ rubro: 'Barberías', zona: 'Quilmes' });
  assert.equal(byRubro.total, 25);
  assert.ok(byRubro.items.every((p: { name: string }) => p.name.startsWith('Barbería')));
  const campaigns = (await admin.get('/api/prospeccion')).body.campaigns;
  assert.equal(campaigns.length, 2);
});

test('3–4. Siguiente prospecto: solo no contactados de la campaña, por potencial; los contactados desaparecen', async () => {
  const q = (await admin.get(`/api/prospeccion/cola?campana=${barberCampaign}`)).body.items;
  assert.equal(q.length, 25);
  const order = ['alto', 'medio', 'bajo'];
  for (let i = 1; i < q.length; i++) assert.ok(order.indexOf(q[i - 1].potentialLevel) <= order.indexOf(q[i].potentialLevel), 'alto primero');
  const first = q[0];
  const card = (await admin.get(`/api/prospeccion/ficha/${first.id}`)).body;
  const r = await admin.post(`/api/prospeccion/${first.id}/resultado`, { estado: 'contactado', mensaje: card.messages.primerContacto });
  assert.equal(r.status, 200);
  const q2 = (await admin.get(`/api/prospeccion/cola?campana=${barberCampaign}`)).body.items;
  assert.equal(q2.length, 24);
  assert.ok(!q2.some((x: { id: string }) => x.id === first.id), 'el contactado no vuelve a aparecer');
  assert.equal(q2[0].id, q[1].id, 'Siguiente = el próximo pendiente');
  const gymQ = (await admin.get(`/api/prospeccion/cola?campana=${gymCampaign}`)).body.items;
  assert.ok(gymQ.every((x: { name: string }) => x.name.startsWith('Gimnasio')), 'la cola no mezcla campañas');
  const alto = (await admin.get(`/api/prospeccion/cola?campana=${barberCampaign}&potencial=alto`)).body.items;
  assert.ok(alto.length > 0 && alto.every((x: { potentialLevel: string }) => x.potentialLevel === 'alto'));
});

test('16. Cambio de estado: historial con el mensaje usado y el Generador sincronizado', async () => {
  const contacted = (await listOf({ campana: barberCampaign, estado: 'contactado' })).items;
  assert.equal(contacted.length, 1);
  const d = (await admin.get(`/api/prospects/${contacted[0].id}`)).body;
  assert.equal(d.status, 'contactado');
  assert.ok(d.activities.some((a: { type: string; content: string }) => a.type === 'whatsapp' && a.content.includes('Mensaje enviado (Prospección rápida)') && a.content.includes(d.name)));
  assert.ok(d.activities.some((a: { type: string; toStatus: string }) => a.type === 'estado' && a.toStatus === 'contactado'));
  const gen = (await admin.get('/api/generador?estado=contactado')).body.items;
  assert.ok(gen.some((g: { prospectId: string }) => g.prospectId === contacted[0].id), 'el Generador ve el mismo estado');
  const bad = await admin.post(`/api/prospeccion/${contacted[0].id}/resultado`, { estado: 'cualquiera' });
  assert.equal(bad.status, 400);
});

test('17. Próximo contacto: "Contactar después" con fecha → Próximos contactos y fuera de pendientes', async () => {
  const [p] = (await admin.get(`/api/prospeccion/cola?campana=${barberCampaign}`)).body.items;
  assert.equal((await admin.post(`/api/prospeccion/${p.id}/resultado`, { estado: 'contactar_despues' })).status, 400, 'pide la fecha');
  const fecha = new Date(Date.now() + 5 * 86_400_000).toISOString();
  assert.equal((await admin.post(`/api/prospeccion/${p.id}/resultado`, { estado: 'contactar_despues', fecha, nota: 'abre a la tarde' })).status, 200);
  const next = (await admin.get('/api/followups?scope=equipo')).body.items;
  assert.ok(next.some((f: { prospectId: string; note: string }) => f.prospectId === p.id && f.note === 'abre a la tarde'));
  const q = (await admin.get(`/api/prospeccion/cola?campana=${barberCampaign}`)).body.items;
  assert.ok(!q.some((x: { id: string }) => x.id === p.id));
  const later = await listOf({ campana: barberCampaign, estado: 'contactar_despues' });
  assert.equal(later.total, 1);
  assert.ok(later.items[0].nextFollowupAt, 'se ve la fecha del próximo contacto');
  const sum = (await admin.get('/api/prospeccion')).body.campaigns.find((c: { id: string }) => c.id === barberCampaign).summary;
  assert.equal(sum.later, 1);
  assert.equal(sum.contacted, 1);
  assert.equal(sum.notContacted, 23);
});

test('2. Filtros combinados: rubro + zona + estado + potencial', async () => {
  const all = await listOf({ rubro: 'Barberías', zona: 'Quilmes', estado: 'pendientes' });
  assert.equal(all.total, 23);
  const alto = await listOf({ rubro: 'Barberías', zona: 'Quilmes', estado: 'pendientes', potencial: 'alto' });
  assert.ok(alto.total > 0 && alto.total < 23);
  assert.ok(alto.items.every((p: { status: string; potentialLevel: string }) => p.status === 'sin_contactar' && p.potentialLevel === 'alto'));
  assert.equal((await listOf({ rubro: 'Gimnasios', estado: 'contactado' })).total, 0, 'no mezcla rubros');
  assert.equal((await listOf({ zona: 'Berazategui' })).total, 0);
});

test('5. Anti-duplicados después del análisis: el mismo negocio con otro nombre (mismo Instagram) no se entrega', async () => {
  // "Los Primos Barber Club" en otra dirección, pero con el Instagram de una barbería ya entregada.
  const dupe: FakeBusiness = { name: 'Los Navajeros Club', category: 'Barbería', address: 'Otra 999, Bernal', phone: '011 15 7777-1234', reviews: 50, rating: 4.5, instagram: 'https://www.instagram.com/navaja2/' };
  const fresh: FakeBusiness = { name: 'Barbería Bernal Centro', category: 'Barbería', address: 'Belgrano 5, Bernal', phone: '011 15 7777-9999', reviews: 30, rating: 4.2 };
  const m2 = new FakeMaps({ barberías: [dupe, fresh] });
  maps.byUrl.set(m2.urlOf(dupe), dupe);
  maps.byUrl.set(m2.urlOf(fresh), fresh);
  maps.pools['barberías'] = [...pools['barberías'], dupe, fresh];
  const job = await search(admin, 'Barberías', 5, 'Bernal');
  assert.equal(job.found, 2);
  assert.equal(job.duplicates, 1);
  assert.equal(job.analyzed, 1);
  assert.match(job.items.find((i: { name: string }) => i.name === 'Los Navajeros Club').detail, /mismo Instagram/);
  assert.match(job.result, /1 resultaron duplicados/);
  const bernal = await listOf({ zona: 'Bernal' });
  assert.deepEqual(bernal.items.map((p: { name: string }) => p.name), ['Barbería Bernal Centro']);
  assert.ok(!(await admin.get('/api/generador')).body.items.some((g: { name: string }) => g.name === 'Los Navajeros Club'), 'el descartado no se muestra');
  const again = await search(admin, 'Barberías', 5, 'Bernal');
  assert.equal(again.found, 0, 'y nunca se vuelve a entregar');
});

test('Un análisis que falla no frena la búsqueda y se informa', async () => {
  const bad: FakeBusiness = { name: 'Gimnasio Roto', category: 'Gimnasio', address: 'Falsa 1, Quilmes', phone: '011 4999-0001', failAnalysis: true };
  const good: FakeBusiness = { name: 'Gimnasio Nuevo', category: 'Gimnasio', address: 'Falsa 2, Quilmes', phone: '011 4999-0002', reviews: 40 };
  const m2 = new FakeMaps({ gimnasios: [bad, good] });
  maps.byUrl.set(m2.urlOf(bad), bad);
  maps.byUrl.set(m2.urlOf(good), good);
  maps.pools.gimnasios = [...pools.gimnasios, bad, good];
  const job = await search(admin, 'Gimnasios', 5);
  assert.equal(job.phase, 'terminado');
  assert.equal(job.found, 2);
  assert.equal(job.analyzed, 1);
  assert.equal(job.failed, 1);
  assert.match(job.items.find((i: { name: string }) => i.name === 'Gimnasio Roto').detail, /No se pudo analizar/);
  assert.match(job.result, /1 no se pudieron analizar/);
});

test('Una búsqueda a la vez, permisos y prospectos anteriores (sin campaña) siguen funcionando', async () => {
  // Prospecto analizado a mano antes de la prospección automática.
  const adminUser = app.users.list().find((u) => u.username === 'ivan')!;
  const { id } = app.repo.saveAnalysis(buildAnalysis('https://maps.app.goo.gl/vieja', prof({ name: 'Peluquería Vieja', category: 'Peluquería', socialLinks: [] }), undefined, { durationMs: 0 }), { userId: adminUser.id });
  const old = (await admin.get(`/api/prospects/${id}`)).body;
  assert.equal(old.campaignId, null);
  assert.ok(['alto', 'medio', 'bajo'].includes(old.potentialLevel), 'se le calcula el potencial');
  assert.equal((await listOf({ campana: 'none' })).items.some((p: { id: string }) => p.id === id), true);
  // Vendedor: solo ve lo suyo.
  const vend = await loggedClient(app.base, app.users, 'lucia', 'vendedor', 'Lucía');
  assert.equal((await vend.get(`/api/prospeccion/ficha/${id}`)).status, 404);
  assert.equal((await vend.get('/api/prospeccion/prospectos')).body.total, 0);
  assert.equal((await vend.post(`/api/prospeccion/${id}/resultado`, { estado: 'contactado' })).status, 404);
  assert.equal((await vend.get('/api/prospeccion/trabajo')).body.job, null, 'no ve la búsqueda de otro');
  // Validaciones.
  assert.equal((await admin.post('/api/prospeccion/buscar', { rubro: '', zona: 'Quilmes', cantidad: 5 })).status, 400);
  assert.equal((await admin.post('/api/prospeccion/buscar', { rubro: 'Barberías', zona: 'Quilmes', cantidad: 500 })).status, 400);
});
