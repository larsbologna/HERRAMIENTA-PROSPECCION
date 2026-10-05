import { api } from '../api.js';
import { $, $$, emptyState, esc, icon, number, pct, scoreHtml, toast } from '../ui.js';

/**
 * GENERADOR DE PROSPECTOS: busca negocios nuevos en Google Maps (rubro + zona + cantidad),
 * nunca repite uno ya entregado, los ordena por oportunidad y permite analizarlos con el
 * análisis completo existente y hacerles seguimiento comercial.
 */

const RUBROS = ['Barberías', 'Peluquerías', 'Restaurantes', 'Parrillas', 'Pizzerías', 'Cafeterías', 'Panaderías', 'Kioscos', 'Gimnasios', 'Veterinarias', 'Odontólogos', 'Centros de estética', 'Talleres mecánicos', 'Inmobiliarias', 'Ferreterías', 'Ópticas'];
const state = { estado: 'todos', q: '', usuario: '' };
let lastRun = null; // { runId, mensaje, agotado, encontrados, pedidos }

const kpi = (label, value, sub, iconName, accent = false) => `
  <div class="card kpi ${accent ? 'accent' : ''}">
    <div class="kpi-label">${icon(iconName)}${esc(label)}</div>
    <div class="kpi-value num">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;

function statsBlock(s) {
  return `<div class="grid grid-4 gen-stats">
    ${kpi('Prospectos encontrados', number(s.found), 'Entregados por el generador', 'zap', true)}
    ${kpi('Pendientes', number(s.pending), 'Todavía sin contactar', 'clock')}
    ${kpi('Contactados', number(s.contacted), '', 'send')}
    ${kpi('Interesados', number(s.interested), 'Respondieron', 'message')}
    ${kpi('Propuestas enviadas', number(s.proposals), '', 'target')}
    ${kpi('Clientes ganados', number(s.won), '', 'check', true)}
    ${kpi('Clientes perdidos', number(s.lost), '', 'trash')}
    ${kpi('Tasa de cierre', pct(s.closeRate), 'Ganados sobre contactados', 'chart')}
  </div>`;
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function row(it, statuses, ctx) {
  const reasons = it.reasons.length
    ? it.reasons.map((r) => `<span class="gen-reason">+${r.points} ${esc(r.label)}</span>`).join('')
    : '<span class="faint">Sin carencias verificadas</span>';
  const fresh = lastRun && it.runId === lastRun.runId;
  return `<article class="gen-item" data-id="${esc(it.id)}">
    <div class="gen-score" title="Score de oportunidad (0–100)">${scoreHtml(it.score)}</div>
    <div class="gen-main">
      <div class="gen-title"><b class="gen-name">${esc(it.name)}</b>${fresh ? '<span class="badge gen-new">Nuevo hoy</span>' : ''}</div>
      <div class="sub">${esc([it.category, `${it.rubro} · ${it.zona}`].filter(Boolean).join(' · '))}${ctx.isAdmin && it.userName ? ` · ${esc(it.userName)}` : ''}</div>
      <div class="gen-facts">
        <span class="gen-fact" data-k="address">${icon('map')}${it.address ? esc(it.address) : '<span class="faint">Sin dirección</span>'}</span>
        <span class="gen-fact" data-k="phone">${icon('phone')}${it.phone ? esc(it.phone) : '<span class="missing">Sin teléfono</span>'}</span>
        <span class="gen-fact" data-k="website">${icon('globe')}${it.website ? `<a href="${esc(it.website)}" target="_blank" rel="noopener" class="gen-link">${esc(hostOf(it.website))}</a>` : '<span class="missing">Sin sitio web</span>'}</span>
        <span class="gen-fact" data-k="maps">${icon('external')}<a href="${esc(it.mapsUrl)}" target="_blank" rel="noopener" class="gen-link" title="Abrir la ficha en Google Maps">Ver en Google Maps</a></span>
      </div>
      <div class="gen-reasons" title="${esc(it.unverified.length ? `Sin verificar (no suman): ${it.unverified.join(', ')}` : '')}">${reasons}</div>
    </div>
    <div class="gen-actions">
      <select class="select gen-status" data-status="${esc(it.id)}" aria-label="Estado comercial de ${esc(it.name)}">
        ${statuses.map((s) => `<option value="${s.id}" ${s.id === it.status ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
      </select>
      ${it.prospectId
        ? `<a class="btn btn-sm" href="/prospectos/${encodeURIComponent(it.prospectId)}" data-link>${icon('audit')}Ver análisis</a>`
        : `<button class="btn btn-sm btn-primary" data-analyze="${esc(it.id)}">${icon('sparkles')}Analizar</button>`}
    </div>
  </article>`;
}

export async function render(main, _params, ctx) {
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Generador de Prospectos</h1><p class="muted">Negocios reales de Google Maps por rubro y zona. Nunca se repite un negocio ya entregado.</p></div>
    </div>
    <section class="card gen-form-card">
      <form class="gen-form" id="gen-form" autocomplete="off">
        <label class="field">Rubro<input class="input" name="rubro" list="gen-rubros" required maxlength="80" placeholder="Ej.: Barberías"></label>
        <label class="field">Ciudad o zona<input class="input" name="zona" required maxlength="80" placeholder="Ej.: Quilmes"></label>
        <label class="field gen-qty">Cantidad<input class="input num" name="cantidad" type="number" min="1" max="50" value="20" required></label>
        <button class="btn btn-primary" id="gen-go" type="submit">${icon('zap')}Generar</button>
        <datalist id="gen-rubros">${RUBROS.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
      </form>
      <div class="progress hidden" id="gen-progress">
        <div class="progress-track"><i id="gen-bar"></i></div>
        <div class="progress-text"><span id="gen-step">Preparando…</span><b class="num" id="gen-pct">0%</b></div>
      </div>
      <div id="gen-result"></div>
      <p class="faint gen-help">Busca en todas las páginas de resultados (y variantes de la búsqueda) hasta completar la cantidad o agotar los negocios disponibles. Puede tardar unos minutos.</p>
    </section>
    <div id="gen-stats"></div>
    <section class="card" style="margin-top:16px">
      <div class="card-head"><h2>Prospectos generados</h2><span class="sub" id="gen-count"></span></div>
      <div class="toolbar">
        <label class="search">${icon('search')}<input class="input" id="gen-q" type="search" placeholder="Buscar por nombre, dirección, rubro o zona" value="${esc(state.q)}"></label>
        <select class="select" id="gen-estado" aria-label="Estado">
          <option value="todos">Todos los estados</option>
          <option value="pendientes">Pendientes (nuevos)</option>
        </select>
        ${ctx.isAdmin ? `<select class="select" id="gen-usuario" aria-label="Vendedor"><option value="">Todo el equipo</option><option value="me">Generados por mí</option>
          ${(ctx.meta.users ?? []).map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select>` : ''}
      </div>
      <div id="gen-table"></div>
    </section>`;

  const form = $('#gen-form', main);
  let statuses = [];

  const loadStats = async () => {
    const { stats } = await api.generatorStats({ usuario: ctx.isAdmin ? state.usuario : '' });
    $('#gen-stats', main).innerHTML = statsBlock(stats);
  };

  const loadList = async () => {
    const r = await api.generated({ estado: state.estado, q: state.q, usuario: ctx.isAdmin ? state.usuario : '' });
    statuses = r.statuses;
    const sel = $('#gen-estado', main);
    if (sel.options.length === 2) {
      for (const s of statuses) sel.insertAdjacentHTML('beforeend', `<option value="${s.id}">${esc(s.label)}</option>`);
      sel.value = state.estado;
    }
    $('#gen-count', main).textContent = `${number(r.items.length)} · ordenados por oportunidad`;
    const box = $('#gen-table', main);
    if (!r.items.length) {
      box.innerHTML = state.q || state.estado !== 'todos'
        ? emptyState('search', 'Sin resultados', 'Ningún prospecto generado coincide con el filtro.')
        : emptyState('zap', 'Todavía no generaste prospectos', 'Indicá un rubro, una zona y la cantidad, y tocá Generar.');
      return;
    }
    box.innerHTML = `<div class="gen-list">${r.items.map((it) => row(it, statuses, ctx)).join('')}</div>`;

    for (const s of $$('[data-status]', box)) {
      s.onchange = async () => {
        try {
          await api.setGeneratedStatus(s.dataset.status, s.value);
          toast(`Estado: ${statuses.find((x) => x.id === s.value)?.label}`);
          loadStats();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    }
    for (const b of $$('[data-analyze]', box)) {
      const it = r.items.find((x) => x.id === b.dataset.analyze);
      // Flujo existente: análisis completo → informe comercial. Al terminar, queda vinculado.
      b.onclick = () => ctx.openAnalyze(it.mapsUrl, {
        autostart: true,
        onDone: async (done) => {
          if (done.prospectId) await api.linkGenerated(it.id, done.prospectId);
        },
      });
    }
  };

  const set = (p, text) => {
    $('#gen-bar', main).style.width = `${p}%`;
    $('#gen-pct', main).textContent = `${Math.round(p)}%`;
    if (text) $('#gen-step', main).textContent = text;
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body = { rubro: String(f.get('rubro')).trim(), zona: String(f.get('zona')).trim(), cantidad: Number(f.get('cantidad')) };
    const btn = $('#gen-go', main);
    btn.disabled = true;
    for (const el of form.elements) el.disabled = true;
    $('#gen-result', main).innerHTML = '';
    $('#gen-progress', main).classList.remove('hidden');
    set(2, 'Iniciando…');
    try {
      const done = await api.generate(body, (ev) => {
        if (ev.tipo === 'progreso') set(ev.porcentaje, ev.mensaje);
      });
      lastRun = done;
      const full = done.encontrados >= done.pedidos;
      $('#gen-result', main).innerHTML = `<div class="alert ${full ? '' : 'warn'} gen-alert">
        <span class="alert-icon">${icon(full ? 'check' : 'bell')}</span>
        <div><b>${esc(done.mensaje)}</b>
        <div class="muted">${esc(`${body.rubro} en ${body.zona}`)} · revisados ${number(done.estadisticas.scanned)} resultados de Google Maps · ${number(done.estadisticas.duplicates)} ya entregados o repetidos${done.estadisticas.outOfZone ? ` · ${number(done.estadisticas.outOfZone)} fuera de la zona` : ''}${done.estadisticas.closed ? ` · ${number(done.estadisticas.closed)} cerrados` : ''}</div></div></div>`;
      state.estado = 'todos';
      state.q = '';
      $('#gen-q', main).value = '';
      $('#gen-estado', main).value = 'todos';
      await Promise.all([loadList(), loadStats()]);
    } catch (err) {
      $('#gen-result', main).innerHTML = `<div class="error-text">${esc(err.message)}</div>`;
    } finally {
      $('#gen-progress', main).classList.add('hidden');
      for (const el of form.elements) el.disabled = false;
      btn.disabled = false;
    }
  };

  let timer;
  $('#gen-q', main).oninput = (e) => {
    state.q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(loadList, 200);
  };
  $('#gen-estado', main).onchange = (e) => {
    state.estado = e.target.value;
    loadList();
  };
  const u = $('#gen-usuario', main);
  if (u) {
    u.value = state.usuario;
    u.onchange = (e) => {
      state.usuario = e.target.value;
      loadList();
      loadStats();
    };
  }

  await Promise.all([loadList(), loadStats()]);
  return () => clearTimeout(timer);
}
