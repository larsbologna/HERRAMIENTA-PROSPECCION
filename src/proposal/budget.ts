import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config/index.js';
import type { Budget, BudgetItem, BudgetOption, ServiceId, ServiceRecommendation } from '../domain/types.js';

/** Formato de precios.json (en la raíz del proyecto, editable por el usuario). */
export interface PriceList {
  moneda: string;
  nota?: string;
  servicios: Partial<Record<ServiceId, { pagoInicial: number; mensual: number }>>;
  descuentoPaquete?: { minimoServicios: number; porcentaje: number };
  /** Meses de cuota que se suman al valor potencial y al total del proyecto (por defecto 12). */
  mesesContrato?: number;
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
  const moneda = typeof raw.moneda === 'string' ? raw.moneda.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(moneda)) throw new Error('Moneda: usá un código de 3 letras (ej.: ARS, USD).');
  const servicios: PriceList['servicios'] = {};
  const inServices = (raw.servicios ?? {}) as Record<string, unknown>;
  if (typeof inServices !== 'object') throw new Error('Faltan los precios de los servicios.');
  for (const [id, value] of Object.entries(inServices)) {
    if (!knownServices.includes(id)) throw new Error(`Servicio desconocido: ${id}.`);
    if (value === null || value === undefined) continue; // sin precio: no se presupuesta
    const v = value as Record<string, unknown>;
    servicios[id as ServiceId] = {
      pagoInicial: int(v.pagoInicial, 'Pago inicial', 0, 1_000_000_000),
      mensual: int(v.mensual, 'Abono mensual', 0, 1_000_000_000),
    };
  }
  if (!Object.keys(servicios).length) throw new Error('Cargá el precio de al menos un servicio.');
  const out: PriceList = { moneda, servicios, mesesContrato: int(raw.mesesContrato ?? 12, 'Meses de contrato', 0, 60) };
  if (typeof raw.nota === 'string' && raw.nota.trim()) out.nota = raw.nota.trim().slice(0, 500);
  const pack = raw.descuentoPaquete as Record<string, unknown> | null | undefined;
  if (pack) {
    const porcentaje = int(pack.porcentaje, 'Descuento (%)', 0, 90);
    if (porcentaje > 0) out.descuentoPaquete = { minimoServicios: int(pack.minimoServicios, 'Mínimo de servicios para el descuento', 1, 20), porcentaje };
  }
  return out;
}

/** Guarda precios.json de forma atómica (archivo temporal + renombrar): nunca queda a medio escribir. */
export function writePriceList(prices: PriceList, file = PRICES_FILE()): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(prices, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

function option(label: string, description: string, services: ServiceRecommendation[], prices: PriceList): BudgetOption {
  const items: BudgetItem[] = services
    .filter((s) => prices.servicios[s.id])
    .map((s) => ({
      id: s.id,
      name: s.name,
      priority: s.priority,
      setup: Number(prices.servicios[s.id]!.pagoInicial) || 0,
      monthly: Number(prices.servicios[s.id]!.mensual) || 0,
    }));
  const setup = items.reduce((sum, i) => sum + i.setup, 0);
  const monthly = items.reduce((sum, i) => sum + i.monthly, 0);
  const pack = prices.descuentoPaquete;
  const discountPct = pack && items.length >= pack.minimoServicios ? pack.porcentaje : 0;
  const setupAfterDiscount = Math.round(setup * (1 - discountPct / 100));
  const contractMonths = contractMonthsOf(prices);
  return {
    label,
    description,
    items,
    setup,
    monthly,
    discountPct,
    setupAfterDiscount,
    contractMonths,
    total: setupAfterDiscount + monthly * contractMonths,
  };
}

function contractMonthsOf(prices: PriceList): number {
  const m = Number(prices.mesesContrato);
  return Number.isFinite(m) && m >= 0 ? Math.round(m) : 12;
}

/** Máximo de servicios del plan recomendado: una oferta de entrada concreta y fácil de aceptar. */
const RECOMMENDED_MAX = 3;

/** @param services servicios recomendados, ordenados de mayor a menor encaje (como los devuelve el motor de propuesta). */
export function buildBudget(services: ServiceRecommendation[], prices: PriceList = loadPriceList()): Budget {
  const priced = services.filter((s) => prices.servicios[s.id]);
  const high = priced.filter((s) => s.priority === 'alta');
  const highAndMedium = priced.filter((s) => s.priority !== 'baja');
  const recommended = option(
    'Plan recomendado',
    'Los servicios que resuelven los problemas de mayor impacto.',
    (high.length ? high : highAndMedium).slice(0, RECOMMENDED_MAX),
    prices,
  );
  const complete = option('Plan completo', 'Todos los servicios de prioridad alta y media.', highAndMedium, prices);
  return {
    currency: prices.moneda,
    note: prices.nota ?? '',
    recommended,
    complete,
    potentialValue: recommended.total,
    projectTotal: complete.total,
  };
}
