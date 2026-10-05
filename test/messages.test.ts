import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAnalysis } from '../src/analyzer.js';
import type { BusinessProfile } from '../src/domain/types.js';
import { buildMessages } from '../src/messages/whatsapp.js';
import { emptyAnalysis } from '../src/scraper/websiteAnalyzer.js';

const base: BusinessProfile = {
  sourceUrl: 'x', name: 'Parrilla Don Tito', category: 'Restaurante', additionalCategories: [], rating: 3.6, reviewCount: 35,
  address: 'Av. Corrientes 1234', phone: '+54 11 5555-1234', services: [], hasBooking: false, hasMenu: false, photoCount: 6,
  photoCountIsEstimate: false, photoUrls: [], posts: [], permanentlyClosed: false, socialLinks: [], scrapedAt: '', warnings: [], isClaimed: false,
  reviews: [{ rating: 2, ageDays: 80, hasOwnerResponse: false }, { rating: 5, ageDays: 90, hasOwnerResponse: false }, { rating: 4, ageDays: 120, hasOwnerResponse: false }],
};

function messagesFor(over: Partial<BusinessProfile>, id = 'p1', seller = { sellerName: 'Martín', sellerCity: 'Rosario' }, website = undefined as ReturnType<typeof emptyAnalysis> | undefined) {
  const p = { ...base, ...over };
  const a = buildAnalysis('u', p, website, { durationMs: 0 });
  return buildMessages({ id, name: p.name!, verticalId: a.vertical.id, verticalLabel: a.vertical.label, problems: a.proposal.salesArguments, services: a.proposal.services, analysis: a }, seller);
}

const BANNED = /sin compromiso|oportunidad|soluci[oó]n(es)? integral|potenciar|estimad[oa]|atentamente|le saluda|sinergia|apalancar|\bundefined\b|\bnull\b|NaN/i;

test('mensajes concretos, con datos reales del negocio y tono argentino', () => {
  const m = messagesFor({});
  assert.match(m.primerContacto, /Parrilla Don Tito/);
  assert.match(m.primerContacto, /Soy Martín, de Rosario/);
  assert.match(m.primerContacto, /no encontré una web propia|no reclamada|35 reseñas/);
  assert.match(m.primerContacto, /¿Te |¿Hablo|¿Este es/);
  assert.match(m.seguimiento, /avisame y no te escribo más/);
  assert.ok(m.primerContactoCorto.length < m.primerContacto.length);
  for (const text of Object.values(m)) assert.doesNotMatch(text, BANNED);
});

test('ningún tipo de problema produce textos rotos', () => {
  const variants: Array<Partial<BusinessProfile>> = [
    {},
    { reviewCount: 4, rating: 4.9, isClaimed: true },
    { website: 'https://instagram.com/x' },
    { permanentlyClosed: true },
    { category: 'Peluquería', name: 'Lola', reviews: [] },
    { category: 'Dentista', name: 'Consultorio Pérez', hours: undefined, photoCount: 3 },
  ];
  for (const [i, v] of variants.entries()) {
    const site = v.website ? emptyAnalysis(v.website) : undefined;
    for (const text of Object.values(messagesFor(v, `id-${i}`, undefined, site))) {
      assert.doesNotMatch(text, BANNED, text);
      assert.doesNotMatch(text, /\.\./);
    }
  }
});

test('sin nombre configurado deja un marcador visible; variantes estables por prospecto', () => {
  const m = messagesFor({}, 'x', { sellerName: '', sellerCity: '' });
  assert.match(m.primerContacto, /Soy \[tu nombre\]\. Trabajo/);
  assert.equal(messagesFor({}, 'mismo').primerContacto, messagesFor({}, 'mismo').primerContacto);
  const distinct = new Set(Array.from({ length: 12 }, (_, i) => messagesFor({}, `seed-${i}`).primerContacto));
  assert.ok(distinct.size >= 3, `pocas variantes: ${distinct.size}`);
});

test('"Otra versión": cada variante cambia el texto, sin inventar datos ni frases prohibidas', () => {
  const p = { ...base };
  const a = buildAnalysis('u', p, undefined, { durationMs: 0 });
  const input = { id: 'p1', name: p.name!, verticalId: a.vertical.id, verticalLabel: a.vertical.label, problems: a.proposal.salesArguments, services: a.proposal.services, analysis: a };
  const seller = { sellerName: 'Martín', sellerCity: 'Rosario', sellerBusiness: 'Presencia Total' };
  // La versión 0 es la de siempre.
  assert.deepEqual(buildMessages(input, seller, 0), buildMessages(input, seller));
  const seen = new Set<string>();
  for (let v = 0; v < 8; v++) {
    const m = buildMessages(input, seller, v);
    for (const text of Object.values(m)) {
      assert.doesNotMatch(text, BANNED, `variante ${v}: ${text}`);
      assert.doesNotMatch(text, /puedo que|puedo un /, `redacción rota en variante ${v}`);
    }
    assert.match(m.primerContacto, /Parrilla Don Tito/);
    assert.match(m.primerContacto, /Martín/);
    seen.add(m.primerContacto);
  }
  assert.ok(seen.size >= 6, `deberían salir versiones distintas (salieron ${seen.size} de 8)`);
  // Varía también qué problema abre el mensaje.
  const openings = new Set([1, 2, 3, 4, 5, 6].map((v) => buildMessages(input, seller, v).primerContactoCorto.split('\n\n')[1]));
  assert.ok(openings.size >= 2, 'el problema de arranque debería rotar entre versiones');
});
