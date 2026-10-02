import type { ServiceId } from '../domain/types.js';

export interface ServiceDefinition {
  id: ServiceId;
  name: string;
  pitch: string;
  /** Mejora estimada (puntos) sobre el área principal al implantarlo. */
  areaGain: number;
}

/** Catálogo de servicios del Gestor de Presencia Online. Editable para ajustar textos o añadir servicios. */
export const SERVICE_CATALOG: Record<ServiceId, ServiceDefinition> = {
  'maps-optimization': { id: 'maps-optimization', name: 'Optimización de Google Maps', pitch: 'ficha completa y optimizada para aparecer antes que la competencia', areaGain: 12 },
  'qr-reviews': { id: 'qr-reviews', name: 'Sistema QR para reseñas', pitch: 'un sistema QR que multiplica las reseñas de 5★ y filtra las quejas en privado', areaGain: 12 },
  website: { id: 'website', name: 'Sitio web profesional', pitch: 'una web profesional, rápida y pensada para móviles', areaGain: 14 },
  'whatsapp-ai-bot': { id: 'whatsapp-ai-bot', name: 'Bot IA para WhatsApp', pitch: 'un asistente IA en WhatsApp que responde y agenda 24/7', areaGain: 8 },
  'admin-dashboard': { id: 'admin-dashboard', name: 'Dashboard administrativo', pitch: 'un panel para ver reseñas, consultas y reservas en un solo lugar', areaGain: 3 },
  'booking-system': { id: 'booking-system', name: 'Sistema de reservas', pitch: 'reservas online sin llamadas ni mensajes de ida y vuelta', areaGain: 5 },
  'support-automation': { id: 'support-automation', name: 'Automatización de atención', pitch: 'respuestas automáticas a consultas y reseñas para no perder ningún cliente', areaGain: 5 },
};
