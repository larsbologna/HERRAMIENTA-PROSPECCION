import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { buildAnalysis } from '../analyzer.js';
import type { BusinessProfile, WebsiteAnalysis } from '../domain/types.js';
import type { CrmRepository } from './repository.js';

/** Formato mínimo de los informes de la primera versión (data/reports/<id>/report.json). */
interface LegacyReport {
  id: string;
  createdAt: string;
  input?: { url?: string };
  profile: BusinessProfile;
  website?: WebsiteAnalysis;
}

export interface ImportSummary {
  found: number;
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Importa los informes guardados por la primera versión de la herramienta.
 * Se re-auditan con las reglas actuales a partir de los datos leídos de Maps (sin volver a navegar).
 * Idempotente: cada informe se importa una sola vez.
 */
export function importLegacyReports(repo: CrmRepository, dataDir: string): ImportSummary {
  const dir = path.join(dataDir, 'reports');
  const summary: ImportSummary = { found: 0, imported: 0, skipped: 0, errors: [] };
  if (!existsSync(dir)) return summary;

  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry, 'report.json');
    if (!existsSync(file)) continue;
    summary.found++;
    const auditId = `legacy-${entry}`;
    if (repo.hasAudit(auditId)) {
      summary.skipped++;
      continue;
    }
    try {
      const report = JSON.parse(readFileSync(file, 'utf8')) as LegacyReport;
      if (!report.profile?.name) throw new Error('sin nombre de negocio');
      const profile: BusinessProfile = {
        ...report.profile,
        services: report.profile.services ?? [],
        posts: report.profile.posts ?? [],
        reviews: report.profile.reviews ?? [],
        socialLinks: report.profile.socialLinks ?? [],
        photoUrls: report.profile.photoUrls ?? [],
        warnings: report.profile.warnings ?? [],
        additionalCategories: report.profile.additionalCategories ?? [],
      };
      const url = report.input?.url ?? profile.sourceUrl;
      const analysis = buildAnalysis(url, profile, report.website, { durationMs: 0, analyzedAt: report.createdAt });
      repo.saveAnalysis(analysis, { source: 'importado', auditId });
      summary.imported++;
    } catch (err) {
      summary.errors.push(`${entry}: ${(err as Error).message}`);
    }
  }
  return summary;
}
