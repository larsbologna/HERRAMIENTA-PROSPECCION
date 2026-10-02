import type { Screenshot } from '../domain/types.js';

export type StepId = 'maps' | 'website' | 'audit' | 'agents' | 'report';
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'maps', label: 'Extrayendo ficha de Google Maps' },
  { id: 'website', label: 'Analizando sitio web' },
  { id: 'audit', label: 'Auditando presencia online' },
  { id: 'agents', label: 'Agentes IA' },
  { id: 'report', label: 'Generando informe y propuesta' },
];

export type PipelineEvent =
  | { type: 'step'; step: StepId; status: StepStatus; label: string; progress: number }
  | { type: 'log'; message: string; progress: number }
  | { type: 'screenshot'; screenshot: Screenshot; url: string }
  | { type: 'done'; reportId: string; progress: 100 }
  | { type: 'error'; message: string };
