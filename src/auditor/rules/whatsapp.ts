import { collector, type AuditRule } from '../context.js';

export const whatsappRules: AuditRule = ({ profile, website, vertical }) => {
  const c = collector('rules:whatsapp');
  const inWeb = website?.whatsapp.hasLink ?? false;
  const inMaps = [...profile.socialLinks, profile.website ?? '', profile.bookingUrl ?? ''].some((l) => /wa\.me|whatsapp/i.test(l));
  const visible = inWeb || inMaps;

  if (!visible) {
    c.finding({ id: 'wa-not-visible', area: 'whatsapp', severity: 'high', title: 'WhatsApp no visible', detail: 'No hay enlace de WhatsApp ni en la ficha ni en la web: el canal preferido de los clientes queda fuera.' });
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
