import type { AuditResult, BusinessProfile, SalesArgument, ServiceId, ServiceRecommendation, WebsiteAnalysis } from '../domain/types.js';

/**
 * Mensajes de WhatsApp para prospección, en tono argentino, cercano y directo.
 *
 * Reglas de estilo:
 *  - Arrancar con algo concreto y verificable que se vio en la ficha (con su número real).
 *  - Una sola idea de valor, dicha en palabras simples (nada de "soluciones integrales").
 *  - Cierre con un pedido chico y fácil de aceptar (un audio, 10 minutos, "te paso lo que vi").
 *  - Vos para la persona, "ustedes" para el negocio. Sin emojis de más, sin "sin compromiso".
 *  - Variantes elegidas de forma estable por negocio: dos prospectos no reciben el mismo texto.
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

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pick = <T>(arr: readonly T[], seed: string, salt: string): T => arr[hash(seed + salt) % arr.length]!;

/** Lo que el cliente de cada rubro suele consultar (para hablar de su negocio, no en abstracto). */
const PREGUNTA_TIPICA: Record<string, string> = {
  gastronomia: 'si hay mesa o hasta qué hora cocinan',
  salud: 'si atienden con su obra social o cuándo hay turno',
  belleza: 'precios o si hay turno para el sábado',
  fitness: 'horarios de clases o cuánto sale la cuota',
  alojamiento: 'disponibilidad y precios para el finde',
  automotor: 'cuánto sale un service o si los pueden atender esta semana',
  profesional: 'cómo es la primera consulta y cuánto sale',
  educacion: 'horarios, precios e inscripción',
  hogar: 'si cubren su zona y cuánto puede salir',
  comercio: 'si tienen stock o hasta qué hora abren',
};
const preguntaTipica = (id: string) => PREGUNTA_TIPICA[id] ?? 'horarios o precios';

/** Observaciones concretas por tipo de problema, escritas como las diría una persona. */
type Hook = (i: MessageInput) => string | undefined;
const HOOKS: Record<string, Hook> = {
  'maps-unclaimed': (i) => `vi que la ficha de ${i.name} en Google todavía figura como no reclamada. Eso quiere decir que cualquiera puede cambiarles el horario o el teléfono, y ustedes no pueden responder las reseñas`,
  'maps-closed': (i) => `en Google Maps ${i.name} figura como cerrado permanentemente. Si siguen abiertos, hoy prácticamente nadie que busque en la zona los está encontrando`,
  'rep-very-few-reviews': (i) => `vi que en Google tienen ${i.profile?.reviewCount ?? 'muy pocas'} reseñas. Cuando alguien compara opciones en el mapa, casi siempre elige al que tiene más`,
  'rep-few-reviews': (i) => `vi que en Google tienen ${i.profile?.reviewCount} reseñas. Los que aparecen primero en ${i.verticalLabel.toLowerCase()} por la zona suelen andar arriba de 100, y eso pesa mucho cuando la gente compara`,
  'rep-stale-reviews': (i) => `la última reseña que tienen en Google es de hace unos ${i.metrics?.daysSinceLastReview ?? 'varios'} días. Google premia a los que reciben reseñas seguido y la gente desconfía cuando son viejas`,
  'rep-negative-unanswered': () => `tienen algunas reseñas negativas recientes sin respuesta. Son justamente las que más lee el que está dudando`,
  'rep-low-rating': (i) => `están con ${String(i.profile?.rating ?? '').replace('.', ',')} estrellas en Google. Mucha gente directamente descarta los lugares que están por debajo de 4`,
  'rep-no-responses': () => `casi ninguna reseña tiene respuesta. Responderlas no lleva tanto tiempo y cambia bastante la imagen del lugar`,
  'web-none': (i) => `busqué ${i.name} y no encontré una web propia. El que los encuentra en Maps no tiene dónde ver ${i.verticalId === 'gastronomia' ? 'la carta o los precios' : 'qué hacen, precios o cómo contactarlos'} más allá de la ficha`,
  'web-social-only': () => `en Google tienen puesto el link a una red social en vez de una web propia. Funciona, pero no aparece en las búsquedas de Google y mucha gente no tiene cuenta para verla bien`,
  'web-down': (i) => `entré a la web que figura en Google y no carga. Todo el que toca "Sitio web" desde la ficha de ${i.name} se encuentra con un error`,
  'web-not-mobile': () => `entré a la web desde el celu y no está adaptada: hay que hacer zoom para leer. Casi todo el que llega desde Maps entra desde el teléfono`,
  'web-slow': (i) => `la web tarda unos ${i.website?.loadTimeMs ? Math.round(i.website.loadTimeMs / 1000) : 'varios'} segundos en cargar. Desde el celular, a los 3 segundos la mayoría ya se fue`,
  'web-outdated': () => `la web quedó medio vieja y no le hace justicia al lugar. Es lo primero que ve alguien que no los conoce`,
  'web-no-https': () => `la web aparece como "No segura" en el navegador. Es un detalle, pero espanta a más gente de la que uno cree`,
  'wa-not-visible': () => `no encontré un WhatsApp directo ni en la ficha ni en la web. Hoy mucha gente prefiere escribir antes que llamar`,
  'wa-no-auto-reply': (i) => `si alguien les escribe un domingo a la noche preguntando ${preguntaTipica(i.verticalId)}, seguramente quede sin respuesta hasta el lunes, y para ese momento ya le contestó otro`,
  'booking-none': (i) => `para ${i.verticalId === 'gastronomia' ? 'reservar mesa' : 'sacar turno'} hay que llamar o escribir. Mucha gente hoy prefiere hacerlo online, a cualquier hora`,
  'web-no-booking': (i) => `en la web no hay forma de ${i.verticalId === 'gastronomia' ? 'reservar' : 'sacar turno'} online. Mucha gente prefiere resolverlo ahí mismo sin llamar`,
  'maps-no-hours': () => `en Google no figuran los horarios. Ante la duda, la gente va a otro lugar que sí dice "Abierto ahora"`,
  'maps-few-photos': (i) => `la ficha tiene solo ${i.profile?.photoCount} fotos. Es lo primero que mira la gente antes de decidir si va`,
  'maps-no-description': () => `la ficha de Google no tiene descripción. Es un espacio gratis para contar qué los diferencia y casi nadie lo aprovecha bien`,
  'maps-no-menu': () => `en Google no aparece la carta. Es de lo más buscado en la ficha de un restaurante`,
};

/** Cómo se dice cada servicio en una charla (sin nombres comerciales). */
const SERVICE_PLAIN: Record<ServiceId, string> = {
  'maps-optimization': 'dejarles la ficha de Google bien armada (fotos, descripción, horarios, categorías) para que aparezcan antes',
  'qr-reviews': 'armar un sistema simple para que los clientes contentos les dejen reseña, y responder todas a tiempo',
  website: 'hacerles una web simple y rápida, pensada para el celular, con el WhatsApp a un toque',
  'whatsapp-ai-bot': 'ponerles un asistente en WhatsApp que conteste al toque las preguntas de siempre, a cualquier hora',
  'support-automation': 'automatizar las respuestas que se repiten para que no se les escape ninguna consulta',
  'booking-system': 'armarles un sistema para que los clientes reserven o saquen turno online, sin llamar',
  'admin-dashboard': 'armarles un panel simple para ver consultas, reseñas y reservas en un solo lugar',
};

/** Observaciones de los problemas principales, con el problema del que salen. */
function hooksFor(i: MessageInput, max = 3): Array<{ text: string; problem: SalesArgument }> {
  const out: Array<{ text: string; problem: SalesArgument }> = [];
  for (const p of i.problems) {
    const h = HOOKS[p.findingId]?.(i);
    if (h && !out.some((o) => o.text === h)) out.push({ text: h, problem: p });
    if (out.length === max) break;
  }
  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Arma los tres mensajes. `variant` = 0 es la versión de siempre del prospecto; cada número
 * mayor genera otra versión (otro saludo, otro problema de arranque, otra oferta, otro cierre),
 * para el botón "Otra versión". Siempre usa solo problemas reales detectados en la ficha.
 */
export function composeMessages(i: MessageInput, seller: Seller, variant = 0): ProspectMessages {
  const v = Math.max(0, Math.floor(variant) || 0);
  const seed = v ? `${i.seed}#${v}` : i.seed;
  // Con variante > 0 se suman frases alternativas a cada parte del mensaje.
  const opts = <T>(base: readonly T[], extra: readonly T[]): readonly T[] => (v ? [...base, ...extra] : base);
  const me = seller.sellerName?.trim() || '[tu nombre]';
  const city = seller.sellerCity?.trim();
  const business = seller.sellerBusiness?.trim();
  const link = sellerLinkUrl(seller.sellerLink);

  // Problemas de arranque: en otras versiones se rota cuál de los principales abre el mensaje.
  const all = hooksFor(i, v ? 4 : 3);
  const shift = v && all.length > 1 ? v % Math.min(all.length, 3) : 0;
  const lead = [...all.slice(shift), ...all.slice(0, shift)];
  const hooks = lead.map((h) => h.text);
  const main = hooks[0] ?? `estuve mirando cómo aparece ${i.name} en Google y vi un par de cosas que les están haciendo perder consultas`;
  const second = hooks[1];

  // Una sola propuesta de valor: el servicio que mejor encaja. En otras versiones, el que
  // resuelve el problema con el que arranca el mensaje (así la oferta siempre tiene sentido).
  const candidates = i.services.filter((s) => s.priority !== 'baja');
  const leadService = v ? lead[0]?.problem.serviceIds.find((id) => id in SERVICE_PLAIN) : undefined;
  const offerId = leadService ?? candidates[0]?.id;
  const offer = offerId ? SERVICE_PLAIN[offerId] : 'mejorar cómo aparecen en Google y cómo responden las consultas';

  const saludo = pick(opts(['Hola, ¿cómo va?', 'Hola, ¿qué tal?', 'Buenas, ¿cómo andan?'], ['Hola, buen día.', 'Hola, ¿todo bien?']), seed, 's');
  const quien = pick(opts([`¿Hablo con ${i.name}?`, `¿Este es el WhatsApp de ${i.name}?`], [`¿Me comunico con ${i.name}?`]), seed, 'q');
  const intro = seller.sellerIntro?.trim().replace(/([^.!?])$/, '$1.')
    || `${business ? `Desde ${business} trabajo` : 'Trabajo'} con negocios de la zona en todo lo que es Google Maps, reseñas y atención por WhatsApp.`;
  const presentacion = pick(opts([`Soy ${me}${city ? `, de ${city}` : ''}. ${intro}`], [`Te escribe ${me}${city ? `, de ${city}` : ''}. ${intro}`]), seed, 'p');
  const motivo = pick(
    opts([`Te escribo porque ${main}.`], [`Estuve mirando cómo aparece ${i.name} en Google: ${main}.`, `Te cuento algo que vi: ${main}.`]),
    seed, 'm',
  );
  const ademas = second ? pick(opts([` Además, ${second}.`], [` También ${second}.`, ` Y otra cosa: ${second}.`]), seed, 'a') : '';
  const arreglo = pick(
    opts(['Se resuelve más fácil de lo que parece.', 'Tiene arreglo y no es complicado.'], ['Es algo que se acomoda rápido.', 'La buena noticia es que tiene solución y no lleva mucho tiempo.']),
    seed, 'r',
  );
  const dedico = pick(opts([`Justamente me dedico a esto: puedo ${offer}.`], [`Yo me dedico a eso: puedo ${offer}.`, `A esto me dedico, y lo que haría es ${offer}.`]), seed, 'o');
  const cierre = pick(
    opts(
      [
        '¿Te puedo mandar un audio de 2 minutos contándote lo que vi?',
        '¿Te paso por acá lo que encontré? Son 3 o 4 cosas puntuales.',
        'Si te sirve, te muestro en 10 minutos cómo quedaría. ¿Te queda bien en algún momento de esta semana?',
      ],
      ['¿Te puedo llamar 5 minutos mañana y te cuento?', '¿Querés que te mande un ejemplo de cómo quedaría para ustedes?'],
    ),
    seed, 'c',
  );

  const primerContacto = [
    `${saludo} ${quien}`,
    presentacion,
    `${motivo}${ademas}`,
    `${arreglo} ${dedico}${link ? ` Podés ver lo que hago en ${link}` : ''}`,
    cierre,
  ].join('\n\n');

  const primerContactoCorto = [
    `${saludo} Soy ${me}${business ? `, de ${business}` : ''}. Trabajo con negocios en Google Maps y WhatsApp.`,
    `${capitalize(main)}.`,
    pick(opts(['¿Te cuento cómo lo resolvería?', '¿Te interesa que te muestre cómo se arregla?'], ['¿Querés que te pase cómo lo resolvería?', '¿Te sirve que te cuente más?']), seed, 'k'),
  ].join('\n\n');

  const dato = second ?? hooks[2] ?? `hay ${i.problems.length} cosas puntuales en la ficha y la web que se pueden mejorar rápido`;
  const seguimiento = [
    pick(opts(['Hola, ¿cómo va?', 'Buenas, ¿qué tal?'], ['Hola de nuevo, ¿cómo va?']), seed, 'f'),
    pick(
      opts([`Te escribí hace unos días por lo de ${i.name} en Google. Te dejo un dato más: ${dato}.`], [`Retomo lo que te comenté de ${i.name} en Google. Un dato más que vi: ${dato}.`]),
      seed, 'g',
    ),
    pick(
      opts(
        ['Si te interesa lo vemos cuando puedas, y si no es el momento, no pasa nada: avisame y no te escribo más.'],
        ['Si querés lo charlamos 10 minutos esta semana; y si no es buen momento, avisame y quedamos ahí.'],
      ),
      seed, 'z',
    ),
  ].join('\n\n');

  return { primerContacto, primerContactoCorto, seguimiento };
}

export const MESSAGE_KEYS = ['primerContacto', 'primerContactoCorto', 'seguimiento'] as const;
export type MessageKey = (typeof MESSAGE_KEYS)[number];

/** Mensajes para un prospecto guardado en el CRM. */
export function buildMessages(
  p: { id: string; name: string; verticalId: string | null; verticalLabel: string | null; problems: SalesArgument[]; services: ServiceRecommendation[]; analysis?: { profile?: BusinessProfile; website?: WebsiteAnalysis; audit?: AuditResult } },
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
    },
    seller,
    variant,
  );
}
