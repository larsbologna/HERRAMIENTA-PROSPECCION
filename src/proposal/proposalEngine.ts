import type { AuditContext } from '../auditor/context.js';
import type { AuditResult, ImprovementPotential, Priority, Proposal, ServiceId, ServiceRecommendation } from '../domain/types.js';
import { SERVICE_CATALOG } from './services.js';
import { buildWhatsappMessage, whatsappLink } from './whatsappMessage.js';

type Evaluation = { fit: number; reasons: string[]; impact: string } | null;
type ServiceEvaluator = (ctx: AuditContext, audit: AuditResult, has: (id: string) => boolean) => Evaluation;

const EVALUATORS: Record<ServiceId, ServiceEvaluator> = {
  'maps-optimization': (ctx, audit, has) => {
    const reasons: string[] = [];
    let fit = 0;
    const add = (id: string, pts: number, reason: string) => { if (has(id)) { fit += pts; reasons.push(reason); } };
    add('maps-unclaimed', 40, 'La ficha no está reclamada.');
    add('maps-no-description', 20, 'No tiene descripción.');
    add('maps-poor-description', 12, 'Descripción pobre.');
    add('maps-generic-category', 15, 'Categoría poco específica.');
    add('maps-no-category', 20, 'Sin categoría.');
    add('maps-no-hours', 18, 'Sin horarios.');
    add('maps-incomplete-hours', 10, 'Horarios incompletos.');
    add('maps-few-photos', 18, 'Muy pocas fotos.');
    add('maps-low-photos', 8, 'Pocas fotos para el rubro.');
    add('maps-no-posts', 12, 'Sin publicaciones.');
    add('maps-stale-posts', 6, 'Publicaciones desactualizadas.');
    add('maps-few-attributes', 6, 'Faltan atributos y servicios.');
    add('maps-no-phone', 15, 'Sin teléfono en la ficha.');
    add('maps-no-menu', 10, 'Sin carta enlazada.');
    const mapsScore = audit.scores.find((s) => s.area === 'maps')?.score ?? 100;
    if (!reasons.length && mapsScore >= 85) return null;
    return { fit: Math.min(100, fit + 10), reasons, impact: 'Más visibilidad en búsquedas locales y más llamadas, rutas y visitas.' };
  },

  'qr-reviews': (_ctx, audit) => {
    if (!audit.qr.recommended) return null;
    const fit = audit.qr.urgency === 'alta' ? 90 : audit.qr.urgency === 'media' ? 70 : 45;
    const monthly = audit.qr.estimatedMonthlyReviews;
    return { fit, reasons: audit.qr.reasons, impact: `Captar ~${monthly ?? 5}+ reseñas nuevas al mes y proteger la calificación pública.` };
  },

  website: (ctx, _audit, has) => {
    if (has('web-none')) return { fit: 95, reasons: ['No tiene sitio web.'], impact: 'Un canal propio que capta clientes 24/7 y refuerza la ficha de Maps.' };
    if (has('web-social-only')) return { fit: 85, reasons: ['Solo enlaza una red social/directorio.'], impact: 'Web propia que posiciona en Google y no depende de terceros.' };
    if (has('web-down')) return { fit: 90, reasons: ['La web actual no carga.'], impact: 'Recuperar todas las visitas que hoy llegan a una web caída.' };
    const reasons: string[] = [];
    let fit = 0;
    const add = (id: string, pts: number, reason: string) => { if (has(id)) { fit += pts; reasons.push(reason); } };
    add('web-not-mobile', 35, 'No está adaptada a móviles.');
    add('web-outdated', 30, 'Diseño anticuado.');
    add('web-slow', 25, 'Carga lenta.');
    add('web-no-https', 15, 'Sin HTTPS.');
    add('web-poor-contact', 15, 'Contacto poco claro.');
    add('web-mobile-issues', 10, 'Problemas en móvil.');
    add('web-visual-improvable', 10, 'Calidad visual mejorable.');
    if (fit < 25) return null;
    return { fit: Math.min(100, fit), reasons, impact: 'Una web moderna que convierte las visitas de Maps en contactos.' };
  },

  'whatsapp-ai-bot': (ctx, _audit, has) => {
    const reasons: string[] = [];
    let fit = 30;
    if (has('wa-not-visible')) { fit += 20; reasons.push('WhatsApp no está visible para los clientes.'); }
    if (ctx.vertical.whatsappIntensity === 3) { fit += 25; reasons.push(`En ${ctx.vertical.label.toLowerCase()} el volumen de consultas por WhatsApp es alto.`); }
    else if (ctx.vertical.whatsappIntensity === 2) fit += 10;
    if ((ctx.profile.reviewCount ?? 0) >= 150) { fit += 15; reasons.push('Volumen de clientes alto (muchas reseñas) → muchas consultas repetitivas.'); }
    if (ctx.vertical.bookingRelevant) { fit += 10; reasons.push('El bot puede agendar citas/reservas automáticamente.'); }
    if (ctx.website?.hasChatWidget) { fit -= 20; reasons.push(`Ya usa ${ctx.website.chatProviders.join(', ')} en su web.`); }
    if (!reasons.length) reasons.push('Atención inmediata fuera de horario.');
    return { fit: Math.min(100, fit), reasons, impact: 'Responder al instante 24/7 y no perder consultas fuera de horario.' };
  },

  'booking-system': (ctx, _audit, has) => {
    if (!ctx.vertical.bookingRelevant) return null;
    const webBooking = ctx.website?.booking.hasOnlineBooking ?? false;
    if (ctx.profile.hasBooking && webBooking) return null;
    const reasons: string[] = [];
    if (!ctx.profile.hasBooking) reasons.push('La ficha de Maps no tiene botón de reserva.');
    if (!webBooking) reasons.push(has('web-none') ? 'No tiene web donde reservar.' : 'La web no permite reservar online.');
    return { fit: ctx.profile.hasBooking || webBooking ? 55 : 80, reasons, impact: 'Más reservas, menos llamadas y menos ausencias con recordatorios automáticos.' };
  },

  'support-automation': (ctx, audit, has) => {
    const reasons: string[] = [];
    let fit = 20;
    if (has('rep-no-responses') || has('rep-low-responses')) { fit += 30; reasons.push('Responde a pocas reseñas: se pueden automatizar respuestas con IA.'); }
    if (has('rep-negative-unanswered')) { fit += 15; reasons.push('Hay reseñas negativas sin responder.'); }
    if (has('web-poor-contact') || has('wa-not-visible')) { fit += 15; reasons.push('Canales de contacto poco claros.'); }
    if (ctx.vertical.whatsappIntensity === 3) { fit += 10; reasons.push('Rubro con muchas consultas repetitivas.'); }
    if (fit < 40) return null;
    return { fit: Math.min(100, fit), reasons, impact: 'Ahorrar horas de atención manual cada semana y mejorar la reputación.' };
  },

  'admin-dashboard': (ctx, audit, has) => {
    const reasons: string[] = [];
    let fit = 25;
    if ((ctx.profile.reviewCount ?? 0) >= 100) { fit += 15; reasons.push('Volumen de reseñas que conviene seguir con métricas.'); }
    if (audit.qr.recommended) { fit += 15; reasons.push('Centraliza el feedback interno que capta el sistema QR.'); }
    if (ctx.vertical.bookingRelevant) { fit += 10; reasons.push('Permite gestionar reservas y clientes en un solo lugar.'); }
    if (has('rep-no-responses')) { fit += 5; reasons.push('Alertas de reseñas pendientes de respuesta.'); }
    if (fit < 45) return null;
    return { fit: Math.min(100, fit), reasons, impact: 'Visibilidad total del negocio: reseñas, consultas, reservas y evolución mensual.' };
  },
};

function priorityFor(fit: number): Priority {
  return fit >= 70 ? 'alta' : fit >= 45 ? 'media' : 'baja';
}

export function buildProposal(ctx: AuditContext, audit: AuditResult): Proposal {
  const ids = new Set([...audit.findings.map((f) => f.id), ...audit.opportunities.map((o) => o.id)]);
  const has = (id: string) => ids.has(id);

  const services: ServiceRecommendation[] = [];
  for (const [id, evaluate] of Object.entries(EVALUATORS) as Array<[ServiceId, ServiceEvaluator]>) {
    const result = evaluate(ctx, audit, has);
    if (!result) continue;
    const def = SERVICE_CATALOG[id];
    services.push({
      id,
      name: def.name,
      priority: priorityFor(result.fit),
      fitScore: result.fit,
      reasons: result.reasons,
      expectedImpact: result.impact,
    });
  }
  services.sort((a, b) => b.fitScore - a.fitScore);

  const potential = computePotential(audit, services);
  const proposal: Proposal = { services, potential, whatsappMessage: '' };
  proposal.whatsappMessage = buildWhatsappMessage(ctx, audit, proposal);
  proposal.whatsappLink = whatsappLink(ctx.profile.phone, proposal.whatsappMessage);
  return proposal;
}

export function computePotential(audit: AuditResult, services: ServiceRecommendation[]): ImprovementPotential {
  const current = audit.overallScore;
  const gain = services
    .filter((s) => s.priority !== 'baja')
    .reduce((sum, s) => sum + SERVICE_CATALOG[s.id].areaGain * (s.fitScore / 100), 0);
  // Proyección conservadora: como mucho +45 puntos y nunca por encima de 92.
  const projected = Math.min(92, current + 45, Math.max(current, Math.round(current + gain * 0.8)));
  const delta = projected - current;
  const level = delta >= 35 ? 'Muy alto' : delta >= 20 ? 'Alto' : delta >= 10 ? 'Medio' : 'Bajo';
  const explanation =
    delta >= 20
      ? `La presencia online actual (${current}/100) deja muchos clientes sobre la mesa. Con los servicios recomendados podría llegar a ~${projected}/100.`
      : delta >= 10
        ? `Buena base (${current}/100) con mejoras concretas que pueden llevarla a ~${projected}/100.`
        : `La presencia ya es sólida (${current}/100); el margen está en automatización y fidelización.`;
  return { currentScore: current, projectedScore: projected, level, explanation };
}
