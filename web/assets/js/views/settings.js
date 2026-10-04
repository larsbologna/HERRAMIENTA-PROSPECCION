import { api } from '../api.js';
import { $, $$, ago, dateTime, esc, icon, modal, money, toast } from '../ui.js';

let tab = 'general';

export async function render(main, params, ctx) {
  main.innerHTML = `
    <div class="page-head"><div><h1>Configuración</h1><p class="muted">Datos del negocio, precios, usuarios y registro de actividad.</p></div></div>
    <div class="tabs-line" role="tablist">
      <button data-tab="general">General</button>
      <button data-tab="usuarios">Usuarios</button>
      <button data-tab="actividad">Actividad</button>
    </div>
    <div id="tab"></div>`;
  const show = async (name) => {
    tab = name;
    for (const b of $$('[data-tab]', main)) b.classList.toggle('on', b.dataset.tab === name);
    const box = $('#tab', main);
    box.innerHTML = '<div class="card"><div class="skeleton" style="width:40%"></div></div>';
    if (name === 'general') await general(box, ctx);
    else if (name === 'usuarios') await usersTab(box, ctx);
    else await activityTab(box, ctx);
  };
  for (const b of $$('[data-tab]', main)) b.onclick = () => show(b.dataset.tab);
  await show(tab);
}

// ---------------------------------------------------------------- General
const DEFAULT_INTRO = (business) => `${business ? `Desde ${business} trabajo` : 'Trabajo'} con negocios de la zona en todo lo que es Google Maps, reseñas y atención por WhatsApp.`;
const linkUrl = (l) => (!l ? '' : /^@[\w.]+$/.test(l) ? `https://instagram.com/${l.slice(1)}` : /^https?:\/\//i.test(l) ? l : `https://${l}`);

/** Vista previa de cómo arranca el primer mensaje de WhatsApp con estos datos. */
function introPreview(d, sellerName) {
  const me = sellerName || '[tu nombre]';
  const intro = (d.sellerIntro || '').trim().replace(/([^.!?])$/, '$1.') || DEFAULT_INTRO((d.sellerBusiness || '').trim());
  const city = (d.sellerCity || '').trim();
  const link = linkUrl((d.sellerLink || '').trim());
  return `Hola, ¿cómo va? ¿Hablo con [negocio]?\n\nSoy ${me}${city ? `, de ${city}` : ''}. ${intro}\n\n…${link ? ` Podés ver lo que hago en ${link}` : ''}`;
}

function infoForm(s) {
  return `
    <h2>Datos del negocio</h2>
    <p>Se usan en los mensajes de WhatsApp de todos los prospectos. El cambio se aplica al instante.</p>
    <form class="stack" id="iform" style="gap:12px">
      <label class="field">Nombre de tu negocio<input class="input" name="sellerBusiness" maxlength="120" value="${esc(s.sellerBusiness)}" placeholder="Ej.: Gestor de Presencia Online"></label>
      <label class="field">Ciudad o zona<input class="input" name="sellerCity" maxlength="120" value="${esc(s.sellerCity)}" placeholder="Ej.: Rosario"></label>
      <label class="field">Presentación (opcional · si la dejás vacía se usa la de abajo)
        <textarea class="textarea" name="sellerIntro" maxlength="300" rows="2" placeholder="${esc(DEFAULT_INTRO(s.sellerBusiness))}">${esc(s.sellerIntro)}</textarea></label>
      <label class="field">Web o Instagram para mostrar trabajos (opcional)<input class="input" name="sellerLink" maxlength="200" value="${esc(s.sellerLink)}" placeholder="tunegocio.com o @tunegocio"></label>
      <div><div class="label">Vista previa del mensaje</div><pre class="preview" id="ipreview"></pre></div>
      <div class="error-text" id="ierr"></div>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn btn-primary">${icon('check')}Guardar</button></div>
    </form>`;
}

function pricesForm(prices, services) {
  const months = prices?.mesesContrato ?? 12;
  const pack = prices?.descuentoPaquete ?? { minimoServicios: 3, porcentaje: 0 };
  return `
    <h2>Editar precios</h2>
    <p>Al guardar se recalculan el presupuesto y el valor potencial de <b>todos</b> los prospectos.</p>
    <form class="stack" id="pform" style="gap:14px">
      <div class="grid grid-3" style="gap:10px">
        <label class="field">Moneda<input class="input" name="moneda" maxlength="3" value="${esc(prices?.moneda ?? 'ARS')}" required></label>
        <label class="field">Meses de contrato<input class="input num" name="mesesContrato" type="number" min="0" max="60" value="${months}" required></label>
        <label class="field">Descuento por paquete (%)<input class="input num" name="porcentaje" type="number" min="0" max="90" value="${pack.porcentaje}"></label>
      </div>
      <label class="field">Se aplica desde cuántos servicios<input class="input num" name="minimoServicios" type="number" min="1" max="20" value="${pack.minimoServicios}" style="max-width:160px"></label>
      <div class="table-wrap" style="border:0;background:transparent"><table class="table price-edit">
        <thead><tr><th>Servicio</th><th class="right">Pago inicial</th><th class="right">Abono mensual</th><th class="right">Total contrato</th></tr></thead>
        <tbody>${services.map((sv) => {
          const p = prices?.servicios?.[sv.id];
          return `<tr data-svc="${esc(sv.id)}" style="cursor:default"><td class="name">${esc(sv.name)}</td>
            <td><input class="input num right" data-k="pagoInicial" type="number" min="0" step="1000" value="${p ? p.pagoInicial : ''}" placeholder="Sin precio" aria-label="Pago inicial de ${esc(sv.name)}"></td>
            <td><input class="input num right" data-k="mensual" type="number" min="0" step="1000" value="${p ? p.mensual : ''}" placeholder="Sin precio" aria-label="Abono mensual de ${esc(sv.name)}"></td>
            <td class="right num" data-total></td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="faint" style="font-size:12px;margin:0">Dejá un servicio vacío para no incluirlo en los presupuestos.</p>
      <div class="error-text" id="perr"></div>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn btn-primary">${icon('check')}Guardar precios</button></div>
    </form>`;
}

async function general(box, ctx) {
  const s = await api.settings();
  const prices = s.prices;
  const st = s.settings;
  const months = prices?.mesesContrato ?? 12;
  box.innerHTML = `
    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h2>Datos del negocio</h2><button class="btn btn-sm" id="edit-info">${icon('edit')}Editar datos</button></div>
        <div class="kv"><span>Negocio</span><b>${esc(st.sellerBusiness || '—')}</b></div>
        <div class="kv"><span>Ciudad o zona</span><b>${esc(st.sellerCity || '—')}</b></div>
        <div class="kv"><span>Presentación</span><span>${esc(st.sellerIntro || 'Por defecto')}</span></div>
        <div class="kv"><span>Web / Instagram</span><span>${esc(st.sellerLink || '—')}</span></div>
        <p class="faint" style="font-size:12px;margin:10px 0 0">Se usan en los mensajes de WhatsApp. Cada mensaje se firma con el nombre del usuario que lo envía (se edita en Usuarios).</p>
      </section>
      <section class="card">
        <div class="card-head"><h2>Datos y copia de seguridad</h2></div>
        <div class="kv"><span>Base de datos</span><code>${esc(s.databaseFile)}</code></div>
        <div class="kv"><span>Archivo de precios</span><code>${esc(s.pricesFile)}</code></div>
        <p class="muted" style="font-size:13px">Para respaldar, copiá el archivo de la base de datos o descargá una copia completa en JSON.</p>
        <a class="btn" href="/api/export" download>${icon('download')}Descargar copia (JSON)</a>
      </section>
      <section class="card span-2">
        <div class="card-head"><h2>Precios</h2>
          <div class="row" style="gap:10px;align-items:center"><span class="sub">Moneda: ${esc(prices?.moneda ?? '—')} · ${months} meses de contrato${prices?.descuentoPaquete ? ` · ${prices.descuentoPaquete.porcentaje}% de descuento desde ${prices.descuentoPaquete.minimoServicios} servicios` : ''}</span>
          <button class="btn btn-sm btn-primary" id="edit-prices">${icon('edit')}Editar precios</button></div></div>
        ${s.priceError ? `<div class="banner">precios.json tiene un error y se siguen usando los últimos precios válidos: ${esc(s.priceError)}. Podés corregirlo con "Editar precios".</div>` : ''}
        ${prices ? `<div class="table-wrap" style="border:0;background:transparent"><table class="table" style="min-width:520px">
          <thead><tr><th>Servicio</th><th class="right">Pago inicial</th><th class="right">Mensual</th><th class="right">Total ${months} meses</th></tr></thead>
          <tbody>${s.services.map((sv) => {
            const p = prices.servicios?.[sv.id];
            return `<tr style="cursor:default"><td class="name">${esc(sv.name)}</td>
              <td class="right num">${p ? money(p.pagoInicial) : '<span class="faint">Sin precio</span>'}</td>
              <td class="right num">${p ? money(p.mensual) : '—'}</td>
              <td class="right num">${p ? money(p.pagoInicial + p.mensual * months) : '—'}</td></tr>`;
          }).join('')}</tbody></table></div>` : ''}
        <p class="muted" style="font-size:13px;margin-bottom:0">Al guardar, el presupuesto y el valor potencial de todos los prospectos se recalculan solos.</p>
      </section>
    </div>`;

  $('#edit-info', box).onclick = () => {
    const m = modal(infoForm(st));
    const form = $('#iform', m.root);
    const refresh = () => { $('#ipreview', m.root).textContent = introPreview(Object.fromEntries(new FormData(form)), ctx.user?.name); };
    form.addEventListener('input', refresh);
    refresh();
    $('[data-close]', m.root).onclick = () => m.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api.saveSettings(Object.fromEntries(new FormData(form)));
        m.close();
        toast('Datos guardados · los mensajes de WhatsApp ya usan la nueva información');
        general(box, ctx);
      } catch (err) {
        $('#ierr', m.root).textContent = err.message;
      }
    };
  };

  $('#edit-prices', box).onclick = () => {
    const m = modal(pricesForm(prices, s.services));
    m.root.querySelector('.modal').classList.add('modal-wide');
    const form = $('#pform', m.root);
    const totals = () => {
      const months = Number(form.mesesContrato.value) || 0;
      for (const tr of $$('[data-svc]', form)) {
        const [a, b] = ['pagoInicial', 'mensual'].map((k) => $(`[data-k="${k}"]`, tr).value);
        $('[data-total]', tr).textContent = a === '' && b === '' ? '—' : money((Number(a) || 0) + (Number(b) || 0) * months);
      }
    };
    form.addEventListener('input', totals);
    totals();
    $('[data-close]', m.root).onclick = () => m.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const servicios = {};
      for (const tr of $$('[data-svc]', form)) {
        const a = $('[data-k="pagoInicial"]', tr).value;
        const b = $('[data-k="mensual"]', tr).value;
        if (a === '' && b === '') continue;
        servicios[tr.dataset.svc] = { pagoInicial: Number(a || 0), mensual: Number(b || 0) };
      }
      const body = {
        moneda: form.moneda.value,
        mesesContrato: Number(form.mesesContrato.value),
        servicios,
        descuentoPaquete: { porcentaje: Number(form.porcentaje.value || 0), minimoServicios: Number(form.minimoServicios.value || 1) },
      };
      const btn = $('button.btn-primary', form);
      btn.disabled = true;
      try {
        const r = await api.savePrices(body);
        m.close();
        toast(`Precios guardados${r.recalculated ? ` · ${r.recalculated} prospecto${r.recalculated === 1 ? '' : 's'} recalculado${r.recalculated === 1 ? '' : 's'}` : ''}`);
        general(box, ctx);
      } catch (err) {
        $('#perr', m.root).textContent = err.message;
        btn.disabled = false;
      }
    };
  };
}

// ---------------------------------------------------------------- Usuarios
function userForm(u) {
  return `
    <h2>${u ? 'Editar usuario' : 'Nuevo usuario'}</h2>
    <p>${u ? `@${esc(u.username)}` : 'Va a poder entrar con su usuario y contraseña.'}</p>
    <form class="stack" id="uform" style="gap:12px">
      <label class="field">Nombre (firma los mensajes de WhatsApp)<input class="input" name="name" required maxlength="80" value="${esc(u?.name ?? '')}"></label>
      <label class="field">Usuario<input class="input" name="username" required pattern="[A-Za-z0-9._\\-]{3,32}" autocapitalize="none" value="${esc(u?.username ?? '')}"></label>
      <label class="field">Email (opcional)<input class="input" name="email" type="email" value="${esc(u?.email ?? '')}"></label>
      <label class="field">Rol
        <select class="select" name="role">
          <option value="vendedor" ${u?.role !== 'admin' ? 'selected' : ''}>Vendedor · sus prospectos, pipeline, notas y mensajes</option>
          <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Administrador · acceso total</option>
        </select>
      </label>
      <label class="field">${u ? 'Nueva contraseña (dejala vacía para no cambiarla)' : 'Contraseña (mínimo 8 caracteres)'}
        <input class="input" name="password" type="password" minlength="8" autocomplete="new-password" ${u ? '' : 'required'}></label>
      <div class="error-text" id="uerr"></div>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn btn-primary">${u ? 'Guardar' : 'Crear usuario'}</button></div>
    </form>`;
}

async function usersTab(box, ctx) {
  const { items } = await api.users();
  box.innerHTML = `
    <div class="toolbar"><span class="muted">${items.filter((u) => u.active).length} usuario(s) activo(s)</span><span class="spacer"></span>
      <button class="btn btn-primary" id="add">${icon('userPlus')}Nuevo usuario</button></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th class="right">Acciones</th></tr></thead>
      <tbody>${items.map((u) => `
        <tr style="cursor:default">
          <td><div class="name">${esc(u.name)}${u.id === ctx.user.id ? ' <span class="faint">(vos)</span>' : ''}</div><div class="sub">${esc(u.email ?? '')}</div></td>
          <td class="muted">@${esc(u.username)}</td>
          <td><span class="badge plain ${u.role === 'admin' ? 'role-admin' : ''}">${u.role === 'admin' ? 'Administrador' : 'Vendedor'}</span></td>
          <td>${u.active ? '<span class="badge st-respondio">Activo</span>' : '<span class="badge off">Desactivado</span>'}</td>
          <td class="muted">${u.lastLoginAt ? esc(ago(u.lastLoginAt)) : 'Nunca ingresó'}</td>
          <td class="right" style="white-space:nowrap">
            <button class="btn btn-sm" data-edit="${esc(u.id)}">Editar</button>
            ${u.id === ctx.user.id ? '' : `<button class="btn btn-sm ${u.active ? 'btn-danger' : ''}" data-toggle="${esc(u.id)}" data-active="${u.active ? 1 : 0}">${u.active ? 'Desactivar' : 'Reactivar'}</button>`}
          </td>
        </tr>`).join('')}</tbody></table></div>
    <p class="faint" style="font-size:12px">Desactivar un usuario cierra sus sesiones y le impide entrar. Sus prospectos siguen asignados: podés reasignarlos desde Prospectos.</p>`;

  const refreshMeta = async () => { ctx.meta = await api.meta(); };
  const open = (u) => {
    const m = modal(userForm(u));
    $('[data-close]', m.root).onclick = () => m.close();
    $('#uform', m.root).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      if (u && !body.password) delete body.password;
      try {
        if (u) await api.updateUser(u.id, body);
        else await api.createUser(body);
        m.close();
        toast(u ? 'Usuario actualizado' : 'Usuario creado');
        await refreshMeta();
        if (u?.id === ctx.user.id) {
          ctx.user = { ...ctx.user, name: body.name, username: String(body.username).toLowerCase() };
          ctx.refreshNav();
        }
        usersTab(box, ctx);
      } catch (err) {
        $('#uerr', m.root).textContent = err.message;
      }
    };
  };
  $('#add', box).onclick = () => open(null);
  for (const b of $$('[data-edit]', box)) b.onclick = () => open(items.find((u) => u.id === b.dataset.edit));
  for (const b of $$('[data-toggle]', box)) {
    b.onclick = async () => {
      const activate = b.dataset.active === '0';
      try {
        await api.updateUser(b.dataset.toggle, { active: activate });
        toast(activate ? 'Usuario reactivado' : 'Usuario desactivado');
        await refreshMeta();
        usersTab(box, ctx);
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  }
}

// ---------------------------------------------------------------- Actividad
const ACTION_FILTERS = [
  ['', 'Todas las acciones'], ['login', 'Inicios de sesión'], ['logout', 'Cierres de sesión'], ['estado', 'Cambios de estado'],
  ['whatsapp', 'WhatsApp'], ['nota', 'Notas'], ['notas', 'Notas internas'], ['creado', 'Análisis (nuevos)'], ['reanalisis', 'Reanálisis'],
  ['asignacion', 'Asignaciones'], ['seguimiento', 'Seguimientos'], ['usuario', 'Gestión de usuarios'], ['configuracion', 'Cambios de configuración'],
];
const filters = { userId: '', type: '' };

async function activityTab(box, ctx) {
  const { items } = await api.activity(filters);
  const statusName = (id) => ctx.meta.statuses.find((s) => s.id === id)?.label ?? id;
  box.innerHTML = `
    <div class="toolbar">
      <select class="select" id="f-user" aria-label="Usuario"><option value="">Todos los usuarios</option>${(ctx.meta.users ?? []).map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select>
      <select class="select" id="f-type" aria-label="Acción">${ACTION_FILTERS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      <span class="spacer"></span><span class="muted">${items.length} registro(s) · últimos 300</span>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Prospecto</th><th>Detalle</th></tr></thead>
      <tbody>${items.map((a) => `
        <tr style="cursor:default">
          <td class="muted num" style="white-space:nowrap">${esc(dateTime(a.createdAt))}</td>
          <td>${esc(a.userName ?? 'Sistema')}</td>
          <td>${esc(a.type === 'estado' ? `${statusName(a.fromStatus)} → ${statusName(a.toStatus)}` : a.label)}</td>
          <td>${a.prospectId ? `<a href="/prospectos/${encodeURIComponent(a.prospectId)}" data-link>${esc(a.prospectName ?? '')}</a>` : '<span class="faint">—</span>'}</td>
          <td class="muted"><div class="sub" style="max-width:360px">${esc(a.content)}</div></td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">Sin registros.</td></tr>'}</tbody></table></div>`;
  $('#f-user', box).value = filters.userId;
  $('#f-type', box).value = filters.type;
  $('#f-user', box).onchange = (e) => { filters.userId = e.target.value; activityTab(box, ctx); };
  $('#f-type', box).onchange = (e) => { filters.type = e.target.value; activityTab(box, ctx); };
}
