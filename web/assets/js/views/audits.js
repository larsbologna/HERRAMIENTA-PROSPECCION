import { api } from '../api.js';
import { $, $$, dateTime, emptyState, esc, icon, scoreHtml } from '../ui.js';

export async function render(main, _params, ctx) {
  const { items } = await api.audits();
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Auditorías</h1><p class="muted">Cada análisis queda registrado. Reanalizar un negocio actualiza su prospecto y suma una auditoría nueva.</p></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>Nueva auditoría</h2><span class="sub">Google Maps → problemas, servicios, presupuesto y mensaje</span></div>
      <form class="toolbar" id="form" style="margin:0">
        <input class="input" id="url" type="url" required placeholder="Pegá el enlace de Google Maps del negocio" style="flex:1;min-width:240px;height:40px">
        <button class="btn btn-primary" type="submit" style="height:40px">${icon('sparkles')}Analizar</button>
      </form>
    </div>
    ${items.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Fecha</th><th>Negocio</th><th>Score</th><th class="right">Problemas</th><th class="right">Duración</th><th>Origen</th></tr></thead>
      <tbody>${items.map((a) => `
        <tr data-id="${esc(a.prospectId)}">
          <td class="muted num">${esc(dateTime(a.createdAt))}</td>
          <td class="name">${esc(a.prospectName)}</td>
          <td>${scoreHtml(a.score)}</td>
          <td class="right num">${a.problemsCount}</td>
          <td class="right num muted">${a.durationMs ? `${(a.durationMs / 1000).toFixed(0)} s` : '—'}</td>
          <td><span class="badge plain">${a.source === 'importado' ? 'Importado' : 'Análisis'}</span></td>
        </tr>`).join('')}</tbody></table></div>`
      : emptyState('audit', 'Sin auditorías todavía', 'Los análisis que hagas aparecen acá con su fecha, score y cantidad de problemas.')}`;

  $('#form', main).onsubmit = (e) => {
    e.preventDefault();
    ctx.openAnalyze($('#url', main).value.trim(), { autostart: true });
  };
  for (const tr of $$('tbody tr', main)) tr.onclick = () => ctx.navigate(`/prospectos/${encodeURIComponent(tr.dataset.id)}`);
}
