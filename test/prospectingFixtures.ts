/**
 * "Google Maps" simulado para la prospección automática: barberías, gimnasios y casos trampa
 * (peluquerías mezcladas en la búsqueda de barberías, el mismo negocio con otro nombre, etc.).
 * Con la deduplicación y el filtro de rubro REALES; sin navegador.
 */
import { buildAnalysis, type analyze } from '../src/analyzer.js';
import { buildChannelReport } from '../src/channels/crossCheck.js';
import type { InstagramAnalysis } from '../src/channels/instagram.js';
import type { BusinessProfile } from '../src/domain/types.js';
import { keysFor, SeenIndex } from '../src/generator/dedupe.js';
import type { GeneratedCandidate, generateProspects } from '../src/generator/generator.js';
import { opportunityScore } from '../src/generator/score.js';

export interface FakeBusiness {
  name: string;
  category: string;
  address: string;
  phone?: string;
  rating?: number;
  reviews?: number;
  website?: string;
  instagram?: string;
  /** Enlaces dentro del Linktree de Instagram (reservas, WhatsApp…). */
  igLinks?: string[];
  igWhatsapp?: string;
  hasHours?: boolean;
  /** El análisis de este negocio falla (para probar que no frena la búsqueda). */
  failAnalysis?: boolean;
}

const pad = (n: number) => String(n).padStart(4, '0');
export const mapsUrlOf = (b: FakeBusiness, i: number) => `https://www.google.com/maps/place/${encodeURIComponent(b.name)}/data=!1s0x95a3:0x${pad(i)}${b.name.length}`;

/** 25 barberías reales del barrio + 2 peluquerías que Google mezcla en la búsqueda. */
export function barberias(): FakeBusiness[] {
  const out: FakeBusiness[] = [];
  for (let i = 1; i <= 25; i++) {
    out.push({
      name: `Barbería Navaja ${i}`, category: 'Barbería', address: `Calle ${100 + i} ${i * 10}, Quilmes`, phone: `011 15 4${pad(i).slice(1)}-${pad(i)}`,
      rating: 4 + (i % 10) / 10, reviews: i % 3 === 0 ? 180 + i : 20 + i, hasHours: i % 4 !== 0,
      ...(i % 2 === 0 ? { instagram: `https://www.instagram.com/navaja${i}/` } : {}),
      ...(i % 5 === 0 ? { igLinks: [`https://booksy.com/es-ar/${i}_navaja`] } : {}),
      ...(i % 6 === 0 ? { website: `https://navaja${i}.com.ar` } : {}),
    });
  }
  out.splice(3, 0, { name: 'Peluquería Lola', category: 'Peluquería', address: 'Mitre 10, Quilmes', phone: '011 15 5000-0001', reviews: 40, rating: 4.5 });
  out.splice(8, 0, { name: 'Salón Bella', category: 'Salón de belleza', address: 'Mitre 20, Quilmes', phone: '011 15 5000-0002', reviews: 12, rating: 4.1 });
  return out;
}

export function gimnasios(): FakeBusiness[] {
  return Array.from({ length: 6 }, (_, i) => ({
    name: `Gimnasio Fuerza ${i + 1}`, category: 'Gimnasio', address: `Av. Calchaquí ${1000 + i}, Quilmes`, phone: `011 4${300 + i}-${8000 + i}`,
    rating: 4.4, reviews: 90 + i * 30, instagram: `https://www.instagram.com/fuerza${i + 1}/`,
  }));
}

/** Veterinarias (turnos) con buena reputación y sin WhatsApp ni web. */
export function veterinarias(): FakeBusiness[] {
  return Array.from({ length: 4 }, (_, i) => ({
    name: `Veterinaria Laprida ${i + 1}`, category: 'Veterinario', address: `Laprida ${200 + i}, Quilmes`, phone: `011 15 3${String(100 + i)}-${String(5000 + i)}`,
    rating: 4.6, reviews: 120 + i * 20,
  }));
}

/** Pet shops (productos: nunca turnos ni reservas), con Instagram. */
export function petShops(): FakeBusiness[] {
  return Array.from({ length: 3 }, (_, i) => ({
    name: `Pet Shop Mundo Animal ${i + 1}`, category: 'Tienda de mascotas', address: `Mitre ${700 + i}, Quilmes`, phone: `011 15 2${String(100 + i)}-${String(6000 + i)}`,
    rating: 4.4, reviews: 60 + i * 10, instagram: `https://www.instagram.com/mundoanimal${i + 1}/`,
  }));
}

/** Un Google Maps simulado: por rubro (en minúsculas) → negocios. */
export class FakeMaps {
  readonly byUrl = new Map<string, FakeBusiness>();
  constructor(readonly pools: Record<string, FakeBusiness[]>) {
    let i = 0;
    for (const list of Object.values(pools)) for (const b of list) this.byUrl.set(mapsUrlOf(b, i++), b);
  }
  urlOf(b: FakeBusiness): string {
    return [...this.byUrl.entries()].find(([, x]) => x === b)![0];
  }

  readonly generate = (async (req, deps) => {
    const pool = this.pools[req.rubro.toLowerCase()] ?? [];
    const seen = new SeenIndex(deps.known);
    const items: GeneratedCandidate[] = [];
    let outOfRubro = 0;
    let duplicates = 0;
    for (const b of pool) {
      if (items.length >= req.cantidad) break;
      const mapsUrl = this.urlOf(b);
      const keys = keysFor({ name: b.name, address: b.address, phone: b.phone, website: b.website, mapsUrl });
      if (deps.rubroFilter && !deps.rubroFilter({ name: b.name, category: b.category })) { outOfRubro++; continue; }
      if (seen.match(keys)) { duplicates++; continue; }
      seen.add(keys);
      const facts = { hasWebsite: !!b.website, hasPhone: !!b.phone, reviewCount: b.reviews, rating: b.rating };
      const sc = opportunityScore(facts, { bookingRelevant: true });
      items.push({ name: b.name, mapsUrl, address: b.address, phone: b.phone, website: b.website, category: b.category, rating: b.rating, reviewCount: b.reviews, keys, facts, score: sc.score, points: sc.points, reasons: sc.reasons, unverified: sc.unverified });
      deps.onProgress?.({ percent: Math.round((items.length / req.cantidad) * 90), message: `Encontrado: ${b.name}` });
    }
    const exhausted = items.length < req.cantidad;
    return {
      items, exhausted, timedOut: false,
      message: exhausted ? `Se encontraron ${items.length} prospectos nuevos. No quedan más negocios sin analizar para este rubro y ubicación.` : `Se encontraron ${items.length} prospectos nuevos.`,
      stats: { scanned: pool.length, opened: pool.length, duplicates, outOfZone: 0, closed: 0, errors: 0, outOfRubro, queries: [req.rubro] },
    };
  }) as typeof generateProspects;

  analyzed = 0;
  readonly analyze = (async (url) => {
    const b = this.byUrl.get(url);
    if (!b) throw new Error('Ficha no encontrada');
    if (b.failAnalysis) throw new Error('Google Maps tardó demasiado en responder.');
    this.analyzed++;
    const profile: BusinessProfile = {
      sourceUrl: url, name: b.name, category: b.category, additionalCategories: [], rating: b.rating, reviewCount: b.reviews, address: b.address,
      phone: b.phone, website: b.website, services: [], hasBooking: false, hasMenu: false, photoCount: 8, photoCountIsEstimate: false, photoUrls: [],
      posts: [], reviews: [], permanentlyClosed: false, socialLinks: b.instagram ? [b.instagram] : [], scrapedAt: '', warnings: [], isClaimed: true,
      hours: b.hasHours === false ? undefined : ({ lunes: '9–20' } as never),
    };
    const ig: InstagramAnalysis | undefined = b.instagram
      ? {
          url: b.instagram, username: b.instagram.split('/').filter(Boolean).pop(), status: 'ok', links: b.igLinks?.length ? ['https://linktr.ee/x'] : [],
          linktree: b.igLinks?.length ? 'https://linktr.ee/x' : undefined, linktreeChecked: !!b.igLinks?.length, linktreeLinks: b.igLinks ?? [],
          contactAvailable: !!b.igWhatsapp, whatsappNumber: b.igWhatsapp, manualBooking: false, notes: [], checkedAt: '',
          bookingUrl: b.igLinks?.find((l) => /booksy/.test(l)), bookingProvider: b.igLinks?.some((l) => /booksy/.test(l)) ? 'Booksy' : undefined,
        }
      : undefined;
    const website = b.website ? { ...(await import('../src/scraper/websiteAnalyzer.js')).emptyAnalysis(b.website), reachable: true } : undefined;
    return buildAnalysis(url, profile, website, { durationMs: 5 }, buildChannelReport(profile, website, ig));
  }) as typeof analyze;
}
