/**
 * Perfiles por rubro: ajustan umbrales y qué servicios tienen sentido.
 * Para añadir un rubro basta con agregar una entrada (el primero que coincide gana).
 */
export interface Vertical {
  id: string;
  label: string;
  match: RegExp;
  /** El negocio vive de citas/reservas (peluquería, clínica, restaurante…). */
  bookingRelevant: boolean;
  /** Volumen típico de consultas por WhatsApp (1 bajo – 3 alto). */
  whatsappIntensity: 1 | 2 | 3;
  /** Tiene sentido una carta/menú online. */
  menuRelevant: boolean;
  /** Reseñas que un negocio sano del rubro debería sumar al mes. */
  healthyMonthlyReviews: number;
  /** Fotos mínimas recomendadas en la ficha. */
  recommendedPhotos: number;
}

export const VERTICALS: Vertical[] = [
  { id: 'gastronomia', label: 'Gastronomía', match: /restaurante|restaurant|bar\b|cafeter|café|cafe\b|pizzer|parrilla|asador|hamburgues|sushi|taquer|bistr|tapas|cervecer|helader|panader|pasteler|comida|food|brunch|marisquer|steak/i, bookingRelevant: true, whatsappIntensity: 3, menuRelevant: true, healthyMonthlyReviews: 15, recommendedPhotos: 60 },
  { id: 'salud', label: 'Salud', match: /dentist|odont|clínica|clinica|clinic|médic|medic|doctor|fisioterap|kinesi|psic[oó]log|nutricion|pediatr|ginec|dermat|oftalm|veterinar|podolog|osteop|centro de salud|laboratorio/i, bookingRelevant: true, whatsappIntensity: 3, menuRelevant: false, healthyMonthlyReviews: 6, recommendedPhotos: 25 },
  { id: 'belleza', label: 'Belleza y bienestar', match: /peluquer|barber|estétic|estetic|beauty|salón de belleza|salon|spa\b|masaj|uñas|manicur|nail|depilaci|cosmet|maquill|tatuaj|tattoo|pestañas/i, bookingRelevant: true, whatsappIntensity: 3, menuRelevant: false, healthyMonthlyReviews: 8, recommendedPhotos: 40 },
  { id: 'fitness', label: 'Deporte y fitness', match: /gimnasio|gym|fitness|crossfit|yoga|pilates|box\b|artes marciales|entrenador|personal trainer|club deportivo|pádel|padel/i, bookingRelevant: true, whatsappIntensity: 2, menuRelevant: false, healthyMonthlyReviews: 6, recommendedPhotos: 30 },
  { id: 'alojamiento', label: 'Alojamiento', match: /hotel|hostal|hostel|apartamento|alojamiento|posada|cabaña|camping|bed and breakfast|apart/i, bookingRelevant: true, whatsappIntensity: 2, menuRelevant: false, healthyMonthlyReviews: 12, recommendedPhotos: 60 },
  { id: 'automotor', label: 'Automotor', match: /taller|mecánic|mecanic|lubricentro|neumátic|gomería|concesionar|autos|car wash|lavadero|chapa y pintura|auto repair/i, bookingRelevant: true, whatsappIntensity: 2, menuRelevant: false, healthyMonthlyReviews: 4, recommendedPhotos: 20 },
  { id: 'profesional', label: 'Servicios profesionales', match: /abogad|asesor|gestor|contador|contable|notar|inmobiliar|arquitect|consultor|seguros|agencia|marketing|escribanía|despacho/i, bookingRelevant: true, whatsappIntensity: 2, menuRelevant: false, healthyMonthlyReviews: 3, recommendedPhotos: 15 },
  { id: 'educacion', label: 'Educación', match: /academia|escuela|colegio|instituto|clases|idiomas|autoescuela|guardería|jardín de infantes|tutor/i, bookingRelevant: false, whatsappIntensity: 3, menuRelevant: false, healthyMonthlyReviews: 4, recommendedPhotos: 25 },
  { id: 'hogar', label: 'Servicios para el hogar', match: /fontaner|plomer|electricist|cerrajer|pintor|reformas|limpieza|mudanza|climatizaci|aire acondicionado|jardiner|carpinter|construcci/i, bookingRelevant: false, whatsappIntensity: 3, menuRelevant: false, healthyMonthlyReviews: 3, recommendedPhotos: 20 },
  { id: 'comercio', label: 'Comercio', match: /tienda|store|shop|boutique|librer|ferreter|óptica|optica|farmacia|supermercado|almacén|kiosco|joyer|florister|zapater|ropa|muebler|electr[oó]nica|regal/i, bookingRelevant: false, whatsappIntensity: 2, menuRelevant: false, healthyMonthlyReviews: 5, recommendedPhotos: 30 },
];

export const DEFAULT_VERTICAL: Vertical = {
  id: 'general', label: 'Negocio local', match: /.*/, bookingRelevant: false, whatsappIntensity: 2,
  menuRelevant: false, healthyMonthlyReviews: 4, recommendedPhotos: 25,
};

export function detectVertical(category: string | undefined, name?: string): Vertical {
  const text = `${category ?? ''} ${name ?? ''}`;
  return VERTICALS.find((v) => v.match.test(category ?? '')) ?? VERTICALS.find((v) => v.match.test(text)) ?? DEFAULT_VERTICAL;
}

/** Categorías demasiado genéricas: indican que la categoría principal no está optimizada. */
export const GENERIC_CATEGORIES = /^(empresa|negocio|tienda|comercio|servicio|servicios|establecimiento|local|oficina|company|business|store|shop|corporate office|oficinas de empresa|proveedor|punto de interés|point of interest)$/i;
