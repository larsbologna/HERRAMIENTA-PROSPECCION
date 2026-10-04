import type { BusinessProfile } from '../domain/types.js';
import {
  FIELD_LABELS,
  type DataConfidence,
  type DataField,
  type DataPoint,
  type DataQuality,
  type DataStatus,
} from '../domain/reliability.js';
import type { RawAbout, RawOverview, RawReview } from './scripts/mapsScripts.js';

/** Qué pasó en cada paso del recorrido de la ficha. */
export interface ScrapeSteps {
  headerFound: boolean;
  panelFullyLoaded: boolean;
  reviews: { state: 'ok' | 'no_abierta' | 'error'; sortedByNewest: boolean; error?: string };
  about: { state: 'ok' | 'no_abierta' | 'error'; error?: string };
}

const OVERVIEW = 'Descripción general de la ficha';
const HEADER = 'Encabezado de la ficha (nombre, calificación, categoría)';
const INFO_ROWS = 'Filas de información de la ficha';
const TAB_REVIEWS = 'Pestaña Reseñas';
const TAB_ABOUT = 'Pestaña Información';

const n = (v: number) => v.toLocaleString('es-AR');

/**
 * Evalúa la confiabilidad de cada dato a partir de lo que devolvió la página y de cómo se leyó.
 * Función pura: se testea con fichas simuladas.
 */
export function assessDataQuality(
  raw: RawOverview,
  reviews: RawReview[],
  about: RawAbout,
  steps: ScrapeSteps,
  profile: BusinessProfile,
): DataQuality {
  const m = raw.meta;
  const fields = {} as Record<DataField, DataPoint>;
  const set = (field: DataField, status: DataStatus, value: string, confidence: DataConfidence, source: string, method: string, note?: string) => {
    fields[field] = { field, label: FIELD_LABELS[field], status, value, confidence, source, method, ...(note ? { note } : {}) };
  };

  const blocked = !!m?.blocked;
  const pageLoaded = steps.headerFound && !!profile.name && !blocked;
  if (!pageLoaded || !m) {
    const why = blocked
      ? 'Google mostró una verificación anti-robots o de consentimiento.'
      : 'No cargó el encabezado de la ficha (¿la URL es de un negocio?).';
    for (const f of Object.keys(FIELD_LABELS) as DataField[]) set(f, 'error', '—', 'baja', OVERVIEW, 'Sin lectura', why);
    return { version: 1, pageLoaded: false, blocked, panelFullyLoaded: steps.panelFullyLoaded, fields };
  }

  // Si la ficha mostró filas de información (dirección, web, teléfono…), la AUSENCIA de una fila
  // es un dato: Maps usa siempre el mismo atributo data-item-id para cada una.
  const infoLoaded = m.itemIds > 0;
  const absent = (field: DataField, what: string) =>
    infoLoaded
      ? set(field, 'cero', 'No figura en la ficha', 'media', INFO_ROWS, `Ausencia de la fila ${what} con la ficha cargada`, 'Se leyeron otras filas de información y esta no aparece.')
      : set(field, 'no_encontrado', '—', 'baja', INFO_ROWS, 'Sin filas de información', 'La ficha no mostró filas de información: no se puede afirmar que falte.');

  // ---------- Nombre y categoría ----------
  set('name', 'encontrado', profile.name!, m.name === 'h1.DUwDvf' ? 'alta' : 'media', HEADER, `Selector ${m.name}`);
  if (profile.category) set('category', 'encontrado', profile.category, m.category === 'button.DkEaL' ? 'alta' : 'media', HEADER, `Selector ${m.category}`);
  else set('category', 'no_encontrado', '—', 'baja', HEADER, 'Selectores de categoría sin resultado', 'Maps siempre muestra una categoría: si no se leyó es un problema de lectura, no de la ficha.');

  // ---------- Calificación y cantidad de reseñas ----------
  const sampleSize = reviews.length;
  if (profile.rating !== undefined) {
    set('rating', 'encontrado', `${profile.rating.toFixed(1).replace('.', ',')} ★`, m.rating === 'F7nice' ? 'alta' : 'media', HEADER,
      m.rating === 'F7nice' ? 'Texto del bloque de calificación (div.F7nice)' : 'aria-label de las estrellas del encabezado');
  } else if (m.noReviewsText) {
    set('rating', 'cero', 'Sin calificación (no tiene reseñas)', 'alta', HEADER, 'Texto "Sin reseñas" en el encabezado');
  } else {
    set('rating', 'no_encontrado', '—', 'baja', HEADER, 'Sin bloque de calificación', 'No se afirma nada sobre la calificación.');
  }

  if (profile.reviewCount !== undefined) {
    const method = {
      'F7nice-aria': 'aria-label del contador de reseñas (div.F7nice)',
      'F7nice-parentesis': 'Número entre paréntesis del bloque de calificación (div.F7nice)',
      'boton-encabezado': 'Texto "N reseñas" de un botón del encabezado',
    }[m.reviews] ?? `Lectura ${m.reviews}`;
    let confidence: DataConfidence = m.reviews === 'boton-encabezado' ? 'media' : 'alta';
    let note: string | undefined;
    // Validaciones cruzadas: histograma de estrellas y muestra de reseñas.
    const histTotal = profile.ratingHistogram ? Object.values(profile.ratingHistogram).reduce((a, b) => a + b, 0) : undefined;
    if (histTotal !== undefined && histTotal > 0) {
      const diff = Math.abs(histTotal - profile.reviewCount);
      if (diff > Math.max(2, profile.reviewCount * 0.05)) {
        confidence = 'baja';
        note = `No coincide con el histograma de estrellas (${n(histTotal)}).`;
      } else {
        note = `Coincide con el histograma de estrellas (${n(histTotal)}).`;
      }
    }
    if (sampleSize > profile.reviewCount) {
      confidence = 'baja';
      note = `Se leyeron ${sampleSize} reseñas en la pestaña, más que el total indicado: el contador no es fiable.`;
    }
    set('reviewCount', profile.reviewCount === 0 ? 'cero' : 'encontrado', `${n(profile.reviewCount)} reseñas`, confidence, HEADER, method, note);
  } else if (m.noReviewsText) {
    if (sampleSize > 0) set('reviewCount', 'no_encontrado', '—', 'baja', HEADER, 'Texto "Sin reseñas" en el encabezado', `Contradicción: la pestaña Reseñas mostró ${sampleSize}.`);
    else set('reviewCount', 'cero', '0 reseñas', 'alta', HEADER, 'Texto "Sin reseñas" en el encabezado');
  } else {
    set('reviewCount', 'no_encontrado', '—', 'baja', HEADER, 'Sin contador de reseñas en el encabezado', 'No se afirma que tenga pocas reseñas.');
  }
  const noReviews = fields.reviewCount.status === 'cero' && fields.reviewCount.confidence === 'alta';

  // ---------- Contacto ----------
  if (profile.address) set('address', 'encontrado', profile.address, 'alta', INFO_ROWS, 'Fila data-item-id="address"');
  else absent('address', 'de dirección');
  if (profile.phone) set('phone', 'encontrado', profile.phone, m.phone === 'data-item-id' ? 'alta' : 'media', INFO_ROWS, m.phone === 'data-item-id' ? 'Fila data-item-id="phone:tel:…"' : 'aria-label "Teléfono"');
  else absent('phone', 'de teléfono');
  if (profile.website) set('website', 'encontrado', profile.website, m.website === 'data-item-id' ? 'alta' : 'media', INFO_ROWS, m.website === 'data-item-id' ? 'Enlace data-item-id="authority"' : 'aria-label "Sitio web"');
  else absent('website', 'de sitio web');

  // ---------- Horarios ----------
  if (profile.hours) {
    const days = Object.keys(profile.hours.days).length;
    set('hours', 'encontrado', days ? `${days} de 7 días con horario` : 'Publicados (sin detalle por día)', m.hours === 'tabla' ? 'alta' : 'media', INFO_ROWS,
      m.hours === 'tabla' ? 'Tabla de horarios (una fila por día)' : 'aria-label del bloque de horarios',
      days ? undefined : 'No se pudo separar por día: no se evalúa si están incompletos.');
    if (!days) fields.hours.confidence = 'baja';
  } else {
    absent('hours', 'de horarios');
  }

  // ---------- Descripción ----------
  const ownerDesc = about.description?.trim();
  if (ownerDesc) {
    set('description', 'encontrado', `${ownerDesc.length} caracteres`, 'alta', TAB_ABOUT, 'Bloque de descripción del propietario (div.PbZDve)');
  } else if (profile.description) {
    set('description', 'encontrado', `${profile.description.length} caracteres`, 'baja', OVERVIEW, `Resumen de la ficha (${m.description})`,
      'Puede ser el resumen que escribe Google y no la descripción del propietario: no se usa para evaluar su longitud.');
  } else if (steps.about.state === 'ok' && (about.sections > 0 || about.items.length > 0)) {
    set('description', 'cero', 'No tiene', 'media', TAB_ABOUT, 'Pestaña Información cargada, sin bloque de descripción');
  } else {
    set('description', steps.about.state === 'error' ? 'error' : 'no_encontrado', '—', 'baja', TAB_ABOUT, 'Pestaña Información no disponible',
      steps.about.error ?? 'No se pudo comprobar si tiene descripción.');
  }

  // ---------- Fotos ----------
  if (!profile.photoCountIsEstimate && profile.photoCount !== undefined) {
    set('photos', profile.photoCount === 0 ? 'cero' : 'encontrado', `${n(profile.photoCount)} fotos`, m.photoCount === 'aria-label' ? 'media' : 'baja', OVERVIEW,
      m.photoCount === 'aria-label' ? `aria-label "${m.photoLabel}"` : `Texto del panel "${m.photoLabel}"`,
      m.photoCount === 'aria-label' ? 'Total que muestra Maps (excluye fotos de autores de reseñas).' : 'Leído del texto general del panel: no se usa para argumentar.');
  } else if (m.addPhotoPrompt && raw.photoUrls.length === 0) {
    set('photos', 'cero', 'Sin fotos', 'media', OVERVIEW, 'Botón "Agregar fotos" y ninguna imagen en la ficha');
  } else {
    const visible = raw.photoUrls.length;
    set('photos', 'no_encontrado', visible ? `Al menos ${visible} visibles` : '—', 'baja', OVERVIEW, visible ? 'Conteo de miniaturas visibles' : 'Sin contador de fotos',
      'Maps no mostró el total de fotos: no se afirma que tenga pocas.');
  }

  // ---------- Publicaciones ----------
  if (m.postsSection && profile.posts.length) {
    const dated = profile.posts.filter((p) => p.ageDays !== undefined);
    const last = dated.length ? Math.min(...dated.map((p) => p.ageDays!)) : undefined;
    set('posts', 'encontrado', `${profile.posts.length} publicación(es)${last !== undefined ? ` · la última hace ~${last} días` : ''}`, dated.length ? 'alta' : 'media', OVERVIEW,
      'Sección "Novedades / Del propietario"', dated.length ? undefined : 'Sin fechas legibles: no se evalúa la antigüedad.');
  } else if (m.postsSection) {
    set('posts', 'no_encontrado', '—', 'baja', OVERVIEW, 'Sección "Novedades" encontrada', 'No se pudieron leer las publicaciones.');
  } else if (steps.panelFullyLoaded && infoLoaded) {
    set('posts', 'cero', 'Sin publicaciones', 'media', OVERVIEW, 'Ficha recorrida hasta el final sin sección "Novedades"');
  } else {
    set('posts', 'no_encontrado', '—', 'baja', OVERVIEW, 'Ficha no recorrida por completo', 'La sección de Novedades carga al desplazarse: no se afirma que no publique.');
  }

  // ---------- Place ID ----------
  if (m.placeIdFromUrl) set('placeId', 'encontrado', m.placeIdFromUrl, 'alta', 'URL de la ficha', 'Parámetro !19s de la URL');
  else if (m.placeIdCandidates.length === 1) set('placeId', 'encontrado', m.placeIdCandidates[0]!, 'media', 'HTML de la ficha', 'Único Place ID presente en la página');
  else if (m.placeIdCandidates.length > 1) {
    set('placeId', 'encontrado', m.placeIdCandidates[0]!, 'baja', 'HTML de la ficha', 'El más repetido en la página',
      `Hay ${m.placeIdCandidates.length} Place ID en la página (incluye negocios cercanos): puede no ser el de este negocio.`);
  } else set('placeId', 'no_encontrado', '—', 'baja', 'URL y HTML de la ficha', 'Sin Place ID');

  // ---------- Reclamada ----------
  const ownerReplyInSample = reviews.some((r) => r.hasOwnerResponse);
  const claimedBy = ownerReplyInSample ? 'respuesta-propietario' : m.claimed;
  if (m.unclaimed && claimedBy) {
    set('claimed', 'no_encontrado', 'Sin determinar', 'baja', OVERVIEW, 'Señales contradictorias', 'Aparece "Reclamar este negocio" y también actividad del propietario.');
  } else if (m.unclaimed) {
    set('claimed', 'encontrado', 'No (Google ofrece reclamarla)', m.unclaimed === 'enlace' ? 'alta' : 'media', OVERVIEW,
      m.unclaimed === 'enlace' ? 'Enlace "Reclamar este negocio" (business.google.com)' : 'Texto "¿Es el propietario de este negocio?"');
  } else if (claimedBy) {
    set('claimed', 'encontrado', claimedBy === 'respuesta-propietario' ? 'Sí (el propietario responde reseñas)' : 'Sí (publica novedades)', 'alta',
      claimedBy === 'respuesta-propietario' ? TAB_REVIEWS : OVERVIEW, claimedBy === 'respuesta-propietario' ? 'Respuestas del propietario' : 'Publicaciones del propietario');
  } else {
    set('claimed', 'no_encontrado', 'Sin determinar', 'baja', OVERVIEW, 'Sin señales', 'No se afirma que la ficha no esté reclamada.');
  }

  // ---------- Cerrado permanentemente ----------
  set('closed', 'encontrado', raw.permanentlyClosed ? 'Sí' : 'No', raw.permanentlyClosed ? 'alta' : 'media', HEADER, 'Texto "Cerrado permanentemente" en el encabezado (no en reseñas)');

  // ---------- Carta y reservas ----------
  if (profile.hasMenu) set('menu', 'encontrado', 'Enlazada', m.menu === 'data-item-id' ? 'alta' : 'media', INFO_ROWS, m.menu === 'data-item-id' ? 'Enlace data-item-id="menu"' : 'aria-label "Menú / Carta"');
  else absent('menu', 'de carta/menú');
  if (profile.hasBooking) set('booking', 'encontrado', 'Sí', m.booking === 'enlace' ? 'alta' : 'media', OVERVIEW, m.booking === 'enlace' ? 'Enlace de reserva/cita' : 'Botón "Reservar"');
  else absent('booking', 'o botón de reserva');

  // ---------- Atributos (pestaña Información) ----------
  if (steps.about.state === 'ok' && about.items.length) {
    set('attributes', 'encontrado', `${about.items.length} atributo(s)`, 'alta', TAB_ABOUT, 'Listas de la pestaña Información');
  } else if (steps.about.state === 'ok' && about.sections === 0) {
    set('attributes', 'no_encontrado', '—', 'baja', TAB_ABOUT, 'Pestaña abierta sin secciones', 'La pestaña no mostró contenido: puede no haber terminado de cargar.');
  } else if (steps.about.state === 'ok') {
    set('attributes', 'no_encontrado', '—', 'baja', TAB_ABOUT, 'Secciones sin atributos legibles', 'Hay secciones pero no se pudieron leer sus atributos.');
  } else {
    set('attributes', steps.about.state === 'error' ? 'error' : 'no_encontrado', '—', 'baja', TAB_ABOUT, 'Pestaña Información no disponible', steps.about.error);
  }

  // ---------- Muestra de reseñas (respuestas del propietario) ----------
  const reviewCount = profile.reviewCount;
  const complete = reviewCount !== undefined && sampleSize >= reviewCount && sampleSize > 0;
  if (steps.reviews.state === 'error') {
    set('reviewsSample', 'error', '—', 'baja', TAB_REVIEWS, 'Lectura de la pestaña', steps.reviews.error);
  } else if (noReviews) {
    set('reviewsSample', 'cero', 'No tiene reseñas', 'alta', HEADER, 'Texto "Sin reseñas"');
  } else if (steps.reviews.state !== 'ok') {
    set('reviewsSample', 'no_encontrado', '—', 'baja', TAB_REVIEWS, 'Pestaña Reseñas no encontrada', 'No se evalúan respuestas ni reseñas negativas.');
  } else if (!sampleSize) {
    set('reviewsSample', 'no_encontrado', '—', 'baja', TAB_REVIEWS, 'Tarjetas de reseña (data-review-id)', 'La pestaña abrió pero no se leyeron reseñas.');
  } else {
    const answered = reviews.filter((r) => r.hasOwnerResponse).length;
    const confidence: DataConfidence = complete || sampleSize >= 10 ? 'alta' : sampleSize >= 3 ? 'media' : 'baja';
    set('reviewsSample', 'encontrado', `${sampleSize} reseñas leídas · ${answered} con respuesta del propietario`, confidence, TAB_REVIEWS,
      'Tarjetas de reseña (data-review-id) y bloque "Respuesta del propietario"',
      [
        complete ? 'Se leyeron todas las reseñas.' : sampleSize < 10 ? 'Muestra chica: los porcentajes son orientativos.' : undefined,
        steps.reviews.sortedByNewest || complete ? undefined : 'Orden "Más relevantes" (no se pudo ordenar por recientes).',
      ].filter(Boolean).join(' ') || undefined);
  }

  // ---------- Fechas de reseñas (frecuencia / última reseña) ----------
  if (steps.reviews.state === 'error') {
    set('reviewsRecency', 'error', '—', 'baja', TAB_REVIEWS, 'Lectura de la pestaña', steps.reviews.error);
  } else if (noReviews) {
    set('reviewsRecency', 'cero', 'No tiene reseñas', 'alta', HEADER, 'Texto "Sin reseñas"');
  } else if (steps.reviews.state !== 'ok' || !sampleSize) {
    set('reviewsRecency', 'no_encontrado', '—', 'baja', TAB_REVIEWS, 'Sin reseñas leídas', 'No se evalúa la frecuencia de reseñas.');
  } else {
    const dated = profile.reviews.filter((r) => r.ageDays !== undefined);
    const last = dated.length ? Math.min(...dated.map((r) => r.ageDays!)) : undefined;
    const in30 = dated.filter((r) => r.ageDays! <= 30).length;
    const value = last !== undefined ? `Última hace ~${last} días · ${in30} en los últimos 30 días` : 'Sin fechas legibles';
    const method = 'Fecha relativa de cada reseña ("hace 2 semanas")';
    if (!steps.reviews.sortedByNewest && !complete) {
      set('reviewsRecency', 'no_encontrado', value, 'baja', TAB_REVIEWS, method, 'No se pudo ordenar por "Más recientes": la muestra no refleja las últimas reseñas.');
    } else if (dated.length < Math.min(3, sampleSize) || dated.length / sampleSize < 0.8) {
      set('reviewsRecency', 'no_encontrado', value, 'baja', TAB_REVIEWS, method, 'No se pudieron leer las fechas de la mayoría de las reseñas.');
    } else {
      set('reviewsRecency', 'encontrado', value, complete || dated.length >= 10 ? 'alta' : 'media', TAB_REVIEWS, `${method}, orden "Más recientes"`,
        'Las fechas de Google son aproximadas ("hace un mes").');
    }
  }

  return { version: 1, pageLoaded: true, blocked: false, panelFullyLoaded: steps.panelFullyLoaded, fields };
}
