import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config/index.js';
import type { Budget, BudgetItem, BudgetOption, ServiceRecommendation } from '../domain/types.js';
import { catalogMap, CUSTOM_ID, isActiveService, serviceName, type CatalogService } from './catalog.js';

/** Precio (y datos editables) de un servicio en precios.json. */
export interface PriceEntry {
  pagoInicial: number;
  mensual: number;
  /** Nombre a mostrar (obligatorio en servicios propios; opcional para renombrar los de la herramienta). */
  nombre?: string;
  descripcion?: string;
  /** false = servicio quitado (no se recomienda ni se presupuesta). */
  activo?: boolean;
}

/** Formato de precios.json (en la raíz del proyecto, editable desde Configuración o a mano). */
export interface PriceList {
  moneda: string;
  nota?: string;
  /** Servicios de la herramienta (por id) y servicios propios ("custom-…"). */
  servicios: Record<string, PriceEntry | undefined>;
  descuentoPaquete?: { minimoServicios: number; porcentaje: number };
  /**
   * OBSOLETO: ya no se usa. La duración de lo que paga un cliente no se conoce de antemano,
   * así que los presupuestos muestran pago inicial + abono mensual, sin "total N meses".
   */
  mesesContrato?: number;
}

/** Presupuesto armado a mano para un prospecto (reemplaza al plan recomendado automático). */
export interface BudgetOverride {
  items: Array<{ id: string; name?: string; setup: number; monthly: number }>;
  discountPct: number;
}

/** Lee precios.json en cada análisis: los cambios se aplican sin reiniciar. */
export function loadPriceList(file = path.join(ROOT_DIR, 'precios.json')): PriceList {
  const data = JSON.parse(readFileSync(file, 'utf8')) as PriceList;
  if (!data || typeof data.moneda !== 'string' || typeof data.servicios !== 'object') {
    throw new Error('precios.json no tiene el formato esperado (moneda y servicios).');
  }
  return data;
}

const PRICES_FILE = () => path.join(ROOT_DIR, 'precios.json');

/**
 * Valida una lista de precios editada desde Configuración. Devuelve una copia limpia
 * (solo campos conocidos, números enteros) o lanza un Error con un mensaje legible.
 */
export function validatePriceList(input: unknown, knownServices: readonly string[]): PriceList {
  if (!input || typeof input !== 'object') throw new Error('Faltan los precios.');
  const raw = input as Record<string, unknown>;
  const int = (v: unknown, what: string, min: number, max: number): number => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error(`${what}: ingresá un número entre ${min} y ${max.toLocaleString('es-AR')}.`);
    return Math.round(n);
  };
  const text = (v: unknown, what: string, max: number, required = false): string | undefined => {
    const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
    if (required && !t) throw new Error(`${what}: no puede quedar vacío.`);
    if (t.length > max) throw new Error(`${what}: máximo ${max} caracteres.`);
    return t || undefined;
  };
  const moneda = typeof raw.moneda === 'string' ? raw.moneda.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(moneda)) throw new Error('Moneda: usá un código de 3 letras (ej.: ARS, USD).');
  const servicios: PriceList['servicios'] = {};
  const inServices = (raw.servicios ?? {}) as Record<string, unknown>;
  if (typeof inServices !== 'object') throw new Error('Faltan los precios de los servicios.');
  const names = new Set<string>();
  for (const [id, value] of Object.entries(inServices)) {
    const custom = CUSTOM_ID.test(id);
    if (!custom && !knownServices.includes(id)) throw new Error(`Servicio desconocido: ${id}.`);
    if (value === null || value === undefined) continue; // sin precio: no se presupuesta
    const v = value as Record<string, unknown>;
    const label = typeof v.nombre === 'string' && v.nombre.trim() ? v.nombre.trim() : id;
    const entry: PriceEntry = {
      pagoInicial: int(v.pagoInicial ?? 0, `Pago inicial de "${label}"`, 0, 1_000_000_000),
      mensual: int(v.mensual ?? 0, `Abono mensual de "${label}"`, 0, 1_000_000_000),
    };
    const nombre = text(v.nombre, 'Nombre del servicio', 60, custom);
    if (nombre) {
      const key = nombre.toLowerCase();
      if (names.has(key)) throw new Error(`Hay dos servicios llamados "${nombre}".`);
      names.add(key);
      entry.nombre = nombre;
    }
    const descripcion = text(v.descripcion, `Descripción de "${label}"`, 200);
    if (descripcion) entry.descripcion = descripcion;
    if (v.activo === false) entry.activo = false;
    servicios[id] = entry;
  }
  if (!Object.values(servicios).some((e) => e && e.activo !== false)) throw new Error('Tiene que quedar al menos un servicio activo con precio.');
  const out: PriceList = { moneda, servicios };
  if (typeof raw.nota === 'string' && raw.nota.trim()) out.nota = raw.nota.trim().slice(0, 500);
  const pack = raw.descuentoPaquete as Record<string, unknown> | null | undefined;
  if (pack) {
    const porcentaje = int(pack.porcentaje ?? 0, 'Descuento (%)', 0, 90);
    if (porcentaje > 0) out.descuentoPaquete = { minimoServicios: int(pack.minimoServicios, 'Mínimo de servicios para el descuento', 1, 20), porcentaje };
  }
  return out;
}

/** Valida un presupuesto personalizado contra el catálogo activo. */
export function validateBudgetOverride(input: unknown, prices: PriceList | undefined): BudgetOverride {
  if (!input || typeof input !== 'object') throw new Error('Faltan los servicios del presupuesto.');
  const raw = input as { items?: unknown; discountPct?: unknown };
  if (!Array.isArray(raw.items) || !raw.items.length) throw new Error('Elegí al menos un servicio.');
  if (raw.items.length > 30) throw new Error('Demasiados servicios.');
  const catalog = catalogMap(prices);
  const num = (v: unknown, what: string, max: number) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) throw new Error(`${what}: ingresá un número entre 0 y ${max.toLocaleString('es-AR')}.`);
    return Math.round(n);
  };
  const seen = new Set<string>();
  const items = raw.items.map((it) => {
    const i = (it ?? {}) as Record<string, unknown>;
    const id = String(i.id ?? '');
    const svc = catalog.get(id);
    if (!svc || !svc.active) throw new Error(`El servicio "${id}" no existe o fue quitado del catálogo.`);
    if (seen.has(id)) throw new Error(`"${svc.name}" está repetido.`);
    seen.add(id);
    return { id, name: svc.name, setup: num(i.setup, `Pago inicial de "${svc.name}"`, 1_000_000_000), monthly: num(i.monthly, `Abono mensual de "${svc.name}"`, 1_000_000_000) };
  });
  return { items, discountPct: num(raw.discountPct ?? 0, 'Descuento (%)', 90) };
}

/** Guarda precios.json de forma atómica (archivo temporal + renombrar): nunca queda a medio escribir. */
export function writePriceList(prices: PriceList, file = PRICES_FILE()): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(prices, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

function totals(label: string, description: string, items: BudgetItem[], discountPct: number): BudgetOption {
  const setup = items.reduce((sum, i) => sum + i.setup, 0);
  const monthly = items.reduce((sum, i) => sum + i.monthly, 0);
  const setupAfterDiscount = Math.round(setup * (1 - discountPct / 100));
  // Sin "meses de contrato": el valor del plan es el pago inicial (el abono se muestra aparte, por mes).
  return { label, description, items, setup, monthly, discountPct, setupAfterDiscount, contractMonths: 0, total: setupAfterDiscount };
}

function option(label: string, description: string, services: ServiceRecommendation[], prices: PriceList, catalog: Map<string, CatalogService>): BudgetOption {
  const items: BudgetItem[] = services.map((s) => ({
    id: s.id,
    name: serviceName(catalog, s.id, s.name),
    priority: s.priority,
    setup: Number(prices.servicios[s.id]!.pagoInicial) || 0,
    monthly: Number(prices.servicios[s.id]!.mensual) || 0,
  }));
  const pack = prices.descuentoPaquete;
  const discountPct = pack && items.length >= pack.minimoServicios ? pack.porcentaje : 0;
  return totals(label, description, items, discountPct);
}

/** Máximo de servicios del plan recomendado: una oferta de entrada concreta y fácil de aceptar. */
const RECOMMENDED_MAX = 3;

/**
 * @param services servicios recomendados, ordenados de mayor a menor encaje (como los devuelve el motor de propuesta).
 * @param override presupuesto armado a mano para este prospecto (reemplaza al plan recomendado).
 */
export function buildBudget(services: ServiceRecommendation[], prices: PriceList = loadPriceList(), override?: BudgetOverride | null): Budget {
  const catalog = catalogMap(prices);
  // Solo servicios activos y con precio cargado.
  const priced = services.filter((s) => isActiveService(catalog, s.id) && prices.servicios[s.id]);
  const high = priced.filter((s) => s.priority === 'alta');
  const highAndMedium = priced.filter((s) => s.priority !== 'baja');
  const auto = option(
    'Plan recomendado',
    'Los servicios que resuelven los problemas de mayor impacto.',
    (high.length ? high : highAndMedium).slice(0, RECOMMENDED_MAX),
    prices,
    catalog,
  );
  const recommended = override?.items.length
    ? totals('Presupuesto personalizado', 'Armado a mano para este cliente.', override.items.map((i) => ({
        id: i.id, name: serviceName(catalog, i.id, i.name), priority: 'alta' as const, setup: i.setup, monthly: i.monthly,
      })), override.discountPct)
    : auto;
  const complete = option('Plan completo', 'Todos los servicios de prioridad alta y media.', highAndMedium, prices, catalog);
  return {
    currency: prices.moneda,
    note: prices.nota ?? '',
    recommended,
    complete,
    potentialValue: recommended.setupAfterDiscount,
    projectTotal: complete.setupAfterDiscount,
    ...(override?.items.length ? { custom: true } : {}),
  };
}
