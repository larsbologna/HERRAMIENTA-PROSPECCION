import { randomUUID } from 'node:crypto';
import type { AnalysisResult, AreaScore, Budget, SalesArgument, ServiceRecommendation } from '../domain/types.js';
import { transaction, type Db } from '../db/database.js';
import { buildBudget, loadPriceList, validatePriceList, writePriceList, type PriceList } from '../proposal/budget.js';
import { SERVICE_CATALOG } from '../proposal/services.js';
import {
  ACTIVITY_TYPES,
  MANUAL_ACTIVITY_TYPES,
  STATUSES,
  isStatus,
  stageOf,
  type Activity,
  type ActivityType,
  type AuditEntry,
  type Followup,
  type FollowupStatus,
  type ProspectDetail,
  type ProspectFilter,
  type ProspectStatus,
  type ProspectSummary,
  type ProspectUpdate,
  type Settings,
} from './types.js';

type Row = Record<string, unknown>;

/** Resumen de prospecto con vendedor asignado y próximo seguimiento pendiente. */
const SUMMARY_SELECT = `SELECT p.id, p.name, p.category, p.vertical_id, p.vertical_label, p.maps_url, p.address, p.phone, p.website,
  p.rating, p.review_count, p.score, p.status, p.max_stage, p.potential_value, p.project_total, p.closed_value,
  p.problems_count, p.high_impact_count, p.analyzed_at, p.created_at, p.last_activity_at,
  p.assigned_user_id, u.name AS assigned_user_name,
  (SELECT MIN(f.due_at) FROM followups f WHERE f.prospect_id = p.id AND f.status = 'pendiente') AS next_followup_at
  FROM prospects p LEFT JOIN users u ON u.id = p.assigned_user_id`;

const SORTS: Record<NonNullable<ProspectFilter['sort']>, string> = {
  name: 'p.name COLLATE NOCASE',
  vertical: 'p.vertical_label COLLATE NOCASE',
  score: 'p.score',
  potential: 'p.potential_value',
  status: `CASE p.status ${STATUSES.map((s, i) => `WHEN '${s.id}' THEN ${i}`).join(' ')} END`,
  lastActivity: 'p.last_activity_at',
  analyzedAt: 'p.analyzed_at',
  nextFollowup: `COALESCE(next_followup_at, '9999')`,
};

const ACTIVITY_SELECT = `SELECT a.*, u.name AS user_name, p.name AS prospect_name
  FROM activities a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN prospects p ON p.id = a.prospect_id`;

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
    assignedUserId: (r.assigned_user_id as string) ?? null,
    assignedUserName: (r.assigned_user_name as string) ?? null,
    nextFollowupAt: (r.next_followup_at as string) ?? null,
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
    userId: (r.user_id as string) ?? null,
    userName: (r.user_name as string) ?? null,
    prospectId: (r.prospect_id as string) ?? null,
    prospectName: (r.prospect_name as string) ?? null,
  };
}

function toFollowup(r: Row): Followup {
  const dueAt = String(r.due_at);
  return {
    id: Number(r.id),
    prospectId: String(r.prospect_id),
    prospectName: (r.prospect_name as string) ?? undefined,
    userId: (r.user_id as string) ?? null,
    userName: (r.user_name as string) ?? null,
    dueAt,
    note: String(r.note ?? ''),
    status: r.status as FollowupStatus,
    createdAt: String(r.created_at),
    completedAt: (r.completed_at as string) ?? null,
    overdue: r.status === 'pendiente' && Date.parse(dueAt) < Date.now(),
  };
}

/** Fin del día local (para "pendientes hasta hoy"). */
export function endOfToday(ref = new Date()): string {
  const d = new Date(ref);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
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
    private readonly priceWriter: (prices: PriceList) => void = (prices) => writePriceList(prices),
  ) {}

  /**
   * Guarda precios editados desde Configuración y recalcula al instante presupuesto,
   * valor potencial y total de todos los prospectos.
   */
  updatePrices(input: unknown, actorId: string | null): { prices: PriceList; recalculated: number } {
    let prices: PriceList;
    try {
      prices = validatePriceList(input, Object.keys(SERVICE_CATALOG));
    } catch (err) {
      throw new ValidationError((err as Error).message);
    }
    // Se conserva la nota del archivo si la edición no trae una.
    const current = this.prices();
    if (!prices.nota && current?.nota) prices.nota = current.nota;
    this.priceWriter(prices);
    const changed = this.refreshValuesIfPricesChanged();
    const recalculated = changed ? Number((this.db.prepare('SELECT COUNT(*) AS n FROM prospects').get() as Row).n) : 0;
    this.logSystem('configuracion', actorId, `Precios actualizados${recalculated ? ` · ${recalculated} prospecto(s) recalculados` : ''}`);
    return { prices, recalculated };
  }

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
  saveAnalysis(
    result: AnalysisResult,
    opts: { source?: 'analisis' | 'importado'; auditId?: string; userId?: string } = {},
  ): { id: string; created: boolean; assignedUserId: string | null } {
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
      const existing = this.db.prepare('SELECT id, score, assigned_user_id FROM prospects WHERE dedupe_key = ?').get(key) as Row | undefined;
      const userId = opts.userId ?? null;
      const id = existing ? String(existing.id) : randomUUID();
      const cols = Object.keys(fields);
      if (existing) {
        this.db
          .prepare(`UPDATE prospects SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, last_activity_at = ? WHERE id = ?`)
          .run(...(Object.values(fields) as never[]), ts, ts, id);
        this.logActivity(id, source === 'importado' ? 'importado' : 'reanalisis', `Score ${existing.score} → ${fields.score} · ${problems.length} problemas`, ts, userId);
      } else {
        // Un prospecto nuevo queda asignado a quien hizo el análisis.
        this.db
          .prepare(`INSERT INTO prospects (id, dedupe_key, ${cols.join(', ')}, assigned_user_id, created_at, updated_at, last_activity_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, ?)`)
          .run(id, key, ...(Object.values(fields) as never[]), userId, analyzedAt, ts, ts);
        this.logActivity(id, source === 'importado' ? 'importado' : 'creado', `Score ${fields.score}/100 · ${problems.length} problemas detectados`, ts, userId);
      }
      this.db
        .prepare('INSERT INTO audits (id, prospect_id, created_at, score, problems_count, duration_ms, source, result_json, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(opts.auditId ?? randomUUID(), id, analyzedAt, fields.score, problems.length, result.durationMs ?? 0, source, json(result), userId);
      return { id, created: !existing, assignedUserId: existing ? ((existing.assigned_user_id as string) ?? null) : userId };
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
      where.push('(p.name LIKE ? OR p.category LIKE ? OR p.address LIKE ? OR p.phone LIKE ? OR p.vertical_label LIKE ?)');
      const like = `%${filter.q.trim()}%`;
      params.push(like, like, like, like, like);
    }
    if (filter.status && filter.status !== 'todos') {
      if (filter.status === 'abiertos') where.push(`p.status NOT IN ('cliente', 'perdido')`);
      else {
        where.push('p.status = ?');
        params.push(filter.status);
      }
    }
    if (filter.vertical) {
      where.push('p.vertical_id = ?');
      params.push(filter.vertical);
    }
    if (filter.minScore !== undefined && Number.isFinite(filter.minScore)) {
      where.push('p.score >= ?');
      params.push(filter.minScore);
    }
    if (filter.maxScore !== undefined && Number.isFinite(filter.maxScore)) {
      where.push('p.score <= ?');
      params.push(filter.maxScore);
    }
    if (filter.assignedTo === 'none') where.push('p.assigned_user_id IS NULL');
    else if (filter.assignedTo) {
      where.push('p.assigned_user_id = ?');
      params.push(filter.assignedTo);
    }
    const sort = SORTS[filter.sort ?? 'lastActivity'] ?? SORTS.lastActivity;
    const dir = filter.dir === 'asc' ? 'ASC' : 'DESC';
    const sql = `${SUMMARY_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sort} ${dir}, p.name COLLATE NOCASE ASC`;
    return (this.db.prepare(sql).all(...params) as Row[]).map(toSummary);
  }

  get(id: string): ProspectDetail {
    this.refreshValuesIfPricesChanged();
    const r = this.db.prepare(`SELECT p.*, u.name AS assigned_user_name,
      (SELECT MIN(f.due_at) FROM followups f WHERE f.prospect_id = p.id AND f.status = 'pendiente') AS next_followup_at
      FROM prospects p LEFT JOIN users u ON u.id = p.assigned_user_id WHERE p.id = ?`).get(id) as Row | undefined;
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
      activities: (this.db.prepare(`${ACTIVITY_SELECT} WHERE a.prospect_id = ? ORDER BY a.created_at DESC, a.id DESC`).all(id) as Row[]).map(toActivity),
      followups: this.followups({ prospectId: id, includeClosed: true }),
      analysis: parse<AnalysisResult>(latest?.result_json, {} as AnalysisResult),
    };
  }

  /** Asignado actual de un prospecto (undefined si no existe). Para controles de acceso. */
  assigneeOf(id: string): string | null | undefined {
    const r = this.db.prepare('SELECT assigned_user_id FROM prospects WHERE id = ?').get(id) as Row | undefined;
    return r ? ((r.assigned_user_id as string) ?? null) : undefined;
  }

  update(id: string, upd: ProspectUpdate, actorId: string | null = null): ProspectDetail {
    const r = this.db.prepare('SELECT status, max_stage, notes, closed_value, potential_value, assigned_user_id FROM prospects WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new NotFoundError('Prospecto no encontrado.');
    if (upd.status !== undefined && !isStatus(upd.status)) throw new ValidationError('Estado inválido.');
    if (upd.notes !== undefined && typeof upd.notes !== 'string') throw new ValidationError('Notas inválidas.');
    if (upd.notes !== undefined && upd.notes.length > 50_000) throw new ValidationError('Las notas son demasiado largas.');
    if (upd.closedValue !== undefined && upd.closedValue !== null && !(Number.isFinite(upd.closedValue) && upd.closedValue >= 0)) {
      throw new ValidationError('Valor cerrado inválido.');
    }
    if (upd.assignedUserId !== undefined && upd.assignedUserId !== null) {
      const u = this.db.prepare('SELECT active FROM users WHERE id = ?').get(upd.assignedUserId) as Row | undefined;
      if (!u) throw new ValidationError('El usuario asignado no existe.');
      if (!Number(u.active)) throw new ValidationError('No se puede asignar a un usuario desactivado.');
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
          .prepare('INSERT INTO activities (prospect_id, user_id, type, content, from_status, to_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, actorId, 'estado', '', String(r.status), upd.status, ts);
      }
      if (upd.notes !== undefined && upd.notes !== r.notes) {
        this.db.prepare('UPDATE prospects SET notes = ?, updated_at = ?, last_activity_at = ? WHERE id = ?').run(upd.notes, ts, ts, id);
        // Guardado continuo: varias ediciones seguidas cuentan como una sola entrada del historial.
        const last = this.db.prepare('SELECT id, type, user_id, created_at FROM activities WHERE prospect_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(id) as Row | undefined;
        if (last && last.type === 'notas' && (last.user_id ?? null) === actorId && Date.parse(ts) - Date.parse(String(last.created_at)) < 30 * 60_000) {
          this.db.prepare('UPDATE activities SET created_at = ? WHERE id = ?').run(ts, Number(last.id));
        } else {
          this.logActivity(id, 'notas', '', ts, actorId);
        }
      }
      if (upd.closedValue !== undefined) {
        const value = upd.closedValue === null ? null : Math.round(upd.closedValue);
        this.db.prepare('UPDATE prospects SET closed_value = ?, updated_at = ? WHERE id = ?').run(value, ts, id);
      }
      if (upd.assignedUserId !== undefined && upd.assignedUserId !== (r.assigned_user_id ?? null)) {
        this.db.prepare('UPDATE prospects SET assigned_user_id = ?, updated_at = ?, last_activity_at = ? WHERE id = ?').run(upd.assignedUserId, ts, ts, id);
        const name = upd.assignedUserId ? (this.db.prepare('SELECT name FROM users WHERE id = ?').get(upd.assignedUserId) as Row).name : null;
        this.logActivity(id, 'asignacion', name ? `Asignado a ${name}` : 'Sin asignar', ts, actorId);
        // Los seguimientos pendientes pasan al nuevo responsable.
        this.db.prepare(`UPDATE followups SET user_id = ? WHERE prospect_id = ? AND status = 'pendiente'`).run(upd.assignedUserId, id);
      }
    });
    return this.get(id);
  }

  addActivity(id: string, type: string, content: string, actorId: string | null = null): Activity {
    if (!MANUAL_ACTIVITY_TYPES.includes(type as ActivityType)) throw new ValidationError('Tipo de actividad inválido.');
    const text = String(content ?? '').trim();
    if (!text) throw new ValidationError('Escribí el detalle de la actividad.');
    if (text.length > 5_000) throw new ValidationError('El texto es demasiado largo.');
    if (!this.db.prepare('SELECT 1 FROM prospects WHERE id = ?').get(id)) throw new NotFoundError('Prospecto no encontrado.');
    const ts = now();
    return transaction(this.db, () => {
      const activityId = this.logActivity(id, type as ActivityType, text, ts, actorId);
      this.db.prepare('UPDATE prospects SET last_activity_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id);
      return toActivity(this.db.prepare(`${ACTIVITY_SELECT} WHERE a.id = ?`).get(activityId) as Row);
    });
  }

  delete(id: string): void {
    const res = this.db.prepare('DELETE FROM prospects WHERE id = ?').run(id);
    if (!res.changes) throw new NotFoundError('Prospecto no encontrado.');
  }

  audits(opts: { prospectId?: string; limit?: number } = {}): AuditEntry[] {
    const base = `SELECT a.id, a.prospect_id, p.name, a.created_at, a.score, a.problems_count, a.duration_ms, a.source, u.name AS user_name
      FROM audits a JOIN prospects p ON p.id = a.prospect_id LEFT JOIN users u ON u.id = a.user_id`;
    const rows = (opts.prospectId
      ? this.db.prepare(`${base} WHERE a.prospect_id = ? ORDER BY a.created_at DESC`).all(opts.prospectId)
      : this.db.prepare(`${base} ORDER BY a.created_at DESC LIMIT ?`).all(opts.limit ?? 500)) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      prospectId: String(r.prospect_id),
      prospectName: String(r.name),
      createdAt: String(r.created_at),
      score: Number(r.score),
      problemsCount: Number(r.problems_count),
      durationMs: Number(r.duration_ms),
      source: String(r.source),
      userName: (r.user_name as string) ?? null,
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
      sellerIntro: this.getSetting('seller_intro') ?? defaults.sellerIntro,
      sellerLink: this.getSetting('seller_link') ?? defaults.sellerLink,
    };
  }

  saveSettings(s: Partial<Settings>): void {
    const fields: Record<keyof Settings, [key: string, max: number, label: string]> = {
      sellerName: ['seller_name', 120, 'Nombre'],
      sellerBusiness: ['seller_business', 120, 'Nombre del negocio'],
      sellerCity: ['seller_city', 120, 'Ciudad o zona'],
      sellerIntro: ['seller_intro', 300, 'Presentación'],
      sellerLink: ['seller_link', 200, 'Enlace'],
    };
    const clean: Array<[string, string]> = [];
    for (const [k, [key, max, label]] of Object.entries(fields) as Array<[keyof Settings, [string, number, string]]>) {
      const v = s[k];
      if (v === undefined) continue;
      if (typeof v !== 'string') throw new ValidationError(`${label}: valor inválido.`);
      const t = v.trim().replace(/\s+/g, ' ');
      if (t.length > max) throw new ValidationError(`${label}: máximo ${max} caracteres.`);
      if (k === 'sellerLink' && t && !/^(https?:\/\/)?[^\s/]+\.[^\s]+$|^@[\w.]{2,30}$/i.test(t)) {
        throw new ValidationError('Enlace: ingresá una web (tunegocio.com), un enlace de Instagram o un @usuario.');
      }
      clean.push([key, t]);
    }
    transaction(this.db, () => {
      for (const [key, value] of clean) this.setSetting(key, value);
    });
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
  allForStats(scopeUserId?: string): Array<ProspectSummary & { services: ServiceRecommendation[]; areaScores: AreaScore[] }> {
    this.refreshValuesIfPricesChanged();
    const sql = `${SUMMARY_SELECT.replace(' FROM prospects p', ', p.services_json, p.area_scores_json FROM prospects p')}${scopeUserId ? ' WHERE p.assigned_user_id = ?' : ''}`;
    return (this.db.prepare(sql).all(...(scopeUserId ? [scopeUserId] : [])) as Row[]).map((r) => ({
      ...toSummary(r),
      services: parse<ServiceRecommendation[]>(r.services_json, []),
      areaScores: parse<AreaScore[]>(r.area_scores_json, []),
    }));
  }

  /** Cambios de estado (para conversiones por mes). */
  statusChanges(scopeUserId?: string): Array<{ toStatus: string; createdAt: string }> {
    const sql = scopeUserId
      ? `SELECT a.to_status, a.created_at FROM activities a JOIN prospects p ON p.id = a.prospect_id WHERE a.type = 'estado' AND p.assigned_user_id = ?`
      : `SELECT to_status, created_at FROM activities WHERE type = 'estado'`;
    return (this.db.prepare(sql).all(...(scopeUserId ? [scopeUserId] : [])) as Row[]).map((r) => ({
      toStatus: String(r.to_status),
      createdAt: String(r.created_at),
    }));
  }

  // ------------------------------------------------------------------ seguimientos

  addFollowup(prospectId: string, input: { dueAt: string; note?: string }, actorId: string | null = null): Followup {
    const due = Date.parse(String(input.dueAt ?? ''));
    if (!Number.isFinite(due)) throw new ValidationError('Indicá la fecha del próximo contacto.');
    const note = String(input.note ?? '').trim();
    if (note.length > 1_000) throw new ValidationError('El recordatorio es demasiado largo.');
    const assignee = this.assigneeOf(prospectId);
    if (assignee === undefined) throw new NotFoundError('Prospecto no encontrado.');
    const ts = now();
    const dueAt = new Date(due).toISOString();
    return transaction(this.db, () => {
      const res = this.db
        .prepare('INSERT INTO followups (prospect_id, user_id, due_at, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(prospectId, assignee ?? actorId, dueAt, note, actorId, ts);
      this.logActivity(prospectId, 'seguimiento', `${new Date(dueAt).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}${note ? ` · ${note}` : ''}`, ts, actorId);
      this.db.prepare('UPDATE prospects SET last_activity_at = ? WHERE id = ?').run(ts, prospectId);
      return this.followup(Number(res.lastInsertRowid))!;
    });
  }

  followup(id: number): Followup | undefined {
    const r = this.db.prepare(`SELECT f.*, u.name AS user_name, p.name AS prospect_name FROM followups f
      JOIN prospects p ON p.id = f.prospect_id LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ?`).get(id) as Row | undefined;
    return r ? toFollowup(r) : undefined;
  }

  setFollowupStatus(id: number, status: FollowupStatus, actorId: string | null = null): Followup {
    if (!['pendiente', 'hecho', 'cancelado'].includes(status)) throw new ValidationError('Estado de seguimiento inválido.');
    const f = this.followup(id);
    if (!f) throw new NotFoundError('Seguimiento no encontrado.');
    if (f.status === status) return f;
    const ts = now();
    transaction(this.db, () => {
      this.db.prepare('UPDATE followups SET status = ?, completed_at = ? WHERE id = ?').run(status, status === 'pendiente' ? null : ts, id);
      if (status !== 'pendiente') {
        this.logActivity(f.prospectId, status === 'hecho' ? 'seguimiento_hecho' : 'seguimiento_cancelado', f.note, ts, actorId);
        this.db.prepare('UPDATE prospects SET last_activity_at = ? WHERE id = ?').run(ts, f.prospectId);
      }
    });
    return this.followup(id)!;
  }

  /**
   * Seguimientos. Por defecto solo pendientes; `until` limita hasta una fecha (p. ej. fin de hoy).
   * `userId` filtra por responsable (el vendedor asignado al prospecto).
   */
  followups(opts: { prospectId?: string; userId?: string; until?: string; includeClosed?: boolean; limit?: number } = {}): Followup[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (!opts.includeClosed) where.push(`f.status = 'pendiente'`);
    if (opts.prospectId) {
      where.push('f.prospect_id = ?');
      params.push(opts.prospectId);
    }
    if (opts.userId) {
      where.push('p.assigned_user_id = ?');
      params.push(opts.userId);
    }
    if (opts.until) {
      where.push('f.due_at <= ?');
      params.push(opts.until);
    }
    const order = opts.includeClosed ? `CASE f.status WHEN 'pendiente' THEN 0 ELSE 1 END, f.due_at` : 'f.due_at';
    const sql = `SELECT f.*, u.name AS user_name, p.name AS prospect_name FROM followups f
      JOIN prospects p ON p.id = f.prospect_id LEFT JOIN users u ON u.id = f.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`;
    return (this.db.prepare(sql).all(...params, opts.limit ?? 200) as Row[]).map(toFollowup);
  }

  // ------------------------------------------------------------------ actividad global

  /** Registra una acción sin prospecto (login, logout, gestión de usuarios). */
  logSystem(type: ActivityType, userId: string | null, content = ''): void {
    this.logActivity(null, type, content, now(), userId);
  }

  activityLog(opts: { userId?: string; type?: string; limit?: number } = {}): Activity[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.userId) {
      where.push('a.user_id = ?');
      params.push(opts.userId);
    }
    if (opts.type) {
      where.push('a.type = ?');
      params.push(opts.type);
    }
    const sql = `${ACTIVITY_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...params, Math.min(opts.limit ?? 300, 1000)) as Row[]).map(toActivity);
  }

  private logActivity(prospectId: string | null, type: ActivityType, content: string, ts: string, userId: string | null = null): number {
    const res = this.db
      .prepare('INSERT INTO activities (prospect_id, user_id, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(prospectId, userId, type, content, ts);
    return Number(res.lastInsertRowid);
  }
}
