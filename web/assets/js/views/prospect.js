import { api } from '../api.js';
import {
  $, $$, IMP, autoGrow, confirmDialog, modal, copyText, date, dateTime, esc, icon, money, moneyShort, number, scoreClass,
  statusLabel, statusOptions, toast, waLink,
} from '../ui.js';

function ring(score) {
  const r = 48;
  const c = 2 * Math.PI * r;
  const color = score >= 70 ? 'var(--green)' : score >= 45 ? 'var(--warn)' : 'var(--danger)';
  return `<div class="ring" role="img" aria-label="Score ${score} de 100">
    <svg width="112" height="112" viewBox="0 0 112 112"><circle cx="56" cy="56" r="${r}" fill="none" stroke="rgba(248,248,248,.07)" stroke-width="9"/>
    <circle cx="56" cy="56" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - score / 100)).toFixed(1)}"/></svg>
    <div class="v"><div><b class="num">${score}</b><small>de 100</small></div></div></div>`;
}

const fact = (label, value) => `<div class="fact"><small>${esc(label)}</small><div>${value ? esc(value) : '<span class="missing">No tiene / no detectado</span>'}</div></div>`;

function summaryCard(p) {
  const a = p.analysis ?? {};
  const prof = a.profile ?? {};
  const w = a.website;
  const metrics = a.audit?.metrics ?? {};
  const days = prof.hours ? Object.keys(prof.hours.days ?? {}).length : 0;
  const web = !prof.website ? '' : w?.isSocialOrDirectory ? 'Red social / directorio' : w?.reachable
    ? `Carga en ${Math.max(0.1, (w.loadTimeMs ?? 0) / 1000).toFixed(1).replace('.', ',')} s · ${w.mobile?.hasViewportMeta ? 'adaptada a móvil' : 'no adaptada a móvil'}`
    : 'No carga';
  return `<section class="card" id="resumen">
    <div class="card-head"><h2>Resumen</h2><span class="sub">Analizado el ${esc(date(p.analyzedAt))}</span></div>
    <div class="summary">
      ${ring(p.score)}
      <div class="area-rows">${p.areaScores.map((s) => `
        <div class="area-row"><span>${esc(s.label)}</span><span class="bar ${scoreClass(s.score)}"><i style="width:${s.score}%"></i></span><b class="num" style="text-align:right">${s.score}</b></div>`).join('')}
      </div>
    </div>
    <div class="facts">
      ${fact('Calificación', p.rating != null ? `${String(p.rating).replace('.', ',')} ★${p.reviewCount != null ? ` · ${number(p.reviewCount)} reseñas` : ''}` : p.reviewCount === 0 ? 'Sin reseñas' : '')}
      ${fact('Respuesta a reseñas', metrics.ownerResponseRate != null ? `${Math.round(metrics.ownerResponseRate * 100)}% de las recientes` : '')}
      ${fact('Teléfono', p.phone)}
      ${fact('Dirección', p.address)}
      ${fact('Sitio web', web)}
      ${fact('Horarios', days ? `${days} de 7 días publicados` : prof.hours?.raw ?? '')}
      ${fact('Reservas', prof.hasBooking ? 'Botón de reserva en Maps' : '')}
      ${fact('Ficha reclamada', prof.isClaimed === undefined ? 'Sin determinar' : prof.isClaimed ? 'Sí' : 'No')}
    </div>
  </section>`;
}

const DQ_STATUS = { encontrado: 'Encontrado', cero: 'Valor real 0', no_encontrado: 'No encontrado', error: 'Error de extracción' };
const verifiedPoint = (d) => (d.status === 'encontrado' || d.status === 'cero') && d.confidence !== 'baja';

/** Confiabilidad del dato: valor, estado, confianza, fuente y método de cada dato leído de Maps. */
function reliabilityCard(p) {
  const prof = p.analysis?.profile ?? {};
  const dq = prof.dataQuality;
  if (!dq) {
    return `<section class="card" id="datos"><div class="card-head"><h2>Confiabilidad del dato</h2></div>
      <p class="muted">Este análisis es anterior al control de confiabilidad. Reanalizá el negocio para ver de dónde sale cada dato.</p></section>`;
  }
  const rows = Object.values(dq.fields);
  const ok = rows.filter(verifiedPoint).length;
  const unverified = p.analysis?.audit?.unverified ?? [];
  const labelOf = (f) => dq.fields[f]?.label ?? f;
  return `<section class="card" id="datos">
    <div class="card-head"><h2>Confiabilidad del dato</h2><span class="sub">${ok} de ${rows.length} verificados</span></div>
    ${dq.blocked ? '<div class="alert warn"><div><b>Google bloqueó la lectura</b><div class="muted">Los datos de este análisis no son confiables.</div></div></div>' : ''}
    <p class="muted dq-intro">Solo los datos <b>verificados</b> (encontrados o con valor real 0, con confianza alta o media) se usan para afirmar problemas y armar argumentos.</p>
    <div class="table-wrap"><table class="table dq">
      <thead><tr><th>Dato</th><th>Valor obtenido</th><th>Estado</th><th>Confianza</th><th>Fuente y método</th></tr></thead>
      <tbody>${rows.map((d) => `
        <tr class="${verifiedPoint(d) ? '' : 'dq-off'}">
          <td><b>${esc(d.label)}</b></td>
          <td class="dq-val">${esc(d.value)}</td>
          <td><span class="dq-st dq-${d.status}">${esc(DQ_STATUS[d.status] ?? d.status)}</span></td>
          <td><span class="dq-conf dq-${d.confidence}">${esc(d.confidence)}</span></td>
          <td><div>${esc(d.source)}</div><div class="faint">${esc(d.method)}</div>${d.note ? `<div class="faint">${esc(d.note)}</div>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>
    ${unverified.length ? `<div class="dq-unverified"><div class="label">No se afirman (dato sin verificar)</div>
      <ul>${unverified.map((u) => `<li>${esc(u.title)} <span class="faint">· falta verificar: ${esc(u.fields.map(labelOf).join(', '))}</span></li>`).join('')}</ul></div>` : ''}
  </section>`;
}

const basisLine = (a) => a.basis?.length
  ? `<div class="basis">${icon('check', 'width="13" height="13"')}Dato verificado: ${a.basis.map((b) => `<b>${esc(b.label)}</b> ${esc(b.value)} <span class="faint">(confianza ${esc(b.confidence)} · ${esc(b.source)})</span>`).join(' · ')}</div>`
  : '';

const LEVEL = {
  confirmado: '<span class="lvl lvl-ok" title="Dato verificado en todos los canales: se puede usar en el mensaje">Confirmado</span>',
  probable: '<span class="lvl lvl-maybe" title="No se pudo verificar en todos los canales: revisalo antes de usarlo. No va en el mensaje">Probable</span>',
};

function problemsCard(p) {
  const used = new Set((p.messageSelection ?? []).map((x) => x.findingId));
  const contradicted = p.analysis?.audit?.contradicted ?? [];
  return `<section class="card" id="problemas">
    <div class="card-head"><h2>Problemas encontrados</h2><span class="sub">${p.problems.length} · ${p.highImpactCount} de impacto alto</span></div>
    <div class="list-gap">${p.problems.length ? p.problems.map((a) => `
      <article class="problem ${IMP[a.impact]} ${a.level === 'probable' ? 'is-probable' : ''}">
        <div class="problem-head"><div><div class="label">Problema detectado ${a.level ? LEVEL[a.level] ?? '' : ''} ${used.has(a.findingId) ? '<span class="lvl lvl-msg" title="Este problema se usa en el mensaje de primer contacto">En el mensaje</span>' : ''}</div><h4>${esc(a.problem)}</h4></div><span class="imp imp-${IMP[a.impact]}">${esc(a.impact)}</span></div>
        ${a.level === 'probable' && a.levelNote ? `<div class="lvl-note">${icon('bell', 'width="13" height="13"')}Para revisar: ${esc(a.levelNote)}</div>` : ''}
        <div class="label">Motivo</div><p>${esc(a.reason)}</p>
        <div class="problem-grid">
          <div><div class="label">Servicio recomendado</div><div class="svc">${esc(a.service)}</div></div>
          <div class="benefit"><div class="label">Beneficio para el cliente</div><p>${esc(a.benefit)}</p></div>
        </div>
        ${basisLine(a)}
      </article>`).join('') : '<p class="muted">No se detectaron problemas relevantes.</p>'}
    </div>
    ${contradicted.length ? `<div class="dq-unverified"><div class="label">Descartados: el negocio ya lo tiene</div>
      <ul>${contradicted.map((c) => `<li>${esc(c.title)} <span class="faint">· ${esc(c.reason)}</span></li>`).join('')}</ul></div>` : ''}
  </section>`;
}

const CH_ICON = { encontrado: ['✓', 'ch-ok', 'Encontrado'], no_encontrado: ['✗', 'ch-no', 'No encontrado'], no_verificado: ['?', 'ch-unk', 'No verificado'] };
const shortUrl = (u) => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 48);

/** Canales encontrados: Google Maps, web, Instagram, WhatsApp, Facebook, reservas y otros links. */
function channelsCard(p) {
  const ch = p.analysis?.channels;
  const ig = ch?.instagram;
  return `<section class="card" id="canales">
    <div class="card-head"><h2>Canales encontrados</h2>
      <button class="btn btn-sm" id="verify">${icon('refresh')}Verificar presencia online</button></div>
    ${!ch ? '<p class="muted" style="margin:0">Este análisis es anterior a la verificación de canales. Tocá <b>Verificar presencia online</b> para revisar web, Instagram, WhatsApp y reservas antes de contactar.</p>' : `
    <div class="ch-list">${ch.channels.map((c) => {
      const [sym, cls, txt] = CH_ICON[c.status] ?? CH_ICON.no_verificado;
      const link = c.url && /^https?:\/\//.test(c.url) ? `<a href="${esc(c.url)}" target="_blank" rel="noopener" class="gen-link">${esc(shortUrl(c.url))}</a>` : '';
      return `<div class="ch-row" data-ch="${esc(c.id)}">
        <span class="ch-sym ${cls}" title="${txt}">${sym}</span>
        <div class="ch-main"><b>${esc(c.label)}</b> <span class="faint">${txt}${c.sources?.length ? ` · ${esc(c.sources.join(', '))}` : ''}</span>
          ${link || c.detail ? `<div class="ch-detail">${link}${link && c.detail ? ' · ' : ''}${c.detail ? esc(c.detail) : ''}</div>` : ''}</div>
      </div>`;
    }).join('')}</div>
    ${ch.review?.length ? `<div class="alert warn" style="margin:12px 0 0"><span class="alert-icon">${icon('bell')}</span><div><b>Requiere revisión</b><ul class="ch-review">${ch.review.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div></div>` : ''}
    ${ig?.instagram_notes?.length ? `<p class="faint" style="font-size:12px;margin:10px 0 0">Instagram: ${esc(ig.instagram_notes.join(' '))}</p>` : ''}
    <p class="faint" style="font-size:12px;margin:10px 0 0">Revisado: ${esc(dateTime(ch.checkedAt))} · "No verificado" no significa que no exista: no se pudo comprobar.</p>`}
  </section>`;
}

function servicesCard(p) {
  return `<section class="card" id="servicios">
    <div class="card-head"><h2>Servicios recomendados</h2><span class="sub">Ordenados por encaje</span></div>
    <div class="grid grid-2">${p.services.map((s) => `
      <div class="service ${s.priority}">
        <div class="service-head"><h4>${esc(s.name)}</h4><span class="prio prio-${s.priority}">${esc(s.priority)}</span></div>
        <div class="area-row" style="grid-template-columns:auto 1fr 40px"><span class="faint" style="font-size:12px">Encaje</span><span class="bar"><i style="width:${s.fitScore}%"></i></span><b class="num" style="text-align:right;font-size:12px">${s.fitScore}%</b></div>
        ${(s.solves?.length ? s.solves : s.reasons).length ? `<div class="label" style="margin-top:10px">Resuelve</div><ul>${(s.solves?.length ? s.solves : s.reasons).slice(0, 5).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        <div class="impact">${esc(s.expectedImpact)}</div>
      </div>`).join('')}
    </div></section>`;
}

function plan(o, featured) {
  if (!o) return '';
  return `<div class="plan ${featured ? 'featured' : ''}">
    <h4>${esc(o.label)}</h4><div class="desc">${esc(o.description)}</div>
    ${o.items.length ? `<ul>${o.items.map((i) => `<li><span>${esc(i.name)}</span><span class="num">${money(i.setup)}${i.monthly ? ` + ${money(i.monthly)}/mes` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">Sin servicios.</p>'}
    <div class="tot grand"><span>Pago inicial</span><b class="num">${o.discountPct ? `<span class="strike">${money(o.setup)}</span>` : ''}${money(o.setupAfterDiscount)}</b></div>
    <div class="tot month"><span class="muted">Abono mensual</span><b class="num">${o.monthly ? `${money(o.monthly)}/mes` : 'Sin abono'}</b></div>
    ${o.discountPct ? `<div class="faint" style="font-size:12px;margin-top:6px">Incluye ${o.discountPct}% de descuento${o.label === 'Presupuesto personalizado' ? '' : ' por paquete'}.</div>` : ''}
  </div>`;
}

function budgetCard(p) {
  const b = p.budget;
  return `<section class="card" id="presupuesto">
    <div class="card-head"><h2>Presupuesto</h2>
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
        ${b.custom ? `<span class="badge gen-new budget-custom">Personalizado</span><button class="btn btn-sm btn-ghost" id="budget-reset">${icon('refresh')}Volver al automático</button>` : '<span class="sub">Con los servicios y precios de Configuración</span>'}
        <button class="btn btn-sm" id="budget-edit">${icon('edit')}Personalizar</button>
      </div></div>
    <div class="plans">${plan(b.recommended, true)}${plan(b.complete, false)}</div>
    ${b.note ? `<p class="faint" style="font-size:12px;margin:12px 0 0">${esc(b.note)}</p>` : ''}
  </section>`;
}

/** Modal "Personalizar presupuesto": elegir servicios (incluidos los propios) y ajustar precios para este cliente. */
function budgetEditor(p) {
  const current = new Map((p.budgetOverride?.items ?? p.budget.recommended?.items ?? []).map((i) => [i.id, i]));
  const rows = (p.catalog ?? []).map((c) => {
    const cur = current.get(c.id);
    const on = !!cur;
    return `<div class="bo-row ${on ? '' : 'off'}" data-bo="${esc(c.id)}">
      <input type="checkbox" class="check" data-on ${on ? 'checked' : ''} aria-label="Incluir ${esc(c.name)}">
      <div class="bo-name">${esc(c.name)}${c.builtIn ? '' : ' <span class="badge svc-tag">Propio</span>'}${c.description ? `<small>${esc(c.description)}</small>` : ''}</div>
      <label class="svc-price">Pago inicial<input class="input num right" data-k="setup" type="number" min="0" step="1000" value="${cur?.setup ?? c.setup ?? 0}"></label>
      <label class="svc-price">Abono mensual<input class="input num right" data-k="monthly" type="number" min="0" step="1000" value="${cur?.monthly ?? c.monthly ?? 0}"></label>
    </div>`;
  }).join('');
  const discount = p.budgetOverride?.discountPct ?? p.budget.recommended?.discountPct ?? 0;
  return `<h2>Personalizar presupuesto</h2>
    <p>Elegí los servicios y los precios para <b>${esc(p.name)}</b>. Reemplaza al plan recomendado automático y se conserva aunque reanalices el negocio.</p>
    <form class="stack" id="bo-form" style="gap:10px">
      <div class="svc-list">${rows || '<p class="muted">No hay servicios activos. Agregalos en Configuración → Servicios y precios.</p>'}</div>
      <label class="field" style="max-width:220px">Descuento (%)<input class="input num" name="discount" type="number" min="0" max="90" value="${discount}"></label>
      <div class="bo-sum" id="bo-sum"></div>
      <div class="error-text" id="bo-err"></div>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn btn-primary">${icon('check')}Guardar presupuesto</button></div>
    </form>`;
}

function valueCard(p) {
  const b = p.budget;
  const rec = b.recommended ?? {};
  return `<section class="card">
    <div class="card-head"><h2>Potencial económico</h2></div>
    <div class="money-big num">${esc(money(p.potentialValue))}</div>
    <div class="faint" style="font-size:12px;margin-bottom:12px">Pago inicial · ${b.custom ? 'presupuesto personalizado' : 'plan recomendado'}${rec.monthly ? ` · + ${esc(money(rec.monthly))}/mes de abono` : ''}</div>
    <div class="kv"><span>Abono mensual ${b.custom ? 'del presupuesto' : 'recomendado'}</span><b class="num">${rec.monthly ? `${esc(money(rec.monthly))}/mes` : 'Sin abono'}</b></div>
    <div class="kv"><span>Plan completo</span><b class="num">${esc(money(b.complete?.setupAfterDiscount ?? p.projectTotal))}${b.complete?.monthly ? ` + ${esc(money(b.complete.monthly))}/mes` : ''}</b></div>
    <div class="kv" style="align-items:center"><span>Valor cerrado</span>
      ${p.status === 'cliente'
        ? `<input class="input num" id="closed" type="number" min="0" step="1000" value="${p.closedValue ?? p.potentialValue}" style="width:150px;text-align:right">`
        : '<span class="faint">Se completa al pasar a Cliente</span>'}
    </div>
  </section>`;
}

/** Número de WhatsApp CONFIRMADO (de un enlace de WhatsApp o del contacto de Instagram). */
const confirmedWa = (p) => p.analysis?.channels?.whatsappNumber;
const igUrl = (p) => p.analysis?.channels?.instagramUrl;

function selectionHtml(sel) {
  if (!sel?.length) return '<div class="msg-sel muted">No hay problemas confirmados para usar: el mensaje no inventa ninguno. Revisá los "Probables" o verificá la presencia online.</div>';
  return `<div class="msg-sel"><div class="label">El mensaje usa (solo confirmados)</div><ol>${sel.map((x) => `<li>${esc(x.text.split(/(?<=\.)\s/)[0])}</li>`).join('')}</ol></div>`;
}

function messagesCard(p) {
  const wa = confirmedWa(p);
  const ig = igUrl(p);
  return `<section class="card" id="mensajes">
    <div class="card-head"><h2>Mensaje de contacto</h2>
      <button class="btn btn-sm" id="regen" title="Generar otra versión de este mensaje">${icon('refresh')}Otra versión</button></div>
    <div id="msg-sel">${selectionHtml(p.messageSelection)}</div>
    <div class="tabs" role="tablist">
      <button class="on" data-msg="primerContacto">1er contacto</button>
      <button data-msg="primerContactoCorto">Corto</button>
      <button data-msg="seguimiento">Seguimiento</button>
    </div>
    <textarea class="textarea wa-text" id="msg" aria-label="Mensaje de contacto (editable)"></textarea>
    <p class="faint msg-hint" id="msg-hint">Podés editarlo antes de enviarlo. Si no te gusta, tocá "Otra versión".</p>
    <div class="btn-row contact-row">
      <a class="btn btn-sm ${wa ? 'btn-wa' : ''}" id="wa" target="_blank" rel="noopener">${icon(wa ? 'message' : 'external')}${wa ? 'Contactar por WhatsApp' : 'Abrir WhatsApp'}</a>
      ${ig ? `<a class="btn btn-sm" id="ig" href="${esc(ig)}" target="_blank" rel="noopener">${icon('external')}Abrir Instagram</a>` : ''}
      <button class="btn btn-sm" id="copy">${icon('copy')}Copiar mensaje</button>
      <button class="btn btn-sm btn-primary" id="sent">${icon('check')}Registrar envío</button>
    </div>
    ${wa
      ? `<p class="faint contact-note">WhatsApp +${esc(wa)}, encontrado en ${esc(p.analysis.channels.whatsappSource ?? 'sus canales')}. Se abre con el mensaje cargado: no se envía solo.</p>`
      : p.phone && !/^(\+|00)/.test(p.phone.trim()) ? '<p class="faint contact-note">No se encontró un WhatsApp confirmado y el teléfono de Google no tiene prefijo internacional: WhatsApp se abre sin destinatario.</p>' : ''}
    ${ig ? '<p class="faint contact-note">Instagram: abrí el perfil y pegá el mensaje en un mensaje directo ("Copiar mensaje").</p>' : ''}
  </section>`;
}

function notesCard(p) {
  return `<section class="card">
    <div class="card-head"><h2>Notas internas</h2><span class="save-state" id="save-state">Se guardan solas</span></div>
    <textarea class="textarea" id="notes" rows="6" placeholder="Quién atiende, qué le interesa, objeciones, próximos pasos…">${esc(p.notes)}</textarea>
  </section>`;
}

/** Valor por defecto del próximo contacto: mañana a las 10:00 (hora local, formato datetime-local). */
function defaultDue() {
  const d = new Date(Date.now() + 86_400_000);
  d.setHours(10, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function followupsCard(p) {
  const pending = p.followups.filter((f) => f.status === 'pendiente');
  const closed = p.followups.filter((f) => f.status !== 'pendiente').slice(0, 5);
  const when = (f) => new Date(f.dueAt).toLocaleString('es-AR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<section class="card" id="seguimiento">
    <div class="card-head"><h2>Próximo contacto</h2><span class="sub">${pending.length ? `${pending.length} pendiente${pending.length === 1 ? '' : 's'}` : 'Sin seguimientos'}</span></div>
    <form class="fu-form" id="fu-form">
      <div class="row">
        <input class="input" type="datetime-local" id="fu-date" value="${defaultDue()}" required aria-label="Fecha y hora">
        <button class="btn btn-sm" type="submit" style="height:36px">${icon('bell')}Agendar</button>
      </div>
      <input class="input" id="fu-note" maxlength="1000" placeholder="Recordatorio: ej. llamar para cerrar presupuesto">
    </form>
    <div>${pending.map((f) => `
      <div class="fu">
        <span class="when ${f.overdue ? 'overdue' : ''}">${esc(f.overdue ? `Vencido · ${when(f)}` : when(f))}</span>
        <div class="what">${esc(f.note || 'Contactar')}${f.userName ? ` <span class="faint">· ${esc(f.userName)}</span>` : ''}</div>
        <button class="btn btn-sm" data-fu="${f.id}" data-st="hecho" title="Marcar como hecho">${icon('check')}Hecho</button>
        <button class="icon-btn" data-fu="${f.id}" data-st="cancelado" title="Cancelar" aria-label="Cancelar seguimiento">${icon('trash')}</button>
      </div>`).join('')}
      ${closed.map((f) => `<div class="fu done"><span class="when">${f.status === 'hecho' ? 'Hecho' : 'Cancelado'}</span><div class="what">${esc(f.note || 'Contactar')} · ${esc(when(f))}</div></div>`).join('')}
    </div>
  </section>`;
}

function historyCard(p, activityTypes) {
  const label = (a) => (a.type === 'estado' ? `${statusLabel(a.fromStatus)} → ${statusLabel(a.toStatus)}` : a.label);
  return `<section class="card">
    <div class="card-head"><h2>Historial</h2><span class="sub">${p.activities.length} registro${p.activities.length === 1 ? '' : 's'}</span></div>
    <form class="add-activity" id="act-form">
      <div class="row">
        <select class="select" id="act-type">${activityTypes.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select>
        <button class="btn btn-sm" type="submit" style="height:36px">${icon('plus')}Registrar</button>
      </div>
      <textarea class="textarea" id="act-text" rows="2" placeholder="¿Qué pasó? Ej.: Llamé, atiende el dueño a la tarde."></textarea>
    </form>
    <div class="timeline">${p.activities.map((a) => `
      <div class="tl tl-${esc(a.type)}">
        <div class="tl-title">${esc(label(a))}</div>
        ${a.content ? `<div class="tl-content">${esc(a.content)}</div>` : ''}
        <div class="tl-date">${esc(dateTime(a.createdAt))}${a.userName ? ` · ${esc(a.userName)}` : ''}</div>
      </div>`).join('')}
    </div>
  </section>`;
}

export async function render(main, { id }, ctx) {
  let p = await api.prospect(id);
  let msgKey = 'primerContacto';
  // "Otra versión": versión pedida y texto generado por tipo de mensaje (se conservan al recargar el perfil).
  const variants = { primerContacto: 0, primerContactoCorto: 0, seguimiento: 0 };
  const generated = {};
  let edited = false;

  const draw = () => {
    main.innerHTML = `
      <div class="profile-head">
        <div>
          <a class="back" href="/prospectos" data-link>${icon('arrowLeft', 'width="14" height="14"')}${ctx.isAdmin ? 'Prospectos' : 'Mis prospectos'}</a>
          <h1>${esc(p.name)}</h1>
          <div class="muted">${esc([p.category, p.verticalLabel].filter(Boolean).join(' · '))}</div>
          <div class="chips">
            <a class="chip" href="${esc(p.mapsUrl)}" target="_blank" rel="noopener">${icon('map')}${esc(p.address ?? 'Ver en Google Maps')}</a>
            ${p.phone ? `<span class="chip">${icon('phone')}${esc(p.phone)}</span>` : ''}
            ${p.website ? `<a class="chip" href="${esc(p.website)}" target="_blank" rel="noopener">${icon('globe')}${esc(p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 40))}</a>` : ''}
            ${p.rating != null ? `<span class="chip">${icon('star')}${String(p.rating).replace('.', ',')}${p.reviewCount != null ? ` · ${number(p.reviewCount)} reseñas` : ''}</span>` : ''}
          </div>
        </div>
        <div class="page-actions" style="align-items:flex-start">
          ${ctx.isAdmin
            ? `<select class="select" id="assignee" aria-label="Vendedor asignado" style="min-width:170px">
                <option value="">Sin asignar</option>
                ${(ctx.meta.users ?? []).filter((u) => u.active || u.id === p.assignedUserId).map((u) => `<option value="${esc(u.id)}" ${u.id === p.assignedUserId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
              </select>`
            : `<span class="chip">${icon('users')}${esc(p.assignedUserName ?? 'Sin asignar')}</span>`}
          <select class="select" id="status" aria-label="Estado comercial" style="min-width:190px">${statusOptions(p.status)}</select>
          <button class="btn" id="reanalyze">${icon('refresh')}Reanalizar</button>
          ${ctx.isAdmin ? `<button class="btn btn-danger" id="delete" title="Eliminar prospecto">${icon('trash')}</button>` : ''}
        </div>
      </div>
      <div class="profile">
        <div>
          <nav class="subnav"><a href="#resumen">Resumen</a><a href="#problemas">Problemas (${p.problems.length})</a><a href="#servicios">Servicios</a><a href="#canales">Canales</a><a href="#presupuesto">Presupuesto</a><a href="#datos">Confiabilidad</a></nav>
          <div class="stack">${summaryCard(p)}${channelsCard(p)}${problemsCard(p)}${servicesCard(p)}${budgetCard(p)}${reliabilityCard(p)}</div>
        </div>
        <aside class="profile-side" aria-label="Seguimiento y contacto">${followupsCard(p)}${valueCard(p)}${messagesCard(p)}${notesCard(p)}${historyCard(p, ctx.meta.activityTypes)}</aside>
      </div>`;
    bind();
  };

  const showMessage = () => {
    const ta = $('#msg', main);
    ta.value = generated[msgKey] ?? p.messages[msgKey];
    edited = false;
    const hint = $('#msg-hint', main);
    if (hint) hint.textContent = variants[msgKey] ? `Versión ${variants[msgKey] + 1}. Si no te gusta, tocá "Otra versión" de nuevo.` : 'Podés editarlo antes de enviarlo. Si no te gusta, tocá "Otra versión".';
    autoGrow(ta);
    setWaHref(ta.value);
    for (const b of $$('[data-msg]', main)) b.classList.toggle('on', b.dataset.msg === msgKey);
  };
  // WhatsApp confirmado → wa.me/NÚMERO con el mensaje de ESTE prospecto; si no, el comportamiento de siempre.
  const setWaHref = (text) => {
    const wa = confirmedWa(p);
    $('#wa', main).href = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : waLink(p.phone, text);
  };

  let notesTimer;
  /** Guarda una nota pendiente (si la hay) antes de redibujar, para no perder lo escrito. */
  async function flushNotes() {
    const notes = $('#notes', main);
    if (!notesTimer || !notes) return;
    clearTimeout(notesTimer);
    notesTimer = undefined;
    if (notes.value !== p.notes) {
      const saved = await api.update(id, { notes: notes.value });
      p.notes = saved.notes;
    }
  }

  function bind() {
    for (const a of $$('.subnav a', main)) {
      a.onclick = (e) => {
        e.preventDefault();
        $(a.getAttribute('href'), main)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    }
    $('#status', main).onchange = async (e) => {
      try {
        await flushNotes();
        p = await api.update(id, { status: e.target.value });
        toast(`Estado: ${statusLabel(p.status)}`);
        draw();
      } catch (err) {
        toast(err.message, 'err');
        e.target.value = p.status;
      }
    };
    $('#reanalyze', main).onclick = () => ctx.openAnalyze(p.mapsUrl, { autostart: true });
    const assignee = $('#assignee', main);
    if (assignee) {
      assignee.onchange = async () => {
        try {
          await flushNotes();
          p = await api.update(id, { assignedUserId: assignee.value || null });
          toast(p.assignedUserName ? `Asignado a ${p.assignedUserName}` : 'Sin asignar');
          draw();
        } catch (err) {
          toast(err.message, 'err');
          assignee.value = p.assignedUserId ?? '';
        }
      };
    }

    // Seguimientos
    $('#fu-form', main).onsubmit = async (e) => {
      e.preventDefault();
      const local = $('#fu-date', main).value;
      if (!local) return;
      try {
        await flushNotes();
        await api.addFollowup(id, new Date(local).toISOString(), $('#fu-note', main).value.trim());
        p = await api.prospect(id);
        toast('Próximo contacto agendado');
        draw();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    for (const b of $$('[data-fu]', main)) {
      b.onclick = async () => {
        try {
          await flushNotes();
          await api.setFollowup(b.dataset.fu, b.dataset.st);
          p = await api.prospect(id);
          toast(b.dataset.st === 'hecho' ? 'Seguimiento completado' : 'Seguimiento cancelado');
          draw();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    }

    $('#delete', main)?.addEventListener('click', async () => {
      if (!(await confirmDialog('Eliminar prospecto', `Se borra ${p.name} con todo su historial y auditorías. No se puede deshacer.`, 'Eliminar'))) return;
      await api.remove(id);
      toast(`${p.name} eliminado`);
      ctx.navigate('/prospectos');
    });

    // Mensajes
    for (const b of $$('[data-msg]', main)) b.onclick = () => { msgKey = b.dataset.msg; showMessage(); };
    $('#msg', main).oninput = (e) => { edited = true; autoGrow(e.target); setWaHref(e.target.value); };
    $('#regen', main).onclick = async () => {
      if (edited && !(await confirmDialog('Generar otra versión', 'Vas a perder los cambios que hiciste a mano en este mensaje.', 'Generar otra'))) return;
      const btn = $('#regen', main);
      btn.disabled = true;
      try {
        const r = await api.messageVariant(id, msgKey, variants[msgKey] + 1);
        variants[msgKey] = r.variante;
        generated[msgKey] = r.texto;
        if (msgKey === 'primerContacto' && r.seleccion) $('#msg-sel', main).innerHTML = selectionHtml(r.seleccion);
        showMessage();
        const ta = $('#msg', main);
        ta.classList.remove('flash');
        void ta.offsetWidth;
        ta.classList.add('flash');
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    };
    $('#copy', main).onclick = async () => { await copyText($('#msg', main).value); toast('Mensaje copiado'); };
    $('#sent', main).onclick = async () => {
      const names = { primerContacto: 'primer contacto', primerContactoCorto: 'primer contacto (corto)', seguimiento: 'seguimiento' };
      try {
        await flushNotes();
        await api.addActivity(id, 'whatsapp', `Mensaje enviado: ${names[msgKey]}\n\n${$('#msg', main).value}`);
        if (p.status === 'sin_contactar') await api.update(id, { status: 'contactado' });
        p = await api.prospect(id);
        toast(p.status === 'contactado' ? 'Envío registrado · pasó a Contactado' : 'Envío registrado');
        draw();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    showMessage();

    // Verificar presencia online (web + Instagram + canales de contacto)
    $('#verify', main).onclick = async () => {
      const btn = $('#verify', main);
      btn.disabled = true;
      const label = btn.innerHTML;
      try {
        await api.verifyPresence(id, (ev) => { if (ev.tipo === 'progreso') btn.innerHTML = `${icon('refresh')}${esc(ev.mensaje)} ${ev.porcentaje}%`; });
        await flushNotes();
        p = await api.prospect(id);
        for (const k of Object.keys(generated)) delete generated[k];
        for (const k of Object.keys(variants)) variants[k] = 0;
        toast('Presencia online verificada: argumentos y mensaje actualizados');
        draw();
        document.getElementById('canales')?.scrollIntoView({ block: 'start' });
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
        btn.innerHTML = label;
      }
    };

    // Presupuesto personalizado
    $('#budget-edit', main).onclick = () => {
      const m = modal(budgetEditor(p));
      m.root.querySelector('.modal').classList.add('modal-wide');
      const form = $('#bo-form', m.root);
      const collect = () => $$('[data-bo]', form).filter((r) => $('[data-on]', r).checked).map((r) => ({
        id: r.dataset.bo, setup: Number($('[data-k="setup"]', r).value || 0), monthly: Number($('[data-k="monthly"]', r).value || 0),
      }));
      const sum = () => {
        for (const r of $$('[data-bo]', form)) r.classList.toggle('off', !$('[data-on]', r).checked);
        const items = collect();
        const setup = items.reduce((a, i) => a + i.setup, 0);
        const monthly = items.reduce((a, i) => a + i.monthly, 0);
        const d = Math.min(90, Math.max(0, Number(form.discount.value) || 0));
        $('#bo-sum', m.root).innerHTML = `<span>${items.length} servicio${items.length === 1 ? '' : 's'}</span><span>Pago inicial <b class="num">${money(Math.round(setup * (1 - d / 100)))}</b>${d ? ` <span class="faint">(${d}% off)</span>` : ''}</span><span>Abono <b class="num">${money(monthly)}/mes</b></span>`;
      };
      form.addEventListener('input', sum);
      form.addEventListener('change', sum);
      sum();
      $('[data-close]', m.root).onclick = () => m.close();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = $('button.btn-primary', form);
        btn.disabled = true;
        try {
          p = await api.setBudget(id, { items: collect(), discountPct: Number(form.discount.value || 0) });
          m.close();
          toast('Presupuesto personalizado guardado');
          draw();
        } catch (err) {
          $('#bo-err', m.root).textContent = err.message;
          btn.disabled = false;
        }
      };
    };
    $('#budget-reset', main)?.addEventListener('click', async () => {
      try {
        p = await api.setBudget(id, null);
        toast('Volvió al presupuesto automático');
        draw();
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    // Valor cerrado
    const closed = $('#closed', main);
    if (closed) {
      closed.onchange = async () => {
        try {
          p = await api.update(id, { closedValue: closed.value === '' ? null : Number(closed.value) });
          toast(`Valor cerrado: ${moneyShort(p.closedValue)}`);
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    }

    // Notas con guardado automático
    const notes = $('#notes', main);
    const state = $('#save-state', main);
    autoGrow(notes);
    notes.oninput = () => {
      autoGrow(notes);
      state.textContent = 'Escribiendo…';
      clearTimeout(notesTimer);
      notesTimer = setTimeout(async () => {
        notesTimer = undefined;
        try {
          const saved = await api.update(id, { notes: notes.value });
          p.notes = saved.notes;
          p.activities = saved.activities;
          state.textContent = `Guardado ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
        } catch (err) {
          state.textContent = `No se pudo guardar: ${err.message}`;
        }
      }, 700);
    };

    // Actividades
    $('#act-form', main).onsubmit = async (e) => {
      e.preventDefault();
      const text = $('#act-text', main).value.trim();
      if (!text) return $('#act-text', main).focus();
      try {
        await flushNotes();
        await api.addActivity(id, $('#act-type', main).value, text);
        p = await api.prospect(id);
        toast('Actividad registrada');
        draw();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  }

  draw();
  // Al salir del perfil, se guarda la nota pendiente.
  return () => { flushNotes().catch(() => {}); };
}
