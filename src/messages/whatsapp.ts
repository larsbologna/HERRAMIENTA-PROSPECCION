import type { ChannelReport } from '../channels/crossCheck.js';
import type { AnalysisResult, AuditResult, BusinessProfile, Finding, SalesArgument, ServiceRecommendation, WebsiteAnalysis } from '../domain/types.js';
import { analyzeOpportunities, type Opportunity, type OpportunityReport, type Strength } from '../opportunities/engine.js';
import { DEFAULT_CATALOG, GENERAL_RUBRO, type RubroProfile, type Topic } from '../rubros/catalog.js';
import { BANNED_PHRASES } from './pitch.js';

/**
 * MENSAJES DE PRIMER CONTACTO (WhatsApp e Instagram) para negocios locales.
 *
 * Objetivo: que el dueño RESPONDA. La pregunta de fondo no es "¿qué le falta?" sino "¿qué hace bien,
 * dónde puede estar perdiendo clientes y qué podría mejorar?".
 *
 * Estructura: personalización · observación concreta (algo que hace bien + lo que se ve) ·
 * consecuencia comercial (prudente: "puede", "podría"; nunca cifras inventadas) · oportunidad · CTA simple.
 *
 *  - Solo oportunidades CONFIRMADAS, ordenadas según el rubro (src/opportunities/engine.ts).
 *  - Vocabulario del rubro: una veterinaria y una barbería hablan de TURNOS, un restaurante de
 *    RESERVAS y un pet shop de productos y pedidos (nunca de turnos ni reservas).
 *  - Seis estilos (observación, oportunidad, competencia, reputación, conversión, directo), elegidos
 *    según lo que se encontró: la variedad es contextual, no al azar.
 *  - Antes de entregarse, cada mensaje pasa un control de calidad; si no lo pasa, se rearma con otro
 *    estilo u otra oportunidad.
 */

export interface MessageInput {
  /** Semilla estable para elegir frases (id o nombre del prospecto). */
  seed: string;
  name: string;
  verticalId: string;
  verticalLabel: string;
  problems: SalesArgument[];
  services: ServiceRecommendation[];
  profile?: Partial<BusinessProfile>;
  website?: WebsiteAnalysis;
  metrics?: AuditResult['metrics'];
  /** Canales verificados (Maps + web + Instagram). */
  channels?: ChannelReport;
  /** Hallazgos de la auditoría (si no están, se reconstruyen desde los argumentos). */
  findings?: Finding[];
  /** Rubro del prospecto (si no está, se detecta con la categoría y el nombre). */
  rubro?: RubroProfile;
}

export interface Seller {
  sellerName: string;
  sellerBusiness?: string;
  sellerCity?: string;
  /** Presentación propia (si está vacía se usa la del negocio). */
  sellerIntro?: string;
  /** Web, Instagram o @usuario para mostrar trabajos. */
  sellerLink?: string;
}

/** "tunegocio.com" → "https://tunegocio.com"; "@usuario" → enlace de Instagram. */
export function sellerLinkUrl(link: string | undefined): string | undefined {
  const l = link?.trim();
  if (!l) return undefined;
  if (/^@[\w.]+$/.test(l)) return `https://instagram.com/${l.slice(1)}`;
  return /^https?:\/\//i.test(l) ? l : `https://${l}`;
}

export interface ProspectMessages {
  /** WhatsApp completo. */
  primerContacto: string;
  /** WhatsApp mediano. */
  primerContactoMedio: string;
  /** WhatsApp corto. */
  primerContactoCorto: string;
  /** Mensaje directo de Instagram (más corto). */
  instagram: string;
  seguimiento: string;
}

/** Oportunidades que usa el mensaje (la principal primero). */
export type MessageSelection = Array<{ findingId: string; priority: number; text: string }>;

export type MessageStyle = 'observacion' | 'oportunidad' | 'competencia' | 'reputacion' | 'conversion' | 'directo';
export const STYLE_LABEL: Record<MessageStyle, string> = {
  observacion: 'Observación', oportunidad: 'Oportunidad', competencia: 'Competencia', reputacion: 'Reputación', conversion: 'Conversión', directo: 'Directo',
};

export interface QualityCheck { label: string; ok: boolean }

/** Por qué el mensaje dice lo que dice (se muestra al vendedor, no se envía). */
export interface MessageInsight {
  /** Motivo comercial utilizado. */
  motivo: string;
  /** Lo que se observó (con su fuente). */
  oportunidad: string;
  /** Consecuencia comercial que se comunica. */
  dolor: string;
  /** Qué podría mejorar si se resuelve. */
  beneficio: string;
  rubro: string;
  estilo: string;
  fuente: string;
  evidencia: string;
  calidad: QualityCheck[];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pick = <T>(arr: readonly T[], seed: string, salt: string): T => arr[hash(seed + salt) % arr.length]!;
const join = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : (items[0] ?? ''));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Canales que el negocio YA tiene, confirmados en la verificación cruzada (para reconocerlo). */
export function strengths(ch: ChannelReport | undefined): string[] {
  if (!ch) return [];
  const has = (id: string) => ch.channels.find((c) => c.id === id && c.status === 'encontrado');
  const out: string[] = [];
  if (has('instagram')) out.push('Instagram');
  const web = has('web');
  if (web && !/no carga/i.test(web.detail ?? '')) out.push('página web');
  const res = has('reservas');
  if (res?.url) out.push('reservas online');
  else if (has('whatsapp')) out.push('WhatsApp a mano');
  return out.slice(0, 3);
}

const BENEFIT: Record<Topic, (p: RubroProfile) => string> = {
  contacto: (p) => `Un canal directo para que quien quiere ${p.vocab.necesidad} lo resuelva en el momento, sin buscar.`,
  agenda: (p) => `Que puedan ${p.vocab.bookingVerb ?? 'reservar'} solos, a cualquier hora, sin esperar respuesta.`,
  catalogo: () => 'Un lugar simple donde ver productos y precios, y pedir directo por WhatsApp.',
  reputacion: () => 'Que la reputación juegue a favor justo cuando los están comparando.',
  maps: () => 'Una ficha de Google que convenza al que los está comparando con otras opciones.',
  web: () => 'Un lugar propio con lo necesario para decidir y contactarlos.',
  instagram: () => 'Que Instagram lleve directo a una consulta, sin pasos de más.',
};

const CONVERSION_TOPICS: Topic[] = ['contacto', 'agenda', 'catalogo'];

// ------------------------------------------------------------------ control de calidad

const JARGON = /\b(cta|seo|https?|metadat\w*|responsive|linktree|url|algoritmo|link)\b/i;
const MONEY_CLAIM = /\$\s?\d|\d+\s?%|\b\d+\s+(clientes|ventas|pesos|consultas|turnos|pedidos)\b/i;

/** ¿Este mensaje podría mandarse sin parecer un robot ni prometer de más? */
export function reviewMessage(raw: string, kind: 'completo' | 'medio' | 'corto' | 'instagram', ctx: { name: string; rubro: RubroProfile; honest?: boolean }): QualityCheck[] {
  const words = wordCount(raw);
  // Los enlaces (la web o el Instagram del vendedor) no cuentan como tecnicismos.
  const text = raw.replace(/https?:\/\/\S+/g, 'enlace');
  const max = { completo: 150, medio: 100, corto: 70, instagram: 50 }[kind];
  const min = { completo: 60, medio: 35, corto: 20, instagram: 15 }[kind];
  const b = ctx.rubro.booking;
  return [
    { label: 'Escrito para este negocio (lo nombra)', ok: text.includes(ctx.name) },
    { label: 'Sin tecnicismos', ok: !JARGON.test(text) },
    { label: 'Sin frases de spam ni de agencia', ok: !BANNED_PHRASES.some((p) => text.toLowerCase().includes(p)) && !/!!|\b[A-ZÁÉÍÓÚÑ]{5,}\b/.test(text.replace(ctx.name, '')) },
    { label: 'Sin cifras ni pérdidas inventadas', ok: !MONEY_CLAIM.test(text) },
    { label: `Vocabulario del rubro (${b === 'turnos' ? 'turnos' : b === 'reservas' ? 'reservas' : 'sin turnos ni reservas'})`, ok: b === 'reservas' ? true : b === 'turnos' ? !/\breserv/i.test(text) : !/\b(turnos?|reserv\w*)\b/i.test(text) },
    { label: 'Consecuencia comercial prudente ("puede", "podría")', ok: ctx.honest || kind === 'instagram' || /\b(puede|pueden|podría|podrían)\b/i.test(text) },
    { label: `Largo adecuado (${min}–${max} palabras)`, ok: words >= min && words <= max },
    { label: 'Termina con un pedido simple', ok: /[?]$|un minuto[^.]*\.$|te muestro[^.]*\.$|sin vueltas\.$/.test(text.trim()) },
  ];
}
const passes = (checks: QualityCheck[]) => checks.every((c) => c.ok);

// ------------------------------------------------------------------ armado

interface Built {
  messages: ProspectMessages;
  selected: Opportunity[];
  style: MessageStyle;
  lead?: Opportunity;
  checks: QualityCheck[];
}

/** Temas que cuentan la misma historia (conseguir el contacto): no se juntan en un mismo mensaje. */
const FAMILY: Record<Topic, string> = { contacto: 'conv', agenda: 'conv', catalogo: 'conv', reputacion: 'rep', maps: 'maps', web: 'web', instagram: 'ig' };
/** Segunda oportunidad para el estilo directo: de otra familia, para no repetir la misma idea. */
function secondFor(opps: Opportunity[], lead: Opportunity | undefined): Opportunity | undefined {
  return lead ? opps.find((o) => o !== lead && FAMILY[o.topic] !== FAMILY[lead.topic]) : undefined;
}

/** Estilos posibles para ESTE prospecto, del más adecuado al menos. */
function stylesFor(report: OpportunityReport): MessageStyle[] {
  const [lead, second] = report.opportunities;
  if (!lead) return ['observacion'];
  const rep = report.strengths.some((s) => s.id === 'reputacion');
  const visible = rep || report.strengths.some((s) => s.id === 'visibilidad');
  const conv = CONVERSION_TOPICS.includes(lead.topic);
  const order: MessageStyle[] = [];
  if (visible && conv) order.push('observacion', rep ? 'reputacion' : 'conversion', 'conversion');
  if (secondFor(report.opportunities, lead) && (second?.score ?? 0) >= 6) order.push('directo');
  if (['agenda', 'catalogo', 'web', 'instagram'].includes(lead.topic)) order.push('competencia');
  order.push('oportunidad', 'observacion');
  if (rep) order.push('reputacion');
  return [...new Set(order)];
}

function buildOnce(i: MessageInput, seller: Seller, report: OpportunityReport, style: MessageStyle, leadIdx: number, seed: string): Built {
  const p = i.rubro ?? GENERAL_RUBRO;
  const me = seller.sellerName?.trim() || '[tu nombre]';
  const business = seller.sellerBusiness?.trim();
  const city = seller.sellerCity?.trim();
  const quien = business ? `, ${business}${city ? ` acá en ${city}` : ''}` : city ? `, de ${city}` : '';
  const customIntro = seller.sellerIntro?.trim().replace(/([^.!?])$/, '$1.');
  const link = sellerLinkUrl(seller.sellerLink);
  const saludo = pick(['Hola, ¿cómo están?', 'Hola, ¿cómo va?', 'Buenas, ¿cómo andan?', 'Buen día, ¿cómo están?'], seed, 's');
  const presentacion = `Soy ${me}${quien}.${customIntro ? ` ${customIntro}` : ''}`;
  const name = i.name;

  const opps = report.opportunities;
  const lead = opps[leadIdx % Math.max(1, opps.length)];
  const rest = opps.filter((o) => o !== lead);
  const strength: Strength | undefined = report.strengths.find((s) => s.id === 'reputacion' || s.id === 'visibilidad' || s.id === 'puntuacion') ?? report.strengths[0];

  const ctas = [
    'Si querés, te mando un video de un minuto y te muestro exactamente qué encontré.',
    '¿Te mando un video corto mostrándote lo que vi?',
    '¿Querés que te lo muestre en un audio de un minuto?',
    'Si te interesa, te lo muestro en un video de un minuto, sin vueltas.',
  ];
  const cta = pick(ctas, seed, `z${style}`);

  if (!lead) {
    // Sin oportunidades confirmadas: no se inventa nada.
    const hook = strength ? ` ${strength.text}` : '';
    const primerContacto = [saludo, presentacion, `Estuve viendo ${name} y la verdad lo tienen bien armado.${hook}`, `No te voy a inventar problemas: si en algún momento quieren sumar algo para que más gente que los encuentra termine contactándolos, avisame.${link ? ` Lo que hago: ${link}` : ''}`, '¿Te puedo dejar mi contacto para más adelante?'].join('\n\n');
    const messages: ProspectMessages = {
      primerContacto,
      primerContactoMedio: [saludo, `${presentacion} Estuve viendo ${name} y lo tienen bien armado, así que no te voy a inventar problemas.`, '¿Te puedo dejar mi contacto para más adelante?'].join('\n\n'),
      primerContactoCorto: `${saludo} ${presentacion} Estuve viendo ${name} y lo tienen bien armado. ¿Te puedo dejar mi contacto para más adelante?`,
      instagram: `¡Hola! Soy ${me.split(' ')[0]}, trabajo con la presencia online de negocios de la zona. Vi el perfil de ${name} y está muy bien. ¿Les puedo dejar mi contacto para más adelante?`,
      seguimiento: `${pick(['Hola, ¿cómo va?', 'Buenas, ¿qué tal?'], seed, 'f')} Te había escrito por ${name}. Si en algún momento lo necesitan, avisame; y si no, no pasa nada: no te escribo más.`,
    };
    return { messages, selected: [], style: 'observacion', checks: reviewMessage(messages.primerContacto, 'completo', { name, rubro: p, honest: true }) };
  }

  const obs = (o: Opportunity) => cap(o.observation);
  const visibleHook = strength && (strength.id === 'reputacion' || strength.id === 'visibilidad');
  let opening: string;
  let hook = '';
  let bridge = pick(['El punto que vi es que', 'Lo que me llamó la atención es que', 'Lo que noté es que'], seed, `b${style}`);
  switch (style) {
    case 'reputacion':
      opening = `Vi que ${name} tiene una reputación bastante buena en Google.`;
      hook = 'Se nota que hay gente que los elige y confía en el trabajo que hacen.';
      bridge = 'Justamente por eso me llamó la atención que';
      break;
    case 'conversion':
      opening = `${name} aparece bien en Google, pero encontré un punto donde podrían estar perdiendo consultas.`;
      hook = visibleHook ? strength!.text : '';
      bridge = 'El punto es que';
      break;
    case 'competencia':
      opening = `Estuve viendo ${name} y hay algo que hoy muchos ${p.vocab.plural === 'sin rubro' ? 'negocios del rubro' : p.vocab.plural} ya están aprovechando y que todavía no vi en ustedes.`;
      hook = strength && !visibleHook ? strength.text : '';
      bridge = 'Puntualmente,';
      break;
    case 'directo':
      opening = `Te escribo porque revisé ${name} y encontré dos cosas concretas que podrían mejorar.`;
      bridge = 'La primera es que';
      break;
    case 'oportunidad':
      opening = `Estuve viendo ${name} y encontré una oportunidad bastante clara.`;
      hook = strength?.text ?? '';
      break;
    default:
      opening = `Estuve viendo ${name} y me llamó la atención algo.`;
      hook = strength?.text ?? '';
  }
  const main = `${bridge} ${lowerFirst(lead.observation)}. ${lead.consequence}`;
  const second = secondFor(opps, lead);
  let more = '';
  if (style === 'directo' && second) more = `La segunda es que ${lowerFirst(second.observation)}. ${second.consequence}`;
  else if (style === 'directo') opening = `Te escribo porque revisé ${name} y encontré algo concreto que podría mejorar.`;
  else if (rest.length >= 2) more = visibleHook ? 'Además vi un par de oportunidades más para aprovechar mejor la cantidad de gente que ya los encuentra.' : 'Además vi un par de cosas más que podrían ayudar a que más gente termine contactándolos.';
  else if (rest.length === 1) more = visibleHook ? 'Y vi otra oportunidad para aprovechar mejor a la gente que ya los encuentra.' : 'Y vi otra cosa más que podría ayudar a que más gente termine contactándolos.';
  const linkLine = link ? `Si querés ver lo que hago: ${link}` : '';

  const assemble = (parts: string[]) => parts.filter(Boolean).join('\n\n');
  let primerContacto = assemble([saludo, presentacion, opening, hook, main, more, linkLine, cta]);
  if (wordCount(primerContacto) > 150) primerContacto = assemble([saludo, presentacion, opening, hook, main, linkLine, cta]);
  if (wordCount(primerContacto) > 150) primerContacto = assemble([saludo, presentacion, opening, main, cta]);
  const primerContactoMedio = assemble([`${saludo} ${presentacion}`, `${opening} ${cap(lowerFirst(lead.observation))}. ${lead.consequence}`, cta]);
  const primerContactoCorto = `${saludo} Soy ${me}${quien}. Estuve viendo ${name} y vi que ${lowerFirst(lead.short)}. ${lead.consequence} ${pick(['¿Te mando un video de un minuto con lo que encontré?', '¿Querés que te lo muestre en un audio corto?'], seed, 'q')}`;
  const instagram = `¡Hola! Soy ${me.split(' ')[0]}, trabajo con la presencia online de negocios de la zona. Vi el perfil de ${name} y noté que ${lowerFirst(lead.short)}. ${pick(['¿Les mando un video de un minuto con lo que encontré?', '¿Les puedo mostrar en un video corto lo que vi?'], seed, 'i')}`;
  const seguimiento = assemble([
    `${pick(['Hola, ¿cómo va?', 'Buenas, ¿qué tal?', 'Hola de nuevo, ¿cómo andan?'], seed, 'f')} Te había escrito por ${name}. Lo resumo en una línea: ${lowerFirst(lead.short)}. ${lead.consequence}`,
    'Si te interesa, te mando el video cuando quieras; y si no es el momento, no pasa nada: avisame y no te escribo más.',
  ]);

  const messages: ProspectMessages = { primerContacto, primerContactoMedio, primerContactoCorto, instagram, seguimiento };
  const checks = [
    ...reviewMessage(primerContacto, 'completo', { name, rubro: p }),
    ...reviewMessage(primerContactoMedio, 'medio', { name, rubro: p }).map((c) => ({ ...c, label: `Mediano: ${c.label}` })),
    ...reviewMessage(primerContactoCorto, 'corto', { name, rubro: p }).map((c) => ({ ...c, label: `Corto: ${c.label}` })),
    ...reviewMessage(instagram, 'instagram', { name, rubro: p }).map((c) => ({ ...c, label: `Instagram: ${c.label}` })),
  ];
  const selected = [lead, ...(style === 'directo' && second ? [second] : rest.slice(0, 2))];
  return { messages, selected, style, lead, checks };
}

/** Rubro del input: el que trae, o el detectado con la categoría y el nombre (si hay confianza suficiente). */
function rubroOf(i: MessageInput): RubroProfile {
  if (i.rubro) return i.rubro;
  const d = DEFAULT_CATALOG.detect({ category: i.profile?.category, additionalCategories: i.profile?.additionalCategories, name: i.name });
  return d && d.confidence !== 'baja' ? DEFAULT_CATALOG.profileFor(d.key) : GENERAL_RUBRO;
}

/** Hallazgos para el motor: los de la auditoría, o reconstruidos desde los argumentos guardados. */
function findingsOf(i: MessageInput): Finding[] {
  if (i.findings) return i.findings;
  const sev = { Alto: 'high', 'Medio-Alto': 'high', Medio: 'medium', Bajo: 'low' } as const;
  return i.problems
    .filter((s) => !s.serviceIds || s.serviceIds.length > 0)
    .map((s) => ({ id: s.findingId, area: s.area, severity: sev[s.impact] ?? 'medium', title: s.problem, detail: s.reason, evidence: s.evidence, source: 'argumento', level: s.level ?? 'confirmado' }));
}

export function reportFor(i: MessageInput): OpportunityReport {
  const pseudo = {
    profile: { ...(i.profile ?? {}), name: i.name },
    channels: i.channels,
    website: i.website,
    audit: { findings: findingsOf(i), metrics: i.metrics },
  } as unknown as AnalysisResult;
  return analyzeOpportunities(pseudo, rubroOf(i));
}

function compose(i: MessageInput, seller: Seller, variant: number): Built {
  const v = Math.max(0, Math.floor(variant) || 0);
  const rubro = rubroOf(i);
  const input = { ...i, rubro };
  const report = reportFor(input);
  const styles = stylesFor(report);
  const n = Math.max(1, Math.min(report.opportunities.length, 3));
  // Combinaciones (estilo × oportunidad principal) en orden de adecuación; "Otra versión" avanza.
  const combos: Array<[MessageStyle, number]> = [];
  for (let lead = 0; lead < n; lead++) for (const s of styles) combos.push([s, lead]);
  let best: Built | undefined;
  // Control de calidad: si una combinación no pasa, se prueba la siguiente (se rearma el mensaje).
  for (let k = 0; k < combos.length; k++) {
    const [style, lead] = combos[(v + k) % combos.length]!;
    const built = buildOnce(input, seller, report, style, lead, `${i.seed}#${v}`);
    if (passes(built.checks)) return built;
    if (!best || built.checks.filter((c) => c.ok).length > best.checks.filter((c) => c.ok).length) best = built;
  }
  return best!;
}

/**
 * Mensajes a partir de las oportunidades CONFIRMADAS de ESTE negocio.
 * `variant` = 0 es el mejor para el caso; cada número mayor arma otro (botón "Otra versión").
 */
export function composeMessages(i: MessageInput, seller: Seller, variant = 0): ProspectMessages {
  return compose(i, seller, variant).messages;
}

/** Qué oportunidades usa el mensaje (para mostrarlo en el perfil). */
export function composeSelection(i: MessageInput, seller: Seller, variant = 0): MessageSelection {
  return compose(i, seller, variant).selected.map((o, idx) => ({ findingId: o.id, priority: idx + 1, text: o.title }));
}

/** Motivo comercial, consecuencia, beneficio, estilo y control de calidad del mensaje. */
export function composeInsight(i: MessageInput, seller: Seller, variant = 0): MessageInsight {
  const b = compose(i, seller, variant);
  const rubro = rubroOf(i);
  if (!b.lead) {
    return { motivo: 'Sin oportunidades confirmadas', oportunidad: 'No se detectaron oportunidades confirmadas: el mensaje no inventa ninguna.', dolor: '—', beneficio: 'Dejar el contacto para más adelante.', rubro: rubro.label, estilo: STYLE_LABEL[b.style], fuente: '—', evidencia: '—', calidad: b.checks };
  }
  return {
    motivo: `${b.lead.area}: ${b.lead.title}`,
    oportunidad: `${cap(b.lead.observation)}.`,
    dolor: b.lead.consequence,
    beneficio: BENEFIT[b.lead.topic](rubro),
    rubro: rubro.label,
    estilo: STYLE_LABEL[b.style],
    fuente: b.lead.source,
    evidencia: b.lead.evidence,
    calidad: b.checks,
  };
}

export const MESSAGE_KEYS = ['primerContacto', 'primerContactoMedio', 'primerContactoCorto', 'instagram', 'seguimiento'] as const;
export type MessageKey = (typeof MESSAGE_KEYS)[number];

type StoredProspect = {
  id: string; name: string; verticalId: string | null; verticalLabel: string | null; problems: SalesArgument[]; services: ServiceRecommendation[];
  analysis?: { profile?: BusinessProfile; website?: WebsiteAnalysis; audit?: AuditResult; channels?: ChannelReport };
  /** Perfil del rubro asignado al prospecto. */
  rubroProfile?: RubroProfile;
};
const inputOf = (p: StoredProspect): MessageInput => ({
  seed: p.id,
  name: p.name,
  verticalId: p.verticalId ?? 'general',
  verticalLabel: p.verticalLabel ?? 'su rubro',
  problems: p.problems,
  services: p.services,
  profile: p.analysis?.profile,
  website: p.analysis?.website,
  metrics: p.analysis?.audit?.metrics,
  channels: p.analysis?.channels,
  findings: p.analysis?.audit?.findings,
  rubro: p.rubroProfile,
});

/** Oportunidades que usa el primer contacto de un prospecto guardado. */
export function buildSelection(p: StoredProspect, seller: Seller, variant = 0): MessageSelection {
  return composeSelection(inputOf(p), seller, variant);
}

/** Motivo comercial, consecuencia y beneficio del primer contacto de un prospecto guardado. */
export function buildInsight(p: StoredProspect, seller: Seller, variant = 0): MessageInsight {
  return composeInsight(inputOf(p), seller, variant);
}

/** Mensajes para un prospecto guardado en el CRM. */
export function buildMessages(p: StoredProspect, seller: Seller, variant = 0): ProspectMessages {
  return composeMessages(inputOf(p), seller, variant);
}
