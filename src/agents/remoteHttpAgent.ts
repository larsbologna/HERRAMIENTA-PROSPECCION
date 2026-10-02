import type { AgentInput, AgentOutput, AnalysisAgent } from './types.js';

/**
 * Agente remoto: envía el AgentInput por POST (JSON) y espera un AgentOutput.
 * Es el puente natural con la FÁBRICA DE AGENTES IA: cada agente de la fábrica
 * expone un endpoint y se registra en AGENT_ENDPOINTS.
 */
export class RemoteHttpAgent implements AnalysisAgent {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  constructor(private readonly endpoint: string, private readonly token?: string) {
    const url = new URL(endpoint);
    this.id = `remote:${url.host}${url.pathname}`;
    this.name = `Agente remoto ${url.pathname.split('/').filter(Boolean).pop() ?? url.host}`;
    this.description = `Agente HTTP en ${endpoint}`;
  }

  async run(input: AgentInput, signal: AbortSignal): Promise<AgentOutput> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ type: 'prospect.audit.enrich', version: 1, input }),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const body = (await res.json()) as AgentOutput;
    return sanitize(body, this.id);
  }
}

/** Valida mínimamente la respuesta para no romper el informe con datos inesperados. */
function sanitize(out: AgentOutput, source: string): AgentOutput {
  const areas = new Set(['maps', 'website', 'whatsapp', 'reputation', 'qr']);
  const severities = new Set(['critical', 'high', 'medium', 'low']);
  return {
    findings: (Array.isArray(out.findings) ? out.findings : [])
      .filter((f) => f && typeof f.id === 'string' && typeof f.title === 'string' && areas.has(f.area) && severities.has(f.severity))
      .map((f) => ({ ...f, detail: String(f.detail ?? ''), source: f.source || source })),
    opportunities: (Array.isArray(out.opportunities) ? out.opportunities : [])
      .filter((o) => o && typeof o.id === 'string' && typeof o.title === 'string' && areas.has(o.area))
      .map((o) => ({ ...o, detail: String(o.detail ?? ''), source: o.source || source })),
    executiveSummary: typeof out.executiveSummary === 'string' ? out.executiveSummary : undefined,
    whatsappMessage: typeof out.whatsappMessage === 'string' ? out.whatsappMessage : undefined,
    notes: typeof out.notes === 'string' ? out.notes : undefined,
  };
}
