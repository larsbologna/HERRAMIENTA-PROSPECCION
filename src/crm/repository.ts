import { randomUUID } from 'node:crypto';
import type { AnalysisResult, AreaScore, Budget, SalesArgument, ServiceRecommendation } from '../domain/types.js';
import { transaction, type Db } from '../db/database.js';
import { buildBudget, loadPriceList, type PriceList } from '../proposal/budget.js';
import {
  ACTIVITY_TYPES,
  MANUAL_ACTIVITY_TYPES,
  STATUSES,
  isStatus,
  stageOf,
  type Activity,
  type ActivityType,
  type AuditEntry,
  type ProspectDetail,
  type ProspectFilter,
  type ProspectStatus,
  type ProspectSummary,
  type ProspectUpdate,
  type Settings,
} from './types.js';

type Row = Record<string, unknown>;

const SUMMARY_COLUMNS = `id, name, category, vertical_id, vertical_label, maps_url, address, phone, website, rating, review_count,
  score, status, max_stage, potential_value, project_total, closed_value, problems_count, high_impact_count,
  analyzed_at, created_at, last_activity_at`;

const SORTS: Record<NonNullable<ProspectFilter['sort']>, string> = {
  name: 'name COLLATE NOCASE',
  vertical: 'vertical_label COLLATE NOCASE',
  score: 'score',
  potential: 'potential_value',
  status: `CASE status ${STATUSES.map((s, i) => `WHEN '${s.id}' THEN ${i}`).join(' ')} END`,
  lastActivity: 'last_activity_at',
  analyzedAt: 'analyzed_at',
};

/** Unifica nombre + dirección para no duplicar el mismo negocio si se analiza dos veces. */
export function dedupeKey(name: string, address?: string, fallback?: string): string {
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${norm(name)}|${norm(address || fallback || '')}`;
}

const now = () => new Date().toISOString();
const json = (v: unknown) => JSON.stringify(v ?? null);
const parse = <T>(v: unknown, fallback: T): T => {
  try {
    return v ? (JSON.parse(String(v)) as T) : fallback;
  } catch {
    return fallback;
  }
};

function toSummary(r: Row): ProspectSummary {
  return {
    id: String(r.id),
    name: String(r.name),
    category: (r.category as string) ?? null,
    verticalId: (r.vertical_id as string) ?? null,
    verticalLabel: (r.vertical_label as string) ?? null,
    mapsUrl: String(r.maps_url),
    address: (r.address as string) ?? null,
    phone: (r.phone as string) ?? null,
    website: (r.website as string) ?? null,
    rating: r.rating === null || r.rating === undefined ? null : Number(r.rating),
    reviewCount: r.review_count === null || r.review_count === undefined ? null : Number(r.review_count),
    score: Number(r.score),
    status: r.status as ProspectStatus,
    maxStage: Number(r.max_stage),
    potentialValue: Number(r.potential_value),
    projectTotal: Number(r.project_total),
    closedValue: r.closed_value === null || r.closed_value === undefined ? null : Number(r.closed_value),
    problemsCount: Number(r.problems_count),
    highImpactCount: Number(r.high_impact_count),
    analyzedAt: String(r.analyzed_at),
    createdAt: String(r.created_at),
    lastActivityAt: String(r.last_activity_at),
  };
}

function toActivity(r: Row): Activity {
  const type = r.type as ActivityType;
  return {
    id: Number(r.id),
    type,
    label: ACTIVITY_TYPES[type] ?? String(r.type),
    content: String(r.content ?? ''),
    fromStatus: (r.from_status as string) ?? null,
    toStatus: (r.to_status as string) ?? null,
    createdAt: String(r.created_at),
  };
}

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

/**
 * Repositorio del CRM: única capa que habla con SQLite.
 * Los valores económicos se derivan de precios.json y se recalculan solos cuando cambian los precios.
 */
export class CrmRepository {
  /** Último error al leer precios.json (se muestra en Configuración). */
  priceError: string | undefined;

  constructor(
    private readonly db: Db,
    private readonly priceSource: () => PriceList = () => loadPriceList(),
  ) {}

  // ------------------------------------------------------------------ precios

  /** Precios actuales; si precios.json tiene un error se informa y se usan los últimos válidos. */
  prices(): PriceList | undefined {
    try {
      const p = this.priceSource();
      this.priceError = undefined;
      return p;
    } catch (err) {
      this.priceError = (err as Error).message;
      return undefined;
    }
  }

  /** Si precios.json cambió desde el último cálculo, recalcula presupuesto y valores de todos los prospectos. */
  refreshValuesIfPricesChanged(): boolean {
    const prices = this.prices();
    if (!prices) return false;
    const fingerprint = JSON.stringify(prices);
    if (this.getSetting('prices_fingerprint') === fingerprint) return false;
    const rows = this.db.prepare('SELECT id, services_json FROM prospects').all() as Row[];
    const update = this.db.prepare('UPDATE prospects SET budget_json = ?, potential_value = ?, project_total = ? WHERE id = ?');
    transaction(this.db, () => {
      for (const r of rows) {
        const budget = buildBudget(parse<ServiceRecommendation[]>(r.services_json, []), prices);
        update.run(json(budget), budget.potentialValue, budget.projectTotal, String(r.id));
      }
      this.setSetting('prices_fingerprint', fingerprint);
    });
    return true;
  }

  // ------------------------------------------------------------------ análisis

  /**
   * Guarda un análisis. Si el negocio ya existe (mismo nombre + dirección) se actualiza
   * conservando estado comercial, notas e historial, y se registra como reanálisis.
   */
  saveAnalysis(result: AnalysisResult, opts: { source?: 'analisis' | 'importado'; auditId?: string } = {}): { id: string; created: boolean } {
    const p = result.profile;
    if (!p.name) throw new ValidationError('El análisis no tiene nombre de negocio.');
    const prices = this.prices();
    const budget: Budget = prices ? buildBudget(result.proposal.services, prices) : result.budget;
    const problems = result.proposal.salesArguments;
    const key = dedupeKey(p.name, p.address, p.phone ?? result.url);
    const ts = now();
    const analyzedAt = result.analyzedAt || ts;
    const fields = {
      name: p.name,
      category: p.category ?? null,
      vertical_id: result.vertical.id,
      vertical_label: result.vertical.label,
      maps_url: result.url,
      address: p.address ?? null,
      phone: p.phone ?? null,
      website: p.website ?? null,
      rating: p.rating ?? null,
      review_count: p.reviewCount ?? null,
      score: result.audit.overallScore,
      area_scores_json: json(result.audit.scores),
      potential_value: budget.potentialValue,
      project_total: budget.projectTotal,
      problems_count: problems.length,
      high_impact_count: problems.filter((a) => a.impact === 'Alto').length,
      problems_json: json(problems),
      services_json: json(result.proposal.services),
      budget_json: json(budget),
      analyzed_at: analyzedAt,
    };
    const source = opts.source ?? 'analisis';

    return transaction(this.db, () => {
      const existing = this.db.prepare('SELECT id, score FROM prospects WHERE dedupe_key = ?').get(key) as Row | undefined;
      const id = existing ? String(existing.id) : randomUUID();
      const cols = Object.keys(fields);
      if (existing) {
        this.db
          .prepare(`UPDATE prospects SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, last_activity_at = ? WHERE id = ?`)
          .run(...(Object.values(fields) as never[]), ts, ts, id);
        this.logActivity(id, source === 'importado' ? 'importado' : 'reanalisis', `Score ${existing.score} → ${fields.score} · ${problems.length} problemas`, ts);
      } else {
        this.db
          .prepare(`INSERT INTO prospects (id, dedupe_key, ${cols.join(', ')}, created_at, updated_at, last_activity_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`)
          .run(id, key, ...(Object.values(fields) as never[]), analyzedAt, ts, ts);
        this.logActivity(id, source === 'importado' ? 'importado' : 'creado', `Score ${fields.score}/100 · ${problems.length} problemas detectados`, ts);
      }
      this.db
        .prepare('INSERT INTO audits (id, prospect_id, created_at, score, problems_count, duration_ms, source, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(opts.auditId ?? randomUUID(), id, analyzedAt, fields.score, problems.length, result.durationMs ?? 0, source, json(result));
      return { id, created: !existing };
    });
  }

  hasAudit(auditId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM audits WHERE id = ?').get(auditId);
  }

  // ------------------------------------------------------------------ prospectos

  list(filter: ProspectFilter = {}): ProspectSummary[] {
    this.refreshValuesIfPricesChanged();
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.q?.trim()) {
      where.push('(name LIKE ? OR category LIKE ? OR address LIKE ? OR phone LIKE ? OR vertical_label LIKE ?)');
      const like = `%${filter.q.trim()}%`;
      params.push(like, like, like, like, like);
    }
    if (filter.status && filter.status !== 'todos') {
      if (filter.status === 'abiertos') where.push(`status NOT IN ('cliente', 'perdido')`);
      else {
        where.push('status = ?');
        params.push(filter.status);
      }
    }
    if (filter.vertical) {
      where.push('vertical_id = ?');
      params.push(filter.vertical);
    }
    if (filter.minScore !== undefined && Number.isFinite(filter.minScore)) {
      where.push('score >= ?');
      params.push(filter.minScore);
    }
    if (filter.maxScore !== undefined && Number.isFinite(filter.maxScore)) {
      where.push('score <= ?');
      params.push(filter.maxScore);
    }
    const sort = SORTS[filter.sort ?? 'lastActivity'] ?? SORTS.lastActivity;
    const dir = filter.dir === 'asc' ? 'ASC' : 'DESC';
    const sql = `SELECT ${SUMMARY_COLUMNS} FROM prospects ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sort} ${dir}, name COLLATE NOCASE ASC`;
    return (this.db.prepare(sql).all(...params) as Row[]).map(toSummary);
  }

  get(id: string): ProspectDetail {
    this.refreshValuesIfPricesChanged();
    const r = this.db.prepare('SELECT * FROM prospects WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new NotFoundError('Prospecto no encontrado.');
    const latest = this.db.prepare('SELECT result_json FROM audits WHERE prospect_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(id) as Row | undefined;
    return {
      ...toSummary(r),
      notes: String(r.notes ?? ''),
      areaScores: parse<AreaScore[]>(r.area_scores_json, []),
      problems: parse<SalesArgument[]>(r.problems_json, []),
      services: parse<ServiceRecommendation[]>(r.services_json, []),
      budget: parse<Budget>(r.budget_json, {} as Budget),
      audits: this.audits({ prospectId: id }),
      activities: (this.db.prepare('SELECT * FROM activities WHERE prospect_id = ? ORDER BY created_at DESC, id DESC').all(id) as Row[]).map(toActivity),
      analysis: parse<AnalysisResult>(latest?.result_json, {} as AnalysisResult),
    };
  }

  update(id: string, upd: ProspectUpdate): ProspectDetail {
    const r = this.db.prepare('SELECT status, max_stage, notes, closed_value, potential_value FROM prospects WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new NotFoundError('Prospecto no encontrado.');
    if (upd.status !== undefined && !isStatus(upd.status)) throw new ValidationError('Estado inválido.');
    if (upd.notes !== undefined && typeof upd.notes !== 'string') throw new ValidationError('Notas inválidas.');
    if (upd.notes !== undefined && upd.notes.length > 50_000) throw new ValidationError('Las notas son demasiado largas.');
    if (upd.closedValue !== undefined && upd.closedValue !== null && !(Number.isFinite(upd.closedValue) && upd.closedValue >= 0)) {
      throw new ValidationError('Valor cerrado inválido.');
    }
    const ts = now();
    transaction(this.db, () => {
      if (upd.status !== undefined && upd.status !== r.status) {
        const maxStage = Math.max(Number(r.max_stage), stageOf(upd.status));
        // Al pasar a Cliente, el valor cerrado parte del valor potencial (editable después).
        const closed = upd.status === 'cliente' && r.closed_value === null ? Number(r.potential_value) : (r.closed_value as number | null);
        this.db
          .prepare('UPDATE prospects SET status = ?, max_stage = ?, closed_value = ?, updated_at = ?, last_activity_at = ? WHERE id = ?')
          .run(upd.status, maxStage, closed, ts, ts, id);
        this.db
          .prepare('INSERT INTO activities (prospect_id, type, content, from_status, to_status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, 'estado', '', String(r.status), upd.status, ts);
      }
      if (upd.notes !== undefined && upd.notes !== r.notes) {
        this.db.prepare('UPDATE prospects SET notes = ?, updated_at = ?, last_activity_at = ? WHERE id = ?').run(upd.notes, ts, ts, id);
        // Guardado continuo: varias ediciones seguidas cuentan como una sola entrada del historial.
        const last = this.db.prepare('SELECT id, type, created_at FROM activities WHERE prospect_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(id) as Row | undefined;
        if (last && last.type === 'notas' && Date.parse(ts) - Date.parse(String(last.created_at)) < 30 * 60_000) {
          this.db.prepare('UPDATE activities SET created_at = ? WHERE id = ?').run(ts, Number(last.id));
        } else {
          this.logActivity(id, 'notas', '', ts);
        }
      }
      if (upd.closedValue !== undefined) {
        const value = upd.closedValue === null ? null : Math.round(upd.closedValue);
        this.db.prepare('UPDATE prospects SET closed_value = ?, updated_at = ? WHERE id = ?').run(value, ts, id);
      }
    });
    return this.get(id);
  }

  addActivity(id: string, type: string, content: string): Activity {
    if (!MANUAL_ACTIVITY_TYPES.includes(type as ActivityType)) throw new ValidationError('Tipo de actividad inválido.');
    const text = String(content ?? '').trim();
    if (!text) throw new ValidationError('Escribí el detalle de la actividad.');
    if (text.length > 5_000) throw new ValidationError('El texto es demasiado largo.');
    if (!this.db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(id)) throw new NotFoundError('Prospecto no encontrado.');
    const ts = now();
    return transaction(this.db, () => {
      const activityId = this.logActivity(id, type as ActivityType, text, ts);
      this.db.prepare('UPDATE prospects SET last_activity_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id);
      return toActivity(this.db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId) as Row);
    });
  }

  delete(id: string): void {
    const res = this.db.prepare('DELETE FROM prospects WHERE id = ?').run(id);
    if (!res.changes) throw new NotFoundError('Prospecto no encontrado.');
  }

  audits(opts: { prospectId?: string; limit?: number } = {}): AuditEntry[] {
    const rows = (opts.prospectId
      ? this.db.prepare(`SELECT a.id, a.prospect_id, p.name, a.created_at, a.score, a.problems_count, a.duration_ms, a.source
          FROM audits a JOIN prospects p ON p.id = a.prospect_id WHERE a.prospect_id = ? ORDER BY a.created_at DESC`).all(opts.prospectId)
      : this.db.prepare(`SELECT a.id, a.prospect_id, p.name, a.created_at, a.score, a.problems_count, a.duration_ms, a.source
          FROM audits a JOIN prospects p ON p.id = a.prospect_id ORDER BY a.created_at DESC LIMIT ?`).all(opts.limit ?? 500)) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      prospectId: String(r.prospect_id),
      prospectName: String(r.name),
      createdAt: String(r.created_at),
      score: Number(r.score),
      problemsCount: Number(r.problems_count),
      durationMs: Number(r.duration_ms),
      source: String(r.source),
    }));
  }

  // ------------------------------------------------------------------ configuración

  getSetting(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    return r ? String(r.value) : undefined;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  settings(defaults: Settings): Settings {
    return {
      sellerName: this.getSetting('seller_name') ?? defaults.sellerName,
      sellerBusiness: this.getSetting('seller_business') ?? defaults.sellerBusiness,
      sellerCity: this.getSetting('seller_city') ?? defaults.sellerCity,
    };
  }

  saveSettings(s: Partial<Settings>): void {
    const map: Record<keyof Settings, string> = { sellerName: 'seller_name', sellerBusiness: 'seller_business', sellerCity: 'seller_city' };
    for (const [k, key] of Object.entries(map) as Array<[keyof Settings, string]>) {
      const v = s[k];
      if (v === undefined) continue;
      if (typeof v !== 'string' || v.length > 120) throw new ValidationError('Valor de configuración inválido.');
      this.setSetting(key, v.trim());
    }
  }

  // ------------------------------------------------------------------ exportación

  exportAll(): Record<string, unknown> {
    const rows = (sql: string) => this.db.prepare(sql).all() as Row[];
    return {
      exportedAt: now(),
      schemaVersion: Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version),
      prospects: rows('SELECT * FROM prospects ORDER BY created_at').map((r) => ({
        ...r,
        area_scores_json: undefined,
        problems_json: undefined,
        services_json: undefined,
        budget_json: undefined,
        areaScores: parse(r.area_scores_json, []),
        problems: parse(r.problems_json, []),
        services: parse(r.services_json, []),
        budget: parse(r.budget_json, {}),
      })),
      audits: rows('SELECT * FROM audits ORDER BY created_at').map((r) => ({ ...r, result_json: undefined, result: parse(r.result_json, {}) })),
      activities: rows('SELECT * FROM activities ORDER BY created_at'),
      settings: rows(`SELECT * FROM settings WHERE key NOT LIKE 'prices_%' AND key NOT LIKE 'legacy_%'`),
    };
  }

  /** Filas mínimas para métricas y dashboard. */
  allForStats(): Array<ProspectSummary & { services: ServiceRecommendation[]; areaScores: AreaScore[] }> {
    this.refreshValuesIfPricesChanged();
    return (this.db.prepare(`SELECT ${SUMMARY_COLUMNS}, services_json, area_scores_json FROM prospects`).all() as Row[]).map((r) => ({
      ...toSummary(r),
      services: parse<ServiceRecommendation[]>(r.services_json, []),
      areaScores: parse<AreaScore[]>(r.area_scores_json, []),
    }));
  }

  /** Cambios de estado (para conversiones por mes). */
  statusChanges(): Array<{ toStatus: string; createdAt: string }> {
    return (this.db.prepare(`SELECT to_status, created_at FROM activities WHERE type = 'estado'`).all() as Row[]).map((r) => ({
      toStatus: String(r.to_status),
      createdAt: String(r.created_at),
    }));
  }

  private logActivity(prospectId: string, type: ActivityType, content: string, ts: string): number {
    const res = this.db
      .prepare('INSERT INTO activities (prospect_id, type, content, created_at) VALUES (?, ?, ?, ?)')
      .run(prospectId, type, content, ts);
    return Number(res.lastInsertRowid);
  }
}
