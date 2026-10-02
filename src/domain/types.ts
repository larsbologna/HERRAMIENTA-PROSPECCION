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
}

export interface ImprovementPotential {
  currentScore: number;
  projectedScore: number;
  /** Etiqueta cualitativa: "Muy alto", "Alto", "Medio", "Bajo". */
  level: string;
  explanation: string;
}

export interface Proposal {
  services: ServiceRecommendation[];
  potential: ImprovementPotential;
  whatsappMessage: string;
  /** Enlace wa.me listo para abrir (si se conoce el teléfono). */
  whatsappLink?: string;
}

export interface AuditReport {
  id: string;
  createdAt: string;
  input: { url: string };
  profile: BusinessProfile;
  website?: WebsiteAnalysis;
  audit: AuditResult;
  proposal: Proposal;
  executiveSummary: string;
  screenshots: Screenshot[];
  /** Aportes de agentes IA (locales o de la FÁBRICA) ejecutados en el pipeline. */
  agentContributions: AgentContributionRecord[];
  version: number;
}

export interface AgentContributionRecord {
  agentId: string;
  agentName: string;
  ok: boolean;
  error?: string;
  notes?: string;
  durationMs: number;
}
