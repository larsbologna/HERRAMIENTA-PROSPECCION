import type { Browser, BrowserContext } from 'playwright';
import { newDesktopContext } from '../scraper/browser.js';
import {
  bookingProvider,
  isAggregator,
  isFacebook,
  isOwnWebsite,
  isWhatsAppLink,
  instagramUsername,
  manualBookingInText,
  whatsappNumberFromLink,
  whatsappNumberInText,
} from './links.js';

/**
 * ANÁLISIS DEL PERFIL PÚBLICO DE INSTAGRAM.
 *
 * No alcanza con saber que el negocio tiene Instagram: se lee la bio, el link de la bio, los datos
 * de contacto del perfil de empresa y, si el link es un agregador (Linktree y similares), sus enlaces.
 * Así se sabe si ya tiene reservas, WhatsApp o web antes de decir que le faltan.
 *
 * Instagram a veces exige iniciar sesión: en ese caso el estado queda "bloqueado" y NADA de lo que
 * dependa de Instagram se afirma (queda como "no verificado").
 */

export type InstagramStatus = 'ok' | 'parcial' | 'bloqueado' | 'no_encontrado' | 'error';

export interface InstagramAnalysis {
  url: string;
  username?: string;
  status: InstagramStatus;
  fullName?: string;
  biography?: string;
  category?: string;
  isBusiness?: boolean;
  isPrivate?: boolean;
  followers?: number;
  posts?: number;
  /** Link principal de la bio. */
  externalUrl?: string;
  /** Todos los enlaces encontrados (bio, link de la bio, agregador). */
  links: string[];
  /** Contacto visible del perfil de empresa (botón Llamar / Enviar mail / WhatsApp). */
  contactAvailable: boolean;
  contactMethod?: string;
  phone?: string;
  email?: string;
  whatsappNumber?: string;
  whatsappLink?: string;
  website?: string;
  linktree?: string;
  /** Enlaces dentro del agregador (Linktree…), si se pudo abrir. */
  linktreeLinks: string[];
  linktreeChecked: boolean;
  bookingUrl?: string;
  bookingProvider?: string;
  /** Toma turnos/reservas por WhatsApp o DM (sin sistema online). */
  manualBooking: boolean;
  facebook?: string;
  notes: string[];
  checkedAt: string;
}

export interface InstagramOptions {
  /** Base de Instagram (los tests la apuntan a un servidor simulado). */
  baseUrl?: string;
  timeoutMs?: number;
  /** Abrir el agregador de enlaces (Linktree…) para ver qué contiene. Por defecto true. */
  followAggregator?: boolean;
}

/** Campos guardados con los nombres pedidos (instagram_url, instagram_username…). */
export function instagramFields(ig: InstagramAnalysis | undefined) {
  if (!ig) return undefined;
  return {
    instagram_url: ig.url,
    instagram_username: ig.username ?? null,
    instagram_contact_available: ig.status === 'ok' ? ig.contactAvailable : null,
    instagram_whatsapp_available: ig.status === 'ok' ? !!(ig.whatsappNumber || ig.whatsappLink) : null,
    instagram_booking_available: ig.status === 'ok' ? !!(ig.bookingUrl || ig.manualBooking) : null,
    instagram_website_url: ig.website ?? null,
    instagram_external_link: ig.externalUrl ?? null,
    instagram_linktree: ig.linktree ?? null,
    instagram_booking_provider: ig.bookingProvider ?? (ig.manualBooking ? 'Por WhatsApp/DM (sin sistema online)' : null),
    instagram_analysis_status: ig.status,
    instagram_notes: ig.notes,
  };
}

const URL_IN_TEXT = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|ar|net|org|app|site|online|store|shop|ly|me|io|co|link|bio|ee|page|club|info|tienda)(?:\.[a-z]{2})?(?:\/[^\s)]*)?)/gi;

/** Instagram envuelve los enlaces externos en l.instagram.com/?u=… */
function unwrap(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)l\.instagram\.com$/.test(u.hostname) && u.searchParams.get('u')) return u.searchParams.get('u')!;
    return url;
  } catch {
    return url;
  }
}
const withScheme = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

interface IgUser {
  biography?: string;
  bio_links?: Array<{ url?: string; lynx_url?: string }>;
  external_url?: string | null;
  full_name?: string;
  is_business_account?: boolean;
  is_professional_account?: boolean;
  is_private?: boolean;
  business_category_name?: string | null;
  category_name?: string | null;
  business_phone_number?: string | null;
  business_email?: string | null;
  business_contact_method?: string | null;
  edge_followed_by?: { count?: number };
  edge_owner_to_timeline_media?: { count?: number };
}

export async function analyzeInstagram(browser: Browser, profileUrl: string, opts: InstagramOptions = {}): Promise<InstagramAnalysis> {
  const base = (opts.baseUrl ?? 'https://www.instagram.com').replace(/\/$/, '');
  const username = instagramUsername(profileUrl);
  const out: InstagramAnalysis = {
    url: username ? `https://www.instagram.com/${username}/` : profileUrl,
    username,
    status: 'error',
    links: [],
    contactAvailable: false,
    linktreeLinks: [],
    linktreeChecked: false,
    manualBooking: false,
    notes: [],
    checkedAt: new Date().toISOString(),
  };
  if (!username) {
    out.notes.push('El enlace no es un perfil de Instagram.');
    return out;
  }
  const timeout = opts.timeoutMs ?? 20_000;
  let context: BrowserContext | undefined;
  try {
    context = await newDesktopContext(browser);
    let user: IgUser | undefined;

    // 1) Datos públicos del perfil (lo mismo que ve cualquier visitante sin sesión).
    const res = await context.request
      .get(`${base}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
        headers: { 'x-ig-app-id': '936619743392459', accept: 'application/json', 'x-requested-with': 'XMLHttpRequest', referer: `${base}/${username}/` },
        timeout,
        failOnStatusCode: false,
      })
      .catch(() => undefined);
    if (res?.status() === 404) {
      out.status = 'no_encontrado';
      out.notes.push('El perfil no existe o fue eliminado.');
      return out;
    }
    if (res?.ok()) {
      const json = (await res.json().catch(() => undefined)) as { data?: { user?: IgUser | null } } | undefined;
      if (json?.data && json.data.user === null) {
        out.status = 'no_encontrado';
        out.notes.push('El perfil no existe o fue eliminado.');
        return out;
      }
      user = json?.data?.user ?? undefined;
    }

    if (user) {
      out.status = 'ok';
      out.fullName = user.full_name || undefined;
      out.biography = user.biography || undefined;
      out.category = user.category_name || user.business_category_name || undefined;
      out.isBusiness = !!(user.is_business_account || user.is_professional_account);
      out.isPrivate = !!user.is_private;
      out.followers = user.edge_followed_by?.count;
      out.posts = user.edge_owner_to_timeline_media?.count;
      out.externalUrl = user.external_url ? unwrap(user.external_url) : undefined;
      out.phone = user.business_phone_number || undefined;
      out.email = user.business_email || undefined;
      out.contactMethod = user.business_contact_method || undefined;
      out.contactAvailable = !!(out.phone || out.email);
      const links = [out.externalUrl, ...(user.bio_links ?? []).map((l) => (l.url ? unwrap(l.url) : l.lynx_url ? unwrap(l.lynx_url) : undefined))];
      for (const m of (out.biography ?? '').matchAll(URL_IN_TEXT)) links.push(withScheme(m[1]!));
      out.links = [...new Set(links.filter((l): l is string => !!l))];
      if (out.isPrivate) out.notes.push('Cuenta privada: solo se leyó la bio y sus enlaces.');
    } else {
      // 2) Sin datos estructurados: se intenta la página pública del perfil.
      const page = await context.newPage();
      const resp = await page.goto(`${base}/${username}/`, { waitUntil: 'domcontentloaded', timeout }).catch(() => null);
      if (resp?.status() === 404) {
        out.status = 'no_encontrado';
        out.notes.push('El perfil no existe o fue eliminado.');
        return out;
      }
      const html = (await page.content().catch(() => '')) ?? '';
      if (/\/accounts\/login/.test(page.url()) || !resp) {
        out.status = 'bloqueado';
        out.notes.push('Instagram pidió iniciar sesión: no se pudo revisar el perfil. Lo que dependa de Instagram queda "no verificado".');
        return out;
      }
      const meta = await page.$eval('meta[property="og:description"]', (m) => m.getAttribute('content') ?? '').catch(() => '');
      const ext = html.match(/"external_url":"([^"]+)"/)?.[1]?.replace(/\\\//g, '/');
      const bio = html.match(/"biography":"((?:[^"\\]|\\.)*)"/)?.[1];
      if (ext || bio) {
        out.status = 'ok';
        out.externalUrl = ext ? unwrap(ext) : undefined;
        try {
          out.biography = bio ? (JSON.parse(`"${bio}"`) as string) : undefined;
        } catch {
          out.biography = bio;
        }
        const links = [out.externalUrl];
        for (const m of (out.biography ?? '').matchAll(URL_IN_TEXT)) links.push(withScheme(m[1]!));
        out.links = [...new Set(links.filter((l): l is string => !!l))];
      } else if (meta) {
        out.status = 'parcial';
        out.notes.push('El perfil existe, pero no se pudo leer la bio ni su link: lo que dependa de Instagram queda "no verificado".');
        return out;
      } else {
        out.status = 'bloqueado';
        out.notes.push('Instagram no mostró el perfil sin iniciar sesión.');
        return out;
      }
    }

    // 3) Agregador de enlaces (Linktree, Beacons…): se abre para ver qué contiene.
    out.linktree = out.links.find(isAggregator);
    if (out.linktree && opts.followAggregator !== false) {
      try {
        const page = await context.newPage();
        await page.goto(out.linktree, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForTimeout(800);
        const hrefs = (await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href))) as string[];
        out.linktreeLinks = [...new Set(hrefs.filter((h) => /^https?:|^whatsapp:/i.test(h)).map(unwrap))].filter((h) => !isAggregator(h)).slice(0, 40);
        out.linktreeChecked = true;
      } catch (err) {
        out.notes.push(`No se pudo abrir ${out.linktree}: ${(err as Error).message.split('\n')[0]}`);
      }
    }

    // 4) Qué hay en todos esos enlaces.
    const all = [...out.links, ...out.linktreeLinks];
    out.whatsappLink = all.find(isWhatsAppLink);
    out.whatsappNumber =
      (out.whatsappLink && whatsappNumberFromLink(out.whatsappLink)) ||
      whatsappNumberInText(out.biography) ||
      (out.contactMethod?.toUpperCase() === 'WHATSAPP' && out.phone ? out.phone.replace(/\D/g, '') : undefined) ||
      undefined;
    const booking = all.find((l) => bookingProvider(l));
    if (booking) {
      out.bookingUrl = booking;
      out.bookingProvider = bookingProvider(booking);
    } else {
      const reserveLink = all.find((l) => /reserv|turno|agenda|booking|book-?now|citas?/i.test(l) && !isWhatsAppLink(l));
      if (reserveLink) {
        out.bookingUrl = reserveLink;
        out.bookingProvider = 'Enlace de reservas';
      }
    }
    out.manualBooking = !out.bookingUrl && manualBookingInText(out.biography);
    out.website = all.find(isOwnWebsite);
    out.facebook = all.find(isFacebook);
    if (out.linktree && !out.linktreeChecked && opts.followAggregator !== false) out.notes.push('Hay un agregador de enlaces que no se pudo revisar: su contenido queda "no verificado".');
    return out;
  } catch (err) {
    out.status = 'error';
    out.notes.push(`No se pudo revisar Instagram: ${(err as Error).message.split('\n')[0]}`);
    return out;
  } finally {
    await context?.close().catch(() => {});
  }
}
