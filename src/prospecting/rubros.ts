import { DEFAULT_CATALOG, norm, rubroKeyFor, stems, type RubroCatalog } from '../rubros/catalog.js';

/**
 * RUBROS DE LA BÚSQUEDA y su filtro (usa el catálogo de rubros: src/rubros/catalog.ts).
 *
 * Google Maps mezcla resultados ("barberías en Quilmes" también trae peluquerías o spas). Para que
 * cada búsqueda traiga SOLO su rubro, cada negocio se acepta únicamente si su categoría de Google
 * (o, si falta, su nombre) corresponde al rubro elegido. Un rubro que no está en el catálogo se
 * compara por sus propias palabras.
 */

export { norm };

/** Rubro del catálogo a partir de lo que eligió el usuario ("Barberías", "barberia", "barberias"). */
export function findRubro(input: string, catalog: RubroCatalog = DEFAULT_CATALOG): { id: string; label: string } | undefined {
  const r = catalog.resolve(input);
  return r ? { id: r.key, label: r.label } : undefined;
}

/**
 * ¿El negocio pertenece al rubro pedido? Se mira primero la categoría de Google; si no se pudo leer,
 * el nombre. Sin coincidencia, no se acepta (nunca mezclar rubros).
 */
export function matchesRubro(rubro: string, business: { category?: string | null; name?: string | null; additionalCategories?: string[] }, catalog: RubroCatalog = DEFAULT_CATALOG): boolean {
  const known = catalog.resolve(rubro);
  const cat = norm([business.category ?? '', ...(business.additionalCategories ?? [])].join(' | '));
  const name = norm(business.name ?? '');
  if (known) return known.match.test(cat) || (!!name && known.match.test(name));
  const tokens = stems(rubro);
  if (!tokens.length) return true;
  return tokens.some((t) => cat.includes(t) || name.includes(t));
}

/** Clave estable para campañas y filtros ("Barberías" → "barberias"). */
export const rubroKey = (rubro: string, catalog: RubroCatalog = DEFAULT_CATALOG) => catalog.resolve(rubro)?.key ?? rubroKeyFor(rubro);
export const zonaKey = (zona: string) => norm(zona).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Nombre visible del rubro ("barberias" → "Barberías"). */
export const rubroLabel = (rubro: string, catalog: RubroCatalog = DEFAULT_CATALOG) => catalog.resolve(rubro)?.label ?? rubro.trim().replace(/^./, (c) => c.toUpperCase());
