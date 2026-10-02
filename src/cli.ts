/**
 * Uso: npm run audit -- "<url de Google Maps>" [--pdf]
 * Ejecuta el análisis completo sin interfaz y guarda el informe en DATA_DIR.
 */
import { runPipeline } from './pipeline/pipeline.js';
import { exportPdf } from './report/pdfExporter.js';
import { reportDir } from './storage/reportStore.js';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
if (!url) {
  console.error('Uso: npm run audit -- "<url de Google Maps>" [--pdf]');
  process.exit(1);
}

const report = await runPipeline(url, {
  emit: (e) => {
    if (e.type === 'step') console.log(`${e.status === 'done' ? '✔' : e.status === 'skipped' ? '–' : e.status === 'error' ? '✖' : '…'} ${e.label}`);
    if (e.type === 'error') console.error(`✖ ${e.message}`);
  },
}).catch(() => process.exit(1));

console.log(`\n${report.profile.name} → ${report.audit.overallScore}/100`);
console.log(report.executiveSummary);
console.log(`\nInforme: ${reportDir(report.id)}/report.json`);
if (args.includes('--pdf')) console.log(`PDF: ${await exportPdf(report)}`);
console.log(`\n--- Mensaje WhatsApp ---\n${report.proposal.whatsappMessage}`);
