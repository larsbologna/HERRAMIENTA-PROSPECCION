import { channelOf, type ChannelReport } from '../channels/crossCheck.js';
import { isVerified } from '../domain/reliability.js';
import type { AnalysisResult, Finding } from '../domain/types.js';
import type { RubroProfile, RubroVocab, Topic } from '../rubros/catalog.js';

/**
 * OPORTUNIDADES COMERCIALES de un prospecto.
 *
 * La pregunta no es "¿qué le falta?", sino "¿qué hace bien, dónde puede estar perdiendo clientes y qué
 * podría mejorar para convertir mejor a la gente que ya lo encuentra?".
 *
 *  - Cada oportunidad trae FUENTE, EVIDENCIA y CONFIANZA. Solo se usan las confirmadas: si no hay
 *    evidencia suficiente, no se muestra.
 *  - Depende del rubro: a un pet shop nunca se le ofrecen turnos ni reservas; a una veterinaria se le
 *    habla de turnos; a un restaurante, de reservas; a un negocio que vende productos, de catálogo.
 *  - Se ordenan según lo que le importa a ESE rubro y no se repite el mismo tema.
 *  - Se explica la consecuencia comercial, con prudencia ("puede", "podría"), sin inventar pérdidas.
 */

export type OppArea = 'Google Maps' | 'Instagram' | 'Web' | 'Contacto' | 'Conversión' | 'Reputación';

export interface Opportunity {
  id: string;
  topic: Topic;
  area: OppArea;
  /** Título comercial corto ("Sin canal rápido de consulta"). */
  title: string;
  /** Lo que se ve, concreto ("cuando alguien necesita… no tiene una forma rápida de contactarlos"). */
  observation: string;
  /** Qué puede pasar por eso (prudente, sin cifras inventadas). */
  consequence: string;
  /** La observación en pocas palabras (versiones cortas). */
  short: string;
  source: string;
  evidence: string;
  confidence: 'alta' | 'media';
  score: number;
}

export interface Strength {
  id: string;
  /** Frase para abrir el mensaje ("Ya tienen más de 160 reseñas…"). */
  text: string;
  label: string;
}

export interface OpportunityReport {
  opportunities: Opportunity[];
  strengths: Strength[];
  /** Hallazgos que quedaron afuera por falta de evidencia o por no tener sentido para el rubro. */
  discarded: number;
}

interface Ctx {
  a: AnalysisResult;
  p: RubroProfile;
  v: RubroVocab;
  ch?: ChannelReport;
  reviews?: number;
  rating?: number;
  finding?: Finding;
}

interface Def {
  topic: Topic;
  area: OppArea;
  /** ¿Tiene sentido para este rubro y con estos datos? */
  applies?: (c: Ctx) => boolean;
  build: (c: Ctx) => { title: string; observation: string; consequence: string; short: string } | undefined;
  /** Importancia propia (además de la gravedad del hallazgo y el foco del rubro). */
  weight?: number;
}

const n = (x: number) => x.toLocaleString('es-AR');
const stars = (r: number) => String(r.toFixed(1)).replace('.', ',');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const found = (c: Ctx, id: Parameters<typeof channelOf>[1]) => channelOf(c.ch, id)?.status === 'encontrado';
const absent = (c: Ctx, id: Parameters<typeof channelOf>[1]) => channelOf(c.ch, id)?.status === 'no_encontrado';
const hasBooking = (c: Ctx) => !!c.p.booking;

const DEFS: Record<string, Def> = {
  // ---------------------------------------------------------------- contacto
  'wa-not-visible': {
    topic: 'contacto', area: 'Contacto', weight: 2,
    build: (c) => {
      const noWeb = !found(c, 'web');
      return {
        title: 'Sin canal rápido de consulta',
        observation: noWeb ? `cuando alguien necesita ${c.v.necesidad}, no tiene una forma rápida de contactarlos online` : `no hay un WhatsApp visible para escribirles directo cuando alguien quiere ${c.v.necesidad}`,
        consequence: `En ese momento, una persona que necesita resolverlo rápido puede terminar escribiéndole a ${c.v.otro}.`,
        short: noWeb ? 'no hay una forma rápida de contactarlos online' : 'no hay un WhatsApp visible para escribirles',
      };
    },
  },
  'maps-no-phone': {
    topic: 'contacto', area: 'Google Maps', weight: 2,
    build: (c) => ({
      title: 'Sin teléfono en Google',
      observation: 'en Google no aparece un teléfono para llamarlos',
      consequence: `Quien los encuentra desde el celular y quiere ${c.v.necesidad} puede seguir de largo y elegir ${c.v.otro}.`,
      short: 'en Google no aparece un teléfono',
    }),
  },
  'web-poor-contact': {
    topic: 'contacto', area: 'Web',
    build: () => ({
      title: 'Contacto difícil de encontrar en la web',
      observation: 'en la web cuesta encontrar cómo contactarlos',
      consequence: 'Alguien con ganas de consultar puede irse antes de encontrarlo, y esa consulta se pierde sin que nadie se entere.',
      short: 'en la web cuesta encontrar cómo contactarlos',
    }),
  },
  'web-contact-hidden': {
    topic: 'contacto', area: 'Web',
    build: () => ({
      title: 'Contacto escondido en la web',
      observation: 'en la web el contacto no se ve al entrar, hay que buscarlo',
      consequence: 'El que tiene una consulta rápida no siempre tiene esa paciencia y puede terminar preguntando en otro lado.',
      short: 'en la web el contacto no se ve a simple vista',
    }),
  },
  'web-no-whatsapp': {
    topic: 'contacto', area: 'Web',
    build: () => ({
      title: 'La web no deriva a WhatsApp',
      observation: 'en la web no hay un botón para escribirles por WhatsApp',
      consequence: 'Es como la mayoría prefiere consultar, y cada paso de más puede hacer que algunos abandonen.',
      short: 'en la web no hay un botón de WhatsApp',
    }),
  },
  'ig-no-contact': {
    topic: 'instagram', area: 'Instagram',
    build: (c) => ({
      title: 'Instagram sin camino para contactarlos',
      observation: `el Instagram no tiene un enlace ni un botón para escribirles${c.p.booking ? ` o ${c.v.bookingVerb}` : c.p.products ? ' o hacer un pedido' : ''}`,
      consequence: 'Quien los descubre por ahí tiene que buscar por su cuenta cómo contactarlos, y muchos pueden no hacerlo.',
      short: 'el Instagram no tiene un camino directo para escribirles',
    }),
  },
  // ---------------------------------------------------------------- agenda (solo rubros con turnos o reservas)
  'booking-none': {
    topic: 'agenda', area: 'Conversión', weight: 1, applies: hasBooking,
    build: (c) => ({
      title: `Sin ${c.v.bookingNoun} online`,
      observation: `para ${c.v.bookingVerb} hay que llamar o escribir y esperar respuesta`,
      consequence: c.p.booking === 'turnos'
        ? `Mucha gente busca turno fuera del horario de atención, y si no puede resolverlo en ese momento, puede terminar eligiendo ${c.v.otro}.`
        : `Mucha gente decide dónde ir a último momento o fuera de horario, y si no puede reservar en ese momento, puede terminar eligiendo ${c.v.otro}.`,
      short: `para ${c.v.bookingVerb} hay que llamar o escribir`,
    }),
  },
  'web-no-booking': {
    topic: 'agenda', area: 'Web', applies: hasBooking,
    build: (c) => ({
      title: `La web no permite ${c.v.bookingVerb}`,
      observation: `en la web no se puede ${c.v.bookingVerb} online`,
      consequence: 'El que entra decidido tiene que salir a llamar o escribir, y en ese paso algunos se enfrían.',
      short: `en la web no se puede ${c.v.bookingVerb}`,
    }),
  },
  'booking-hidden': {
    topic: 'agenda', area: 'Conversión', weight: 1, applies: hasBooking,
    build: (c) => ({
      title: `${cap(c.v.bookingNoun ?? 'reservas')} escondidos detrás de varios pasos`.replace('Reservas escondidos', 'Reservas escondidas'),
      observation: `el sistema de ${c.v.bookingNoun} existe, pero está escondido detrás de varios pasos: hay que entrar a Instagram y después a otro enlace`,
      consequence: `Cada paso extra es un lugar donde alguien puede abandonar antes de ${c.v.bookingVerb}.`,
      short: `el sistema de ${c.v.bookingNoun} está escondido detrás de varios pasos`,
    }),
  },
  // ---------------------------------------------------------------- catálogo (rubros que venden productos)
  'catalog-none': {
    topic: 'catalogo', area: 'Conversión', weight: 2, applies: (c) => c.p.products,
    build: (c) => ({
      title: 'Sin catálogo de productos',
      observation: 'no hay un lugar donde ver los productos y los precios',
      consequence: `Quien quiere saber si tienen algo tiene que preguntar uno por uno, y muchas veces puede terminar comprando en ${c.v.otro} donde lo ve más rápido.`,
      short: 'no hay un lugar donde ver productos y precios',
    }),
  },
  // ---------------------------------------------------------------- reputación
  'rep-negative-unanswered': {
    topic: 'reputacion', area: 'Reputación', weight: 2,
    build: () => ({
      title: 'Reseñas negativas sin respuesta',
      observation: 'hay reseñas negativas recientes que quedaron sin respuesta',
      consequence: 'Una reseña negativa sin respuesta queda visible para los próximos clientes y puede generar dudas justo cuando están comparando alternativas.',
      short: 'hay reseñas negativas recientes sin respuesta',
    }),
  },
  'rep-low-rating': {
    topic: 'reputacion', area: 'Reputación',
    build: (c) => (c.rating === undefined ? undefined : {
      title: 'Puntuación por debajo de su potencial',
      observation: `${c.reviews !== undefined ? `tienen ${n(c.reviews)} reseñas pero ` : ''}la puntuación en Google es ${stars(c.rating)}`,
      consequence: 'Mucha gente filtra por puntuación antes de elegir, así que unas décimas pueden hacer que los descarten sin leer nada.',
      short: `la puntuación en Google es ${stars(c.rating)}`,
    }),
  },
  'rep-no-responses': {
    topic: 'reputacion', area: 'Reputación',
    build: () => ({
      title: 'Reseñas sin respuesta del negocio',
      observation: 'casi ninguna reseña tiene respuesta del negocio',
      consequence: 'Para quien está mirando, responder muestra atención; no hacerlo puede leerse como lo contrario.',
      short: 'casi ninguna reseña tiene respuesta',
    }),
  },
  'rep-few-reviews': {
    topic: 'reputacion', area: 'Reputación',
    build: (c) => (c.reviews === undefined ? undefined : {
      title: 'Pocas reseñas en Google',
      observation: c.reviews === 0 ? 'todavía no tienen reseñas en Google' : `tienen ${n(c.reviews)} reseña${c.reviews === 1 ? '' : 's'} en Google`,
      consequence: `Cuando alguien compara, ${c.v.otro} con más opiniones suele generar más confianza, aunque el servicio no sea mejor.`,
      short: c.reviews === 0 ? 'todavía no tienen reseñas en Google' : `tienen ${n(c.reviews)} reseñas en Google`,
    }),
  },
  'rep-stale-reviews': {
    topic: 'reputacion', area: 'Reputación',
    build: () => ({
      title: 'Reseñas que no se renuevan',
      observation: 'hace tiempo que no reciben reseñas nuevas en Google',
      consequence: 'Cuando las opiniones más recientes son viejas, algunas personas dudan de si el lugar sigue igual.',
      short: 'hace tiempo que no reciben reseñas nuevas',
    }),
  },
  // ---------------------------------------------------------------- Google Maps
  'maps-closed': {
    topic: 'maps', area: 'Google Maps', weight: 6,
    build: () => ({
      title: 'Figura como cerrado en Google',
      observation: 'en Google Maps figura como cerrado permanentemente',
      consequence: 'Si siguen atendiendo, casi todo el que los busca puede ver ese cartel y seguir de largo.',
      short: 'en Google figura como cerrado permanentemente',
    }),
  },
  'maps-no-hours': {
    topic: 'maps', area: 'Google Maps',
    build: () => ({
      title: 'Horarios que no figuran en Google',
      observation: 'en Google no figuran los horarios',
      consequence: 'Ante la duda, mucha gente elige un lugar que sí dice "Abierto ahora".',
      short: 'en Google no figuran los horarios',
    }),
  },
  'maps-incomplete-hours': {
    topic: 'maps', area: 'Google Maps',
    build: () => ({
      title: 'Horarios incompletos en Google',
      observation: 'en Google los horarios están incompletos',
      consequence: 'Los días que faltan, el que busca no sabe si están abiertos y puede ir a lo seguro.',
      short: 'en Google los horarios están incompletos',
    }),
  },
  'maps-few-photos': {
    topic: 'maps', area: 'Google Maps',
    build: (c) => ({
      title: 'Pocas fotos en Google',
      observation: c.a.profile.photoCount !== undefined ? `la ficha de Google tiene solo ${n(c.a.profile.photoCount)} fotos` : 'la ficha de Google tiene pocas fotos',
      consequence: 'Es lo primero que mira alguien que no los conoce, y con pocas fotos le puede costar imaginarse el lugar y animarse.',
      short: 'la ficha de Google tiene pocas fotos',
    }),
  },
  'maps-no-description': {
    topic: 'maps', area: 'Google Maps',
    build: () => ({
      title: 'Perfil de Google poco trabajado',
      observation: 'en Google no hay información que cuente por qué elegirlos',
      consequence: 'Cuando alguien compara varias opciones, eso puede hacer más difícil diferenciarse.',
      short: 'en Google no hay nada que cuente por qué elegirlos',
    }),
  },
  'maps-unclaimed': {
    topic: 'maps', area: 'Google Maps', weight: 1,
    build: () => ({
      title: 'Ficha de Google sin gestionar',
      observation: 'la ficha de Google no está gestionada por el negocio',
      consequence: 'Cualquiera puede sugerir cambios en horarios o teléfono, y el negocio no puede responder las reseñas.',
      short: 'la ficha de Google no está gestionada por el negocio',
    }),
  },
  'maps-no-posts': {
    topic: 'maps', area: 'Google Maps', weight: -1,
    build: () => ({
      title: 'Perfil de Google sin novedades',
      observation: 'la ficha de Google no tiene novedades recientes',
      consequence: 'Una ficha activa transmite que el negocio está en movimiento; una quieta puede dejar dudas.',
      short: 'la ficha de Google no tiene novedades',
    }),
  },
  'web-not-in-maps': {
    topic: 'maps', area: 'Google Maps', weight: 1,
    build: () => ({
      title: 'La web no aparece en Google',
      observation: 'tienen web, pero no está vinculada en Google',
      consequence: 'Quien los encuentra en Maps, que es justo el que ya los está buscando, puede no llegar a verla.',
      short: 'la web no está vinculada en Google',
    }),
  },
  'maps-no-menu': {
    topic: 'catalogo', area: 'Google Maps', applies: (c) => c.p.key === 'restaurantes' || c.p.key === 'cafeterias',
    build: () => ({
      title: 'La carta no aparece en Google',
      observation: 'en Google no aparece la carta',
      consequence: 'Es de lo primero que se mira antes de elegir dónde ir, y sin la carta a mano la decisión puede tomarse mirando otro lugar.',
      short: 'en Google no aparece la carta',
    }),
  },
  // ---------------------------------------------------------------- web
  'web-none': {
    topic: 'web', area: 'Web',
    build: (c) => ({
      title: 'Sin página propia',
      observation: 'no aparece una página propia del negocio',
      consequence: `Quien busca información fuera de Google no tiene un lugar propio donde ver ${c.p.products ? 'productos, precios' : 'servicios, horarios'} y formas de contacto, y puede terminar comparando directamente con ${c.v.otro}.`,
      short: 'no tienen una página propia',
    }),
  },
  'web-down': {
    topic: 'web', area: 'Web', weight: 4,
    build: () => ({
      title: 'La web no carga',
      observation: 'la web que figura en Google no carga',
      consequence: 'Justo el que estaba interesado se encuentra con un error, y puede volver a la búsqueda y elegir otra opción.',
      short: 'la web que figura en Google no carga',
    }),
  },
  'web-not-mobile': {
    topic: 'web', area: 'Web',
    build: () => ({
      title: 'Web incómoda en el celular',
      observation: 'la web es incómoda de usar desde el celular',
      consequence: 'Casi todo el que llega desde Google Maps entra desde el teléfono, y si le cuesta leer, puede irse.',
      short: 'la web es incómoda desde el celular',
    }),
  },
  'web-slow': {
    topic: 'web', area: 'Web',
    build: () => ({
      title: 'Web lenta',
      observation: 'la web tarda bastante en cargar desde el celular',
      consequence: 'Mucha gente no espera y vuelve a la búsqueda.',
      short: 'la web tarda en cargar',
    }),
  },
  'web-outdated': {
    topic: 'web', area: 'Web',
    build: () => ({
      title: 'Web desactualizada',
      observation: 'la web se ve desactualizada',
      consequence: 'Una web que parece vieja puede hacer dudar de si el negocio sigue igual, justo cuando alguien está decidiendo.',
      short: 'la web se ve desactualizada',
    }),
  },
  'web-no-https': {
    topic: 'web', area: 'Web', weight: -1,
    build: () => ({
      title: 'Web marcada como "No segura"',
      observation: 'el navegador marca la web como "No segura"',
      consequence: 'A mucha gente eso le genera desconfianza justo antes de consultar.',
      short: 'la web aparece como "No segura"',
    }),
  },
};

/** Hallazgos equivalentes: se usa la misma oportunidad (no se repite el tema). */
const ALIAS: Record<string, string> = {
  'web-social-only': 'web-none',
  'web-mobile-issues': 'web-not-mobile',
  'maps-low-photos': 'maps-few-photos',
  'maps-poor-description': 'maps-no-description',
  'maps-stale-posts': 'maps-no-posts',
  'rep-medium-rating': 'rep-low-rating',
  'rep-low-responses': 'rep-no-responses',
  'rep-very-few-reviews': 'rep-few-reviews',
  'rep-moderate-reviews': 'rep-few-reviews',
  'rep-low-frequency': 'rep-stale-reviews',
};

const SEVERITY: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const AREA_SOURCE: Record<string, string> = { maps: 'Google Maps', website: 'Web', whatsapp: 'Google Maps · Web · Instagram', reputation: 'Reseñas de Google' };

/** Enlaces de tienda o catálogo (en Maps, web o Instagram): si hay, el negocio ya tiene catálogo. */
const SHOP_LINK = /tiendanube|mitiendanube|mercadoshops|mercadolibre|empretienda|wa\.me\/c\/|catalog|catalogo|tienda|shop|pedidosya|rappi/i;

export function analyzeOpportunities(a: AnalysisResult, p: RubroProfile): OpportunityReport {
  const ch = a.channels;
  const q = a.profile.dataQuality;
  const ctx: Ctx = {
    a, p, v: p.vocab, ch,
    reviews: a.profile.reviewCount !== undefined && isVerified(q, 'reviewCount') ? a.profile.reviewCount : undefined,
    rating: a.profile.rating !== undefined && isVerified(q, 'rating') ? a.profile.rating : undefined,
  };
  const candidates: Array<{ id: string; finding?: Finding; source: string; evidence: string }> = [];
  let discarded = 0;

  // 1) Hallazgos de la auditoría CONFIRMADOS (los probables no se usan: no hay evidencia suficiente).
  for (const f of a.audit?.findings ?? []) {
    if ((f.level ?? 'confirmado') !== 'confirmado') { discarded++; continue; }
    const id = ALIAS[f.id] ?? f.id;
    if (!DEFS[id]) continue;
    const src: string = f.id === 'wa-not-visible' ? (channelOf(ch, 'whatsapp')?.sources.join(', ') ?? AREA_SOURCE.whatsapp!) : (AREA_SOURCE[f.area] ?? 'Google Maps');
    candidates.push({ id, finding: f, source: src, evidence: f.evidence ?? f.detail });
  }
  // 2) Oportunidades que surgen de cruzar canales.
  const res = channelOf(ch, 'reservas');
  if (res?.status === 'encontrado' && res.url && res.sources.every((s) => /Instagram/.test(s))) {
    candidates.push({ id: 'booking-hidden', source: res.sources.join(', '), evidence: `${res.detail ? `${res.detail}: ` : ''}${res.url}` });
  }
  const ig = ch?.instagram;
  if (ig?.instagram_analysis_status === 'ok' && ig.instagram_whatsapp_available === false && ig.instagram_contact_available === false
    && !ig.instagram_external_link && !ig.instagram_linktree && !found(ctx, 'whatsapp')) {
    candidates.push({ id: 'ig-no-contact', source: 'Instagram', evidence: `@${ig.instagram_username ?? ''}: sin enlace en la bio ni botón de contacto` });
  }
  if (p.products && absent(ctx, 'web')) {
    const links = [...(a.profile.socialLinks ?? []), ...(ch?.channels.flatMap((c) => (c.url ? [c.url] : [])) ?? [])];
    const igChecked = !ch?.instagramUrl || ig?.instagram_analysis_status === 'ok';
    if (igChecked && !links.some((l) => SHOP_LINK.test(l)) && !a.profile.menuUrl) {
      candidates.push({ id: 'catalog-none', source: ch?.instagramUrl ? 'Google Maps · Instagram' : 'Google Maps', evidence: 'Sin web, tienda online ni enlace de catálogo en los canales revisados' });
    }
  }

  // 3) Construir, filtrar por rubro y puntuar.
  const seen = new Set<string>();
  const all: Opportunity[] = [];
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const def = DEFS[c.id]!;
    const cx = { ...ctx, finding: c.finding };
    if (def.applies && !def.applies(cx)) { discarded++; continue; }
    const built = def.build(cx);
    if (!built) { discarded++; continue; }
    const focusIdx = p.focus.indexOf(def.topic);
    const focusBonus = focusIdx === -1 ? 0 : (p.focus.length - focusIdx) * 1.5;
    const severity = c.finding ? SEVERITY[c.finding.severity] ?? 2 : 3;
    all.push({ id: c.id, topic: def.topic, area: def.area, ...built, source: c.source, evidence: c.evidence, confidence: 'alta', score: severity + focusBonus + (def.weight ?? 0) });
  }
  all.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  // Un tema por vez primero (no repetir "WhatsApp, WhatsApp, WhatsApp"); después el resto.
  const topics = new Set<Topic>();
  const first = all.filter((o) => (topics.has(o.topic) ? false : (topics.add(o.topic), true)));
  const unique = [...first, ...all.filter((o) => !first.includes(o))];

  return { opportunities: unique, strengths: strengthsOf(ctx), discarded };
}

/** Lo que el negocio hace bien (para abrir el mensaje con algo real y positivo). */
function strengthsOf(c: Ctx): Strength[] {
  const out: Strength[] = [];
  const floor = (x: number) => (x >= 100 ? Math.floor(x / 10) * 10 : x >= 20 ? Math.floor(x / 5) * 5 : x);
  /** "más de 160 reseñas" solo si de verdad son más; si no, el número exacto. */
  const reviewsText = (x: number) => (floor(x) < x ? `más de ${n(floor(x))} reseñas` : `${n(x)} reseñas`);
  if (c.reviews !== undefined && c.rating !== undefined && c.reviews >= 40 && c.rating >= 4.4) {
    out.push({ id: 'reputacion', label: 'Buena reputación en Google', text: `Ya tienen ${reviewsText(c.reviews)} en Google y una muy buena puntuación, así que claramente hay gente que los encuentra y confía en el negocio.` });
  } else if (c.reviews !== undefined && c.reviews >= 40) {
    out.push({ id: 'visibilidad', label: 'Visibles en Google', text: `Ya tienen ${reviewsText(c.reviews)} en Google, así que hay gente que los encuentra.` });
  } else if (c.rating !== undefined && c.rating >= 4.6 && (c.reviews ?? 0) >= 10) {
    out.push({ id: 'puntuacion', label: 'Muy buena puntuación', text: `Tienen una puntuación muy buena en Google (${stars(c.rating)}), que habla bien del trabajo que hacen.` });
  }
  if (found(c, 'instagram')) out.push({ id: 'instagram', label: 'Instagram', text: 'Vi que tienen Instagram, que suma mucho.' });
  if (found(c, 'web') && !/no carga/i.test(channelOf(c.ch, 'web')?.detail ?? '')) out.push({ id: 'web', label: 'Página web', text: 'Tienen página web, que es una buena base.' });
  const res = channelOf(c.ch, 'reservas');
  if (res?.status === 'encontrado' && res.url && c.p.booking) out.push({ id: 'agenda', label: `${cap(c.v.bookingNoun ?? 'reservas')} online`, text: `Ya tienen ${c.v.bookingNoun} online, que es un paso que muchos todavía no dieron.` });
  return out;
}

/** Resumen corto para listas (top 3). */
export function opportunityTitles(r: OpportunityReport, max = 3): Array<{ id: string; title: string; area: OppArea }> {
  return r.opportunities.slice(0, max).map((o) => ({ id: o.id, title: o.title, area: o.area }));
}
