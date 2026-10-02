import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBudget, loadPriceList, type PriceList } from '../src/proposal/budget.js';
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
  assert.equal(typeof real.moneda, 'string');
  for (const id of ['maps-optimization', 'qr-reviews', 'website', 'whatsapp-ai-bot', 'admin-dashboard', 'booking-system', 'support-automation']) {
    assert.ok(real.servicios[id as keyof typeof real.servicios], `precios.json no tiene precio para ${id}`);
  }
});
