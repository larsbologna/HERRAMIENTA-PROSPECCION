/**
 * RUBROS DE PROSPECCIÓN y su filtro.
 *
 * Google Maps mezcla resultados ("barberías en Quilmes" también trae peluquerías o spas). Para que
 * cada campaña reciba SOLO su rubro, cada negocio se acepta únicamente si su categoría de Google
 * (o, si falta, su nombre) corresponde al rubro elegido. Un rubro personalizado se compara por sus
 * propias palabras.
 */

export interface Rubro {
  id: string;
  label: string;
  /** Categoría o nombre que identifica al rubro (sin acentos, minúsculas). */
  match: RegExp;
}

export const RUBROS: Rubro[] = [
  { id: 'barberias', label: 'Barberías', match: /barber/ },
  { id: 'peluquerias', label: 'Peluquerías', match: /peluquer|salon de belleza|estilista|hair|coiffure/ },
  { id: 'gimnasios', label: 'Gimnasios', match: /gimnasio|\bgym\b|fitness|crossfit|centro de entrenamiento|entrenamiento funcional|pilates|box de/ },
  { id: 'restaurantes', label: 'Restaurantes', match: /restaurant|parrilla|pizzer|bodegon|cantina|\bresto\b|sushi|hamburgues|rotiser|bistro|comida|cocina|trattoria|bar de tapas|cerveceria/ },
  { id: 'veterinarias', label: 'Veterinarias', match: /veterinari|clinica veterinaria|pet ?shop|veterinario/ },
  { id: 'kioscos', label: 'Kioscos', match: /kiosco|quiosco|polirrubro|maxikiosco|drugstore/ },
  { id: 'tiendas', label: 'Tiendas', match: /tienda|\bstore\b|boutique|ropa|indumentaria|zapateria|calzado|regaleria|bazar|jugueteria|libreria|accesorios|\bshop\b|perfumeria|optica|ferreteria|almacen/ },
];

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Rubro conocido a partir de lo que eligió el usuario ("Barberías", "barberia", "barberias"). */
export function findRubro(input: string): Rubro | undefined {
  const k = norm(input).replace(/[^a-z ]/g, '');
  return RUBROS.find((r) => norm(r.label) === k || r.id === k || r.match.test(k));
}

const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'para', 'con']);

/** Palabras del rubro personalizado, en singular aproximado ("talleres mecánicos" → "taller", "mecanic"). */
function customTokens(input: string): string[] {
  return norm(input).replace(/[^a-z ]/g, ' ').split(' ').filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.replace(/(es|s)$/, '').slice(0, Math.max(4, w.length - 2)));
}

/**
 * ¿El negocio pertenece al rubro pedido? Se mira primero la categoría de Google; si no se pudo leer,
 * el nombre. Sin categoría ni coincidencia en el nombre, no se acepta (nunca mezclar rubros).
 */
export function matchesRubro(rubro: string, business: { category?: string | null; name?: string | null; additionalCategories?: string[] }): boolean {
  const known = findRubro(rubro);
  const cat = norm([business.category ?? '', ...(business.additionalCategories ?? [])].join(' | '));
  const name = norm(business.name ?? '');
  if (known) return known.match.test(cat) || (!!name && known.match.test(name));
  const tokens = customTokens(rubro);
  if (!tokens.length) return true;
  return tokens.some((t) => cat.includes(t) || name.includes(t));
}

/** Clave estable para campañas y filtros ("Barberías" → "barberias"). */
export const rubroKey = (rubro: string) => findRubro(rubro)?.id ?? norm(rubro).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const zonaKey = (zona: string) => norm(zona).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Nombre visible del rubro ("barberias" → "Barberías"). */
export const rubroLabel = (rubro: string) => findRubro(rubro)?.label ?? rubro.trim().replace(/^./, (c) => c.toUpperCase());
