/**
 * Uso por terminal (sin interfaz):  npm run analizar -- "<url de Google Maps>"
 */
import { analyze } from './analyzer.js';
import { formatSalesArgumentsText } from './proposal/salesArguments.js';

const url = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!url) {
  console.error('Uso: npm run analizar -- "<url de Google Maps>"');
  process.exit(1);
}

try {
  const r = await analyze(url, { onProgress: (p) => console.log(`[${String(p.percent).padStart(3)}%] ${p.message}`) });
  const money = (n: number) => `${n.toLocaleString('es')} ${r.budget.currency}`;
  console.log(`\n${r.profile.name} · ${r.profile.category ?? ''} · ${r.profile.rating ?? '—'}★ (${r.profile.reviewCount ?? 0} reseñas)\n`);
  console.log(formatSalesArgumentsText(r.profile.name, r.proposal.salesArguments));
  console.log('\n--- PRESUPUESTO SUGERIDO ---');
  for (const opt of [r.budget.recommended, r.budget.complete]) {
    console.log(`\n${opt.label}: ${money(opt.setupAfterDiscount)} inicial + ${money(opt.monthly)}/mes${opt.discountPct ? ` (incluye ${opt.discountPct}% de descuento)` : ''}`);
    for (const i of opt.items) console.log(`  · ${i.name}: ${money(i.setup)} + ${money(i.monthly)}/mes`);
  }
  console.log(`\n--- MENSAJE WHATSAPP ---\n${r.proposal.whatsappMessage}`);
} catch (err) {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
}
