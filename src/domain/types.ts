import type { DataBasis, DataField, DataQuality } from './reliability.js';
import type { ChannelReport } from '../channels/crossCheck.js';

/**
 * Nivel de un argumento comercial:
 *  - confirmado: el dato está verificado y ningún otro canal lo contradice → puede ir en el mensaje.
 *  - probable: el dato de Google es real, pero otro canal (p. ej. Instagram) no se pudo revisar y
 *    podría contradecirlo → se muestra para revisar, NUNCA va automáticamente en el mensaje.
 * (Los "no verificados" ni siquiera se afirman: quedan en audit.unverified.)
 */
export type ArgumentLevel = 'confirmado' | 'probable';

/**
 * Modelo de dominio compartido por scraper, auditor, propuesta, informe y agentes.
 * Todo lo que se guarda en el JSON del informe está tipado aquí: es el "contrato"
 * que consumen la interfaz web, la API y la FÁBRICA DE AGENTES IA.
 */

export interface Screenshot {
  id: string;
  label: string;
  /** Ruta relativa dentro de la carpeta del informe (p. ej. "screenshots/maps.png"). */
  file: string;
  source: 'maps' | 'website-desktop' | 'website-mobile' | 'other';
}

export interface OpeningHours {
  /** Día → texto del horario tal como aparece en Maps ("9:00–18:00", "Cerrado"). */
  days: Record<string, string>;
  /** Texto bruto (aria-label) por si el parseo falla. */
  raw?: string;
}

export interface ReviewSample {
  author?: string;
  rating?: number;
  text?: string;
  /** Fecha relativa tal como aparece ("hace 2 semanas"). */
  relativeDate?: string;
  /** Antigüedad aproximada en días calculada a partir de relativeDate. */
  ageDays?: number;
  hasOwnerResponse: boolean;
}

export interface MapsPost {
  text?: string;
  relativeDate?: string;
  ageDays?: number;
}

/** Datos públicos extraídos de la ficha de Google Maps. */
export interface BusinessProfile {
  sourceUrl: string;
  resolvedUrl?: string;
  name?: string;
  category?: string;
  additionalCategories: string[];
  rating?: number;
  reviewCount?: number;
  address?: string;
  phone?: string;
  website?: string;
  plusCode?: string;
  /** Place ID (ChIJ…) si aparece en la página: permite el enlace directo a "escribir reseña". */
  placeId?: string;
  hours?: OpeningHours;
  description?: string;
  /** Atributos / servicios de la pestaña "Información" ("Entrega a domicilio", "Wi-Fi"...). */
  services: string[];
  bookingUrl?: string;
  hasBooking: boolean;
  menuUrl?: string;
  hasMenu: boolean;
  orderUrl?: string;
  /** Número de fotos si Maps lo muestra; si no, cantidad visible contada. */
  photoCount?: number;
  photoCountIsEstimate: boolean;
  photoUrls: string[];
  posts: MapsPost[];
  reviews: ReviewSample[];
  /** Distribución de estrellas (5 → n). */
  ratingHistogram?: Record<string, number>;
  isClaimed?: boolean;
  permanentlyClosed: boolean;
  socialLinks: string[];
  scrapedAt: string;
  /** Avisos del scraper (campos no encontrados, bloqueos, etc.). */
  warnings: string[];
  /** Confiabilidad de cada dato: valor, estado, confianza, fuente y método (ausente en análisis antiguos). */
  dataQuality?: DataQuality;
}

/** Resultado de analizar el sitio web del negocio. */
export interface WebsiteAnalysis {
  url: string;
  finalUrl?: string;
  reachable: boolean;
  httpStatus?: number;
  error?: string;
  https: boolean;
  isSocialOrDirectory: boolean;
  title?: string;
  metaDescription?: string;
  loadTimeMs?: number;
  domContentLoadedMs?: number;
  pageWeightKb?: number;
  requestCount?: number;
  mobile: {
    hasViewportMeta: boolean;
    horizontalOverflow: boolean;
    smallTextRatio?: number;
    tapTargetsTooSmall?: number;
  };
  contact: {
    phoneLinks: string[];
    emailLinks: string[];
    hasContactForm: boolean;
    hasAddress: boolean;
    contactAboveFold: boolean;
  };
  whatsapp: {
    hasLink: boolean;
    links: string[];
    hasFloatingButton: boolean;
  };
  booking: {
    hasOnlineBooking: boolean;
    providers: string[];
  };
  hasChatWidget: boolean;
  chatProviders: string[];
  socialLinks: string[];
  visual: {
    imageCount: number;
    brokenImages: number;
    hasH1: boolean;
    fontFamilies: string[];
    usesModernLayout: boolean;
    copyrightYear?: number;
    legacyTech: string[];
  };
  /** Puntuaciones 0-100 calculadas en el análisis web. */
  scores: {
    visual: number;
    mobile: number;
    speed: number;
    contact: number;
  };
  analyzedAt: string;
}

export type AuditArea = 'maps' | 'website' | 'whatsapp' | 'reputation' | 'qr';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  area: AuditArea;
  severity: Severity;
  title: string;
  detail: string;
  evidence?: string;
  /** Agente o regla que produjo el hallazgo. */
  source: string;
  /** Nivel según la verificación cruzada de canales (sin canales = confirmado, como antes). */
  level?: ArgumentLevel;
  /** Por qué no está confirmado (si es probable). */
  levelNote?: string;
}

export interface Opportunity {
  id: string;
  area: AuditArea;
  title: string;
  detail: string;
  source: string;
}

export interface AreaScore {
  area: AuditArea;
  label: string;
  score: number;
  summary: string;
}

export interface QrRecommendation {
  recommended: boolean;
  urgency: 'alta' | 'media' | 'baja';
  reasons: string[];
  /** Reseñas que se podrían captar al mes con QR (estimación orientativa). */
  estimatedMonthlyReviews?: number;
}

export interface AuditResult {
  findings: Finding[];
  opportunities: Opportunity[];
  scores: AreaScore[];
  overallScore: number;
  qr: QrRecommendation;
  /** Métricas derivadas útiles para propuesta e informe. */
  metrics: {
    reviewsLast30Days?: number;
    reviewsLast90Days?: number;
    ownerResponseRate?: number;
    daysSinceLastReview?: number;
    daysSinceLastPost?: number;
  };
  /**
   * Problemas que las reglas habrían marcado pero que NO se afirman porque el dato
   * en el que se basan no está verificado (no encontrado, error o confianza baja).
   */
  unverified?: Array<{ findingId: string; title: string; fields: DataField[] }>;
  /** Problemas descartados porque otro canal muestra que el negocio YA lo tiene (no se recomienda lo que ya tiene). */
  contradicted?: Array<{ findingId: string; title: string; reason: string }>;
}

export type ServiceId =
  | 'maps-optimization'
  | 'qr-reviews'
  | 'website'
  | 'whatsapp-ai-bot'
  | 'admin-dashboard'
  | 'booking-system'
  | 'support-automation';

export type Priority = 'alta' | 'media' | 'baja';

export interface ServiceRecommendation {
  id: ServiceId;
  name: string;
  priority: Priority;
  /** 0-100: cuánto encaja el servicio con este negocio. */
  fitScore: number;
  reasons: string[];
  expectedImpact: string;
  /** Problemas detectados que este servicio resuelve (texto de SalesArgument.problem). */
  solves: string[];
}

export type SalesImpact = 'Bajo' | 'Medio' | 'Medio-Alto' | 'Alto';

/**
 * Argumento comercial derivado de un problema detectado: listo para usar
 * en prospección (qué pasa, cuánto importa, por qué, qué lo resuelve y qué gana el cliente).
 */
export interface SalesArgument {
  findingId: string;
  area: AuditArea;
  /** Problema detectado (en lenguaje de cliente). */
  problem: string;
  impact: SalesImpact;
  /** Cómo afecta al negocio, con los datos concretos de esta ficha. */
  reason: string;
  serviceIds: ServiceId[];
  /** Nombre(s) del servicio que lo resuelve. */
  service: string;
  /** Beneficio concreto que obtiene el cliente al resolverlo. */
  benefit: string;
  /** Dato observado que respalda el argumento (opcional). */
  evidence?: string;
  /** Datos verificados en los que se apoya (valor, confianza, fuente y método). */
  basis?: DataBasis[];
  /** confirmado = puede usarse en el mensaje; probable = solo para revisar. */
  level?: ArgumentLevel;
  levelNote?: string;
}

export interface Proposal {
  /** Un argumento comercial por cada problema detectado, ordenado por impacto. */
  salesArguments: SalesArgument[];
  services: ServiceRecommendation[];
  whatsappMessage: string;
  /** Enlace wa.me listo para abrir (si se conoce el teléfono). */
  whatsappLink?: string;
}

export interface BudgetItem {
  /** Servicio de la herramienta o servicio propio ("custom-…"). */
  id: ServiceId | string;
  name: string;
  priority: Priority;
  /** Pago inicial (implementación). */
  setup: number;
  /** Cuota mensual (mantenimiento / servicio). */
  monthly: number;
}

export interface BudgetOption {
  label: string;
  description: string;
  items: BudgetItem[];
  setup: number;
  monthly: number;
  /** Descuento aplicado al pago inicial por contratar varios servicios (0 si no aplica). */
  discountPct: number;
  setupAfterDiscount: number;
  /** Obsoleto: siempre 0 (ya no se suman meses de contrato). Se conserva por compatibilidad. */
  contractMonths: number;
  /** Valor del plan: el pago inicial con descuento (el abono mensual se informa aparte). */
  total: number;
}

/** Presupuesto sugerido a partir de los servicios recomendados y de precios.json. */
export interface Budget {
  currency: string;
  note: string;
  /** Solo servicios de prioridad alta. */
  recommended: BudgetOption;
  /** Prioridad alta + media. */
  complete: BudgetOption;
  /** Valor potencial del prospecto: pago inicial del plan recomendado (o del personalizado). */
  potentialValue: number;
  /** Pago inicial del plan completo. */
  projectTotal: number;
  /** true si el plan recomendado fue reemplazado por un presupuesto personalizado. */
  custom?: boolean;
}

/** Resultado completo de un análisis (lo que muestra la interfaz). */
export interface AnalysisResult {
  url: string;
  analyzedAt: string;
  durationMs: number;
  profile: BusinessProfile;
  website?: WebsiteAnalysis;
  vertical: { id: string; label: string };
  audit: AuditResult;
  proposal: Proposal;
  budget: Budget;
  /** Verificación cruzada de canales (Maps + web + Instagram). Ausente en análisis anteriores. */
  channels?: ChannelReport;
}
