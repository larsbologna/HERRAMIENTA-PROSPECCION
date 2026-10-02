import QRCode from 'qrcode';
import { config } from '../config/index.js';
import type { AuditReport } from '../domain/types.js';

/** URL de la página de valoración propia (la que se imprime en el QR). */
export function qrPageUrl(reportId: string): string {
  return `${config.publicBaseUrl}/r/${reportId}`;
}

/** Destino de las valoraciones de 5★: enlace directo a "escribir reseña" si hay Place ID. */
export function googleReviewUrl(report: AuditReport): string {
  if (report.profile.placeId) {
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(report.profile.placeId)}`;
  }
  return report.profile.resolvedUrl ?? report.profile.sourceUrl;
}

export function qrDataUri(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 360, color: { dark: '#14161f', light: '#ffffff' } });
}

export function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { margin: 2, width: 720 });
}
