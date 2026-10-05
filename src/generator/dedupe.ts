/**
 * DETECCIÓN DE DUPLICADOS del Generador de Prospectos.
 *
 * Un negocio nunca se entrega dos veces. Claves, de mayor a menor prioridad:
 *   1. Place ID de Google (ChIJ…)
 *   2. Identificador de la ficha en la URL de Maps (0x…:0x… o /g/…) y URL canónica
 *   3. Nombre + dirección normalizados
 * Además, de forma CONSERVADORA (ante la duda, se descarta para no repetir):
 *   - mismo teléfono (8+ dígitos finales)
 *   - mismo sitio web propio (dominio)
 *   - mismo nombre y una de las dos fichas sin dirección
 *   - mismo nombre y misma calle + altura (la misma sucursal escrita distinto)
 * Dos sucursales reales (mismo nombre, otra dirección y otro teléfono) se consideran negocios distintos.
 */

export interface DedupeKeys {
  placeId?: string;
  featureId?: string;
  urlKey?: string;
  nameKey?: string;
  addressKey?: string;
  streetKey?: string;
  phoneKey?: string;
  websiteKey?: string;
}

export interface BusinessIdentity {
  name?: string;
  address?: string;
  phone?: string;
  website?: string;
  mapsUrl?: string;
  placeId?: string;
}

const strip = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Palabras que no distinguen a un negocio de otro ("Barbería El Corte S.R.L." = "El Corte"). */
const NAME_NOISE = /\b(s ?a|s ?r ?l|s ?a ?s|srl|sa|sas|y cia|cia|local|sucursal|suc|oficial|the)\b/g;

export function nameKey(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const k = strip(name).replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim();
  return k || undefined;
}

/** Quita lo que cambia entre fichas del mismo lugar: código postal, provincia, país, "Provincia de…". */
export function addressKey(address: string | undefined): string | undefined {
  if (!address) return undefined;
  let a = strip(address)
    .replace(/\b[a-z]\d{4}[a-z]{0,3}\b/g, ' ') // CPA argentino: B1878, C1043AAB
    .replace(/\b\d{4}\b(?=\s|$)/g, (m, off, str) => (/\d/.test(str.slice(0, off)) ? ' ' : m)) // CP de 4 dígitos tras la altura
    .replace(/\b(provincia de buenos aires|buenos aires|caba|ciudad autonoma de|argentina|provincia de|prov)\b/g, ' ')
    .replace(/\b(avenida|av)\b/g, 'av')
    .replace(/\b(calle|c)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  a = a.replace(/\b(esquina|esq|entre|e)\b.*$/, '').trim(); // "Mitre 123 esq. Rivadavia" = "Mitre 123"
  return a || undefined;
}

/** Calle + altura ("av calchaqui 1234"): identifica la sucursal aunque el resto de la dirección cambie. */
export function streetKey(address: string | undefined): string | undefined {
  const a = addressKey(address);
  const m = a?.match(/^(.*?\b\d{1,5})\b/);
  return m?.[1] && /[a-z]/.test(m[1]) ? m[1].trim() : undefined;
}

export function phoneKey(phone: string | undefined): string | undefined {
  const d = phone?.replace(/\D/g, '') ?? '';
  return d.length >= 8 ? d.slice(-8) : undefined;
}

/** Redes y directorios: compartir dominio no significa ser el mismo negocio (se compara la ruta completa). */
const SHARED_HOSTS = /(^|\.)(instagram\.com|facebook\.com|fb\.com|wa\.me|whatsapp\.com|linktr\.ee|tiktok\.com|twitter\.com|x\.com|youtube\.com|google\.com|goo\.gl|business\.site|negocio\.site|wixsite\.com|mercadoshops\.com\.ar|pedidosya\.com\.ar|rappi\.com\.ar|tiendanube\.com|booksy\.com|agendapro\.com|calendly\.com)$/i;

export function websiteKey(website: string | undefined): string | undefined {
  if (!website) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (SHARED_HOSTS.test(host)) {
      const path = u.pathname.replace(/\/+$/, '').toLowerCase();
      return path && path !== '/' ? `${host}${path}` : undefined;
    }
    return host;
  } catch {
    return undefined;
  }
}

/** Identificadores que Google pone en la URL de la ficha. */
export function mapsUrlIds(url: string | undefined): { placeId?: string; featureId?: string; urlKey?: string } {
  if (!url) return {};
  let u = url;
  try {
    u = decodeURIComponent(url);
  } catch {
    /* URL con escapes inválidos: se usa tal cual */
  }
  const placeId = u.match(/!19s(ChIJ[0-9A-Za-z_-]{20,})/)?.[1] ?? u.match(/[?&]query_place_id=(ChIJ[0-9A-Za-z_-]{20,})/)?.[1];
  const feature = u.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1]?.toLowerCase();
  const kg = u.match(/!16s(\/g\/[0-9a-z_]+)/i)?.[1];
  const cid = u.match(/[?&]cid=(\d+)/)?.[1];
  const featureId = feature ?? (cid ? `cid:${cid}` : undefined);
  let urlKey: string | undefined;
  try {
    const parsed = new URL(url);
    urlKey = kg ?? (featureId ? undefined : `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/+$/, ''));
  } catch {
    urlKey = kg;
  }
  return { placeId, featureId, urlKey: kg ?? urlKey };
}

export function keysFor(b: BusinessIdentity): DedupeKeys {
  const ids = mapsUrlIds(b.mapsUrl);
  return {
    placeId: b.placeId || ids.placeId,
    featureId: ids.featureId,
    urlKey: ids.urlKey,
    nameKey: nameKey(b.name),
    addressKey: addressKey(b.address),
    streetKey: streetKey(b.address),
    phoneKey: phoneKey(b.phone),
    websiteKey: websiteKey(b.website),
  };
}

/**
 * ¿Son el mismo negocio? Devuelve el motivo (para registrarlo) o undefined.
 * Pensada para equivocarse del lado de "duplicado": nunca repetir un negocio.
 */
export function duplicateReason(a: DedupeKeys, b: DedupeKeys): string | undefined {
  // Place ID distinto NO alcanza para decir que son distintos: Google tiene fichas duplicadas
  // del mismo negocio (cada una con su Place ID). Por eso se siguen comparando los demás datos.
  if (a.placeId && b.placeId && a.placeId === b.placeId) return 'mismo Place ID';
  if (a.featureId && b.featureId && a.featureId === b.featureId) return 'misma ficha de Google Maps';
  if (a.urlKey && b.urlKey && a.urlKey === b.urlKey) return 'misma URL de Google Maps';
  if (a.phoneKey && b.phoneKey && a.phoneKey === b.phoneKey) return 'mismo teléfono';
  if (a.websiteKey && b.websiteKey && a.websiteKey === b.websiteKey) return 'mismo sitio web';
  if (a.nameKey && b.nameKey && a.nameKey === b.nameKey) {
    if (a.addressKey && b.addressKey && a.addressKey === b.addressKey) return 'mismo nombre y dirección';
    if (a.streetKey && b.streetKey && a.streetKey === b.streetKey) return 'mismo nombre y misma calle y altura';
    if (!a.addressKey || !b.addressKey) return 'mismo nombre (una ficha sin dirección)';
  }
  return undefined;
}

/** Índice en memoria de negocios ya conocidos (entregados antes, en el CRM o en esta búsqueda). */
export class SeenIndex {
  private readonly items: DedupeKeys[] = [];
  private readonly byId = new Map<string, number>();

  constructor(initial: DedupeKeys[] = []) {
    for (const k of initial) this.add(k);
  }

  get size(): number {
    return this.items.length;
  }

  add(k: DedupeKeys): void {
    const i = this.items.push(k) - 1;
    for (const id of [k.placeId && `p:${k.placeId}`, k.featureId && `f:${k.featureId}`, k.urlKey && `u:${k.urlKey}`]) if (id) this.byId.set(id, i);
  }

  /** Motivo por el que `k` ya se conoce, o undefined si es nuevo. */
  match(k: DedupeKeys): string | undefined {
    // Atajo por identificadores exactos de Google.
    for (const [id, reason] of [[k.placeId && `p:${k.placeId}`, 'mismo Place ID'], [k.featureId && `f:${k.featureId}`, 'misma ficha de Google Maps'], [k.urlKey && `u:${k.urlKey}`, 'misma URL de Google Maps']] as const) {
      if (id && this.byId.has(id)) return reason;
    }
    for (const other of this.items) {
      const r = duplicateReason(k, other);
      if (r) return r;
    }
    return undefined;
  }
}
