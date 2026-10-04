import { readFileSync } from 'node:fs';
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
