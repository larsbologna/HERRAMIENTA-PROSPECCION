import { api } from '../api.js';
import { $, $$, ago, date, emptyState, esc, icon, money, moneyShort, number, scoreHtml, statusBadge, statuses, toast } from '../ui.js';

/** Estado de la tabla (se conserva al volver a la vista durante la sesión). */
const state = { q: '', status: 'todos', vertical: '', score: '', assigned: '', sort: 'lastActivity', dir: 'desc' };
const SCORE_RANGES = { '': [undefined, undefined], bajo: [0, 44], medio: [45, 69], alto: [70, 100] };

const COLUMNS = [
  { key: 'name', label: 'Negocio' },
  { key: 'vertical', label: 'Rubro' },
  { key: 'score', label: 'Score' },
  { key: 'potential', label: 'Potencial económico', cls: 'right' },
  { key: 'status', label: 'Estado' },
  { key: 'assigned', label: 'Vendedor', adminOnly: true, sortable: false },
  { key: 'nextFollowup', label: 'Próximo contacto' },
  { key: 'lastActivity', label: 'Última actividad' },
  { key: 'analyzedAt', label: 'Fecha análisis' },
];

function nextContact(iso) {
  if (!iso) return '<span class="faint">—</span>';
  const overdue = Date.parse(iso) < Date.now();
  const text = new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  return `<span class="${overdue ? 'missing' : ''}" title="${esc(new Date(iso).toLocaleString('es-AR'))}">${overdue ? 'Vencido · ' : ''}${esc(text)}</span>`;
}

export async function render(main, _params, ctx) {
  const admin = ctx.isAdmin;
  const verticals = ctx.meta.verticals;
  const sellers = (ctx.meta.users ?? []).filter((u) => u.active);
  const cols = COLUMNS.filter((c) => !c.adminOnly || admin);
  const selected = new Set();

  main.innerHTML = `
    <div class="page-head">
      <div><h1>${admin ? 'Prospectos' : 'Mis prospectos'}</h1><p id="summary" class="muted">&nbsp;</p></div>
      <div class="page-actions">
        ${admin ? `<a class="btn" href="/api/export" download>${icon('download')}Exportar</a>` : ''}
        <button class="btn btn-primary" id="new">${icon('plus')}Nuevo análisis</button>
      </div>
    </div>
    <div class="toolbar">
      <label class="search">${icon('search')}<input class="input" id="q" type="search" placeholder="Buscar por nombre, rubro, dirección o teléfono" value="${esc(state.q)}"></label>
      ${admin ? `<select class="select" id="assigned" aria-label="Vendedor">
        <option value="">Todos los vendedores</option>
        <option value="me">Mis prospectos</option>
        <option value="none">Sin asignar</option>
        ${sellers.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
      </select>` : ''}
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
    ${admin ? `<div class="bulkbar hidden" id="bulk">
      <b id="bulk-n"></b>
      <select class="select" id="bulk-user" aria-label="Asignar a"><option value="">Sin asignar</option>${sellers.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" id="bulk-go">Asignar</button>
      <button class="btn btn-sm btn-ghost" id="bulk-clear">Cancelar</button>
    </div>` : ''}
    <div id="table"></div>`;

  for (const id of ['status', 'vertical', 'score', 'assigned']) {
    const el = $(`#${id}`, main);
    if (el) el.value = state[id];
  }
  $('#new', main).onclick = () => ctx.openAnalyze();

  const updateBulk = () => {
    const bar = $('#bulk', main);
    if (!bar) return;
    bar.classList.toggle('hidden', selected.size === 0);
    $('#bulk-n', main).textContent = `${selected.size} seleccionado${selected.size === 1 ? '' : 's'}`;
  };

  let timer;
  let seq = 0;
  const load = async () => {
    const mySeq = ++seq;
    const [minScore, maxScore] = SCORE_RANGES[state.score];
    const { items } = await api.prospects({
      q: state.q, status: state.status, vertical: state.vertical, minScore, maxScore, sort: state.sort, dir: state.dir,
      assigned: admin ? state.assigned : '',
    });
    if (mySeq !== seq) return;
    selected.clear();
    updateBulk();
    const total = items.reduce((s, p) => s + (p.status === 'perdido' ? 0 : p.potentialValue), 0);
    $('#summary', main).textContent = `${number(items.length)} prospecto${items.length === 1 ? '' : 's'} · ${money(total)} de valor potencial`;
    const table = $('#table', main);
    if (!items.length) {
      const filtered = state.q || state.status !== 'todos' || state.vertical || state.score || state.assigned;
      table.innerHTML = filtered
        ? emptyState('search', 'Sin resultados', 'Ningún prospecto coincide con la búsqueda o los filtros.')
        : emptyState('users', admin ? 'Tu base de prospectos está vacía' : 'Todavía no tenés prospectos asignados',
          admin ? 'Cada negocio que analices queda guardado acá.' : 'Los negocios que analices o que te asignen aparecen acá.',
          `<button class="btn btn-primary" id="first">${icon('sparkles')}Analizar un negocio</button>`);
      $('#first', table)?.addEventListener('click', () => ctx.openAnalyze());
      return;
    }
    table.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr>
        ${admin ? '<th style="width:36px"><input type="checkbox" class="check" id="all" aria-label="Seleccionar todos"></th>' : ''}
        ${cols.map((c) => `<th class="${c.sortable === false ? '' : 'sortable'} ${c.cls ?? ''}" ${c.sortable === false ? '' : `data-sort="${c.key}"`}>${c.label}${state.sort === c.key ? `<span class="arrow">${state.dir === 'asc' ? '↑' : '↓'}</span>` : ''}</th>`).join('')}
      </tr></thead>
      <tbody>${items.map((p) => `
        <tr data-id="${esc(p.id)}">
          ${admin ? `<td><input type="checkbox" class="check" data-pick="${esc(p.id)}" aria-label="Seleccionar ${esc(p.name)}"></td>` : ''}
          <td><div class="name">${esc(p.name)}</div><div class="sub">${esc(p.address ?? p.category ?? '')}</div></td>
          <td>${esc(p.verticalLabel ?? '—')}</td>
          <td>${scoreHtml(p.score)}</td>
          <td class="right num" title="${esc(money(p.potentialValue))}">${esc(moneyShort(p.potentialValue))}</td>
          <td>${statusBadge(p.status)}</td>
          ${admin ? `<td>${p.assignedUserName ? `<span class="who">${esc(p.assignedUserName)}</span>` : '<span class="who none">Sin asignar</span>'}</td>` : ''}
          <td style="white-space:nowrap">${nextContact(p.nextFollowupAt)}</td>
          <td class="muted">${esc(ago(p.lastActivityAt))}</td>
          <td class="muted num" style="white-space:nowrap">${esc(date(p.analyzedAt, { day: '2-digit', month: '2-digit', year: '2-digit' }))}</td>
        </tr>`).join('')}</tbody></table></div>`;
    for (const th of $$('th[data-sort]', table)) {
      th.onclick = () => {
        const key = th.dataset.sort;
        state.dir = state.sort === key && state.dir === 'desc' ? 'asc' : 'desc';
        if (state.sort !== key) state.dir = ['name', 'vertical', 'nextFollowup'].includes(key) ? 'asc' : 'desc';
        state.sort = key;
        load();
      };
    }
    for (const tr of $$('tbody tr', table)) {
      tr.onclick = (e) => {
        if (e.target.closest('input')) return;
        ctx.navigate(`/prospectos/${encodeURIComponent(tr.dataset.id)}`);
      };
    }
    for (const cb of $$('[data-pick]', table)) {
      cb.onchange = () => {
        cb.checked ? selected.add(cb.dataset.pick) : selected.delete(cb.dataset.pick);
        updateBulk();
      };
    }
    const all = $('#all', table);
    if (all) {
      all.onchange = () => {
        for (const cb of $$('[data-pick]', table)) {
          cb.checked = all.checked;
          all.checked ? selected.add(cb.dataset.pick) : selected.delete(cb.dataset.pick);
        }
        updateBulk();
      };
    }
  };

  if (admin) {
    $('#bulk-go', main).onclick = async () => {
      const userId = $('#bulk-user', main).value || null;
      try {
        const { count } = await api.assign([...selected], userId);
        toast(`${count} prospecto${count === 1 ? '' : 's'} ${userId ? `asignado${count === 1 ? '' : 's'} a ${sellers.find((u) => u.id === userId)?.name}` : 'sin asignar'}`);
        load();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    $('#bulk-clear', main).onclick = () => load();
  }

  $('#q', main).addEventListener('input', (e) => {
    state.q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(load, 180);
  });
  for (const id of ['status', 'vertical', 'score', 'assigned']) {
    $(`#${id}`, main)?.addEventListener('change', (e) => {
      state[id] = e.target.value;
      load();
    });
  }
  await load();
  return () => clearTimeout(timer);
}
