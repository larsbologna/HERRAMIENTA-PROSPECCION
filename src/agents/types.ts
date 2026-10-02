import type {
  AuditResult,
  BusinessProfile,
  Finding,
  Opportunity,
  Proposal,
  WebsiteAnalysis,
} from '../domain/types.js';

/**
 * Contrato para agentes IA que enriquecen el análisis.
 *
 * Un agente recibe el contexto completo (datos de Maps, web, auditoría y propuesta
 * preliminar) y devuelve aportes parciales que el pipeline fusiona en el informe.
 * Puede ser local (código TypeScript que llama a un LLM) o remoto (un agente de la
 * FÁBRICA DE AGENTES IA expuesto por HTTP: ver RemoteHttpAgent).
 */
export interface AgentInput {
  reportId: string;
  profile: BusinessProfile;
  website?: WebsiteAnalysis;
  audit: AuditResult;
  proposal: Proposal;
  executiveSummary: string;
  /** Rubro detectado (id y etiqueta). */
  vertical: { id: string; label: string };
  /** Rutas absolutas a las capturas, por si el agente usa visión. */
  screenshotPaths: string[];
}

export interface AgentOutput {
  findings?: Finding[];
  opportunities?: Opportunity[];
  /** Reemplaza el resumen ejecutivo. */
  executiveSummary?: string;
  /** Reemplaza el mensaje comercial de WhatsApp. */
  whatsappMessage?: string;
  notes?: string;
}

export interface AnalysisAgent {
  id: string;
  name: string;
  description: string;
  run(input: AgentInput, signal: AbortSignal): Promise<AgentOutput>;
}
