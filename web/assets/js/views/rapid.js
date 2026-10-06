import { api } from '../api.js';
import { $, esc, icon, number, toast } from '../ui.js';
import { contactPanelHtml, filters, potentialBadge, wireContactPanel } from './prospecting.js';

/**
 * SIGUIENTE PROSPECTO: un prospecto a la vez, solo los NO contactados, respetando los filtros de
 * Prospectos (rubro y prioridad). Orden: prioridad alta → media → baja.
 *
 *   Copiar mensaje / Abrir WhatsApp / Abrir Instagram → ✓ Contactado → pasa solo al siguiente.
 *   "Siguiente →" salta sin marcar. Si estás filtrando Veterinarias, nunca aparece una barbería.
 *
 * Liviano para PCs viejas: carga solo la ficha del prospecto actual (texto, sin imágenes ni webs).
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

function cardHtml(c, rubros) {
  const ch = c.channels;
  const ver = c.verified;
  const v = (ok) => (ver ? (ok ? '<span class="ok" title="Verificado">✓</span>' : '<span class="faint" title="No verificado">?</span>') : '');
  const agenda = c.rubroModel === 'turnos' || c.rubroModel === 'reservas';
  return `<article class="card rq-card" data-id="${esc(c.id)}">
    <div class="rq-head">
      <div><h2 class="rq-name">${esc(c.name)}</h2><div class="sub">${esc([c.rubroLabel ?? 'Sin rubro', c.address].filter(Boolean).join(' · '))}</div></div>
      ${potentialBadge(c.potentialLevel, c.potentialReason)}
    </div>
    ${c.potentialReason ? `<p class="rq-reason">${esc(c.potentialReason)}</p>` : ''}
    <div class="rq-grid">
      <div class="rq-ch"><span class="ch-sym ch-ok">G</span><b>Google Maps</b><span>${c.rating !== null ? `${String(c.rating).replace('.', ',')} ⭐ ${v(ver?.rating)}` : '? sin calificación'} — ${c.reviewCount !== null ? `${number(c.reviewCount)} reseñas ${v(ver?.reviewCount)}` : '? reseñas'}</span></div>
      ${ch ? chLine('Instagram', ch.instagram) + chLine('Web', ch.web, ch.web?.detail ? esc(ch.web.detail) : '') + chLine('WhatsApp', ch.whatsapp, c.whatsappNumber ? `+${esc(c.whatsappNumber)}` : '') + (agenda ? chLine(c.rubroModel === 'turnos' ? 'Turnos online' : 'Reservas online', ch.reservas, ch.reservas?.detail ? esc(ch.reservas.detail) : '') : '')
        : '<p class="faint" style="margin:0">Análisis anterior a la verificación de canales: abrí el análisis y usá "Verificar presencia online".</p>'}
    </div>
    ${ch?.review?.length ? `<div class="alert warn rq-review"><span class="alert-icon">${icon('bell')}</span><div><b>Requiere revisión</b><ul>${ch.review.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div></div>` : ''}
    <div class="rq-panel">${contactPanelHtml(c, 'primerContacto', rubros)}</div>
    <div class="rq-result">
      <button class="btn btn-primary rq-big" id="rq-done">${icon('check')}Contactado</button>
      <button class="btn" id="rq-no">${icon('trash')}No interesado</button>
      <a class="btn" href="/prospectos/${encodeURIComponent(c.id)}" data-link>${icon('audit')}Ver análisis</a>
      <button class="btn rq-big" id="rq-next">Siguiente prospecto →</button>
    </div>
  </article>`;
}

export async function render(main) {
  const qs = new URLSearchParams(location.search);
  const filter = { rubro: qs.get('rubro') ?? '', potencial: qs.get('potencial') ?? '' };
  const rub = await api.rubros();
  const rubros = rub.items;
  const rubroLabel = filter.rubro === 'none' ? 'Sin rubro' : rubros.find((r) => r.key === filter.rubro)?.label;

  main.innerHTML = `<div class="rq">
    <div class="rq-top">
      <a class="btn btn-sm" href="/prospectos" data-link>${icon('arrowLeft')}Prospectos</a>
      <div class="rq-title"><b id="rq-camp">${esc(rubroLabel ? rubroLabel.toUpperCase() : 'TODOS LOS RUBROS')}</b><span id="rq-left" class="faint"></span></div>
      <select class="select select-sm" id="rq-pot" aria-label="Prioridad"><option value="">Toda prioridad</option><option value="alto">🔥 Alta</option><option value="medio">🟡 Media</option><option value="bajo">⚪ Baja</option></select>
    </div>
    <div id="rq-body"></div>
  </div>`;
  $('#rq-pot', main).value = filter.potencial;

  let queue = [];
  let current = null;
  let card = null;
  let panel = null;
  /** Salteados en esta sesión (no se vuelven a mostrar hasta dar la vuelta). */
  const skipped = new Set();

  const loadQueue = async () => {
    queue = (await api.prospectingQueue({ rubro: filter.rubro, potencial: filter.potencial })).items;
  };
  const setLeft = () => {
    const n = queue.length;
    $('#rq-left', main).textContent = `${n} pendiente${n === 1 ? '' : 's'}${filter.potencial ? ` · prioridad ${{ alto: 'alta', medio: 'media', bajo: 'baja' }[filter.potencial]}` : ''}`;
  };

  const show = async (id) => {
    const body = $('#rq-body', main);
    if (!id) {
      current = null;
      setLeft();
      body.innerHTML = `<section class="card empty"><div class="icon">${icon('check')}</div><h3>¡Listo! No quedan prospectos sin contactar${rubroLabel ? ` en ${esc(rubroLabel)}` : ''}.</h3>
        <p>Los contactados siguen guardados en Prospectos con su historial.</p><a class="btn btn-primary" href="/prospectos" data-link>Volver a Prospectos</a></section>`;
      return;
    }
    body.innerHTML = '<div class="card"><div class="skeleton" style="width:40%"></div><div class="skeleton" style="margin-top:12px"></div></div>';
    card = await api.quickCard(id);
    current = { id: card.id };
    setLeft();
    body.innerHTML = cardHtml(card, rubros);
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
    panel = wireContactPanel($('.rq-panel', main), card, { onRubro: async () => { await loadQueue(); setLeft(); } });
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
      if (await result('contactado', { mensaje: panel.getText() })) { toast(`${card.name}: contactado`); await advance(true); }
    };
    $('#rq-no', main).onclick = async () => {
      if (await result('perdido')) { toast(`${card.name}: no interesado`); await advance(true); }
    };
    $('#rq-next', main).onclick = () => advance(false);
  }

  $('#rq-pot', main).onchange = async (e) => {
    filter.potencial = e.target.value;
    filters.potencial = filter.potencial;
    const u = new URL(location.href);
    if (filter.potencial) u.searchParams.set('potencial', filter.potencial); else u.searchParams.delete('potencial');
    history.replaceState({}, '', u.pathname + u.search);
    skipped.clear();
    await loadQueue();
    await show(queue[0]?.id ?? null);
  };

  await loadQueue();
  const start = qs.get('id');
  await show(start ?? queue[0]?.id ?? null);
  return undefined;
}
