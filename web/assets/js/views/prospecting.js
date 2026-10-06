import { api } from '../api.js';
import { $, $$, emptyState, esc, icon, modal, number, statusLabel, toast } from '../ui.js';

/**
 * PROSPECCIÓN: el centro de trabajo diario.
 *   LISTA LIMPIA → VER PROSPECTO (uno solo) → CONTACTAR → CONTACTADO → SIGUIENTE
 *
 * - Buscar negocios: rubro, zona y cantidad (panel que se abre desde la barra superior). La búsqueda
 *   y el análisis corren en el servidor; esta pantalla solo consulta el avance.
 * - Filtros: estado, rubro (salen de la BASE: los que tienen prospectos) y prioridad.
 * - La lista muestra SOLO lo esencial de cada negocio (nombre, rubro, zona, prioridad, reseñas,
 *   canales y estado). El análisis, las oportunidades y el mensaje están en la ficha individual.
 */

const CANTIDADES = [10, 20, 30, 50];
const POT = {
  alto: { label: 'Alta', cls: 'pot-alto', emoji: '🔥' },
  medio: { label: 'Media', cls: 'pot-medio', emoji: '🟡' },
  bajo: { label: 'Baja', cls: 'pot-bajo', emoji: '⚪' },
};
/** Prioridad (antes "potencial"): alta, media o baja, con su motivo. */
export const potentialBadge = (level, reason) => {
  const p = POT[level];
  return p ? `<span class="pot ${p.cls}" title="${esc(reason ?? '')}">${p.emoji} PRIORIDAD ${p.label.toUpperCase()}</span>` : '<span class="pot pot-none" title="Sin calcular">— Sin prioridad</span>';
};
/** Estados principales (botones) y el resto en "Más estados". */
const ESTADOS_MAIN = [['todos', 'Todos'], ['pendientes', 'No contactados'], ['contactado', 'Contactados']];
const ESTADOS_MAS = [['respondieron', 'Respondieron'], ['sin_respuesta', 'Sin respuesta'], ['perdido', 'No interesados'], ['cliente', 'Clientes']];
const MODELOS = [
  ['turnos', 'Turnos (veterinarias, barberías, consultorios…)'],
  ['reservas', 'Reservas (restaurantes, alojamiento…)'],
  ['productos', 'Productos y pedidos (pet shops, ferreterías, tiendas…)'],
  ['consultas', 'Consultas (inmobiliarias, estudios, gimnasios…)'],
];
const ITEM_STATE = {
  pendiente: ['○', 'faint', 'En espera'],
  analizando: ['…', 'job-run', 'Analizando'],
  listo: ['✓', 'job-ok', 'Analizado'],
  reutilizado: ['✓', 'job-ok', 'Análisis reciente reutilizado'],
  duplicado: ['=', 'faint', 'Duplicado (no se repite)'],
  error: ['!', 'job-err', 'No se pudo analizar'],
};
export const SOURCE = { google: 'categoría de Google', nombre: 'nombre del negocio', busqueda: 'búsqueda', manual: 'asignado a mano', descripcion: 'descripción', web: 'web', instagram: 'Instagram' };

/** Filtros recordados mientras la app está abierta (y "Siguiente prospecto" los respeta). */
export const filters = { estado: 'pendientes', potencial: '', rubro: '', q: '' };

const filterQs = (f = filters, extra = {}) => {
  const qs = new URLSearchParams(Object.entries({ rubro: f.rubro, potencial: f.potencial, estado: f.estado === 'pendientes' ? '' : f.estado, ...extra }).filter(([, v]) => v));
  return qs.toString() ? `?${qs}` : '';
};
/** "Siguiente prospecto" con los filtros actuales (rubro, estado y prioridad). */
export function nextUrl(f = filters) {
  return `/prospeccion/siguiente${filterQs(f)}`;
}
/** Ficha de un prospecto, conservando los filtros (para que "Siguiente" siga en el mismo rubro). */
export function viewUrl(id, f = filters, extra = {}) {
  return `/prospeccion/p/${encodeURIComponent(id)}${filterQs(f, extra)}`;
}

/** Zona a partir de la dirección de Google ("Laprida 200, B1878 Quilmes, Provincia de Buenos Aires" → "Quilmes"). */
export function zoneOf(address) {
  const parts = String(address ?? '').split(',').map((x) => x.trim()).filter(Boolean)
    .filter((x) => !/^provincia|^argentina$|^buenos aires$|^caba$/i.test(x));
  const last = parts.length > 1 ? parts.at(-1) : '';
  return last.replace(/^[A-Z]?\d{4}[A-Z]{0,3}\s*/, '').trim();
}

const CH_STATE = {
  ok: ['✓', 'ch-ok'],
  maybe: ['?', 'ch-unk'],
  no: ['✕', 'ch-no'],
};
/** Chip de canal: ✓ disponible, ? sin confirmar, ✕ no detectado. */
const chip = (label, state, title) => {
  const [sym, cls] = CH_STATE[state];
  return `<span class="pc-chip ${cls}" title="${esc(title)}"><b>${sym}</b>${esc(label)}</span>`;
};
export function channelChips(plan) {
  const wa = plan.whatsapp.state;
  return [
    chip('WhatsApp', wa === 'confirmado' ? 'ok' : wa === 'sin_confirmar' ? 'maybe' : 'no', wa === 'confirmado' ? `WhatsApp confirmado${plan.whatsapp.source ? ` en ${plan.whatsapp.source}` : ''}` : wa === 'sin_confirmar' ? 'Celular: WhatsApp sin confirmar' : 'WhatsApp no detectado'),
    chip('Instagram', plan.instagramUrl ? 'ok' : 'no', plan.instagramUrl ? 'Instagram encontrado' : 'Instagram no detectado'),
    chip('Teléfono', plan.phone ? 'ok' : 'no', plan.phone ? plan.phone.display : 'Sin teléfono'),
    chip('Web', plan.websiteUrl ? 'ok' : 'no', plan.websiteUrl ? 'Web propia' : 'Sin web propia'),
  ].join('');
}
const CONTACT_SHORT = { whatsapp: 'Contactar · WhatsApp', instagram: 'Contactar · Instagram', telefono: 'Contactar · Llamar', web: 'Contactar · Web', maps: 'Ver en Google Maps' };
const CONTACT_ICON = { whatsapp: 'message', instagram: 'external', telefono: 'phone', web: 'globe', maps: 'map' };
export const contactShort = (plan) => CONTACT_SHORT[plan.recommended];
export const contactIcon = (plan) => CONTACT_ICON[plan.recommended];

function jobHtml(job) {
  const running = job.phase === 'buscando' || job.phase === 'analizando';
  const done = job.items.filter((i) => i.state !== 'pendiente' && i.state !== 'analizando').length;
  return `<div class="job ${running ? 'running' : ''}" id="job">
    <div class="job-head"><b>${esc(job.rubro)} · ${esc(job.zona)}</b>
      <span class="faint">${running ? (job.phase === 'buscando' ? 'Buscando negocios' : `Analizando ${done} de ${job.found}`) : esc(job.phase === 'terminado' ? 'Terminado' : job.phase === 'cancelado' ? 'Cancelado' : 'Error')}</span></div>
    <div class="progress"><div class="progress-track"><i style="width:${job.percent}%"></i></div>
      <div class="progress-text"><span>${esc(job.message)}</span><b class="num">${job.percent}%</b></div></div>
    ${job.items.length ? `<ol class="job-items">${job.items.map((it) => {
      const [sym, cls, txt] = ITEM_STATE[it.state] ?? ITEM_STATE.pendiente;
      return `<li><span class="job-sym ${cls}" title="${esc(txt)}">${sym}</span><span class="job-name">${esc(it.name)}</span>${it.detail ? `<span class="faint job-detail">${esc(it.detail)}</span>` : ''}</li>`;
    }).join('')}</ol>` : ''}
    ${running ? `<div class="btn-row"><button class="btn btn-sm" id="job-cancel">${icon('trash')}Cancelar búsqueda</button></div>` : ''}
  </div>`;
}

/** Tarjeta de la lista: SOLO lo esencial. Cada una es un bloque independiente (no se pisan). */
function cardHtml(p) {
  const plan = p.contactPlan;
  const zona = zoneOf(p.address);
  const url = viewUrl(p.id);
  return `<article class="pc" data-id="${esc(p.id)}">
    <div class="pc-main">
      <div class="pc-title"><a class="pc-name" href="${url}" data-link>${esc(p.name)}</a>${potentialBadge(p.potentialLevel, p.potentialReason)}</div>
      <div class="pc-sub">${p.rubroLabel ? `<span class="rubro-tag">${esc(p.rubroLabel)}</span>` : '<span class="rubro-tag none">Sin rubro</span>'}${zona ? `<span>${esc(zona)}</span>` : ''}
        <span class="pc-facts">${p.rating !== null ? `⭐ ${String(p.rating).replace('.', ',')}` : '⭐ ?'} · ${p.reviewCount !== null ? `${number(p.reviewCount)} reseñas` : '? reseñas'}</span></div>
      <div class="pc-chips">${channelChips(plan)}${plan.direct ? '' : '<span class="pc-nodirect" title="Ni WhatsApp, ni Instagram, ni teléfono">Sin canal directo detectado</span>'}</div>
    </div>
    <div class="pc-side">
      <span class="st-pill st-${esc(p.status)}">${esc(statusLabel(p.status))}</span>
      <div class="pc-actions">
        <a class="btn btn-sm" href="${url}" data-link data-view>${icon('audit')}Ver prospecto</a>
        <a class="btn btn-sm btn-primary" href="${viewUrl(p.id, filters, { contactar: '1' })}" data-link data-contact>${icon(contactIcon(plan))}${esc(contactShort(plan))}</a>
      </div>
    </div>
  </article>`;
}

/** Modal "Agregar rubro": se guarda en la base y aparece en la búsqueda, los filtros y la asignación. */
export function openAddRubro(onDone) {
  const m = modal(`<h3>Agregar rubro</h3>
    <form id="rubro-form" class="stack" autocomplete="off">
      <label class="field">Nombre del rubro<input class="input" name="label" required minlength="3" maxlength="60" placeholder="Ej.: Pet Shops, Inmobiliarias, Ópticas"></label>
      <label class="field">¿Cómo consigue clientes?
        <select class="select" name="model">${MODELOS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
      <label class="field">Palabras que lo identifican (opcional, separadas por coma)<input class="input" name="keywords" maxlength="200" placeholder="Ej.: plantas, jardín"></label>
      <p class="faint" style="margin:0">Sirve para detectar el rubro solo (por la categoría de Google o el nombre) y para que los mensajes hablen de turnos, reservas, productos o consultas según corresponda.</p>
      <div class="btn-row"><button class="btn btn-primary" type="submit">${icon('plus')}Agregar</button><button class="btn" type="button" data-close>Cancelar</button></div>
    </form>`);
  $('[data-close]', m.root).onclick = () => m.close();
  $('#rubro-form', m.root).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api.createRubro({ label: f.get('label'), model: f.get('model'), keywords: f.get('keywords') });
      toast(r.created ? `Rubro "${r.label}" agregado` : `"${r.label}" ya existía: se usa ese`);
      m.close();
      onDone?.(r);
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

export async function render(main, _params, ctx) {
  const [data, rub] = await Promise.all([api.prospecting(), api.rubros()]);
  let rubros = rub.items;
  const running = data.job && (data.job.phase === 'buscando' || data.job.phase === 'analizando');
  main.innerHTML = `
    <div class="pp-bar">
      <h1 class="pp-title">PROSPECCIÓN</h1>
      <div class="pp-bar-actions">
        <button class="btn" id="toggle-search" aria-expanded="false" aria-controls="buscar">${icon('search')}Buscar negocios</button>
        <a class="btn btn-primary" id="next-btn" href="${nextUrl()}" data-link>Siguiente prospecto →</a>
      </div>
    </div>
    <section class="card pp-search" id="buscar" hidden>
      <form class="pros-form" id="pros-form" autocomplete="off">
        <label class="field">Rubro<select class="select" name="rubro" id="f-rubro"></select></label>
        <label class="field hidden" id="f-rubro-otro-l">Otro rubro<input class="input" id="f-rubro-otro" maxlength="80" placeholder="Ej.: Viveros"></label>
        <label class="field">Zona
          <select class="select" name="zona" id="f-zona">${data.zonas.map((z) => `<option>${esc(z)}</option>`).join('')}<option value="__otra">Otra zona…</option></select></label>
        <label class="field hidden" id="f-zona-otra-l">Otra zona<input class="input" id="f-zona-otra" maxlength="80" placeholder="Ej.: Quilmes Oeste"></label>
        <label class="field">Cantidad
          <select class="select" name="cantidad" id="f-cant">${CANTIDADES.map((c) => `<option ${c === 20 ? 'selected' : ''}>${c}</option>`).join('')}<option value="__otra">Otra…</option></select></label>
        <label class="field hidden" id="f-cant-otra-l">Cantidad<input class="input num" id="f-cant-otra" type="number" min="1" max="${data.maxCantidad}" value="15"></label>
        <button class="btn btn-primary" id="pros-go" type="submit">${icon('search')}Buscar prospectos</button>
      </form>
      <div class="pp-search-foot"><button class="btn btn-sm" id="add-rubro" type="button">${icon('plus')}Agregar rubro</button>
        <span class="faint">Busca solo ese rubro, nunca repite negocios y analiza cada uno. Podés dejarlo trabajando.</span></div>
      <div id="job-box"></div>
    </section>
    <div class="pp-filters" id="lista">
      <div class="seg" role="group" aria-label="Estado">${ESTADOS_MAIN.map(([v, l]) => `<button type="button" data-estado="${v}">${esc(l)}</button>`).join('')}</div>
      <select class="select select-sm" id="fl-estado-mas" aria-label="Más estados"><option value="">Más estados…</option>${ESTADOS_MAS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      <select class="select select-sm" id="fl-rubro" aria-label="Rubro"></select>
      <select class="select select-sm" id="fl-pot" aria-label="Prioridad"><option value="">Toda prioridad</option><option value="alto">🔥 Alta</option><option value="medio">🟡 Media</option><option value="bajo">⚪ Baja</option></select>
      <label class="search pp-q">${icon('search')}<input class="input" id="fl-q" type="search" placeholder="Buscar por nombre"></label>
      <span class="faint pp-count" id="pros-count"></span>
    </div>
    <div id="pros-list"></div>
    <p class="faint gen-footlink"><a href="/generador" data-link>Lista completa de negocios encontrados</a> (para reintentar un análisis que falló)${ctx.isAdmin ? ' · <a href="/prospectos/tabla" data-link>Vista de tabla y asignación</a>' : ''}</p>`;

  const form = $('#pros-form', main);
  const searchBox = $('#buscar', main);
  const toggleBtn = $('#toggle-search', main);
  const setSearchOpen = (open) => { searchBox.hidden = !open; toggleBtn.setAttribute('aria-expanded', String(open)); toggleBtn.classList.toggle('on', open); };
  toggleBtn.onclick = () => setSearchOpen(searchBox.hidden);

  const fillRubroSelects = () => {
    const sel = $('#f-rubro', main);
    const keep = sel.value;
    sel.innerHTML = rubros.map((r) => `<option value="${esc(r.label)}">${esc(r.label)}</option>`).join('') + '<option value="__otro">Otro (escribir)…</option>';
    if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
    // Filtro: SOLO los rubros que tienen prospectos en la base (dinámico).
    const used = rubros.filter((r) => r.count > 0);
    const fl = $('#fl-rubro', main);
    fl.innerHTML = `<option value="">Todos los rubros</option>${used.map((r) => `<option value="${esc(r.key)}">${esc(r.label)} (${r.count})</option>`).join('')}${rub.sinRubro ? `<option value="none">Sin rubro (${rub.sinRubro})</option>` : ''}`;
    fl.value = filters.rubro;
    if (fl.value !== filters.rubro) filters.rubro = fl.value = '';
  };
  const refreshRubros = async () => {
    const r = await api.rubros();
    rub.sinRubro = r.sinRubro;
    rubros = r.items;
    fillRubroSelects();
  };
  fillRubroSelects();
  const toggleOther = (sel, labelId) => { $(labelId, main).classList.toggle('hidden', !sel.value.startsWith('__')); };
  $('#f-rubro', main).onchange = (e) => toggleOther(e.target, '#f-rubro-otro-l');
  $('#f-zona', main).onchange = (e) => toggleOther(e.target, '#f-zona-otra-l');
  $('#f-cant', main).onchange = (e) => toggleOther(e.target, '#f-cant-otra-l');
  $('#add-rubro', main).onclick = () => openAddRubro(async (r) => {
    await refreshRubros();
    $('#f-rubro', main).value = r.label;
    toggleOther($('#f-rubro', main), '#f-rubro-otro-l');
  });

  // ---------------- filtros combinables (y "Siguiente prospecto" los respeta)
  const syncFilters = () => {
    $('#next-btn', main).setAttribute('href', nextUrl());
    for (const b of $$('[data-estado]', main)) b.classList.toggle('on', b.dataset.estado === filters.estado);
    $('#fl-estado-mas', main).value = ESTADOS_MAS.some(([v]) => v === filters.estado) ? filters.estado : '';
  };
  for (const b of $$('[data-estado]', main)) b.onclick = () => { filters.estado = b.dataset.estado; syncFilters(); loadList(); };
  $('#fl-estado-mas', main).onchange = (e) => { filters.estado = e.target.value || 'todos'; syncFilters(); loadList(); };
  for (const [id, key] of [['#fl-pot', 'potencial'], ['#fl-rubro', 'rubro']]) {
    const el = $(id, main);
    el.value = filters[key];
    if (el.value !== filters[key]) filters[key] = el.value;
    el.onchange = () => { filters[key] = el.value; syncFilters(); loadList(); };
  }
  syncFilters();
  let qTimer;
  $('#fl-q', main).value = filters.q;
  $('#fl-q', main).oninput = (e) => { filters.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(loadList, 250); };

  async function loadList() {
    const r = await api.prospectingList({ estado: filters.estado, potencial: filters.potencial, rubro: filters.rubro, q: filters.q });
    $('#pros-count', main).textContent = `${number(r.total)} prospecto${r.total === 1 ? '' : 's'}`;
    const box = $('#pros-list', main);
    box.innerHTML = r.items.length
      ? `<div class="pc-list">${r.items.slice(0, 200).map(cardHtml).join('')}</div>${r.items.length > 200 ? `<p class="faint">Mostrando 200 de ${number(r.items.length)}: usá los filtros para acotar.</p>` : ''}`
      : emptyState('search', 'Sin prospectos', filters.estado === 'pendientes' ? 'No hay prospectos sin contactar con estos filtros. Tocá "Buscar negocios" o cambiá los filtros.' : 'Ningún prospecto coincide con los filtros.');
    if (!r.total && !filters.rubro && !filters.q && filters.estado === 'todos') setSearchOpen(true);
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
  const setBusy = (b) => { for (const el of form.elements) el.disabled = !!b; };
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
        await refreshRubros();
        loadList();
      }
    } catch {
      if (!stopped) pollTimer = setTimeout(poll, 5000);
    }
  };

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
  if (running) {
    setSearchOpen(true);
    setBusy(true);
    pollTimer = setTimeout(poll, 1500);
  }
  await loadList();
  return () => {
    stopped = true;
    clearTimeout(pollTimer);
    clearTimeout(qTimer);
  };
}
