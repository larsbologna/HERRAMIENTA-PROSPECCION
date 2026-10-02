/**
 * Convierte fechas relativas de Google ("hace 3 días", "Hace un mes", "a week ago",
 * "Editado hace 2 años") a días aproximados.
 */
const UNITS: Array<[RegExp, number]> = [
  [/minut|minute|hora|hour|segundo|second/, 0],
  [/d[ií]a|day/, 1],
  [/semana|week/, 7],
  [/mes|month/, 30],
  [/a[ñn]o|year/, 365],
];

const WORD_NUMBERS: Record<string, number> = {
  un: 1, una: 1, uno: 1, a: 1, an: 1, one: 1,
  dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4,
  cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7,
  ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, once: 11, doce: 12,
};

export function relativeDateToDays(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase();
  if (/ayer|yesterday/.test(text)) return 1;
  if (/hoy|today|ahora|just now/.test(text)) return 0;

  const unit = UNITS.find(([re]) => re.test(text));
  if (!unit) return undefined;

  let amount = 1;
  const digit = text.match(/(\d+)/);
  if (digit?.[1]) {
    amount = Number.parseInt(digit[1], 10);
  } else {
    const word = text.match(/\b(un|una|uno|a|an|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten|once|doce)\b/);
    if (word?.[1]) amount = WORD_NUMBERS[word[1]] ?? 1;
  }
  return amount * unit[1];
}
