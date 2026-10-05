import { randomUUID } from 'node:crypto';
import { transaction, type Db } from '../db/database.js';
import { NotFoundError, ValidationError } from '../crm/repository.js';
import { keysFor, type DedupeKeys } from './dedupe.js';
import type { GeneratedCandidate, GenerateResult } from './generator.js';
import type { CandidateFacts, ScoreReason } from './score.js';

/** Estados comerciales del seguimiento de prospectos generados. */
export const GENERATOR_STATUSES = [
  { id: 'nuevo', label: 'Nuevo', stage: 0 },
  { id: 'contactado', label: 'Contactado', stage: 1 },
  { id: 'interesado', label: 'Interesado (respondió)', stage: 2 },
  { id: 'llamada', label: 'Llamada agendada', stage: 3 },
  { id: 'propuesta', label: 'Propuesta enviada', stage: 4 },
  { id: 'ganado', label: 'Cliente ganado', stage: 5 },
  { id: 'perdido', label: 'Perdido', stage: -1 },
] as const;
export type GeneratorStatus = (typeof GENERATOR_STATUSES)[number]['id'];
export const isGeneratorStatus = (v: unknown): v is GeneratorStatus => GENERATOR_STATUSES.some((s) => s.id === v);
const stageOf = (s: GeneratorStatus) => GENERATOR_STATUSES.find((x) => x.id === s)!.stage;

export interface GeneratedProspect {
  id: string;
  runId: string | null;
  userId: string | null;
  userName: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string;
  placeId: string | null;
  rubro: string;
  zona: string;
  score: number;
  reasons: ScoreReason[];
  unverified: string[];
  facts: CandidateFacts;
  status: GeneratorStatus;
  prospectId: string | null;
  discoveredAt: string;
  updatedAt: string;
}

export interface GeneratorRun {
  id: string;
  rubro: string;
  zona: string;
  requested: number;
  found: number;
  exhausted: boolean;
  message: string | null;
  createdAt: string;
  userName: string | null;
}

export interface GeneratorStats {
  found: number;
  pending: number;
  contacted: number;
  interested: number;
  proposals: number;
  won: number;
  lost: number;
  /** Clientes ganados / prospectos contactados (0–100). */
  closeRate: number;
}

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const parse = <T>(v: unknown, fallback: T): T => {
  try {
    return v ? (JSON.parse(String(v)) as T) : fallback;
  } catch {
    return fallback;
  }
};

const SELECT = `SELECT g.*, u.name AS user_name FROM generated_prospects g LEFT JOIN users u ON u.id = g.user_id`;

function toItem(r: Row): GeneratedProspect {
  return {
    id: String(r.id),
    runId: str(r.run_id),
    userId: str(r.user_id),
    userName: str(r.user_name),
    name: String(r.name),
    address: str(r.address),
    phone: str(r.phone),
    website: str(r.website),
    category: str(r.category),
    rating: num(r.rating),
    reviewCount: num(r.review_count),
    mapsUrl: String(r.maps_url),
    placeId: str(r.place_id),
    rubro: String(r.rubro),
    zona: String(r.zona),
    score: Number(r.score),
    reasons: parse(r.reasons_json, []),
    unverified: parse(r.unverified_json, []),
    facts: parse(r.facts_json, {}),
    status: String(r.status) as GeneratorStatus,
    prospectId: str(r.prospect_id),
    discoveredAt: String(r.discovered_at),
    updatedAt: String(r.updated_at),
  };
}

/**
 * Persistencia del Generador de Prospectos (SQLite, misma base que el CRM).
 * Todo negocio entregado queda registrado para siempre: es lo que evita repetirlo.
 */
export class GeneratorRepository {
  constructor(private readonly db: Db) {}

  /**
   * Claves de todos los negocios conocidos: los entregados por el generador (de cualquier usuario)
   * y los que ya están en el CRM (analizados a mano). Ninguno se vuelve a entregar.
   */
  knownKeys(): DedupeKeys[] {
    const delivered = (this.db.prepare(
      'SELECT place_id, feature_id, url_key, name_key, address_key, street_key, phone_key, website_key FROM generated_prospects',
    ).all() as Row[]).map((r) => ({
      placeId: str(r.place_id) ?? undefined,
      featureId: str(r.feature_id) ?? undefined,
      urlKey: str(r.url_key) ?? undefined,
      nameKey: str(r.name_key) ?? undefined,
      addressKey: str(r.address_key) ?? undefined,
      streetKey: str(r.street_key) ?? undefined,
      phoneKey: str(r.phone_key) ?? undefined,
      websiteKey: str(r.website_key) ?? undefined,
    }));
    const inCrm = (this.db.prepare('SELECT name, address, phone, website, maps_url FROM prospects').all() as Row[]).map((r) =>
      keysFor({ name: String(r.name), address: str(r.address) ?? undefined, phone: str(r.phone) ?? undefined, website: str(r.website) ?? undefined, mapsUrl: str(r.maps_url) ?? undefined }),
    );
    return [...delivered, ...inCrm];
  }

  startRun(input: { rubro: string; zona: string; requested: number; userId: string | null }): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO generator_runs (id, user_id, rubro, zona, requested, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.userId, input.rubro, input.zona, input.requested, now());
    return id;
  }

  /** Guarda los negocios entregados en una búsqueda. Si alguno ya existía (carrera), se omite. */
  saveRun(runId: string, input: { rubro: string; zona: string; userId: string | null }, result: GenerateResult): GeneratedProspect[] {
    const ts = now();
    const insert = this.db.prepare(`INSERT INTO generated_prospects
      (id, run_id, user_id, name, address, phone, website, category, rating, review_count, maps_url, place_id, feature_id, url_key,
       name_key, address_key, street_key, phone_key, website_key, rubro, zona, score, score_points, reasons_json, unverified_json, facts_json,
       discovered_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const ids: string[] = [];
    transaction(this.db, () => {
      for (const c of result.items) {
        const id = randomUUID();
        try {
          insert.run(
            id, runId, input.userId, c.name, c.address ?? null, c.phone ?? null, c.website ?? null, c.category ?? null, c.rating ?? null,
            c.reviewCount ?? null, c.mapsUrl, c.keys.placeId ?? null, c.keys.featureId ?? null, c.keys.urlKey ?? null, c.keys.nameKey ?? null,
            c.keys.addressKey ?? null, c.keys.streetKey ?? null, c.keys.phoneKey ?? null, c.keys.websiteKey ?? null, input.rubro, input.zona,
            c.score, c.points, JSON.stringify(c.reasons), JSON.stringify(c.unverified), JSON.stringify(c.facts), ts, ts,
          );
          ids.push(id);
        } catch (err) {
          if (!/UNIQUE/i.test((err as Error).message)) throw err; // ya entregado por otra búsqueda simultánea
        }
      }
      this.db
        .prepare('UPDATE generator_runs SET found = ?, exhausted = ?, stats_json = ?, message = ?, finished_at = ? WHERE id = ?')
        .run(ids.length, result.exhausted ? 1 : 0, JSON.stringify(result.stats), result.message, ts, runId);
    });
    return ids.map((id) => this.get(id)).sort((a, b) => b.score - a.score);
  }

  get(id: string): GeneratedProspect {
    const r = this.db.prepare(`${SELECT} WHERE g.id = ?`).get(id) as Row | undefined;
    if (!r) throw new NotFoundError('Prospecto generado no encontrado.');
    return toItem(r);
  }

  /** Dueño (quién lo generó): para controlar el acceso de los vendedores. undefined si no existe. */
  ownerOf(id: string): string | null | undefined {
    const r = this.db.prepare('SELECT user_id FROM generated_prospects WHERE id = ?').get(id) as Row | undefined;
    return r ? str(r.user_id) : undefined;
  }

  list(f: { userId?: string; status?: string; q?: string; runId?: string; limit?: number } = {}): GeneratedProspect[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (f.userId) { where.push('g.user_id = ?'); args.push(f.userId); }
    if (f.status && f.status !== 'todos') {
      if (f.status === 'pendientes') where.push("g.status = 'nuevo'");
      else { where.push('g.status = ?'); args.push(f.status); }
    }
    if (f.runId) { where.push('g.run_id = ?'); args.push(f.runId); }
    if (f.q?.trim()) {
      where.push('(g.name LIKE ? OR g.address LIKE ? OR g.rubro LIKE ? OR g.zona LIKE ? OR g.category LIKE ?)');
      const like = `%${f.q.trim()}%`;
      args.push(like, like, like, like, like);
    }
    const limit = Math.max(1, Math.min(2000, f.limit ?? 500));
    const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY g.score DESC, g.discovered_at DESC LIMIT ${limit}`;
    return (this.db.prepare(sql).all(...args) as Row[]).map(toItem);
  }

  setStatus(id: string, status: unknown): GeneratedProspect {
    if (!isGeneratorStatus(status)) throw new ValidationError('Estado inválido.');
    const cur = this.get(id);
    const ts = now();
    const stage = stageOf(status);
    this.db
      .prepare('UPDATE generated_prospects SET status = ?, max_stage = MAX(max_stage, ?), updated_at = ?, status_changed_at = ? WHERE id = ?')
      .run(status, stage, ts, cur.status === status ? null : ts, id);
    return this.get(id);
  }

  /** Vincula el análisis completo (prospecto del CRM) al prospecto generado. */
  linkProspect(id: string, prospectId: string): GeneratedProspect {
    this.get(id);
    const exists = this.db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(prospectId);
    if (!exists) throw new ValidationError('El análisis indicado no existe.');
    this.db.prepare('UPDATE generated_prospects SET prospect_id = ?, updated_at = ? WHERE id = ?').run(prospectId, now(), id);
    return this.get(id);
  }

  stats(userId?: string): GeneratorStats {
    const r = this.db
      .prepare(`SELECT
          COUNT(*) AS found,
          SUM(status = 'nuevo') AS pending,
          SUM(max_stage >= 1) AS contacted,
          SUM(max_stage >= 2) AS interested,
          SUM(max_stage >= 4) AS proposals,
          SUM(status = 'ganado') AS won,
          SUM(status = 'perdido') AS lost
        FROM generated_prospects ${userId ? 'WHERE user_id = ?' : ''}`)
      .get(...(userId ? [userId] : [])) as Row;
    const n = (k: string) => Number(r[k] ?? 0);
    const contacted = n('contacted');
    return {
      found: n('found'),
      pending: n('pending'),
      contacted,
      interested: n('interested'),
      proposals: n('proposals'),
      won: n('won'),
      lost: n('lost'),
      closeRate: contacted ? Math.round((n('won') / contacted) * 1000) / 10 : 0,
    };
  }

  runs(userId?: string, limit = 10): GeneratorRun[] {
    const rows = this.db
      .prepare(`SELECT r.*, u.name AS user_name FROM generator_runs r LEFT JOIN users u ON u.id = r.user_id
        ${userId ? 'WHERE r.user_id = ?' : ''} ORDER BY r.created_at DESC LIMIT ?`)
      .all(...(userId ? [userId, limit] : [limit])) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      rubro: String(r.rubro),
      zona: String(r.zona),
      requested: Number(r.requested),
      found: Number(r.found),
      exhausted: Number(r.exhausted) === 1,
      message: str(r.message),
      createdAt: String(r.created_at),
      userName: str(r.user_name),
    }));
  }
}

export type { GeneratedCandidate };
