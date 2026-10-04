import type { AuditContext } from '../auditor/context.js';
import type { AuditArea, Finding, SalesArgument, SalesImpact, ServiceId, Severity } from '../domain/types.js';
import { SERVICE_CATALOG } from './services.js';

/**
 * Convierte cada problema detectado en un argumento comercial:
 *   Problema detectado → Impacto estimado → Motivo → Servicio recomendado → Beneficio.
 *
 * Los textos usan los datos reales de la ficha (reseñas, calificación, rubro, tiempos de carga…)
 * para que se puedan usar tal cual en una llamada, un WhatsApp o una reunión.
 * Para ajustar un argumento basta con editar su entrada en ARGUMENTS.
 */

interface ArgumentTemplate {
  problem: (c: AuditContext, f: Finding) => string;
  impact: SalesImpact | ((c: AuditContext) => SalesImpact);
  reason: (c: AuditContext, f: Finding) => string;
  services: ServiceId[];
  benefit: (c: AuditContext) => string;
}

// ---------- Helpers de redacción ----------
const rubro = (c: AuditContext) => c.vertical.label.toLowerCase();
const nombre = (c: AuditContext) => c.profile.name ?? 'el negocio';
const reviews = (c: AuditContext) => c.profile.reviewCount ?? 0;
const rating = (c: AuditContext) => (c.profile.rating !== undefined ? c.profile.rating.toFixed(1).replace('.', ',') : '—');
const secs = (c: AuditContext) => (c.website?.loadTimeMs !== undefined ? (c.website.loadTimeMs / 1000).toFixed(1).replace('.', ',') : '?');
const pct = (n: number | undefined) => `${Math.round((n ?? 0) * 100)}%`;
/** Qué busca/consulta el cliente típico del rubro antes de decidir. */
const queBusca = (c: AuditContext): string =>
  ({
    gastronomia: 'la carta, los precios, fotos de los platos y si hay mesa',
    salud: 'especialidades, profesionales, obras sociales o seguros y cómo pedir turno',
    belleza: 'servicios, precios, fotos de trabajos anteriores y disponibilidad',
    fitness: 'horarios de clases, tarifas e instalaciones',
    alojamiento: 'fotos de las habitaciones, precios y disponibilidad',
    automotor: 'servicios, presupuestos y tiempos de entrega',
    profesional: 'servicios, experiencia y cómo pedir una consulta',
    educacion: 'cursos, horarios, precios e inscripciones',
    hogar: 'zonas de cobertura, servicios, precios orientativos y urgencias',
    comercio: 'productos, stock, precios y formas de pago',
  })[c.vertical.id] ?? 'servicios, horarios, fotos, precios y formas de contacto';

const ARGUMENTS: Record<string, ArgumentTemplate> = {
  // ================= GOOGLE MAPS =================
  'maps-unclaimed': {
    problem: () => 'La ficha de Google Maps no está reclamada por el dueño.',
    impact: 'Alto',
    reason: (c) =>
      `Google muestra "¿Es el propietario de este negocio?" en la ficha de ${nombre(c)}. Mientras no esté reclamada, cualquier usuario puede sugerir cambios (horarios, teléfono, incluso marcarla como cerrada), el negocio no puede responder reseñas ni publicar novedades, y Google la considera una ficha poco cuidada al ordenar resultados.`,
    services: ['maps-optimization'],
    benefit: () => 'Control total de la ficha: datos siempre correctos, posibilidad de responder reseñas y publicar, y mejor posicionamiento frente a fichas no gestionadas.',
  },
  'maps-closed': {
    problem: () => 'La ficha figura como "cerrada permanentemente".',
    impact: 'Alto',
    reason: () =>
      'Google oculta o desaconseja las fichas cerradas: prácticamente nadie que busque el servicio en la zona llegará al negocio, aunque siga abierto. Cada día en este estado son clientes que van directamente a la competencia.',
    services: ['maps-optimization'],
    benefit: () => 'Recuperar de inmediato la visibilidad en Google Maps y el flujo de llamadas y visitas que hoy se está perdiendo.',
  },
  'maps-no-category': {
    problem: () => 'La ficha no tiene una categoría principal visible.',
    impact: 'Alto',
    reason: (c) =>
      `La categoría es el factor que más pesa para que Google muestre la ficha en búsquedas como "${c.vertical.id === 'general' ? 'negocio' : rubro(c)} cerca de mí". Sin ella, el negocio queda fuera de la mayoría de búsquedas del rubro.`,
    services: ['maps-optimization'],
    benefit: () => 'Aparecer en las búsquedas de su rubro en la zona, que son las de clientes con intención real de compra.',
  },
  'maps-generic-category': {
    problem: (c) => `La categoría principal ("${c.profile.category}") es demasiado genérica.`,
    impact: 'Medio-Alto',
    reason: (c) =>
      `Quien busca algo concreto en Google Maps escribe el servicio exacto, no "${c.profile.category}". Con una categoría genérica, la ficha compite peor que negocios con categorías específicas y pierde búsquedas de clientes listos para comprar.`,
    services: ['maps-optimization'],
    benefit: () => 'Más apariciones en búsquedas específicas del rubro, con clientes que ya saben lo que quieren.',
  },
  'maps-no-description': {
    problem: () => 'La ficha no tiene descripción del negocio.',
    impact: 'Medio',
    reason: (c) =>
      `La descripción es el único espacio de la ficha donde el negocio explica, con sus palabras, por qué elegirlo. Sin ella, quien compara opciones de ${rubro(c)} no encuentra ningún motivo diferencial y se queda solo con las estrellas y la distancia. Además, se desaprovechan palabras clave que ayudan a posicionar.`,
    services: ['maps-optimization'],
    benefit: () => 'Una ficha que vende sola: propuesta de valor clara, servicios destacados y palabras clave que mejoran el posicionamiento.',
  },
  'maps-poor-description': {
    problem: (c) => `La descripción es muy breve (${c.profile.description?.length ?? 0} de 750 caracteres posibles).`,
    impact: 'Medio',
    reason: (c) =>
      `Con tan poco texto no se explican los servicios, la experiencia ni lo que diferencia a ${nombre(c)}. Es espacio gratuito que la competencia sí aprovecha para convencer y para posicionar con palabras clave.`,
    services: ['maps-optimization'],
    benefit: () => 'Descripción profesional que convence al indeciso y ayuda a aparecer en más búsquedas.',
  },
  'maps-no-hours': {
    problem: () => 'No tiene horarios publicados en Google Maps.',
    impact: 'Alto',
    reason: () =>
      'Ante la duda de si el local está abierto, la mayoría de los usuarios elige otro negocio que sí muestra "Abierto ahora". Google además prioriza las fichas con horarios en búsquedas del tipo "abierto ahora cerca de mí".',
    services: ['maps-optimization'],
    benefit: () => 'Aparecer en búsquedas de "abierto ahora" y eliminar la duda que hace que el cliente elija a la competencia.',
  },
  'maps-incomplete-hours': {
    problem: (c) => `Los horarios están incompletos (solo ${Object.keys(c.profile.hours?.days ?? {}).length} de 7 días).`,
    impact: 'Medio',
    reason: () =>
      'Los días sin horario generan dudas: el cliente no sabe si el negocio abre, y Google puede mostrar la ficha como "horario no disponible". Es una fuente habitual de llamadas perdidas y visitas frustradas.',
    services: ['maps-optimization'],
    benefit: () => 'Información clara todos los días de la semana (incluidos festivos), sin clientes que se acercan y encuentran cerrado.',
  },
  'maps-no-phone': {
    problem: () => 'La ficha no muestra un teléfono de contacto.',
    impact: 'Alto',
    reason: () =>
      'La mayoría de las visitas a Google Maps son desde el celular, y el botón "Llamar" es una de las acciones más usadas. Sin teléfono, el cliente que quiere consultar algo en el momento no tiene cómo hacerlo y pasa al siguiente resultado.',
    services: ['maps-optimization'],
    benefit: () => 'Recibir llamadas directas desde Google Maps con un solo toque.',
  },
  'maps-no-address': {
    problem: () => 'La dirección no es visible en la ficha.',
    impact: 'Medio',
    reason: () =>
      'Sin dirección, Google no puede ofrecer "Cómo llegar" y el negocio pierde peso en las búsquedas por cercanía, que son la base de Google Maps.',
    services: ['maps-optimization'],
    benefit: () => 'Más solicitudes de ruta y mejor posición en búsquedas cercanas.',
  },
  'maps-few-photos': {
    problem: (c) => `Tiene muy pocas fotos en Google Maps (${c.profile.photoCount ?? 0}${c.profile.photoCountIsEstimate ? ' visibles' : ''}).`,
    impact: 'Alto',
    reason: (c) =>
      `Las fotos son lo primero que mira el cliente al comparar negocios de ${rubro(c)}: quiere ver ${queBusca(c)}. Una ficha con pocas fotos transmite poca actividad y desconfianza, y Google reporta que las fichas con fotos reciben bastantes más solicitudes de ruta y clics al sitio web que las que no tienen.`,
    services: ['maps-optimization'],
    benefit: (c) => `Una galería profesional de ${c.vertical.recommendedPhotos}+ fotos que muestra el negocio por dentro y genera confianza antes de la primera visita.`,
  },
  'maps-low-photos': {
    problem: (c) => `Tiene pocas fotos para su rubro (${c.profile.photoCount ?? 0}; se recomiendan ${c.vertical.recommendedPhotos}+).`,
    impact: 'Bajo',
    reason: (c) =>
      `Los negocios de ${rubro(c)} mejor posicionados en la zona suelen tener muchas más fotos y renovarlas con frecuencia. Fotos actuales demuestran que el negocio está activo y ayudan a que el cliente se imagine la experiencia.`,
    services: ['maps-optimization'],
    benefit: () => 'Ficha más atractiva que la de la competencia y con señales de actividad que Google valora.',
  },
  'maps-no-posts': {
    problem: () => 'No publica novedades en Google Maps.',
    impact: 'Medio',
    reason: () =>
      'Las publicaciones (ofertas, novedades, eventos) aparecen dentro de la ficha y son una señal de actividad para Google. Sin ellas, la ficha parece abandonada y se pierde un canal gratuito para promocionar ofertas justo cuando el cliente está decidiendo.',
    services: ['maps-optimization'],
    benefit: () => 'Un canal gratuito de promoción dentro de Google y una ficha que Google percibe como activa.',
  },
  'maps-stale-posts': {
    problem: (c) => `La última publicación en Google Maps tiene ~${c.metrics.daysSinceLastPost ?? '?'} días.`,
    impact: 'Bajo',
    reason: () => 'Publicaciones viejas transmiten que el negocio no actualiza su información, y pierden su efecto como señal de actividad.',
    services: ['maps-optimization'],
    benefit: () => 'Presencia constante con publicaciones periódicas sin que el dueño tenga que ocuparse.',
  },
  'maps-few-attributes': {
    problem: () => 'Tiene pocos atributos y servicios cargados en la ficha.',
    impact: 'Bajo',
    reason: (c) =>
      `Los atributos (formas de pago, accesibilidad, servicios ofrecidos, opciones como "${c.vertical.bookingRelevant ? 'con cita previa' : 'entrega a domicilio'}") se usan como filtros en las búsquedas. Si no están cargados, la ficha no aparece cuando el usuario filtra.`,
    services: ['maps-optimization'],
    benefit: () => 'Aparecer también en búsquedas filtradas y responder dudas antes de que el cliente tenga que preguntar.',
  },
  'maps-no-menu': {
    problem: () => 'No tiene la carta/menú enlazada en Google Maps.',
    impact: 'Medio-Alto',
    reason: () =>
      'En gastronomía, la carta es de lo más consultado de la ficha: el cliente quiere saber qué hay y a qué precio antes de ir. Si no la encuentra, elige un restaurante que sí la muestra.',
    services: ['maps-optimization', 'website'],
    benefit: () => 'Carta siempre accesible desde Google (y desde un QR en mesa), con más clientes que llegan ya decididos.',
  },

  // ================= REPUTACIÓN =================
  'rep-very-few-reviews': {
    problem: (c) => `Casi no tiene reseñas (${reviews(c)}).`,
    impact: 'Alto',
    reason: (c) =>
      `Muchos usuarios comparan negocios similares antes de elegir, y con ${reviews(c)} reseñas ${nombre(c)} no genera la confianza suficiente frente a competidores con decenas o cientos. Además, la cantidad de reseñas es uno de los factores que Google usa para ordenar los resultados del mapa.`,
    services: ['qr-reviews', 'maps-optimization'],
    benefit: (c) => `Sumar ~${Math.max(c.vertical.healthyMonthlyReviews, 5)}+ reseñas al mes de clientes reales y empezar a competir en confianza y posicionamiento.`,
  },
  'rep-few-reviews': {
    problem: (c) => `Tiene pocas reseñas (${reviews(c)}).`,
    impact: 'Alto',
    reason: (c) =>
      `Muchos usuarios comparan negocios similares antes de elegir. Con ${reviews(c)} reseñas, ${nombre(c)} queda por debajo de los negocios de ${rubro(c)} mejor posicionados (que suelen superar las 100), lo que reduce la confianza y las conversiones, y también su posición en Google Maps.`,
    services: ['qr-reviews', 'maps-optimization'],
    benefit: () => 'Un flujo constante de reseñas positivas que aumenta la confianza, mejora el posicionamiento y convierte más búsquedas en clientes.',
  },
  'rep-moderate-reviews': {
    problem: (c) => `El volumen de reseñas (${reviews(c)}) es mejorable.`,
    impact: 'Medio',
    reason: (c) =>
      `La base es buena, pero en ${rubro(c)} los primeros puestos del mapa suelen estar ocupados por negocios con varios cientos de reseñas. Seguir sumando de forma constante es lo que permite adelantarlos.`,
    services: ['qr-reviews'],
    benefit: () => 'Superar a la competencia en volumen de reseñas y ganar posiciones en el mapa.',
  },
  'rep-low-rating': {
    problem: (c) => `La calificación es baja (${rating(c)}★).`,
    impact: 'Alto',
    reason: (c) =>
      `Muchos clientes descartan directamente los negocios por debajo de 4★. Con ${rating(c)}★, ${nombre(c)} pierde clientes incluso antes de que lean una sola reseña, y cada opinión negativa nueva pesa todavía más.`,
    services: ['qr-reviews', 'support-automation'],
    benefit: () => 'Subir la calificación pública con un flujo constante de reseñas de clientes satisfechos y respuestas profesionales a cada crítica.',
  },
  'rep-medium-rating': {
    problem: (c) => `La calificación (${rating(c)}★) está por debajo de la competencia mejor valorada.`,
    impact: 'Medio',
    reason: (c) =>
      `Al comparar opciones en el mapa, una diferencia de pocas décimas (${rating(c)}★ frente a 4,6–4,8★) basta para que el cliente elija al otro. Las experiencias negativas aisladas pesan mucho cuando no hay un flujo constante de reseñas positivas.`,
    services: ['qr-reviews'],
    benefit: () => 'Llevar la calificación a 4,5★ o más y destacar en la comparación con la competencia.',
  },
  'rep-no-responses': {
    problem: (c) => `No responde las reseñas (solo el ${pct(c.metrics.ownerResponseRate)} de las recientes tiene respuesta).`,
    impact: 'Medio-Alto',
    reason: () =>
      'Responder reseñas demuestra que hay alguien detrás que se preocupa por sus clientes; no hacerlo transmite desinterés. Los usuarios leen las respuestas antes de decidir, y Google valora la interacción del propietario como señal de una ficha activa.',
    services: ['support-automation', 'maps-optimization'],
    benefit: () => 'Todas las reseñas respondidas en menos de 24 h con respuestas personalizadas (redactadas con IA y aprobadas por el dueño), sin dedicarle tiempo.',
  },
  'rep-low-responses': {
    problem: (c) => `Responde pocas reseñas (${pct(c.metrics.ownerResponseRate)} de las recientes).`,
    impact: 'Medio',
    reason: () =>
      'Responder solo algunas reseñas deja sin atender justamente a clientes que se tomaron el tiempo de opinar. Una respuesta sistemática mejora la imagen ante quienes están comparando y fideliza a quien ya compró.',
    services: ['support-automation'],
    benefit: () => 'Respuesta al 100% de las reseñas de forma automática y personalizada.',
  },
  'rep-negative-unanswered': {
    problem: (c) => {
      const n = c.profile.reviews.filter((r) => (r.rating ?? 5) <= 3 && !r.hasOwnerResponse).length;
      return `Tiene ${n} reseña${n === 1 ? '' : 's'} negativa${n === 1 ? '' : 's'} reciente${n === 1 ? '' : 's'} sin responder.`;
    },
    impact: 'Alto',
    reason: () =>
      'Las reseñas negativas son las que más leen los clientes indecisos. Una queja sin respuesta parece una queja con razón; una respuesta profesional, en cambio, demuestra compromiso y suele neutralizar el daño, e incluso mejorar la imagen.',
    services: ['support-automation', 'qr-reviews'],
    benefit: () => 'Convertir las críticas en una muestra de buena atención y detectar a tiempo los problemas que las generan.',
  },
  'rep-stale-reviews': {
    problem: (c) => `No recibe reseñas nuevas desde hace ~${c.metrics.daysSinceLastReview ?? '?'} días.`,
    impact: 'Alto',
    reason: () =>
      'Los usuarios miran la fecha de las reseñas: si las últimas son de hace meses, dudan de si el negocio sigue funcionando igual de bien (o si sigue abierto). Google también prioriza las fichas con actividad reciente.',
    services: ['qr-reviews'],
    benefit: () => 'Reseñas nuevas cada semana, que demuestran actividad y mantienen la ficha arriba en el mapa.',
  },
  'rep-low-frequency': {
    problem: (c) => `Recibe pocas reseñas al mes (${c.metrics.reviewsLast30Days ?? 0} en los últimos 30 días).`,
    impact: 'Medio',
    reason: (c) =>
      `Un negocio activo de ${rubro(c)} suele sumar ${c.vertical.healthyMonthlyReviews}+ reseñas al mes. A este ritmo, los competidores que sí piden reseñas se alejan cada mes en confianza y posicionamiento.`,
    services: ['qr-reviews'],
    benefit: () => 'Multiplicar el ritmo de reseñas pidiéndolas en el momento justo (en el mostrador, la mesa o el ticket).',
  },

  // ================= SITIO WEB =================
  'web-none': {
    problem: () => 'No tiene sitio web.',
    impact: 'Alto',
    reason: (c) =>
      `Los usuarios que llegan desde Google Maps no tienen una página propia donde consultar ${queBusca(c)}. Esto provoca pérdida de consultas y clientes potenciales, resta credibilidad frente a competidores que sí tienen web y deja al negocio fuera de las búsquedas normales de Google.`,
    services: ['website'],
    benefit: () => 'Un canal propio que trabaja 24/7: informa, genera confianza y convierte visitas en consultas, reservas y ventas.',
  },
  'web-social-only': {
    problem: (c) => `En lugar de una web propia, la ficha enlaza a una red social o directorio (${hostOf(c.website?.url)}).`,
    impact: 'Alto',
    reason: () =>
      'Las redes sociales no posicionan en Google para búsquedas de servicios, obligan a muchos usuarios a iniciar sesión y mezclan la información útil (precios, horarios, contacto) con publicaciones. El negocio depende de una plataforma que no controla y que transmite menos profesionalidad que una web propia.',
    services: ['website'],
    benefit: () => 'Una web profesional propia que posiciona en Google, centraliza la información y convierte mejor que un perfil social.',
  },
  'web-down': {
    problem: () => 'El sitio web enlazado en Google no carga.',
    impact: 'Alto',
    reason: (c) =>
      `Cada persona que toca "Sitio web" en la ficha de ${nombre(c)} se encuentra con un error. Es peor que no tener web: transmite abandono y hace que el cliente dude de si el negocio sigue funcionando.`,
    services: ['website'],
    benefit: () => 'Recuperar todas las visitas que hoy terminan en un error y transformarlas en contactos.',
  },
  'web-no-https': {
    problem: () => 'La web no tiene certificado de seguridad (HTTPS).',
    impact: 'Medio-Alto',
    reason: () =>
      'Los navegadores muestran "No seguro" junto a la dirección, y muchos usuarios abandonan al ver ese aviso, sobre todo si tienen que dejar sus datos. Google además penaliza en sus resultados a las webs sin HTTPS.',
    services: ['website'],
    benefit: () => 'Una web segura que no espanta a los visitantes y que Google no penaliza.',
  },
  'web-not-mobile': {
    problem: () => 'La web no está adaptada a celulares.',
    impact: 'Alto',
    reason: () =>
      'La gran mayoría de quienes llegan desde Google Maps lo hacen desde el celular. En esta web hay que hacer zoom y desplazarse de lado para leer, así que la mayoría abandona en segundos y vuelve al mapa para elegir otro negocio. Google además prioriza las webs adaptadas a móvil.',
    services: ['website'],
    benefit: () => 'Una web que se ve perfecta en el celular, con botones grandes para llamar, escribir por WhatsApp o reservar.',
  },
  'web-mobile-issues': {
    problem: () => 'La web tiene problemas de uso en celulares.',
    impact: 'Medio',
    reason: () =>
      'Textos pequeños, botones difíciles de tocar o contenido que se sale de la pantalla generan frustración en el celular, que es desde donde llega casi todo el tráfico de Google Maps. Cada fricción reduce las consultas.',
    services: ['website'],
    benefit: () => 'Navegación cómoda en el celular y más visitas que terminan en contacto.',
  },
  'web-slow': {
    problem: (c) => `La web es lenta (tarda ${secs(c)} s en cargar).`,
    impact: 'Alto',
    reason: (c) =>
      `Gran parte de los usuarios abandona una web si tarda más de 3 segundos en cargar, sobre todo con datos móviles. Con ${secs(c)} s, una parte importante de las visitas que llegan desde Google se pierde antes de ver siquiera el contenido.`,
    services: ['website'],
    benefit: () => 'Una web que carga en menos de 2 segundos: menos abandonos, mejor posicionamiento en Google y más consultas.',
  },
  'web-speed-improvable': {
    problem: (c) => `La velocidad de la web es mejorable (${secs(c)} s).`,
    impact: 'Bajo',
    reason: () => 'Cada segundo extra de carga reduce la proporción de visitantes que terminan contactando, y Google usa la velocidad como factor de posicionamiento.',
    services: ['website'],
    benefit: () => 'Más visitantes que llegan a ver la información y contactar.',
  },
  'web-outdated': {
    problem: () => 'El diseño de la web está anticuado.',
    impact: 'Alto',
    reason: (c) => {
      const signs = [...(c.website?.visual.legacyTech ?? []), c.website?.visual.copyrightYear ? `copyright de ${c.website.visual.copyrightYear}` : '']
        .filter(Boolean)
        .join(', ');
      return `La web es la primera impresión del negocio fuera de Google Maps. Un diseño desactualizado${signs ? ` (${signs})` : ''} hace pensar que el negocio está igual de descuidado, y el cliente elige a un competidor con una imagen más profesional aunque el servicio sea peor.`;
    },
    services: ['website'],
    benefit: () => 'Una imagen moderna y profesional a la altura del servicio real, que genera confianza desde el primer vistazo.',
  },
  'web-visual-improvable': {
    problem: () => 'La calidad visual de la web es mejorable.',
    impact: 'Medio',
    reason: () =>
      'Detalles de diseño, imágenes y textos poco cuidados restan credibilidad. Ante dos opciones similares, el cliente elige la que transmite más profesionalidad.',
    services: ['website'],
    benefit: () => 'Una web más atractiva y convincente que convierte más visitas en clientes.',
  },
  'web-no-meta': {
    problem: () => 'La web no tiene descripción para Google (meta descripción).',
    impact: 'Bajo',
    reason: () =>
      'Sin ella, Google muestra un fragmento de texto al azar en los resultados de búsqueda. Un texto atractivo y bien escrito aumenta los clics frente a los resultados de la competencia.',
    services: ['website'],
    benefit: () => 'Más clics desde los resultados de búsqueda de Google.',
  },
  'web-poor-contact': {
    problem: () => 'En la web cuesta encontrar cómo contactar.',
    impact: 'Alto',
    reason: (c) => {
      const w = c.website;
      const missing = [
        !w?.contact.phoneLinks.length && 'teléfono clicable',
        !w?.whatsapp.hasLink && 'WhatsApp',
        !(w?.contact.emailLinks.length || w?.contact.hasContactForm) && 'email o formulario',
        !w?.contact.hasAddress && 'dirección',
      ].filter(Boolean);
      return `El objetivo de la web es generar contactos, y aquí faltan ${missing.join(', ') || 'vías de contacto claras'}. El visitante interesado tiene que buscar cómo comunicarse; muchos no lo hacen y se van.`;
    },
    services: ['website', 'whatsapp-ai-bot'],
    benefit: () => 'Contacto a un toque desde cualquier página (llamar, WhatsApp, formulario), con más consultas por cada visita.',
  },
  'web-contact-hidden': {
    problem: () => 'El contacto no se ve al entrar en la web.',
    impact: 'Medio',
    reason: () =>
      'Si el botón para llamar o escribir no está en la primera pantalla, una parte de los visitantes no lo busca. Quien llega desde Google Maps suele querer contactar de inmediato.',
    services: ['website'],
    benefit: () => 'Botones de contacto siempre visibles que convierten más visitas en consultas.',
  },
  'web-no-whatsapp': {
    problem: () => 'La web no tiene botón de WhatsApp.',
    impact: 'Medio',
    reason: () =>
      'WhatsApp es hoy el canal preferido para hacer consultas rápidas: mucha gente prefiere escribir antes que llamar o completar un formulario. Sin un botón visible, esas consultas simplemente no llegan.',
    services: ['website', 'whatsapp-ai-bot'],
    benefit: () => 'Un botón flotante de WhatsApp en toda la web, conectado a un asistente que responde al instante.',
  },
  'web-no-booking': {
    problem: () => 'No tiene reservas online.',
    impact: 'Medio',
    reason: (c) =>
      `En ${rubro(c)} los clientes esperan poder reservar o pedir turno al momento. Hoy la web obliga a llamar o esperar respuesta, y algunos clientes abandonan el proceso, sobre todo fuera del horario comercial, que es cuando muchos deciden.`,
    services: ['booking-system'],
    benefit: () => 'Reservas 24/7 sin llamadas ni mensajes de ida y vuelta, con recordatorios automáticos que reducen las ausencias.',
  },
  'booking-none': {
    problem: () => 'No tiene reservas online.',
    impact: 'Medio',
    reason: (c) =>
      `Ni la ficha de Google Maps ni una web propia permiten reservar o pedir cita. En ${rubro(c)} los clientes esperan hacerlo al momento; algunos abandonan cuando deben llamar o esperar respuesta, sobre todo fuera del horario comercial.`,
    services: ['booking-system'],
    benefit: () => 'Botón "Reservar" en Google Maps y agenda online 24/7, con confirmaciones y recordatorios automáticos.',
  },

  // ================= WHATSAPP =================
  'wa-not-visible': {
    problem: () => 'No tiene WhatsApp visible para los clientes.',
    impact: 'Medio-Alto',
    reason: (c) =>
      `No hay enlace a WhatsApp ni en la ficha de Google Maps ni en la web. Muchos clientes de ${rubro(c)} prefieren escribir antes que llamar, y si no encuentran cómo hacerlo, consultan al siguiente negocio de la lista.`,
    services: ['whatsapp-ai-bot'],
    benefit: () => 'Un canal de WhatsApp visible desde Google y la web, con respuestas automáticas para no perder ninguna consulta.',
  },
  'wa-no-auto-reply': {
    problem: () => 'No responde consultas automáticamente.',
    impact: (c) => (c.vertical.whatsappIntensity === 3 ? 'Medio-Alto' : 'Medio'),
    reason: (c) =>
      `Las consultas fuera del horario comercial pueden quedar sin respuesta durante horas, generando pérdida de oportunidades de venta: quien escribe a ${nombre(c)} por la noche o el fin de semana suele escribir también a la competencia, y se queda con quien responde primero.${c.vertical.whatsappIntensity === 3 ? ` En ${rubro(c)} el volumen de preguntas repetitivas (${queBusca(c)}) es especialmente alto.` : ''}`,
    services: ['whatsapp-ai-bot', 'support-automation'],
    benefit: (c) =>
      `Respuesta inmediata 24/7 a las preguntas frecuentes${c.vertical.bookingRelevant ? ' y reservas tomadas automáticamente' : ''}, liberando horas de atención manual cada semana.`,
  },
};

// ---------- Fallback para hallazgos sin plantilla (p. ej. aportados por agentes IA) ----------
const DEFAULT_SERVICE: Record<AuditArea, ServiceId> = {
  maps: 'maps-optimization',
  website: 'website',
  whatsapp: 'whatsapp-ai-bot',
  reputation: 'qr-reviews',
  qr: 'qr-reviews',
};
const IMPACT_FROM_SEVERITY: Record<Severity, SalesImpact> = { critical: 'Alto', high: 'Alto', medium: 'Medio', low: 'Bajo' };

const IMPACT_RANK: Record<SalesImpact, number> = { Alto: 0, 'Medio-Alto': 1, Medio: 2, Bajo: 3 };

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : 'otro sitio';
  } catch {
    return 'otro sitio';
  }
}

export function serviceLabel(ids: ServiceId[]): string {
  const names = ids.map((id) => SERVICE_CATALOG[id].name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : (names[0] ?? '');
}

export function buildSalesArgument(ctx: AuditContext, finding: Finding): SalesArgument {
  const t = ARGUMENTS[finding.id];
  if (!t) {
    const services = [DEFAULT_SERVICE[finding.area]];
    return {
      findingId: finding.id,
      area: finding.area,
      problem: finding.title.endsWith('.') ? finding.title : `${finding.title}.`,
      impact: IMPACT_FROM_SEVERITY[finding.severity],
      reason: finding.detail,
      serviceIds: services,
      service: serviceLabel(services),
      benefit: `Resolverlo con ${SERVICE_CATALOG[services[0]!].pitch}.`,
      evidence: finding.evidence,
    };
  }
  return {
    findingId: finding.id,
    area: finding.area,
    problem: t.problem(ctx, finding),
    impact: typeof t.impact === 'function' ? t.impact(ctx) : t.impact,
    reason: t.reason(ctx, finding),
    serviceIds: t.services,
    service: serviceLabel(t.services),
    benefit: t.benefit(ctx),
    evidence: finding.evidence,
  };
}

/** Un argumento por problema, ordenado por impacto (y, a igual impacto, por gravedad del hallazgo). */
export function buildSalesArguments(ctx: AuditContext, findings: Finding[]): SalesArgument[] {
  return findings
    .map((f, i) => ({ arg: buildSalesArgument(ctx, f), i }))
    .sort((a, b) => IMPACT_RANK[a.arg.impact] - IMPACT_RANK[b.arg.impact] || a.i - b.i)
    .map((x) => x.arg);
}

export function hasTemplate(findingId: string): boolean {
  return findingId in ARGUMENTS;
}

/** Texto plano en el formato de prospección, listo para copiar y pegar. */
export function formatSalesArgument(a: SalesArgument): string {
  return [
    'Problema detectado:',
    a.problem,
    'Impacto estimado:',
    a.impact,
    'Motivo:',
    a.reason,
    'Servicio recomendado:',
    `${a.service}.`,
    'Beneficio para el cliente:',
    a.benefit,
  ].join('\n');
}

export function formatSalesArgumentsText(businessName: string | undefined, args: SalesArgument[]): string {
  const header = `ARGUMENTOS COMERCIALES · ${businessName ?? 'Negocio'}\n${'='.repeat(40)}`;
  return [header, ...args.map((a, i) => `${i + 1}.\n${formatSalesArgument(a)}`)].join('\n\n');
}
