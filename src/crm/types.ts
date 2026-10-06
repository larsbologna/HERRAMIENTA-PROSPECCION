import type { BudgetOverride } from '../proposal/budget.js';
import type { CatalogService } from '../proposal/catalog.js';
import type { AnalysisResult, AreaScore, Budget, SalesArgument, ServiceRecommendation } from '../domain/types.js';

/** Estados del pipeline comercial, en orden. `stage` mide hasta dónde avanzó (para el embudo). */
export const STATUSES = [
  { id: 'sin_contactar', label: 'No contactado', stage: 0 },
  { id: 'contactado', label: 'Contactado', stage: 1 },
  { id: 'sin_respuesta', label: 'Sin respuesta', stage: 1 },
  { id: 'respondio', label: 'Respondió', stage: 2 },
  { id: 'interesado', label: 'Interesado', stage: 2 },
  { id: 'reunion', label: 'Reunión agendada', stage: 3 },
  { id: 'propuesta', label: 'Propuesta enviada', stage: 4 },
  { id: 'cliente', label: 'Cliente', stage: 5 },
  // "Contactar después" y "No interesado" no avanzan el embudo: conservan la etapa máxima alcanzada.
  { id: 'contactar_despues', label: 'Contactar después', stage: -1 },
  { id: 'perdido', label: 'No interesado', stage: -1 },
] as const;

export type ProspectStatus = (typeof STATUSES)[number]['id'];

/** Estados simples para trabajar el día a día (los demás siguen existiendo para datos anteriores). */
export const QUICK_STATUSES: ProspectStatus[] = ['sin_contactar', 'contactado', 'respondio', 'sin_respuesta', 'perdido', 'cliente'];
/** "Respondieron": cualquier estado al que se llega después de una respuesta. */
export const RESPONDED_STATUSES: ProspectStatus[] = ['respondio', 'interesado', 'reunion', 'propuesta'];

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
  creado: 'Análisis realizado · prospecto creado',
  reanalisis: 'Análisis realizado · reanálisis',
  estado: 'Cambio de estado',
  notas: 'Notas actualizadas',
  importado: 'Importado',
  nota: 'Nota',
  llamada: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Email',
  reunion: 'Reunión',
  otro: 'Otra actividad',
  asignacion: 'Asignación',
  seguimiento: 'Seguimiento programado',
  seguimiento_hecho: 'Seguimiento completado',
  seguimiento_cancelado: 'Seguimiento cancelado',
  login: 'Inició sesión',
  logout: 'Cerró sesión',
  usuario: 'Gestión de usuarios',
  presupuesto: 'Presupuesto personalizado',
  configuracion: 'Cambio de configuración',
  generador: 'Generador de prospectos',
  rubro: 'Rubro asignado',
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
  assignedUserId: string | null;
  assignedUserName: string | null;
  /** Próximo seguimiento pendiente (fecha ISO), si hay. */
  nextFollowupAt: string | null;
  /** Campaña de prospección (rubro + zona + mes), si vino de una búsqueda automática. */
  campaignId: string | null;
  campaignLabel: string | null;
  /** Potencial comercial (alto / medio / bajo) y su motivo, calculado con datos verificados. */
  potentialLevel: 'alto' | 'medio' | 'bajo' | null;
  potentialReason: string | null;
  /** Rubro (normalizado) con su fuente y confianza. null = sin rubro (se asigna a mano). */
  rubroKey: string | null;
  rubroLabel: string | null;
  rubroSource: string | null;
  rubroConfidence: string | null;
  /** Principales oportunidades confirmadas para su rubro (para listar sin abrir el análisis). */
  opportunities: Array<{ id: string; title: string; area: string }>;
  /** Contacto directo detectado (WhatsApp confirmado, Instagram, web propia). */
  contact: { whatsappNumber?: string; instagramUrl?: string; websiteUrl?: string };
}

export interface Activity {
  id: number;
  type: ActivityType;
  label: string;
  content: string;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  prospectId: string | null;
  prospectName?: string | null;
}

export type FollowupStatus = 'pendiente' | 'hecho' | 'cancelado';

export interface Followup {
  id: number;
  prospectId: string;
  prospectName?: string;
  userId: string | null;
  userName: string | null;
  dueAt: string;
  note: string;
  status: FollowupStatus;
  createdAt: string;
  completedAt: string | null;
  overdue: boolean;
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
  userName: string | null;
}

export interface ProspectDetail extends ProspectSummary {
  notes: string;
  areaScores: AreaScore[];
  problems: SalesArgument[];
  services: ServiceRecommendation[];
  /** Presupuesto recalculado con los precios actuales. */
  budget: Budget;
  /** Presupuesto armado a mano (null = automático). */
  budgetOverride: BudgetOverride | null;
  /** Servicios activos del catálogo (para armar el presupuesto personalizado). */
  catalog: CatalogService[];
  audits: AuditEntry[];
  activities: Activity[];
  followups: Followup[];
  /** Último análisis completo (datos de Maps, web, auditoría…). */
  analysis: AnalysisResult;
}

export interface ProspectFilter {
  q?: string;
  status?: string;
  vertical?: string;
  minScore?: number;
  maxScore?: number;
  sort?: 'name' | 'vertical' | 'score' | 'potential' | 'status' | 'lastActivity' | 'analyzedAt' | 'nextFollowup' | 'potentialLevel';
  dir?: 'asc' | 'desc';
  /** id de usuario, 'none' (sin asignar) o undefined (todos). */
  assignedTo?: string;
  /** id de campaña o 'none' (prospectos sin campaña). */
  campaignId?: string;
  /** Rubro y zona de la campaña (normalizados). */
  rubro?: string;
  zona?: string;
  potential?: 'alto' | 'medio' | 'bajo';
}

export interface ProspectUpdate {
  status?: ProspectStatus;
  notes?: string;
  /** Valor acordado al cerrar. null = usar el valor potencial. */
  closedValue?: number | null;
  /** Vendedor asignado (null = sin asignar). Solo administradores. */
  assignedUserId?: string | null;
}

export interface Settings {
  sellerName: string;
  sellerBusiness: string;
  sellerCity: string;
  /** Frase de presentación para los mensajes (vacía = texto por defecto). */
  sellerIntro: string;
  /** Web, Instagram o @usuario que se suma al primer mensaje (opcional). */
  sellerLink: string;
  /** Orden de canales para "Contactar" (separados por coma: whatsapp,instagram,telefono,web,maps). */
  contactOrder: string;
}
