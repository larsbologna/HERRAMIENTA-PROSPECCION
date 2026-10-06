/**
 * MENSAJES COMERCIALES por rubro: personalización · observación · consecuencia · oportunidad · CTA.
 * Vocabulario del rubro (turnos / reservas / productos), estilos según el caso, control de calidad.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAnalysis } from '../src/analyzer.js';
import { buildChannelReport } from '../src/channels/crossCheck.js';
import type { InstagramAnalysis } from '../src/channels/instagram.js';
import type { BusinessProfile } from '../src/domain/types.js';
import { BANNED_PHRASES } from '../src/messages/pitch.js';
import { buildInsight, buildMessages, buildSelection, CTAS, reviewMessage, wordCount } from '../src/messages/whatsapp.js';
import { analyzeOpportunities } from '../src/opportunities/engine.js';
import { BUILTIN_RUBROS, DEFAULT_CATALOG } from '../src/rubros/catalog.js';
import { emptyAnalysis } from '../src/scraper/websiteAnalyzer.js';

const SELLER = { sellerName: 'Iván Bologna', sellerBusiness: 'Gestor de Presencia Online' };
const BANNED = /sin compromiso|oportunidad única|soluci[oó]n(es)? integral|potenciar|estimad[oa]|atentamente|le saluda|sinergia|apalancar|\bundefined\b|\bnull\b|\bNaN\b/i;

const prof = (over: Partial<BusinessProfile>): BusinessProfile => ({
  sourceUrl: 'x', name: 'Negocio', category: undefined, additionalCategories: [], rating: 4.2, reviewCount: 30, address: 'Laprida 100, Quilmes',
  phone: '011 15 4444-5555', services: [], hasBooking: false, hasMenu: false, photoCount: 30, photoCountIsEstimate: false, photoUrls: [], posts: [],
  reviews: [], permanentlyClosed: false, socialLinks: [], scrapedAt: '', warnings: [], isClaimed: true, description: 'Atención de calidad.',
  hours: { days: { lunes: '9–18', martes: '9–18', miércoles: '9–18', jueves: '9–18', viernes: '9–18', sábado: '9–13', domingo: 'Cerrado' } } as never,
  ...over,
});
const ig = (over: Partial<InstagramAnalysis> = {}): InstagramAnalysis => ({
  url: 'https://www.instagram.com/negocio/', username: 'negocio', status: 'ok', links: [], contactAvailable: false, linktreeLinks: [],
  linktreeChecked: false, manualBooking: false, notes: [], checkedAt: '', ...over,
});

function forBusiness(p: BusinessProfile, instagram?: InstagramAnalysis, id = 'p1', variant = 0) {
  const a = buildAnalysis('u', p, undefined, { durationMs: 0 }, buildChannelReport(p, undefined, instagram));
  const det = DEFAULT_CATALOG.detect(p);
  const rubroProfile = DEFAULT_CATALOG.profileFor(det?.key);
  const d = { id, name: p.name!, verticalId: a.vertical.id, verticalLabel: a.vertical.label, problems: a.proposal.salesArguments, services: a.proposal.services, analysis: a, rubroProfile };
  return { a, rubroProfile, m: buildMessages(d, SELLER, variant), sel: buildSelection(d, SELLER, variant), ins: buildInsight(d, SELLER, variant), d };
}

const VET = prof({
  name: 'Veterinaria Laprida', category: 'Veterinario', rating: 4.6, reviewCount: 168,
  reviews: [{ rating: 1, ageDays: 10, hasOwnerResponse: false }, { rating: 2, ageDays: 25, hasOwnerResponse: false }, { rating: 5, ageDays: 30, hasOwnerResponse: true }],
});

test('Veterinaria Laprida: reconoce la reputación, habla de TURNOS y de la consecuencia, sin tecnicismos', () => {
  const { m, ins, sel } = forBusiness(VET);
  const t = m.primerContacto;
  assert.match(t, /^Hola|^Buenas|^Buen día/);
  assert.match(t, /Soy Iván Bologna, Gestor de Presencia Online\./);
  assert.match(t, /Veterinaria Laprida/);
  assert.match(t, /más de 160 reseñas en Google y una muy buena puntuación/, 'lo que hace bien, con datos reales');
  assert.match(t, /hacer una consulta o pedir un turno/, 'vocabulario de veterinaria');
  assert.match(t, /otra veterinaria/);
  assert.match(t, /\bpuede\b/, 'consecuencia prudente');
  assert.doesNotMatch(t, /\breserv/i, 'una veterinaria habla de turnos, no de reservas');
  assert.doesNotMatch(t, /visible de escribirles por WhatsApp desde Google/, 'no es la frase técnica de antes');
  assert.ok(/\?$/.test(t) || Object.values(CTAS).flat().some((c) => t.endsWith(c)), 'CTA simple');
  const n = wordCount(t);
  assert.ok(n >= 60 && n <= 150, `${n} palabras`);
  assert.equal(sel[0]!.text, 'Sin canal rápido de consulta', 'la prioridad de una veterinaria: el canal de consultas');
  assert.ok(ins.calidad.every((c) => c.ok), `control de calidad: ${ins.calidad.filter((c) => !c.ok).map((c) => c.label).join('; ')}`);
  for (const text of Object.values(m)) assert.doesNotMatch(text, /\breserv/i);
});

test('Pet shop: catálogo y pedidos; NUNCA turnos ni reservas', () => {
  const p = prof({ name: 'Pet Shop Mundo Animal', category: 'Tienda de mascotas', rating: 4.3, reviewCount: 55, socialLinks: ['https://www.instagram.com/mundoanimal/'] });
  const { m, sel, rubroProfile, a } = forBusiness(p, ig({ username: 'mundoanimal' }));
  assert.equal(rubroProfile.key, 'pet-shops');
  for (const text of Object.values(m)) assert.doesNotMatch(text, /\b(turnos?|reserv\w*)\b/i, `pet shop con turnos/reservas:\n${text}`);
  assert.equal(sel[0]!.text, 'Sin catálogo de productos', 'lo primero para un pet shop: dónde ver productos y precios');
  const report = analyzeOpportunities(a, rubroProfile);
  assert.ok(!report.opportunities.some((o) => o.topic === 'agenda'), 'ninguna oportunidad de agenda');
});

test('Barbería: turnos; si los turnos existen solo detrás de Instagram → Linktree, dice que están escondidos', () => {
  const p = prof({ name: 'Aurum Barber Club', category: 'Barbería', rating: 4.8, reviewCount: 90, socialLinks: ['https://www.instagram.com/aurum/'] });
  const { m, sel, a } = forBusiness(p, ig({ username: 'aurum', links: ['https://linktr.ee/aurum'], externalUrl: 'https://linktr.ee/aurum', linktree: 'https://linktr.ee/aurum', linktreeChecked: true, linktreeLinks: ['https://booksy.com/es-ar/1_aurum'], bookingUrl: 'https://booksy.com/es-ar/1_aurum', bookingProvider: 'Booksy' }));
  assert.ok(!a.audit.findings.some((f) => f.id === 'booking-none'), 'no dice "falta de turnos"');
  assert.equal(sel[0]!.findingId, 'booking-hidden');
  assert.match(m.primerContacto, /el sistema de turnos existe, pero está escondido detrás de varios pasos/);
  for (const text of Object.values(m)) assert.doesNotMatch(text, /\breserv/i);
});

test('Restaurante: puede hablar de reservas', () => {
  const p = prof({ name: 'Al Horno con Papas', category: 'Restaurante', rating: 4.5, reviewCount: 120 });
  const { m, rubroProfile } = forBusiness(p);
  assert.equal(rubroProfile.key, 'restaurantes');
  assert.match(Object.values(m).join('\n'), /reserv/i, 'en un restaurante sí se habla de reservas');
  assert.match(m.primerContacto, /otro restaurante/);
});

test('el ranking depende del rubro (no siempre WhatsApp → reservas → reseñas)', () => {
  const tops = new Map<string, string>();
  for (const [name, category] of [['Veterinaria Laprida', 'Veterinario'], ['Pet Shop Mundo', 'Tienda de mascotas'], ['Barbería Uno', 'Barbería'], ['Inmobiliaria Sur', 'Inmobiliaria'], ['Gimnasio Fuerza', 'Gimnasio']]) {
    const { sel } = forBusiness(prof({ name, category, rating: 4.6, reviewCount: 120 }));
    tops.set(category, sel.map((s) => s.findingId).join(','));
  }
  assert.ok(new Set(tops.values()).size >= 3, `rankings iguales para todos: ${[...tops.entries()].join(' | ')}`);
  assert.match(tops.get('Barbería')!, /^booking-none/, 'barbería: turnos primero');
  assert.match(tops.get('Tienda de mascotas')!, /^catalog-none/, 'pet shop: catálogo primero');
  assert.match(tops.get('Veterinario')!, /^wa-not-visible/, 'veterinaria: canal de consultas primero');
});

test('sin oportunidades repetidas ni del mismo tema en el mensaje', () => {
  for (const [name, category] of [['Veterinaria Laprida', 'Veterinario'], ['Barbería Uno', 'Barbería'], ['Pet Shop Mundo', 'Tienda de mascotas']]) {
    const { a, rubroProfile, m } = forBusiness(prof({ name, category, rating: 4.6, reviewCount: 120 }));
    const r = analyzeOpportunities(a, rubroProfile);
    assert.equal(new Set(r.opportunities.map((o) => o.id)).size, r.opportunities.length, 'ids únicos');
    const top3 = r.opportunities.slice(0, 3).map((o) => o.topic);
    assert.equal(new Set(top3).size, top3.length, `temas repetidos en el top 3 de ${name}: ${top3}`);
    for (const o of r.opportunities) {
      assert.ok(o.source && o.evidence && o.confidence, 'fuente, evidencia y confianza');
      assert.match(o.consequence, /\b(puede|pueden|podría|suele|muchos|mucha gente|algunos|algunas|casi todo)\b/i, `consecuencia prudente: ${o.consequence}`);
    }
    const sentences = m.primerContacto.split(/(?<=[.?])\s+/);
    assert.equal(new Set(sentences).size, sentences.length, 'no repite frases');
  }
});

test('estilos según el contexto y "Otra versión" cambia de enfoque', () => {
  const styles = new Set<string>();
  const texts = new Set<string>();
  for (let v = 0; v < 6; v++) {
    const { m, ins } = forBusiness(VET, undefined, 'p1', v);
    styles.add(ins.estilo);
    texts.add(m.primerContacto);
    assert.ok(ins.calidad.every((c) => c.ok), `v${v}: ${ins.calidad.filter((c) => !c.ok).map((c) => c.label).join('; ')}`);
  }
  assert.ok(styles.size >= 3, `pocos estilos: ${[...styles]}`);
  assert.ok(texts.size >= 5);
  // Contexto: con buena reputación el primer mensaje la usa; sin reseñas, no la inventa.
  assert.match(forBusiness(VET).m.primerContacto, /muy buena puntuación|reputación/);
  const nuevo = forBusiness(prof({ name: 'Veterinaria Nueva', category: 'Veterinario', rating: undefined, reviewCount: 2, reviews: [] }));
  assert.doesNotMatch(nuevo.m.primerContacto, /reputación|muy buena puntuación|más de \d+ reseñas/);
});

test('Instagram: versión más corta; WhatsApp completo, mediano y corto', () => {
  const { m } = forBusiness(VET);
  assert.ok(wordCount(m.instagram) <= 50 && wordCount(m.instagram) < wordCount(m.primerContactoCorto));
  assert.ok(wordCount(m.primerContactoCorto) < wordCount(m.primerContactoMedio) && wordCount(m.primerContactoMedio) < wordCount(m.primerContacto));
  assert.match(m.instagram, /Veterinaria Laprida/);
  assert.match(m.seguimiento, /avisame y no te escribo más/);
});

test('control de calidad: detecta tecnicismos, spam, cifras inventadas y vocabulario equivocado', () => {
  const vet = DEFAULT_CATALOG.profileFor('veterinarias');
  const pet = DEFAULT_CATALOG.profileFor('pet-shops');
  const bad = (t: string, r = vet) => reviewMessage(t, 'completo', { name: 'X', rubro: r }).filter((c) => !c.ok).map((c) => c.label);
  const base = 'Hola. Soy Iván. Estuve viendo X y puede que pierdan consultas. '.repeat(6) + '¿Te mando un video?';
  assert.deepEqual(bad(base), []);
  assert.ok(bad(`${base} Les falta un CTA y SEO.`).some((l) => /tecnicismos/.test(l)));
  assert.ok(bad(`${base} Están perdiendo 30 clientes por mes.`).some((l) => /cifras/.test(l)));
  assert.ok(bad(`${base} Con reservas online mejora.`).some((l) => /Vocabulario/.test(l)), 'veterinaria con "reservas"');
  assert.ok(bad(`${base} Sin turnos online.`, pet).some((l) => /Vocabulario/.test(l)), 'pet shop con "turnos"');
  assert.ok(bad(`${base} Es una oportunidad única, sin compromiso.`).some((l) => /spam/.test(l)));
});

test('todos los rubros: mensajes armados, con su vocabulario, sin frases prohibidas ni textos rotos', () => {
  for (const r of BUILTIN_RUBROS) {
    const p = prof({ name: `${r.label} Central`, category: r.label.replace(/s$/, ''), rating: 4.5, reviewCount: 80 });
    const { m, rubroProfile, ins } = forBusiness(p, undefined, `id-${r.key}`);
    assert.equal(rubroProfile.key, r.key, `${r.label} detectado`);
    for (const text of Object.values(m)) {
      assert.doesNotMatch(text, BANNED, `${r.key}: ${text}`);
      assert.doesNotMatch(text, /\.\.|\s[.,:]|\bundefined\b/, `${r.key}: ${text}`);
      for (const b of BANNED_PHRASES) assert.ok(!text.toLowerCase().includes(b), `${r.key}: "${b}"`);
      if (!r.booking) assert.doesNotMatch(text, /\b(turnos?|reserv\w*)\b/i, `${r.key} no agenda:\n${text}`);
      if (r.booking === 'turnos') assert.doesNotMatch(text, /\breserv/i, `${r.key} usa turnos:\n${text}`);
    }
    assert.ok(ins.calidad.every((c) => c.ok), `${r.key}: ${ins.calidad.filter((c) => !c.ok).map((c) => c.label).join('; ')}`);
  }
});

test('sin oportunidades confirmadas: mensaje honesto, sin inventar problemas', () => {
  const ok = prof({ name: 'Barbería Perfecta', category: 'Barbería', rating: 4.9, reviewCount: 380, website: 'https://perfecta.com.ar', hasBooking: true, bookingUrl: 'https://booksy.com/x', photoCount: 120, posts: [{ ageDays: 3 }] as never });
  const site = { ...emptyAnalysis(ok.website!), reachable: true, https: true, whatsapp: { hasLink: true, links: ['https://wa.me/5491144445555'], hasFloatingButton: true }, booking: { hasOnlineBooking: true, providers: ['Booksy'] }, contact: { phoneLinks: ['tel:1'], emailLinks: [], hasContactForm: true, hasAddress: true, contactAboveFold: true }, scores: { visual: 90, mobile: 90, speed: 90, contact: 90 } };
  const a = buildAnalysis('u', ok, site, { durationMs: 0 }, buildChannelReport(ok, site));
  const rubroProfile = DEFAULT_CATALOG.profileFor('barberias');
  const d = { id: 'p', name: ok.name!, verticalId: a.vertical.id, verticalLabel: a.vertical.label, problems: a.proposal.salesArguments, services: a.proposal.services, analysis: a, rubroProfile };
  const sel = buildSelection(d, SELLER);
  if (!sel.length) assert.match(buildMessages(d, SELLER).primerContacto, /no te voy a inventar problemas/);
  for (const s of sel) assert.notEqual(a.audit.findings.find((f) => f.id === s.findingId)?.level, 'probable');
});

test('CTA variable: distintas familias según el caso, sin "video" por defecto y sin prometer resultados', () => {
  const finals = new Set<string>();
  const families = new Set<string>();
  let video = 0;
  const cases: BusinessProfile[] = [];
  for (let i = 0; i < 12; i++) {
    cases.push(prof({ name: `Veterinaria Sur ${i}`, category: 'Veterinario', rating: 4.5, reviewCount: 60 + i * 20 }));
    cases.push(prof({ name: `Barbería Corte ${i}`, category: 'Barbería', rating: 4.3, reviewCount: 25 + i * 7, photoCount: 3 }));
    cases.push(prof({ name: `Pet Shop Kiara ${i}`, category: 'Tienda de mascotas', rating: 4.4, reviewCount: 40 + i, socialLinks: ['https://www.instagram.com/kiara/'] }));
  }
  for (const [k, p] of cases.entries()) {
    const { m, ins } = forBusiness(p, undefined, `id-${k}`);
    const last = m.primerContacto.split('\n\n').at(-1)!;
    finals.add(last);
    families.add(ins.cta);
    if (/video/i.test(last)) video++;
    for (const t of Object.values(m)) {
      assert.doesNotMatch(t, /te voy a conseguir|vas a (aumentar|duplicar|ganar)|\d+\s?%/i, 'no promete resultados');
    }
  }
  assert.ok(finals.size >= 6, `CTA distintos: ${finals.size}`);
  assert.ok(families.size >= 3, `familias: ${[...families].join(', ')}`);
  assert.ok(video <= cases.length / 6, `el video no es el CTA por defecto (${video} de ${cases.length})`);
  // "Otra versión" cambia el cierre.
  const v0 = forBusiness(VET, undefined, 'x', 0).m.primerContacto.split('\n\n').at(-1);
  const others = [1, 2, 3].map((v) => forBusiness(VET, undefined, 'x', v).m.primerContacto.split('\n\n').at(-1));
  assert.ok(others.some((o) => o !== v0), 'otra versión, otro CTA');
});

test('Guion para teléfono e Instagram: breves, para el canal correcto', () => {
  const { m } = forBusiness(VET);
  assert.match(m.telefono, /^Hola, ¿cómo va\? Soy Iván Bologna\./);
  assert.match(m.telefono, /¿Con quién podría hablar sobre eso\?$/);
  assert.ok(wordCount(m.telefono) <= 70, `${wordCount(m.telefono)} palabras`);
  assert.ok(wordCount(m.instagram) < wordCount(m.primerContacto) / 2, 'Instagram es bastante más corto');
  assert.doesNotMatch(m.instagram, /WhatsApp/i);
});
