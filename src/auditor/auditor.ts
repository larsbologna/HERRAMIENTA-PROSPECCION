import type { AreaScore, AuditArea, AuditResult, BusinessProfile, Finding, Severity, WebsiteAnalysis } from '../domain/types.js';
import { channelOf, type ChannelReport } from '../channels/crossCheck.js';
import { FINDING_BASIS, isVerified } from '../domain/reliability.js';
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

export function buildContext(profile: BusinessProfile, website?: WebsiteAnalysis, vertical?: Vertical, channels?: ChannelReport): AuditContext {
  return {
    profile,
    website,
    vertical: vertical ?? detectVertical(profile.category, profile.name),
    metrics: trustedMetrics(profile),
    ...(channels ? { channels } : {}),
  };
}

/**
 * VERIFICACIÓN CRUZADA: no recomendar lo que el negocio YA tiene.
 * - Si otro canal muestra que lo tiene (p. ej. reservas en el link de Instagram) → se descarta.
 * - Si no se pudo revisar ese otro canal → queda "probable" (se muestra, no va en el mensaje).
 * - Si la web existe en Instagram pero no en Google → oportunidad real: "web no vinculada en Maps".
 */
function applyChannels(ctx: AuditContext, findings: Finding[]): { kept: Finding[]; contradicted: NonNullable<AuditResult['contradicted']> } {
  const r = ctx.channels;
  const contradicted: NonNullable<AuditResult['contradicted']> = [];
  if (!r) return { kept: findings, contradicted };
  const ch = (id: Parameters<typeof channelOf>[1]) => channelOf(r, id);
  const where = (id: Parameters<typeof channelOf>[1]) => ch(id)?.sources.join(', ') ?? '';
  const kept: Finding[] = [];
  let webElsewhere: string | undefined;
  for (const f of findings) {
    const absence = ABSENCE_CHANNEL[f.id];
    if (absence) {
      const c = ch(absence);
      if (c?.status === 'encontrado') {
        // Toma turnos por WhatsApp/DM: tiene reservas (manuales). No se dice "no tiene reservas"; queda para revisar.
        if (absence === 'reservas' && r.manualBooking && !c.url) {
          kept.push({ ...f, level: 'probable', levelNote: 'Toma turnos por WhatsApp o mensaje (según Instagram): no tiene un sistema online, pero sí recibe reservas.' });
          continue;
        }
        if (absence === 'web') webElsewhere = c.url;
        contradicted.push({ findingId: f.id, title: f.title, reason: `${c.label}: encontrado en ${where(absence)}${c.url ? ` (${c.url})` : ''}` });
        continue;
      }
      if (c?.status === 'no_verificado') {
        kept.push({ ...f, level: 'probable', levelNote: `${c.label}: ${c.detail ?? 'no se pudieron revisar todos los canales'}` });
        continue;
      }
    }
    // Deducción, no dato observado: nunca se afirma en el mensaje.
    if (f.id === 'wa-no-auto-reply') {
      kept.push({ ...f, level: 'probable', levelNote: 'Se deduce porque no hay chat ni bot en la web; las respuestas automáticas de WhatsApp no se ven desde afuera.' });
      continue;
    }
    kept.push({ ...f, level: 'confirmado' });
  }
  // Solo si se comprobó que esa web carga: no se recomienda vincular una web caída.
  if (webElsewhere && r.igWebsiteReachable !== false) {
    kept.push({
      id: 'web-not-in-maps', area: 'maps', severity: 'medium', source: 'canales', level: 'confirmado',
      ...(r.igWebsiteReachable === undefined ? { level: 'probable' as const, levelNote: 'No se comprobó si esa web carga.' } : {}),
      title: 'La web no está vinculada en Google Maps',
      detail: `Tienen web (${webElsewhere}, enlazada desde ${where('web')}) pero la ficha de Google no la muestra: quien los encuentra en Maps no llega a ella.`,
      evidence: webElsewhere,
    });
  }
  return { kept, contradicted };
}

/** Problemas que afirman que FALTA un canal (se contrastan con los demás canales). */
const ABSENCE_CHANNEL: Record<string, Parameters<typeof channelOf>[1]> = {
  'web-none': 'web',
  'web-social-only': 'web',
  'wa-not-visible': 'whatsapp',
  'booking-none': 'reservas',
  'web-no-booking': 'reservas',
};

/** Métricas derivadas, sin las que se apoyan en datos no verificados. */
function trustedMetrics(profile: BusinessProfile): AuditResult['metrics'] {
  const metrics = computeMetrics(profile);
  const q = profile.dataQuality;
  if (!isVerified(q, 'reviewsRecency')) {
    delete metrics.daysSinceLastReview;
    delete metrics.reviewsLast30Days;
    delete metrics.reviewsLast90Days;
  }
  if (!isVerified(q, 'reviewsSample')) delete metrics.ownerResponseRate;
  if (!isVerified(q, 'posts')) delete metrics.daysSinceLastPost;
  return metrics;
}

/**
 * Solo se afirman los problemas cuyos datos están verificados. El resto queda registrado
 * como "sin verificar" para revisarlo a mano, sin afectar el score ni generar argumentos.
 */
function gateFindings(ctx: AuditContext, findings: Finding[]): { kept: Finding[]; unverified: NonNullable<AuditResult['unverified']> } {
  const q = ctx.profile.dataQuality;
  const kept: Finding[] = [];
  const unverified: NonNullable<AuditResult['unverified']> = [];
  for (const f of findings) {
    const basis = FINDING_BASIS[f.id] ?? [];
    let missing = basis.filter((field) => !isVerified(q, field));
    // WhatsApp "no visible": si hay web pero no se pudo abrir, no se sabe qué tiene.
    if (q && f.id === 'wa-not-visible' && ctx.profile.website && !ctx.website?.reachable) missing = [...missing, 'website'];
    // "Sin respuesta automática" solo se puede comprobar revisando una web propia (chat/bot);
    // sin web no hay dónde mirarlo (las respuestas automáticas de WhatsApp no se ven desde fuera).
    if (q && f.id === 'wa-no-auto-reply' && !(ctx.website?.reachable && !ctx.website.isSocialOrDirectory)) missing = [...missing, 'website'];
    if (missing.length) unverified.push({ findingId: f.id, title: f.title, fields: [...new Set(missing)] });
    else kept.push(f);
  }
  return { kept, unverified };
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
  const gated = gateFindings(ctx, dedupe(findings));
  const unverified = gated.unverified;
  const { kept, contradicted } = applyChannels(ctx, gated.kept);
  const sorted = kept.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const scores = scoreAreas(ctx, sorted);
  const overallScore = Math.round(
    scores.reduce((sum, s) => sum + s.score * AREA_WEIGHT[s.area as keyof typeof AREA_WEIGHT], 0),
  );
  return {
    findings: sorted, opportunities: dedupe(opportunities), scores, overallScore, qr: evaluateQr(ctx), metrics: ctx.metrics,
    ...(ctx.profile.dataQuality ? { unverified } : {}),
    ...(ctx.channels ? { contradicted } : {}),
  };
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
