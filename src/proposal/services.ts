import type { ServiceId } from '../domain/types.js';

export interface ServiceDefinition {
  id: ServiceId;
  name: string;
  pitch: string;
}

/** Catálogo de servicios del Gestor de Presencia Online. Editable para ajustar textos o añadir servicios. */
export const SERVICE_CATALOG: Record<ServiceId, ServiceDefinition> = {
  'maps-optimization': { id: 'maps-optimization', name: 'Optimización de Google Maps', pitch: 'ficha completa y optimizada para aparecer antes que la competencia' },
  'qr-reviews': { id: 'qr-reviews', name: 'Sistema QR para reseñas', pitch: 'un sistema QR que multiplica las reseñas de 5★ y filtra las quejas en privado' },
  website: { id: 'website', name: 'Sitio web profesional', pitch: 'una web profesional, rápida y pensada para móviles' },
  'whatsapp-ai-bot': { id: 'whatsapp-ai-bot', name: 'Bot IA para WhatsApp', pitch: 'un asistente IA en WhatsApp que responde y agenda 24/7' },
  'admin-dashboard': { id: 'admin-dashboard', name: 'Dashboard administrativo', pitch: 'un panel para ver reseñas, consultas y reservas en un solo lugar' },
  'booking-system': { id: 'booking-system', name: 'Sistema de reservas', pitch: 'reservas online sin llamadas ni mensajes de ida y vuelta' },
  'support-automation': { id: 'support-automation', name: 'Automatización de atención', pitch: 'respuestas automáticas a consultas y reseñas para no perder ningún cliente' },
};
