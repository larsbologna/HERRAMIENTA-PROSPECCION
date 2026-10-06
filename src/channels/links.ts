/**
 * Clasificación de enlaces encontrados en Google Maps, la web, Instagram o un Linktree:
 * ¿es un WhatsApp, un sistema de reservas, una red social, un agregador de enlaces o una web propia?
 */

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
};
const hostIs = (host: string | undefined, domains: readonly string[]) => !!host && domains.some((d) => host === d || host.endsWith(`.${d}`));

/** Sistemas de reservas / turnos online (mismos proveedores que detecta el análisis de la web, más los habituales en Argentina). */
export const BOOKING_PROVIDERS: Record<string, RegExp> = {
  Calendly: /calendly\.com/i,
  Booksy: /booksy\.com/i,
  Fresha: /fresha\.com/i,
  TheFork: /thefork\.|eltenedor\./i,
  OpenTable: /opentable\./i,
  Treatwell: /treatwell\./i,
  Doctoralia: /doctoralia\./i,
  SimplyBook: /simplybook\./i,
  Setmore: /setmore\.com/i,
  Acuity: /acuityscheduling\.com/i,
  'Square Appointments': /squareup\.com\/appointments|square\.site.*book/i,
  Reservio: /reservio\./i,
  AgendaPro: /agendapro\.|turnito\./i,
  CoverManager: /covermanager\./i,
  'Google Calendar (citas)': /calendar\.google\.com\/calendar\/appointments|calendar\.app\.google/i,
  'Reserva con Google': /reserve\.google\.com|google\.com\/maps\/reserve/i,
  Weinvite: /weinvite\./i,
  Turnero: /turnero\.|miturno\.|turnos?online|tuturno\./i,
  Meitre: /meitre\./i,
  Woki: /woki\.app|wokiapp/i,
  Restorando: /restorando\./i,
  Bookeo: /bookeo\.com/i,
  Appointy: /appointy\.com/i,
  Zoho: /zohobookings\.|bookings\.zoho/i,
  Microsoft: /outlook\.office365\.com\/owa\/calendar|bookings\.cloud\.microsoft/i,
  Koibox: /koibox\./i,
  Agendize: /agendize\./i,
};

const AGGREGATORS = ['linktr.ee', 'beacons.ai', 'lnk.bio', 'taplink.cc', 'linkin.bio', 'bio.link', 'campsite.bio', 'solo.to', 'linkpop.com', 'later.com', 'msha.ke', 'hoo.be', 'flow.page', 'tap.bio', 'snipfeed.co', 'bio.site', 'linkbio.co', 'carrd.co'];
const SOCIAL = ['instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'm.me', 'tiktok.com', 'twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'linkedin.com', 'threads.net', 'pinterest.com', 'ig.me'];
const NOT_A_WEBSITE = [
  'wa.me', 'whatsapp.com', 'wa.link', 'google.com', 'goo.gl', 'g.page', 'maps.app.goo.gl', 'business.site',
  'tripadvisor.com', 'tripadvisor.com.ar', 'yelp.com', 'pedidosya.com.ar', 'pedidosya.com', 'rappi.com.ar', 'rappi.com',
  'mercadopago.com.ar', 'mpago.la', 'mercadolibre.com.ar', 'spotify.com', 'apple.com', 'ubereats.com', 'glovoapp.com',
];

export const isWhatsAppLink = (url: string): boolean => /(^|\/\/|\.)(wa\.me|wa\.link)\/|api\.whatsapp\.com\/send|web\.whatsapp\.com\/send|whatsapp\.com\/send|^whatsapp:\/\//i.test(url);
export const isInstagram = (url: string): boolean => hostIs(hostOf(url), ['instagram.com']);
export const isFacebook = (url: string): boolean => hostIs(hostOf(url), ['facebook.com', 'fb.com', 'fb.me', 'm.me']);
export const isAggregator = (url: string): boolean => hostIs(hostOf(url), AGGREGATORS);

export function bookingProvider(url: string): string | undefined {
  return Object.keys(BOOKING_PROVIDERS).find((k) => BOOKING_PROVIDERS[k]!.test(url));
}

/** ¿Es una web propia del negocio? (no red social, agregador, WhatsApp, reservas, delivery ni Google). */
export function isOwnWebsite(url: string): boolean {
  const host = hostOf(url);
  if (!host || !host.includes('.')) return false;
  if (hostIs(host, [...SOCIAL, ...AGGREGATORS, ...NOT_A_WEBSITE])) return false;
  if (bookingProvider(url)) return false;
  return true;
}

/** Número de un enlace de WhatsApp (wa.me/549…, api.whatsapp.com/send?phone=…). */
export function whatsappNumberFromLink(url: string): string | undefined {
  const m = url.match(/wa\.me\/\+?(\d{8,15})/i) ?? url.match(/[?&]phone=\+?(\d{8,15})/i);
  return m?.[1];
}

/** Usuario de Instagram a partir de la URL del perfil (descarta posts, reels, etc.). */
export function instagramUsername(url: string): string | undefined {
  if (!isInstagram(url)) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const first = u.pathname.split('/').filter(Boolean)[0];
    if (!first || ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'tv', 'direct', 'about', 'developer', 'legal'].includes(first.toLowerCase())) return undefined;
    return /^[A-Za-z0-9._]{1,30}$/.test(first) ? first.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Número de WhatsApp en un texto (bio de Instagram, por ejemplo "WhatsApp 11 5555-1234" o "wsp: 2214567890").
 * Solo se toma si la palabra WhatsApp (o sus abreviaturas habituales) está pegada al número.
 */
export function whatsappNumberInText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(/(?:whats\s?app|whatsapp|wsp|wpp|whats|wap)\s*[:.\-–]?\s*(?:📲|📱|☎️?|📞)?\s*(\+?\d[\d\s().-]{7,18}\d)/i)
    ?? text.match(/(\+?\d[\d\s().-]{7,18}\d)\s*\(?\s*(?:solo\s+)?(?:whats\s?app|wsp|wpp)\b/i);
  if (!m?.[1]) return undefined;
  const digits = m[1].replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : undefined;
}

/** "Turnos/reservas por WhatsApp o DM" en un texto: toma reservas, pero sin sistema online. */
export function manualBookingInText(text: string | undefined): boolean {
  return !!text && /(turnos?|reservas?|citas?)\s*(solo\s+|únicamente\s+)?(por|al|vía|via|x)\s*(whats\s?app|wsp|wpp|dm|md|privado|mensaje|tel[eé]fono|llamad)/i.test(text);
}

/**
 * Normaliza un teléfono a formato internacional para wa.me (solo dígitos).
 * Argentina: 54 + 9 (móviles) + característica sin 0 + número sin 15. Si no se puede determinar con
 * seguridad que es un número de WhatsApp (por ejemplo, un fijo), devuelve undefined.
 */
export function waNumber(raw: string | undefined, opts: { assumeMobile?: boolean } = {}): string | undefined {
  if (!raw) return undefined;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) {
    let rest = d.slice(2);
    if (rest.startsWith('9')) return d.length >= 12 && d.length <= 13 ? d : undefined; // ya está en formato móvil
    rest = rest.replace(/^0/, '');
    // "011 15 5555-1234" → 11 5555 1234 (se quita el 15 después de la característica)
    const m15 = rest.match(/^(\d{2,4})15(\d{6,8})$/);
    if (m15 && (m15[1]!.length + m15[2]!.length === 10)) return `549${m15[1]}${m15[2]}`;
    if (rest.length === 10 && opts.assumeMobile) return `549${rest}`;
    return undefined;
  }
  if (/^0\d{9,12}$/.test(d)) {
    const rest = d.slice(1);
    const m15 = rest.match(/^(\d{2,4})15(\d{6,8})$/);
    if (m15 && (m15[1]!.length + m15[2]!.length === 10)) return `549${m15[1]}${m15[2]}`;
    if (rest.length === 10 && opts.assumeMobile) return `549${rest}`;
    return undefined;
  }
  // Sin 0 ni código de país (como se escribe en una bio): "341 15 555-0000" o "11 5555-1234".
  const m15 = d.match(/^(\d{2,4})15(\d{6,8})$/);
  if (m15 && m15[1]!.length + m15[2]!.length === 10) return `549${m15[1]}${m15[2]}`;
  if (d.length === 10 && opts.assumeMobile) return `549${d}`;
  // Números internacionales de otros países (ya con código): se aceptan tal cual.
  if (d.length >= 11 && d.length <= 15 && !d.startsWith('0') && opts.assumeMobile) return d;
  return undefined;
}

/** Enlace para abrir WhatsApp con el mensaje cargado (NO lo envía). */
export function whatsappUrl(number: string, text: string): string {
  const n = number.replace(/\D/g, '');
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
