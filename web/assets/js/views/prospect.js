import { api } from '../api.js';
import {
  $, $$, IMP, autoGrow, confirmDialog, copyText, date, dateTime, esc, icon, money, moneyShort, number, scoreClass,
  statusLabel, statusOptions, toast, waLink,
} from '../ui.js';

function ring(score) {
  const r = 48;
  const c = 2 * Math.PI * r;
  const color = score >= 70 ? 'var(--green)' : score >= 45 ? 'var(--warn)' : 'var(--danger)';
  return `<div class="ring" role="img" aria-label="Score ${score} de 100">
    <svg width="112" height="112" viewBox="0 0 112 112"><circle cx="56" cy="56" r="${r}" fill="none" stroke="rgba(248,248,248,.07)" stroke-width="9"/>
    <circle cx="56" cy="56" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - score / 100)).toFixed(1)}"/></svg>
    <div class="v"><div><b class="num">${score}</b><small>de 100</small></div></div></div>`;
}

const fact = (label, value) => `<div class="fact"><small>${esc(label)}</small><div>${value ? esc(value) : '<span class="missing">No tiene / no detectado</span>'}</div></div>`;

function summaryCard(p) {
  const a = p.analysis ?? {};
  const prof = a.profile ?? {};
  const w = a.website;
  const metrics = a.audit?.metrics ?? {};
  const days = prof.hours ? Object.keys(prof.hours.days ?? {}).length : 0;
  const web = !prof.website ? '' : w?.isSocialOrDirectory ? 'Red social / directorio' : w?.reachable
    ? `Carga en ${Math.max(0.1, (w.loadTimeMs ?? 0) / 1000).toFixed(1).replace('.', ',')} s · ${w.mobile?.hasViewportMeta ? 'adaptada a móvil' : 'no adaptada a móvil'}`
    : 'No carga';
  return `<section class="card" id="resumen">
    <div class="card-head"><h2>Resumen</h2><span class="sub">Analizado el ${esc(date(p.analyzedAt))}</span></div>
    <div class="summary">
      ${ring(p.score)}
      <div class="area-rows">${p.areaScores.map((s) => `
        <div class="area-row"><span>${esc(s.label)}</span><span class="bar ${scoreClass(s.score)}"><i style="width:${s.score}%"></i></span><b class="num" style="text-align:right">${s.score}</b></div>`).join('')}
      </div>
    </div>
    <div class="facts">
      ${fact('Calificación', p.rating != null ? `${String(p.rating).replace('.', ',')} ★ · ${number(p.reviewCount ?? 0)} reseñas` : '')}
      ${fact('Respuesta a reseñas', metrics.ownerResponseRate != null ? `${Math.round(metrics.ownerResponseRate * 100)}% de las recientes` : '')}
      ${fact('Teléfono', p.phone)}
      ${fact('Dirección', p.address)}
      ${fact('Sitio web', web)}
      ${fact('Horarios', days ? `${days} de 7 días publicados` : prof.hours?.raw ?? '')}
      ${fact('Reservas', prof.hasBooking ? 'Botón de reserva en Maps' : '')}
      ${fact('Ficha reclamada', prof.isClaimed === undefined ? 'Sin determinar' : prof.isClaimed ? 'Sí' : 'No')}
    </div>
  </section>`;
}

function problemsCard(p) {
  return `<section class="card" id="problemas">
    <div class="card-head"><h2>Problemas encontrados</h2><span class="sub">${p.problems.length} · ${p.highImpactCount} de impacto alto</span></div>
    <div class="list-gap">${p.problems.length ? p.problems.map((a) => `
      <article class="problem ${IMP[a.impact]}">
        <div class="problem-head"><div><div class="label">Problema detectado</div><h4>${esc(a.problem)}</h4></div><span class="imp imp-${IMP[a.impact]}">${esc(a.impact)}</span></div>
        <div class="label">Motivo</div><p>${esc(a.reason)}</p>
        <div class="problem-grid">
          <div><div class="label">Servicio recomendado</div><div class="svc">${esc(a.service)}</div></div>
          <div class="benefit"><div class="label">Beneficio para el cliente</div><p>${esc(a.benefit)}</p></div>
        </div>
      </article>`).join('') : '<p class="muted">No se detectaron problemas relevantes.</p>'}
    </div></section>`;
}

function servicesCard(p) {
  return `<section class="card" id="servicios">
    <div class="card-head"><h2>Servicios recomendados</h2><span class="sub">Ordenados por encaje</span></div>
    <div class="grid grid-2">${p.services.map((s) => `
      <div class="service ${s.priority}">
        <div class="service-head"><h4>${esc(s.name)}</h4><span class="prio prio-${s.priority}">${esc(s.priority)}</span></div>
        <div class="area-row" style="grid-template-columns:auto 1fr 40px"><span class="faint" style="font-size:12px">Encaje</span><span class="bar"><i style="width:${s.fitScore}%"></i></span><b class="num" style="text-align:right;font-size:12px">${s.fitScore}%</b></div>
        ${(s.solves?.length ? s.solves : s.reasons).length ? `<div class="label" style="margin-top:10px">Resuelve</div><ul>${(s.solves?.length ? s.solves : s.reasons).slice(0, 5).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        <div class="impact">${esc(s.expectedImpact)}</div>
      </div>`).join('')}
    </div></section>`;
}

function plan(o, featured) {
  if (!o) return '';
  return `<div class="plan ${featured ? 'featured' : ''}">
    <h4>${esc(o.label)}</h4><div class="desc">${esc(o.description)}</div>
    ${o.items.length ? `<ul>${o.items.map((i) => `<li><span>${esc(i.name)}</span><span class="num">${money(i.setup)} + ${money(i.monthly)}/mes</span></li>`).join('')}</ul>` : '<p class="muted">Sin servicios.</p>'}
    <div class="tot"><span class="muted">Pago inicial</span><b class="num">${o.discountPct ? `<span class="strike">${money(o.setup)}</span>` : ''}${money(o.setupAfterDiscount)}</b></div>
    <div class="tot"><span class="muted">Mensual</span><b class="num">${money(o.monthly)}</b></div>
    <div class="tot grand"><span>Total ${o.contractMonths} meses</span><b class="num">${money(o.total)}</b></div>
    ${o.discountPct ? `<div class="faint" style="font-size:12px;margin-top:6px">Incluye ${o.discountPct}% de descuento por paquete.</div>` : ''}
  </div>`;
}

function budgetCard(p) {
  const b = p.budget;
  return `<section class="card" id="presupuesto">
    <div class="card-head"><h2>Presupuesto</h2><span class="sub">Con los precios actuales de precios.json</span></div>
    <div class="plans">${plan(b.recommended, true)}${plan(b.complete, false)}</div>
    ${b.note ? `<p class="faint" style="font-size:12px;margin:12px 0 0">${esc(b.note)}</p>` : ''}
  </section>`;
}

function valueCard(p) {
  const b = p.budget;
  return `<section class="card">
    <div class="card-head"><h2>Potencial económico</h2></div>
    <div class="money-big num">${esc(money(p.potentialValue))}</div>
    <div class="faint" style="font-size:12px;margin-bottom:12px">Plan recomendado · ${b.recommended?.contractMonths ?? 12} meses</div>
    <div class="kv"><span>Total del proyecto (plan completo)</span><b class="num">${esc(money(p.projectTotal))}</b></div>
    <div class="kv"><span>Pago inicial recomendado</span><b class="num">${esc(money(b.recommended?.setupAfterDiscount ?? 0))}</b></div>
    <div class="kv"><span>Abono mensual recomendado</span><b class="num">${esc(money(b.recommended?.monthly ?? 0))}</b></div>
    <div class="kv" style="align-items:center"><span>Valor cerrado</span>
      ${p.status === 'cliente'
        ? `<input class="input num" id="closed" type="number" min="0" step="1000" value="${p.closedValue ?? p.potentialValue}" style="width:150px;text-align:right">`
        : '<span class="faint">Se completa al pasar a Cliente</span>'}
    </div>
  </section>`;
}

function messagesCard(p) {
  return `<section class="card" id="mensajes">
    <div class="card-head"><h2>Mensaje de WhatsApp</h2><span class="sub">Editalo antes de enviarlo</span></div>
    <div class="tabs" role="tablist">
      <button class="on" data-msg="primerContacto">1er contacto</button>
      <button data-msg="primerContactoCorto">Corto</button>
      <button data-msg="seguimiento">Seguimiento</button>
    </div>
    <textarea class="textarea wa-text" id="msg"></textarea>
    <div class="btn-row">
      <button class="btn btn-sm" id="copy">${icon('copy')}Copiar</button>
      <a class="btn btn-sm" id="wa" target="_blank" rel="noopener">${icon('external')}Abrir WhatsApp</a>
      <button class="btn btn-sm btn-primary" id="sent">${icon('check')}Registrar envío</button>
    </div>
    ${p.phone && !/^(\+|00)/.test(p.phone.trim()) ? '<p class="faint" style="font-size:12px;margin:8px 0 0">El teléfono no tiene prefijo internacional: WhatsApp se abre sin destinatario.</p>' : ''}
  </section>`;
}

function notesCard(p) {
  return `<section class="card">
    <div class="card-head"><h2>Notas internas</h2><span class="save-state" id="save-state">Se guardan solas</span></div>
    <textarea class="textarea" id="notes" rows="6" placeholder="Quién atiende, qué le interesa, objeciones, próximos pasos…">${esc(p.notes)}</textarea>
  </section>`;
}

function historyCard(p, activityTypes) {
  const label = (a) => (a.type === 'estado' ? `${statusLabel(a.fromStatus)} → ${statusLabel(a.toStatus)}` : a.label);
  return `<section class="card">
    <div class="card-head"><h2>Historial</h2><span class="sub">${p.activities.length} registro${p.activities.length === 1 ? '' : 's'}</span></div>
    <form class="add-activity" id="act-form">
      <div class="row">
        <select class="select" id="act-type">${activityTypes.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select>
        <button class="btn btn-sm" type="submit" style="height:36px">${icon('plus')}Registrar</button>
      </div>
      <textarea class="textarea" id="act-text" rows="2" placeholder="¿Qué pasó? Ej.: Llamé, atiende el dueño a la tarde."></textarea>
    </form>
    <div class="timeline">${p.activities.map((a) => `
      <div class="tl tl-${esc(a.type)}">
        <div class="tl-title">${esc(label(a))}</div>
        ${a.content ? `<div class="tl-content">${esc(a.content)}</div>` : ''}
        <div class="tl-date">${esc(dateTime(a.createdAt))}</div>
      </div>`).join('')}
    </div>
  </section>`;
}

export async function render(main, { id }, ctx) {
  let p = await api.prospect(id);
  let msgKey = 'primerContacto';

  const draw = () => {
    main.innerHTML = `
      <div class="profile-head">
        <div>
          <a class="back" href="/prospectos" data-link>${icon('arrowLeft', 'width="14" height="14"')}Prospectos</a>
          <h1>${esc(p.name)}</h1>
          <div class="muted">${esc([p.category, p.verticalLabel].filter(Boolean).join(' · '))}</div>
          <div class="chips">
            <a class="chip" href="${esc(p.mapsUrl)}" target="_blank" rel="noopener">${icon('map')}${esc(p.address ?? 'Ver en Google Maps')}</a>
            ${p.phone ? `<span class="chip">${icon('phone')}${esc(p.phone)}</span>` : ''}
            ${p.website ? `<a class="chip" href="${esc(p.website)}" target="_blank" rel="noopener">${icon('globe')}${esc(p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 40))}</a>` : ''}
            ${p.rating != null ? `<span class="chip">${icon('star')}${String(p.rating).replace('.', ',')} · ${number(p.reviewCount ?? 0)} reseñas</span>` : ''}
          </div>
        </div>
        <div class="page-actions" style="align-items:flex-start">
          <select class="select" id="status" aria-label="Estado comercial" style="min-width:190px">${statusOptions(p.status)}</select>
          <button class="btn" id="reanalyze">${icon('refresh')}Reanalizar</button>
          <button class="btn btn-danger" id="delete" title="Eliminar prospecto">${icon('trash')}</button>
        </div>
      </div>
      <div class="profile">
        <div>
          <nav class="subnav"><a href="#resumen">Resumen</a><a href="#problemas">Problemas (${p.problems.length})</a><a href="#servicios">Servicios</a><a href="#presupuesto">Presupuesto</a></nav>
          <div class="stack">${summaryCard(p)}${problemsCard(p)}${servicesCard(p)}${budgetCard(p)}</div>
        </div>
        <div class="stack">${valueCard(p)}${messagesCard(p)}${notesCard(p)}${historyCard(p, ctx.meta.activityTypes)}</div>
      </div>`;
    bind();
  };

  const showMessage = () => {
    const ta = $('#msg', main);
    ta.value = p.messages[msgKey];
    autoGrow(ta);
    $('#wa', main).href = waLink(p.phone, ta.value);
    for (const b of $$('[data-msg]', main)) b.classList.toggle('on', b.dataset.msg === msgKey);
  };

  let notesTimer;
  /** Guarda una nota pendiente (si la hay) antes de redibujar, para no perder lo escrito. */
  async function flushNotes() {
    const notes = $('#notes', main);
    if (!notesTimer || !notes) return;
    clearTimeout(notesTimer);
    notesTimer = undefined;
    if (notes.value !== p.notes) {
      const saved = await api.update(id, { notes: notes.value });
      p.notes = saved.notes;
    }
  }

  function bind() {
    for (const a of $$('.subnav a', main)) {
      a.onclick = (e) => {
        e.preventDefault();
        $(a.getAttribute('href'), main)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    }
    $('#status', main).onchange = async (e) => {
      try {
        await flushNotes();
        p = await api.update(id, { status: e.target.value });
        toast(`Estado: ${statusLabel(p.status)}`);
        draw();
      } catch (err) {
        toast(err.message, 'err');
        e.target.value = p.status;
      }
    };
    $('#reanalyze', main).onclick = () => ctx.openAnalyze(p.mapsUrl, { autostart: true });
    $('#delete', main).onclick = async () => {
      if (!(await confirmDialog('Eliminar prospecto', `Se borra ${p.name} con todo su historial y auditorías. No se puede deshacer.`, 'Eliminar'))) return;
      await api.remove(id);
      toast(`${p.name} eliminado`);
      ctx.navigate('/prospectos');
    };

    // Mensajes
    for (const b of $$('[data-msg]', main)) b.onclick = () => { msgKey = b.dataset.msg; showMessage(); };
    $('#msg', main).oninput = (e) => { autoGrow(e.target); $('#wa', main).href = waLink(p.phone, e.target.value); };
    $('#copy', main).onclick = async () => { await copyText($('#msg', main).value); toast('Mensaje copiado'); };
    $('#sent', main).onclick = async () => {
      const names = { primerContacto: 'primer contacto', primerContactoCorto: 'primer contacto (corto)', seguimiento: 'seguimiento' };
      try {
        await flushNotes();
        await api.addActivity(id, 'whatsapp', `Mensaje enviado: ${names[msgKey]}\n\n${$('#msg', main).value}`);
        if (p.status === 'sin_contactar') await api.update(id, { status: 'contactado' });
        p = await api.prospect(id);
        toast(p.status === 'contactado' ? 'Envío registrado · pasó a Contactado' : 'Envío registrado');
        draw();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    showMessage();

    // Valor cerrado
    const closed = $('#closed', main);
    if (closed) {
      closed.onchange = async () => {
        try {
          p = await api.update(id, { closedValue: closed.value === '' ? null : Number(closed.value) });
          toast(`Valor cerrado: ${moneyShort(p.closedValue)}`);
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    }

    // Notas con guardado automático
    const notes = $('#notes', main);
    const state = $('#save-state', main);
    autoGrow(notes);
    notes.oninput = () => {
      autoGrow(notes);
      state.textContent = 'Escribiendo…';
      clearTimeout(notesTimer);
      notesTimer = setTimeout(async () => {
        notesTimer = undefined;
        try {
          const saved = await api.update(id, { notes: notes.value });
          p.notes = saved.notes;
          p.activities = saved.activities;
          state.textContent = `Guardado ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
        } catch (err) {
          state.textContent = `No se pudo guardar: ${err.message}`;
        }
      }, 700);
    };

    // Actividades
    $('#act-form', main).onsubmit = async (e) => {
      e.preventDefault();
      const text = $('#act-text', main).value.trim();
      if (!text) return $('#act-text', main).focus();
      try {
        await flushNotes();
        await api.addActivity(id, $('#act-type', main).value, text);
        p = await api.prospect(id);
        toast('Actividad registrada');
        draw();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  }

  draw();
  // Al salir del perfil, se guarda la nota pendiente.
  return () => { flushNotes().catch(() => {}); };
}
