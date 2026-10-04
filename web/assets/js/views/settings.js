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
    if (name === 'general') await general(box);
    else if (name === 'usuarios') await usersTab(box, ctx);
    else await activityTab(box, ctx);
  };
  for (const b of $$('[data-tab]', main)) b.onclick = () => show(b.dataset.tab);
  await show(tab);
}

// ---------------------------------------------------------------- General
async function general(box) {
  const s = await api.settings();
  const prices = s.prices;
  box.innerHTML = `
    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h2>Datos del negocio</h2><span class="sub">Se usan en los mensajes de WhatsApp</span></div>
        <form class="stack" id="form" style="gap:14px">
          <label class="field">Ciudad o zona<input class="input" name="sellerCity" maxlength="120" value="${esc(s.settings.sellerCity)}" placeholder="Ej.: Rosario"></label>
          <label class="field">Nombre de tu negocio<input class="input" name="sellerBusiness" maxlength="120" value="${esc(s.settings.sellerBusiness)}"></label>
          <p class="faint" style="font-size:12px;margin:0">Cada mensaje se firma con el nombre del usuario que lo envía (se edita en Usuarios).</p>
          <div><button class="btn btn-primary" type="submit">${icon('check')}Guardar</button></div>
        </form>
      </section>
      <section class="card">
        <div class="card-head"><h2>Datos y copia de seguridad</h2></div>
        <div class="kv"><span>Base de datos</span><code>${esc(s.databaseFile)}</code></div>
        <div class="kv"><span>Archivo de precios</span><code>${esc(s.pricesFile)}</code></div>
        <p class="muted" style="font-size:13px">Para respaldar, copiá el archivo de la base de datos o descargá una copia completa en JSON.</p>
        <a class="btn" href="/api/export" download>${icon('download')}Descargar copia (JSON)</a>
      </section>
      <section class="card span-2">
        <div class="card-head"><h2>Precios</h2><span class="sub">Moneda: ${esc(prices?.moneda ?? '—')} · ${prices?.mesesContrato ?? 12} meses de contrato${prices?.descuentoPaquete ? ` · ${prices.descuentoPaquete.porcentaje}% de descuento desde ${prices.descuentoPaquete.minimoServicios} servicios` : ''}</span></div>
        ${s.priceError ? `<div class="banner">precios.json tiene un error y se siguen usando los últimos precios válidos: ${esc(s.priceError)}</div>` : ''}
        ${prices ? `<div class="table-wrap" style="border:0;background:transparent"><table class="table" style="min-width:520px">
          <thead><tr><th>Servicio</th><th class="right">Pago inicial</th><th class="right">Mensual</th><th class="right">Total ${prices.mesesContrato ?? 12} meses</th></tr></thead>
          <tbody>${s.services.map((sv) => {
            const p = prices.servicios?.[sv.id];
            const months = prices.mesesContrato ?? 12;
            return `<tr style="cursor:default"><td class="name">${esc(sv.name)}</td>
              <td class="right num">${p ? money(p.pagoInicial) : '<span class="faint">Sin precio</span>'}</td>
              <td class="right num">${p ? money(p.mensual) : '—'}</td>
              <td class="right num">${p ? money(p.pagoInicial + p.mensual * months) : '—'}</td></tr>`;
          }).join('')}</tbody></table></div>` : ''}
        <p class="muted" style="font-size:13px;margin-bottom:0">Para cambiar precios, editá <code>precios.json</code>. Al guardarlo, el valor potencial y los presupuestos de todos los prospectos se recalculan solos.</p>
      </section>
    </div>`;
  $('#form', box).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api.saveSettings(Object.fromEntries(new FormData(e.target)));
      toast('Datos guardados');
    } catch (err) {
      toast(err.message, 'err');
    }
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
  ['asignacion', 'Asignaciones'], ['seguimiento', 'Seguimientos'], ['usuario', 'Gestión de usuarios'],
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
