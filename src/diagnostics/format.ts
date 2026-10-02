import type { DiagnosticReport, FieldDiagnostic } from './mapsDiagnostic.js';

const ICON: Record<FieldDiagnostic['estado'], string> = { OK: '✔', REVISAR: '⚠', 'NO ENCONTRADO': '·', DISCREPANCIA: '✖' };

function short(v: unknown, max = 70): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return '—';
  const one = s.replace(/\s+/g, ' ');
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Vista legible en terminal del informe de diagnóstico. */
export function formatDiagnostic(r: DiagnosticReport): string {
  const lines: string[] = [];
  const hr = '─'.repeat(78);
  lines.push(hr);
  lines.push(`Página: ${r.pagina.titulo ?? '—'}`);
  lines.push(`URL final: ${r.pagina.urlFinal ?? '—'}`);
  lines.push(`Entorno: Playwright ${r.entorno.playwright} · Chromium ${r.entorno.chromium} · idioma ${r.entorno.idioma} · ${(r.duracionMs / 1000).toFixed(1)} s`);
  if (r.pagina.consentimiento) lines.push('Se mostró el aviso de cookies de Google.');
  if (r.pagina.bloqueoDetectado) lines.push('⚠ BLOQUEO DETECTADO: Google mostró verificación/captcha o no salió de la página de consentimiento.');
  if (r.error) lines.push(`✖ ERROR: ${r.error}`);
  lines.push(hr);

  for (const f of r.campos) {
    lines.push(`${ICON[f.estado]} ${f.campo.padEnd(34)} ${f.confianza.toUpperCase().padEnd(8)} ${f.estado}`);
    lines.push(`    valor:     ${short(f.valor)}`);
    if (f.valorCrudo !== '' && short(f.valorCrudo) !== short(f.valor)) lines.push(`    crudo:     ${short(f.valorCrudo)}`);
    lines.push(`    selector:  ${f.selector ?? '—'}${f.lectura ? `  [${f.lectura}]` : ''}`);
    lines.push(`    fuente:    ${f.fuente.pestaña} › ${f.fuente.contenedor} › estrategia ${f.fuente.estrategia}`);
    if (f.fuente.textoCoincidente) lines.push(`    coincide:  "${short(f.fuente.textoCoincidente)}"`);
    if (f.fuente.html) lines.push(`    html:      ${short(f.fuente.html, 110)}`);
    for (const m of f.motivoConfianza) lines.push(`    · ${m}`);
    for (const a of f.avisos) lines.push(`    ! ${a}`);
  }

  if (r.reseñas) {
    lines.push(hr);
    lines.push(`Reseñas: ${r.reseñas.container.nodes} nodos con "${r.reseñas.container.selector}" (el scraper usó ${r.reseñas.muestraScraper})`);
    for (const [k, sf] of Object.entries(r.reseñas.subfields)) {
      const hits = sf.attempts.filter((a) => a.aciertos > 0).map((a) => `${a.selector} ×${a.aciertos}`).join(', ') || 'ninguno';
      lines.push(`  ${k.padEnd(15)} ${hits}${sf.sinValor ? `  · sin valor: ${sf.sinValor}` : ''}`);
    }
  }

  const s = r.resumen;
  lines.push(hr);
  lines.push(`RESUMEN: ${s.campos} campos · confianza alta ${s.porConfianza.alta} · media ${s.porConfianza.media} · baja ${s.porConfianza.baja} · ninguna ${s.porConfianza.ninguna}`);
  lines.push(`Estados: OK ${s.porEstado.OK} · REVISAR ${s.porEstado.REVISAR} · NO ENCONTRADO ${s.porEstado['NO ENCONTRADO']} · DISCREPANCIA ${s.porEstado.DISCREPANCIA}`);
  if (s.revisar.length) lines.push(`Revisar: ${s.revisar.join(', ')}`);
  if (s.discrepancias.length) lines.push(`Discrepancias sonda/scraper: ${s.discrepancias.join(', ')}`);
  if (r.avisosDelScraper.length) lines.push(`Avisos del scraper: ${r.avisosDelScraper.join(' | ')}`);
  return lines.join('\n');
}
