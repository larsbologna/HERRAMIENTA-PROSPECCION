/** Normaliza espacios (incluidos NBSP y espacios finos que usa Google). */
export function clean(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const out = text.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  return out || undefined;
}

/** Quita el prefijo de etiqueta de los aria-label de Maps ("Dirección: ...", "Teléfono: ..."). */
export function stripLabel(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return clean(text.replace(/^[^:]{2,40}:\s*/, ''));
}

/**
 * Convierte números con formato local: "1.234", "1,234", "4,5", "(1.234)", "1,2 mil", "2K".
 */
export function parseLocaleNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase().replace(/[()\s]/g, ' ').trim();
  const match = text.match(/(\d+(?:[.,]\d+)*)\s*(mil|k|m)?\b/);
  if (!match || !match[1]) return undefined;
  let num = match[1];
  const suffix = match[2];
  if (suffix) {
    num = num.replace(',', '.');
    const value = Number.parseFloat(num);
    if (Number.isNaN(value)) return undefined;
    const factor = suffix === 'm' ? 1_000_000 : 1_000;
    return Math.round(value * factor);
  }
  // "1.234" o "1,234" con grupos de 3 → separador de miles.
  if (/^\d{1,3}([.,]\d{3})+$/.test(num)) return Number.parseInt(num.replace(/[.,]/g, ''), 10);
  return Number.parseFloat(num.replace(',', '.'));
}

/** Rating "4,6" / "4.6" → 4.6 (solo valores 0-5). */
export function parseRating(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = raw.match(/([0-5](?:[.,]\d)?)/);
  if (!match || !match[1]) return undefined;
  const value = Number.parseFloat(match[1].replace(',', '.'));
  return value >= 0 && value <= 5 ? value : undefined;
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function digitsOnly(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 6 ? digits : undefined;
}
