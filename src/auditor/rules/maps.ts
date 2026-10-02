import { GENERIC_CATEGORIES } from '../../domain/verticals.js';
import { collector, type AuditRule } from '../context.js';

export const mapsRules: AuditRule = ({ profile, vertical, metrics }) => {
  const c = collector('rules:maps');

  if (profile.isClaimed === false) {
    c.finding({
      id: 'maps-unclaimed', area: 'maps', severity: 'critical',
      title: 'La ficha no está reclamada por el propietario',
      detail: 'Google muestra la opción "Reclamar este negocio": cualquiera puede sugerir cambios y el dueño no controla la información.',
    });
  }

  if (profile.permanentlyClosed) {
    c.finding({
      id: 'maps-closed', area: 'maps', severity: 'critical',
      title: 'La ficha figura como cerrada permanentemente',
      detail: 'Si el negocio sigue operando, está perdiendo prácticamente todas las búsquedas locales.',
    });
  }

  // Categoría
  if (!profile.category) {
    c.finding({ id: 'maps-no-category', area: 'maps', severity: 'high', title: 'Sin categoría visible', detail: 'La categoría principal es el factor nº 1 de posicionamiento local en Maps.' });
  } else if (GENERIC_CATEGORIES.test(profile.category.trim())) {
    c.finding({
      id: 'maps-generic-category', area: 'maps', severity: 'medium',
      title: 'Categoría principal demasiado genérica',
      detail: `"${profile.category}" no describe la actividad concreta: se pierden búsquedas específicas del rubro.`,
      evidence: profile.category,
    });
  } else {
    c.opportunity({
      id: 'maps-secondary-categories', area: 'maps',
      title: 'Revisar categorías secundarias',
      detail: `Además de "${profile.category}", añadir categorías secundarias del rubro ${vertical.label.toLowerCase()} amplía las búsquedas en las que aparece.`,
    });
  }

  // Descripción
  const descLen = profile.description?.length ?? 0;
  if (descLen === 0) {
    c.finding({ id: 'maps-no-description', area: 'maps', severity: 'high', title: 'Sin descripción del negocio', detail: 'No se detectó una descripción: es espacio gratuito para palabras clave y propuesta de valor.' });
  } else if (descLen < 150) {
    c.finding({
      id: 'maps-poor-description', area: 'maps', severity: 'medium', title: 'Descripción muy breve',
      detail: `La descripción tiene ${descLen} caracteres (Google permite 750). Falta propuesta de valor y palabras clave.`,
      evidence: profile.description,
    });
  }

  // Horarios
  const days = Object.keys(profile.hours?.days ?? {}).length;
  if (!profile.hours) {
    c.finding({ id: 'maps-no-hours', area: 'maps', severity: 'high', title: 'Horarios no publicados', detail: 'Sin horarios, Google muestra menos la ficha y los clientes no saben cuándo ir o llamar.' });
  } else if (days > 0 && days < 7) {
    c.finding({ id: 'maps-incomplete-hours', area: 'maps', severity: 'medium', title: 'Horarios incompletos', detail: `Solo se detectaron ${days} de 7 días con horario.`, evidence: Object.entries(profile.hours.days).map(([d, h]) => `${d}: ${h}`).join(' · ') });
  }

  // Contacto básico
  if (!profile.phone) {
    c.finding({ id: 'maps-no-phone', area: 'maps', severity: 'high', title: 'Sin teléfono en la ficha', detail: 'Los usuarios de móvil no pueden llamar con un toque desde Maps.' });
  }
  if (!profile.address) {
    c.finding({ id: 'maps-no-address', area: 'maps', severity: 'medium', title: 'Dirección no visible', detail: 'No se detectó la dirección (puede ser un negocio de zona de servicio).' });
  }

  // Fotos
  const photos = profile.photoCount ?? 0;
  const approx = profile.photoCountIsEstimate ? ' (estimación por fotos visibles)' : '';
  if (photos < 10) {
    c.finding({ id: 'maps-few-photos', area: 'maps', severity: profile.photoCountIsEstimate ? 'medium' : 'high', title: 'Muy pocas fotos', detail: `Se detectaron ${photos} fotos${approx}. Las fichas con más de ${vertical.recommendedPhotos} fotos reciben muchas más solicitudes de ruta y clics.` });
  } else if (photos < vertical.recommendedPhotos) {
    c.finding({ id: 'maps-low-photos', area: 'maps', severity: 'low', title: 'Pocas fotos para el rubro', detail: `${photos} fotos${approx}; para ${vertical.label.toLowerCase()} se recomiendan al menos ${vertical.recommendedPhotos}.` });
  }

  // Publicaciones
  if (!profile.posts.length) {
    c.finding({ id: 'maps-no-posts', area: 'maps', severity: 'medium', title: 'Sin publicaciones (Novedades)', detail: 'No se detectaron publicaciones recientes. Publicar ofertas y novedades mantiene la ficha activa ante Google.' });
  } else if ((metrics.daysSinceLastPost ?? 0) > 60) {
    c.finding({ id: 'maps-stale-posts', area: 'maps', severity: 'low', title: 'Publicaciones desactualizadas', detail: `La última publicación tiene unos ${metrics.daysSinceLastPost} días.` });
  }

  // Servicios / atributos / acciones
  if (profile.services.length < 3) {
    c.finding({ id: 'maps-few-attributes', area: 'maps', severity: 'low', title: 'Pocos atributos y servicios cargados', detail: 'Faltan atributos (accesibilidad, formas de pago, servicios) que ayudan a filtrar búsquedas.' });
  }
  if (vertical.menuRelevant && !profile.hasMenu) {
    c.finding({ id: 'maps-no-menu', area: 'maps', severity: 'medium', title: 'Sin carta/menú enlazado', detail: 'En gastronomía, la carta es de lo más consultado en la ficha.' });
  }
  if (vertical.bookingRelevant && !profile.hasBooking) {
    c.opportunity({ id: 'maps-booking-button', area: 'maps', title: 'Activar botón de reserva/cita en Maps', detail: 'El rubro vive de reservas y la ficha no muestra botón para reservar directamente.' });
  }

  return c.out;
};
