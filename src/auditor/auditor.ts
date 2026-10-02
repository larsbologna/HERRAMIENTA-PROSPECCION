import type { AreaScore, AuditArea, AuditResult, BusinessProfile, Finding, Severity, WebsiteAnalysis } from '../domain/types.js';
import { detectVertical, type Vertical } from '../domain/verticals.js';
import type { AuditContext, AuditRule } from './context.js';
import { computeMetrics } from './metrics.js';
import { evaluateQr } from './qr.js';
import { mapsRules } from './rules/maps.js';
import { reputationRules } from './rules/reputation.js';
import { websiteRules } from './rules/website.js';
import { whatsappRules } from './rules/whatsapp.js';

/** Reglas activas. Para añadir un chequeo nuevo, crear un AuditRule y registrarlo aquí. */
export const DEFAULT_RULES: AuditRule[] = [mapsRules, websiteRules, whatsappRules, reputationRules];

/** Fracción de la puntuación que resta cada hallazgo (se aplican de forma multiplicativa). */
const PENALTY: Record<Severity, number> = { critical: 0.35, high: 0.2, medium: 0.1, low: 0.04 };
export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const AREA_LABEL: Record<Exclude<AuditArea, 'qr'>, string> = {
  maps: 'Google Maps',
  website: 'Sitio web',
  whatsapp: 'WhatsApp',
  reputation: 'Reputación',
};
/** Peso de cada área en la puntuación global. */
const AREA_WEIGHT: Record<Exclude<AuditArea, 'qr'>, number> = { maps: 0.3, website: 0.25, reputation: 0.3, whatsapp: 0.15 };

/** Puntuación máxima del área cuando aparece cierto hallazgo. */
const AREA_CAPS: Record<string, number> = {
  'web-none': 0,
  'web-down': 5,
  'web-social-only': 20,
  'wa-not-visible': 35,
  'maps-closed': 10,
  'rep-very-few-reviews': 30,
};

export function buildContext(profile: BusinessProfile, website?: WebsiteAnalysis, vertical?: Vertical): AuditContext {
  return {
    profile,
    website,
    vertical: vertical ?? detectVertical(profile.category, profile.name),
    metrics: computeMetrics(profile),
  };
}

export function runAudit(ctx: AuditContext, rules: AuditRule[] = DEFAULT_RULES): AuditResult {
  const findings: Finding[] = [];
  const opportunities: AuditResult['opportunities'] = [];
  for (const rule of rules) {
    const out = rule(ctx);
    findings.push(...out.findings);
    opportunities.push(...out.opportunities);
  }
  return finalizeAudit(ctx, findings, opportunities);
}

/** Recalcula puntuaciones y QR a partir de hallazgos (se reutiliza cuando un agente añade hallazgos). */
export function finalizeAudit(ctx: AuditContext, findings: Finding[], opportunities: AuditResult['opportunities']): AuditResult {
  const sorted = dedupe(findings).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const scores = scoreAreas(ctx, sorted);
  const overallScore = Math.round(
    scores.reduce((sum, s) => sum + s.score * AREA_WEIGHT[s.area as keyof typeof AREA_WEIGHT], 0),
  );
  return { findings: sorted, opportunities: dedupe(opportunities), scores, overallScore, qr: evaluateQr(ctx), metrics: ctx.metrics };
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

function scoreAreas(ctx: AuditContext, findings: Finding[]): AreaScore[] {
  return (Object.keys(AREA_LABEL) as Array<keyof typeof AREA_LABEL>).map((area) => {
    const areaFindings = findings.filter((f) => f.area === area);
    // Multiplicativo: cada problema resta sobre lo que queda, así un área muy descuidada
    // se distingue de una abandonada por completo (evita los 0/100 poco creíbles).
    let score = Math.round(100 * areaFindings.reduce((acc, f) => acc * (1 - PENALTY[f.severity]), 1));
    // La web aprovecha además las métricas técnicas medidas.
    if (area === 'website' && ctx.website?.reachable && !ctx.website.isSocialOrDirectory) {
      const s = ctx.website.scores;
      score = Math.round((score + (s.visual + s.mobile + s.speed + s.contact) / 4) / 2);
    }
    // Topes para situaciones que, por sí solas, invalidan el área.
    const cap = areaFindings.reduce((min, f) => Math.min(min, AREA_CAPS[f.id] ?? 100), 100);
    score = Math.max(0, Math.min(cap, score));
    return { area, label: AREA_LABEL[area], score, summary: summarize(score, areaFindings.length) };
  });
}

function summarize(score: number, issues: number): string {
  if (score >= 85) return issues ? 'Bien trabajado, con detalles menores.' : 'Muy bien trabajado.';
  if (score >= 65) return `Aceptable, con ${issues} punto(s) a mejorar.`;
  if (score >= 40) return `Débil: ${issues} problema(s) que restan clientes.`;
  return `Crítico: ${issues} problema(s) importantes.`;
}
