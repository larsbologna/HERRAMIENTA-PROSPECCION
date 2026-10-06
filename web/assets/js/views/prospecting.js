import { api } from '../api.js';
import {
  $, $$, autoGrow, copyText, date, emptyState, esc, icon, modal, number, statusOptions, toast, WA_TARGET, waMeUrl, waPhone,
} from '../ui.js';

/**
 * PROSPECTOS: el centro de trabajo.
 *   BUSCAR → ANALIZAR → FILTRAR → CONTACTAR → SEGUIR
 *
 * - Buscar: rubro, zona y cantidad. La herramienta busca, descarta repetidos y analiza cada negocio
 *   (en el servidor, de a uno, para no exigir a la PC); esta pantalla solo consulta el avance.
 * - Filtrar: estado, prioridad y rubro. Los rubros salen de la BASE (los que tienen prospectos), no
 *   de una lista fija: si buscaste veterinarias, "Veterinarias" aparece.
 * - Contactar: cada prospecto abre su mensaje (WhatsApp o Instagram), con copiar y abrir el chat.
 *   "Siguiente prospecto" recorre los no contactados de los filtros actuales (alta → media → baja).
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
const ESTADOS = [
  ['todos', 'Todos'], ['pendientes', 'No contactados'], ['contactado', 'Contactados'], ['respondieron', 'Respondieron'],
  ['sin_respuesta', 'Sin respuesta'], ['perdido', 'No interesados'], ['cliente', 'Clientes'],
];
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
const SOURCE = { google: 'categoría de Google', nombre: 'nombre del negocio', busqueda: 'búsqueda', manual: 'asignado a mano', descripcion: 'descripción', web: 'web', instagram: 'Instagram' };
const MSG_TABS = [['primerContacto', 'Completo'], ['primerContactoMedio', 'Mediano'], ['primerContactoCorto', 'Corto'], ['instagram', 'Instagram']];

/** Filtros recordados mientras la app está abierta (y "Siguiente prospecto" los respeta). */
export const filters = { estado: 'pendientes', potencial: '', rubro: '', q: '' };

export function nextUrl(f = filters) {
  const qs = new URLSearchParams(Object.entries({ rubro: f.rubro, potencial: f.potencial }).filter(([, v]) => v));
  return `/prospectos/siguiente${qs.toString() ? `?${qs}` : ''}`;
}

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

const linkIcon = (href, iconName, label, cls = '') => (href
  ? `<a class="pl-link ${cls}" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(label)}">${icon(iconName)}<span>${esc(label)}</span></a>`
  : `<span class="pl-link off" title="${esc(label)}: no disponible">${icon(iconName)}<span>${esc(label)}</span></span>`);

function rowHtml(p) {
  const wa = p.contact?.whatsappNumber;
  const opps = p.opportunities ?? [];
  return `<article class="pros-row" data-id="${esc(p.id)}">
    <div class="pros-main">
      <div class="pros-title"><a href="/prospectos/${encodeURIComponent(p.id)}" data-link class="pros-name">${esc(p.name)}</a>${potentialBadge(p.potentialLevel, p.potentialReason)}</div>
      <div class="sub">${p.rubroLabel ? `<span class="rubro-tag" title="Rubro detectado por ${esc(SOURCE[p.rubroSource] ?? p.rubroSource ?? '')}">${esc(p.rubroLabel)}</span>` : '<span class="rubro-tag none">Sin rubro · asignalo</span>'}
        ${esc(p.address ?? '')}</div>
      <div class="pl-links">
        ${p.phone ? `<span class="pl-link">${icon('phone')}<span>${esc(p.phone)}</span></span>` : '<span class="pl-link off">' + icon('phone') + '<span>Sin teléfono</span></span>'}
        ${wa ? `<span class="pl-link ok">${icon('message')}<span>WhatsApp +${esc(wa)}</span></span>` : ''}
        ${linkIcon(p.contact?.instagramUrl, 'external', 'Instagram')}
        ${linkIcon(p.contact?.websiteUrl, 'globe', 'Web')}
        ${linkIcon(p.mapsUrl, 'map', 'Google Maps')}
      </div>
      ${opps.length ? `<div class="pl-opps">${opps.map((o) => `<span class="opp-chip" title="${esc(o.area)}">${esc(o.title)}</span>`).join('')}</div>` : '<div class="faint pl-opps">Sin oportunidades confirmadas</div>'}
      <div class="faint pros-facts">${p.rating !== null ? `${String(p.rating).replace('.', ',')} ⭐` : '? calificación'} · ${p.reviewCount !== null ? `${number(p.reviewCount)} reseñas` : '? reseñas'} · analizado ${esc(date(p.analyzedAt))}</div>
    </div>
    <div class="pros-side">
      <select class="select select-sm pl-status" data-status="${esc(p.id)}" aria-label="Estado de ${esc(p.name)}">${statusOptions(p.status)}</select>
      <div class="btn-row">
        <button class="btn btn-sm btn-primary" data-msg="${esc(p.id)}">${icon('message')}Ver mensaje</button>
        <a class="btn btn-sm" href="/prospectos/${encodeURIComponent(p.id)}" data-link>${icon('audit')}Ver análisis</a>
        ${p.status === 'sin_contactar' ? `<button class="btn btn-sm" data-contacted="${esc(p.id)}">${icon('check')}Marcar contactado</button>` : ''}
      </div>
    </div>
    <div class="pl-drawer" id="drawer-${esc(p.id)}" hidden></div>
  </article>`;
}

/** Panel de contacto de un prospecto: mensaje (WhatsApp / Instagram), oportunidades con su evidencia y rubro. */
export function contactPanelHtml(c, msgKey, rubros) {
  const wa = c.whatsappNumber || waPhone(c.phone);
  const op = c.opportunities;
  const ins = c.messageInsight;
  const failed = (ins?.calidad ?? []).filter((q) => !q.ok);
  return `<div class="cp">
    <div class="cp-col">
      <div class="cp-msg-head">
        <div class="tabs cp-tabs" role="tablist" aria-label="Mensaje">${MSG_TABS.map(([k, l]) => `<button data-k="${k}" class="${msgKey === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <button class="btn btn-sm" data-regen>${icon('refresh')}Otra versión</button>
      </div>
      <textarea class="textarea wa-text cp-text" aria-label="Mensaje (editable)"></textarea>
      <div class="btn-row cp-actions">
        <button class="btn btn-sm btn-primary" data-copy>${icon('copy')}Copiar mensaje</button>
        ${wa ? `<a class="btn btn-sm btn-wa" data-wa target="${WA_TARGET}">${icon('message')}Abrir WhatsApp</a>` : `<button class="btn btn-sm" disabled title="No hay WhatsApp ni teléfono">${icon('message')}WhatsApp · no disponible</button>`}
        ${c.instagramUrl ? `<a class="btn btn-sm" data-ig href="${esc(c.instagramUrl)}" target="_blank" rel="noopener">${icon('external')}Abrir Instagram</a>` : `<button class="btn btn-sm" disabled>${icon('external')}Instagram · no disponible</button>`}
        <a class="btn btn-sm" href="${esc(c.mapsUrl)}" target="_blank" rel="noopener">${icon('map')}Google Maps</a>
      </div>
      <p class="faint cp-note">${wa ? `WhatsApp ${c.whatsappNumber ? `+${esc(c.whatsappNumber)} (confirmado en ${esc(c.whatsappSource ?? 'sus canales')})` : `+${esc(wa)} (teléfono de Google, sin confirmar WhatsApp)`}: se abre con el mensaje cargado para que lo revises; no se envía solo.` : 'Sin WhatsApp ni teléfono: copiá el mensaje y usá Instagram.'}${c.instagramUrl ? ' Para Instagram usá la pestaña "Instagram" (más corto) y pegalo en un mensaje directo.' : ''}</p>
      ${ins ? `<div class="msg-insight"><div><span class="label">Por qué este mensaje</span>${esc(ins.motivo)} · estilo ${esc(ins.estilo)}</div>
        <div><span class="label">Consecuencia que comunica</span>${esc(ins.dolor)}</div>
        <div class="faint">Fuente: ${esc(ins.fuente)} · Control de calidad: ${failed.length ? `${failed.length} punto(s) a revisar: ${esc(failed.map((q) => q.label).join('; '))}` : 'aprobado ✓'}</div></div>` : ''}
    </div>
    <div class="cp-col">
      <label class="field cp-rubro">Rubro
        <select class="select select-sm" data-rubro>
          <option value="">Sin rubro</option>
          ${rubros.map((r) => `<option value="${esc(r.key)}" ${r.key === c.rubroKey ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select></label>
      <div class="faint cp-rubro-src">${c.rubroKey ? `Detectado por ${esc(SOURCE[c.rubroSource] ?? c.rubroSource ?? '—')}${c.rubroConfidence ? ` · confianza ${esc(c.rubroConfidence)}` : ''}` : 'No se pudo detectar con seguridad: elegilo a mano.'}</div>
      ${op ? `<div class="label" style="margin-top:12px">Oportunidades (confirmadas)</div>
        ${op.opportunities.length ? `<ol class="cp-opps">${op.opportunities.map((o) => `<li><b>${esc(o.title)}</b><div>${esc(o.why)}</div><div class="faint">Fuente: ${esc(o.source)} · Evidencia: ${esc(o.evidence)} · Confianza ${esc(o.confidence)}</div></li>`).join('')}</ol>` : '<p class="faint">Sin oportunidades confirmadas: el mensaje no inventa ninguna.</p>'}
        ${op.strengths.length ? `<div class="faint">Hace bien: ${esc(op.strengths.join(', '))}.</div>` : ''}
        ${op.has.length ? `<div class="faint">Ya tiene: ${esc(op.has.join(', '))}.</div>` : ''}` : ''}
    </div>
  </div>`;
}

/** Conecta el panel de contacto (pestañas, otra versión, copiar, WhatsApp, rubro). */
export function wireContactPanel(root, card, { onRubro } = {}) {
  let key = 'primerContacto';
  let variant = 0;
  const ta = $('.cp-text', root);
  const setWa = () => {
    const a = $('[data-wa]', root);
    if (a) a.href = waMeUrl(card.whatsappNumber || waPhone(card.phone), ta.value);
  };
  const setText = () => { ta.value = card.messages[key]; autoGrow(ta); setWa(); };
  ta.oninput = () => { autoGrow(ta); setWa(); };
  for (const b of $$('.cp-tabs [data-k]', root)) {
    b.onclick = () => {
      key = b.dataset.k;
      for (const x of $$('.cp-tabs [data-k]', root)) x.classList.toggle('on', x === b);
      setText();
    };
  }
  $('[data-regen]', root).onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api.messageVariant(card.id, key, variant + 1);
      variant = r.variante;
      card.messages = { ...card.messages, ...r.mensajes };
      setText();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  };
  $('[data-copy]', root).onclick = async () => { await copyText(ta.value); toast('Mensaje copiado'); };
  $('[data-wa]', root)?.addEventListener('click', () => { void copyText(ta.value).catch(() => {}); toast('Abriendo el chat · mensaje también copiado'); });
  $('[data-ig]', root)?.addEventListener('click', () => {
    if (key !== 'instagram') { key = 'instagram'; setText(); for (const x of $$('.cp-tabs [data-k]', root)) x.classList.toggle('on', x.dataset.k === 'instagram'); }
    void copyText(ta.value).catch(() => {});
    toast('Mensaje para Instagram copiado: pegalo en un mensaje directo');
  });
  $('[data-rubro]', root).onchange = async (e) => {
    try {
      await api.setRubro(card.id, e.target.value || null);
      toast(e.target.value ? 'Rubro asignado' : 'Rubro quitado');
      onRubro?.();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
  setText();
  return { getText: () => ta.value };
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
  main.innerHTML = `
    <div class="page-head">
      <div><h1>${ctx.isAdmin ? 'Prospectos' : 'Mis prospectos'}</h1><p class="muted">Buscá, filtrá y contactá. Cada prospecto llega analizado, con su prioridad, sus oportunidades y el mensaje listo.</p></div>
      <div class="page-actions"><a class="btn btn-primary" id="next-btn" href="${nextUrl()}" data-link>Siguiente prospecto →</a></div>
    </div>
    <section class="card" id="buscar">
      <div class="card-head"><h2>Buscar prospectos</h2></div>
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
      <div class="btn-row" style="margin-top:8px"><button class="btn btn-sm" id="add-rubro" type="button">${icon('plus')}Agregar rubro</button>
        <span class="faint" style="font-size:12px;align-self:center">Busca solo ese rubro, nunca repite negocios y analiza cada uno de a uno. Puede tardar varios minutos: podés dejarlo trabajando.</span></div>
      <div id="job-box"></div>
    </section>

    <section class="card" id="lista" style="margin-top:16px">
      <div class="card-head"><h2>Prospectos encontrados</h2><span class="sub" id="pros-count"></span></div>
      <div class="toolbar">
        <select class="select" id="fl-estado" aria-label="Estado">${ESTADOS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
        <select class="select" id="fl-pot" aria-label="Prioridad"><option value="">Toda prioridad</option><option value="alto">🔥 Alta</option><option value="medio">🟡 Media</option><option value="bajo">⚪ Baja</option></select>
        <select class="select" id="fl-rubro" aria-label="Rubro"></select>
        <label class="search">${icon('search')}<input class="input" id="fl-q" type="search" placeholder="Buscar por nombre"></label>
      </div>
      <div id="pros-list"></div>
    </section>
    <p class="faint gen-footlink"><a href="/generador" data-link>Lista completa de negocios encontrados</a> (para reintentar un análisis que falló)${ctx.isAdmin ? ' · <a href="/prospectos/tabla" data-link>Vista de tabla y asignación</a>' : ''}</p>`;

  const form = $('#pros-form', main);
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
  const syncNext = () => { $('#next-btn', main).setAttribute('href', nextUrl()); };
  for (const [id, key] of [['#fl-estado', 'estado'], ['#fl-pot', 'potencial'], ['#fl-rubro', 'rubro']]) {
    const el = $(id, main);
    el.value = filters[key];
    if (el.value !== filters[key]) filters[key] = el.value;
    el.onchange = () => { filters[key] = el.value; syncNext(); loadList(); };
  }
  syncNext();
  let qTimer;
  $('#fl-q', main).value = filters.q;
  $('#fl-q', main).oninput = (e) => { filters.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(loadList, 250); };

  async function loadList() {
    const r = await api.prospectingList({ estado: filters.estado, potencial: filters.potencial, rubro: filters.rubro, q: filters.q });
    $('#pros-count', main).textContent = `${number(r.total)} prospecto${r.total === 1 ? '' : 's'}`;
    const box = $('#pros-list', main);
    box.innerHTML = r.items.length
      ? `<div class="pros-list">${r.items.slice(0, 200).map(rowHtml).join('')}</div>${r.items.length > 200 ? `<p class="faint">Mostrando 200 de ${number(r.items.length)}: usá los filtros para acotar.</p>` : ''}`
      : emptyState('search', 'Sin prospectos', filters.estado === 'pendientes' ? 'No hay prospectos sin contactar con estos filtros. Buscá nuevos arriba o cambiá los filtros.' : 'Ningún prospecto coincide con los filtros.');
    for (const s of $$('[data-status]', box)) {
      s.onchange = async () => {
        try {
          await api.contactResult(s.dataset.status, { estado: s.value });
          toast('Estado actualizado');
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    }
    for (const b of $$('[data-contacted]', box)) {
      b.onclick = async () => {
        try {
          await api.contactResult(b.dataset.contacted, { estado: 'contactado' });
          toast('Marcado como contactado');
          loadList();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    }
    for (const b of $$('[data-msg]', box)) {
      b.onclick = async () => {
        const drawer = $(`#drawer-${CSS.escape(b.dataset.msg)}`, box);
        if (!drawer.hidden) { drawer.hidden = true; return; }
        drawer.hidden = false;
        drawer.innerHTML = '<div class="skeleton" style="width:60%"></div>';
        try {
          const card = await api.quickCard(b.dataset.msg);
          drawer.innerHTML = contactPanelHtml(card, 'primerContacto', rubros);
          wireContactPanel(drawer, card, { onRubro: async () => { await refreshRubros(); loadList(); } });
        } catch (err) {
          drawer.innerHTML = `<div class="error-text">${esc(err.message)}</div>`;
        }
      };
    }
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
  if (data.job && (data.job.phase === 'buscando' || data.job.phase === 'analizando')) {
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
