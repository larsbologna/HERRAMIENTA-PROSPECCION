import type { ChannelId } from '../channels/crossCheck.js';
import type { AnalysisResult } from '../domain/types.js';
import { selectPitches, type ServiceTopic } from '../messages/pitch.js';

/**
 * OPORTUNIDADES: qué tiene el negocio, qué no tiene y qué servicio ofrecerle POR QUÉ.
 * Solo a partir de argumentos confirmados: si el negocio ya tiene algo, no se ofrece.
 */

export const TOPIC_SERVICE: Record<ServiceTopic, string> = {
  'Google Maps': 'Optimización de Google Maps',
  reseñas: 'Reseñas y reputación (QR para reseñas)',
  'páginas web': 'Página web',
  'reservas online': 'Sistema de reservas',
  WhatsApp: 'WhatsApp para negocios',
  automatizaciones: 'Automatización / WhatsApp con IA',
  'menú online': 'Menú online',
};

const LABEL: Partial<Record<ChannelId, string>> = {
  web: 'Página web', instagram: 'Instagram', whatsapp: 'WhatsApp', facebook: 'Facebook', reservas: 'Reservas', menu: 'Menú online',
};

export interface OpportunityProfile {
  has: string[];
  missing: string[];
  unverified: string[];
  opportunities: Array<{ findingId: string; service: string; why: string }>;
  /** "Página web + Sistema de reservas" */
  headline: string;
}

export function opportunityProfile(a: AnalysisResult): OpportunityProfile {
  const ch = a.channels;
  const has: string[] = [];
  const missing: string[] = [];
  const unverified: string[] = [];
  if (ch) {
    for (const c of ch.channels) {
      const label = LABEL[c.id];
      if (!label) continue;
      if (c.status === 'encontrado') has.push(c.id === 'reservas' && !c.url ? 'Reservas por WhatsApp/DM' : label);
      else if (c.status === 'no_encontrado') missing.push(label);
      else unverified.push(label);
    }
  } else if (a.profile.website) {
    has.push('Página web');
  }
  const pitches = selectPitches({
    name: a.profile.name ?? 'el negocio',
    verticalId: a.vertical.id,
    verticalLabel: a.vertical.label,
    profile: a.profile,
    website: a.website,
    metrics: a.audit.metrics,
    channels: ch,
    problems: a.proposal.salesArguments.filter((s) => !s.serviceIds || s.serviceIds.length > 0),
  }, 3);
  // Si ya tiene web o WhatsApp, lo que se ofrece es MEJORARLO (nunca "hacerle" uno nuevo).
  const hasWeb = has.includes('Página web');
  const hasWa = has.includes('WhatsApp');
  const serviceFor = (topic: ServiceTopic) =>
    topic === 'páginas web' && hasWeb ? 'Mejora de la página web' : topic === 'WhatsApp' && hasWa ? 'Automatización de WhatsApp' : TOPIC_SERVICE[topic];
  const opportunities = pitches.map((p) => ({ findingId: p.findingId, service: serviceFor(p.topic), why: p.text.split(/(?<=\.)\s/)[0]! }));
  const headline = [...new Set(opportunities.map((o) => o.service))].join(' + ') || 'Sin oportunidades confirmadas';
  return { has, missing, unverified, opportunities, headline };
}
