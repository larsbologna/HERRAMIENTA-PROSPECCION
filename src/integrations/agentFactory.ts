import { config } from '../config/index.js';
import type { AuditReport } from '../domain/types.js';

/**
 * Notifica a la FÁBRICA DE AGENTES IA que hay un nuevo prospecto auditado.
 * Envía el informe completo (sin imágenes) + enlaces a capturas y PDF.
 * El payload es estable y versionado para que la fábrica pueda enrutarlo
 * (p. ej. a un agente de seguimiento comercial o a un CRM).
 */
export interface ProspectEvent {
  type: 'prospect.audit.completed';
  version: 1;
  sentAt: string;
  links: { report: string; pdf: string; qrPage: string; screenshots: string[] };
  report: AuditReport;
}

export function buildProspectEvent(report: AuditReport): ProspectEvent {
  const base = `${config.publicBaseUrl}/api/audits/${report.id}`;
  return {
    type: 'prospect.audit.completed',
    version: 1,
    sentAt: new Date().toISOString(),
    links: {
      report: base,
      pdf: `${base}/pdf`,
      qrPage: `${config.publicBaseUrl}/r/${report.id}`,
      screenshots: report.screenshots.map((s) => `${config.publicBaseUrl}/files/${report.id}/${s.file}`),
    },
    report,
  };
}

export async function notifyAgentFactory(report: AuditReport): Promise<{ sent: boolean; error?: string }> {
  const url = config.agentFactory.webhookUrl;
  if (!url) return { sent: false };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.agentFactory.token ? { Authorization: `Bearer ${config.agentFactory.token}` } : {}),
      },
      body: JSON.stringify(buildProspectEvent(report)),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? { sent: true } : { sent: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}
