import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import type { AuditReport } from '../domain/types.js';
import { upgradeReport } from '../report/upgrade.js';

/** Almacenamiento en disco: data/reports/<id>/{report.json, screenshots/, report.pdf}. */
export const reportsDir = () => path.join(config.dataDir, 'reports');
export const reportDir = (id: string) => path.join(reportsDir(), safeId(id));
export const screenshotDir = (id: string) => path.join(reportDir(id), 'screenshots');

export function safeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(id)) throw new Error('Identificador de informe inválido');
  return id;
}

export async function prepareReportDir(id: string): Promise<void> {
  await fs.mkdir(screenshotDir(id), { recursive: true });
}

export async function saveReport(report: AuditReport): Promise<string> {
  const file = path.join(reportDir(report.id), 'report.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

export async function loadReport(id: string): Promise<AuditReport | undefined> {
  try {
    const raw = await fs.readFile(path.join(reportDir(id), 'report.json'), 'utf8');
    return upgradeReport(JSON.parse(raw) as AuditReport);
  } catch {
    return undefined;
  }
}

export interface ReportSummary {
  id: string;
  createdAt: string;
  name?: string;
  category?: string;
  overallScore: number;
  rating?: number;
  reviewCount?: number;
}

export async function listReports(limit = 50): Promise<ReportSummary[]> {
  const dirs = await fs.readdir(reportsDir()).catch(() => [] as string[]);
  const reports = await Promise.all(dirs.map((d) => loadReport(d).catch(() => undefined)));
  return reports
    .filter((r): r is AuditReport => !!r)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      name: r.profile.name,
      category: r.profile.category,
      overallScore: r.audit.overallScore,
      rating: r.profile.rating,
      reviewCount: r.profile.reviewCount,
    }));
}
