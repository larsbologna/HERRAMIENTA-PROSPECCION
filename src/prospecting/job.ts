import { randomUUID } from 'node:crypto';
import type { analyze as analyzeFn } from '../analyzer.js';
import type { CrmRepository } from '../crm/repository.js';
import type { GeneratedCandidate, generateProspects as generateFn } from '../generator/generator.js';
import type { GeneratorRepository } from '../generator/repository.js';
import type { Campaign, ProspectingRepository } from './repository.js';
import { assessPotential } from './potential.js';
import { matchesRubro } from './rubros.js';

/**
 * BÚSQUEDA AUTOMÁTICA DE PROSPECTOS (corre en segundo plano en el servidor).
 *
 *   FASE 1  buscar en Google Maps (solo el rubro pedido, sin repetir negocios ya entregados)
 *   FASE 2  analizar cada negocio de a UNO (Maps + web + Instagram + WhatsApp + reservas →
 *           oportunidades, potencial, argumento y mensaje): pensado para una PC con pocos recursos
 *   FASE 3  guardar cada resultado apenas termina (si algo se corta, lo hecho queda guardado)
 *   FASE 4  la interfaz solo consulta el avance (liviano) y después muestra la lista
 *
 * Si el análisis de un negocio falla, se reintenta una vez y, si sigue fallando, se informa y se
 * sigue con el próximo: un dato secundario nunca frena toda la búsqueda.
 */

export type JobPhase = 'buscando' | 'analizando' | 'terminado' | 'cancelado' | 'error';
export type JobItemState = 'pendiente' | 'analizando' | 'listo' | 'reutilizado' | 'duplicado' | 'error';

export interface JobItem {
  name: string;
  state: JobItemState;
  prospectId?: string;
  potential?: string | null;
  detail?: string;
}

export interface JobState {
  id: string;
  userId: string;
  userName: string;
  rubro: string;
  zona: string;
  cantidad: number;
  campaignId: string;
  campaignLabel: string;
  phase: JobPhase;
  percent: number;
  message: string;
  items: JobItem[];
  found: number;
  analyzed: number;
  reused: number;
  duplicates: number;
  failed: number;
  startedAt: string;
  finishedAt?: string;
  /** Mensaje final ("Se encontraron 7 prospectos nuevos válidos…"). */
  result?: string;
}

export interface JobDeps {
  crm: CrmRepository;
  generator: GeneratorRepository;
  prospecting: ProspectingRepository;
  generate: typeof generateFn;
  analyze: typeof analyzeFn;
  log?: (msg: string) => void;
  /** Análisis de menos de estos días se reutilizan (no se vuelve a analizar). */
  reuseDays?: number;
}

export interface JobRequest {
  rubro: string;
  zona: string;
  cantidad: number;
  user: { id: string; name: string };
}

const now = () => new Date().toISOString();

export class ProspectingJobs {
  private job: JobState | undefined;
  private controller: AbortController | undefined;
  private running: Promise<void> | undefined;

  constructor(private readonly deps: JobDeps) {}

  current(): JobState | undefined {
    return this.job;
  }

  isRunning(): boolean {
    return !!this.job && (this.job.phase === 'buscando' || this.job.phase === 'analizando');
  }

  /** Inicia una búsqueda. Devuelve el estado inicial (el trabajo sigue en segundo plano). */
  start(req: JobRequest): JobState {
    if (this.isRunning()) throw new Error(`Ya hay una búsqueda en curso (${this.job!.userName}). Esperá a que termine.`);
    const campaign = this.deps.prospecting.ensureCampaign(req.rubro, req.zona, req.user.id);
    this.controller = new AbortController();
    this.job = {
      id: randomUUID(), userId: req.user.id, userName: req.user.name, rubro: req.rubro, zona: req.zona, cantidad: req.cantidad,
      campaignId: campaign.id, campaignLabel: campaign.label, phase: 'buscando', percent: 1, message: 'Buscando negocios en Google Maps…',
      items: [], found: 0, analyzed: 0, reused: 0, duplicates: 0, failed: 0, startedAt: now(),
    };
    const job = this.job;
    this.running = this.run(job, campaign, req, this.controller.signal).catch((err) => {
      job.phase = this.controller?.signal.aborted ? 'cancelado' : 'error';
      job.message = (err as Error).message;
      job.result = job.analyzed ? `${job.message} Se guardaron ${job.analyzed} prospecto(s) analizados.` : job.message;
      job.finishedAt = now();
    });
    return job;
  }

  cancel(): void {
    this.controller?.abort();
  }

  /** Para tests: esperar a que termine el trabajo en curso. */
  async wait(): Promise<JobState | undefined> {
    await this.running;
    return this.job;
  }

  private async run(job: JobState, campaign: Campaign, req: JobRequest, signal: AbortSignal): Promise<void> {
    const { crm, generator, generate, analyze } = this.deps;
    const log = this.deps.log ?? (() => {});

    // ---------------- FASE 1: búsqueda (solo el rubro pedido, nunca un negocio ya entregado)
    const runId = generator.startRun({ rubro: req.rubro, zona: req.zona, requested: req.cantidad, userId: req.user.id, campaignId: campaign.id });
    const result = await generate({ rubro: req.rubro, zona: req.zona, cantidad: req.cantidad }, {
      known: generator.knownKeys(),
      signal,
      rubroFilter: (c) => matchesRubro(req.rubro, c),
      onProgress: (p) => {
        job.percent = Math.max(job.percent, Math.min(30, Math.round(p.percent * 0.3)));
        job.message = p.message;
      },
    });
    if (signal.aborted) throw new Error('Búsqueda cancelada.');
    const saved = generator.saveRun(runId, { rubro: req.rubro, zona: req.zona, userId: req.user.id, campaignId: campaign.id }, result);
    const byUrl = new Map(saved.map((g) => [g.mapsUrl, g.id]));
    const candidates: Array<GeneratedCandidate & { genId?: string }> = result.items.map((c) => ({ ...c, genId: byUrl.get(c.mapsUrl) }));
    job.found = candidates.length;
    job.items = candidates.map((c) => ({ name: c.name, state: 'pendiente' }));
    log(`prospección: ${candidates.length} negocio(s) nuevos de "${req.rubro}" en ${req.zona}; analizando…`);

    // ---------------- FASE 2 y 3: análisis de a uno, guardado inmediato
    job.phase = 'analizando';
    const reuseMs = (this.deps.reuseDays ?? 14) * 86_400_000;
    for (const [i, c] of candidates.entries()) {
      if (signal.aborted) throw new Error('Búsqueda cancelada.');
      const item = job.items[i]!;
      item.state = 'analizando';
      const base = 30 + Math.round((i / Math.max(1, candidates.length)) * 68);
      job.percent = base;
      job.message = `Analizando ${i + 1} de ${candidates.length}: ${c.name}…`;

      // Reutilizar un análisis reciente del mismo negocio.
      const prev = crm.findAnalyzed(c.name, c.address, c.phone);
      if (prev && Date.now() - Date.parse(prev.analyzedAt) < reuseMs) {
        crm.setCampaignIfMissing(prev.id, campaign.id);
        if (c.genId) generator.linkProspect(c.genId, prev.id);
        Object.assign(item, { state: 'reutilizado', prospectId: prev.id, detail: 'Análisis reciente reutilizado' });
        job.reused++;
        job.analyzed++;
        continue;
      }

      let analysis: Awaited<ReturnType<typeof analyze>> | undefined;
      let lastError = '';
      for (let attempt = 0; attempt < 2 && !analysis; attempt++) {
        try {
          analysis = await analyze(c.mapsUrl, {
            signal,
            onProgress: (p) => {
              job.percent = base + Math.round((p.percent / 100) * (68 / Math.max(1, candidates.length)));
              job.message = `Analizando ${i + 1} de ${candidates.length}: ${c.name} · ${p.message}`;
            },
          });
        } catch (err) {
          lastError = (err as Error).message;
          if (signal.aborted) throw new Error('Búsqueda cancelada.');
          // Google bloqueó: no tiene sentido seguir (lo hecho queda guardado).
          if (/verificación|anti-robots/i.test(lastError)) throw new Error(`Google pidió una verificación y se detuvo la búsqueda: ${lastError}`);
        }
      }
      if (!analysis) {
        Object.assign(item, { state: 'error', detail: `No se pudo analizar: ${lastError}` });
        if (c.genId) generator.setAnalysisError(c.genId, lastError || 'Error desconocido');
        job.failed++;
        continue;
      }

      // El mismo negocio con otro nombre (mismo Instagram o WhatsApp): no se entrega dos veces.
      const dup = crm.findChannelDuplicate(analysis);
      if (dup) {
        Object.assign(item, { state: 'duplicado', detail: `Duplicado de "${dup.name}" (${dup.reason})` });
        if (c.genId) generator.discard(c.genId, `${dup.reason}: ${dup.name}`);
        job.duplicates++;
        continue;
      }

      const savedP = crm.saveAnalysis(analysis, { userId: req.user.id, campaignId: campaign.id });
      if (c.genId) {
        generator.linkProspect(c.genId, savedP.id);
        generator.setAnalysisError(c.genId, null);
      }
      Object.assign(item, { state: 'listo', prospectId: savedP.id, potential: assessPotential(analysis).level });
      job.analyzed++;
    }

    // ---------------- Resultado
    const n = job.analyzed;
    const parts = [`Se encontraron ${job.found} prospecto${job.found === 1 ? '' : 's'} nuevo${job.found === 1 ? '' : 's'} válido${job.found === 1 ? '' : 's'} y ${n === job.found ? 'se analizaron todos' : `se analizaron ${n}`}.`];
    if (job.found < req.cantidad && !result.timedOut) parts.push(`No hay suficientes negocios nuevos para completar ${req.cantidad} sin repetir.`);
    if (result.timedOut) parts.push('La búsqueda llegó al tiempo máximo: podés volver a buscar para seguir.');
    if (job.duplicates) parts.push(`${job.duplicates} resultaron duplicados de negocios que ya tenías (no se repiten).`);
    if (job.failed) parts.push(`${job.failed} no se pudieron analizar (quedan en el Generador para reintentar).`);
    if (result.stats.outOfRubro) parts.push(`Se descartaron ${result.stats.outOfRubro} de otro rubro.`);
    job.result = parts.join(' ');
    job.message = job.result;
    job.percent = 100;
    job.phase = 'terminado';
    job.finishedAt = now();
    crm.logSystem('generador', req.user.id, `Prospección "${campaign.label}": ${job.found} encontrados, ${n} analizados`);
    log(`✔ prospección: ${n}/${req.cantidad} analizados (${campaign.label})`);
  }
}
