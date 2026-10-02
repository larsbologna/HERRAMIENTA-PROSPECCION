import { EventEmitter } from 'node:events';
import type { PipelineEvent } from './events.js';
import { newReportId, runPipeline, type PipelineOptions } from './pipeline.js';

export interface Job {
  id: string;
  url: string;
  status: 'queued' | 'running' | 'done' | 'error';
  events: PipelineEvent[];
  error?: string;
  createdAt: string;
}

/**
 * Cola de análisis en memoria con límite de concurrencia.
 * Guarda el historial de eventos para que un cliente que se conecta tarde
 * (o recarga la página) vea el progreso completo.
 */
export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly bus = new EventEmitter();
  private readonly queue: Job[] = [];
  private running = 0;

  constructor(
    private readonly concurrency = 2,
    private readonly pipelineOptions: Omit<PipelineOptions, 'emit' | 'reportId'> = {},
  ) {
    this.bus.setMaxListeners(100);
  }

  create(url: string): Job {
    const job: Job = { id: newReportId(), url, status: 'queued', events: [], createdAt: new Date().toISOString() };
    this.jobs.set(job.id, job);
    this.queue.push(job);
    this.pump();
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  subscribe(id: string, listener: (e: PipelineEvent) => void): () => void {
    this.bus.on(id, listener);
    return () => this.bus.off(id, listener);
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void this.execute(job).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async execute(job: Job): Promise<void> {
    job.status = 'running';
    const emit = (e: PipelineEvent) => {
      job.events.push(e);
      this.bus.emit(job.id, e);
    };
    try {
      await runPipeline(job.url, { ...this.pipelineOptions, reportId: job.id, emit });
      job.status = 'done';
    } catch (err) {
      job.status = 'error';
      job.error = (err as Error).message;
      if (!job.events.some((e) => e.type === 'error')) emit({ type: 'error', message: job.error });
    }
  }
}
