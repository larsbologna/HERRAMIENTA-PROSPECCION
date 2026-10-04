import { api } from '../api.js';
import { COLORS, barChart, groupedBars, hBars } from '../charts.js';
import { $, emptyState, esc, icon, money, moneyShort, monthLabel, monthLong, number, pct } from '../ui.js';

const kpi = (label, value, sub, iconName, accent) => `
  <div class="card kpi ${accent ? 'accent' : ''}"><div class="kpi-label">${icon(iconName)}${esc(label)}</div>
  <div class="kpi-value num">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;

export async function render(main, _params, ctx) {
  const [m, d] = await Promise.all([api.metrics(), api.dashboard()]);
  const t = m.totals;
  main.innerHTML = `
    <div class="page-head"><div><h1>Métricas</h1><p class="muted">Rendimiento de tu prospección y dónde están las oportunidades.</p></div></div>
    ${!t.prospects ? emptyState('chart', 'Todavía no hay datos', 'Las métricas aparecen cuando analices los primeros negocios.', `<button class="btn btn-primary" id="first">${icon('sparkles')}Nuevo análisis</button>`) : `
    <div class="grid grid-3">
      ${kpi('Total prospectos', number(t.prospects), `${number(t.clients)} clientes · ${number(t.lost)} perdidos`, 'users')}
      ${kpi('Valor potencial', moneyShort(t.potentialValue), `Total de proyectos: ${moneyShort(t.projectTotal)}`, 'money', true)}
      ${kpi('Valor cerrado', moneyShort(t.closedValue), t.clients ? `Ticket promedio cerrado: ${moneyShort(t.averageClosedTicket)}` : 'Sin clientes todavía', 'star', true)}
      ${kpi('Conversión', pct(t.conversionRate), `De contactado a cliente · ${pct(t.conversionFromAnalyzed)} sobre analizados`, 'target')}
      ${kpi('Ticket promedio', moneyShort(t.averageTicket), 'Valor potencial por prospecto', 'money')}
      ${kpi('Score promedio', `${t.averageScore}<small style="font-size:14px;color:var(--text-3)">/100</small>`, 'Presencia online de los analizados', 'chart')}
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Servicios más recomendados</h2><span class="sub">Prioridad alta y media</span></div><div id="c-services"></div></div>
      <div class="card"><div class="card-head"><h2>Rubros más analizados</h2><span class="sub">Cantidad · score promedio</span></div><div id="c-verticals"></div></div>
      <div class="card"><div class="card-head"><h2>Score promedio por área</h2><span class="sub">Dónde están más flojos los negocios</span></div><div id="c-areas"></div></div>
      <div class="card"><div class="card-head"><h2>Distribución de scores</h2><span class="sub">Cantidad de prospectos</span></div><div class="chart" id="c-scores"></div></div>
      <div class="card span-2"><div class="card-head"><h2>Contactos y cierres por mes</h2><span class="sub">Cambios de estado registrados</span></div><div class="chart" id="c-conv"></div></div>
    </div>`}`;

  $('#first', main)?.addEventListener('click', () => ctx.openAnalyze());
  if (!t.prospects) return;

  hBars($('#c-services', main), m.services.map((s) => ({
    label: s.name, value: s.count, text: `${number(s.count)} · ${pct(s.share)}`,
    tip: `<b>${esc(s.name)}</b>Recomendado en ${number(s.count)} prospectos (${number(s.high)} con prioridad alta)`,
  })));
  hBars($('#c-verticals', main), m.byVertical.slice(0, 8).map((v) => ({
    label: v.label, value: v.count, text: `${number(v.count)} · ${v.avgScore}/100`,
    tip: `<b>${esc(v.label)}</b>${number(v.count)} prospectos · score ${v.avgScore}<br>Potencial abierto: ${esc(money(v.potential))}<br>Clientes: ${number(v.clients)}`,
  })));
  hBars($('#c-areas', main), m.areaScores.map((a) => ({ label: a.label, value: a.avg, text: `${a.avg}/100`, tone: a.avg < 45 ? 'danger' : '' })), { max: 100 });

  const draw = () => {
    barChart($('#c-scores', main), m.scoreDistribution.map((b) => ({ label: b.label, value: b.count, tip: `Score ${b.label}` })), {
      fmt: (v) => number(Math.round(v)), tipFmt: (v) => `${number(v)} prospecto${v === 1 ? '' : 's'}`, height: 200,
    });
    groupedBars($('#c-conv', main), d.conversionsByMonth.map((c) => ({ label: monthLabel(c.month), tip: monthLong(c.month), contacted: c.contacted, clients: c.clients })), [
      { key: 'contacted', name: 'Contactados', color: COLORS.NEUTRAL },
      { key: 'clients', name: 'Clientes', color: COLORS.GREEN },
    ], { fmt: (v) => number(Math.round(v)) });
  };
  draw();
  let timer;
  const onResize = () => { clearTimeout(timer); timer = setTimeout(draw, 150); };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
