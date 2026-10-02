import type { AuditContext } from '../auditor/context.js';
import type { AuditResult, Proposal } from '../domain/types.js';

export function buildExecutiveSummary(ctx: AuditContext, audit: AuditResult, proposal: Proposal): string {
  const p = ctx.profile;
  const name = p.name ?? 'El negocio';
  const critical = audit.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const weakest = [...audit.scores].sort((a, b) => a.score - b.score)[0];
  const top = proposal.services.filter((s) => s.priority === 'alta').map((s) => s.name);

  const rating = p.rating !== undefined ? `${p.rating.toFixed(1)}★` : 'sin calificación visible';
  const reviews = p.reviewCount !== undefined ? `${p.reviewCount} reseñas` : 'reseñas no detectadas';
  const parts = [
    `${name}${p.category ? ` (${p.category})` : ''} obtiene una puntuación de presencia online de ${audit.overallScore}/100, con ${rating} y ${reviews} en Google Maps.`,
  ];
  if (critical.length) {
    parts.push(`Se detectaron ${critical.length} problema(s) de impacto alto, entre ellos: ${critical.slice(0, 3).map((f) => f.title.toLowerCase()).join('; ')}.`);
  } else {
    parts.push('No se detectaron problemas graves; las oportunidades están en crecimiento y automatización.');
  }
  if (weakest) parts.push(`El área más débil es ${weakest.label} (${weakest.score}/100).`);
  if (top.length) parts.push(`Servicios prioritarios: ${top.join(', ')}.`);
  parts.push(`Potencial de mejora ${proposal.potential.level.toLowerCase()}: de ${proposal.potential.currentScore} a ~${proposal.potential.projectedScore}/100.`);
  return parts.join(' ');
}
