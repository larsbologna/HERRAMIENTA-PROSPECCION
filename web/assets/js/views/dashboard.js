import { api } from '../api.js';
import { areaChart, barChart, hBars } from '../charts.js';
import { $, ago, emptyState, esc, icon, money, moneyShort, monthLabel, monthLong, number, pct, scoreHtml, statusBadge } from '../ui.js';

const kpi = (label, value, sub, iconName, accent = false) => `
  <div class="card kpi ${accent ? 'accent' : ''}">
    <div class="kpi-label">${icon(iconName)}${esc(label)}</div>
    <div class="kpi-value num">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;

/** Alerta de seguimientos pendientes (hoy y vencidos) + KPIs personales. */
function personalBlock(d, ctx) {
  const p = d.personal;
  const due = d.followupsDue ?? [];
  const count = d.followupsDueCount ?? 0;
  const overdue = due.filter((f) => f.overdue).length;
  const team = d.scope === 'equipo';
  const alert = count
    ? `<div class="alert ${overdue ? 'warn' : ''}">
        <span class="alert-icon">${icon('bell')}</span>
        <div class="grow">
          <b>${number(count)} seguimiento${count === 1 ? '' : 's'} pendiente${count === 1 ? '' : 's'}</b>
          <div class="muted" style="font-size:13px">${overdue ? `${number(overdue)} vencido${overdue === 1 ? '' : 's'} · ` : ''}${team ? 'de todo el equipo, ' : ''}para hoy o atrasados</div>
        </div>
        <a class="btn btn-sm" href="#seguimientos">Ver lista</a>
      </div>`
    : '';
  return `${alert}
    <div class="section-label">Tu actividad</div>
    <div class="grid grid-4" style="margin-bottom:22px">
      ${kpi('Prospectos asignados', number(p.assigned), `${number(p.open)} abiertos`, 'users')}
      ${kpi('Seguimientos pendientes', number(p.followupsPending), p.followupsOverdue ? `${number(p.followupsOverdue)} vencido${p.followupsOverdue === 1 ? '' : 's'}` : 'Para hoy o atrasados', 'bell', p.followupsPending > 0)}
      ${kpi('Reuniones agendadas', number(p.meetingsNow), `${number(p.meetings)} llegaron a reunión`, 'calendar')}
      ${kpi('Conversión personal', pct(p.conversionRate), `${number(p.clients)} cliente${p.clients === 1 ? '' : 's'} de ${number(p.contacted)} contactados`, 'target')}
    </div>
    ${due.length ? `<div class="card" id="seguimientos" style="margin-bottom:22px">
      <div class="card-head"><h2>Seguimientos para hoy</h2><span class="sub">${team ? 'Equipo completo' : 'Tus prospectos'}</span></div>
      <div>${due.map((f) => `
        <div class="fu">
          <span class="when ${f.overdue ? 'overdue' : ''}">${esc(f.overdue ? `Vencido · ${ago(f.dueAt)}` : new Date(f.dueAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))}</span>
          <div class="what"><a href="/prospectos/${encodeURIComponent(f.prospectId)}" data-link>${esc(f.prospectName ?? '')}</a>${f.note ? ` · ${esc(f.note)}` : ''}${team && f.userName ? ` <span class="faint">· ${esc(f.userName)}</span>` : ''}</div>
        </div>`).join('')}</div>
    </div>` : ''}
    ${team ? '<div class="section-label">Equipo</div>' : '<div class="section-label">Tus prospectos</div>'}`;
}

export async function render(main, _params, ctx) {
  const d = await api.dashboard();
  const k = d.kpis;
  const share = (n) => (k.analyzed ? `${pct((n / k.analyzed) * 100)} de los analizados` : '');
  const today = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  main.innerHTML = `
    <div class="page-head">
      <div><h1>Dashboard</h1><p>${esc(today.charAt(0).toUpperCase() + today.slice(1))} · resumen de tu prospección</p></div>
      <div class="page-actions"><button class="btn btn-primary" id="new">${icon('plus')}Nuevo análisis</button></div>
    </div>
    ${personalBlock(d, ctx)}
    ${k.analyzed === 0
      ? emptyState('target', ctx.isAdmin ? 'Todavía no analizaste ningún negocio' : 'Todavía no tenés prospectos asignados', ctx.isAdmin ? 'Pegá el enlace de Google Maps de un negocio y la herramienta lo audita, arma los argumentos de venta y lo guarda como prospecto.' : 'Analizá un negocio o pedile a un administrador que te asigne prospectos.', `<button class="btn btn-primary" id="first">${icon('sparkles')}Analizar un negocio</button>`)
      : `
    <div class="grid grid-4">
      ${kpi('Prospectos analizados', number(k.analyzed), '', 'audit')}
      ${kpi('Sin contactar', number(k.notContacted), share(k.notContacted), 'clock')}
      ${kpi('Contactados', number(k.contacted), share(k.contacted), 'send')}
      ${kpi('Respondieron', number(k.responded), k.contacted ? `${pct((k.responded / k.contacted) * 100)} de los contactados` : '', 'message')}
      ${kpi('Reuniones agendadas', number(k.meetings), '', 'calendar')}
      ${kpi('Clientes cerrados', number(k.clients), k.contacted ? `${pct((k.clients / k.contacted) * 100)} de conversión` : '', 'check')}
      ${kpi('Valor potencial', moneyShort(k.potentialValue), 'Pago inicial · pipeline abierto', 'money', true)}
      ${kpi('Valor cerrado', moneyShort(k.closedValue), `${number(k.clients)} cliente${k.clients === 1 ? '' : 's'}`, 'star', true)}
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Prospectos por mes</h2><span class="sub">Últimos 12 meses</span></div><div class="chart" id="c-month"></div></div>
      <div class="card"><div class="card-head"><h2>Valor potencial acumulado</h2><span class="sub">${esc(money(d.potentialSeries.at(-1)?.value ?? 0))}</span></div><div class="chart" id="c-value"></div></div>
      <div class="card"><div class="card-head"><h2>Conversiones</h2><span class="sub">Hasta dónde llegó cada prospecto</span></div><div id="c-funnel"></div></div>
      <div class="card"><div class="card-head"><h2>Estado comercial</h2><span class="sub">Prospectos por etapa</span></div><div id="c-status"></div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h2>Para contactar primero</h2><span class="sub">Sin contactar · mayor potencial</span></div>
        <div class="mini-list">${d.hot.length ? d.hot.map((p) => `
          <a class="mini-item" href="/prospectos/${encodeURIComponent(p.id)}" data-link>
            <div><div class="t">${esc(p.name)}</div><div class="s">${esc(p.verticalLabel ?? '')} · ${p.highImpactCount} problema${p.highImpactCount === 1 ? '' : 's'} de impacto alto</div></div>
            <div style="text-align:right"><div class="num" style="font-weight:600">${esc(moneyShort(p.potentialValue))}</div>${scoreHtml(p.score)}</div>
          </a>`).join('') : '<p class="muted">No hay prospectos sin contactar.</p>'}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Actividad reciente</h2></div>
        <div class="mini-list">${d.recent.map((p) => `
          <a class="mini-item" href="/prospectos/${encodeURIComponent(p.id)}" data-link>
            <div><div class="t">${esc(p.name)}</div><div class="s">${esc(ago(p.lastActivityAt))}</div></div>
            ${statusBadge(p.status)}
          </a>`).join('')}</div>
      </div>
    </div>`}`;

  $('#new', main).onclick = () => ctx.openAnalyze();
  main.querySelector('a[href="#seguimientos"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    $('#seguimientos', main)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const first = $('#first', main);
  if (first) first.onclick = () => ctx.openAnalyze();
  if (k.analyzed === 0) return;

  const draw = () => {
    barChart($('#c-month', main), d.prospectsByMonth.map((m) => ({ label: monthLabel(m.month), tip: monthLong(m.month), value: m.value })), {
      fmt: (v) => number(Math.round(v)),
      tipFmt: (v) => `${number(v)} prospecto${v === 1 ? '' : 's'}`,
    });
    areaChart($('#c-value', main), d.potentialSeries.map((m) => ({ label: monthLabel(m.month), tip: monthLong(m.month), value: m.value })), {
      fmt: (v) => moneyShort(v),
      tipFmt: (v) => money(v),
    });
  };
  draw();
  hBars($('#c-funnel', main), d.funnel.map((f, i) => ({
    label: f.label,
    value: f.count,
    text: i === 0 ? number(f.count) : `${number(f.count)} · ${pct(f.rateFromPrevious)}`,
    tip: i === 0 ? `<b>${esc(f.label)}</b>${number(f.count)}` : `<b>${esc(f.label)}</b>${number(f.count)} · ${pct(f.rateFromPrevious)} de la etapa anterior`,
  })));
  hBars($('#c-status', main), d.byStatus.map((s) => ({
    label: s.label,
    value: s.count,
    text: `${number(s.count)}${s.value ? ` · ${moneyShort(s.value)}` : ''}`,
    tone: s.id === 'perdido' ? 'muted' : '',
  })));

  let t;
  const onResize = () => { clearTimeout(t); t = setTimeout(draw, 150); };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
