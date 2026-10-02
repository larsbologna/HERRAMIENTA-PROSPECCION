import type { AuditReport, Finding, Priority, Screenshot, Severity } from '../domain/types.js';

/**
 * Renderizador único del informe: el mismo HTML se usa en la interfaz web y para el PDF,
 * así lo que se ve en pantalla es exactamente lo que se exporta.
 */
export interface RenderOptions {
  /** Cómo resolver la URL de cada captura (ruta HTTP en la web, data URI en el PDF). */
  imageSrc: (shot: Screenshot) => string;
  /** URL de la página QR de demostración (si se quiere incluir). */
  qrPageUrl?: string;
  /** Imagen del QR (data URI). */
  qrImage?: string;
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo' };
const PRIORITY_LABEL: Record<Priority, string> = { alta: 'Prioridad alta', media: 'Prioridad media', baja: 'Prioridad baja' };
const AREA_LABEL: Record<string, string> = { maps: 'Google Maps', website: 'Sitio web', whatsapp: 'WhatsApp', reputation: 'Reputación', qr: 'Reseñas QR' };

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function scoreClass(score: number): string {
  return score >= 75 ? 'good' : score >= 50 ? 'warn' : 'bad';
}

function gauge(score: number, size = 120): string {
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  return `<svg class="rp-gauge ${scoreClass(score)}" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="Puntuación ${score} de 100">
    <circle cx="60" cy="60" r="${r}" class="rp-gauge-bg"/>
    <circle cx="60" cy="60" r="${r}" class="rp-gauge-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" class="rp-gauge-num">${score}</text>
    <text x="60" y="78" text-anchor="middle" class="rp-gauge-sub">/100</text>
  </svg>`;
}

function kpi(label: string, value: string, hint?: string): string {
  return `<div class="rp-kpi"><div class="rp-kpi-label">${esc(label)}</div><div class="rp-kpi-value">${esc(value)}</div>${hint ? `<div class="rp-kpi-hint">${esc(hint)}</div>` : ''}</div>`;
}

function findingItem(f: Finding): string {
  return `<li class="rp-finding sev-${f.severity}">
    <span class="rp-badge sev-${f.severity}">${SEVERITY_LABEL[f.severity]}</span>
    <div><div class="rp-finding-title">${esc(f.title)} <span class="rp-area">${esc(AREA_LABEL[f.area] ?? f.area)}</span></div>
    <div class="rp-finding-detail">${esc(f.detail)}</div>
    ${f.evidence ? `<div class="rp-evidence">${esc(f.evidence)}</div>` : ''}</div>
  </li>`;
}

function row(label: string, value: string | undefined, isLink = false): string {
  const v = value ? (isLink ? `<a href="${esc(value)}" target="_blank" rel="noopener">${esc(value)}</a>` : esc(value)) : '<span class="rp-missing">No detectado</span>';
  return `<tr><th>${esc(label)}</th><td>${v}</td></tr>`;
}

export function renderReportBody(report: AuditReport, opts: RenderOptions): string {
  const { profile: p, audit: a, proposal, website: w } = report;
  const date = new Date(report.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
  const rate = a.metrics.ownerResponseRate;
  const hours = p.hours && Object.keys(p.hours.days).length
    ? Object.entries(p.hours.days).map(([d, h]) => `${d}: ${h}`).join(' · ')
    : p.hours?.raw;

  return `<article class="rp">
  <header class="rp-header">
    <div>
      <div class="rp-eyebrow">Auditoría de presencia online · ${esc(date)}</div>
      <h1>${esc(p.name ?? 'Negocio sin nombre')}</h1>
      <div class="rp-meta">${esc([p.category, p.address].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="rp-header-score">${gauge(a.overallScore)}<div class="rp-gauge-caption">Puntuación global</div></div>
  </header>

  <section class="rp-section">
    <h2><span>1</span> Resumen ejecutivo</h2>
    <p class="rp-lead">${esc(report.executiveSummary)}</p>
    <div class="rp-kpis">
      ${kpi('Calificación', p.rating !== undefined ? `${p.rating.toFixed(1)} ★` : '—')}
      ${kpi('Reseñas', p.reviewCount !== undefined ? String(p.reviewCount) : '—', a.metrics.reviewsLast30Days !== undefined ? `${a.metrics.reviewsLast30Days} en 30 días (muestra)` : undefined)}
      ${kpi('Respuesta a reseñas', rate !== undefined ? `${Math.round(rate * 100)}%` : '—', rate !== undefined ? `${p.reviews.length} recientes analizadas` : undefined)}
      ${kpi('Fotos', p.photoCount !== undefined ? `${p.photoCount}${p.photoCountIsEstimate ? '+' : ''}` : '—', p.photoCountIsEstimate ? 'visibles en la ficha' : undefined)}
      ${kpi('Sitio web', !p.website ? 'No tiene' : w?.isSocialOrDirectory ? 'Red social' : w?.reachable ? formatMs(w.loadTimeMs) : 'No carga', w?.reachable && !w.isSocialOrDirectory ? 'tiempo de carga' : undefined)}
    </div>
    <div class="rp-areas">
      ${a.scores.map((s) => `<div class="rp-area-row"><div class="rp-area-name">${esc(s.label)}</div>
        <div class="rp-bar"><div class="rp-bar-fill ${scoreClass(s.score)}" style="width:${s.score}%"></div></div>
        <div class="rp-area-score">${s.score}</div><div class="rp-area-summary">${esc(s.summary)}</div></div>`).join('')}
    </div>
  </section>

  <section class="rp-section">
    <h2><span>2</span> Problemas encontrados <small>${a.findings.length}</small></h2>
    ${a.findings.length ? `<ul class="rp-findings">${a.findings.map(findingItem).join('')}</ul>` : '<p>No se detectaron problemas relevantes.</p>'}
  </section>

  <section class="rp-section">
    <h2><span>3</span> Oportunidades detectadas</h2>
    <ul class="rp-opps">
      ${a.opportunities.map((o) => `<li><strong>${esc(o.title)}</strong><span class="rp-area">${esc(AREA_LABEL[o.area] ?? o.area)}</span><p>${esc(o.detail)}</p></li>`).join('')}
    </ul>
    <div class="rp-qr ${a.qr.recommended ? 'is-on' : ''}">
      <div class="rp-qr-text">
        <h3>Sistema QR de reseñas: ${a.qr.recommended ? `<em>recomendado (urgencia ${esc(a.qr.urgency)})</em>` : 'opcional'}</h3>
        <ul>${a.qr.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <p class="rp-qr-how">Cómo funciona: el cliente escanea el QR → valora en una página propia → <strong>5★</strong> lo lleva a dejar la reseña en Google Maps; <strong>1-4★</strong> deja su comentario en privado para el negocio.</p>
        ${opts.qrPageUrl ? `<p class="rp-qr-demo">Demo para este negocio: <a href="${esc(opts.qrPageUrl)}" target="_blank" rel="noopener">${esc(opts.qrPageUrl)}</a></p>` : ''}
      </div>
      ${opts.qrImage ? `<img class="rp-qr-img" src="${opts.qrImage}" alt="QR de demostración"/>` : ''}
    </div>
  </section>

  <section class="rp-section">
    <h2><span>4</span> Servicios recomendados <span class="rp-h2-sep">·</span> <span>5</span> Prioridad</h2>
    <div class="rp-services">
      ${proposal.services.map((s) => `<div class="rp-service prio-${s.priority}">
        <div class="rp-service-head"><h3>${esc(s.name)}</h3><span class="rp-prio prio-${s.priority}">${PRIORITY_LABEL[s.priority]}</span></div>
        <div class="rp-fit"><div class="rp-bar"><div class="rp-bar-fill ${s.priority === 'alta' ? 'bad' : s.priority === 'media' ? 'warn' : 'good'}" style="width:${s.fitScore}%"></div></div><span>Encaje ${s.fitScore}%</span></div>
        <ul>${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <p class="rp-impact">${esc(s.expectedImpact)}</p>
      </div>`).join('')}
    </div>
  </section>

  <section class="rp-section">
    <h2><span>6</span> Potencial de mejora</h2>
    <div class="rp-potential">
      <div class="rp-potential-level">${esc(proposal.potential.level)}</div>
      <div class="rp-potential-bars">
        <div class="rp-area-row"><div class="rp-area-name">Hoy</div><div class="rp-bar"><div class="rp-bar-fill ${scoreClass(proposal.potential.currentScore)}" style="width:${proposal.potential.currentScore}%"></div></div><div class="rp-area-score">${proposal.potential.currentScore}</div></div>
        <div class="rp-area-row"><div class="rp-area-name">Con mejoras</div><div class="rp-bar"><div class="rp-bar-fill good" style="width:${proposal.potential.projectedScore}%"></div></div><div class="rp-area-score">${proposal.potential.projectedScore}</div></div>
      </div>
      <p>${esc(proposal.potential.explanation)}</p>
    </div>
  </section>

  <section class="rp-section">
    <h2><span>7</span> Mensaje comercial para WhatsApp</h2>
    <pre class="rp-message">${esc(proposal.whatsappMessage)}</pre>
  </section>

  <section class="rp-section rp-break">
    <h2>Datos extraídos de Google Maps</h2>
    <table class="rp-table">
      ${row('Nombre', p.name)}
      ${row('Categoría', p.category)}
      ${row('Dirección', p.address)}
      ${row('Teléfono', p.phone)}
      ${row('Sitio web', p.website, true)}
      ${row('Horarios', hours)}
      ${row('Descripción', p.description)}
      ${row('Reservas', p.hasBooking ? p.bookingUrl ?? 'Botón de reserva disponible' : undefined)}
      ${row('Menú / carta', p.menuUrl, true)}
      ${row('Servicios y atributos', p.services.length ? p.services.slice(0, 25).join(' · ') : undefined)}
      ${row('Publicaciones', p.posts.length ? `${p.posts.length} detectada(s)${a.metrics.daysSinceLastPost !== undefined ? `, la última hace ~${a.metrics.daysSinceLastPost} días` : ''}` : undefined)}
      ${row('Ficha reclamada', p.isClaimed === undefined ? 'Sin determinar' : p.isClaimed ? 'Sí' : 'No')}
      ${row('Redes sociales', p.socialLinks.length ? p.socialLinks.join(' · ') : undefined)}
    </table>
    ${w && w.reachable && !w.isSocialOrDirectory ? `<h3>Sitio web</h3><table class="rp-table">
      ${row('URL final', w.finalUrl, true)}
      ${row('Título', w.title)}
      ${row('Puntuaciones', `Visual ${w.scores.visual} · Móvil ${w.scores.mobile} · Velocidad ${w.scores.speed} · Contacto ${w.scores.contact}`)}
      ${row('Carga', `${formatMs(w.loadTimeMs)}${w.pageWeightKb ? ` · ${(w.pageWeightKb / 1024).toFixed(1)} MB` : ''}${w.requestCount ? ` · ${w.requestCount} peticiones` : ''}`)}
      ${row('WhatsApp', w.whatsapp.hasLink ? `Sí${w.whatsapp.hasFloatingButton ? ' (botón flotante)' : ''}` : 'No')}
      ${row('Reservas online', w.booking.hasOnlineBooking ? w.booking.providers.join(', ') || 'Sí' : 'No')}
      ${row('Chat / bot', w.hasChatWidget ? w.chatProviders.join(', ') : 'No')}
      ${row('Contacto', [w.contact.phoneLinks.length && 'teléfono clicable', w.contact.emailLinks.length && 'email', w.contact.hasContactForm && 'formulario', w.contact.hasAddress && 'dirección'].filter(Boolean).join(', ') || undefined)}
    </table>` : ''}
  </section>

  ${report.screenshots.length ? `<section class="rp-section rp-break">
    <h2>Capturas</h2>
    <div class="rp-shots">${report.screenshots.map((s) => `<figure class="${s.source === 'website-mobile' ? 'is-mobile' : ''}"><img src="${opts.imageSrc(s)}" alt="${esc(s.label)}" loading="lazy"/><figcaption>${esc(s.label)}</figcaption></figure>`).join('')}</div>
  </section>` : ''}

  ${p.warnings.length ? `<section class="rp-section rp-notes"><h2>Notas del análisis</h2><ul>${p.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
  <footer class="rp-footer">Informe generado automáticamente a partir de información pública de Google Maps y del sitio web del negocio. Las métricas basadas en muestras (frecuencia y respuesta a reseñas) son orientativas.</footer>
</article>`;
}

export const REPORT_CSS = String.raw`
.rp{--ink:#14161f;--muted:#5d6475;--line:#e6e8ef;--soft:#f6f7fb;--brand:#5b5bf6;--good:#16a34a;--warn:#d97706;--bad:#dc2626;
  color:var(--ink);background:#fff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5;font-size:14px;max-width:1000px;margin:0 auto;padding:36px 40px;border-radius:18px}
.rp h1{font-size:30px;margin:4px 0 6px;letter-spacing:-.02em}
.rp h2{font-size:19px;margin:0 0 14px;display:flex;align-items:center;gap:10px;letter-spacing:-.01em}
.rp h2>span:not(.rp-h2-sep){display:inline-grid;place-items:center;width:26px;height:26px;border-radius:8px;background:var(--brand);color:#fff;font-size:13px}
.rp h2 small{background:var(--soft);border:1px solid var(--line);border-radius:999px;padding:1px 10px;font-size:12px;color:var(--muted)}
.rp-h2-sep{color:var(--muted)}
.rp h3{font-size:15px;margin:0 0 8px}
.rp-header{display:flex;justify-content:space-between;align-items:center;gap:24px;padding-bottom:22px;border-bottom:1px solid var(--line);margin-bottom:24px}
.rp-eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:var(--brand);font-weight:700}
.rp-meta{color:var(--muted)}
.rp-header-score{text-align:center}
.rp-gauge-caption{font-size:12px;color:var(--muted);margin-top:-4px}
.rp-gauge-bg{fill:none;stroke:var(--soft);stroke-width:12}
.rp-gauge-fg{fill:none;stroke-width:12;stroke-linecap:round}
.rp-gauge.good .rp-gauge-fg{stroke:var(--good)}.rp-gauge.warn .rp-gauge-fg{stroke:var(--warn)}.rp-gauge.bad .rp-gauge-fg{stroke:var(--bad)}
.rp-gauge-num{font-size:30px;font-weight:800;fill:var(--ink)}.rp-gauge-sub{font-size:12px;fill:var(--muted)}
.rp-section{margin:0 0 30px;break-inside:auto}
.rp-lead{font-size:15px;background:var(--soft);border-left:4px solid var(--brand);padding:14px 16px;border-radius:0 12px 12px 0;margin:0 0 16px}
.rp-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px}
.rp-kpi{border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.rp-kpi-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.rp-kpi-value{font-size:20px;font-weight:800}
.rp-kpi-hint{font-size:11px;color:var(--muted)}
.rp-area-row{display:grid;grid-template-columns:110px 1fr 36px;gap:10px;align-items:center;margin:6px 0}
.rp-area-summary{grid-column:2/4;font-size:12px;color:var(--muted);margin-top:-4px}
.rp-area-name{font-weight:600;font-size:13px}.rp-area-score{font-weight:800;text-align:right}
.rp-bar{height:10px;background:var(--soft);border-radius:99px;overflow:hidden;border:1px solid var(--line)}
.rp-bar-fill{height:100%;border-radius:99px}.rp-bar-fill.good{background:var(--good)}.rp-bar-fill.warn{background:var(--warn)}.rp-bar-fill.bad{background:var(--bad)}
.rp-findings,.rp-opps{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.rp-finding{display:grid;grid-template-columns:72px 1fr;gap:12px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;break-inside:avoid}
.rp-finding.sev-critical{border-color:#fecaca;background:#fff7f7}
.rp-finding-title{font-weight:700}.rp-finding-detail{color:var(--muted)}
.rp-evidence{font-size:12px;color:var(--muted);background:var(--soft);border-radius:6px;padding:4px 8px;margin-top:4px}
.rp-badge{font-size:11px;font-weight:700;border-radius:6px;padding:3px 0;text-align:center;height:fit-content}
.rp-badge.sev-critical{background:var(--bad);color:#fff}.rp-badge.sev-high{background:#fee2e2;color:#991b1b}
.rp-badge.sev-medium{background:#fef3c7;color:#92400e}.rp-badge.sev-low{background:#e0f2fe;color:#075985}
.rp-area{font-size:11px;font-weight:600;color:var(--brand);background:#eef0ff;border-radius:6px;padding:1px 7px;margin-left:6px;white-space:nowrap}
.rp-opps li{border:1px dashed #c7c9f9;border-radius:12px;padding:10px 12px;background:#fafaff;break-inside:avoid}
.rp-opps p{margin:4px 0 0;color:var(--muted)}
.rp-qr{display:flex;gap:18px;align-items:center;margin-top:14px;border:1px solid var(--line);border-radius:14px;padding:16px;background:var(--soft);break-inside:avoid}
.rp-qr.is-on{border-color:#c7c9f9;background:linear-gradient(135deg,#f5f5ff,#fff)}
.rp-qr em{color:var(--brand);font-style:normal}
.rp-qr ul{margin:0 0 8px;padding-left:18px}.rp-qr-how{margin:0;font-size:13px}.rp-qr-demo{font-size:12px;margin:6px 0 0}
.rp-qr-img{width:130px;height:130px;border-radius:10px;background:#fff;padding:6px;border:1px solid var(--line)}
.rp-services{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.rp-service{border:1px solid var(--line);border-radius:14px;padding:14px;break-inside:avoid}
.rp-service.prio-alta{border-color:#c7c9f9;box-shadow:0 0 0 3px #eef0ff}
.rp-service-head{display:flex;justify-content:space-between;gap:8px;align-items:start}
.rp-service ul{margin:8px 0;padding-left:18px;color:var(--muted)}
.rp-prio{font-size:11px;font-weight:700;border-radius:99px;padding:3px 10px;white-space:nowrap}
.rp-prio.prio-alta{background:var(--brand);color:#fff}.rp-prio.prio-media{background:#fef3c7;color:#92400e}.rp-prio.prio-baja{background:var(--soft);color:var(--muted)}
.rp-fit{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;font-size:12px;color:var(--muted)}
.rp-impact{margin:0;font-weight:600;font-size:13px}
.rp-potential{border:1px solid var(--line);border-radius:14px;padding:16px;break-inside:avoid}
.rp-potential-level{font-size:22px;font-weight:800;color:var(--brand)}
.rp-message{white-space:pre-wrap;font-family:inherit;background:#e7fbe9;border:1px solid #b7ebc0;border-radius:14px;padding:16px;margin:0;font-size:14px}
.rp-table{width:100%;border-collapse:collapse;margin-bottom:16px}
.rp-table th{text-align:left;width:170px;color:var(--muted);font-weight:600;vertical-align:top}
.rp-table th,.rp-table td{padding:7px 8px;border-bottom:1px solid var(--line);font-size:13px;word-break:break-word}
.rp-missing{color:var(--bad);font-weight:600}
.rp-shots{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.rp-shots figure{margin:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;break-inside:avoid;background:var(--soft)}
.rp-shots figure.is-mobile img{max-height:520px;object-fit:contain;object-position:top}
.rp-shots img{width:100%;display:block}
.rp-shots figcaption{font-size:12px;padding:6px 10px;color:var(--muted)}
.rp-notes{font-size:12px;color:var(--muted)}
.rp-footer{border-top:1px solid var(--line);padding-top:12px;font-size:11px;color:var(--muted)}
.rp a{color:var(--brand)}
@media screen and (max-width:760px){.rp{padding:20px 16px}.rp-kpis{grid-template-columns:repeat(2,1fr)}.rp-services,.rp-shots{grid-template-columns:1fr}.rp-header{flex-direction:column;align-items:flex-start}.rp-qr{flex-direction:column;align-items:flex-start}}
@media print{.rp{padding:0;max-width:none;border-radius:0}.rp-break{break-before:page}}
`;

export function renderStandaloneHtml(report: AuditReport, opts: RenderOptions): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Auditoría · ${esc(report.profile.name ?? report.id)}</title><style>${REPORT_CSS}
@page{size:A4;margin:14mm 12mm}body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head>
<body>${renderReportBody(report, opts)}</body></html>`;
}
