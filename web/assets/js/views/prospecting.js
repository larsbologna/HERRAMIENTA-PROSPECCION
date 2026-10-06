import { api } from '../api.js';
import { $, $$, date, dateTime, emptyState, esc, icon, number, statusBadge, toast } from '../ui.js';

/**
 * PROSPECCIÓN: elegir rubro, zona y cantidad → la herramienta busca, descarta duplicados y ANALIZA
 * cada negocio (Maps, web, Instagram, WhatsApp, reservas, oportunidades, potencial y mensaje).
 * Después: campañas separadas por rubro y zona, filtros combinables y Modo Prospección Rápida.
 *
 * Pensada para una PC con pocos recursos: el análisis corre en el servidor de a un negocio por vez
 * y esta pantalla solo consulta el avance cada pocos segundos (sin cargar webs ni imágenes).
 */

const CANTIDADES = [10, 20, 30, 50];
const POT = {
  alto: { label: 'Alto', emoji: '🔥', cls: 'pot-alto' },
  medio: { label: 'Medio', emoji: '🟡', cls: 'pot-medio' },
  bajo: { label: 'Bajo', emoji: '⚪', cls: 'pot-bajo' },
};
export const potentialBadge = (level, reason) => {
  const p = POT[level];
  return p ? `<span class="pot ${p.cls}" title="${esc(reason ?? '')}">${p.emoji} ${p.label.toUpperCase()}</span>` : '<span class="pot pot-none" title="Sin calcular">— Sin calcular</span>';
};
const ESTADOS = [
  ['todos', 'Todos'], ['pendientes', 'No contactados'], ['contactado', 'Contactados'], ['respondio', 'Respondieron'], ['interesado', 'Interesados'],
  ['reunion', 'Reunión agendada'], ['cliente', 'Clientes'], ['perdido', 'No interesados'], ['contactar_despues', 'Contactar después'],
];
const ITEM_STATE = {
  pendiente: ['○', 'faint', 'En espera'],
  analizando: ['…', 'job-run', 'Analizando'],
  listo: ['✓', 'job-ok', 'Analizado'],
  reutilizado: ['✓', 'job-ok', 'Análisis reciente reutilizado'],
  duplicado: ['=', 'faint', 'Duplicado (no se repite)'],
  error: ['!', 'job-err', 'No se pudo analizar'],
};

/** Filtros recordados mientras la app está abierta. */
const filters = { campana: '', estado: 'pendientes', potencial: '', q: '' };

function summaryHtml(s) {
  return `<div class="camp-stats">
    <span><b class="num">${number(s.found)}</b> encontrados</span>
    <span class="ok">✓ <b class="num">${number(s.analyzed)}</b> analizados</span>
    <span>○ <b class="num">${number(s.notContacted)}</b> no contactados</span>
    <span class="ok">✓ <b class="num">${number(s.contacted)}</b> contactados</span>
    <span>💬 <b class="num">${number(s.responded)}</b> respondieron</span>
    <span>🔥 <b class="num">${number(s.interested)}</b> interesados</span>
    <span>⏰ <b class="num">${number(s.later)}</b> para después</span>
  </div>
  <div class="camp-pot">Potencial alto: <b class="num">${s.potential.alto}</b> · medio: <b class="num">${s.potential.medio}</b> · bajo: <b class="num">${s.potential.bajo}</b>${s.failed ? ` · <span class="job-err">${s.failed} sin analizar</span>` : ''}</div>`;
}

function campaignCard(c) {
  const pending = c.summary.notContacted;
  return `<article class="camp" data-camp="${esc(c.id)}">
    <div class="camp-head"><h3>${esc(c.label)}</h3><span class="faint">${esc(date(c.updatedAt))}</span></div>
    ${summaryHtml(c.summary)}
    <div class="btn-row camp-actions">
      <a class="btn btn-sm ${pending ? 'btn-primary' : ''}" href="/prospeccion/rapida?campana=${encodeURIComponent(c.id)}" data-link>${icon('zap')}${pending ? `Prospección rápida (${pending} pendientes)` : 'Prospección rápida'}</a>
      <button class="btn btn-sm" data-show="${esc(c.id)}">${icon('users')}Ver prospectos</button>
    </div>
  </article>`;
}

function jobHtml(job) {
  const running = job.phase === 'buscando' || job.phase === 'analizando';
  const done = job.items.filter((i) => i.state !== 'pendiente' && i.state !== 'analizando').length;
  return `<div class="job ${running ? 'running' : ''}" id="job">
    <div class="job-head"><b>${esc(job.campaignLabel)}</b>
      <span class="faint">${running ? (job.phase === 'buscando' ? 'Fase 1 de 2 · buscando negocios' : `Fase 2 de 2 · analizando ${done} de ${job.found}`) : esc(job.phase === 'terminado' ? 'Terminado' : job.phase === 'cancelado' ? 'Cancelado' : 'Error')}</span></div>
    <div class="progress"><div class="progress-track"><i style="width:${job.percent}%"></i></div>
      <div class="progress-text"><span>${esc(job.message)}</span><b class="num">${job.percent}%</b></div></div>
    ${job.items.length ? `<ol class="job-items">${job.items.map((it) => {
      const [sym, cls, txt] = ITEM_STATE[it.state] ?? ITEM_STATE.pendiente;
      return `<li><span class="job-sym ${cls}" title="${esc(txt)}">${sym}</span><span class="job-name">${esc(it.name)}</span>${it.potential ? ` ${potentialBadge(it.potential)}` : ''}${it.detail ? `<span class="faint job-detail">${esc(it.detail)}</span>` : ''}</li>`;
    }).join('')}</ol>` : ''}
    <div class="btn-row" style="margin-top:12px">
      ${running ? `<button class="btn btn-sm" id="job-cancel">${icon('trash')}Cancelar búsqueda</button>` : ''}
      ${!running && job.analyzed ? `<a class="btn btn-primary" href="/prospeccion/rapida?campana=${encodeURIComponent(job.campaignId)}" data-link>${icon('zap')}Iniciar prospección rápida</a>` : ''}
    </div>
  </div>`;
}

function rowHtml(p) {
  return `<article class="pros-row" data-id="${esc(p.id)}">
    <div class="pros-main">
      <div class="pros-title"><a href="/prospectos/${encodeURIComponent(p.id)}" data-link class="pros-name">${esc(p.name)}</a> ${potentialBadge(p.potentialLevel, p.potentialReason)}</div>
      <div class="sub">${esc([p.category, p.campaignLabel ?? 'Sin campaña'].filter(Boolean).join(' · '))}</div>
      <div class="faint pros-facts">${p.rating !== null ? `${String(p.rating).replace('.', ',')} ⭐` : '? calificación'} · ${p.reviewCount !== null ? `${number(p.reviewCount)} reseñas` : '? reseñas'}${p.nextFollowupAt ? ` · ⏰ ${esc(date(p.nextFollowupAt))}` : ''}</div>
      ${p.potentialReason ? `<div class="faint pros-reason">${esc(p.potentialReason)}</div>` : ''}
    </div>
    <div class="pros-side">${statusBadge(p.status)}
      <div class="btn-row">
        ${p.status === 'sin_contactar' ? `<a class="btn btn-sm btn-primary" href="/prospeccion/rapida?${new URLSearchParams({ ...(p.campaignId ? { campana: p.campaignId } : {}), id: p.id })}" data-link>${icon('message')}Contactar</a>` : ''}
        <a class="btn btn-sm" href="${esc(p.mapsUrl)}" target="_blank" rel="noopener">${icon('map')}Maps</a>
      </div>
    </div>
  </article>`;
}

export async function render(main, _params, ctx) {
  const data = await api.prospecting();
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Prospección</h1><p class="muted">Elegí rubro, zona y cantidad: la herramienta busca, descarta repetidos y te entrega los prospectos <b>ya analizados</b>, con potencial y mensaje listo.</p></div>
    </div>
    <section class="card">
      <form class="pros-form" id="pros-form" autocomplete="off">
        <label class="field">Rubro
          <select class="select" name="rubro" id="f-rubro">${data.rubros.map((r) => `<option>${esc(r)}</option>`).join('')}<option value="__otro">Otro / personalizado…</option></select></label>
        <label class="field hidden" id="f-rubro-otro-l">Rubro personalizado<input class="input" id="f-rubro-otro" maxlength="80" placeholder="Ej.: Ópticas"></label>
        <label class="field">Zona
          <select class="select" name="zona" id="f-zona">${data.zonas.map((z) => `<option>${esc(z)}</option>`).join('')}<option value="__otra">Otra zona…</option></select></label>
        <label class="field hidden" id="f-zona-otra-l">Otra zona<input class="input" id="f-zona-otra" maxlength="80" placeholder="Ej.: Avellaneda"></label>
        <label class="field">Cantidad
          <select class="select" name="cantidad" id="f-cant">${CANTIDADES.map((c) => `<option ${c === 20 ? 'selected' : ''}>${c}</option>`).join('')}<option value="__otra">Otra…</option></select></label>
        <label class="field hidden" id="f-cant-otra-l">Cantidad<input class="input num" id="f-cant-otra" type="number" min="1" max="${data.maxCantidad}" value="15"></label>
        <button class="btn btn-primary" id="pros-go" type="submit">${icon('search')}Buscar prospectos</button>
      </form>
      <p class="faint" style="font-size:12px;margin:10px 0 0">Busca en Google Maps solo el rubro elegido, nunca repite un negocio que ya tenés (de ninguna campaña ni día) y analiza cada uno de a uno para no exigir a la PC. Puede tardar varios minutos: podés dejarlo trabajando.</p>
      <div id="job-box"></div>
    </section>

    <section class="card" style="margin-top:16px">
      <div class="card-head"><h2>Campañas</h2><span class="sub">Rubro · zona · mes</span></div>
      <div id="camps">${data.campaigns.length ? data.campaigns.map(campaignCard).join('') : '<p class="muted" style="margin:0">Todavía no hay campañas. Hacé tu primera búsqueda arriba.</p>'}</div>
    </section>

    <div class="pros-grid">
      <section class="card" id="lista">
        <div class="card-head"><h2>Prospectos</h2><span class="sub" id="pros-count"></span></div>
        <div class="toolbar">
          <select class="select" id="fl-camp" aria-label="Campaña"><option value="">Todas las campañas</option>${data.campaigns.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}<option value="none">Sin campaña (análisis manuales)</option></select>
          <select class="select" id="fl-estado" aria-label="Estado">${ESTADOS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
          <select class="select" id="fl-pot" aria-label="Potencial"><option value="">Cualquier potencial</option><option value="alto">🔥 Alto</option><option value="medio">🟡 Medio</option><option value="bajo">⚪ Bajo</option></select>
          <label class="search">${icon('search')}<input class="input" id="fl-q" type="search" placeholder="Buscar por nombre"></label>
        </div>
        <div id="pros-list"></div>
      </section>
      <section class="card" id="proximos">
        <div class="card-head"><h2>Próximos contactos</h2></div>
        <div id="next-list"></div>
      </section>
    </div>
    <p class="faint gen-footlink"><a href="/generador" data-link>Lista completa de negocios encontrados</a> · para reintentar el análisis de alguno que falló.</p>`;

  const form = $('#pros-form', main);
  const toggleOther = (sel, labelId) => { $(labelId, main).classList.toggle('hidden', !sel.value.startsWith('__')); };
  $('#f-rubro', main).onchange = (e) => toggleOther(e.target, '#f-rubro-otro-l');
  $('#f-zona', main).onchange = (e) => toggleOther(e.target, '#f-zona-otra-l');
  $('#f-cant', main).onchange = (e) => toggleOther(e.target, '#f-cant-otra-l');

  // ---------------- listado con filtros combinables
  for (const [id, key] of [['#fl-camp', 'campana'], ['#fl-estado', 'estado'], ['#fl-pot', 'potencial']]) {
    const el = $(id, main);
    el.value = filters[key];
    if (el.value !== filters[key]) filters[key] = el.value = '';
    el.onchange = () => { filters[key] = el.value; loadList(); };
  }
  let qTimer;
  $('#fl-q', main).value = filters.q;
  $('#fl-q', main).oninput = (e) => { filters.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(loadList, 250); };

  async function loadList() {
    const r = await api.prospectingList({ campana: filters.campana, estado: filters.estado, potencial: filters.potencial, q: filters.q });
    $('#pros-count', main).textContent = `${number(r.total)} prospecto${r.total === 1 ? '' : 's'}`;
    $('#pros-list', main).innerHTML = r.items.length
      ? `<div class="pros-list">${r.items.slice(0, 200).map(rowHtml).join('')}</div>${r.items.length > 200 ? `<p class="faint">Mostrando 200 de ${number(r.items.length)}: usá los filtros para acotar.</p>` : ''}`
      : emptyState('search', 'Sin prospectos', 'Ningún prospecto coincide con los filtros.');
  }

  async function loadNext() {
    const { items } = await api.followups({ scope: ctx.isAdmin ? 'equipo' : '' });
    $('#next-list', main).innerHTML = items.length
      ? `<ul class="next-list">${items.slice(0, 30).map((f) => `<li class="${f.overdue ? 'overdue' : ''}"><span class="num">${esc(dateTime(f.dueAt))}</span>
          <a href="/prospectos/${encodeURIComponent(f.prospectId)}" data-link>${esc(f.prospectName ?? 'Prospecto')}</a>${f.note ? `<span class="faint">${esc(f.note)}</span>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted" style="margin:0">No hay contactos agendados. Usá "Contactar después" en el modo rápido.</p>';
  }

  for (const b of $$('[data-show]', main)) {
    b.onclick = () => {
      filters.campana = b.dataset.show;
      $('#fl-camp', main).value = filters.campana;
      loadList();
      $('#lista', main).scrollIntoView({ behavior: 'smooth' });
    };
  }

  // ---------------- búsqueda automática (en segundo plano, con avance liviano)
  let pollTimer;
  let stopped = false;
  const showJob = (job) => {
    const box = $('#job-box', main);
    if (!job) { box.innerHTML = ''; return; }
    box.innerHTML = jobHtml(job);
    const cancel = $('#job-cancel', box);
    if (cancel) cancel.onclick = async () => { await api.prospectingCancel(); toast('Cancelando… lo ya analizado queda guardado.'); };
  };
  const poll = async () => {
    if (stopped) return;
    try {
      const { job } = await api.prospectingJob();
      showJob(job);
      const running = job && (job.phase === 'buscando' || job.phase === 'analizando');
      setBusy(running);
      if (running) pollTimer = setTimeout(poll, 2500);
      else if (job && pollTimer !== undefined) {
        pollTimer = undefined;
        toast(job.phase === 'terminado' ? `Listo: ${job.analyzed} prospectos analizados` : job.message, job.phase === 'terminado' ? 'ok' : 'err');
        const fresh = await api.prospecting();
        $('#camps', main).innerHTML = fresh.campaigns.map(campaignCard).join('');
        loadList();
      }
    } catch {
      if (!stopped) pollTimer = setTimeout(poll, 5000);
    }
  };
  const setBusy = (b) => { for (const el of form.elements) el.disabled = !!b; };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const rubroSel = $('#f-rubro', main).value;
    const zonaSel = $('#f-zona', main).value;
    const cantSel = $('#f-cant', main).value;
    const body = {
      rubro: rubroSel === '__otro' ? $('#f-rubro-otro', main).value.trim() : rubroSel,
      zona: zonaSel === '__otra' ? $('#f-zona-otra', main).value.trim() : zonaSel,
      cantidad: Number(cantSel === '__otra' ? $('#f-cant-otra', main).value : cantSel),
    };
    if (!body.rubro || !body.zona) return toast('Completá el rubro y la zona.', 'err');
    try {
      const { job } = await api.prospectingSearch(body);
      showJob(job);
      setBusy(true);
      pollTimer = setTimeout(poll, 1500);
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  showJob(data.job);
  if (data.job && (data.job.phase === 'buscando' || data.job.phase === 'analizando')) {
    setBusy(true);
    pollTimer = setTimeout(poll, 1500);
  }
  await Promise.all([loadList(), loadNext()]);
  return () => {
    stopped = true;
    clearTimeout(pollTimer);
    clearTimeout(qTimer);
  };
}
