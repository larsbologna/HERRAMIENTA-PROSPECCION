import { channelOf } from '../channels/crossCheck.js';
import { waNumber } from '../channels/links.js';
import { isVerified } from '../domain/reliability.js';
import type { AnalysisResult } from '../domain/types.js';
import { analyzeOpportunities, type OpportunityReport } from '../opportunities/engine.js';
import { DEFAULT_CATALOG, GENERAL_RUBRO, type RubroProfile } from '../rubros/catalog.js';

/**
 * PRIORIDAD COMERCIAL de un prospecto: alta · media · baja, con su motivo.
 *
 * Se calcula con señales VERIFICADAS:
 *  - demanda: cuántas reseñas tiene (gente que ya lo encuentra) y su puntuación;
 *  - cantidad e importancia de las oportunidades confirmadas para SU rubro;
 *  - si hay una oportunidad clara de conversión (contacto, turnos/reservas, catálogo): es lo más
 *    fácil de mejorar y lo que más se nota;
 *  - que exista un contacto real (sin teléfono ni WhatsApp no se puede contactar: prioridad baja).
 * Ejemplo: 4,6 estrellas y 168 reseñas, sin web ni WhatsApp → ALTA (ya tiene demanda y una
 * oportunidad clara de convertir mejor a quienes lo encuentran).
 */

export type PotentialLevel = 'alto' | 'medio' | 'bajo';
export interface Potential {
  level: PotentialLevel;
  reason: string;
  /** Oportunidades confirmadas para el rubro. */
  opportunities: number;
}

const n = (v: number) => v.toLocaleString('es-AR');
const joinY = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : (xs[0] ?? ''));
const CONVERSION = new Set(['contacto', 'agenda', 'catalogo']);

/** Oportunidades confirmadas (ids) para el rubro del prospecto. */
export function confirmedOpportunities(a: AnalysisResult, rubro?: RubroProfile): string[] {
  return analyzeOpportunities(a, rubro ?? rubroOfAnalysis(a)).opportunities.map((o) => o.id);
}

function rubroOfAnalysis(a: AnalysisResult): RubroProfile {
  const d = DEFAULT_CATALOG.detect({ category: a.profile.category, additionalCategories: a.profile.additionalCategories, name: a.profile.name });
  return d && d.confidence !== 'baja' ? DEFAULT_CATALOG.profileFor(d.key) : GENERAL_RUBRO;
}

export function assessPotential(a: AnalysisResult, rubro?: RubroProfile, report?: OpportunityReport): Potential {
  const p = a.profile;
  const q = p.dataQuality;
  const ch = a.channels;
  const r = report ?? analyzeOpportunities(a, rubro ?? rubroOfAnalysis(a));
  const opps = r.opportunities;
  const reviews = p.reviewCount !== undefined && isVerified(q, 'reviewCount') ? p.reviewCount : undefined;
  const rating = p.rating !== undefined && isVerified(q, 'rating') ? p.rating : undefined;
  const wa = ch?.whatsappNumber;
  const phone = p.phone && isVerified(q, 'phone') ? p.phone : undefined;
  const contact = wa ? 'WhatsApp confirmado' : phone ? (waNumber(phone) ? 'celular de contacto' : 'teléfono de contacto') : undefined;
  const lead = opps[0];

  const facts: string[] = [];
  if (reviews !== undefined) facts.push(`${n(reviews)} reseñas${rating !== undefined && rating >= 4.3 ? ` (${String(rating).replace('.', ',')} ⭐)` : ''}`);
  if (channelOf(ch, 'instagram')?.status === 'encontrado') facts.push('Instagram encontrado');
  if (contact) facts.push(contact);
  if (opps.length) facts.push(`${opps.length} oportunidad${opps.length === 1 ? '' : 'es'} clara${opps.length === 1 ? '' : 's'} (${opps.slice(0, 2).map((o) => o.title.toLowerCase()).join('; ')})`);

  if (p.permanentlyClosed) return { level: 'bajo', reason: 'Prioridad baja: figura como cerrado permanentemente en Google.', opportunities: opps.length };
  if (!contact) return { level: 'bajo', reason: `Prioridad baja: no hay teléfono ni WhatsApp verificado para contactarlo${facts.length ? ` (tiene ${joinY(facts)})` : ''}.`, opportunities: opps.length };
  if (!opps.length) return { level: 'bajo', reason: `Prioridad baja: no se encontraron oportunidades claras para su rubro${facts.length ? ` (tiene ${joinY(facts)})` : ''}.`, opportunities: 0 };

  let points = 0;
  const demand = reviews === undefined ? 0 : reviews >= 100 ? 3 : reviews >= 40 ? 2 : reviews >= 15 ? 1 : 0;
  points += demand; // demanda: gente que ya lo encuentra
  if (rating !== undefined && rating >= 4.4) points += 1; // reputación para aprovechar
  points += opps.length >= 3 ? 2 : 1; // cantidad de oportunidades
  if (lead && lead.score >= 10) points += 1; // importancia para el rubro
  const conversion = !!lead && CONVERSION.has(lead.topic);
  if (conversion) points += 1; // fácil de mejorar y se nota rápido
  const why = reviews !== undefined && reviews >= 40 && conversion ? ' Ya tiene demanda y hay una oportunidad clara de convertir mejor a quienes lo encuentran.' : '';

  // Negocio muy chico o con muy poca actividad visible: poca información para priorizarlo.
  const active = channelOf(ch, 'instagram')?.status === 'encontrado' || channelOf(ch, 'web')?.status === 'encontrado';
  if (reviews !== undefined && reviews < 10 && !active) return { level: 'bajo', reason: `Prioridad baja: negocio con muy poca actividad visible (${joinY(facts)}).`, opportunities: opps.length };
  // Alta solo con demanda visible (40+ reseñas): es donde una mejora de conversión se nota enseguida.
  if (points >= 6 && demand >= 2) return { level: 'alto', reason: `Prioridad alta porque tiene ${joinY(facts)}.${why}`, opportunities: opps.length };
  if (points >= 3) return { level: 'medio', reason: `Prioridad media: ${joinY(facts)}.${why}`, opportunities: opps.length };
  return { level: 'bajo', reason: `Prioridad baja: poca actividad visible (${joinY(facts)}).`, opportunities: opps.length };
}
