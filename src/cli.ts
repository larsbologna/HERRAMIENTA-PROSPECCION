/**
 * Análisis por terminal (sin interfaz):  npm run analizar -- "<url de Google Maps>"
 * El resultado se guarda en la base del CRM igual que desde la aplicación.
 */
import { analyze } from './analyzer.js';
import { openCrm } from './crm/index.js';
import { formatSalesArgumentsText } from './proposal/salesArguments.js';

const url = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!url) {
  console.error('Uso: npm run analizar -- "<url de Google Maps>"');
  process.exit(1);
}

try {
  const r = await analyze(url, { onProgress: (p) => console.log(`[${String(p.percent).padStart(3)}%] ${p.message}`) });
  const saved = openCrm().saveAnalysis(r);
  const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
  console.log(`\n${r.profile.name} · ${r.profile.category ?? ''} · ${r.profile.rating ?? '—'}★ (${r.profile.reviewCount ?? 0} reseñas) · score ${r.audit.overallScore}/100`);
  console.log(saved.created ? 'Guardado como prospecto nuevo.' : 'Prospecto existente actualizado.');
  console.log(`\n${formatSalesArgumentsText(r.profile.name, r.proposal.salesArguments)}`);
  console.log('\n--- PRESUPUESTO ---');
  for (const opt of [r.budget.recommended, r.budget.complete]) {
    console.log(`\n${opt.label}: ${money(opt.setupAfterDiscount)} inicial + ${money(opt.monthly)}/mes · total ${opt.contractMonths} meses: ${money(opt.total)}`);
    for (const i of opt.items) console.log(`  · ${i.name}: ${money(i.setup)} + ${money(i.monthly)}/mes`);
  }
  console.log(`\nValor potencial: ${money(r.budget.potentialValue)} · Total del proyecto: ${money(r.budget.projectTotal)}`);
  console.log(`\n--- MENSAJE WHATSAPP ---\n${r.proposal.whatsappMessage}`);
} catch (err) {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
}
