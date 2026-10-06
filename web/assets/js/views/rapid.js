import { api } from '../api.js';
import { $, $$, autoGrow, copyText, esc, icon, number, statusLabel, toast, WA_TARGET, waMeUrl, waWebUrl } from '../ui.js';
import { channelChips, filters, openAddRubro, potentialBadge, SOURCE, viewUrl } from './prospecting.js';

/**
 * FICHA DE UN PROSPECTO (y "Siguiente prospecto"): toda la información de UN SOLO negocio.
 *
 *   Encabezado · Datos principales · Oportunidades · Mensaje · CONTACTO (canal recomendado)
 *   → Marcar como contactado → Siguiente prospecto (mismo rubro, estado y prioridad).
 *
 * CONTACTAR decide el canal según lo que el negocio tiene de verdad (orden configurable:
 * WhatsApp confirmado → Instagram → Teléfono → Web → Google Maps). Nunca queda sin una acción.
 * Abrir un canal NO marca "Contactado": eso lo confirmás vos al volver.
 *
 * WhatsApp: enlace oficial https://wa.me/<número>?text=<mensaje> (abre la app o WhatsApp Web con el
 * chat y el texto cargado; no se envía solo). Instagram no permite cargar texto en un chat desde
 * afuera: se abre el perfil y la versión corta queda copiada para pegar.
 */

const MSG_TABS = [['primerContacto', 'WhatsApp'], ['primerContactoCorto', 'Corto'], ['instagram', 'Instagram'], ['telefono', 'Llamada']];
const TAB_FOR = { whatsapp: 'primerContacto', instagram: 'instagram', telefono: 'telefono', web: 'primerContacto', maps: 'primerContacto' };
const ESTADO_LABEL = { pendientes: 'No contactados', todos: 'Todos', contactado: 'Contactados', respondieron: 'Respondieron', sin_respuesta: 'Sin respuesta', perdido: 'No interesados', cliente: 'Clientes' };
const POT_LABEL = { alto: 'prioridad alta', medio: 'prioridad media', bajo: 'prioridad baja' };

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const igUser = (u) => { const m = String(u).match(/instagram\.com\/([^/?#]+)/i); return m ? `@${m[1]}` : 'Instagram'; };
const row = (label, sym, cls, html) => `<div class="pv-row"><dt>${esc(label)}</dt><dd><span class="ch-sym ${cls}">${sym}</span><span class="pv-val">${html}</span></dd></div>`;

function dataHtml(c, rubros) {
  const plan = c.contactPlan;
  const wa = plan.whatsapp;
  const maps = c.mapsUrl ? `<a href="${esc(c.mapsUrl)}" target="_blank" rel="noopener">${c.rating !== null ? `⭐ ${String(c.rating).replace('.', ',')}` : '⭐ ?'} · ${c.reviewCount !== null ? `${number(c.reviewCount)} reseñas` : '? reseñas'}</a>` : 'Sin ficha';
  return `<dl class="pv-data">
    ${row('Google Maps', 'G', 'ch-ok', maps)}
    ${plan.phone ? row('Teléfono', '✓', 'ch-ok', esc(plan.phone.display)) : row('Teléfono', '✕', 'ch-no', 'No detectado')}
    ${wa.state === 'confirmado' ? row('WhatsApp', '✓', 'ch-ok', `+${esc(wa.number)} <span class="faint">· confirmado${wa.source ? ` en ${esc(wa.source)}` : ''}</span>`)
      : wa.state === 'sin_confirmar' ? row('WhatsApp', '?', 'ch-unk', 'No confirmado <span class="faint">· el teléfono es un celular, puede que tenga WhatsApp</span>')
      : row('WhatsApp', '✕', 'ch-no', 'No detectado')}
    ${plan.instagramUrl ? row('Instagram', '✓', 'ch-ok', `<a href="${esc(plan.instagramUrl)}" target="_blank" rel="noopener">${esc(igUser(plan.instagramUrl))}</a>`) : row('Instagram', '✕', 'ch-no', 'No detectado')}
    ${plan.websiteUrl ? row('Web', '✓', 'ch-ok', `<a href="${esc(plan.websiteUrl)}" target="_blank" rel="noopener">${esc(hostOf(plan.websiteUrl))}</a>`) : row('Web', '✕', 'ch-no', 'Sin web propia')}
  </dl>
  ${plan.direct ? '' : '<p class="pv-nodirect">Sin canal directo detectado (ni WhatsApp, ni Instagram, ni teléfono). Es una característica del negocio: probá por la web o la ficha de Google Maps.</p>'}
  <label class="field pv-rubro">Rubro
    <select class="select select-sm" data-rubro>
      <option value="">Sin rubro (elegilo)</option>${rubros.map((r) => `<option value="${esc(r.key)}" ${r.key === c.rubroKey ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
    </select></label>
  <div class="faint pv-rubro-src">${c.rubroKey ? `Detectado por ${esc(SOURCE[c.rubroSource] ?? c.rubroSource ?? '—')}${c.rubroConfidence ? ` · confianza ${esc(c.rubroConfidence)}` : ''}` : 'No se pudo detectar con seguridad.'} · <button class="linkish" type="button" data-add-rubro>Agregar rubro</button></div>`;
}

function oppsHtml(c) {
  const op = c.opportunities;
  if (!op?.opportunities.length) return '<p class="faint">Sin oportunidades confirmadas: el mensaje no inventa ninguna.</p>';
  return `<ol class="pv-opps">${op.opportunities.slice(0, 5).map((o) => `<li><details><summary><b>${esc(o.title)}</b><span class="pv-more">Ver detalle</span></summary>
      <div class="pv-opp-why">${esc(o.why)}</div>
      <div class="faint">Fuente: ${esc(o.source)} · Evidencia: ${esc(o.evidence)} · Confianza ${esc(o.confidence)}</div></details></li>`).join('')}</ol>
    ${op.strengths.length ? `<p class="faint pv-strengths">Hace bien: ${esc(op.strengths.join(', '))}.</p>` : ''}`;
}

/** Botón de un canal. Todos son enlaces normales (target propio): nada se envía solo. */
function actionBtn(kind, plan, c, { big = false } = {}) {
  const cls = `btn ${big ? 'btn-primary pv-big' : 'btn-sm'}`;
  switch (kind) {
    case 'whatsapp':
      return `<a class="${cls} btn-wa" data-act="whatsapp" target="${WA_TARGET}" rel="noopener">${icon('message')}${big ? 'Contactar por WhatsApp' : 'Abrir WhatsApp'}</a>`;
    case 'instagram':
      return `<a class="${cls}" data-act="instagram" href="${esc(plan.instagramUrl)}" target="_blank" rel="noopener">${icon('external')}${big ? 'Contactar por Instagram' : 'Abrir Instagram'}</a>`;
    case 'telefono':
      return `<a class="${cls}" data-act="telefono" href="${esc(plan.phone.tel)}">${icon('phone')}Llamar${big ? ` · ${esc(plan.phone.display)}` : ''}</a>`;
    case 'web':
      return `<a class="${cls}" data-act="web" href="${esc(plan.websiteUrl)}" target="_blank" rel="noopener">${icon('globe')}Abrir web</a>`;
    default:
      return `<a class="${cls}" data-act="maps" href="${esc(c.mapsUrl)}" target="_blank" rel="noopener">${icon('map')}Abrir Google Maps</a>`;
  }
}

const NOTE = {
  whatsapp: (p) => `Abre la conversación con +${esc(p.whatsapp.number)} y el mensaje ya cargado: revisalo y tocá Enviar (no se envía solo). Si no se abre la app, usá "WhatsApp Web" o "Usar número".`,
  instagram: () => 'Instagram no permite cargar el texto en un chat desde afuera: se abre el perfil y la versión para Instagram queda copiada. Tocá "Enviar mensaje" en el perfil y pegala.',
  telefono: (p) => `Desde el celular, "Llamar" marca el número. En la PC, el número queda copiado${p.whatsapp.state === 'sin_confirmar' ? '; como es un celular, también podés probar WhatsApp (sin confirmar)' : ''}. Usá la pestaña "Llamada" como guion.`,
  web: () => 'Sin WhatsApp, Instagram ni teléfono: buscá el formulario o el contacto en la web. El mensaje queda copiado.',
  maps: () => 'No se detectó ningún canal directo: abrí la ficha de Google Maps para buscar otro contacto. El mensaje queda copiado.',
};

function contactHtml(c) {
  const plan = c.contactPlan;
  const others = plan.available.filter((k) => k !== plan.recommended);
  const extra = [
    plan.recommended === 'whatsapp' ? `<a class="btn btn-sm" data-act="waweb" target="whatsapp" rel="noopener noreferrer">${icon('external')}WhatsApp Web</a>` : '',
    plan.recommended === 'whatsapp' ? `<button class="btn btn-sm" type="button" data-copy-wa>${icon('copy')}Usar número</button>` : '',
    plan.whatsapp.state === 'sin_confirmar' ? `<a class="btn btn-sm" data-act="watry" target="${WA_TARGET}" rel="noopener" title="El teléfono es un celular, pero no se confirmó que tenga WhatsApp">${icon('message')}Probar WhatsApp (sin confirmar)</a>` : '',
    plan.phone ? `<button class="btn btn-sm" type="button" data-copy-phone>${icon('copy')}Copiar teléfono</button>` : '',
    plan.direct ? '' : `<button class="btn btn-sm" type="button" data-copy-name>${icon('copy')}Copiar nombre</button>`,
  ];
  return `<div class="pv-rec"><span class="label">Canal recomendado</span><b>${esc(plan.reason)}</b></div>
    <div class="pv-main-action">${actionBtn(plan.recommended, plan, c, { big: true })}</div>
    <div class="btn-row pv-alt">${others.map((k) => actionBtn(k, plan, c)).join('')}${extra.join('')}</div>
    <p class="faint pv-note">${NOTE[plan.recommended](plan)}</p>
    <div class="pv-prompt" id="rq-prompt" hidden>
      <span>¿Pudiste contactarlo?</span>
      <button class="btn btn-sm btn-primary" type="button" data-mark>${icon('check')}Marcar como contactado</button>
      <button class="btn btn-sm" type="button" data-mark-next>Contactado y siguiente →</button>
    </div>`;
}

function cardHtml(c, rubros) {
  const plan = c.contactPlan;
  const ins = c.messageInsight;
  const failed = (ins?.calidad ?? []).filter((q) => !q.ok);
  const tab = TAB_FOR[plan.recommended];
  return `<article class="pv-card rq-card" data-id="${esc(c.id)}">
    <header class="card pv-head">
      <div class="pv-head-main">
        <h1 class="rq-name">${esc(c.name)}</h1>
        <div class="sub">${esc([c.rubroLabel ?? 'Sin rubro', c.address].filter(Boolean).join(' · '))}</div>
        <div class="pc-chips">${channelChips(plan)}</div>
      </div>
      <div class="pv-head-side">${potentialBadge(c.potentialLevel, c.potentialReason)}<span class="st-pill st-${esc(c.status)}" id="rq-status">${esc(statusLabel(c.status))}</span></div>
      ${c.potentialReason ? `<p class="rq-reason">${esc(c.potentialReason)}</p>` : ''}
    </header>
    <div class="pv-grid">
      <div class="pv-col">
        <section class="card pv-sec" id="datos"><h2>Datos principales</h2>${dataHtml(c, rubros)}</section>
        <section class="card pv-sec" id="oportunidades"><h2>Oportunidades detectadas</h2>${oppsHtml(c)}</section>
      </div>
      <div class="pv-col">
        <section class="card pv-sec pv-contact" id="contacto"><h2>Contacto</h2>${contactHtml(c)}</section>
        <section class="card pv-sec" id="mensaje">
          <div class="pv-msg-head"><h2>Mensaje</h2><button class="btn btn-sm" type="button" data-regen>${icon('refresh')}Otra versión</button></div>
          <div class="tabs cp-tabs" role="tablist" aria-label="Mensaje">${MSG_TABS.map(([k, l]) => `<button type="button" data-k="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
          <textarea class="textarea wa-text cp-text" aria-label="Mensaje (editable)"></textarea>
          <div class="btn-row pv-msg-actions">
            <button class="btn btn-sm" type="button" data-copy>${icon('copy')}Copiar mensaje</button>
            ${actionBtn(plan.recommended, plan, c).replace('class="btn btn-sm', 'class="btn btn-sm btn-primary').replace(/data-act="(\w+)"/, 'data-act="$1" data-dup')}
          </div>
          ${ins ? `<details class="pv-why"><summary>Por qué este mensaje</summary>
            <div>${esc(ins.motivo)} · estilo ${esc(ins.estilo)}${ins.cta ? ` · cierre ${esc(ins.cta)}` : ''}</div>
            <div>${esc(ins.dolor)}</div>
            <div class="faint">Fuente: ${esc(ins.fuente)} · Control de calidad: ${failed.length ? `${failed.length} punto(s) a revisar: ${esc(failed.map((q) => q.label).join('; '))}` : 'aprobado ✓'}</div></details>` : ''}
        </section>
      </div>
    </div>
    <div class="card pv-result rq-result">
      <button class="btn btn-primary rq-big" type="button" id="rq-done">${icon('check')}Marcar como contactado</button>
      <button class="btn" type="button" id="rq-no">${icon('trash')}No interesado</button>
      <a class="btn" href="/prospectos/${encodeURIComponent(c.id)}" data-link>${icon('audit')}Ver análisis completo</a>
      <button class="btn rq-big" type="button" id="rq-next">Siguiente prospecto →</button>
    </div>
  </article>`;
}

export async function render(main, params = {}) {
  const qs = new URLSearchParams(location.search);
  const filter = { rubro: qs.get('rubro') ?? '', potencial: qs.get('potencial') ?? '', estado: qs.get('estado') || 'pendientes' };
  // La lista recuerda los mismos filtros al volver.
  Object.assign(filters, { rubro: filter.rubro, potencial: filter.potencial, estado: filter.estado });
  let rubros = (await api.rubros()).items;
  const rubroLabel = filter.rubro === 'none' ? 'Sin rubro' : rubros.find((r) => r.key === filter.rubro)?.label;

  main.innerHTML = `<div class="pv">
    <div class="pv-top rq-top">
      <a class="btn btn-sm" href="/prospeccion" data-link>${icon('arrowLeft')}Prospección</a>
      <div class="rq-title"><b id="rq-camp">${esc(rubroLabel ? rubroLabel.toUpperCase() : 'TODOS LOS RUBROS')}</b><span id="rq-left" class="faint"></span></div>
      <button class="btn btn-sm" type="button" id="rq-next-top">Siguiente prospecto →</button>
    </div>
    <div id="rq-body"></div>
  </div>`;

  let queue = [];
  let card = null;
  let key = 'primerContacto';
  let variant = 0;
  let usedChannel = null;
  /** Salteados en esta sesión (no se vuelven a ofrecer hasta dar la vuelta). */
  const skipped = new Set();
  const loadQueue = async () => {
    queue = (await api.prospectingQueue({ rubro: filter.rubro, potencial: filter.potencial, estado: filter.estado })).items;
  };
  const setLeft = () => {
    const n = queue.length;
    const what = filter.estado === 'pendientes' ? `pendiente${n === 1 ? '' : 's'}` : `en "${ESTADO_LABEL[filter.estado] ?? filter.estado}"`;
    $('#rq-left', main).textContent = `${n} ${what}${filter.potencial ? ` · ${POT_LABEL[filter.potencial]}` : ''}`;
  };

  const show = async (id, { push = false, contactar = false } = {}) => {
    const body = $('#rq-body', main);
    setLeft();
    if (!id) {
      card = null;
      const contacted = `/prospeccion/siguiente?${new URLSearchParams(Object.entries({ rubro: filter.rubro, estado: 'contactado' }).filter(([, v]) => v))}`;
      body.innerHTML = `<section class="card empty"><div class="icon">${icon('check')}</div><h3>¡Listo! No quedan prospectos ${filter.estado === 'pendientes' ? 'sin contactar' : 'en este filtro'}${rubroLabel ? ` en ${esc(rubroLabel)}` : ''}.</h3>
        <p>Los contactados siguen guardados con su historial.</p>
        <div class="btn-row" style="justify-content:center"><a class="btn btn-primary" href="/prospeccion" data-link>Volver a Prospección</a>${filter.estado === 'pendientes' ? `<a class="btn" href="${contacted}" data-link>Ver contactados</a>` : ''}</div></section>`;
      return;
    }
    body.innerHTML = '<div class="card"><div class="skeleton" style="width:40%"></div><div class="skeleton" style="margin-top:12px"></div></div>';
    card = await api.quickCard(id);
    variant = 0;
    usedChannel = null;
    key = TAB_FOR[card.contactPlan.recommended];
    if (push) history.pushState({}, '', viewUrl(id, filter));
    body.innerHTML = cardHtml(card, rubros);
    wire();
    if (contactar) {
      const sec = $('#contacto', main);
      sec.classList.add('pv-focus');
      sec.scrollIntoView({ block: 'center' });
      $('.pv-main-action .btn', main)?.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, 0);
    }
  };

  const nextId = () => {
    const cur = card?.id;
    const pending = queue.filter((q) => q.id !== cur && !skipped.has(q.id));
    if (pending.length) return pending[0].id;
    skipped.clear(); // se terminó la vuelta: se vuelven a ofrecer los salteados
    const again = queue.find((q) => q.id !== cur)?.id;
    if (again) return again;
    // Es el último que queda en el filtro: se vuelve a mostrar (sigue pendiente).
    if (cur && queue.some((q) => q.id === cur)) { toast('Es el último prospecto que queda con estos filtros'); return cur; }
    return null;
  };
  const advance = async () => {
    if (card) skipped.add(card.id);
    await loadQueue();
    await show(nextId(), { push: true });
  };

  function wire() {
    const root = $('.rq-card', main);
    const ta = $('.cp-text', root);
    const plan = card.contactPlan;
    const setHrefs = () => {
      for (const a of $$('[data-act="whatsapp"]', root)) a.href = waMeUrl(plan.whatsapp.number, ta.value);
      for (const a of $$('[data-act="watry"]', root)) a.href = waMeUrl(plan.whatsapp.number, ta.value);
      for (const a of $$('[data-act="waweb"]', root)) a.href = waWebUrl(plan.whatsapp.number, ta.value);
    };
    const setTab = (k) => {
      key = k;
      ta.value = card.messages[k] ?? '';
      for (const x of $$('.cp-tabs [data-k]', root)) x.classList.toggle('on', x.dataset.k === k);
      autoGrow(ta);
      setHrefs();
    };
    ta.oninput = () => { autoGrow(ta); setHrefs(); };
    for (const b of $$('.cp-tabs [data-k]', root)) b.onclick = () => setTab(b.dataset.k);
    $('[data-regen]', root).onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await api.messageVariant(card.id, key, variant + 1);
        variant = r.variante;
        card.messages = { ...card.messages, ...r.mensajes };
        setTab(key);
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    };
    $('[data-copy]', root).onclick = async () => { await copyText(ta.value); toast('Mensaje copiado'); };

    // Canales: el enlace se abre solo (no se cancela); acá solo lo que acompaña (copiar, pestaña, aviso).
    const opened = (channel) => {
      usedChannel = channel;
      $('#rq-prompt', root).hidden = false;
    };
    const quiet = (p) => { void p.catch(() => {}); };
    for (const a of $$('[data-act]', root)) {
      a.addEventListener('click', () => {
        const act = a.dataset.act;
        if (act === 'whatsapp' || act === 'watry' || act === 'waweb') {
          if (!['primerContacto', 'primerContactoCorto'].includes(key)) { setTab('primerContacto'); }
          quiet(copyText(ta.value));
          toast('Abriendo WhatsApp con el mensaje cargado · revisalo y tocá Enviar');
          opened('whatsapp');
        } else if (act === 'instagram') {
          if (key !== 'instagram') setTab('instagram');
          quiet(copyText(ta.value));
          toast('Mensaje para Instagram copiado: pegalo en el chat del perfil');
          opened('instagram');
        } else if (act === 'telefono') {
          if (key !== 'telefono') setTab('telefono');
          quiet(copyText(plan.phone.display));
          toast(`Número copiado: ${plan.phone.display} · la pestaña "Llamada" tiene el guion`);
          opened('telefono');
        } else {
          quiet(copyText(ta.value));
          toast('Mensaje copiado');
          opened(act);
        }
      });
    }
    $('[data-copy-wa]', root)?.addEventListener('click', async () => { await copyText(`+${plan.whatsapp.number}`); toast(`Número de WhatsApp copiado: +${plan.whatsapp.number}`); });
    $('[data-copy-phone]', root)?.addEventListener('click', async () => { await copyText(plan.phone.display); toast('Teléfono copiado'); });
    $('[data-copy-name]', root)?.addEventListener('click', async () => { await copyText(card.name); toast('Nombre copiado'); });

    const result = async (estado, extra = {}) => {
      try {
        await api.contactResult(card.id, { estado, ...extra });
        card.status = estado;
        const pill = $('#rq-status', root);
        pill.className = `st-pill st-${estado}`;
        pill.textContent = statusLabel(estado);
        return true;
      } catch (err) {
        toast(err.message, 'err');
        return false;
      }
    };
    const markContacted = async () => {
      const ok = await result('contactado', { mensaje: ta.value, canal: usedChannel ?? plan.recommended });
      if (ok) {
        toast(`${card.name}: contactado`);
        $('#rq-prompt', root).hidden = true;
        $('#rq-done', root).disabled = true;
        $('#rq-done', root).innerHTML = `${icon('check')}Contactado`;
        $('#rq-next', root).classList.add('btn-primary');
        $('#rq-next', root).focus();
      }
      return ok;
    };
    $('#rq-done', root).onclick = markContacted;
    $('[data-mark]', root).onclick = markContacted;
    $('[data-mark-next]', root).onclick = async () => { if (await markContacted()) await advance(); };
    $('#rq-no', root).onclick = async () => { if (await result('perdido')) { toast(`${card.name}: no interesado`); await advance(); } };
    $('#rq-next', root).onclick = () => advance();
    if (card.status !== 'sin_contactar') { $('#rq-done', root).innerHTML = `${icon('check')}Marcar como contactado de nuevo`; }

    $('[data-rubro]', root).onchange = async (e) => {
      try {
        await api.setRubro(card.id, e.target.value || null);
        toast(e.target.value ? 'Rubro asignado' : 'Rubro quitado');
        await loadQueue();
        await show(card.id);
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    $('[data-add-rubro]', root).onclick = () => openAddRubro(async () => { rubros = (await api.rubros()).items; await show(card.id); });
    setTab(key);
  }

  $('#rq-next-top', main).onclick = () => advance();

  await loadQueue();
  const start = params.id ?? qs.get('id');
  await show(start ?? queue[0]?.id ?? null, { contactar: qs.get('contactar') === '1' });
  return undefined;
}
