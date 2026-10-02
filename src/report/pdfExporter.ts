import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AuditReport, Screenshot } from '../domain/types.js';
import { launchBrowser } from '../scraper/browser.js';
import { reportDir } from '../storage/reportStore.js';
import { renderStandaloneHtml } from './htmlRenderer.js';
import { qrDataUri, qrPageUrl } from './qrAssets.js';

/** Incrusta las capturas como data URI para que el PDF sea autocontenido. */
async function embed(report: AuditReport): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    report.screenshots.map(async (s: Screenshot) => {
      try {
        const buf = await fs.readFile(path.join(reportDir(report.id), s.file));
        map.set(s.id, `data:image/png;base64,${buf.toString('base64')}`);
      } catch {
        /* captura ausente: se omite */
      }
    }),
  );
  return map;
}

export async function exportPdf(report: AuditReport): Promise<string> {
  const images = await embed(report);
  const html = renderStandaloneHtml(report, {
    imageSrc: (s) => images.get(s.id) ?? '',
    qrPageUrl: report.audit.qr.recommended ? qrPageUrl(report.id) : undefined,
    qrImage: report.audit.qr.recommended ? await qrDataUri(qrPageUrl(report.id)) : undefined,
  });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const file = path.join(reportDir(report.id), 'informe.pdf');
    await page.pdf({
      path: file,
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:8px;color:#888;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    return file;
  } finally {
    await browser.close().catch(() => {});
  }
}
