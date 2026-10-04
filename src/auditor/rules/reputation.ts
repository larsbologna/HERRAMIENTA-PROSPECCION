import { collector, type AuditRule } from '../context.js';

export const reputationRules: AuditRule = ({ profile, vertical, metrics }) => {
  const c = collector('rules:reputation');
  // Sin contador leído no se afirma nada sobre el volumen (no es lo mismo que "0 reseñas").
  const count = profile.reviewCount ?? (profile.dataQuality?.fields.reviewCount.status === 'cero' ? 0 : undefined);

  if (count === undefined) {
    /* dato no disponible */
  } else if (count < 10) {
    c.finding({ id: 'rep-very-few-reviews', area: 'reputation', severity: 'critical', title: 'Casi sin reseñas', detail: `Solo ${count} reseñas: genera poca confianza y Google lo posiciona por debajo de la competencia.` });
  } else if (count < 50) {
    c.finding({ id: 'rep-few-reviews', area: 'reputation', severity: 'high', title: 'Pocas reseñas', detail: `${count} reseñas. Los competidores mejor posicionados suelen superar las 100.` });
  } else if (count < 100) {
    c.finding({ id: 'rep-moderate-reviews', area: 'reputation', severity: 'medium', title: 'Volumen de reseñas mejorable', detail: `${count} reseñas: hay margen claro para superar a la competencia.` });
  }

  const rating = profile.rating;
  if (rating !== undefined) {
    if (rating < 3.8) {
      c.finding({ id: 'rep-low-rating', area: 'reputation', severity: 'high', title: 'Calificación baja', detail: `${rating.toFixed(1)}★ está por debajo del umbral en el que muchos clientes descartan un negocio (≈4,0).` });
    } else if (rating < 4.3) {
      c.finding({ id: 'rep-medium-rating', area: 'reputation', severity: 'medium', title: 'Calificación mejorable', detail: `${rating.toFixed(1)}★: subir a 4,5+ marca diferencia frente a la competencia.` });
    }
  }

  const rate = metrics.ownerResponseRate;
  if (rate !== undefined) {
    const pct = Math.round(rate * 100);
    const sample = `${profile.reviews.length} reseñas recientes analizadas`;
    if (rate < 0.2) {
      c.finding({ id: 'rep-no-responses', area: 'reputation', severity: 'high', title: 'No responde a las reseñas', detail: `Solo el ${pct}% de las reseñas tiene respuesta del propietario. Responder mejora la confianza y el posicionamiento.`, evidence: sample });
    } else if (rate < 0.6) {
      c.finding({ id: 'rep-low-responses', area: 'reputation', severity: 'medium', title: 'Responde a pocas reseñas', detail: `El ${pct}% de las reseñas recientes tiene respuesta.`, evidence: sample });
    }
  }

  const negativesUnanswered = profile.reviews.filter((r) => (r.rating ?? 5) <= 3 && !r.hasOwnerResponse).length;
  if (negativesUnanswered > 0) {
    c.finding({ id: 'rep-negative-unanswered', area: 'reputation', severity: 'high', title: 'Reseñas negativas sin responder', detail: `${negativesUnanswered} reseña(s) de 3★ o menos sin respuesta en la muestra reciente: es lo primero que leen los clientes indecisos.` });
  }

  const last = metrics.daysSinceLastReview;
  if (last !== undefined && last > 60) {
    c.finding({ id: 'rep-stale-reviews', area: 'reputation', severity: 'high', title: 'Sin reseñas recientes', detail: `La última reseña tiene unos ${last} días. Google premia la actividad reciente.` });
  } else if (metrics.reviewsLast30Days !== undefined && metrics.reviewsLast30Days < vertical.healthyMonthlyReviews / 2) {
    c.finding({ id: 'rep-low-frequency', area: 'reputation', severity: 'medium', title: 'Baja frecuencia de reseñas', detail: `${metrics.reviewsLast30Days} reseña(s) en los últimos 30 días; un negocio activo de ${vertical.label.toLowerCase()} suele sumar ${vertical.healthyMonthlyReviews}+ al mes.` });
  }

  if (rate !== undefined && rate < 0.6) {
    c.opportunity({ id: 'rep-ai-replies', area: 'reputation', title: 'Respuestas a reseñas asistidas por IA', detail: 'Un agente puede redactar respuestas personalizadas a cada reseña para que el dueño solo las apruebe.' });
  }
  return c.out;
};
