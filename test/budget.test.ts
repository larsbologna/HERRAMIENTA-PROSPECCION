import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBudget, loadPriceList, validateBudgetOverride, validatePriceList, type PriceList } from '../src/proposal/budget.js';
import { catalogFrom } from '../src/proposal/catalog.js';
import type { ServiceRecommendation } from '../src/domain/types.js';

const svc = (id: ServiceRecommendation['id'], priority: ServiceRecommendation['priority']): ServiceRecommendation =>
  ({ id, name: id, priority, fitScore: 50, reasons: [], expectedImpact: '', solves: [] });

const prices: PriceList = {
  moneda: 'USD',
  servicios: {
    website: { pagoInicial: 400, mensual: 20 },
    'qr-reviews': { pagoInicial: 100, mensual: 10 },
    'maps-optimization': { pagoInicial: 200, mensual: 50 },
    'whatsapp-ai-bot': { pagoInicial: 300, mensual: 60 },
  },
  descuentoPaquete: { minimoServicios: 3, porcentaje: 10 },
};

test('plan recomendado (prioridad alta) y plan completo (alta + media) con descuento por paquete', () => {
  const b = buildBudget([svc('website', 'alta'), svc('qr-reviews', 'alta'), svc('maps-optimization', 'media'), svc('whatsapp-ai-bot', 'baja')], prices);
  assert.deepEqual(b.recommended.items.map((i) => i.id), ['website', 'qr-reviews']);
  assert.equal(b.recommended.setup, 500);
  assert.equal(b.recommended.monthly, 30);
  assert.equal(b.recommended.discountPct, 0);
  assert.equal(b.recommended.setupAfterDiscount, 500);

  assert.deepEqual(b.complete.items.map((i) => i.id), ['website', 'qr-reviews', 'maps-optimization']);
  assert.equal(b.complete.setup, 700);
  assert.equal(b.complete.discountPct, 10);
  assert.equal(b.complete.setupAfterDiscount, 630);
  assert.equal(b.complete.monthly, 80);
  // Sin meses de contrato: el valor de cada plan es su pago inicial (el abono se informa por mes).
  assert.equal(b.recommended.contractMonths, 0);
  assert.equal(b.recommended.total, 500);
  assert.equal(b.potentialValue, 500);
  assert.equal(b.projectTotal, 630);
});

test('mesesContrato de un precios.json viejo se ignora (no hay "total 12 meses")', () => {
  const b = buildBudget([svc('website', 'alta')], { ...prices, mesesContrato: 12 });
  assert.equal(b.recommended.total, 400);
  assert.equal(b.recommended.contractMonths, 0);
  assert.equal(b.potentialValue, 400);
});

test('servicios propios, quitados y renombrados del catálogo', () => {
  const custom: PriceList = {
    ...prices,
    servicios: {
      ...prices.servicios,
      website: { pagoInicial: 400, mensual: 20, nombre: 'Landing page' },
      'qr-reviews': { pagoInicial: 100, mensual: 10, activo: false },
      'custom-logo': { pagoInicial: 90, mensual: 0, nombre: 'Diseño de logo' },
    },
  };
  const b = buildBudget([svc('website', 'alta'), svc('qr-reviews', 'alta')], custom);
  assert.deepEqual(b.recommended.items.map((i) => [i.id, i.name]), [['website', 'Landing page']], 'el quitado no se presupuesta; el renombrado usa su nombre');
  const cat = catalogFrom(custom);
  assert.ok(cat.find((c) => c.id === 'custom-logo' && !c.builtIn && c.active && c.name === 'Diseño de logo'));
  assert.equal(cat.find((c) => c.id === 'qr-reviews')!.active, false);
});

test('presupuesto personalizado reemplaza al recomendado (servicios propios incluidos)', () => {
  const custom: PriceList = { ...prices, servicios: { ...prices.servicios, 'custom-logo': { pagoInicial: 90, mensual: 0, nombre: 'Diseño de logo' } } };
  const o = validateBudgetOverride({ items: [{ id: 'custom-logo', setup: 80, monthly: 0 }, { id: 'website', setup: 350, monthly: 15 }], discountPct: 10 }, custom);
  const b = buildBudget([svc('website', 'alta')], custom, o);
  assert.equal(b.custom, true);
  assert.equal(b.recommended.label, 'Presupuesto personalizado');
  assert.deepEqual(b.recommended.items.map((i) => i.name), ['Diseño de logo', 'Sitio web profesional']);
  assert.equal(b.recommended.setupAfterDiscount, Math.round(430 * 0.9));
  assert.equal(b.recommended.monthly, 15);
  assert.equal(b.potentialValue, b.recommended.setupAfterDiscount);
  assert.throws(() => validateBudgetOverride({ items: [] }, custom), /al menos un servicio/);
  assert.throws(() => validateBudgetOverride({ items: [{ id: 'no-existe', setup: 1, monthly: 1 }] }, custom), /no existe/);
  assert.throws(() => validateBudgetOverride({ items: [{ id: 'website', setup: -1, monthly: 1 }] }, custom), /Pago inicial/);
});

test('validación del catálogo editado', () => {
  const known = ['website', 'qr-reviews'];
  const ok = validatePriceList({ moneda: 'ars', servicios: { website: { pagoInicial: 1, mensual: 2, activo: false }, 'custom-x': { pagoInicial: 5, mensual: 0, nombre: ' Logo ', descripcion: 'Diseño' } } }, known);
  assert.equal(ok.moneda, 'ARS');
  assert.equal(ok.servicios.website?.activo, false);
  assert.deepEqual(ok.servicios['custom-x'], { pagoInicial: 5, mensual: 0, nombre: 'Logo', descripcion: 'Diseño' });
  assert.equal(ok.mesesContrato, undefined);
  assert.throws(() => validatePriceList({ moneda: 'ARS', servicios: { 'custom-x': { pagoInicial: 5, mensual: 0 } } }, known), /Nombre del servicio/);
  assert.throws(() => validatePriceList({ moneda: 'ARS', servicios: { 'custom-a': { pagoInicial: 1, mensual: 0, nombre: 'Logo' }, 'custom-b': { pagoInicial: 1, mensual: 0, nombre: 'logo' } } }, known), /dos servicios/);
  assert.throws(() => validatePriceList({ moneda: 'ARS', servicios: { website: { pagoInicial: 1, mensual: 0, activo: false } } }, known), /al menos un servicio activo/);
  assert.throws(() => validatePriceList({ moneda: 'ARS', servicios: { hacker: { pagoInicial: 1, mensual: 0 } } }, known), /desconocido/);
});

test('el plan recomendado tiene como máximo 3 servicios; sin prioridad alta usa los de media', () => {
  const many = buildBudget([svc('website', 'alta'), svc('qr-reviews', 'alta'), svc('maps-optimization', 'alta'), svc('whatsapp-ai-bot', 'alta')], prices);
  assert.deepEqual(many.recommended.items.map((i) => i.id), ['website', 'qr-reviews', 'maps-optimization']);
  assert.equal(many.complete.items.length, 4);
  const b = buildBudget([svc('maps-optimization', 'media'), svc('qr-reviews', 'media'), svc('website', 'media'), svc('whatsapp-ai-bot', 'media')], prices);
  assert.deepEqual(b.recommended.items.map((i) => i.id), ['maps-optimization', 'qr-reviews', 'website']);
});

test('servicios sin precio se omiten y precios.json del proyecto es válido', () => {
  const b = buildBudget([svc('booking-system', 'alta')], prices);
  assert.equal(b.recommended.items.length, 0);
  const real = loadPriceList();
  assert.equal(real.moneda, 'ARS');
  for (const id of ['maps-optimization', 'qr-reviews', 'website', 'whatsapp-ai-bot', 'admin-dashboard', 'booking-system', 'support-automation']) {
    assert.ok(real.servicios[id as keyof typeof real.servicios], `precios.json no tiene precio para ${id}`);
  }
});
