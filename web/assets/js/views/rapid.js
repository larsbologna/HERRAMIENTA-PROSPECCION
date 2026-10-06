import { api } from '../api.js';
import { $, autoGrow, copyText, esc, icon, messageInsightHtml, number, toast, WA_TARGET, waMeUrl, waPhone } from '../ui.js';
import { potentialBadge } from './prospecting.js';

/**
 * MODO PROSPECCIÓN RÁPIDA: un prospecto a la vez, solo los NO contactados de la campaña elegida.
 *
 *   Copiar mensaje / WhatsApp → ✓ Contactado → pasa solo al siguiente.
 *   "Siguiente →" salta al próximo pendiente sin volver al listado.
 *
 * Liviano para PCs viejas: carga solo la ficha del prospecto actual (texto, sin imágenes ni webs).
 * WhatsApp se abre siempre en la MISMA pestaña (no una nueva por prospecto).
 */

const CH = {
  encontrado: ['✓', 'ch-ok', 'Encontrado'],
  no_encontrado: ['✕', 'ch-no', 'No encontrado'],
  no_verificado: ['?', 'ch-unk', 'No verificado'],
};
const chLine = (label, c, extra = '') => {
  const [sym, cls, txt] = c ? CH[c.status] ?? CH.no_verificado : CH.no_verificado;
  return `<div class="rq-ch"><span class="ch-sym ${cls}" title="${txt}">${sym}</span><b>${esc(label)}</b><span class="faint">${c ? esc(txt.toLowerCase()) : 'no verificado'}${extra ? ` · ${extra}` : ''}</span></div>`;
};
const linkBtn = (id, label, iconName, href, extra = '') =>
  href
    ? `<a class="btn ${extra}" id="${id}" href="${esc(href)}" target="_blank" rel="noopener">${icon(iconName)}${esc(label)}</a>`
    : `<button class="btn" id="${id}" disabled title="No disponible">${icon(iconName)}${esc(label)} · no disponible</button>`;

function cardHtml(c, msgKey) {
  const ch = c.channels;
  const ver = c.verified;
  const v = (ok) => (ver ? (ok ? '<span class="ok" title="Verificado">✓</span>' : '<span class="faint" title="No verificado">?</span>') : '');
  const wa = c.whatsappNumber || waPhone(c.phone);
  const waNote = c.whatsappNumber ? `+${esc(c.whatsappNumber)} (${esc(c.whatsappSource ?? 'confirmado')})` : wa ? `+${esc(wa)} · teléfono de Google, sin confirmar WhatsApp` : '';
  const op = c.opportunities;
  return `<article class="card rq-card" data-id="${esc(c.id)}">
    <div class="rq-head">
      <div><h2 class="rq-name">${esc(c.name)}</h2><div class="sub">${esc([c.category, c.address].filter(Boolean).join(' · '))}</div></div>
      ${potentialBadge(c.potentialLevel, c.potentialReason)}
    </div>
    ${c.potentialReason ? `<p class="rq-reason">${esc(c.potentialReason)}</p>` : ''}
    <div class="rq-grid">
      <div class="rq-ch"><span class="ch-sym ch-ok">G</span><b>Google Maps</b><span>${c.rating !== null ? `${String(c.rating).replace('.', ',')} ⭐ ${v(ver?.rating)}` : '? sin calificación'} — ${c.reviewCount !== null ? `${number(c.reviewCount)} reseñas ${v(ver?.reviewCount)}` : '? reseñas'}</span></div>
      ${ch ? chLine('Instagram', ch.instagram) + chLine('Web', ch.web, ch.web?.detail ? esc(ch.web.detail) : '') + chLine('WhatsApp', ch.whatsapp, c.whatsappNumber ? `+${esc(c.whatsappNumber)}` : '') + chLine('Reservas', ch.reservas, ch.reservas?.detail ? esc(ch.reservas.detail) : '')
        : '<p class="faint" style="margin:0">Análisis anterior a la verificación de canales: abrí el perfil y usá "Verificar presencia online".</p>'}
    </div>
    ${ch?.review?.length ? `<div class="alert warn rq-review"><span class="alert-icon">${icon('bell')}</span><div><b>Requiere revisión</b><ul>${ch.review.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div></div>` : ''}
    ${op ? `<div class="rq-opp">
      <div class="label">Oportunidad</div>
      <b class="rq-headline">${esc(op.headline)}</b>
      ${op.opportunities.length ? `<ul>${op.opportunities.map((o) => `<li><b>${esc(o.service)}:</b> ${esc(o.why)}</li>`).join('')}</ul>` : ''}
      ${op.has.length ? `<div class="faint rq-has">Ya tiene: ${esc(op.has.join(', '))}.</div>` : ''}
    </div>` : ''}
    <div class="rq-msg">
      <div class="rq-msg-head"><div class="label">Mensaje</div>
        <div class="rq-msg-tools">
          <div class="tabs rq-tabs" role="tablist" aria-label="Tamaño del mensaje">${[['primerContacto', 'Completo'], ['primerContactoMedio', 'Mediano'], ['primerContactoCorto', 'Corto']].map(([k, l]) => `<button data-k="${k}" class="${msgKey === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <button class="btn btn-sm" id="rq-regen" title="Generar otro texto">${icon('refresh')}Otra versión</button>
        </div></div>
      <div id="rq-insight">${messageInsightHtml(c.messageInsight)}</div>
      <textarea class="textarea wa-text" id="rq-text" aria-label="Mensaje (editable)"></textarea>
    </div>
    <div class="btn-row rq-contact">
      <button class="btn btn-primary" id="rq-copy">${icon('copy')}Copiar mensaje</button>
      ${wa ? `<a class="btn btn-wa" id="rq-wa" target="${WA_TARGET}">${icon('message')}WhatsApp</a>` : `<button class="btn" id="rq-wa" disabled title="No disponible">${icon('message')}WhatsApp · no disponible</button>`}
      ${linkBtn('rq-ig', 'Instagram', 'external', c.instagramUrl)}
      ${linkBtn('rq-maps', 'Google Maps', 'map', c.mapsUrl)}
      ${linkBtn('rq-web', 'Web', 'globe', c.websiteUrl)}
    </div>
    ${waNote ? `<p class="faint rq-note">WhatsApp: ${waNote}. Se abre siempre en la misma pestaña con el mensaje cargado; no se envía solo. Si el chat no aparece cargado, pegalo con Ctrl+V (se copia al tocar).</p>` : ''}
    <div class="rq-result">
      <button class="btn btn-primary rq-big" id="rq-done">${icon('check')}Contactado</button>
      <button class="btn" id="rq-later">${icon('clock')}Contactar después</button>
      <button class="btn" id="rq-no">${icon('trash')}No interesado</button>
      <button class="btn rq-big" id="rq-next">Siguiente →</button>
    </div>
    <div class="rq-later hidden" id="rq-later-box">
      <label class="field">Volver a contactar el<input class="input" type="date" id="rq-date"></label>
      <label class="field rq-later-note">Nota (opcional)<input class="input" id="rq-note" maxlength="200" placeholder="Ej.: abre a la tarde"></label>
      <button class="btn btn-primary" id="rq-later-ok">${icon('calendar')}Agendar</button>
    </div>
  </article>`;
}

export async function render(main, _params, ctx) {
  const qs = new URLSearchParams(location.search);
  const filter = { campana: qs.get('campana') ?? '', potencial: qs.get('potencial') ?? '' };
  const data = await api.prospecting();
  const camp = data.campaigns.find((c) => c.id === filter.campana);

  // Sin campaña elegida: elegir una (los rubros no se mezclan).
  if (!camp && !qs.get('id')) {
    main.innerHTML = `<div class="page-head"><div><h1>Prospección rápida</h1><p class="muted">Elegí la campaña: se muestran solo sus prospectos no contactados, uno por vez.</p></div>
      <a class="btn" href="/prospeccion" data-link>${icon('arrowLeft')}Volver</a></div>
      <section class="card">${data.campaigns.length ? `<div class="rq-pick">${data.campaigns.map((c) => `<a class="btn ${c.summary.notContacted ? 'btn-primary' : ''}" href="/prospeccion/rapida?campana=${encodeURIComponent(c.id)}" data-link>${esc(c.label)} · ${c.summary.notContacted} pendientes</a>`).join('')}</div>`
        : '<p class="muted" style="margin:0">Todavía no hay campañas. Buscá prospectos en la sección Prospección.</p>'}</section>`;
    return undefined;
  }

  main.innerHTML = `<div class="rq">
    <div class="rq-top">
      <a class="btn btn-sm" href="/prospeccion" data-link>${icon('arrowLeft')}Prospección</a>
      <div class="rq-title"><b id="rq-camp">${esc(camp?.label ?? 'Prospecto')}</b><span id="rq-left" class="faint"></span></div>
      <select class="select select-sm" id="rq-pot" aria-label="Potencial"><option value="">Todo potencial</option><option value="alto">🔥 Alto</option><option value="medio">🟡 Medio</option><option value="bajo">⚪ Bajo</option></select>
    </div>
    <div id="rq-body"></div>
  </div>`;
  $('#rq-pot', main).value = filter.potencial;

  let queue = [];
  let current = null;
  let card = null;
  let msgKey = 'primerContacto';
  /** Prospectos ya resueltos o salteados en esta sesión (no se vuelven a mostrar hasta recargar la cola). */
  const skipped = new Set();

  const loadQueue = async () => {
    const r = await api.prospectingQueue({ campana: filter.campana, potencial: filter.potencial });
    // Sin campaña (análisis manual) solo se muestra ese prospecto: nunca se mezclan rubros.
    queue = camp ? r.items : r.items.filter((q) => q.id === qs.get('id'));
  };
  const left = () => queue.filter((q) => q.id !== current?.id).length + (current ? 1 : 0);
  const setLeft = () => { $('#rq-left', main).textContent = `${left()} pendiente${left() === 1 ? '' : 's'}`; };

  const show = async (id) => {
    const body = $('#rq-body', main);
    if (!id) {
      current = null;
      setLeft();
      body.innerHTML = `<section class="card empty"><div class="icon">${icon('check')}</div><h3>¡Listo! No quedan prospectos pendientes${camp ? ' en esta campaña' : ''}.</h3>
        <p>Los contactados siguen guardados en el historial y en Próximos contactos.</p><a class="btn btn-primary" href="/prospeccion" data-link>Volver a Prospección</a></section>`;
      return;
    }
    body.innerHTML = '<div class="card"><div class="skeleton" style="width:40%"></div><div class="skeleton" style="margin-top:12px"></div></div>';
    card = await api.quickCard(id);
    current = { id: card.id };
    setLeft();
    body.innerHTML = cardHtml(card, msgKey);
    wire();
  };

  const nextId = () => {
    const pending = queue.filter((q) => !skipped.has(q.id) && q.id !== current?.id);
    if (pending.length) return pending[0].id;
    // Se terminó la vuelta: se vuelven a ofrecer los salteados que siguen sin contactar.
    const again = queue.filter((q) => q.id !== current?.id);
    skipped.clear();
    return again[0]?.id ?? null;
  };
  const advance = async (resolved) => {
    if (current) {
      if (resolved) queue = queue.filter((q) => q.id !== current.id);
      else skipped.add(current.id);
    }
    await show(nextId());
    window.scrollTo(0, 0);
  };

  function wire() {
    const ta = $('#rq-text', main);
    const setText = () => {
      ta.value = card.messages[msgKey];
      autoGrow(ta);
      setWa();
    };
    const setWa = () => {
      const a = $('#rq-wa', main);
      const n = card.whatsappNumber || waPhone(card.phone);
      if (a?.tagName === 'A') a.href = waMeUrl(n, ta.value);
    };
    ta.oninput = () => { autoGrow(ta); setWa(); };
    for (const b of main.querySelectorAll('.rq-tabs [data-k]')) {
      b.onclick = () => {
        msgKey = b.dataset.k;
        for (const x of main.querySelectorAll('.rq-tabs [data-k]')) x.classList.toggle('on', x === b);
        setText();
      };
    }
    setText();
    $('#rq-regen', main).onclick = async () => {
      const btn = $('#rq-regen', main);
      btn.disabled = true;
      try {
        const r = await api.messageVariant(card.id, msgKey, (card.variant ?? 0) + 1);
        card.variant = r.variante;
        card.messages = { ...card.messages, ...r.mensajes };
        $('#rq-insight', main).innerHTML = messageInsightHtml(r.insight);
        setText();
        ta.classList.remove('flash');
        void ta.offsetWidth;
        ta.classList.add('flash');
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    };
    $('#rq-copy', main).onclick = async () => { await copyText(ta.value); toast('Mensaje copiado: pegalo en WhatsApp con Ctrl+V'); };
    const wa = $('#rq-wa', main);
    if (wa?.tagName === 'A') wa.addEventListener('click', () => { void copyText(ta.value).catch(() => {}); toast('Abriendo el chat · mensaje también copiado'); });

    const result = async (estado, extra = {}) => {
      try {
        await api.contactResult(card.id, { estado, ...extra });
        return true;
      } catch (err) {
        toast(err.message, 'err');
        return false;
      }
    };
    $('#rq-done', main).onclick = async () => {
      if (await result('contactado', { mensaje: ta.value })) { toast(`${card.name}: contactado`); await advance(true); }
    };
    $('#rq-no', main).onclick = async () => {
      if (await result('perdido')) { toast(`${card.name}: no interesado`); await advance(true); }
    };
    $('#rq-later', main).onclick = () => {
      const box = $('#rq-later-box', main);
      box.classList.toggle('hidden');
      const d = new Date(Date.now() + 3 * 86_400_000);
      $('#rq-date', main).value = d.toISOString().slice(0, 10);
      $('#rq-date', main).min = new Date().toISOString().slice(0, 10);
    };
    $('#rq-later-ok', main).onclick = async () => {
      const day = $('#rq-date', main).value;
      if (!day) return toast('Elegí la fecha.', 'err');
      if (await result('contactar_despues', { fecha: `${day}T12:00:00`, nota: $('#rq-note', main).value })) {
        toast(`${card.name}: contactar el ${day.split('-').reverse().join('/')}`);
        await advance(true);
      }
    };
    $('#rq-next', main).onclick = () => advance(false);
  }

  $('#rq-pot', main).onchange = async (e) => {
    filter.potencial = e.target.value;
    const u = new URL(location.href);
    if (filter.potencial) u.searchParams.set('potencial', filter.potencial); else u.searchParams.delete('potencial');
    history.replaceState({}, '', u.pathname + u.search);
    skipped.clear();
    await loadQueue();
    await show(queue[0]?.id ?? null);
  };

  await loadQueue();
  const start = qs.get('id');
  if (start && !camp) $('#rq-camp', main).textContent = 'Prospecto';
  await show(start && (queue.some((q) => q.id === start) || !camp) ? start : queue[0]?.id ?? null);
  return undefined;
}
