/**
 * CONFIABILIDAD DEL DATO
 *
 * Cada dato leído de Google Maps se acompaña de: valor obtenido, estado, confianza, fuente y método.
 * Las reglas de auditoría solo afirman un problema cuando los datos en los que se basa están
 * VERIFICADOS; así los argumentos comerciales nunca se apoyan en un dato que no se pudo leer.
 *
 * Estados:
 *  - encontrado     → el dato se leyó de la página.
 *  - cero           → se comprobó que el valor real es 0 / no existe (p. ej. "Sin reseñas",
 *                     o la ficha cargó completa y no tiene teléfono).
 *  - no_encontrado  → no se pudo leer y no hay prueba de que falte: NO se afirma nada.
 *  - error          → falló la extracción (ficha no cargó, pestaña que no abrió, bloqueo de Google).
 */

export type DataField =
  | 'name'
  | 'category'
  | 'rating'
  | 'reviewCount'
  | 'address'
  | 'phone'
  | 'website'
  | 'hours'
  | 'description'
  | 'photos'
  | 'posts'
  | 'placeId'
  | 'claimed'
  | 'closed'
  | 'menu'
  | 'booking'
  | 'attributes'
  | 'reviewsSample'
  | 'reviewsRecency';

export type DataStatus = 'encontrado' | 'cero' | 'no_encontrado' | 'error';
export type DataConfidence = 'alta' | 'media' | 'baja';

export interface DataPoint {
  field: DataField;
  label: string;
  status: DataStatus;
  /** Valor obtenido, legible ("23 reseñas", "No tiene", "—"). */
  value: string;
  confidence: DataConfidence;
  /** Dónde se leyó (pestaña / zona de la ficha / URL). */
  source: string;
  /** Cómo se leyó (selector, atributo, expresión regular, conteo…). */
  method: string;
  /** Aclaración: por qué esa confianza, límites del dato. */
  note?: string;
}

export interface DataQuality {
  version: 1;
  /** La ficha cargó (se leyó el encabezado con el nombre). */
  pageLoaded: boolean;
  /** Google mostró una verificación anti-robots o una página de consentimiento sin resolver. */
  blocked: boolean;
  /** Se recorrió el panel hasta el final (todas las secciones diferidas llegaron a cargarse). */
  panelFullyLoaded: boolean;
  fields: Record<DataField, DataPoint>;
}

export const FIELD_LABELS: Record<DataField, string> = {
  name: 'Nombre',
  category: 'Categoría',
  rating: 'Calificación',
  reviewCount: 'Cantidad de reseñas',
  address: 'Dirección',
  phone: 'Teléfono',
  website: 'Sitio web',
  hours: 'Horarios',
  description: 'Descripción',
  photos: 'Fotos',
  posts: 'Publicaciones (Novedades)',
  placeId: 'Place ID',
  claimed: 'Ficha reclamada',
  closed: 'Cerrado permanentemente',
  menu: 'Carta / menú',
  booking: 'Botón de reserva',
  attributes: 'Atributos y servicios',
  reviewsSample: 'Muestra de reseñas (respuestas)',
  reviewsRecency: 'Reseñas recientes (fechas)',
};

/** Un dato está verificado si se leyó (o se comprobó que es 0) con confianza alta o media. */
export function isVerifiedPoint(p: DataPoint | undefined): boolean {
  return !!p && (p.status === 'encontrado' || p.status === 'cero') && p.confidence !== 'baja';
}

/**
 * ¿Se puede usar este dato para afirmar algo? Los análisis guardados antes de existir
 * la confiabilidad del dato (sin dataQuality) conservan el comportamiento anterior.
 */
export function isVerified(quality: DataQuality | undefined, field: DataField): boolean {
  if (!quality) return true;
  return isVerifiedPoint(quality.fields[field]);
}

/**
 * Datos en los que se apoya cada problema. Si alguno no está verificado, el problema
 * no se afirma (ni genera argumento comercial): queda listado como "sin verificar".
 */
export const FINDING_BASIS: Record<string, DataField[]> = {
  'maps-unclaimed': ['claimed'],
  'maps-closed': ['closed'],
  'maps-no-category': ['category'],
  'maps-generic-category': ['category'],
  'maps-no-description': ['description'],
  'maps-poor-description': ['description'],
  'maps-no-hours': ['hours'],
  'maps-incomplete-hours': ['hours'],
  'maps-no-phone': ['phone'],
  'maps-no-address': ['address'],
  'maps-few-photos': ['photos'],
  'maps-low-photos': ['photos'],
  'maps-no-posts': ['posts'],
  'maps-stale-posts': ['posts'],
  'maps-few-attributes': ['attributes'],
  'maps-no-menu': ['menu'],
  'rep-very-few-reviews': ['reviewCount'],
  'rep-few-reviews': ['reviewCount'],
  'rep-moderate-reviews': ['reviewCount'],
  'rep-low-rating': ['rating'],
  'rep-medium-rating': ['rating'],
  'rep-no-responses': ['reviewsSample'],
  'rep-low-responses': ['reviewsSample'],
  'rep-negative-unanswered': ['reviewsSample'],
  'rep-stale-reviews': ['reviewsRecency'],
  'rep-low-frequency': ['reviewsRecency'],
  'web-none': ['website'],
  'web-social-only': ['website'],
  'web-down': ['website'],
  'booking-none': ['booking', 'website'],
  'wa-not-visible': ['website'],
  'wa-no-auto-reply': ['website'],
};

/** Referencia breve al dato que respalda un argumento (se guarda junto al argumento). */
export interface DataBasis {
  field: DataField;
  label: string;
  value: string;
  confidence: DataConfidence;
  source: string;
  method: string;
}

export function basisFor(quality: DataQuality | undefined, findingId: string): DataBasis[] | undefined {
  const fields = FINDING_BASIS[findingId];
  if (!quality || !fields) return undefined;
  return fields
    .map((f) => quality.fields[f])
    .filter((p): p is DataPoint => !!p)
    .map((p) => ({ field: p.field, label: p.label, value: p.value, confidence: p.confidence, source: p.source, method: p.method }));
}

const STATUS_TEXT: Record<DataStatus, string> = {
  encontrado: 'Encontrado',
  cero: 'Valor real 0 / no tiene',
  no_encontrado: 'No encontrado',
  error: 'Error de extracción',
};
export const statusText = (s: DataStatus) => STATUS_TEXT[s];

/** Resumen: cuántos datos están verificados y cuáles no. */
export function qualitySummary(quality: DataQuality): { total: number; verified: number; pending: DataPoint[] } {
  const all = Object.values(quality.fields);
  const pending = all.filter((p) => !isVerifiedPoint(p));
  return { total: all.length, verified: all.length - pending.length, pending };
}

/** Tabla de texto para la terminal. */
export function formatDataQualityText(quality: DataQuality, unverified: Array<{ title: string; fields: DataField[] }> = []): string {
  const { total, verified } = qualitySummary(quality);
  const lines = [
    `CONFIABILIDAD DEL DATO · ${verified} de ${total} datos verificados${quality.blocked ? ' · ⚠ GOOGLE BLOQUEÓ LA LECTURA' : ''}${quality.panelFullyLoaded ? '' : ' · ficha no recorrida por completo'}`,
    '='.repeat(60),
  ];
  for (const p of Object.values(quality.fields)) {
    const mark = isVerifiedPoint(p) ? '✔' : '✖';
    lines.push(`${mark} ${p.label}: ${p.value}`);
    lines.push(`    Estado: ${STATUS_TEXT[p.status]} · Confianza: ${p.confidence}`);
    lines.push(`    Fuente: ${p.source} · Método: ${p.method}`);
    if (p.note) lines.push(`    Nota: ${p.note}`);
  }
  if (unverified.length) {
    lines.push('', 'NO SE AFIRMAN (dato sin verificar):');
    for (const u of unverified) lines.push(`  · ${u.title} → falta verificar: ${u.fields.map((f) => FIELD_LABELS[f]).join(', ')}`);
  }
  return lines.join('\n');
}
