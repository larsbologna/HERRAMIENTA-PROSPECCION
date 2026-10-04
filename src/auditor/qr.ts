import type { QrRecommendation } from '../domain/types.js';
import type { AuditContext } from './context.js';

/**
 * ¿Le conviene un sistema QR de captación de reseñas?
 * (página propia de valoración → 5★ a Google Maps, 1-4★ a feedback interno)
 */
export function evaluateQr({ profile, vertical, metrics }: AuditContext): QrRecommendation {
  const reasons: string[] = [];
  let points = 0;
  const count = profile.reviewCount ?? 0;
  const rating = profile.rating;

  if (count < 50) { points += 3; reasons.push(`Solo ${count} reseñas: el QR acelera la captación en el mostrador.`); }
  else if (count < 200) { points += 2; reasons.push(`${count} reseñas: hay margen para superar a la competencia.`); }

  if (rating !== undefined && rating < 4.5) {
    points += 2;
    reasons.push(`Calificación ${rating.toFixed(1)}★: sumar reseñas de clientes satisfechos y responder las negativas mejora la nota pública.`);
  }
  if (metrics.daysSinceLastReview !== undefined && metrics.daysSinceLastReview > 30) {
    points += 2;
    reasons.push(`Hace ~${metrics.daysSinceLastReview} días que no recibe reseñas.`);
  } else if (metrics.reviewsLast30Days !== undefined && metrics.reviewsLast30Days < vertical.healthyMonthlyReviews) {
    points += 1;
    reasons.push(`Ritmo de ${metrics.reviewsLast30Days} reseña(s)/mes, por debajo de lo sano para el rubro (${vertical.healthyMonthlyReviews}).`);
  }
  if (['gastronomia', 'belleza', 'salud', 'fitness', 'alojamiento', 'automotor', 'comercio'].includes(vertical.id)) {
    points += 1;
    reasons.push(`En ${vertical.label.toLowerCase()} hay atención presencial: el QR en mesa, mostrador o ticket funciona muy bien.`);
  }
  if (profile.isClaimed === false) reasons.push('Requiere reclamar la ficha primero para responder y gestionar reseñas.');

  const recommended = points >= 2;
  return {
    recommended,
    urgency: points >= 5 ? 'alta' : points >= 3 ? 'media' : 'baja',
    reasons: recommended ? reasons : ['La reputación ya es sólida; el QR sería un refuerzo, no una prioridad.'],
    estimatedMonthlyReviews: recommended ? Math.max(vertical.healthyMonthlyReviews, 5) : undefined,
  };
}
