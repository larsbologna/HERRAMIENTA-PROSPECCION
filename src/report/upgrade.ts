import { buildContext } from '../auditor/auditor.js';
import type { AuditReport } from '../domain/types.js';
import { buildSalesArguments } from '../proposal/salesArguments.js';

/**
 * Actualiza en memoria informes guardados con versiones anteriores del formato,
 * para que la interfaz, el PDF y la API funcionen igual con el historial.
 */
export function upgradeReport(report: AuditReport): AuditReport {
  if (report.version >= 2 && report.proposal.salesArguments) return report;
  const ctx = buildContext(report.profile, report.website);
  const salesArguments = buildSalesArguments(ctx, report.audit.findings);
  const services = report.proposal.services.map((s) => ({
    ...s,
    solves: s.solves ?? salesArguments.filter((a) => a.serviceIds.includes(s.id)).map((a) => a.problem),
  }));
  return { ...report, proposal: { ...report.proposal, salesArguments, services } };
}
