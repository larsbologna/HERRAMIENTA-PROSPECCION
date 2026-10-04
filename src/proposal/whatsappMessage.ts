import type { AuditContext } from '../auditor/context.js';
import { config } from '../config/index.js';
import type { Proposal } from '../domain/types.js';
import { composeMessages } from '../messages/whatsapp.js';

/**
 * Mensaje de primer contacto que se guarda con cada análisis.
 * El texto lo genera src/messages/whatsapp.ts (el CRM lo regenera con tus datos de Configuración).
 */
export function buildWhatsappMessage(ctx: AuditContext, proposal: Pick<Proposal, 'services' | 'salesArguments'>): string {
  return composeMessages(
    {
      seed: `${ctx.profile.name ?? ''}|${ctx.profile.address ?? ''}`,
      name: ctx.profile.name ?? 'el negocio',
      verticalId: ctx.vertical.id,
      verticalLabel: ctx.vertical.label,
      problems: proposal.salesArguments,
      services: proposal.services,
      profile: ctx.profile,
      website: ctx.website,
      metrics: ctx.metrics,
    },
    { sellerName: config.seller.name === '[tu nombre]' ? '' : config.seller.name },
  ).primerContacto;
}

/** wa.me solo funciona con prefijo internacional: si el teléfono no lo trae, se abre sin destinatario. */
export function whatsappLink(phone: string | undefined, message: string): string {
  const text = encodeURIComponent(message);
  const trimmed = phone?.trim() ?? '';
  if (/^(\+|00)/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, '').replace(/^00/, '');
    if (digits.length >= 8) return `https://wa.me/${digits}?text=${text}`;
  }
  return `https://wa.me/?text=${text}`;
}
