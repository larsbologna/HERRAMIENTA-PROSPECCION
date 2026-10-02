import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildContext, runAudit } from '../src/auditor/auditor.js';
import type { BusinessProfile } from '../src/domain/types.js';
import { buildProposal } from '../src/proposal/proposalEngine.js';
import { buildSalesArgument, formatSalesArgument, hasTemplate } from '../src/proposal/salesArguments.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function profile(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    sourceUrl: 'https://www.google.com/maps/place/x', name: 'Trattoria Mia', category: 'Restaurante italiano',
    additionalCategories: [], rating: 4.2, reviewCount: 31, address: 'Calle 1', phone: '+34 600 000 000',
    services: [], hasBooking: false, hasMenu: false, photoCount: 6, photoCountIsEstimate: false, photoUrls: [],
    posts: [], reviews: [{ rating: 2, ageDays: 75, hasOwnerResponse: false }, { rating: 5, ageDays: 80, hasOwnerResponse: false }, { rating: 5, ageDays: 95, hasOwnerResponse: false }],
    permanentlyClosed: false, socialLinks: [], scrapedAt: new Date().toISOString(), warnings: [], ...over,
  };
}

test('todo hallazgo que generan las reglas tiene un argumento comercial específico', async () => {
  const dir = path.join(here, '../src/auditor/rules');
  const ids: string[] = [];
  for (const file of await fs.readdir(dir)) {
    const src = await fs.readFile(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/c\.finding\(\{\s*id: '([^']+)'/g)) ids.push(m[1]!);
  }
  assert.ok(ids.length >= 35, `se esperaban muchos hallazgos, hay ${ids.length}`);
  const missing = ids.filter((id) => !hasTemplate(id));
  assert.deepEqual(missing, [], `hallazgos sin argumento comercial: ${missing.join(', ')}`);
});

test('cada problema genera un argumento con datos reales del negocio', () => {
  const ctx = buildContext(profile());
  const audit = runAudit(ctx);
  const proposal = buildProposal(ctx, audit);
  const args = proposal.salesArguments;

  assert.equal(args.length, audit.findings.length, 'un argumento por problema');
  const by = Object.fromEntries(args.map((a) => [a.findingId, a]));

  // Ejemplos del formato pedido
  assert.equal(by['web-none']!.problem, 'No tiene sitio web.');
  assert.equal(by['web-none']!.impact, 'Alto');
  assert.equal(by['web-none']!.service, 'Sitio web profesional');
  assert.match(by['web-none']!.reason, /la carta, los precios/, 'el motivo se adapta al rubro');

  assert.equal(by['rep-few-reviews']!.impact, 'Alto');
  assert.match(by['rep-few-reviews']!.problem, /31/);
  assert.match(by['rep-few-reviews']!.reason, /Trattoria Mia/);
  assert.equal(by['rep-few-reviews']!.service, 'Sistema QR para reseñas y Optimización de Google Maps');

  assert.equal(by['wa-no-auto-reply']!.problem, 'No responde consultas automáticamente.');
  assert.equal(by['wa-no-auto-reply']!.impact, 'Medio-Alto');
  assert.equal(by['wa-no-auto-reply']!.serviceIds[0], 'whatsapp-ai-bot');

  assert.equal(by['booking-none']!.impact, 'Medio');
  assert.equal(by['booking-none']!.service, 'Sistema de reservas');

  // Ordenados por impacto y todos completos
  const rank = { Alto: 0, 'Medio-Alto': 1, Medio: 2, Bajo: 3 };
  for (let i = 1; i < args.length; i++) assert.ok(rank[args[i - 1]!.impact] <= rank[args[i]!.impact]);
  for (const a of args) {
    assert.ok(a.problem && a.reason.length > 60 && a.benefit && a.service, `argumento incompleto: ${a.findingId}`);
    // El servicio mencionado existe en la propuesta y declara qué resuelve
    for (const id of a.serviceIds) {
      const svc = proposal.services.find((s) => s.id === id);
      assert.ok(svc, `servicio ${id} citado pero no propuesto`);
      assert.ok(svc.solves.includes(a.problem));
    }
  }
});

test('formato de texto para prospección', () => {
  const ctx = buildContext(profile());
  const text = formatSalesArgument(buildSalesArgument(ctx, runAudit(ctx).findings.find((f) => f.id === 'web-none')!));
  const labels = ['Problema detectado:', 'Impacto estimado:', 'Motivo:', 'Servicio recomendado:', 'Beneficio para el cliente:'];
  let last = -1;
  for (const l of labels) {
    const i = text.indexOf(l);
    assert.ok(i > last, `falta o desordenado: ${l}`);
    last = i;
  }
  assert.match(text, /Problema detectado:\nNo tiene sitio web\.\nImpacto estimado:\nAlto\n/);
});

test('los hallazgos de agentes IA sin plantilla también se convierten en argumento', () => {
  const ctx = buildContext(profile());
  const a = buildSalesArgument(ctx, { id: 'ai-x', area: 'reputation', severity: 'high', title: 'Reseñas falsas sospechosas', detail: 'Varias reseñas de 1★ el mismo día.', source: 'agente' });
  assert.equal(a.impact, 'Alto');
  assert.equal(a.problem, 'Reseñas falsas sospechosas.');
  assert.equal(a.serviceIds[0], 'qr-reviews');
});
