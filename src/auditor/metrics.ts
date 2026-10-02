import type { AuditResult, BusinessProfile } from '../domain/types.js';

/** Métricas derivadas de la muestra de reseñas y publicaciones. */
export function computeMetrics(profile: BusinessProfile): AuditResult['metrics'] {
  const ages = profile.reviews.map((r) => r.ageDays).filter((a): a is number => a !== undefined);
  const metrics: AuditResult['metrics'] = {};
  if (ages.length) {
    metrics.daysSinceLastReview = Math.min(...ages);
    // Si la muestra no llega a cubrir 30/90 días, el conteo es un mínimo (se informa como "al menos").
    metrics.reviewsLast30Days = ages.filter((a) => a <= 30).length;
    metrics.reviewsLast90Days = ages.filter((a) => a <= 90).length;
  }
  if (profile.reviews.length >= 3) {
    const answered = profile.reviews.filter((r) => r.hasOwnerResponse).length;
    metrics.ownerResponseRate = Math.round((answered / profile.reviews.length) * 100) / 100;
  }
  const postAges = profile.posts.map((p) => p.ageDays).filter((a): a is number => a !== undefined);
  if (postAges.length) metrics.daysSinceLastPost = Math.min(...postAges);
  return metrics;
}
