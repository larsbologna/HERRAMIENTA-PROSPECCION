import type { ChannelReport } from '../channels/crossCheck.js';
import type { AuditResult, BusinessProfile, SalesArgument, ServiceRecommendation, WebsiteAnalysis } from '../domain/types.js';
import { selectPitches } from './pitch.js';
import { ANGLES, CATEGORY_LABEL, GROUP_LABEL, HIDDEN_COST, painFor, rubroGroup, type SalesCategory } from './sales.js';

/**
 * MENSAJES DE WHATSAPP ORIENTADOS A VENTAS (primer contacto con negocios locales).
 *
 * Objetivo: que el dueño RESPONDA, no venderle el servicio en el primer mensaje.
 * Estructura: saludo · presentación breve · "estuve viendo el negocio" · UNA oportunidad concreta
 * (lo que vive el cliente y qué hace) · pérdida económica en el lenguaje del rubro · beneficio ·
 * pregunta simple de bajo compromiso.
 *
 *  - Nunca solo el problema: siempre consecuencia, cómo afecta ventas y clientes, y qué se gana.
 *  - Solo oportunidades CONFIRMADAS en todos los canales; nunca se ofrece lo que el negocio ya tiene.
 *  - Humano, argentino, profesional y respetuoso: sin frases de agencia ni tono de vendedor.
 *  - Completo: 80–150 palabras en 2 párrafos · Mediano: más directo · Corto: 1 párrafo.
 */

export interface MessageInput {
  /** Semilla estable para elegir variantes (id o nombre del prospecto). */
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
  /** Completo: 80–150 palabras, 2 párrafos. */
  primerContacto: string;
  /** Mediano: la oportunidad principal, directo al punto. */
  primerContactoMedio: string;
  /** Corto: un párrafo. */
  primerContactoCorto: string;
  seguimiento: string;
}

/** Oportunidades CONFIRMADAS que usa el primer contacto (la principal primero). */
export type MessageSelection = Array<{ findingId: string; priority: number; text: string }>;

/** Por qué el mensaje dice lo que dice (se muestra al vendedor, no se envía). */
export interface MessageInsight {
  /** Motivo comercial utilizado ("Reservas fuera de horario"). */
  motivo: string;
  /** La oportunidad detectada, en una frase. */
  oportunidad: string;
  /** Dolor económico detectado, en el lenguaje del rubro. */
  dolor: string;
  /** Beneficio principal comunicado. */
  beneficio: string;
  /** Rubro con el que se adaptó el mensaje. */
  rubro: string;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pick = <T>(arr: readonly T[], seed: string, salt: string): T => arr[hash(seed + salt) % arr.length]!;

const join = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : (items[0] ?? ''));
export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Canales que el negocio YA tiene, confirmados en la verificación cruzada (máx. 3, para el mensaje). */
export function strengths(ch: ChannelReport | undefined): string[] {
  if (!ch) return [];
  const found = (id: string) => ch.channels.find((c) => c.id === id && c.status === 'encontrado');
  const out: string[] = [];
  if (found('instagram')) out.push('Instagram');
  const web = found('web');
  if (web && !/no carga/i.test(web.detail ?? '')) out.push('página web');
  const res = found('reservas');
  if (res?.url) out.push('reservas online');
  else if (found('whatsapp')) out.push('WhatsApp a mano');
  return out.slice(0, 3);
}

/**
 * Arma los mensajes a partir de las oportunidades CONFIRMADAS de ESTE negocio.
 * `variant` = 0 es la versión de siempre; cada número mayor arma otra (botón "Otra versión"):
 * cambia el saludo, las frases, la pregunta final y cuál oportunidad abre el mensaje.
 */
export function composeMessages(i: MessageInput, seller: Seller, variant = 0): ProspectMessages {
  return compose(i, seller, variant).messages;
}

/** Qué oportunidades usa el mensaje (para mostrarlo en el perfil). */
export function composeSelection(i: MessageInput, seller: Seller, variant = 0): MessageSelection {
  return compose(i, seller, variant).selected;
}

/** Motivo comercial, dolor económico y beneficio que comunica el mensaje. */
export function composeInsight(i: MessageInput, seller: Seller, variant = 0): MessageInsight {
  return compose(i, seller, variant).insight;
}

const CTAS = [
  '¿Te puedo mandar un audio de un minuto mostrándote lo que vi?',
  '¿Querés que te muestre dónde detecté esta oportunidad?',
  '¿Te interesa que te explique cómo lo resolvería?',
];
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Angle { findingId: string; priority: number; cat: SalesCategory; situation: string; short: string }

function compose(i: MessageInput, seller: Seller, variant: number): { messages: ProspectMessages; selected: MessageSelection; insight: MessageInsight } {
  const v = Math.max(0, Math.floor(variant) || 0);
  const seed = v ? `${i.seed}#${v}` : i.seed;
  const me = seller.sellerName?.trim() || '[tu nombre]';
  const business = seller.sellerBusiness?.trim();
  const link = sellerLinkUrl(seller.sellerLink);
  const customIntro = seller.sellerIntro?.trim().replace(/([^.!?])$/, '$1.');
  const group = rubroGroup(i);

  // Oportunidades confirmadas, por prioridad comercial, que tengan un ángulo de venta y un servicio que se ofrece.
  const usable = i.problems.filter((p) => !p.serviceIds || p.serviceIds.length > 0);
  let angles: Angle[] = selectPitches({ ...i, problems: usable }, 3)
    .map((p) => {
      const a = ANGLES[p.findingId];
      const situation = a?.situation(i);
      const short = a?.short(i);
      return a && situation && short ? { findingId: p.findingId, priority: p.priority, cat: a.cat, situation, short } : undefined;
    })
    .filter((x): x is Angle => !!x);
  // Otras versiones: rota cuál oportunidad abre el mensaje.
  if (v && angles.length > 1) {
    const shift = v % angles.length;
    angles = [...angles.slice(shift), ...angles.slice(0, shift)];
  }

  const saludo = pick(['Hola, ¿cómo va?', 'Buenas, ¿cómo andan?', 'Hola, ¿qué tal?', 'Buen día, ¿cómo están?'], seed, 's');
  const city = seller.sellerCity?.trim();
  const quien = business ? `, ${business}${city ? ` acá en ${city}` : ''}` : city ? `, de ${city}` : '';
  const presentacion = `Soy ${me}${quien}.${customIntro ? ` ${customIntro}` : ''}`;
  const cta = pick(CTAS, seed, 'z');
  const linkLine = link ? ` Si querés ver lo que hago: ${link}.` : '';

  if (!angles.length) {
    // Sin oportunidades confirmadas: no se inventa ningún problema.
    const honest = `Estuve viendo ${i.name} y la verdad lo tienen bien armado en Google, así que no te voy a inventar nada.`;
    const offer = `Trabajo con negocios de la zona para que más gente que los encuentra termine escribiendo o reservando, por si en algún momento les sirve.${linkLine}`;
    const ask = '¿Te puedo dejar mi contacto para más adelante?';
    const primerContacto = [`${saludo} ${presentacion} ${honest}`, `${offer} ${ask}`].join('\n\n');
    return {
      messages: {
        primerContacto,
        primerContactoMedio: primerContacto,
        primerContactoCorto: `${saludo} Soy ${me}${quien}. ${honest} ${ask}`,
        seguimiento: `${pick(['Hola, ¿cómo va?', 'Buenas, ¿qué tal?'], seed, 'f')} Te había escrito por ${i.name}. Si en algún momento quieren sumar algo en Google o WhatsApp, avisame; y si no, no pasa nada: no te escribo más.`,
      },
      selected: [],
      insight: { motivo: 'Sin oportunidades confirmadas', oportunidad: 'No se detectaron oportunidades confirmadas: el mensaje no inventa ninguna.', dolor: '—', beneficio: 'Dejar el contacto para más adelante.', rubro: GROUP_LABEL[group] },
    };
  }

  const lead = angles[0]!;
  const pain = painFor(group, lead.cat, lead.findingId);
  const dolor = pick(pain.dolor, seed, 'd');
  const beneficio = pick(pain.beneficio, seed, 'b');
  const ya = strengths(i.channels);
  const revision = ya.length
    ? pick([`Estuve viendo ${i.name}: ya tienen ${join(ya)}, que suma un montón, pero me llamó la atención una cosa concreta.`, `Estuve mirando ${i.name}. Ya tienen ${join(ya)}, que está muy bien, aunque encontré una oportunidad concreta.`], seed, 'c')
    : pick([`Estuve viendo ${i.name} y me llamó la atención una cosa concreta.`, `Estuve mirando cómo aparece ${i.name} en internet y encontré una oportunidad concreta.`], seed, 'c');

  // ---- Completo: 2 párrafos, 80–150 palabras. Suma una segunda oportunidad solo si entra.
  const p1 = `${saludo} ${presentacion} ${revision} ${lead.situation}`;
  const second = angles.find((a) => a.cat !== lead.cat);
  const extra = second ? ` ${pick(['Y no es lo único: también vi que', 'Además, vi que'], seed, 'x')} ${second.short}.` : '';
  let hidden = '';
  const build = (withExtra: boolean, withLink: boolean) => [p1, `${dolor}${hidden}${withExtra ? extra : ''} ${beneficio}${withLink ? linkLine : ''} ${cta}`].join('\n\n');
  // Si queda corto (menos de 80 palabras), se suma lo que no se ve de esa pérdida o el esfuerzo extra que genera.
  if (wordCount(build(!!extra, true)) < 80) hidden = ` ${HIDDEN_COST[lead.cat]}`;
  let primerContacto = build(!!extra, true);
  let usedSecond = !!extra;
  if (wordCount(primerContacto) > 150) { primerContacto = build(false, true); usedSecond = false; }
  if (wordCount(primerContacto) > 150) primerContacto = build(false, false);

  // ---- Mediano: la oportunidad principal, directo (2 párrafos cortos).
  const primerContactoMedio = [
    `${saludo} Soy ${me}${quien}. Estuve viendo ${i.name} y vi que ${lead.short}.`,
    `${dolor} ${pain.beneficioShort}. ${cta}`,
  ].join('\n\n');

  // ---- Corto: un párrafo.
  const primerContactoCorto = `${saludo} Soy ${me}${quien}. Estuve viendo ${i.name} y vi que ${lead.short}: ${pain.dolorShort}. Tiene una solución simple. ${cta}`;

  // ---- Seguimiento: recordatorio breve con el mismo eje, sin presión.
  const seguimiento = [
    `${pick(['Hola, ¿cómo va?', 'Buenas, ¿qué tal?', 'Hola de nuevo, ¿cómo andan?'], seed, 'f')} Te había escrito por ${i.name}. Lo resumo en una línea: ${lead.short}. ${upperFirst(pain.dolorShort)}.`,
    'Si te interesa, te mando un audio de un minuto con cómo lo resolvería; y si no es el momento, no pasa nada: avisame y no te escribo más.',
  ].join('\n\n');

  const selected = [lead, ...(usedSecond && second ? [second] : [])];
  return {
    messages: { primerContacto, primerContactoMedio, primerContactoCorto, seguimiento },
    selected: selected.map((a) => ({ findingId: a.findingId, priority: a.priority, text: upperFirst(a.short) + '.' })),
    insight: {
      motivo: `${CATEGORY_LABEL[lead.cat]}: ${lead.short}`,
      oportunidad: lead.situation,
      dolor,
      beneficio,
      rubro: GROUP_LABEL[group],
    },
  };
}

export const MESSAGE_KEYS = ['primerContacto', 'primerContactoMedio', 'primerContactoCorto', 'seguimiento'] as const;
export type MessageKey = (typeof MESSAGE_KEYS)[number];

type StoredProspect = { id: string; name: string; verticalId: string | null; verticalLabel: string | null; problems: SalesArgument[]; services: ServiceRecommendation[]; analysis?: { profile?: BusinessProfile; website?: WebsiteAnalysis; audit?: AuditResult; channels?: ChannelReport } };
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
});

/** Problemas que usa el primer contacto de un prospecto guardado. */
export function buildSelection(p: StoredProspect, seller: Seller, variant = 0): MessageSelection {
  return composeSelection(inputOf(p), seller, variant);
}

/** Motivo comercial, dolor económico y beneficio del primer contacto de un prospecto guardado. */
export function buildInsight(p: StoredProspect, seller: Seller, variant = 0): MessageInsight {
  return composeInsight(inputOf(p), seller, variant);
}

/** Mensajes para un prospecto guardado en el CRM. */
export function buildMessages(
  p: { id: string; name: string; verticalId: string | null; verticalLabel: string | null; problems: SalesArgument[]; services: ServiceRecommendation[]; analysis?: { profile?: BusinessProfile; website?: WebsiteAnalysis; audit?: AuditResult; channels?: ChannelReport } },
  seller: Seller,
  variant = 0,
): ProspectMessages {
  return composeMessages(
    {
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
    },
    seller,
    variant,
  );
}
