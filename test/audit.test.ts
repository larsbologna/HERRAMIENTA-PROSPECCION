import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContext, runAudit } from '../src/auditor/auditor.js';
import type { BusinessProfile } from '../src/domain/types.js';
import { buildProposal } from '../src/proposal/proposalEngine.js';

function profile(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    sourceUrl: 'https://www.google.com/maps/place/x',
    name: 'Restaurante Prueba',
    category: 'Restaurante',
    additionalCategories: [],
    rating: 4.0,
    reviewCount: 18,
    address: 'Calle 1',
    phone: '+34 600 000 000',
    services: [],
    hasBooking: false,
    hasMenu: false,
    photoCount: 4,
    photoCountIsEstimate: false,
    photoUrls: [],
    posts: [],
    reviews: [
      { rating: 2, ageDays: 70, hasOwnerResponse: false },
      { rating: 5, ageDays: 120, hasOwnerResponse: false },
      { rating: 4, ageDays: 200, hasOwnerResponse: false },
    ],
    permanentlyClosed: false,
    socialLinks: [],
    scrapedAt: new Date().toISOString(),
    warnings: [],
    ...over,
  };
}

test('un negocio descuidado genera hallazgos y servicios de alta prioridad', () => {
  const ctx = buildContext(profile());
  const audit = runAudit(ctx);
  const ids = audit.findings.map((f) => f.id);
  for (const id of ['web-none', 'rep-few-reviews', 'rep-no-responses', 'rep-negative-unanswered', 'rep-stale-reviews', 'maps-few-photos', 'maps-no-description', 'maps-no-hours', 'maps-no-menu', 'wa-not-visible']) {
    assert.ok(ids.includes(id), `falta ${id}`);
  }
  assert.equal(ctx.vertical.id, 'gastronomia');
  assert.ok(audit.qr.recommended);
  assert.equal(audit.findings[0]!.severity, 'critical', 'ordenado por severidad');
  assert.ok(audit.overallScore < 50);

  const proposal = buildProposal(ctx, audit);
  const services = Object.fromEntries(proposal.services.map((s) => [s.id, s.priority]));
  assert.equal(services.website, 'alta');
  assert.equal(services['qr-reviews'], 'alta');
  assert.equal(services['maps-optimization'], 'alta');
  assert.ok(services['booking-system']);
  assert.match(proposal.whatsappMessage, /Restaurante Prueba/);
  assert.match(proposal.whatsappLink ?? '', /^https:\/\/wa\.me\/34600000000/);
});

test('un negocio bien trabajado obtiene buena puntuación y pocos servicios urgentes', () => {
  const recent = Array.from({ length: 20 }, (_, i) => ({ rating: 5, ageDays: i, hasOwnerResponse: true }));
  const ctx = buildContext(
    profile({
      category: 'Tienda de bicicletas',
      rating: 4.8,
      reviewCount: 640,
      photoCount: 250,
      description: 'x'.repeat(400),
      hours: { days: { lunes: '9–18', martes: '9–18', miércoles: '9–18', jueves: '9–18', viernes: '9–18', sábado: '9–14', domingo: 'Cerrado' } },
      services: ['a', 'b', 'c', 'd'],
      posts: [{ text: 'Oferta', ageDays: 5 }],
      reviews: recent,
      isClaimed: true,
      website: 'https://bicis.example',
    }),
    {
      url: 'https://bicis.example', reachable: true, https: true, isSocialOrDirectory: false, title: 'Bicis', metaDescription: 'desc',
      loadTimeMs: 1200, mobile: { hasViewportMeta: true, horizontalOverflow: false },
      contact: { phoneLinks: ['tel:1'], emailLinks: ['mailto:a'], hasContactForm: true, hasAddress: true, contactAboveFold: true },
      whatsapp: { hasLink: true, links: ['https://wa.me/1'], hasFloatingButton: true },
      booking: { hasOnlineBooking: false, providers: [] }, hasChatWidget: false, chatProviders: [], socialLinks: [],
      visual: { imageCount: 20, brokenImages: 0, hasH1: true, fontFamilies: ['Inter'], usesModernLayout: true, legacyTech: [] },
      scores: { visual: 100, mobile: 100, speed: 100, contact: 100 }, analyzedAt: new Date().toISOString(),
    },
  );
  const audit = runAudit(ctx);
  assert.ok(audit.overallScore >= 85, `score ${audit.overallScore}`);
  assert.ok(!audit.findings.some((f) => f.severity === 'critical' || f.severity === 'high'));
  const proposal = buildProposal(ctx, audit);
  assert.ok(!proposal.services.some((s) => s.id === 'website'));
  assert.ok(!proposal.services.some((s) => s.priority === 'alta' && s.id === 'maps-optimization'));
});
