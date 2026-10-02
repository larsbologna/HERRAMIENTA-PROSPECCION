import { collector, type AuditRule } from '../context.js';

export const websiteRules: AuditRule = ({ profile, website: w, vertical }) => {
  const c = collector('rules:website');

  if (!profile.website || !w) {
    c.finding({ id: 'web-none', area: 'website', severity: 'critical', title: 'No tiene sitio web', detail: 'La ficha no enlaza a ninguna web. Se pierde credibilidad, posicionamiento y un canal para captar clientes 24/7.' });
    return c.out;
  }
  if (w.isSocialOrDirectory) {
    c.finding({ id: 'web-social-only', area: 'website', severity: 'high', title: 'El "sitio web" es una red social o directorio', detail: `La ficha enlaza a ${new URL(w.url).hostname}: no es una web propia, no posiciona en Google y depende de terceros.`, evidence: w.url });
    return c.out;
  }
  if (!w.reachable) {
    c.finding({ id: 'web-down', area: 'website', severity: 'critical', title: 'El sitio web no carga', detail: `Al abrir ${w.url} se obtuvo un error${w.httpStatus ? ` (HTTP ${w.httpStatus})` : ''}. Cada visita desde Maps se pierde.`, evidence: w.error });
    return c.out;
  }

  if (!w.https) c.finding({ id: 'web-no-https', area: 'website', severity: 'high', title: 'Web sin HTTPS', detail: 'El navegador la marca como "No segura", lo que espanta a los visitantes.' });

  // Móvil
  if (!w.mobile.hasViewportMeta || w.scores.mobile < 50) {
    c.finding({ id: 'web-not-mobile', area: 'website', severity: 'high', title: 'No está adaptada a móviles', detail: 'Más del 70% de las visitas desde Maps son desde el móvil y la web no se adapta correctamente.', evidence: [!w.mobile.hasViewportMeta && 'sin meta viewport', w.mobile.horizontalOverflow && 'desbordamiento horizontal'].filter(Boolean).join(', ') || undefined });
  } else if (w.scores.mobile < 80) {
    c.finding({ id: 'web-mobile-issues', area: 'website', severity: 'medium', title: 'Problemas de usabilidad en móvil', detail: 'Textos pequeños, botones difíciles de tocar o contenido que se sale de la pantalla.' });
  }

  // Velocidad
  const secs = w.loadTimeMs !== undefined ? (w.loadTimeMs / 1000).toFixed(1) : '?';
  if (w.scores.speed < 50) {
    c.finding({ id: 'web-slow', area: 'website', severity: 'high', title: 'Web lenta', detail: `Tarda ${secs}s en cargar${w.pageWeightKb ? ` y pesa ${(w.pageWeightKb / 1024).toFixed(1)} MB` : ''}. Más de 3s hace que se pierda gran parte de las visitas.` });
  } else if (w.scores.speed < 80) {
    c.finding({ id: 'web-speed-improvable', area: 'website', severity: 'low', title: 'Velocidad mejorable', detail: `Carga en ${secs}s.` });
  }

  // Calidad visual
  if (w.scores.visual < 50) {
    c.finding({ id: 'web-outdated', area: 'website', severity: 'high', title: 'Diseño anticuado o poco profesional', detail: 'La web transmite una imagen desactualizada frente a la competencia.', evidence: [...w.visual.legacyTech, w.visual.copyrightYear ? `© ${w.visual.copyrightYear}` : ''].filter(Boolean).join(', ') || undefined });
  } else if (w.scores.visual < 75) {
    c.finding({ id: 'web-visual-improvable', area: 'website', severity: 'medium', title: 'Calidad visual mejorable', detail: 'Hay detalles de diseño y SEO básico (título, descripción, imágenes) por pulir.' });
  }
  if (!w.metaDescription) c.finding({ id: 'web-no-meta', area: 'website', severity: 'low', title: 'Sin meta descripción', detail: 'Google muestra un texto aleatorio en los resultados de búsqueda.' });

  // Contacto
  if (w.scores.contact < 50) {
    c.finding({ id: 'web-poor-contact', area: 'website', severity: 'high', title: 'Contacto poco claro', detail: 'Cuesta encontrar cómo contactar: faltan teléfono clicable, WhatsApp, formulario o dirección.' });
  } else if (!w.contact.contactAboveFold) {
    c.finding({ id: 'web-contact-hidden', area: 'website', severity: 'medium', title: 'Contacto no visible al entrar', detail: 'No hay botón de contacto en la primera pantalla.' });
  }
  if (!w.whatsapp.hasLink) {
    c.finding({ id: 'web-no-whatsapp', area: 'website', severity: 'medium', title: 'Sin botón de WhatsApp en la web', detail: 'Un botón flotante de WhatsApp es la vía de contacto que más convierte en negocios locales.' });
  }

  // Reservas
  if (vertical.bookingRelevant && !w.booking.hasOnlineBooking) {
    c.finding({ id: 'web-no-booking', area: 'website', severity: 'medium', title: 'Sin reservas online', detail: `En ${vertical.label.toLowerCase()} los clientes esperan reservar/pedir cita sin llamar. No se detectó ningún sistema de reservas.` });
  }
  return c.out;
};
