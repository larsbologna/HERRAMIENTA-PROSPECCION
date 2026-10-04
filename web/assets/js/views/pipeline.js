import { api } from '../api.js';
import { $, $$, ago, esc, icon, moneyShort, number, scoreHtml, statuses, toast } from '../ui.js';

let assignedFilter = '';

function card(p, showOwner) {
  return `<article class="deal" draggable="true" data-id="${esc(p.id)}" data-status="${esc(p.status)}">
    <h4>${esc(p.name)}</h4>
    <div class="meta">${esc(p.verticalLabel ?? '—')} · ${esc(ago(p.lastActivityAt))}${showOwner ? ` · ${esc(p.assignedUserName ?? 'Sin asignar')}` : ''}</div>
    <div class="row"><span class="value num">${esc(moneyShort(p.status === 'cliente' ? p.closedValue ?? p.potentialValue : p.potentialValue))}</span>${scoreHtml(p.score)}</div>
    <select class="select move" aria-label="Mover ${esc(p.name)} a otra etapa">
      ${statuses().map((s) => `<option value="${s.id}" ${s.id === p.status ? 'selected' : ''}>${s.id === p.status ? 'Mover a…' : esc(s.label)}</option>`).join('')}
    </select>
  </article>`;
}

export async function render(main, _params, ctx) {
  const admin = ctx.isAdmin;
  const sellers = (ctx.meta.users ?? []).filter((u) => u.active);
  const { items } = await api.prospects({ sort: 'lastActivity', dir: 'desc', assigned: admin ? assignedFilter : '' });
  const byId = new Map(items.map((p) => [p.id, p]));

  main.innerHTML = `
    <div class="page-head">
      <div><h1>Pipeline comercial</h1><p class="muted">Arrastrá cada negocio a la etapa en la que está. Los cambios se guardan solos.</p></div>
      <div class="page-actions">
        ${admin ? `<select class="select" id="who" aria-label="Vendedor">
          <option value="">Todo el equipo</option><option value="me">Mis prospectos</option><option value="none">Sin asignar</option>
          ${sellers.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
        </select>` : ''}
        <button class="btn btn-primary" id="new">${icon('plus')}Nuevo análisis</button>
      </div>
    </div>
    <div class="board" id="board">
      ${statuses().map((s) => `
        <section class="column" data-status="${s.id}">
          <div class="column-head"><h3>${esc(s.label)}</h3><span class="n num" data-count></span></div>
          <div class="column-total num" data-total></div>
          <div class="column-body" data-body></div>
        </section>`).join('')}
    </div>`;
  $('#new', main).onclick = () => ctx.openAnalyze();
  const who = $('#who', main);
  if (who) {
    who.value = assignedFilter;
    who.onchange = () => { assignedFilter = who.value; render(main, _params, ctx); };
  }
  const board = $('#board', main);

  const paint = () => {
    for (const col of $$('.column', board)) {
      const list = items.filter((p) => p.status === col.dataset.status);
      $('[data-body]', col).innerHTML = list.length ? list.map((p) => card(p, admin && !assignedFilter)).join('') : '<div class="column-empty">Soltá un prospecto acá</div>';
      $('[data-count]', col).textContent = number(list.length);
      const value = list.reduce((s, p) => s + (p.status === 'cliente' ? p.closedValue ?? p.potentialValue : p.potentialValue), 0);
      $('[data-total]', col).textContent = list.length ? moneyShort(value) : '—';
    }
  };
  paint();

  async function move(id, status) {
    const p = byId.get(id);
    if (!p || p.status === status) return;
    const previous = p.status;
    p.status = status;
    p.lastActivityAt = new Date().toISOString();
    paint();
    try {
      const saved = await api.update(id, { status });
      Object.assign(p, { status: saved.status, closedValue: saved.closedValue, lastActivityAt: saved.lastActivityAt });
      paint();
      toast(`${p.name} → ${statuses().find((s) => s.id === status)?.label}`);
    } catch (err) {
      p.status = previous;
      paint();
      toast(`No se pudo mover: ${err.message}`, 'err');
    }
  }

  // Arrastrar y soltar (HTML5)
  let dragId = null;
  board.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.deal');
    if (!el) return;
    dragId = el.dataset.id;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  board.addEventListener('dragend', (e) => {
    e.target.closest('.deal')?.classList.remove('dragging');
    for (const c of $$('.column.drop', board)) c.classList.remove('drop');
  });
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.column');
    if (!col || !dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    for (const c of $$('.column.drop', board)) if (c !== col) c.classList.remove('drop');
    col.classList.add('drop');
  });
  board.addEventListener('dragleave', (e) => {
    const col = e.target.closest('.column');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drop');
  });
  board.addEventListener('drop', (e) => {
    const col = e.target.closest('.column');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('drop');
    const id = e.dataTransfer.getData('text/plain') || dragId;
    dragId = null;
    move(id, col.dataset.status);
  });

  // Alternativa sin arrastrar (teclado / pantallas táctiles) y apertura del perfil
  board.addEventListener('change', (e) => {
    const sel = e.target.closest('select.move');
    if (sel) move(sel.closest('.deal').dataset.id, sel.value);
  });
  board.addEventListener('click', (e) => {
    if (e.target.closest('select')) return;
    const el = e.target.closest('.deal');
    if (el) ctx.navigate(`/prospectos/${encodeURIComponent(el.dataset.id)}`);
  });
}
