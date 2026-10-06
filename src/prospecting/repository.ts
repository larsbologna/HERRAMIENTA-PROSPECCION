import { randomUUID } from 'node:crypto';
import type { Db } from '../db/database.js';
import { POTENTIAL_ORDER } from './sql.js';
import { rubroKey, rubroLabel, zonaKey } from './rubros.js';

/**
 * CAMPAÑAS DE PROSPECCIÓN: rubro + zona + mes ("BARBERÍAS — QUILMES — OCTUBRE").
 * Cada búsqueda automática suma sus prospectos a la campaña del mes; los rubros nunca se mezclan.
 */

export interface Campaign {
  id: string;
  rubro: string;
  rubroKey: string;
  zona: string;
  zonaKey: string;
  month: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignSummary {
  /** Negocios entregados por las búsquedas de la campaña (incluye los que no se pudieron analizar). */
  found: number;
  analyzed: number;
  notContacted: number;
  contacted: number;
  responded: number;
  interested: number;
  later: number;
  notInterested: number;
  clients: number;
  /** Negocios descartados por duplicados o con análisis fallido. */
  discarded: number;
  failed: number;
  potential: { alto: number; medio: number; bajo: number };
}

export interface QueueItem {
  id: string;
  name: string;
  potentialLevel: string | null;
}

type Row = Record<string, unknown>;
const MONTHS = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

/** "2026-10" según la fecha local. */
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export function campaignLabel(rubro: string, zona: string, month: string): string {
  const [y, m] = month.split('-').map(Number);
  const mes = MONTHS[(m ?? 1) - 1] ?? month;
  const year = y && y !== new Date().getFullYear() ? ` ${y}` : '';
  return `${rubroLabel(rubro).toUpperCase()} — ${zona.trim().toUpperCase()} — ${mes}${year}`;
}

const toCampaign = (r: Row): Campaign => ({
  id: String(r.id),
  rubro: String(r.rubro),
  rubroKey: String(r.rubro_key),
  zona: String(r.zona),
  zonaKey: String(r.zona_key),
  month: String(r.month),
  label: String(r.label),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export class ProspectingRepository {
  constructor(private readonly db: Db) {}

  /** Campaña del mes para ese rubro y zona (la crea si no existe). */
  ensureCampaign(rubro: string, zona: string, userId: string | null, month = monthKey()): Campaign {
    const rk = rubroKey(rubro);
    const zk = zonaKey(zona);
    const found = this.db.prepare('SELECT * FROM campaigns WHERE rubro_key = ? AND zona_key = ? AND month = ?').get(rk, zk, month) as Row | undefined;
    const ts = new Date().toISOString();
    if (found) {
      this.db.prepare('UPDATE campaigns SET updated_at = ? WHERE id = ?').run(ts, String(found.id));
      return toCampaign({ ...found, updated_at: ts });
    }
    const id = randomUUID();
    const label = campaignLabel(rubro, zona, month);
    this.db
      .prepare('INSERT INTO campaigns (id, rubro, rubro_key, zona, zona_key, month, label, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, rubroLabel(rubro), rk, zona.trim(), zk, month, label, userId, ts, ts);
    return this.get(id)!;
  }

  get(id: string): Campaign | undefined {
    const r = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Row | undefined;
    return r ? toCampaign(r) : undefined;
  }

  list(): Campaign[] {
    return (this.db.prepare('SELECT * FROM campaigns ORDER BY updated_at DESC').all() as Row[]).map(toCampaign);
  }

  /** Zonas usadas en campañas anteriores (para sugerirlas). */
  zonas(): string[] {
    return (this.db.prepare('SELECT zona, MAX(updated_at) AS u FROM campaigns GROUP BY zona_key ORDER BY u DESC').all() as Row[]).map((r) => String(r.zona));
  }

  /** Resumen de la campaña. Un vendedor ve solo sus prospectos (userId). */
  summary(campaignId: string, userId?: string): CampaignSummary {
    const scope = userId ? ' AND p.assigned_user_id = ?' : '';
    const args = userId ? [campaignId, userId] : [campaignId];
    const r = this.db.prepare(`SELECT
        COUNT(*) AS analyzed,
        SUM(p.status = 'sin_contactar') AS not_contacted,
        SUM(p.max_stage >= 1) AS contacted,
        SUM(p.max_stage >= 2) AS responded,
        SUM(p.status IN ('interesado', 'reunion', 'propuesta', 'cliente')) AS interested,
        SUM(p.status = 'contactar_despues') AS later,
        SUM(p.status = 'perdido') AS not_interested,
        SUM(p.status = 'cliente') AS clients,
        SUM(p.potential_level = 'alto') AS alto,
        SUM(p.potential_level = 'medio') AS medio,
        SUM(p.potential_level = 'bajo') AS bajo
      FROM prospects p WHERE p.campaign_id = ?${scope}`).get(...args) as Row;
    const g = this.db.prepare(`SELECT COUNT(*) AS found, SUM(discard_reason IS NOT NULL) AS discarded, SUM(analysis_error IS NOT NULL AND prospect_id IS NULL AND discard_reason IS NULL) AS failed
      FROM generated_prospects WHERE campaign_id = ?${userId ? ' AND user_id = ?' : ''}`).get(...args) as Row;
    const n = (v: unknown) => Number(v ?? 0);
    const analyzed = n(r.analyzed);
    return {
      found: Math.max(n(g.found) - n(g.discarded), analyzed),
      analyzed,
      notContacted: n(r.not_contacted),
      contacted: n(r.contacted),
      responded: n(r.responded),
      interested: n(r.interested),
      later: n(r.later),
      notInterested: n(r.not_interested),
      clients: n(r.clients),
      discarded: n(g.discarded),
      failed: n(g.failed),
      potential: { alto: n(r.alto), medio: n(r.medio), bajo: n(r.bajo) },
    };
  }

  /**
   * Cola de "Siguiente prospecto": SOLO los no contactados de la campaña (o de los filtros), por
   * potencial (alto primero) y reseñas. Un vendedor solo ve los suyos.
   */
  queue(f: { campaignId?: string; rubro?: string; zona?: string; potential?: string; userId?: string }): QueueItem[] {
    const where = [`p.status = 'sin_contactar'`];
    const args: string[] = [];
    if (f.campaignId) { where.push('p.campaign_id = ?'); args.push(f.campaignId); }
    if (f.rubro === 'none') where.push('p.rubro_key IS NULL');
    else if (f.rubro) { where.push('p.rubro_key = ?'); args.push(f.rubro); }
    if (f.zona) { where.push('c.zona_key = ?'); args.push(f.zona); }
    if (f.potential) { where.push('p.potential_level = ?'); args.push(f.potential); }
    if (f.userId) { where.push('p.assigned_user_id = ?'); args.push(f.userId); }
    const rows = this.db.prepare(`SELECT p.id, p.name, p.potential_level FROM prospects p LEFT JOIN campaigns c ON c.id = p.campaign_id
      WHERE ${where.join(' AND ')} ORDER BY ${POTENTIAL_ORDER}, COALESCE(p.review_count, 0) DESC, p.created_at ASC, p.id ASC`).all(...args) as Row[];
    return rows.map((r) => ({ id: String(r.id), name: String(r.name), potentialLevel: (r.potential_level as string) ?? null }));
  }
}
