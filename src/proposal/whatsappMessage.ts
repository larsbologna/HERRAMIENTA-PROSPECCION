import type { AuditContext } from '../auditor/context.js';
import { config } from '../config/index.js';
import type { AuditResult, Proposal } from '../domain/types.js';
import { SERVICE_CATALOG } from './services.js';

/** Frases "de cliente" (sin tecnicismos) para los hallazgos más comunes. */
const HOOKS: Record<string, (ctx: AuditContext) => string> = {
  'maps-unclaimed': () => 'la ficha de Google no está reclamada, así que cualquiera puede modificar sus datos',
  'web-none': () => 'no tienen una web enlazada en Google, y ahí se pierden muchos clientes que buscan antes de visitar',
  'web-down': () => 'la web que aparece en Google no está cargando',
  'web-social-only': () => 'en Google enlazan una red social en lugar de una web propia',
  'web-not-mobile': () => 'la web no se ve bien desde el celular, que es desde donde llega casi todo el tráfico de Maps',
  'web-slow': () => 'la web tarda bastante en cargar y muchos visitantes se van antes',
  'rep-very-few-reviews': (c) => `tienen solo ${c.profile.reviewCount ?? 0} reseñas, y eso hace que Google muestre antes a la competencia`,
  'rep-few-reviews': (c) => `con ${c.profile.reviewCount ?? 0} reseñas están por debajo de los negocios mejor posicionados de la zona`,
  'rep-no-responses': () => 'casi no se responden las reseñas, algo que Google y los clientes valoran mucho',
  'rep-negative-unanswered': () => 'hay reseñas negativas recientes sin respuesta, que es lo primero que leen los clientes indecisos',
  'rep-stale-reviews': () => 'hace tiempo que no reciben reseñas nuevas, y Google premia la actividad reciente',
  'rep-low-rating': (c) => `la calificación de ${c.profile.rating?.toFixed(1)}★ está por debajo de lo que muchos clientes aceptan`,
  'maps-no-description': () => 'la ficha no tiene descripción, un espacio gratuito para atraer clientes',
  'maps-few-photos': () => 'la ficha tiene muy pocas fotos, y las fichas con más fotos reciben muchas más visitas',
  'maps-no-hours': () => 'no figuran los horarios en Google',
  'wa-not-visible': () => 'no hay un acceso directo a WhatsApp, que hoy es el canal preferido para consultar',
  'web-no-booking': () => 'no se puede reservar online, y muchos clientes ya no quieren llamar',
};

export function buildWhatsappMessage(ctx: AuditContext, audit: AuditResult, proposal: Pick<Proposal, 'services'>): string {
  const name = ctx.profile.name ?? 'su negocio';
  const hooks = audit.findings
    .filter((f) => HOOKS[f.id])
    .slice(0, 3)
    .map((f) => HOOKS[f.id]!(ctx));
  if (hooks.length < 2) {
    hooks.push(...audit.findings.filter((f) => !HOOKS[f.id]).slice(0, 3 - hooks.length).map((f) => f.title.toLowerCase()));
  }

  const top = proposal.services.filter((s) => s.priority !== 'baja').slice(0, 2);
  const offer = top.length
    ? top.map((s) => SERVICE_CATALOG[s.id].pitch).join(' y ')
    : 'mejorar su presencia online y automatizar la atención';

  const lines = [
    `¡Hola! ¿Qué tal? Soy ${config.seller.name}, ${config.seller.business}.`,
    '',
    `Estuve revisando la presencia online de *${name}* y encontré algunas oportunidades concretas para conseguir más clientes:`,
    '',
    ...(hooks.length ? hooks.map((h) => `• ${capitalize(h)}.`) : ['• La presencia online tiene margen para atraer más clientes desde Google.']),
    '',
    `Trabajo justamente en esto: ${offer}.`,
    '',
    'Preparé un informe gratuito con el análisis completo de su ficha. ¿Les gustaría que se lo envíe? Son 2 minutos de lectura y no tiene compromiso. 🙂',
  ];
  return lines.join('\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** wa.me solo funciona con prefijo internacional: si el teléfono no lo trae, se abre sin destinatario. */
export function whatsappLink(phone: string | undefined, message: string): string {
  const text = encodeURIComponent(message);
  const trimmed = phone?.trim() ?? '';
  if (/^(\+|00)/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, '').replace(/^00/, '');
    if (digits.length >= 8) return `https://wa.me/${digits}?text=${text}`;
  }
  return `https://wa.me/?text=${text}`;
}
