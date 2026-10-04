/**
 * MODO DIAGNÓSTICO del scraper de Google Maps.
 *
 *   npm run diagnose -- "<url de Google Maps>" [--out carpeta] [--visible]
 *
 * Ejecuta el scraper real y, para cada dato, muestra valor, selector, confianza y fuente.
 * Genera <carpeta>/diagnostico.json, capturas y el HTML de cada pestaña para revisarlo offline.
 */
import path from 'node:path';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out');
if (!url) {
  console.error('Uso: npm run diagnose -- "<url de Google Maps>" [--out carpeta] [--visible]');
  process.exit(1);
}
if (args.includes('--visible')) process.env.HEADLESS = 'false';

// Importaciones dinámicas: la configuración se lee después de aplicar --visible.
const { config } = await import('./config/index.js');
const { launchBrowser } = await import('./scraper/browser.js');
const { isMapsUrl } = await import('./scraper/mapsScraper.js');
const { runMapsDiagnostic } = await import('./diagnostics/mapsDiagnostic.js');
const { formatDiagnostic } = await import('./diagnostics/format.js');
const { formatDataQualityText } = await import('./domain/reliability.js');

if (!isMapsUrl(url)) {
  console.error('La URL no parece un enlace de Google Maps.');
  process.exit(1);
}

const outIdx = args.indexOf('--out');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const outDir = path.resolve(outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : path.join(config.dataDir, 'diagnostics', stamp));

console.log(`\nDiagnóstico del scraper de Google Maps\nURL: ${url}\nSalida: ${outDir}\n`);
const browser = await launchBrowser();
try {
  const report = await runMapsDiagnostic(browser, url, { outDir, onProgress: (m) => console.log(`  … ${m}`) });
  console.log(formatDiagnostic(report));
  // Lo que la herramienta va a usar (o no) para argumentar, dato por dato.
  if (report.perfil?.dataQuality) console.log(`\n${formatDataQualityText(report.perfil.dataQuality)}`);
  console.log(`\nArchivo generado: ${path.join(outDir, 'diagnostico.json')}`);
  process.exitCode = report.error ? 1 : 0;
} finally {
  await browser.close();
}
