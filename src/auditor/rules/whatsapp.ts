import { collector, type AuditRule } from '../context.js';

export const whatsappRules: AuditRule = ({ profile, website, vertical }) => {
  const c = collector('rules:whatsapp');
  const inWeb = website?.whatsapp.hasLink ?? false;
  const inMaps = [...profile.socialLinks, profile.website ?? '', profile.bookingUrl ?? ''].some((l) => /wa\.me|whatsapp/i.test(l));
  const visible = inWeb || inMaps;

  if (!visible) {
    c.finding({ id: 'wa-not-visible', area: 'whatsapp', severity: 'high', title: 'WhatsApp no visible', detail: 'No hay enlace de WhatsApp ni en la ficha ni en la web: el canal preferido de los clientes queda fuera.' });
  }

  // No se puede ver desde fuera si usa respuestas automáticas de WhatsApp Business;
  // sí se ve si hay algún chat/bot en la web. Sin ninguno, se asume atención 100% manual.
  if (!website?.hasChatWidget) {
    c.finding({
      id: 'wa-no-auto-reply', area: 'whatsapp', severity: vertical.whatsappIntensity === 3 ? 'high' : 'medium',
      title: 'No responde consultas automáticamente',
      detail: 'No se detectó ningún chat, bot ni asistente automático: las consultas dependen de que alguien esté disponible para contestar.',
    });
  }

  const volume = (profile.reviewCount ?? 0) >= 100 || vertical.whatsappIntensity === 3;
  c.opportunity({
    id: 'wa-automation', area: 'whatsapp', title: 'Automatizar respuestas frecuentes por WhatsApp',
    detail: volume
      ? 'Por volumen y rubro, el negocio recibe muchas consultas repetitivas (horarios, precios, disponibilidad) que se pueden automatizar.'
      : 'Respuestas automáticas para horarios, ubicación y precios ahorran tiempo y evitan perder clientes fuera de horario.',
  });
  if (!website?.hasChatWidget) {
    c.opportunity({
      id: 'wa-ai-agent', area: 'whatsapp', title: 'Agente IA de atención 24/7',
      detail: vertical.bookingRelevant
        ? 'Un agente IA en WhatsApp puede responder dudas y agendar citas/reservas automáticamente, incluso de noche.'
        : 'Un agente IA en WhatsApp puede responder consultas, enviar catálogo y derivar ventas al equipo.',
    });
  }
  return c.out;
};
