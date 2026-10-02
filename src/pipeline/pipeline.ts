import { randomUUID } from 'node:crypto';
import type { Browser } from 'playwright';
import { agentRegistry } from '../agents/registry.js';
import type { AgentOutput, AnalysisAgent } from '../agents/types.js';
import { buildContext, finalizeAudit, runAudit } from '../auditor/auditor.js';
import type { AuditContext } from '../auditor/context.js';
import type { AgentContributionRecord, AuditReport, AuditResult, Proposal, Screenshot, WebsiteAnalysis } from '../domain/types.js';
import { notifyAgentFactory } from '../integrations/agentFactory.js';
import { buildProposal } from '../proposal/proposalEngine.js';
import { whatsappLink } from '../proposal/whatsappMessage.js';
import { buildExecutiveSummary } from '../report/summary.js';
import { launchBrowser } from '../scraper/browser.js';
import { isMapsUrl, scrapeMapsProfile } from '../scraper/mapsScraper.js';
import { analyzeWebsite, emptyAnalysis, isSocialOrDirectory } from '../scraper/websiteAnalyzer.js';
import { prepareReportDir, saveReport, screenshotDir } from '../storage/reportStore.js';
import { createLogger } from '../utils/logger.js';
import { STEPS, type PipelineEvent, type StepId, type StepStatus } from './events.js';
import path from 'node:path';

const log = createLogger('pipeline');
export const REPORT_VERSION = 2;

export interface PipelineOptions {
  /** Permite reutilizar un navegador (tests, procesamiento por lotes). */
  browser?: Browser;
  agents?: AnalysisAgent[];
  emit?: (event: PipelineEvent) => void;
  reportId?: string;
  agentTimeoutMs?: number;
  /** Solo para tests con fichas simuladas: desactiva la validación de URL de Maps. */
  skipUrlValidation?: boolean;
}

const STEP_RANGE: Record<StepId, [number, number]> = {
  maps: [0, 45],
  website: [45, 72],
  audit: [72, 80],
  agents: [80, 90],
  report: [90, 100],
};

export function newReportId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${date}-${randomUUID().slice(0, 8)}`;
}

/**
 * Orquesta todo el análisis: Maps → web → auditoría → agentes → propuesta → informe.
 * Cada paso emite eventos de progreso (la interfaz web los recibe por SSE).
 */
export async function runPipeline(url: string, opts: PipelineOptions = {}): Promise<AuditReport> {
  if (!opts.skipUrlValidation && !isMapsUrl(url)) throw new Error('La URL no parece un enlace de Google Maps.');
  const id = opts.reportId ?? newReportId();
  const emit = opts.emit ?? (() => {});
  const agents = opts.agents ?? agentRegistry.list();
  const shots: Screenshot[] = [];
  let current: StepId = 'maps';

  const step = (s: StepId, status: StepStatus) => {
    current = s;
    const label = STEPS.find((x) => x.id === s)!.label;
    const progress = status === 'running' ? STEP_RANGE[s][0] : STEP_RANGE[s][1];
    emit({ type: 'step', step: s, status, label, progress });
  };
  let tick = 0;
  const progressLog = (message: string) => {
    const [from, to] = STEP_RANGE[current];
    tick++;
    emit({ type: 'log', message, progress: Math.min(to - 1, from + tick * 3) });
    log.info(`[${id}] ${message}`);
  };
  const onScreenshot = (s: Screenshot) => {
    shots.push(s);
    emit({ type: 'screenshot', screenshot: s, url: `/files/${id}/${s.file}` });
  };

  await prepareReportDir(id);
  const dir = screenshotDir(id);
  const browser = opts.browser ?? (await launchBrowser());

  try {
    // 1. Google Maps
    step('maps', 'running');
    const { profile } = await scrapeMapsProfile(browser, url, { screenshotDir: dir, onProgress: progressLog, onScreenshot });
    if (!profile.name) throw new Error('No se pudo leer la ficha de Google Maps (¿la URL es de un negocio? ¿Google pidió verificación?).');
    step('maps', 'done');

    // 2. Sitio web
    tick = 0;
    let website: WebsiteAnalysis | undefined;
    if (!profile.website) {
      progressLog('La ficha no tiene sitio web.');
      step('website', 'skipped');
    } else if (isSocialOrDirectory(profile.website)) {
      step('website', 'running');
      progressLog(`El enlace (${profile.website}) es una red social o directorio, no una web propia.`);
      website = emptyAnalysis(profile.website);
      step('website', 'done');
    } else {
      step('website', 'running');
      website = await analyzeWebsite(browser, profile.website, { screenshotDir: dir, onProgress: progressLog, onScreenshot });
      step('website', 'done');
    }

    // 3. Auditoría
    tick = 0;
    step('audit', 'running');
    const ctx = buildContext(profile, website);
    let audit = runAudit(ctx);
    progressLog(`${audit.findings.length} problemas y ${audit.opportunities.length} oportunidades detectadas.`);
    let proposal = buildProposal(ctx, audit);
    let summary = buildExecutiveSummary(ctx, audit, proposal);
    step('audit', 'done');

    // 4. Agentes IA (opcionales)
    tick = 0;
    const contributions: AgentContributionRecord[] = [];
    if (agents.length) {
      step('agents', 'running');
      const merged = await runAgents(agents, { id, ctx, audit, proposal, summary, shots, dir }, opts.agentTimeoutMs ?? 60_000, progressLog);
      contributions.push(...merged.records);
      ({ audit, proposal, summary } = applyAgentOutputs(ctx, audit, proposal, summary, merged.outputs));
      step('agents', 'done');
    } else {
      step('agents', 'skipped');
    }

    // 5. Informe
    tick = 0;
    step('report', 'running');
    const report: AuditReport = {
      id,
      createdAt: new Date().toISOString(),
      input: { url },
      profile,
      website,
      audit,
      proposal,
      executiveSummary: summary,
      screenshots: shots,
      agentContributions: contributions,
      version: REPORT_VERSION,
    };
    await saveReport(report);
    const factory = await notifyAgentFactory(report);
    if (factory.sent) progressLog('Informe enviado a la FÁBRICA DE AGENTES IA.');
    else if (factory.error) progressLog(`No se pudo notificar a la FÁBRICA DE AGENTES: ${factory.error}`);
    step('report', 'done');
    emit({ type: 'done', reportId: id, progress: 100 });
    return report;
  } catch (err) {
    step(current, 'error');
    emit({ type: 'error', message: (err as Error).message });
    throw err;
  } finally {
    if (!opts.browser) await browser.close().catch(() => {});
  }
}

interface AgentRunState {
  id: string;
  ctx: AuditContext;
  audit: AuditResult;
  proposal: Proposal;
  summary: string;
  shots: Screenshot[];
  dir: string;
}

async function runAgents(agents: AnalysisAgent[], s: AgentRunState, timeoutMs: number, progress: (m: string) => void) {
  const input = {
    reportId: s.id,
    profile: s.ctx.profile,
    website: s.ctx.website,
    audit: s.audit,
    proposal: s.proposal,
    executiveSummary: s.summary,
    vertical: { id: s.ctx.vertical.id, label: s.ctx.vertical.label },
    screenshotPaths: s.shots.map((x) => path.join(s.dir, path.basename(x.file))),
  };
  const records: AgentContributionRecord[] = [];
  const outputs: AgentOutput[] = [];
  // En paralelo: un agente lento o caído no bloquea el informe.
  await Promise.all(
    agents.map(async (agent) => {
      const started = Date.now();
      progress(`Ejecutando ${agent.name}…`);
      try {
        const out = await agent.run(input, AbortSignal.timeout(timeoutMs));
        outputs.push(out);
        records.push({ agentId: agent.id, agentName: agent.name, ok: true, notes: out.notes, durationMs: Date.now() - started });
      } catch (err) {
        records.push({ agentId: agent.id, agentName: agent.name, ok: false, error: (err as Error).message, durationMs: Date.now() - started });
        progress(`${agent.name} falló: ${(err as Error).message}`);
      }
    }),
  );
  return { records, outputs };
}

function applyAgentOutputs(ctx: AuditContext, audit: AuditResult, proposal: Proposal, summary: string, outputs: AgentOutput[]) {
  const extraFindings = outputs.flatMap((o) => o.findings ?? []);
  const extraOpps = outputs.flatMap((o) => o.opportunities ?? []);
  let nextAudit = audit;
  let nextProposal = proposal;
  let nextSummary = summary;
  if (extraFindings.length || extraOpps.length) {
    nextAudit = finalizeAudit(ctx, [...audit.findings, ...extraFindings], [...audit.opportunities, ...extraOpps]);
    nextProposal = buildProposal(ctx, nextAudit);
    nextSummary = buildExecutiveSummary(ctx, nextAudit, nextProposal);
  }
  const summaryOverride = outputs.map((o) => o.executiveSummary).find(Boolean);
  if (summaryOverride) nextSummary = summaryOverride;
  const messageOverride = outputs.map((o) => o.whatsappMessage).find(Boolean);
  if (messageOverride) {
    nextProposal = { ...nextProposal, whatsappMessage: messageOverride, whatsappLink: whatsappLink(ctx.profile.phone, messageOverride) };
  }
  return { audit: nextAudit, proposal: nextProposal, summary: nextSummary };
}
