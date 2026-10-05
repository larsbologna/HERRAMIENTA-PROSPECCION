import { parseReviewCount } from '../scraper/mapsScraper.js';
import type { RawOverview } from '../scraper/scripts/mapsScripts.js';
import { parseRating } from '../utils/text.js';

/**
 * SCORE DE OPORTUNIDAD COMERCIAL del Generador de Prospectos.
 *
 * Mide cuánto necesita el negocio los servicios que se ofrecen. Cada punto suma SOLO si la
 * carencia está verificada en la ficha de Google Maps (mismo criterio que la Confiabilidad del
 * dato): si algo no se pudo comprobar, no suma, y queda indicado como "sin verificar".
 */

/** Datos de la ficha relevantes para el score. undefined = no se pudo verificar. */
export interface CandidateFacts {
  hasWebsite?: boolean;
  hasWhatsApp?: boolean;
  hasBooking?: boolean;
  claimed?: boolean;
  /** Días con horario publicado (0 = sin horarios). */
  hoursDays?: number;
  hasPosts?: boolean;
  hasPhone?: boolean;
  reviewCount?: number;
  rating?: number;
  permanentlyClosed?: boolean;
}

export interface ScoreReason {
  id: string;
  label: string;
  points: number;
}

export interface OpportunityScore {
  /** 0–100 (puntos obtenidos sobre el máximo posible para el rubro). */
  score: number;
  points: number;
  maxPoints: number;
  reasons: ScoreReason[];
  /** Criterios que no suman porque el dato no se pudo verificar. */
  unverified: string[];
}

/** Pesos (editables). Las reservas pesan menos en rubros donde no se reserva. */
export const SCORE_WEIGHTS = {
  noWebsite: 30,
  noWhatsApp: 20,
  noBooking: 20,
  noBookingLowRelevance: 8,
  unclaimed: 25,
  incompleteHours: 10,
  noPosts: 10,
  noPhone: 15,
  fewReviews: 10,
  lowRating: 5,
} as const;

export function opportunityScore(f: CandidateFacts, opts: { bookingRelevant: boolean }): OpportunityScore {
  const w = SCORE_WEIGHTS;
  const booking = opts.bookingRelevant ? w.noBooking : w.noBookingLowRelevance;
  const reasons: ScoreReason[] = [];
  const unverified: string[] = [];
  const check = (known: boolean | undefined, missing: boolean, id: string, label: string, points: number, unknownLabel: string) => {
    if (known === undefined) unverified.push(unknownLabel);
    else if (missing) reasons.push({ id, label, points });
  };

  check(f.hasWebsite, f.hasWebsite === false, 'no-website', 'Sin sitio web', w.noWebsite, 'Sitio web');
  check(f.hasWhatsApp, f.hasWhatsApp === false, 'no-whatsapp', 'Sin WhatsApp visible', w.noWhatsApp, 'WhatsApp (tiene web: se revisa en el análisis completo)');
  check(f.hasBooking, f.hasBooking === false, 'no-booking', 'Sin reservas ni turnos online', booking, 'Reservas');
  check(f.claimed, f.claimed === false, 'unclaimed', 'Ficha sin reclamar', w.unclaimed, 'Ficha reclamada');
  check(f.hoursDays === undefined ? undefined : true, (f.hoursDays ?? 7) < 7, 'hours', f.hoursDays === 0 ? 'Sin horarios publicados' : `Horarios incompletos (${f.hoursDays} de 7 días)`, w.incompleteHours, 'Horarios');
  check(f.hasPosts, f.hasPosts === false, 'no-posts', 'Sin publicaciones en Google', w.noPosts, 'Publicaciones');
  check(f.hasPhone, f.hasPhone === false, 'no-phone', 'Sin teléfono en la ficha', w.noPhone, 'Teléfono');
  check(f.reviewCount === undefined ? undefined : true, (f.reviewCount ?? 99) < 20, 'few-reviews', `Pocas reseñas (${f.reviewCount})`, w.fewReviews, 'Cantidad de reseñas');
  check(f.rating === undefined ? undefined : true, (f.rating ?? 5) < 4, 'low-rating', `Calificación baja (${String(f.rating).replace('.', ',')}★)`, w.lowRating, 'Calificación');

  const maxPoints = w.noWebsite + w.noWhatsApp + booking + w.unclaimed + w.incompleteHours + w.noPosts + w.noPhone + w.fewReviews + w.lowRating;
  const points = reasons.reduce((s, r) => s + r.points, 0);
  reasons.sort((a, b) => b.points - a.points);
  return { score: Math.round((points / maxPoints) * 100), points, maxPoints, reasons, unverified };
}

/** Días con horario a partir de la tabla o del texto accesible de Maps. */
function hoursDaysOf(raw: RawOverview): number | undefined {
  if (raw.hoursRows.length) return Math.min(7, new Set(raw.hoursRows.map(([d]) => d.trim().toLowerCase()).filter(Boolean)).size);
  if (raw.hoursAria) return Math.min(7, raw.hoursAria.split(';').filter((p) => /,/.test(p)).length) || undefined;
  return undefined;
}

/**
 * Datos verificables de la descripción general de la ficha (EXTRACT_OVERVIEW, el mismo script
 * del analizador). `panelFullyLoaded` indica si se recorrió la ficha completa.
 */
export function factsFromOverview(raw: RawOverview, panelFullyLoaded: boolean): CandidateFacts {
  const m = raw.meta;
  const infoLoaded = (m?.itemIds ?? 0) > 0;
  const links = [...raw.socialLinks, raw.website, raw.bookingUrl].filter(Boolean);
  const waLink = links.some((l) => /wa\.me|whatsapp/i.test(l));
  const hasWebsite = raw.website ? true : infoLoaded ? false : undefined;
  const ownerReply = m?.claimed === 'respuesta-propietario' || m?.claimed === 'novedades-propietario';
  const reviewCount = parseReviewCount(raw.reviewsText) ?? (m?.noReviewsText ? 0 : undefined);
  const days = hoursDaysOf(raw);
  return {
    hasWebsite,
    // Sin web, si en la ficha no hay ningún enlace de WhatsApp, no lo tiene visible. Con web, se ve en el análisis completo.
    hasWhatsApp: waLink ? true : hasWebsite === false ? false : undefined,
    hasBooking: m?.booking ? true : infoLoaded ? false : undefined,
    claimed: m?.unclaimed && ownerReply ? undefined : m?.unclaimed ? false : ownerReply ? true : undefined,
    hoursDays: days ?? (infoLoaded ? 0 : undefined),
    hasPosts: m?.postsSection ? true : panelFullyLoaded && infoLoaded ? false : undefined,
    hasPhone: raw.phone ? true : infoLoaded ? false : undefined,
    reviewCount,
    rating: parseRating(raw.ratingText) ?? undefined,
    permanentlyClosed: raw.permanentlyClosed,
  };
}
