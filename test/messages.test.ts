import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAnalysis } from '../src/analyzer.js';
import type { BusinessProfile } from '../src/domain/types.js';
import { BANNED_PHRASES, PITCHES } from '../src/messages/pitch.js';
import { ANGLES } from '../src/messages/sales.js';
import { buildInsight, buildMessages, buildSelection, wordCount } from '../src/messages/whatsapp.js';
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

// "oportunidad" ya no está prohibida: la nueva regla comercial habla de UNA oportunidad concreta.
const BANNED = /sin compromiso|oportunidad única|soluci[oó]n(es)? integral|potenciar|estimad[oa]|atentamente|le saluda|sinergia|apalancar|\bundefined\b|\bnull\b|\bNaN\b/i;
const CTA = /¿(Te puedo mandar un audio de un minuto mostrándote lo que vi|Querés que te muestre dónde detecté esta oportunidad|Te interesa que te explique cómo lo resolvería)\?$/;
const paragraphs = (t: string) => t.split(/\n\n/).length;

test('mensaje de ventas: saludo, presentación, oportunidad, pérdida económica, beneficio y pregunta simple', () => {
  const m = messagesFor({});
  const t = m.primerContacto;
  assert.match(t, /^(Hola|Buenas|Buen día)/);
  assert.match(t, /Soy Martín, de Rosario\./);
  assert.match(t, /Estuve (viendo|mirando( cómo aparece)?) Parrilla Don Tito/);
  assert.match(t, /(mesas?|pedidos?|reservas?)/, 'dolor en el lenguaje de un restaurante');
  assert.match(t, CTA, 'termina con una pregunta simple de bajo compromiso');
  const n = wordCount(t);
  assert.ok(n >= 80 && n <= 150, `${n} palabras:\n${t}`);
  assert.ok(paragraphs(t) <= 2, 'máximo 2 párrafos');
  assert.ok(wordCount(m.primerContactoCorto) < wordCount(m.primerContactoMedio) && wordCount(m.primerContactoMedio) < n, 'corto < mediano < completo');
  assert.match(m.primerContactoMedio, CTA);
  assert.match(m.primerContactoCorto, CTA);
  assert.match(m.seguimiento, /avisame y no te escribo más/);
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
      assert.doesNotMatch(text, /\.\.|\s[.,:]|:\s*[.:]/, text);
    }
  }
});

test('sin nombre configurado deja un marcador visible; variantes estables por prospecto', () => {
  const m = messagesFor({}, 'x', { sellerName: '', sellerCity: '' });
  assert.match(m.primerContacto, /Soy \[tu nombre\]\. Estuve/);
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
    for (const k of ['primerContacto', 'primerContactoMedio', 'primerContactoCorto'] as const) {
      assert.match(m[k], /Parrilla Don Tito/);
      assert.match(m[k], /Martín/);
      assert.match(m[k], CTA, `${k} v${v}`);
    }
    const n = wordCount(m.primerContacto);
    assert.ok(n >= 80 && n <= 150, `variante ${v}: ${n} palabras`);
    seen.add(m.primerContacto);
  }
  assert.ok(seen.size >= 6, `deberían salir versiones distintas (salieron ${seen.size} de 8)`);
  // Varía también qué oportunidad abre el mensaje.
  const leads = new Set([0, 1, 2, 3, 4, 5].map((v) => buildSelection(input, seller, v)[0]?.findingId));
  assert.ok(leads.size >= 2, 'la oportunidad principal debería rotar entre versiones');
  // Motivo comercial, dolor y beneficio acompañan a cada versión y aparecen en el texto completo.
  for (let v = 0; v < 4; v++) {
    const ins = buildInsight(input, seller, v);
    const m = buildMessages(input, seller, v);
    assert.ok(ins.motivo && ins.dolor && ins.beneficio && ins.rubro === 'Gastronomía');
    assert.ok(m.primerContacto.includes(ins.dolor), 'el dolor económico está en el mensaje');
  }
});

test('nunca solo el problema: cada oportunidad, en cada rubro, trae consecuencia, pérdida, beneficio y pregunta', () => {
  const rubros: Array<[string, string, string, RegExp]> = [
    ['Barbería El Corte', 'Barbería', 'Barbería', /turno|agenda/],
    ['Parrilla Don Tito', 'Parrilla', 'Gastronomía', /mesa|pedido|reserva/],
    ['Gimnasio Fuerza', 'Gimnasio', 'Gimnasio', /socio|clase|anot/],
    ['Estética Bella', 'Centro de estética', 'Estética y peluquería', /turno|precio|ocupación|confianza|elig/],
    ['Taller El Rayo', 'Taller mecánico', 'Taller', /taller|cliente|consulta/],
    ['Consultorio Pérez', 'Dentista', 'Salud', /paciente|turno/],
    ['Ferretería Central', 'Ferretería', 'Negocio local', /cliente|consulta|venta|reserva|competencia|interesad/],
  ];
  const profile = (name: string, category: string): BusinessProfile => ({
    ...base, name, category, rating: 3.8, reviewCount: 12, photoCount: 4, hours: { days: { lunes: '9–18', martes: '9–18' } } as never,
  });
  const ids = Object.keys(PITCHES);
  assert.deepEqual(ids.filter((id) => !ANGLES[id]), [], 'toda oportunidad tiene su ángulo de venta');
  for (const [name, category, label, pain] of rubros) {
    const prof = profile(name, category);
    const a = buildAnalysis('u', prof, undefined, { durationMs: 0 });
    for (const id of ids) {
      const problems = [{ findingId: id, area: 'maps', problem: '', impact: 'Alto', reason: '', serviceIds: ['maps'], service: '', benefit: '', level: 'confirmado' }] as never;
      const input = { id: `${name}-${id}`, name, verticalId: a.vertical.id, verticalLabel: a.vertical.label, problems, services: [], analysis: { ...a, website: { ...emptyAnalysis('https://x.com'), loadTimeMs: 7000 }, audit: { ...a.audit, metrics: { ...a.audit.metrics, daysSinceLastReview: 200 } } } };
      const m = buildMessages(input, { sellerName: 'Iván Bologna', sellerBusiness: 'Gestor de Presencia Online' });
      const sel = buildSelection(input, { sellerName: 'Iván' });
      if (!sel.length) continue; // la plantilla no aplica a estos datos (p. ej. falta un dato): no se inventa
      const ins = buildInsight(input, { sellerName: 'Iván' });
      assert.equal(ins.rubro, label, `${name}`);
      const t = m.primerContacto;
      const n = wordCount(t);
      assert.ok(n >= 80 && n <= 150, `${name}/${id}: ${n} palabras\n${t}`);
      assert.ok(paragraphs(t) <= 2, `${name}/${id}: más de 2 párrafos`);
      assert.match(t, CTA, `${name}/${id}`);
      assert.match(t, pain, `${name}/${id}: el dolor no está en el lenguaje del rubro\n${t}`);
      assert.ok(t.includes(ins.dolor) && t.includes(ins.beneficio), `${name}/${id}: falta pérdida o beneficio`);
      assert.ok(wordCount(m.primerContactoMedio) <= 110, `${name}/${id}: mediano largo (${wordCount(m.primerContactoMedio)})`);
      assert.ok(wordCount(m.primerContactoCorto) <= 75, `${name}/${id}: corto largo (${wordCount(m.primerContactoCorto)})`);
      assert.equal(paragraphs(m.primerContactoCorto), 1);
      for (const text of Object.values(m)) {
        assert.doesNotMatch(text, BANNED, `${name}/${id}`);
        assert.doesNotMatch(text, /\.\.|\s[.,:]|undefined|\bNaN\b/, `${name}/${id}: ${text}`);
        for (const b of BANNED_PHRASES) assert.ok(!text.toLowerCase().includes(b), `${name}/${id}: "${b}"`);
      }
    }
  }
});
