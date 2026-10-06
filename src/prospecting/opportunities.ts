import type { ChannelId } from '../channels/crossCheck.js';
import type { AnalysisResult } from '../domain/types.js';
import { analyzeOpportunities } from '../opportunities/engine.js';
import { GENERAL_RUBRO, type RubroProfile } from '../rubros/catalog.js';

/**
 * Resumen de oportunidades para la interfaz: qué TIENE el negocio, qué no tiene, qué no se pudo
 * verificar, qué hace bien y qué oportunidades confirmadas hay (con fuente, evidencia y confianza).
 */

const LABEL: Partial<Record<ChannelId, string>> = {
  web: 'Página web', instagram: 'Instagram', whatsapp: 'WhatsApp', facebook: 'Facebook', reservas: 'Turnos / reservas online', menu: 'Menú online',
};

export interface OpportunityProfile {
  has: string[];
  missing: string[];
  unverified: string[];
  strengths: string[];
  opportunities: Array<{ findingId: string; title: string; area: string; observation: string; why: string; source: string; evidence: string; confidence: string }>;
  /** "Sin canal rápido de consulta + Sin turnos online" */
  headline: string;
}

export function opportunityProfile(a: AnalysisResult, rubro: RubroProfile = GENERAL_RUBRO): OpportunityProfile {
  const ch = a.channels;
  const has: string[] = [];
  const missing: string[] = [];
  const unverified: string[] = [];
  if (ch) {
    for (const c of ch.channels) {
      const label = LABEL[c.id];
      if (!label) continue;
      // Un rubro que no agenda no muestra el canal de turnos/reservas (no tiene sentido para él).
      if (c.id === 'reservas' && !rubro.booking && c.status !== 'encontrado') continue;
      if (c.status === 'encontrado') has.push(c.id === 'reservas' && !c.url ? 'Turnos / reservas por WhatsApp o mensaje' : label);
      else if (c.status === 'no_encontrado') missing.push(label);
      else unverified.push(label);
    }
  } else if (a.profile.website) {
    has.push('Página web');
  }
  const report = analyzeOpportunities(a, rubro);
  const opportunities = report.opportunities.slice(0, 5).map((o) => ({
    findingId: o.id, title: o.title, area: o.area, observation: o.observation.charAt(0).toUpperCase() + o.observation.slice(1) + '.',
    why: o.consequence, source: o.source, evidence: o.evidence, confidence: o.confidence,
  }));
  const headline = opportunities.slice(0, 2).map((o) => o.title).join(' + ') || 'Sin oportunidades confirmadas';
  return { has, missing, unverified, strengths: report.strengths.map((s) => s.label), opportunities, headline };
}
