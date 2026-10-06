import type { ChannelReport } from '../channels/crossCheck.js';
import type { AuditResult, BusinessProfile, SalesArgument, WebsiteAnalysis } from '../domain/types.js';

/**
 * CÓMO SE CUENTA CADA PROBLEMA EN UN MENSAJE.
 *
 * No se tira el dato técnico ("no tiene web"): se explica qué pasa y por qué afecta al negocio,
 * con los datos reales de la ficha. Cada problema tiene una prioridad comercial:
 *   1 pérdida directa de consultas · 2 pérdida de reservas · 3 confianza · 4 Google Maps
 *   5 reseñas · 6 presencia web · 7 contacto · 8 automatización · 9 secundarios
 * Solo se usan argumentos CONFIRMADOS (los probables y no verificados nunca van en el mensaje).
 */

export interface PitchInput {
  name: string;
  verticalId: string;
  verticalLabel: string;
  profile?: Partial<BusinessProfile>;
  website?: WebsiteAnalysis;
  metrics?: AuditResult['metrics'];
  channels?: ChannelReport;
  problems: SalesArgument[];
}

export type ServiceTopic = 'Google Maps' | 'reseñas' | 'páginas web' | 'reservas online' | 'WhatsApp' | 'automatizaciones' | 'menú online';

interface PitchTemplate {
  priority: number;
  topic: ServiceTopic;
  /** Problema + consecuencia, en lenguaje de persona (1–2 oraciones). */
  text: (i: PitchInput) => string | undefined;
  /** Detalle adicional (solo si el mensaje tiene un único problema y queda corto). */
  extra?: (i: PitchInput) => string;
}

const turno = (i: PitchInput) => (i.verticalId === 'gastronomia' ? 'reservar una mesa' : i.verticalId === 'alojamiento' ? 'reservar' : 'sacar un turno');
const igFound = (i: PitchInput) => i.channels?.channels.some((c) => c.id === 'instagram' && c.status === 'encontrado');
const fmtRating = (r: number | undefined) => (r === undefined ? '' : String(r.toFixed(1)).replace('.', ','));
const n = (v: number | undefined) => (v === undefined ? undefined : v.toLocaleString('es-AR'));

export const PITCHES: Record<string, PitchTemplate> = {
  // 1 · Pérdida directa de consultas
  'maps-closed': {
    priority: 1, topic: 'Google Maps',
    text: (i) => `En Google Maps ${i.name} figura como cerrado permanentemente. Si siguen atendiendo, la mayoría de la gente que los busca ve ese cartel y directamente sigue de largo.`,
  },
  'web-down': {
    priority: 1, topic: 'páginas web',
    text: () => 'Entré a la web que figura en Google y no carga. Todo el que toca "Sitio web" desde la ficha se encuentra con un error, justo en el momento en que estaba interesado.',
  },
  'maps-no-phone': {
    priority: 1, topic: 'Google Maps',
    text: () => 'En la ficha de Google no aparece un teléfono. Quien los encuentra desde el celular no tiene un botón para llamar, y muchos no se toman el trabajo de buscar otra forma de contacto.',
  },
  'wa-not-visible': {
    priority: 1, topic: 'WhatsApp',
    text: () => 'Encontré el negocio, pero no hay una forma directa y visible de escribirles por WhatsApp desde Google ni desde sus otros canales. Cada paso de más que tiene que hacer alguien interesado aumenta la chance de que abandone.',
    extra: () => 'Hoy la mayoría prefiere mandar un mensaje rápido antes que llamar, sobre todo para consultas simples.',
  },
  'web-poor-contact': {
    priority: 1, topic: 'páginas web',
    text: () => 'En la web cuesta encontrar cómo contactarlos: no hay un teléfono para tocar ni un WhatsApp a mano. El que llega con ganas de consultar y no lo encuentra rápido, se va.',
  },
  // 2 · Pérdida de reservas
  'booking-none': {
    priority: 2, topic: 'reservas online',
    text: (i) => `Para ${turno(i)} hoy hay que llamar o escribir: no encontré una forma de reservar online ni en Google${igFound(i) ? ' ni en Instagram' : ''}${i.profile?.website ? ' ni en la web' : ''}. Mucha gente decide de noche o fuera de horario, y si no puede reservar en ese momento, lo hace en otro lado.`,
  },
  'web-no-booking': {
    priority: 2, topic: 'reservas online',
    text: (i) => `En la web no hay forma de ${turno(i)} online. El que entra decidido tiene que salir a llamar o escribir, y en ese paso se pierden reservas.`,
  },
  // 3 · Confianza
  'rep-negative-unanswered': {
    priority: 3, topic: 'reseñas',
    text: () => 'Vi algunas reseñas negativas recientes que quedaron sin respuesta. Son justamente las que puede leer una persona que todavía está comparando opciones antes de elegir.',
    extra: () => 'Una respuesta tranquila y profesional muchas veces pesa más que la queja misma.',
  },
  'rep-low-rating': {
    priority: 3, topic: 'reseñas',
    text: (i) => (i.profile?.rating === undefined ? undefined : `Están con ${fmtRating(i.profile.rating)} estrellas en Google. Mucha gente filtra o descarta los lugares que están por debajo de 4 sin llegar a leer las reseñas.`),
  },
  'maps-unclaimed': {
    priority: 3, topic: 'Google Maps',
    text: () => 'La ficha de Google figura como no reclamada. Eso quiere decir que cualquiera puede sugerir cambios en el horario o el teléfono, y ustedes no pueden responder reseñas ni publicar novedades.',
  },
  'web-no-https': {
    priority: 3, topic: 'páginas web',
    text: () => 'La web aparece como "No segura" en el navegador. Es un detalle técnico, pero a mucha gente le genera desconfianza y se va antes de mirar.',
  },
  // 4 · Google Maps
  'web-not-in-maps': {
    priority: 4, topic: 'Google Maps',
    text: () => 'Tienen página web, pero no está vinculada en la ficha de Google. Quien los encuentra en Maps no ve el botón "Sitio web", y es justo la persona que ya los estaba buscando.',
  },
  'maps-no-hours': {
    priority: 4, topic: 'Google Maps',
    text: () => 'En Google no figuran los horarios. Ante la duda, la gente termina eligiendo un lugar que sí dice "Abierto ahora".',
  },
  'maps-incomplete-hours': {
    priority: 4, topic: 'Google Maps',
    text: (i) => {
      const d = Object.keys(i.profile?.hours?.days ?? {}).length;
      return d ? `En Google los horarios están incompletos: figuran ${d} de 7 días. Los días que faltan, quien busca no sabe si están abiertos y suele ir a otro lado.` : undefined;
    },
  },
  'maps-few-photos': {
    priority: 4, topic: 'Google Maps',
    text: (i) => (i.profile?.photoCount === undefined ? undefined : `La ficha de Google tiene ${n(i.profile.photoCount)} fotos. Es lo primero que mira alguien que no los conoce, y con tan pocas cuesta hacerse una idea de cómo es el lugar.`),
  },
  'maps-no-description': {
    priority: 4, topic: 'Google Maps',
    text: () => 'La ficha de Google no tiene descripción. Es el único lugar donde pueden contar con sus palabras qué los diferencia, y hoy está vacío.',
  },
  'maps-no-menu': {
    priority: 4, topic: 'menú online',
    text: () => 'En Google no aparece la carta. Es de lo más consultado en la ficha de un restaurante, y si no está, la decisión se toma mirando otro lugar.',
  },
  'maps-no-posts': {
    priority: 4, topic: 'Google Maps',
    text: () => 'En la ficha de Google no hay publicaciones. Una ficha con novedades recientes transmite que el negocio está activo; una vacía, lo contrario.',
  },
  // 5 · Reseñas
  'rep-very-few-reviews': {
    priority: 5, topic: 'reseñas',
    text: (i) => (i.profile?.reviewCount === undefined ? undefined : `En Google tienen ${i.profile.reviewCount === 0 ? 'todavía ninguna reseña' : `solo ${n(i.profile.reviewCount)} reseña${i.profile.reviewCount === 1 ? '' : 's'}`}. Cuando alguien compara varias opciones en el mapa, eso pesa mucho en la confianza que genera cada lugar.`),
  },
  'rep-few-reviews': {
    priority: 5, topic: 'reseñas',
    text: (i) => {
      const c = i.profile?.reviewCount;
      if (c === undefined) return undefined;
      const r = i.profile?.rating;
      return `${r !== undefined && r >= 4.3 ? `La valoración es buena (${fmtRating(r)} estrellas), pero tienen` : 'Tienen'} ${n(c)} reseñas en Google. Cuando alguien compara varias opciones, la cantidad de reseñas influye en la confianza que genera cada negocio.`;
    },
  },
  'rep-stale-reviews': {
    priority: 5, topic: 'reseñas',
    text: (i) => (i.metrics?.daysSinceLastReview === undefined ? undefined : `La reseña más reciente en Google es de hace unos ${i.metrics.daysSinceLastReview} días. Cuando las opiniones más nuevas son viejas, la gente duda de si el lugar sigue igual.`),
  },
  'rep-no-responses': {
    priority: 5, topic: 'reseñas',
    text: () => 'Casi ninguna reseña tiene respuesta del negocio. Responderlas no lleva tanto tiempo y cambia bastante la imagen que se lleva el que está mirando.',
  },
  // 6 · Presencia web
  'web-social-only': {
    priority: 6, topic: 'páginas web',
    text: () => 'Hoy en Google tienen como principal referencia Instagram. Está bueno que lo tengan, pero cuando alguien los busca desde Google no cuenta con una página propia donde ver rápido los servicios, la información y las formas de contacto.',
  },
  'web-none': {
    priority: 6, topic: 'páginas web',
    text: (i) => (igFound(i)
      ? 'Hoy la principal referencia que aparece es Instagram. Funciona, pero cuando alguien busca el negocio desde Google no tiene un lugar propio donde ver rápido servicios, información y formas de contacto.'
      : `Busqué ${i.name} y no encontré una página propia. El que los encuentra en Google no tiene dónde ver rápido qué hacen, cómo trabajan y cómo contactarlos.`),
  },
  'web-not-mobile': {
    priority: 6, topic: 'páginas web',
    text: () => 'Entré a la web desde el celular y no está adaptada: hay que hacer zoom para leer. Casi todo el que llega desde Google Maps entra desde el teléfono.',
  },
  'web-slow': {
    priority: 6, topic: 'páginas web',
    text: (i) => (i.website?.loadTimeMs ? `La web tarda unos ${Math.round(i.website.loadTimeMs / 1000)} segundos en cargar. Desde el celular, mucha gente no espera tanto y vuelve a la búsqueda.` : undefined),
  },
  // 7 · Contacto
  'web-contact-hidden': {
    priority: 7, topic: 'páginas web',
    text: () => 'En la web el contacto no se ve al entrar: hay que buscarlo. El que llega con una consulta rápida no siempre tiene esa paciencia.',
  },
  'web-no-whatsapp': {
    priority: 7, topic: 'WhatsApp',
    text: () => 'En la web no hay un botón de WhatsApp. Es la forma en que la mayoría prefiere hacer una consulta rápida.',
  },
  // 9 · Secundarios (solo si no hay nada más importante)
  'maps-poor-description': {
    priority: 9, topic: 'Google Maps',
    text: () => 'La descripción de la ficha de Google es muy corta. Es el lugar ideal para contar qué los diferencia y aparecer en más búsquedas.',
  },
  'maps-generic-category': {
    priority: 9, topic: 'Google Maps',
    text: (i) => (i.profile?.category ? `En Google figuran con la categoría "${i.profile.category}", que es bastante general. Eso hace que aparezcan menos cuando alguien busca algo puntual del rubro.` : undefined),
  },
};

const IMPACT_RANK: Record<string, number> = { Alto: 0, 'Medio-Alto': 1, Medio: 2, Bajo: 3 };

export interface SelectedPitch {
  findingId: string;
  priority: number;
  topic: ServiceTopic;
  text: string;
  extra?: string;
}

/**
 * Elige hasta 3 problemas CONFIRMADOS, por prioridad comercial. Los secundarios (9) solo entran si
 * no hay ninguno más importante. Nunca se usan argumentos "probables" ni sin plantilla.
 */
export function selectPitches(i: PitchInput, max = 3): SelectedPitch[] {
  const candidates = i.problems
    .map((p, idx) => ({ p, idx, t: PITCHES[p.findingId] }))
    .filter((x) => x.t && (x.p.level ?? 'confirmado') === 'confirmado')
    .map((x) => ({ ...x, text: x.t!.text(i) }))
    .filter((x): x is typeof x & { text: string } => !!x.text)
    .sort((a, b) => a.t!.priority - b.t!.priority || (IMPACT_RANK[a.p.impact] ?? 9) - (IMPACT_RANK[b.p.impact] ?? 9) || a.idx - b.idx);
  const main = candidates.filter((c) => c.t!.priority < 9);
  const pool = main.length ? main : candidates.slice(0, 1);
  return pool.slice(0, max).map((c) => ({ findingId: c.p.findingId, priority: c.t!.priority, topic: c.t!.topic, text: c.text, extra: c.t!.extra?.(i) }));
}

/** Frases que hacen que un mensaje parezca spam o de agencia (nunca se usan). */
export const BANNED_PHRASES = [
  'encontré 3 oportunidades', 'análisis gratuito', 'te puedo ayudar a conseguir más clientes', 'potenciar', 'escalar tu negocio',
  'llevar tu negocio al siguiente nivel', 'siguiente nivel', 'generar más ventas', 'mejorar tu facturación', 'somos una agencia',
  'somos expertos', 'marketing digital', 'solución integral', 'soluciones integrales', 'sin compromiso', 'oportunidad única',
];
