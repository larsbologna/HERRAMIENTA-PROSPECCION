import { waNumber } from '../channels/links.js';

/**
 * PLAN DE CONTACTO de un prospecto: qué canales tiene de verdad y cuál conviene usar primero.
 *
 * Reglas:
 *  - WhatsApp CONFIRMADO solo si hay evidencia (enlace wa.me en Google Maps, la web, Instagram o su
 *    Linktree, o un número marcado como WhatsApp en la bio). Un teléfono NO es WhatsApp.
 *  - Un celular argentino sin confirmar se informa como "WhatsApp sin confirmar": se puede probar,
 *    pero la acción principal es LLAMAR.
 *  - El canal recomendado sigue un orden configurable (por defecto WhatsApp → Instagram → Teléfono →
 *    Web → Google Maps). Siempre hay una acción: como mínimo, abrir Google Maps.
 *  - "Sin canal directo detectado" es una característica del prospecto, no un error.
 */

export type ContactChannel = 'whatsapp' | 'instagram' | 'telefono' | 'web' | 'maps';
export const CONTACT_CHANNELS: readonly ContactChannel[] = ['whatsapp', 'instagram', 'telefono', 'web', 'maps'];
export const DEFAULT_CONTACT_ORDER: readonly ContactChannel[] = CONTACT_CHANNELS;
export const CHANNEL_LABEL: Record<ContactChannel, string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', telefono: 'Teléfono', web: 'Web', maps: 'Google Maps',
};
const ACTION: Record<ContactChannel, string> = {
  whatsapp: 'Contactar por WhatsApp', instagram: 'Contactar por Instagram', telefono: 'Llamar', web: 'Abrir web', maps: 'Abrir Google Maps',
};

export type WhatsappState = 'confirmado' | 'sin_confirmar' | 'no_detectado';

export interface ContactPlan {
  recommended: ContactChannel;
  /** Texto del botón principal ("Contactar por WhatsApp", "Llamar"…). */
  action: string;
  /** Por qué ese canal ("WhatsApp confirmado en Instagram (Linktree)"). */
  reason: string;
  /** false = "Sin canal directo detectado" (ni WhatsApp, ni Instagram, ni teléfono). */
  direct: boolean;
  /** Canales disponibles en el orden configurado. */
  available: ContactChannel[];
  whatsapp: { state: WhatsappState; number: string | null; source: string | null };
  phone: { display: string; tel: string } | null;
  instagramUrl: string | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
}

export interface ContactInput {
  phone?: string | null;
  whatsappNumber?: string | null;
  whatsappSource?: string | null;
  instagramUrl?: string | null;
  websiteUrl?: string | null;
  mapsUrl?: string | null;
}

/**
 * Número de WhatsApp CONFIRMADO listo para wa.me (solo dígitos con código de país).
 * Corrige lo habitual en enlaces armados a mano: sin código de país ("wa.me/1131005000"), con 0 o 15
 * ("0111531005000"), o con el 54 repetido ("5454…", "549549…"). Nunca agrega un 54 de más.
 */
export function normalizeWhatsapp(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  while (d.startsWith('549549')) d = d.slice(3);
  while (d.startsWith('5454')) d = d.slice(2);
  if (d.startsWith('54')) {
    // "54 11 15 3100-5000": el 15 local no va en el formato internacional.
    if (d.length === 14 && !d.startsWith('549')) return waNumber(`+${d}`) ?? d;
    if (d.startsWith('549') && d.length === 15) return waNumber(`+${d.slice(0, 2)}${d.slice(3)}`) ?? d;
    return d.length >= 12 && d.length <= 13 ? d : undefined;
  }
  // Sin código de país: número argentino escrito localmente (el negocio lo publicó como WhatsApp).
  if (d.startsWith('0') || d.length === 10) return waNumber(d, { assumeMobile: true });
  return d.length >= 11 && d.length <= 15 ? d : undefined;
}

/** Enlace tel: con el número tal como se marca (no se transforma: lo que funciona al discar). */
export function telHref(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  const plus = phone.trim().startsWith('+');
  const d = phone.replace(/\D/g, '');
  return d.length >= 6 ? `tel:${plus ? '+' : ''}${d}` : undefined;
}

/** Orden de canales guardado ("whatsapp,instagram,…"): se completa con los que falten. */
export function parseContactOrder(v: string | null | undefined): ContactChannel[] {
  const given = String(v ?? '').split(',').map((s) => s.trim()).filter((s): s is ContactChannel => (CONTACT_CHANNELS as readonly string[]).includes(s));
  return [...new Set([...given, ...DEFAULT_CONTACT_ORDER])];
}

export function contactPlan(c: ContactInput, order: readonly ContactChannel[] = DEFAULT_CONTACT_ORDER): ContactPlan {
  const wa = normalizeWhatsapp(c.whatsappNumber);
  const tel = telHref(c.phone);
  const mobile = !wa && c.phone ? waNumber(c.phone) : undefined; // celular argentino (15 / +54 9)
  const whatsapp = wa
    ? { state: 'confirmado' as const, number: wa, source: c.whatsappSource ?? null }
    : mobile
      ? { state: 'sin_confirmar' as const, number: mobile, source: null }
      : { state: 'no_detectado' as const, number: null, source: null };
  const has: Record<ContactChannel, boolean> = {
    whatsapp: whatsapp.state === 'confirmado',
    instagram: !!c.instagramUrl,
    telefono: !!tel,
    web: !!c.websiteUrl,
    maps: !!c.mapsUrl,
  };
  const available = parseContactOrder(order.join(',')).filter((ch) => has[ch]);
  const recommended = available[0] ?? 'maps';
  const reason = {
    whatsapp: `WhatsApp confirmado${whatsapp.source ? ` en ${whatsapp.source}` : ''}`,
    instagram: whatsapp.state === 'no_detectado' ? 'Sin WhatsApp detectado: Instagram es el canal directo disponible' : 'Instagram disponible (WhatsApp sin confirmar)',
    telefono: whatsapp.state === 'sin_confirmar' ? 'Celular disponible; WhatsApp sin confirmar' : 'Contacto disponible por teléfono',
    web: 'Sin canal directo detectado: la web puede tener un formulario o contacto',
    maps: 'Sin canal directo detectado: abrí la ficha de Google Maps para ver más datos',
  }[recommended];
  return {
    recommended,
    action: ACTION[recommended],
    reason,
    direct: has.whatsapp || has.instagram || has.telefono,
    available,
    whatsapp,
    phone: c.phone && tel ? { display: c.phone, tel } : null,
    instagramUrl: c.instagramUrl ?? null,
    websiteUrl: c.websiteUrl ?? null,
    mapsUrl: c.mapsUrl ?? null,
  };
}
