import type { PitchInput } from './pitch.js';

/**
 * ÁNGULOS DE VENTA: cómo se cuenta cada oportunidad en un mensaje que busca UNA RESPUESTA del dueño.
 *
 * No se describe el problema técnico: se cuenta lo que vive el cliente (situación), qué hace
 * (consecuencia), cuánto le cuesta al negocio según su rubro (dolor económico), qué gana si se
 * resuelve (beneficio) y se cierra con una pregunta chica. El dueño compra resultados, no tecnología.
 *
 * Todo sale de datos DETECTADOS (los argumentos confirmados): no se inventa nada.
 */

export type SalesCategory = 'contacto' | 'reservas' | 'confianza' | 'visibilidad' | 'web' | 'carta';
export type RubroGroup = 'barberia' | 'estetica' | 'gastronomia' | 'gimnasio' | 'taller' | 'salud' | 'general';

export const CATEGORY_LABEL: Record<SalesCategory, string> = {
  contacto: 'Contacto directo',
  reservas: 'Reservas fuera de horario',
  confianza: 'Confianza al comparar',
  visibilidad: 'Elección en Google Maps',
  web: 'Presencia propia en internet',
  carta: 'Carta visible',
};

export const GROUP_LABEL: Record<RubroGroup, string> = {
  barberia: 'Barbería', estetica: 'Estética y peluquería', gastronomia: 'Gastronomía', gimnasio: 'Gimnasio',
  taller: 'Taller', salud: 'Salud', general: 'Negocio local',
};

/** Lo que no se ve de esa pérdida (o el esfuerzo extra que genera): se suma si el mensaje queda corto. */
export const HIDDEN_COST: Record<SalesCategory, string> = {
  contacto: 'Y lo más difícil es que nadie avisa: simplemente eligen otra opción y el negocio no llega a enterarse.',
  reservas: 'Además, coordinar cada turno a mano por mensaje o teléfono lleva un tiempo que podrían usar en atender.',
  confianza: 'Y lo más difícil es que nadie avisa: simplemente eligen otra opción y el negocio no llega a enterarse.',
  visibilidad: 'Y lo más difícil es que nadie avisa: simplemente eligen otra opción y el negocio no llega a enterarse.',
  web: 'Y además, responder una y otra vez las mismas preguntas por mensaje lleva tiempo que se podría ahorrar.',
  carta: 'Y además, mandar la carta por mensaje a cada uno que pregunta lleva tiempo que se podría ahorrar.',
};

interface Angle {
  cat: SalesCategory;
  /** Lo que vive el cliente + lo que hace (1–2 oraciones, con datos reales). */
  situation: (i: PitchInput) => string | undefined;
  /** La misma idea en una frase corta, para la versión corta ("en Google no figuran los horarios"). */
  short: (i: PitchInput) => string | undefined;
  /** Dolor y beneficio propios de esta oportunidad (si no, los de su categoría y rubro). */
  pain?: (base: Pain) => Pain;
}

const n = (v: number) => v.toLocaleString('es-AR');
const stars = (r: number) => String(r.toFixed(1)).replace('.', ',');
const igFound = (i: PitchInput) => i.channels?.channels.some((c) => c.id === 'instagram' && c.status === 'encontrado');
const turno = (i: PitchInput) => (i.verticalId === 'gastronomia' ? 'reservar una mesa' : i.verticalId === 'fitness' ? 'reservar una clase' : i.verticalId === 'alojamiento' ? 'reservar' : 'sacar un turno');
const turnos = (i: PitchInput) => (i.verticalId === 'gastronomia' ? 'mesa' : i.verticalId === 'fitness' ? 'clase' : i.verticalId === 'alojamiento' ? 'dónde quedarse' : 'turno');

export const ANGLES: Record<string, Angle> = {
  // ---------------- contacto
  'wa-not-visible': {
    cat: 'contacto',
    situation: () => 'Una persona puede encontrar el negocio pero no tiene una forma directa de escribirles por WhatsApp. Cada paso extra aumenta la probabilidad de que abandone y termine contactando a otra opción.',
    short: () => 'quien los encuentra no tiene una forma directa de escribirles',
  },
  'maps-no-phone': {
    cat: 'contacto',
    situation: () => 'En la ficha de Google no hay un teléfono para tocar. El que los encuentra desde el celular quiere consultar en ese momento, y si no puede, sigue con la próxima opción.',
    short: () => 'en Google no hay un teléfono para tocar',
  },
  'web-poor-contact': {
    cat: 'contacto',
    situation: () => 'Entré a la web y cuesta encontrar cómo contactarlos. El que llega con ganas de consultar no busca demasiado: si no lo ve rápido, se va.',
    short: () => 'en la web cuesta encontrar cómo contactarlos',
  },
  'web-contact-hidden': {
    cat: 'contacto',
    situation: () => 'En la web el contacto no se ve al entrar, hay que buscarlo. El que tiene una consulta rápida no siempre tiene esa paciencia y termina preguntando en otro lado.',
    short: () => 'en la web el contacto no se ve a simple vista',
  },
  'web-no-whatsapp': {
    cat: 'contacto',
    situation: () => 'En la web no hay un botón de WhatsApp, que es como la mayoría prefiere consultar. Tener que copiar un número o llamar ya es un paso de más, y ahí muchos se frenan.',
    short: () => 'en la web no hay un botón de WhatsApp',
  },
  // ---------------- reservas
  'booking-none': {
    cat: 'reservas',
    situation: (i) => `Para ${turno(i)} hoy hay que llamar o escribir y esperar respuesta. Las personas suelen buscar ${turnos(i)} por la noche o fuera del horario de atención, y si no pueden reservar en ese momento, muchas veces terminan eligiendo otro lugar.`,
    short: (i) => `para ${turno(i)} hay que llamar o escribir y esperar respuesta`,
  },
  'web-no-booking': {
    cat: 'reservas',
    situation: (i) => `En la web no se puede ${turno(i)} online. El que entra decidido tiene que salir a llamar o escribir, y en ese paso muchos se enfrían.`,
    short: (i) => `en la web no se puede ${turno(i)} online`,
  },
  // ---------------- confianza
  'rep-negative-unanswered': {
    cat: 'confianza',
    situation: () => 'Vi algunas reseñas negativas recientes que quedaron sin respuesta. Son justo las que lee alguien que todavía está comparando, y sin una respuesta del negocio queda una sola versión de la historia.',
    short: () => 'hay reseñas negativas recientes sin respuesta',
  },
  'rep-low-rating': {
    cat: 'confianza',
    situation: (i) => (i.profile?.rating === undefined ? undefined : `Están con ${stars(i.profile.rating)} estrellas en Google, y mucha gente descarta los lugares por debajo de 4 sin llegar a leer ninguna reseña.`),
    short: (i) => (i.profile?.rating === undefined ? undefined : `están con ${stars(i.profile.rating)} estrellas en Google`),
  },
  'maps-unclaimed': {
    cat: 'confianza',
    situation: () => 'La ficha de Google figura como no reclamada: cualquiera puede sugerir cambios en el horario o el teléfono, y ustedes no pueden responder reseñas. La gente toma esa información como cierta.',
    short: () => 'la ficha de Google no está reclamada',
  },
  'web-no-https': {
    cat: 'confianza',
    situation: () => 'La web aparece como "No segura" en el navegador, y a mucha gente eso le genera desconfianza justo antes de consultar.',
    short: () => 'la web aparece como "No segura"',
  },
  'rep-very-few-reviews': {
    cat: 'confianza',
    situation: (i) => {
      const c = i.profile?.reviewCount;
      if (c === undefined) return undefined;
      return `En Google tienen ${c === 0 ? 'todavía ninguna reseña' : `solo ${n(c)} reseña${c === 1 ? '' : 's'}`}. Cuando alguien compara varias opciones en el mapa, casi siempre elige la que tiene más opiniones, aunque el servicio no sea mejor.`;
    },
    short: (i) => (i.profile?.reviewCount === undefined ? undefined : i.profile.reviewCount === 0 ? 'todavía no tienen reseñas en Google' : `tienen solo ${n(i.profile.reviewCount)} reseña${i.profile.reviewCount === 1 ? '' : 's'} en Google`),
  },
  'rep-few-reviews': {
    cat: 'confianza',
    situation: (i) => {
      const c = i.profile?.reviewCount;
      if (c === undefined) return undefined;
      const r = i.profile?.rating;
      return `${r !== undefined && r >= 4.3 ? `Tienen muy buena valoración (${stars(r)} estrellas), pero ${n(c)}` : `Tienen ${n(c)}`} reseñas en Google. Cuando alguien compara opciones, la cantidad de opiniones pesa mucho a la hora de elegir.`;
    },
    short: (i) => (i.profile?.reviewCount === undefined ? undefined : `tienen ${n(i.profile.reviewCount)} reseñas en Google`),
  },
  'rep-stale-reviews': {
    cat: 'confianza',
    situation: (i) => (i.metrics?.daysSinceLastReview === undefined ? undefined : `La reseña más reciente en Google es de hace unos ${i.metrics.daysSinceLastReview} días. Cuando no aparecen opiniones nuevas, la gente duda de si el lugar sigue igual.`),
    short: (i) => (i.metrics?.daysSinceLastReview === undefined ? undefined : `la última reseña en Google es de hace ${i.metrics.daysSinceLastReview} días`),
  },
  'rep-no-responses': {
    cat: 'confianza',
    situation: () => 'Casi ninguna reseña tiene respuesta del negocio. El que está mirando lo lee como poca atención, aunque en el local pase todo lo contrario.',
    short: () => 'casi ninguna reseña tiene respuesta',
  },
  // ---------------- visibilidad (elegirlos en Google)
  'maps-closed': {
    cat: 'visibilidad',
    situation: (i) => `En Google Maps ${i.name} figura como cerrado permanentemente. Si siguen atendiendo, casi todo el que los busca ve ese cartel y sigue de largo.`,
    short: () => 'en Google figuran como cerrados permanentemente',
    pain: (base) => ({
      dolor: [`Mientras figure así, ${base.dolorShort}: la gente ni siquiera llega a consultar.`],
      dolorShort: base.dolorShort,
      beneficio: ['Se corrige rápido desde la ficha, y desde ese día vuelven a aparecer como abiertos para todos los que los buscan.'],
      beneficioShort: 'Se corrige rápido y vuelven a aparecer como abiertos',
    }),
  },
  'maps-no-hours': {
    cat: 'visibilidad',
    situation: () => 'En Google no figuran los horarios. Ante la duda, la gente no pregunta: elige un lugar que sí dice "Abierto ahora".',
    short: () => 'en Google no figuran los horarios',
  },
  'maps-incomplete-hours': {
    cat: 'visibilidad',
    situation: (i) => {
      const d = Object.keys(i.profile?.hours?.days ?? {}).length;
      return d ? `En Google los horarios figuran solo para ${d} de los 7 días. Los días que faltan, el que busca no sabe si están abiertos y va a lo seguro.` : undefined;
    },
    short: (i) => {
      const d = Object.keys(i.profile?.hours?.days ?? {}).length;
      return d ? `en Google los horarios figuran solo ${d} de 7 días` : undefined;
    },
  },
  'maps-few-photos': {
    cat: 'visibilidad',
    situation: (i) => (i.profile?.photoCount === undefined ? undefined : `La ficha de Google tiene ${n(i.profile.photoCount)} fotos. Es lo primero que mira alguien que no los conoce, y con tan poco cuesta imaginarse el lugar y animarse a ir.`),
    short: (i) => (i.profile?.photoCount === undefined ? undefined : `la ficha de Google tiene solo ${n(i.profile.photoCount)} fotos`),
  },
  'maps-no-description': {
    cat: 'visibilidad',
    situation: () => 'Cuando alguien compara varias opciones en Google, no encuentra información que explique por qué elegirlos a ustedes. Eso reduce la confianza y hace más difícil diferenciarse de la competencia.',
    short: () => 'en Google no hay nada que explique por qué elegirlos',
  },
  'maps-poor-description': {
    cat: 'visibilidad',
    situation: () => 'La descripción de Google es muy corta. Cuando alguien compara opciones, no encuentra qué los hace distintos, y eso hace más difícil diferenciarse de la competencia.',
    short: () => 'la descripción de Google casi no dice nada',
  },
  'maps-no-posts': {
    cat: 'visibilidad',
    situation: () => 'En la ficha de Google no hay novedades. Una ficha que se mueve transmite que el negocio está activo; una quieta deja dudas en el que todavía no los conoce.',
    short: () => 'la ficha de Google no tiene novedades',
  },
  'maps-generic-category': {
    cat: 'visibilidad',
    situation: (i) => (i.profile?.category ? `En Google figuran con la categoría "${i.profile.category}", que es muy general, y eso hace que aparezcan menos cuando alguien busca algo puntual.` : undefined),
    short: () => 'en Google figuran con una categoría muy general',
  },
  'web-not-in-maps': {
    cat: 'visibilidad',
    situation: () => 'Tienen web, pero no está vinculada en Google. El que los encuentra en Maps, que es justo el que ya los estaba buscando, no llega a verla.',
    short: () => 'la web no está vinculada en Google',
  },
  // ---------------- web
  'web-down': {
    cat: 'web',
    situation: () => 'Toqué el sitio web que figura en Google y no carga. Justo el que estaba interesado se encuentra con un error, y lo más probable es que vuelva a la búsqueda y elija otro.',
    short: () => 'la web que figura en Google no carga',
  },
  'web-none': {
    cat: 'web',
    situation: (i) => (igFound(i)
      ? 'Hoy la principal referencia que aparece es Instagram. Funciona, pero el que los busca en Google no encuentra un lugar propio donde ver rápido qué hacen y cómo contactarlos, y termina comparando con quien sí lo tiene.'
      : `Busqué ${i.name} y no encontré una página propia. El que los encuentra en Google no tiene dónde ver rápido qué hacen y cómo contactarlos, y termina comparando con quien sí lo muestra.`),
    short: () => 'no encontré una página propia del negocio',
  },
  'web-social-only': {
    cat: 'web',
    situation: () => 'Hoy en Google la referencia principal es una red social. El que los busca no encuentra un lugar propio donde ver rápido servicios y formas de contacto, y compara con quien sí lo tiene.',
    short: () => 'en Google la única referencia es una red social',
  },
  'web-not-mobile': {
    cat: 'web',
    situation: () => 'Entré a la web desde el celular y hay que hacer zoom para leer. Casi todo el que llega desde Google Maps entra desde el teléfono, y así se va rápido.',
    short: () => 'la web no se adapta al celular',
  },
  'web-slow': {
    cat: 'web',
    situation: (i) => (i.website?.loadTimeMs ? `La web tarda unos ${Math.round(i.website.loadTimeMs / 1000)} segundos en cargar desde el celular, y mucha gente no espera tanto: vuelve a la búsqueda y elige otro.` : undefined),
    short: (i) => (i.website?.loadTimeMs ? `la web tarda unos ${Math.round(i.website.loadTimeMs / 1000)} segundos en cargar` : undefined),
  },
  // ---------------- carta
  'maps-no-menu': {
    cat: 'carta',
    situation: () => 'En Google no aparece la carta, que es de lo primero que se mira antes de elegir dónde comer. Sin la carta a mano, la decisión se toma mirando otro lugar.',
    short: () => 'en Google no aparece la carta',
  },
};

/** Rubro comercial del prospecto (para hablar del dolor que le importa a ESE dueño). */
export function rubroGroup(i: Pick<PitchInput, 'verticalId' | 'name' | 'profile'>): RubroGroup {
  const text = `${i.profile?.category ?? ''} ${(i.profile?.additionalCategories ?? []).join(' ')} ${i.name}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/barber/.test(text)) return 'barberia';
  if (/taller|mecanic|lubricentro|gomeria|chapa y pintura|auto repair/.test(text) || i.verticalId === 'automotor') return 'taller';
  if (i.verticalId === 'gastronomia') return 'gastronomia';
  if (i.verticalId === 'fitness') return 'gimnasio';
  if (i.verticalId === 'belleza') return 'estetica';
  if (i.verticalId === 'salud') return 'salud';
  return 'general';
}

export interface Pain {
  /** Pérdida económica en el lenguaje del rubro (1–2 oraciones). */
  dolor: string[];
  /** La pérdida en pocas palabras ("son turnos que se pierden"). */
  dolorShort: string;
  /** Qué gana si se resuelve. */
  beneficio: string[];
  /** El beneficio en una frase corta (versión mediana). */
  beneficioShort: string;
}

type PainTable = Partial<Record<SalesCategory, Pain>>;

const PAINS: Record<RubroGroup, PainTable> = {
  barberia: {
    contacto: {
      dolor: ['En una barbería cada consulta que no llega es un turno menos en la semana, y esos huecos en la agenda son plata que no se recupera.', 'En una barbería eso son turnos que se pierden sin que nadie se entere, y huecos en la agenda que no vuelven.'],
      dolorShort: 'son turnos que se pierden y huecos en la agenda',
      beneficio: ['Con un WhatsApp a un toque y respuestas rápidas, más de esos interesados terminan sacando turno sin que tengas que estar pendiente del teléfono.'],
      beneficioShort: 'Con un WhatsApp a un toque, más de esos interesados terminan sacando turno',
    },
    reservas: {
      dolor: ['En una barbería eso se traduce en turnos que no se toman, huecos vacíos en la agenda y más cancelaciones de último momento.', 'Para una barbería son turnos de la noche que se pierden y días con huecos que no se llenan.'],
      dolorShort: 'son turnos que no se toman y huecos en la agenda',
      beneficio: ['Con reservas online a cualquier hora y recordatorios automáticos, la agenda se llena sola, bajan las cancelaciones y dejás de coordinar horarios por mensaje.'],
      beneficioShort: 'Con reservas online y recordatorios, la agenda se llena sola y bajan las cancelaciones',
    },
    confianza: {
      dolor: ['Y el que elige barbería en el mapa compara rápido: si duda, el turno se lo lleva la de al lado.'],
      dolorShort: 'el turno se lo lleva otra barbería',
      beneficio: ['Con más reseñas recientes y respondidas, la ficha empieza a jugar a favor y más gente nueva se anima a reservar sin conocerlos.'],
      beneficioShort: 'Con reseñas recientes y respondidas, más gente nueva se anima a reservar',
    },
    visibilidad: {
      dolor: ['Para una barbería eso significa menos clientes nuevos que se animan a reservar y más huecos en la agenda los días flojos.'],
      dolorShort: 'son clientes nuevos que no llegan a reservar',
      beneficio: ['Con la ficha completa y activa, aparecen mejor en el mapa y el que los encuentra tiene todo para reservar en el momento.'],
      beneficioShort: 'Con la ficha completa, el que los encuentra reserva en el momento',
    },
    web: {
      dolor: ['Para una barbería es menos gente nueva que llega a reservar, justo la que más cuesta conseguir.'],
      dolorShort: 'son clientes nuevos que no llegan',
      beneficio: ['Con una página simple, con servicios, precios y un botón para reservar o escribir, el que los busca pasa directo a sacar turno.'],
      beneficioShort: 'Con una página simple y un botón para reservar, el que los busca pasa directo a sacar turno',
    },
  },
  estetica: {
    contacto: {
      dolor: ['En estética, la persona que consulta suele estar comparando precios con dos o tres lugares: el turno se lo lleva el que responde primero.'],
      dolorShort: 'el turno se lo lleva el que responde primero',
      beneficio: ['Con un WhatsApp a mano y respuestas automáticas para lo de siempre (precios, horarios, turnos), más consultas terminan en turno.'],
      beneficioShort: 'Con un WhatsApp a mano y respuestas rápidas, más consultas terminan en turno',
    },
    reservas: {
      dolor: ['Eso se traduce en turnos que no se toman, días con baja ocupación y horarios vacíos que no se recuperan.'],
      dolorShort: 'son turnos perdidos y días con baja ocupación',
      beneficio: ['Con reservas online y recordatorios, la agenda se completa sola y bajan las ausencias.'],
      beneficioShort: 'Con reservas online y recordatorios, la agenda se completa sola',
    },
    confianza: {
      dolor: ['Y quien compara precios entre varios lugares elige casi siempre el que le transmite más confianza, aunque no sea el más barato.'],
      dolorShort: 'la clienta elige al que le transmite más confianza',
      beneficio: ['Con más reseñas y respuestas cuidadas, dejan de competir solo por precio.'],
      beneficioShort: 'Con reseñas cuidadas, dejan de competir solo por precio',
    },
    visibilidad: {
      dolor: ['Eso hace que, al comparar, los elijan menos, y se nota en días con baja ocupación.'],
      dolorShort: 'los eligen menos al comparar',
      beneficio: ['Con la ficha completa y fotos de trabajos reales, el que compara ve por qué elegirlos a ustedes.'],
      beneficioShort: 'Con la ficha completa y fotos de trabajos, el que compara los elige a ustedes',
    },
    web: {
      dolor: ['Así, el que compara no ve lo que los diferencia y la decisión termina pasando solo por el precio.'],
      dolorShort: 'la decisión termina pasando solo por el precio',
      beneficio: ['Con una página clara de servicios y un botón para reservar, el interés se convierte en turno.'],
      beneficioShort: 'Con una página clara y un botón para reservar, el interés se convierte en turno',
    },
  },
  gastronomia: {
    contacto: {
      dolor: ['En un restaurante esas son consultas que no se convierten: pedidos que se hacen en otro lado y reservas que nunca llegan.'],
      dolorShort: 'son pedidos y reservas que se van a otro lado',
      beneficio: ['Con un WhatsApp a un toque y respuestas automáticas para lo de siempre, más consultas terminan en pedido o en mesa reservada.'],
      beneficioShort: 'Con un WhatsApp a un toque, más consultas terminan en pedido o reserva',
    },
    reservas: {
      dolor: ['Eso se traduce en reservas que no se concretan y mesas vacías en horarios que podrían estar llenos.'],
      dolorShort: 'son reservas que no se concretan y mesas vacías',
      beneficio: ['Con reservas online a cualquier hora, las mesas se reservan solas, incluso con el local cerrado.'],
      beneficioShort: 'Con reservas online, las mesas se reservan solas a cualquier hora',
    },
    confianza: {
      dolor: ['Y el que elige dónde comer compara rápido: si algo le genera dudas, esa mesa la ocupa otro.'],
      dolorShort: 'esa mesa la ocupa otro',
      beneficio: ['Con reseñas recientes y respondidas, la ficha convence antes de que lleguen.'],
      beneficioShort: 'Con reseñas recientes y respondidas, la ficha convence sola',
    },
    visibilidad: {
      dolor: ['Para un restaurante eso significa menos gente que se decide a ir y más mesas vacías los días flojos.'],
      dolorShort: 'son mesas vacías los días flojos',
      beneficio: ['Con la ficha completa, la carta y fotos actualizadas, el que está decidiendo dónde comer los elige más.'],
      beneficioShort: 'Con la ficha completa y fotos actualizadas, los eligen más',
    },
    web: {
      dolor: ['Así se pierden pedidos y reservas de gente que ya estaba interesada.'],
      dolorShort: 'son pedidos y reservas que se pierden',
      beneficio: ['Con una página simple con carta, horarios y un botón para pedir o reservar, el interés se convierte en mesa o pedido.'],
      beneficioShort: 'Con una página con carta y botón para pedir, el interés se convierte en venta',
    },
    carta: {
      dolor: ['Cada persona que se va sin ver la carta es una mesa o un pedido menos.'],
      dolorShort: 'es una mesa o un pedido menos',
      beneficio: ['Con la carta online y visible en Google, el que está decidiendo tiene todo a mano para elegirlos.'],
      beneficioShort: 'Con la carta visible en Google, el que está decidiendo los elige',
    },
  },
  gimnasio: {
    contacto: {
      dolor: ['En un gimnasio, el que está por anotarse consulta en dos o tres lugares: si no puede escribir fácil, ese futuro socio ni siquiera llega a consultar.'],
      dolorShort: 'son futuros socios que ni siquiera consultan',
      beneficio: ['Con un WhatsApp a mano y respuestas automáticas sobre precios, horarios y clase de prueba, más consultas se convierten en socios.'],
      beneficioShort: 'Con un WhatsApp a mano y respuestas rápidas, más consultas se convierten en socios',
    },
    reservas: {
      dolor: ['Eso hace que se desaprovechen clases de prueba y cupos que podrían convertirse en socios nuevos.'],
      dolorShort: 'son clases de prueba desaprovechadas',
      beneficio: ['Con reservas online para clases y pruebas gratuitas, el interesado se anota en el momento y llega con el compromiso tomado.'],
      beneficioShort: 'Con reservas online para la clase de prueba, el interesado se anota en el momento',
    },
    confianza: {
      dolor: ['Y el que elige gimnasio compara mucho: si no encuentra motivos para confiar, se anota en el de al lado.'],
      dolorShort: 'el socio se anota en el de al lado',
      beneficio: ['Con reseñas recientes y respondidas, se diferencian de la competencia sin bajar precios.'],
      beneficioShort: 'Con reseñas recientes, se diferencian sin bajar precios',
    },
    visibilidad: {
      dolor: ['Para un gimnasio eso es poca diferenciación: el futuro socio que compara no ve por qué elegirlos y se anota en otro.'],
      dolorShort: 'el futuro socio no ve por qué elegirlos',
      beneficio: ['Con la ficha completa, fotos del lugar y novedades, el que busca ve lo que los hace distintos y se anima a probar.'],
      beneficioShort: 'Con la ficha completa y fotos del lugar, se animan a probar',
    },
    web: {
      dolor: ['Así, potenciales socios no encuentran planes, horarios ni la clase de prueba, y se anotan en otro lado.'],
      dolorShort: 'son socios que se anotan en otro lado',
      beneficio: ['Con una página con planes, horarios y un botón para pedir la clase de prueba, el interés se convierte en socio.'],
      beneficioShort: 'Con una página con planes y clase de prueba, el interés se convierte en socio',
    },
  },
  taller: {
    contacto: {
      dolor: ['En un taller, el cliente suele llamar a varios antes de decidir: si con ustedes no lo logra rápido, el auto termina en otro taller.'],
      dolorShort: 'el auto termina en otro taller',
      beneficio: ['Con un WhatsApp directo y respuestas rápidas, son ustedes los que reciben la consulta primero.'],
      beneficioShort: 'Con un WhatsApp directo, la consulta les llega primero a ustedes',
    },
    reservas: {
      dolor: ['Eso hace que consultas y turnos se pierdan entre llamadas, y que el cliente elija al que le da fecha más rápido.'],
      dolorShort: 'el cliente elige al que le da fecha más rápido',
      beneficio: ['Con turnos online, el cliente agenda en el momento y ustedes organizan mejor la semana.'],
      beneficioShort: 'Con turnos online, el cliente agenda en el momento',
    },
    confianza: {
      dolor: ['Y en un taller la confianza lo es todo: el que no conoce a nadie elige por lo que lee en Google y llama a otro.'],
      dolorShort: 'el cliente nuevo llama a otro taller',
      beneficio: ['Con reseñas recientes y respondidas, el cliente nuevo llega confiando antes de hablar con ustedes.'],
      beneficioShort: 'Con reseñas recientes, el cliente nuevo llega confiando',
    },
    visibilidad: {
      dolor: ['Eso dificulta generar confianza con el que todavía no los conoce, que termina llamando a varios talleres y quedándose con otro.'],
      dolorShort: 'el cliente nuevo termina llamando a otros talleres',
      beneficio: ['Con la ficha completa (horarios, fotos, servicios), el que busca un taller los elige con más seguridad.'],
      beneficioShort: 'Con la ficha completa, el que busca un taller los elige con seguridad',
    },
    web: {
      dolor: ['Así cuesta generar confianza con el cliente nuevo, que llama a varios talleres y se queda con otro.'],
      dolorShort: 'el cliente nuevo se queda con otro taller',
      beneficio: ['Con una página con servicios, trabajos y un botón para consultar, llegan consultas más decididas.'],
      beneficioShort: 'Con una página con servicios y botón para consultar, llegan consultas más decididas',
    },
  },
  salud: {
    contacto: {
      dolor: ['En un consultorio, el paciente que no logra comunicarse rápido saca turno en otro lado.'],
      dolorShort: 'el paciente saca turno en otro lado',
      beneficio: ['Con WhatsApp y respuestas automáticas para turnos y consultas frecuentes, se pierden menos pacientes y se libera tiempo de recepción.'],
      beneficioShort: 'Con WhatsApp y respuestas automáticas, se pierden menos pacientes',
    },
    reservas: {
      dolor: ['Eso se traduce en turnos sin tomar y una agenda con huecos, además del tiempo de recepción coordinando por teléfono.'],
      dolorShort: 'son turnos sin tomar y huecos en la agenda',
      beneficio: ['Con turnos online y recordatorios, la agenda se completa y bajan las ausencias.'],
      beneficioShort: 'Con turnos online y recordatorios, la agenda se completa',
    },
    confianza: {
      dolor: ['Y para elegir un profesional, la gente se guía mucho por las opiniones: si duda, consulta con otro.'],
      dolorShort: 'el paciente consulta con otro',
      beneficio: ['Con reseñas recientes y respondidas, el paciente nuevo llega con confianza.'],
      beneficioShort: 'Con reseñas recientes, el paciente nuevo llega con confianza',
    },
    visibilidad: {
      dolor: ['Eso hace que menos pacientes nuevos los elijan cuando comparan opciones cercanas.'],
      dolorShort: 'son pacientes nuevos que eligen otro lugar',
      beneficio: ['Con la ficha completa, el que busca un profesional cerca encuentra todo para sacar turno.'],
      beneficioShort: 'Con la ficha completa, el que busca encuentra todo para sacar turno',
    },
    web: {
      dolor: ['Así, pacientes que podrían sacar turno no encuentran la información y eligen otro consultorio.'],
      dolorShort: 'son pacientes que eligen otro consultorio',
      beneficio: ['Con una página clara de especialidades y turnos, el interés se convierte en consulta.'],
      beneficioShort: 'Con una página clara y turnos, el interés se convierte en consulta',
    },
  },
  general: {
    contacto: {
      dolor: ['Cada consulta que no llega es una venta que se lleva otro, y no hay forma de saber cuántas fueron.'],
      dolorShort: 'son ventas que se lleva otro',
      beneficio: ['Con un canal directo y respuestas rápidas, más de esas personas terminan comprando o reservando con ustedes.'],
      beneficioShort: 'Con un canal directo y respuestas rápidas, esas consultas se convierten en ventas',
    },
    reservas: {
      dolor: ['Eso se traduce en reservas que no se concretan y horarios que quedan vacíos.'],
      dolorShort: 'son reservas que no se concretan',
      beneficio: ['Con reservas online a cualquier hora, el cliente decide y reserva en el momento, sin esperar respuesta.'],
      beneficioShort: 'Con reservas online, el cliente reserva en el momento',
    },
    confianza: {
      dolor: ['Y el que compara opciones elige al que le transmite más confianza: cada vez que duda, es una venta que se lleva otro, aunque no sea mejor.'],
      dolorShort: 'el cliente elige al que le transmite más confianza',
      beneficio: ['Con reseñas recientes y respondidas, el negocio empieza a ganar esas comparaciones.'],
      beneficioShort: 'Con reseñas recientes y respondidas, empiezan a ganar esas comparaciones',
    },
    visibilidad: {
      dolor: ['Eso significa menos clientes nuevos que se animan a elegirlos frente a la competencia.'],
      dolorShort: 'son clientes nuevos que eligen a la competencia',
      beneficio: ['Con la ficha completa y activa, aparecen mejor y el que los encuentra tiene motivos para elegirlos.'],
      beneficioShort: 'Con la ficha completa y activa, el que los encuentra los elige',
    },
    web: {
      dolor: ['Así se pierden consultas de gente que ya estaba interesada.'],
      dolorShort: 'son consultas de gente interesada que se pierden',
      beneficio: ['Con una página simple con lo importante y un botón para escribir, el interés se convierte en consulta.'],
      beneficioShort: 'Con una página simple y un botón para escribir, el interés se convierte en consulta',
    },
  },
};

export function painFor(group: RubroGroup, cat: SalesCategory, findingId?: string): Pain {
  const base = PAINS[group][cat] ?? PAINS[group].visibilidad ?? PAINS.general[cat] ?? PAINS.general.visibilidad!;
  const own = findingId ? ANGLES[findingId]?.pain : undefined;
  // Las oportunidades con dolor propio parten de la pérdida directa del rubro (consultas que no llegan).
  return own ? own(PAINS[group].contacto ?? PAINS.general.contacto!) : base;
}
