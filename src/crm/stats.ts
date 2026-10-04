import type { AreaScore, ServiceRecommendation } from '../domain/types.js';
import { SERVICE_CATALOG } from '../proposal/services.js';
import { STATUSES, type ProspectSummary } from './types.js';

type StatRow = ProspectSummary & { services: ServiceRecommendation[]; areaScores: AreaScore[] };

const OPEN = (p: ProspectSummary) => p.status !== 'cliente' && p.status !== 'perdido';
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? Math.round(sum(xs) / xs.length) : 0);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** Últimos N meses como claves "2026-10" (el último es el mes actual). */
export function lastMonths(n: number, ref = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
const monthOf = (iso: string) => iso.slice(0, 7);

/** Embudo acumulado: cuántos prospectos llegaron AL MENOS a cada etapa (aunque después se perdieran). */
export function funnel(rows: ProspectSummary[]) {
  const steps = [
    { id: 'analizados', label: 'Analizados', count: rows.length },
    { id: 'contactados', label: 'Contactados', count: rows.filter((r) => r.maxStage >= 1).length },
    { id: 'respondieron', label: 'Respondieron', count: rows.filter((r) => r.maxStage >= 2).length },
    { id: 'reuniones', label: 'Reuniones', count: rows.filter((r) => r.maxStage >= 3).length },
    { id: 'propuestas', label: 'Propuestas', count: rows.filter((r) => r.maxStage >= 4).length },
    { id: 'clientes', label: 'Clientes', count: rows.filter((r) => r.status === 'cliente').length },
  ];
  return steps.map((s, i) => ({ ...s, rateFromPrevious: i === 0 ? 100 : pct(s.count, steps[i - 1]!.count), rateFromStart: pct(s.count, rows.length) }));
}

export function dashboard(rows: StatRow[], statusChanges: Array<{ toStatus: string; createdAt: string }>, months = 12) {
  const keys = lastMonths(months);
  const f = funnel(rows);
  const clients = rows.filter((r) => r.status === 'cliente');
  const closedValue = sum(clients.map((r) => r.closedValue ?? r.potentialValue));

  // Valor potencial acumulado: suma, mes a mes, del valor potencial de los prospectos analizados hasta ese mes.
  let running = sum(rows.filter((r) => monthOf(r.createdAt) < keys[0]!).map((r) => r.potentialValue));
  const potentialSeries = keys.map((m) => {
    running += sum(rows.filter((r) => monthOf(r.createdAt) === m).map((r) => r.potentialValue));
    return { month: m, value: running };
  });

  return {
    kpis: {
      analyzed: rows.length,
      notContacted: rows.filter((r) => r.status === 'sin_contactar').length,
      contacted: f[1]!.count,
      responded: f[2]!.count,
      meetings: f[3]!.count,
      clients: clients.length,
      potentialValue: sum(rows.filter(OPEN).map((r) => r.potentialValue)),
      closedValue,
    },
    prospectsByMonth: keys.map((m) => ({ month: m, value: rows.filter((r) => monthOf(r.createdAt) === m).length })),
    conversionsByMonth: keys.map((m) => ({
      month: m,
      contacted: statusChanges.filter((c) => c.toStatus === 'contactado' && monthOf(c.createdAt) === m).length,
      clients: statusChanges.filter((c) => c.toStatus === 'cliente' && monthOf(c.createdAt) === m).length,
    })),
    funnel: f,
    byStatus: STATUSES.map((s) => ({ id: s.id, label: s.label, count: rows.filter((r) => r.status === s.id).length, value: sum(rows.filter((r) => r.status === s.id).map((r) => r.potentialValue)) })),
    potentialSeries,
    recent: [...rows].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, 6),
    hot: rows
      .filter((r) => r.status === 'sin_contactar')
      .sort((a, b) => b.potentialValue - a.potentialValue || a.score - b.score)
      .slice(0, 5),
  };
}

export function metrics(rows: StatRow[]) {
  const f = funnel(rows);
  const clients = rows.filter((r) => r.status === 'cliente');
  const contacted = f[1]!.count;

  // Servicios recomendados (prioridad alta y media)
  const serviceCount = new Map<string, { count: number; high: number }>();
  for (const r of rows) {
    for (const s of r.services) {
      if (s.priority === 'baja') continue;
      const e = serviceCount.get(s.id) ?? { count: 0, high: 0 };
      e.count++;
      if (s.priority === 'alta') e.high++;
      serviceCount.set(s.id, e);
    }
  }
  const services = [...serviceCount.entries()]
    .map(([id, e]) => ({ id, name: SERVICE_CATALOG[id as keyof typeof SERVICE_CATALOG]?.name ?? id, count: e.count, high: e.high, share: pct(e.count, rows.length) }))
    .sort((a, b) => b.count - a.count);

  // Rubros
  const verticals = new Map<string, StatRow[]>();
  for (const r of rows) {
    const k = r.verticalLabel ?? 'Sin rubro';
    verticals.set(k, [...(verticals.get(k) ?? []), r]);
  }
  const byVertical = [...verticals.entries()]
    .map(([label, rs]) => ({
      label,
      count: rs.length,
      avgScore: avg(rs.map((r) => r.score)),
      potential: sum(rs.filter(OPEN).map((r) => r.potentialValue)),
      clients: rs.filter((r) => r.status === 'cliente').length,
    }))
    .sort((a, b) => b.count - a.count);

  // Scores por área
  const areas = new Map<string, { label: string; scores: number[] }>();
  for (const r of rows) {
    for (const a of r.areaScores) {
      const e = areas.get(a.area) ?? { label: a.label, scores: [] };
      e.scores.push(a.score);
      areas.set(a.area, e);
    }
  }

  const buckets = [
    { label: '0–39', min: 0, max: 39 },
    { label: '40–59', min: 40, max: 59 },
    { label: '60–79', min: 60, max: 79 },
    { label: '80–100', min: 80, max: 100 },
  ].map((b) => ({ label: b.label, count: rows.filter((r) => r.score >= b.min && r.score <= b.max).length }));

  const open = rows.filter(OPEN);
  return {
    totals: {
      prospects: rows.length,
      potentialValue: sum(open.map((r) => r.potentialValue)),
      projectTotal: sum(open.map((r) => r.projectTotal)),
      closedValue: sum(clients.map((r) => r.closedValue ?? r.potentialValue)),
      clients: clients.length,
      lost: rows.filter((r) => r.status === 'perdido').length,
      conversionRate: pct(clients.length, contacted),
      conversionFromAnalyzed: pct(clients.length, rows.length),
      averageTicket: avg(rows.map((r) => r.potentialValue)),
      averageClosedTicket: avg(clients.map((r) => r.closedValue ?? r.potentialValue)),
      averageScore: avg(rows.map((r) => r.score)),
    },
    funnel: f,
    services,
    byVertical,
    areaScores: [...areas.entries()].map(([area, e]) => ({ area, label: e.label, avg: avg(e.scores) })),
    scoreDistribution: buckets,
  };
}
