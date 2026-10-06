import { channelOf } from '../channels/crossCheck.js';
import { waNumber } from '../channels/links.js';
import { isVerified } from '../domain/reliability.js';
import type { AnalysisResult } from '../domain/types.js';
import { PITCHES } from '../messages/pitch.js';

/**
 * POTENCIAL COMERCIAL de un prospecto: 🔥 alto · 🟡 medio · ⚪ bajo, con su motivo.
 *
 * Solo usa señales VERIFICADAS: reseñas y calificación leídas de Google, canales encontrados en la
 * verificación cruzada, un contacto real (WhatsApp confirmado o teléfono) y oportunidades CONFIRMADAS.
 * Lo que no se pudo comprobar no suma ni resta.
 */

export type PotentialLevel = 'alto' | 'medio' | 'bajo';
export interface Potential {
  level: PotentialLevel;
  reason: string;
  /** Oportunidades confirmadas con argumento comercial. */
  opportunities: number;
}

const n = (v: number) => v.toLocaleString('es-AR');
const joinY = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : (xs[0] ?? ''));

/** Oportunidades CONFIRMADAS (con argumento comercial y un servicio que se ofrece). */
export function confirmedOpportunities(a: AnalysisResult): string[] {
  return [...new Set(a.proposal.salesArguments
    .filter((s) => (s.level ?? 'confirmado') === 'confirmado' && PITCHES[s.findingId] && (!s.serviceIds || s.serviceIds.length > 0) && PITCHES[s.findingId]!.priority < 9)
    .map((s) => s.findingId))];
}

export function assessPotential(a: AnalysisResult): Potential {
  const p = a.profile;
  const q = p.dataQuality;
  const ch = a.channels;
  const reviews = p.reviewCount !== undefined && isVerified(q, 'reviewCount') ? p.reviewCount : undefined;
  const rating = p.rating !== undefined && isVerified(q, 'rating') ? p.rating : undefined;
  const ig = channelOf(ch, 'instagram')?.status === 'encontrado';
  const web = channelOf(ch, 'web');
  const webOwn = web?.status === 'encontrado' && !/no carga/i.test(web.detail ?? '');
  const noWeb = web?.status === 'no_encontrado' || (!ch && !p.website);
  const wa = ch?.whatsappNumber;
  const phone = p.phone && isVerified(q, 'phone') ? p.phone : undefined;
  const contact = wa ? 'WhatsApp confirmado' : phone ? (waNumber(phone) ? 'celular de contacto' : 'teléfono de contacto') : undefined;
  const opp = confirmedOpportunities(a).length;
  const active = ig || webOwn;

  const facts: string[] = [];
  if (reviews !== undefined) facts.push(`${n(reviews)} reseñas${rating !== undefined && rating >= 4.3 ? ` (${String(rating).replace('.', ',')} ⭐)` : ''}`);
  if (ig) facts.push('Instagram encontrado');
  if (webOwn) facts.push('web propia');
  if (contact) facts.push(contact);
  if (opp) facts.push(`${opp} oportunidad${opp === 1 ? '' : 'es'} confirmada${opp === 1 ? '' : 's'}`);
  const extra = noWeb ? ' No se detectó web propia.' : '';

  if (p.permanentlyClosed) return { level: 'bajo', reason: 'Potencial bajo: figura como cerrado permanentemente en Google.', opportunities: opp };
  if (!contact) return { level: 'bajo', reason: `Potencial bajo: no hay teléfono ni WhatsApp verificado para contactarlo${facts.length ? ` (tiene ${joinY(facts)})` : ''}.`, opportunities: opp };
  if (!opp) return { level: 'bajo', reason: `Potencial bajo: no se encontraron oportunidades confirmadas${facts.length ? ` (tiene ${joinY(facts)})` : ''}.`, opportunities: opp };

  const established = reviews === undefined ? 0 : reviews >= 100 ? 2 : reviews >= 30 ? 1 : 0;
  if (established === 2 || (established === 1 && active && opp >= 2)) {
    return { level: 'alto', reason: `Potencial alto porque tiene ${joinY(facts)}.${extra}`, opportunities: opp };
  }
  if (reviews !== undefined && reviews < 10 && !active) {
    return { level: 'bajo', reason: `Potencial bajo: negocio con poca actividad visible (${joinY(facts)}).${extra}`, opportunities: opp };
  }
  return { level: 'medio', reason: `Potencial medio: ${joinY(facts)}.${extra}`, opportunities: opp };
}
