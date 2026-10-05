import type { PriceList } from './budget.js';
import { SERVICE_CATALOG } from './services.js';

/**
 * CATÁLOGO DE SERVICIOS EFECTIVO: los servicios de la herramienta (con nombre, descripción y
 * precio editables, o quitados) más los servicios propios agregados desde Configuración.
 * Todo se guarda en precios.json.
 */
export interface CatalogService {
  id: string;
  name: string;
  description: string;
  /** Servicio de la herramienta (el análisis lo puede recomendar) o propio (se agrega a mano). */
  builtIn: boolean;
  /** false = quitado: no se recomienda, no se presupuesta y no se menciona en los mensajes. */
  active: boolean;
  /** Precio (undefined = sin precio cargado: no entra en los presupuestos automáticos). */
  setup?: number;
  monthly?: number;
}

/** Ids de servicios propios: "custom-" + texto en minúsculas. */
export const CUSTOM_ID = /^custom-[a-z0-9-]{1,40}$/;

export function catalogFrom(prices: PriceList | undefined): CatalogService[] {
  const entries = prices?.servicios ?? {};
  const builtIns = Object.values(SERVICE_CATALOG).map((def) => {
    const p = entries[def.id];
    return {
      id: def.id,
      name: p?.nombre?.trim() || def.name,
      description: p?.descripcion?.trim() || def.pitch,
      builtIn: true,
      active: p?.activo !== false,
      setup: p ? Number(p.pagoInicial) || 0 : undefined,
      monthly: p ? Number(p.mensual) || 0 : undefined,
    };
  });
  const custom = Object.entries(entries)
    .filter(([id, p]) => CUSTOM_ID.test(id) && p)
    .map(([id, p]) => ({
      id,
      name: p!.nombre?.trim() || id,
      description: p!.descripcion?.trim() ?? '',
      builtIn: false,
      active: p!.activo !== false,
      setup: Number(p!.pagoInicial) || 0,
      monthly: Number(p!.mensual) || 0,
    }));
  return [...builtIns, ...custom];
}

/** Catálogo indexado por id. */
export function catalogMap(prices: PriceList | undefined): Map<string, CatalogService> {
  return new Map(catalogFrom(prices).map((s) => [s.id, s]));
}

/** Nombre a mostrar de un servicio (con el nombre editado, si lo hay). */
export function serviceName(catalog: Map<string, CatalogService>, id: string, fallback?: string): string {
  return catalog.get(id)?.name ?? fallback ?? id;
}

export function isActiveService(catalog: Map<string, CatalogService>, id: string): boolean {
  const s = catalog.get(id);
  return s ? s.active : true;
}
