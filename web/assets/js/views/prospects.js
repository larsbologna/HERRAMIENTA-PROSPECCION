import { api } from '../api.js';
import { $, $$, ago, date, emptyState, esc, icon, money, moneyShort, number, scoreHtml, statusBadge, statuses } from '../ui.js';

/** Estado de la tabla (se conserva al volver a la vista durante la sesión). */
const state = { q: '', status: 'todos', vertical: '', score: '', sort: 'lastActivity', dir: 'desc' };
const SCORE_RANGES = { '': [undefined, undefined], bajo: [0, 44], medio: [45, 69], alto: [70, 100] };

const COLUMNS = [
  { key: 'name', label: 'Negocio' },
  { key: 'vertical', label: 'Rubro' },
  { key: 'score', label: 'Score' },
  { key: 'potential', label: 'Potencial económico', cls: 'right' },
  { key: 'status', label: 'Estado' },
  { key: 'lastActivity', label: 'Última actividad' },
  { key: 'analyzedAt', label: 'Fecha análisis' },
];

export async function render(main, _params, ctx) {
  const verticals = ctx.meta.verticals;
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Prospectos</h1><p id="summary" class="muted">&nbsp;</p></div>
      <div class="page-actions">
        <a class="btn" href="/api/export" download>${icon('download')}Exportar</a>
        <button class="btn btn-primary" id="new">${icon('plus')}Nuevo análisis</button>
      </div>
    </div>
    <div class="toolbar">
      <label class="search">${icon('search')}<input class="input" id="q" type="search" placeholder="Buscar por nombre, rubro, dirección o teléfono" value="${esc(state.q)}"></label>
      <select class="select" id="status" aria-label="Estado">
        <option value="todos">Todos los estados</option>
        <option value="abiertos">Abiertos (sin cerrar)</option>
        ${statuses().map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}
      </select>
      <select class="select" id="vertical" aria-label="Rubro">
        <option value="">Todos los rubros</option>
        ${verticals.map((v) => `<option value="${v.id}">${esc(v.label)}</option>`).join('')}
      </select>
      <select class="select" id="score" aria-label="Score">
        <option value="">Cualquier score</option>
        <option value="bajo">Score bajo (0–44)</option>
        <option value="medio">Score medio (45–69)</option>
        <option value="alto">Score alto (70–100)</option>
      </select>
    </div>
    <div id="table"></div>`;

  $('#status', main).value = state.status;
  $('#vertical', main).value = state.vertical;
  $('#score', main).value = state.score;
  $('#new', main).onclick = () => ctx.openAnalyze();

  let timer;
  let seq = 0;
  const load = async () => {
    const mySeq = ++seq;
    const [minScore, maxScore] = SCORE_RANGES[state.score];
    const { items } = await api.prospects({ q: state.q, status: state.status, vertical: state.vertical, minScore, maxScore, sort: state.sort, dir: state.dir });
    if (mySeq !== seq) return;
    const total = items.reduce((s, p) => s + (p.status === 'perdido' ? 0 : p.potentialValue), 0);
    $('#summary', main).textContent = `${number(items.length)} prospecto${items.length === 1 ? '' : 's'} · ${money(total)} de valor potencial`;
    const table = $('#table', main);
    if (!items.length) {
      const filtered = state.q || state.status !== 'todos' || state.vertical || state.score;
      table.innerHTML = filtered
        ? emptyState('search', 'Sin resultados', 'Ningún prospecto coincide con la búsqueda o los filtros.')
        : emptyState('users', 'Tu base de prospectos está vacía', 'Cada negocio que analices queda guardado acá.', `<button class="btn btn-primary" id="first">${icon('sparkles')}Analizar un negocio</button>`);
      $('#first', table)?.addEventListener('click', () => ctx.openAnalyze());
      return;
    }
    table.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr>${COLUMNS.map((c) => `<th class="sortable ${c.cls ?? ''}" data-sort="${c.key}">${c.label}${state.sort === c.key ? `<span class="arrow">${state.dir === 'asc' ? '↑' : '↓'}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${items.map((p) => `
        <tr data-id="${esc(p.id)}">
          <td><div class="name">${esc(p.name)}</div><div class="sub">${esc(p.address ?? p.category ?? '')}</div></td>
          <td>${esc(p.verticalLabel ?? '—')}</td>
          <td>${scoreHtml(p.score)}</td>
          <td class="right num" title="${esc(money(p.potentialValue))}">${esc(moneyShort(p.potentialValue))}</td>
          <td>${statusBadge(p.status)}</td>
          <td class="muted">${esc(ago(p.lastActivityAt))}</td>
          <td class="muted num" style="white-space:nowrap">${esc(date(p.analyzedAt, { day: '2-digit', month: '2-digit', year: '2-digit' }))}</td>
        </tr>`).join('')}</tbody></table></div>`;
    for (const th of $$('th[data-sort]', table)) {
      th.onclick = () => {
        const key = th.dataset.sort;
        state.dir = state.sort === key && state.dir === 'desc' ? 'asc' : 'desc';
        if (state.sort !== key) state.dir = key === 'name' || key === 'vertical' ? 'asc' : 'desc';
        state.sort = key;
        load();
      };
    }
    for (const tr of $$('tbody tr', table)) tr.onclick = () => ctx.navigate(`/prospectos/${encodeURIComponent(tr.dataset.id)}`);
  };

  $('#q', main).addEventListener('input', (e) => {
    state.q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(load, 180);
  });
  for (const id of ['status', 'vertical', 'score']) {
    $(`#${id}`, main).addEventListener('change', (e) => {
      state[id] = e.target.value;
      load();
    });
  }
  await load();
  return () => clearTimeout(timer);
}
