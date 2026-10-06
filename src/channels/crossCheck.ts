import type { BusinessProfile, WebsiteAnalysis } from '../domain/types.js';
import { instagramFields, type InstagramAnalysis } from './instagram.js';
import { bookingProvider, isAggregator, isFacebook, isInstagram, isOwnWebsite, isWhatsAppLink, waNumber, whatsappNumberFromLink } from './links.js';

/**
 * VERIFICACIÓN CRUZADA DE CANALES: Google Maps + web + Instagram (+ Linktree).
 *
 * Para cada canal: ✓ encontrado · ✗ no encontrado · ? no verificado.
 * "No encontrado" solo se afirma cuando se revisaron TODOS los lugares donde podría estar
 * (si Instagram no se pudo revisar, la falta de reservas/WhatsApp/web queda "no verificada").
 * Nunca se confunde "no encontrado" con "no existe".
 */

export type ChannelStatus = 'encontrado' | 'no_encontrado' | 'no_verificado';
export type ChannelId = 'maps' | 'web' | 'instagram' | 'whatsapp' | 'facebook' | 'reservas' | 'menu' | 'llamada' | 'otros';

export interface Channel {
  id: ChannelId;
  label: string;
  status: ChannelStatus;
  url?: string;
  /** Dónde se encontró (o dónde se buscó). */
  sources: string[];
  detail?: string;
}

export interface ChannelReport {
  version: 1;
  checkedAt: string;
  channels: Channel[];
  /** Información contradictoria entre canales: requiere revisión manual. */
  review: string[];
  /** Número de WhatsApp confirmado (de un enlace de WhatsApp o del contacto de Instagram), listo para wa.me. */
  whatsappNumber?: string;
  whatsappSource?: string;
  /** Teléfono de Google Maps que podría ser WhatsApp (no confirmado). */
  phoneWhatsappCandidate?: string;
  instagramUrl?: string;
  instagram?: ReturnType<typeof instagramFields>;
  /** Toma reservas/turnos por WhatsApp o DM, sin sistema online. */
  manualBooking?: boolean;
  /** Si la web solo aparece en Instagram: ¿carga? (undefined = no se comprobó). */
  igWebsiteReachable?: boolean;
}

const LABELS: Record<ChannelId, string> = {
  maps: 'Google Maps',
  web: 'Página web',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  reservas: 'Reservas / turnos',
  menu: 'Menú online',
  llamada: 'Teléfono (botón de llamada)',
  otros: 'Otros links',
};

export function channelOf(r: ChannelReport | undefined, id: ChannelId): Channel | undefined {
  return r?.channels.find((c) => c.id === id);
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return u;
  }
};

export function buildChannelReport(
  profile: BusinessProfile,
  website: WebsiteAnalysis | undefined,
  ig?: InstagramAnalysis,
  extra: { igWebsiteReachable?: boolean } = {},
): ChannelReport {
  const dq = profile.dataQuality;
  const mapsInfoOk = !dq || (dq.fields.website?.status !== 'no_encontrado' && dq.fields.website?.status !== 'error');
  const mapsLinks = [...profile.socialLinks, profile.website ?? '', profile.bookingUrl ?? '', profile.menuUrl ?? ''].filter(Boolean);
  const webLinks = website?.reachable ? [...website.socialLinks, ...website.whatsapp.links] : [];
  const igLinks = ig && (ig.status === 'ok') ? [...ig.links, ...ig.linktreeLinks] : [];
  const review: string[] = [];

  // ¿Hasta dónde se pudo revisar?
  const ownWebOnMaps = profile.website && isOwnWebsite(profile.website) ? profile.website : undefined;
  const webChecked = !ownWebOnMaps || !!website?.reachable; // si hay web propia, ¿se pudo abrir?
  const instagramUrl = [...mapsLinks, ...webLinks].find(isInstagram) ?? (ig ? ig.url : undefined);
  const igChecked = !instagramUrl || (!!ig && ig.status === 'ok' && (!ig.linktree || ig.linktreeChecked));
  const igUnchecked = !!instagramUrl && !igChecked;
  /** Una ausencia solo es "no encontrado" si Maps está verificado y se revisaron web e Instagram. */
  const absent = (extraOk = true): ChannelStatus => (mapsInfoOk && webChecked && !igUnchecked && extraOk ? 'no_encontrado' : 'no_verificado');
  const pending = () => [
    !mapsInfoOk ? 'la ficha de Google no se pudo leer completa' : '',
    !webChecked ? 'la web no se pudo abrir' : '',
    igUnchecked ? `Instagram ${ig ? (ig.status === 'ok' ? 'tiene un agregador de enlaces sin revisar' : `no se pudo revisar (${ig.status})`) : 'no se revisó'}` : '',
  ].filter(Boolean).join(' · ');

  const channels: Channel[] = [];
  channels.push({ id: 'maps', label: LABELS.maps, status: 'encontrado', url: profile.resolvedUrl ?? profile.sourceUrl, sources: ['Google Maps'] });

  // ---------- Web ----------
  const igWeb = ig?.status === 'ok' ? ig.website : undefined;
  if (ownWebOnMaps) {
    channels.push({
      id: 'web', label: LABELS.web, status: 'encontrado', url: ownWebOnMaps, sources: ['Google Maps'],
      detail: website ? (website.reachable ? 'Carga correctamente' : `No carga${website.httpStatus ? ` (HTTP ${website.httpStatus})` : ''}`) : undefined,
    });
    if (website && !website.reachable && igWeb && hostOf(igWeb) !== hostOf(ownWebOnMaps)) {
      review.push(`La web de Google (${hostOf(ownWebOnMaps)}) no carga, pero Instagram enlaza a otra (${hostOf(igWeb)}): revisar cuál es la actual.`);
    } else if (igWeb && hostOf(igWeb) !== hostOf(ownWebOnMaps)) {
      review.push(`Google enlaza a ${hostOf(ownWebOnMaps)} e Instagram a ${hostOf(igWeb)}: revisar cuál es la web actual.`);
    }
  } else if (igWeb) {
    channels.push({
      id: 'web', label: LABELS.web, status: 'encontrado', url: igWeb, sources: [ig?.linktreeLinks.includes(igWeb) ? 'Instagram (Linktree)' : 'Instagram'],
      detail: `No está vinculada en Google Maps${extra.igWebsiteReachable === false ? ' · no carga' : extra.igWebsiteReachable ? ' · carga correctamente' : ''}`,
    });
    if (extra.igWebsiteReachable === false) review.push(`La web enlazada en Instagram (${hostOf(igWeb)}) no carga: revisar si sigue activa.`);
  } else {
    channels.push({ id: 'web', label: LABELS.web, status: absent(), sources: ['Google Maps', ...(instagramUrl ? ['Instagram'] : [])], detail: absent() === 'no_verificado' ? `Sin verificar: ${pending()}` : undefined });
  }

  // ---------- Instagram ----------
  if (instagramUrl) {
    const st = ig?.status;
    channels.push({
      id: 'instagram', label: LABELS.instagram, status: st === 'no_encontrado' ? 'no_encontrado' : 'encontrado', url: instagramUrl,
      sources: [mapsLinks.some(isInstagram) ? 'Google Maps' : 'Web'],
      detail: !ig ? 'Perfil no revisado' : st === 'ok' ? `Perfil revisado${ig.followers !== undefined ? ` · ${ig.followers.toLocaleString('es-AR')} seguidores` : ''}` : st === 'no_encontrado' ? 'El enlace apunta a un perfil inexistente' : `No se pudo revisar el perfil (${st})`,
    });
    if (st === 'no_encontrado') review.push('El Instagram enlazado no existe: revisar el enlace de la ficha o de la web.');
  } else {
    channels.push({ id: 'instagram', label: LABELS.instagram, status: mapsInfoOk && webChecked ? 'no_encontrado' : 'no_verificado', sources: ['Google Maps', 'Web'] });
  }

  // ---------- WhatsApp ----------
  const waMaps = mapsLinks.find(isWhatsAppLink);
  const waWeb = website?.reachable ? website.whatsapp.links.find(isWhatsAppLink) ?? (website.whatsapp.hasLink ? website.whatsapp.links[0] : undefined) : undefined;
  const waIg = ig?.status === 'ok' && (ig.whatsappLink || ig.whatsappNumber) ? (ig.whatsappLink ?? `wa.me/${ig.whatsappNumber}`) : undefined;
  const waSources = [waMaps && 'Google Maps', waWeb && 'Web', waIg && (ig?.linktreeLinks.some(isWhatsAppLink) ? 'Instagram (Linktree)' : 'Instagram')].filter(Boolean) as string[];
  const confirmedNumber =
    (waMaps && whatsappNumberFromLink(waMaps)) || (waWeb && whatsappNumberFromLink(waWeb)) || (ig?.status === 'ok' && (ig.whatsappLink ? whatsappNumberFromLink(ig.whatsappLink) : undefined)) ||
    (ig?.status === 'ok' && ig.whatsappNumber ? waNumber(ig.whatsappNumber, { assumeMobile: true }) ?? ig.whatsappNumber : undefined) || undefined;
  if (waSources.length) {
    channels.push({ id: 'whatsapp', label: LABELS.whatsapp, status: 'encontrado', url: waMaps ?? waWeb ?? waIg, sources: waSources, detail: confirmedNumber ? `+${confirmedNumber}` : undefined });
  } else {
    const st = absent(!ownWebOnMaps || !!website);
    channels.push({ id: 'whatsapp', label: LABELS.whatsapp, status: st, sources: ['Google Maps', ...(ownWebOnMaps ? ['Web'] : []), ...(instagramUrl ? ['Instagram'] : [])], detail: st === 'no_verificado' ? `Sin verificar: ${pending() || 'faltan datos'}` : 'No hay un enlace directo de WhatsApp en los canales revisados' });
  }

  // ---------- Facebook ----------
  const fb = [...mapsLinks, ...webLinks, ...igLinks].find(isFacebook);
  channels.push(fb
    ? { id: 'facebook', label: LABELS.facebook, status: 'encontrado', url: fb, sources: [mapsLinks.includes(fb) ? 'Google Maps' : webLinks.includes(fb) ? 'Web' : 'Instagram'] }
    : { id: 'facebook', label: LABELS.facebook, status: absent(), sources: ['Google Maps', 'Web', 'Instagram'] });

  // ---------- Reservas ----------
  const bookMaps = profile.hasBooking ? (profile.bookingUrl || 'Botón de reserva en la ficha') : undefined;
  const bookWeb = website?.reachable && website.booking.hasOnlineBooking ? (website.booking.providers[0] ?? 'Sistema de reservas en la web') : undefined;
  const bookIg = ig?.status === 'ok' && ig.bookingUrl ? ig.bookingUrl : undefined;
  const manual = ig?.status === 'ok' && ig.manualBooking;
  if (bookMaps || bookWeb || bookIg) {
    channels.push({
      id: 'reservas', label: LABELS.reservas, status: 'encontrado', url: bookIg ?? (profile.bookingUrl || undefined),
      sources: [bookMaps && 'Google Maps', bookWeb && 'Web', bookIg && (ig?.linktreeLinks.includes(bookIg) ? 'Instagram (Linktree)' : 'Instagram')].filter(Boolean) as string[],
      detail: [bookIg && ig?.bookingProvider, bookWeb].filter(Boolean).join(' · ') || undefined,
    });
  } else if (manual) {
    channels.push({ id: 'reservas', label: LABELS.reservas, status: 'encontrado', sources: ['Instagram (bio)'], detail: 'Toma turnos/reservas por WhatsApp o mensaje, sin sistema online' });
  } else {
    const st = absent(!ownWebOnMaps || !!website);
    channels.push({ id: 'reservas', label: LABELS.reservas, status: st, sources: ['Google Maps', ...(ownWebOnMaps ? ['Web'] : []), ...(instagramUrl ? ['Instagram'] : [])], detail: st === 'no_verificado' ? `Sin verificar: ${pending() || 'faltan datos'}` : undefined });
  }

  // ---------- Menú ----------
  channels.push(profile.hasMenu
    ? { id: 'menu', label: LABELS.menu, status: 'encontrado', url: profile.menuUrl, sources: ['Google Maps'] }
    : { id: 'menu', label: LABELS.menu, status: dq?.fields.menu?.status === 'cero' ? 'no_encontrado' : 'no_verificado', sources: ['Google Maps'] });

  // ---------- Teléfono ----------
  channels.push(profile.phone
    ? { id: 'llamada', label: LABELS.llamada, status: 'encontrado', sources: ['Google Maps'], detail: profile.phone }
    : { id: 'llamada', label: LABELS.llamada, status: dq?.fields.phone?.status === 'cero' ? 'no_encontrado' : 'no_verificado', sources: ['Google Maps'] });

  // ---------- Otros links ----------
  const others = [...new Set([...mapsLinks, ...igLinks].filter((l) => isAggregator(l) || (!isInstagram(l) && !isFacebook(l) && !isWhatsAppLink(l) && !isOwnWebsite(l) && !bookingProvider(l) && /^https?:/i.test(l))))].slice(0, 6);
  channels.push({ id: 'otros', label: LABELS.otros, status: others.length ? 'encontrado' : 'no_encontrado', url: others[0], sources: others.length ? others.map(hostOf) : ['Google Maps', 'Instagram'], detail: ig?.linktree ? `Agregador: ${hostOf(ig.linktree)}${ig.linktreeChecked ? ` (${ig.linktreeLinks.length} enlaces revisados)` : ' (sin revisar)'}` : undefined });

  // ---------- Contradicciones ----------
  const phoneDigits = profile.phone?.replace(/\D/g, '').slice(-8);
  if (ig?.status === 'ok' && ig.whatsappNumber && phoneDigits && !ig.whatsappNumber.endsWith(phoneDigits) && confirmedNumber && !confirmedNumber.endsWith(phoneDigits)) {
    // No es un error: es habitual tener fijo en Google y WhatsApp en Instagram. Se informa para usar el número correcto.
    review.push(`El WhatsApp de Instagram (+${confirmedNumber}) no coincide con el teléfono de Google (${profile.phone}).`);
  }

  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    channels,
    ...(extra.igWebsiteReachable !== undefined ? { igWebsiteReachable: extra.igWebsiteReachable } : {}),
    review,
    whatsappNumber: confirmedNumber || undefined,
    whatsappSource: confirmedNumber ? waSources[0] : undefined,
    phoneWhatsappCandidate: !confirmedNumber ? waNumber(profile.phone) : undefined,
    instagramUrl,
    instagram: instagramFields(ig),
    manualBooking: manual || undefined,
  };
}
