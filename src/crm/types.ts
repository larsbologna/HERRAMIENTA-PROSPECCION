import type { AnalysisResult, AreaScore, Budget, SalesArgument, ServiceRecommendation } from '../domain/types.js';

/** Estados del pipeline comercial, en orden. `stage` mide hasta dónde avanzó (para el embudo). */
export const STATUSES = [
  { id: 'sin_contactar', label: 'Sin contactar', stage: 0 },
  { id: 'contactado', label: 'Contactado', stage: 1 },
  { id: 'respondio', label: 'Respondió', stage: 2 },
  { id: 'reunion', label: 'Reunión agendada', stage: 3 },
  { id: 'propuesta', label: 'Propuesta enviada', stage: 4 },
  { id: 'cliente', label: 'Cliente', stage: 5 },
  // "Perdido" no avanza el embudo: conserva la etapa máxima alcanzada.
  { id: 'perdido', label: 'Perdido', stage: -1 },
] as const;

export type ProspectStatus = (typeof STATUSES)[number]['id'];

export function isStatus(value: unknown): value is ProspectStatus {
  return STATUSES.some((s) => s.id === value);
}

export function statusLabel(id: string): string {
  return STATUSES.find((s) => s.id === id)?.label ?? id;
}

export function stageOf(id: ProspectStatus): number {
  return STATUSES.find((s) => s.id === id)!.stage;
}

/** Tipos de actividad del historial. Las de MANUAL_ACTIVITY_TYPES las registra el usuario. */
export const ACTIVITY_TYPES = {
  creado: 'Prospecto creado',
  reanalisis: 'Reanálisis',
  estado: 'Cambio de estado',
  notas: 'Notas actualizadas',
  importado: 'Importado',
  nota: 'Nota',
  llamada: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Email',
  reunion: 'Reunión',
  otro: 'Otra actividad',
} as const;

export type ActivityType = keyof typeof ACTIVITY_TYPES;
export const MANUAL_ACTIVITY_TYPES: ActivityType[] = ['nota', 'llamada', 'whatsapp', 'email', 'reunion', 'otro'];

/** Fila resumida para tablas, kanban y listados. */
export interface ProspectSummary {
  id: string;
  name: string;
  category: string | null;
  verticalId: string | null;
  verticalLabel: string | null;
  mapsUrl: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  score: number;
  status: ProspectStatus;
  maxStage: number;
  potentialValue: number;
  projectTotal: number;
  closedValue: number | null;
  problemsCount: number;
  highImpactCount: number;
  analyzedAt: string;
  createdAt: string;
  lastActivityAt: string;
}

export interface Activity {
  id: number;
  type: ActivityType;
  label: string;
  content: string;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  prospectId: string;
  prospectName: string;
  createdAt: string;
  score: number;
  problemsCount: number;
  durationMs: number;
  source: string;
}

export interface ProspectDetail extends ProspectSummary {
  notes: string;
  areaScores: AreaScore[];
  problems: SalesArgument[];
  services: ServiceRecommendation[];
  /** Presupuesto recalculado con los precios actuales. */
  budget: Budget;
  audits: AuditEntry[];
  activities: Activity[];
  /** Último análisis completo (datos de Maps, web, auditoría…). */
  analysis: AnalysisResult;
}

export interface ProspectFilter {
  q?: string;
  status?: string;
  vertical?: string;
  minScore?: number;
  maxScore?: number;
  sort?: 'name' | 'vertical' | 'score' | 'potential' | 'status' | 'lastActivity' | 'analyzedAt';
  dir?: 'asc' | 'desc';
}

export interface ProspectUpdate {
  status?: ProspectStatus;
  notes?: string;
  /** Valor acordado al cerrar. null = usar el valor potencial. */
  closedValue?: number | null;
}

export interface Settings {
  sellerName: string;
  sellerBusiness: string;
  sellerCity: string;
}
