import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildAnalysis } from '../src/analyzer.js';
import { openDatabase, SCHEMA_VERSION } from '../src/db/database.js';
import type { BusinessProfile } from '../src/domain/types.js';
import { importLegacyReports } from '../src/crm/legacyImport.js';
import { CrmRepository, dedupeKey } from '../src/crm/repository.js';
import { dashboard, metrics } from '../src/crm/stats.js';
import type { PriceList } from '../src/proposal/budget.js';

const basePrices: PriceList = {
  moneda: 'ARS',
  mesesContrato: 12,
  servicios: {
    'maps-optimization': { pagoInicial: 100000, mensual: 10000 },
    'qr-reviews': { pagoInicial: 50000, mensual: 5000 },
    website: { pagoInicial: 300000, mensual: 20000 },
    'whatsapp-ai-bot': { pagoInicial: 200000, mensual: 30000 },
    'support-automation': { pagoInicial: 100000, mensual: 10000 },
    'booking-system': { pagoInicial: 100000, mensual: 10000 },
    'admin-dashboard': { pagoInicial: 100000, mensual: 10000 },
  },
};

function profile(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    sourceUrl: 'https://maps.app.goo.gl/x', name: 'Parrilla Don Tito', category: 'Restaurante', additionalCategories: [],
    rating: 4.1, reviewCount: 35, address: 'Av. Corrientes 1234, CABA', phone: '+54 11 5555-1234', services: [],
    hasBooking: false, hasMenu: false, photoCount: 12, photoCountIsEstimate: false, photoUrls: [], posts: [],
    reviews: [{ rating: 2, ageDays: 80, hasOwnerResponse: false }, { rating: 5, ageDays: 90, hasOwnerResponse: false }, { rating: 4, ageDays: 120, hasOwnerResponse: false }],
    permanentlyClosed: false, socialLinks: [], scrapedAt: new Date().toISOString(), warnings: [], ...over,
  };
}

function setup(prices: () => PriceList = () => basePrices) {
  return new CrmRepository(openDatabase(':memory:'), prices);
}
const analysis = (over: Partial<BusinessProfile> = {}, analyzedAt?: string) =>
  buildAnalysis('https://maps.app.goo.gl/x', profile(over), undefined, { durationMs: 1234, analyzedAt });

test('guarda el análisis completo con historial y auditoría', () => {
  const repo = setup();
  const { id, created } = repo.saveAnalysis(analysis());
  assert.ok(created);
  const p = repo.get(id);
  assert.equal(p.name, 'Parrilla Don Tito');
  assert.equal(p.verticalId, 'gastronomia');
  assert.equal(p.status, 'sin_contactar');
  assert.equal(p.phone, '+54 11 5555-1234');
  assert.ok(p.score > 0 && p.score < 100);
  assert.ok(p.problems.length > 3 && p.problems.length === p.problemsCount);
  assert.ok(p.services.length > 0);
  assert.equal(p.budget.currency, 'ARS');
  assert.equal(p.potentialValue, p.budget.potentialValue);
  assert.ok(p.potentialValue > 0);
  assert.equal(p.audits.length, 1);
  assert.equal(p.activities[0]?.type, 'creado');
  assert.equal(p.analysis.profile.name, 'Parrilla Don Tito');
});

test('reanalizar el mismo negocio actualiza sin duplicar y conserva estado y notas', () => {
  const repo = setup();
  const { id } = repo.saveAnalysis(analysis());
  repo.update(id, { status: 'contactado', notes: 'Hablar con el dueño' });
  const again = repo.saveAnalysis(analysis({ reviewCount: 300, rating: 4.7 }));
  assert.equal(again.id, id);
  assert.equal(again.created, false);
  assert.equal(repo.list().length, 1);
  const p = repo.get(id);
  assert.equal(p.status, 'contactado');
  assert.equal(p.notes, 'Hablar con el dueño');
  assert.equal(p.reviewCount, 300);
  assert.equal(p.audits.length, 2);
  assert.equal(p.activities[0]?.type, 'reanalisis');
  assert.equal(dedupeKey('Parrilla  Don Tító', 'Av. Corrientes 1234, CABA'), dedupeKey('parrilla don tito', 'AV CORRIENTES 1234 CABA'));
});

test('estados: historial, etapa máxima, perdido conserva la etapa y cliente fija el valor cerrado', () => {
  const repo = setup();
  const { id } = repo.saveAnalysis(analysis());
  repo.update(id, { status: 'reunion' });
  let p = repo.update(id, { status: 'perdido' });
  assert.equal(p.maxStage, 3);
  const change = p.activities.find((a) => a.type === 'estado' && a.toStatus === 'perdido');
  assert.equal(change?.fromStatus, 'reunion');
  p = repo.update(id, { status: 'cliente' });
  assert.equal(p.closedValue, p.potentialValue);
  p = repo.update(id, { closedValue: 999999 });
  assert.equal(p.closedValue, 999999);
  assert.throws(() => repo.update(id, { status: 'inventado' as never }), /Estado inválido/);
  assert.throws(() => repo.update('no-existe', { status: 'cliente' }), /no encontrado/);
});

test('notas: el guardado continuo genera una sola entrada en el historial', () => {
  const repo = setup();
  const { id } = repo.saveAnalysis(analysis());
  repo.update(id, { notes: 'a' });
  repo.update(id, { notes: 'ab' });
  const p = repo.update(id, { notes: 'abc' });
  assert.equal(p.notes, 'abc');
  assert.equal(p.activities.filter((a) => a.type === 'notas').length, 1);
});

test('actividades manuales con validación', () => {
  const repo = setup();
  const { id } = repo.saveAnalysis(analysis());
  const a = repo.addActivity(id, 'llamada', 'Llamé, atiende a la tarde');
  assert.equal(a.label, 'Llamada');
  assert.throws(() => repo.addActivity(id, 'creado', 'x'), /inválido/);
  assert.throws(() => repo.addActivity(id, 'nota', '   '), /detalle/);
});

test('listado: búsqueda, filtros y orden', () => {
  const repo = setup();
  repo.saveAnalysis(analysis());
  const b = repo.saveAnalysis(analysis({ name: 'Peluquería Lola', category: 'Peluquería', address: 'Calle 2', reviewCount: 400, rating: 4.8 }));
  repo.update(b.id, { status: 'respondio' });
  assert.equal(repo.list({ q: 'lola' }).length, 1);
  assert.equal(repo.list({ status: 'respondio' })[0]?.name, 'Peluquería Lola');
  assert.equal(repo.list({ vertical: 'gastronomia' }).length, 1);
  assert.equal(repo.list({ status: 'abiertos' }).length, 2);
  const byScore = repo.list({ sort: 'score', dir: 'asc' });
  assert.ok(byScore[0]!.score <= byScore[1]!.score);
  assert.equal(repo.list({ sort: 'name', dir: 'asc' })[0]?.name, 'Parrilla Don Tito');
});

test('cambiar precios recalcula el valor potencial de toda la base; precios inválidos no rompen nada', () => {
  let prices: PriceList = basePrices;
  let broken = false;
  const repo = setup(() => {
    if (broken) throw new Error('precios.json no tiene el formato esperado');
    return prices;
  });
  const { id } = repo.saveAnalysis(analysis());
  const before = repo.get(id).potentialValue;
  prices = { ...basePrices, mesesContrato: 24 };
  const after = repo.get(id);
  assert.ok(after.potentialValue > before, `${after.potentialValue} > ${before}`);
  assert.equal(after.budget.recommended.contractMonths, 24);
  broken = true;
  assert.equal(repo.get(id).potentialValue, after.potentialValue);
  assert.match(repo.priceError ?? '', /formato/);
});

test('dashboard y métricas: KPIs, embudo y series', () => {
  const repo = setup();
  const ids = ['A', 'B', 'C', 'D'].map((n, i) => repo.saveAnalysis(analysis({ name: `Negocio ${n}`, address: `Calle ${i}` })).id);
  repo.update(ids[0]!, { status: 'contactado' });
  repo.update(ids[1]!, { status: 'reunion' });
  repo.update(ids[2]!, { status: 'cliente' });
  repo.update(ids[3]!, { status: 'propuesta' });
  repo.update(ids[3]!, { status: 'perdido' });
  const d = dashboard(repo.allForStats(), repo.statusChanges());
  assert.equal(d.kpis.analyzed, 4);
  assert.equal(d.kpis.notContacted, 0);
  assert.equal(d.kpis.contacted, 4);
  assert.equal(d.kpis.responded, 3);
  assert.equal(d.kpis.meetings, 3);
  assert.equal(d.kpis.clients, 1);
  const values = ids.map((id) => repo.get(id).potentialValue);
  assert.equal(d.kpis.potentialValue, values[0]! + values[1]!);
  assert.equal(d.kpis.closedValue, values[2]);
  assert.equal(d.prospectsByMonth.at(-1)?.value, 4);
  assert.equal(d.potentialSeries.at(-1)?.value, values.reduce((a, b) => a + b, 0));
  assert.equal(d.conversionsByMonth.at(-1)?.clients, 1);
  assert.equal(d.byStatus.find((s) => s.id === 'perdido')?.count, 1);

  const m = metrics(repo.allForStats());
  assert.equal(m.totals.prospects, 4);
  assert.equal(m.totals.conversionRate, 25);
  assert.equal(m.byVertical[0]?.label, 'Gastronomía');
  assert.ok(m.services.length > 0 && m.services[0]!.count >= m.services.at(-1)!.count);
  assert.equal(m.scoreDistribution.reduce((a, b) => a + b.count, 0), 4);
  assert.ok(m.areaScores.length === 4);
});

test('borrar un prospecto elimina su historial y auditorías', () => {
  const repo = setup();
  const { id } = repo.saveAnalysis(analysis());
  repo.delete(id);
  assert.equal(repo.list().length, 0);
  assert.equal(repo.audits().length, 0);
  assert.throws(() => repo.get(id), /no encontrado/);
});

test('base en archivo: persiste entre aperturas y guarda la versión del esquema', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'crm-'));
  try {
    const file = path.join(dir, 'p.db');
    const a = new CrmRepository(openDatabase(file), () => basePrices);
    const { id } = a.saveAnalysis(analysis());
    a.update(id, { notes: 'persistente' });
    const db2 = openDatabase(file);
    const b = new CrmRepository(db2, () => basePrices);
    assert.equal(b.get(id).notes, 'persistente');
    assert.equal(Number((db2.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), SCHEMA_VERSION);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('importa informes de la primera versión una sola vez', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
  try {
    const rep = path.join(dir, 'reports', '20260101-abcd1234');
    mkdirSync(rep, { recursive: true });
    writeFileSync(path.join(rep, 'report.json'), JSON.stringify({ id: '20260101-abcd1234', createdAt: '2026-01-01T10:00:00.000Z', input: { url: 'https://maps.app.goo.gl/old' }, profile: profile({ name: 'Viejo Bar' }) }));
    mkdirSync(path.join(dir, 'reports', 'roto'), { recursive: true });
    writeFileSync(path.join(dir, 'reports', 'roto', 'report.json'), '{mal');
    const repo = setup();
    const first = importLegacyReports(repo, dir);
    assert.equal(first.imported, 1);
    assert.equal(first.errors.length, 1);
    const second = importLegacyReports(repo, dir);
    assert.equal(second.imported, 0);
    assert.equal(second.skipped, 1);
    const p = repo.list()[0]!;
    assert.equal(p.name, 'Viejo Bar');
    assert.equal(p.createdAt, '2026-01-01T10:00:00.000Z');
    assert.equal(repo.get(p.id).activities[0]?.type, 'importado');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
