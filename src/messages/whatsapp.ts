import type { ChannelReport } from '../channels/crossCheck.js';
import type { AuditResult, BusinessProfile, SalesArgument, ServiceRecommendation, WebsiteAnalysis } from '../domain/types.js';
import { selectPitches, type ServiceTopic } from './pitch.js';

/**
 * Mensajes de WhatsApp para prospección, en tono argentino, cercano y directo.
 *
 * Reglas de estilo:
 *  - Solo problemas CONFIRMADOS en todos los canales (Maps, web, Instagram): nunca se recomienda
 *    algo que el negocio ya tiene ni se afirma algo que no se pudo comprobar.
 *  - Máximo 3 problemas, por prioridad comercial; mejor uno real que tres débiles.
 *  - Cada problema se explica con su consecuencia para el negocio, no como dato técnico.
 *  - Escrito como una persona: sin frases de agencia ni promesas. Entre ~120 y 220 palabras.
 *  - Cierre con un pedido chico: permiso para mandar un audio corto.
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
  primerContacto: string;
  primerContactoCorto: string;
  seguimiento: string;
}

/** Problemas CONFIRMADOS que usa el primer contacto (por prioridad comercial, máx. 3). */
export type MessageSelection = Array<{ findingId: string; priority: number; text: string }>;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pick = <T>(arr: readonly T[], seed: string, salt: string): T => arr[hash(seed + salt) % arr.length]!;

const TOPIC_PHRASE: Record<ServiceTopic, string> = {
  'Google Maps': 'fichas de Google Maps',
  reseñas: 'la gestión de reseñas',
  'páginas web': 'páginas web',
  'reservas online': 'sistemas de reservas online',
  WhatsApp: 'WhatsApp para negocios',
  automatizaciones: 'automatizaciones',
  'menú online': 'menús online',
};
const join = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : (items[0] ?? ''));
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
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
 * Arma los tres mensajes a partir de los problemas CONFIRMADOS de ESTE negocio.
 * Estructura del primer contacto: saludo · presentación · contexto · problema real y consecuencia ·
 * segundo problema (solo si existe) · solución con los servicios relacionados · pedido de permiso para un audio.
 * `variant` = 0 es la versión de siempre; cada número mayor arma otra (botón "Otra versión").
 */
export function composeMessages(i: MessageInput, seller: Seller, variant = 0): ProspectMessages {
  return compose(i, seller, variant).messages;
}

/** Qué problemas usa el mensaje (para mostrarlo en el perfil). */
export function composeSelection(i: MessageInput, seller: Seller, variant = 0): MessageSelection {
  return compose(i, seller, variant).selected;
}

function compose(i: MessageInput, seller: Seller, variant: number): { messages: ProspectMessages; selected: MessageSelection } {
  const v = Math.max(0, Math.floor(variant) || 0);
  const seed = v ? `${i.seed}#${v}` : i.seed;
  const me = seller.sellerName?.trim() || '[tu nombre]';
  const business = seller.sellerBusiness?.trim();
  const link = sellerLinkUrl(seller.sellerLink);
  const customIntro = seller.sellerIntro?.trim().replace(/([^.!?])$/, '$1.');

  // Solo problemas confirmados y con un servicio que se ofrece (los quitados del catálogo no se venden).
  const usable = i.problems.filter((p) => !p.serviceIds || p.serviceIds.length > 0);
  let selected = selectPitches({ ...i, problems: usable }, 3);
  // Otras versiones: rota cuál de los problemas elegidos abre el mensaje.
  if (v && selected.length > 1) {
    const shift = v % selected.length;
    selected = [...selected.slice(shift), ...selected.slice(0, shift)];
  }

  const saludo = pick(['Buenas, ¿cómo andan?', 'Hola, ¿cómo va?', 'Hola, ¿qué tal?', 'Buen día, ¿cómo están?'], seed, 's');
  const city = seller.sellerCity?.trim();
  const quien = business ? `, ${business}${city ? ` acá en ${city}` : ''}` : city ? `, de ${city}` : '';
  const presentacion = `Soy ${me}${quien}.${customIntro ? ` ${customIntro}` : ''}`;
  const cuantas = selected.length === 1 ? 'una cosa puntual que me llamó la atención' : 'un par de cosas que me llamaron la atención';
  // Lo que el negocio YA tiene (verificado): se reconoce para no sonar genérico ni ofrecer lo que ya hay.
  const ya = strengths(i.channels);
  const contexto = ya.length
    ? pick([`Estuve revisando ${i.name}. Vi que ya tienen ${join(ya)}, que está muy bien, pero encontré ${cuantas}.`, `Estuve mirando cómo aparece ${i.name} en internet. Ya tienen ${join(ya)}, eso suma, pero encontré ${cuantas}.`], seed, 'c')
    : pick([`Estuve revisando ${i.name} y encontré ${cuantas}.`, `Estuve mirando cómo aparece ${i.name} en internet y encontré ${cuantas}.`], seed, 'c');
  const conectores = ['Además, ', 'Otra cosa que vi: ', 'Por otro lado, '];
  const cierre = pick(
    [
      'Si te parece, te puedo mandar un audio corto contándote exactamente lo que vi y qué haría en su lugar.',
      'Si te sirve, te mando un audio corto mostrándote exactamente lo que vi y qué haría para mejorarlo.',
      '¿Te parece si te mando un audio corto con lo que vi y cómo lo resolvería?',
    ],
    seed, 'z',
  );
  const linkLine = link ? ` Si querés ver lo que hago: ${link}` : '';

  let primerContacto: string;
  if (!selected.length) {
    // Sin problemas confirmados: no se inventa nada.
    primerContacto = [
      saludo,
      presentacion,
      `Estuve revisando ${i.name} y la verdad es que su presencia en Google está bastante bien armada, así que no te voy a inventar problemas.`,
      `Trabajo con fichas de Google Maps, reseñas, páginas web y WhatsApp para negocios, por si en algún momento quieren sumar algo de eso.${linkLine}`,
      '¿Te puedo dejar mi contacto por si más adelante lo necesitan?',
    ].join('\n\n');
  } else {
    const topics = [...new Set(selected.map((p) => p.topic))];
    const solucion = [
      selected.length === 1 ? 'Tiene solución y no hace falta cambiar lo que ya tienen armado.' : selected.length === 2 ? 'Ambas cosas tienen solución y no hace falta cambiar todo lo que ya tienen armado.' : 'Todo esto tiene solución y no hace falta cambiar lo que ya tienen armado.',
      `Justamente trabajo con ${join(topics.map((t) => TOPIC_PHRASE[t]))}.${linkLine}`,
    ].join(' ');
    // Conectores distintos entre sí y sin repetir palabras ("Otra cosa que vi: vi…").
    const start = conectores.indexOf(pick(conectores, seed, 'k'));
    const usable = (text: string) => conectores.filter((c) => !(/vi:/.test(c) && /^vi\b/i.test(text)));
    const used = new Set<string>();
    const body = selected.map((p, idx) => {
      if (idx === 0) return p.text;
      const options = usable(p.text);
      const c = [...options.slice(start % options.length), ...options.slice(0, start % options.length)].find((x) => !used.has(x)) ?? options[0]!;
      used.add(c);
      return `${c}${lowerFirst(p.text)}`;
    });
    const build = (parts: string[]) => [saludo, presentacion, contexto, ...parts, solucion, cierre].join('\n\n');
    // Hasta 2 problemas siempre; el tercero solo si el mensaje no se hace largo (máx. ~220 palabras).
    let parts = body.slice(0, 2);
    if (body[2] && wordCount(build([...parts, body[2]])) <= 220) parts = body.slice(0, 3);
    // Con un solo problema, si quedó corto, se suma el detalle de esa consecuencia.
    if (parts.length === 1 && selected[0]!.extra && wordCount(build(parts)) < 120) parts = [`${parts[0]} ${selected[0]!.extra}`];
    primerContacto = build(parts);
    selected = selected.slice(0, parts.length);
  }

  const first = selected[0];
  const primerContactoCorto = first
    ? [
        `${saludo} Soy ${me}${quien}.`,
        `Estuve revisando ${i.name}: ${lowerFirst(first.text.split(/(?<=\.)\s/)[0]!)}`,
        pick(['¿Te mando un audio corto con lo que vi y cómo lo resolvería?', '¿Te cuento en un audio corto qué haría?'], seed, 'q'),
      ].join('\n\n')
    : [`${saludo} Soy ${me}${quien}.`, `Estuve revisando ${i.name} y está bien armado en Google. Trabajo con presencia online para negocios, por si en algún momento lo necesitan.`].join('\n\n');

  const dato = selected[1] ?? selected[0];
  const seguimiento = [
    pick(['Hola, ¿cómo va?', 'Buenas, ¿qué tal?', 'Hola de nuevo, ¿cómo andan?'], seed, 'f'),
    dato
      ? `Te había escrito por ${i.name}. Te dejo un dato concreto de lo que vi: ${lowerFirst(dato.text.split(/(?<=\.)\s/)[0]!)}`
      : `Te había escrito por ${i.name} hace unos días.`,
    'Si te interesa, te mando el audio cuando quieras; y si no es el momento, no pasa nada: avisame y no te escribo más.',
  ].join('\n\n');

  return {
    messages: { primerContacto, primerContactoCorto, seguimiento },
    selected: selected.map((p) => ({ findingId: p.findingId, priority: p.priority, text: p.text })),
  };
}

export const MESSAGE_KEYS = ['primerContacto', 'primerContactoCorto', 'seguimiento'] as const;
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
