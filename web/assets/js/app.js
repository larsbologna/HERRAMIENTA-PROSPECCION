import { api } from './api.js';
import { $, esc, icon, modal, setStatuses, toast } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as prospect from './views/prospect.js';
import * as audits from './views/audits.js';
import * as metrics from './views/metrics.js';
import * as settings from './views/settings.js';
import * as generator from './views/generator.js';
import * as prospecting from './views/prospecting.js';
import * as prospectsTable from './views/prospects.js';
import * as rapid from './views/rapid.js';
import { renderLogin, renderSetup } from './views/auth.js';

/** Secciones del menú. `roles` limita quién las ve (sin roles = todos). */
const NAV = [
  { path: '/', label: 'Dashboard', icon: 'dashboard', view: dashboard },
  // PROSPECCIÓN: el centro de trabajo (buscar, filtrar, ver un prospecto, contactar y seguir).
  { path: '/prospeccion', label: 'Prospección', icon: 'users', view: prospecting },
  // Fuera del menú: la Prospección ya busca y analiza sola. Se entra desde Prospección (reintentar análisis fallidos).
  { path: '/generador', label: 'Generador', icon: 'zap', view: generator, hidden: true },
  { path: '/auditorias', label: 'Auditorías', icon: 'audit', view: audits, roles: ['admin'] },
  { path: '/metricas', label: 'Métricas', icon: 'chart', view: metrics, roles: ['admin'] },
  { path: '/configuracion', label: 'Configuración', icon: 'settings', view: settings, roles: ['admin'] },
];

export const ctx = { meta: null, user: null, isAdmin: false, navigate, openAnalyze, refreshNav };
let cleanup = null;
let renderToken = 0;

const allowed = (item) => !item.roles || item.roles.includes(ctx.user?.role);

function route(pathname) {
  // Ficha de UN prospecto (con contacto y "Siguiente") y su variante sin id: el primero de la cola.
  const pm = pathname.match(/^\/prospeccion\/p\/([^/]+)$/);
  if (pm) return { view: rapid, params: { id: decodeURIComponent(pm[1]) }, nav: '/prospeccion' };
  if (pathname === '/prospeccion/siguiente' || pathname === '/prospectos/siguiente' || pathname === '/prospeccion/rapida') return { view: rapid, params: {}, nav: '/prospeccion' };
  if (pathname === '/prospectos/tabla') return { view: prospectsTable, params: {}, nav: '/prospeccion' };
  // Secciones que se unificaron en Prospección (Pipeline y "Prospectos" llevan acá).
  if (pathname === '/prospectos' || pathname === '/pipeline') return { view: prospecting, params: {}, nav: '/prospeccion', redirectTo: '/prospeccion' };
  const m = pathname.match(/^\/prospectos\/([^/]+)$/);
  if (m) return { view: prospect, params: { id: decodeURIComponent(m[1]) }, nav: '/prospeccion' };
  const item = NAV.find((n) => n.path === pathname);
  // Rutas inexistentes o no permitidas para el rol → Dashboard
  if (!item || !allowed(item)) return { view: dashboard, params: {}, nav: '/', redirect: pathname !== '/' };
  return { view: item.view, params: {}, nav: item.path };
}

async function render() {
  const token = ++renderToken;
  const r = route(location.pathname);
  if (r.redirect) history.replaceState({}, '', '/');
  if (r.redirectTo) history.replaceState({}, '', r.redirectTo);
  cleanup?.();
  cleanup = null;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.getAttribute('href') === r.nav);
  const main = $('#view');
  main.innerHTML = '<div class="card"><div class="skeleton" style="width:40%"></div><div class="skeleton" style="margin-top:12px"></div></div>';
  try {
    const out = await r.view.render(main, r.params, ctx);
    if (token === renderToken) cleanup = typeof out === 'function' ? out : null;
  } catch (err) {
    if (token !== renderToken || err.status === 401) return;
    main.innerHTML = `<div class="card empty"><h3>No se pudo cargar esta sección</h3><p>${esc(err.message)}</p><button class="btn" onclick="location.reload()">Reintentar</button></div>`;
  }
  main.focus({ preventScroll: true });
}

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname) return render();
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  window.scrollTo(0, 0);
  render();
}

function refreshNav() {
  $('#nav').innerHTML = NAV.filter((n) => allowed(n) && !n.hidden).map(
    (n) => `<a href="${n.path}" data-link>${icon(n.icon)}<span>${ctx.isAdmin ? n.label : n.vendedorLabel ?? n.label}</span></a>`,
  ).join('');
  const current = route(location.pathname).nav === '/generador' ? '/prospeccion' : route(location.pathname).nav;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.getAttribute('href') === current);
  const u = ctx.user;
  const initials = u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  $('#me').innerHTML = `
    <div class="avatar">${esc(initials)}</div>
    <div class="me-text"><b>${esc(u.name)}</b><small>${u.role === 'admin' ? 'Administrador' : 'Vendedor'}</small></div>
    <button class="icon-btn" id="account" title="Mi cuenta" aria-label="Mi cuenta">${icon('settings')}</button>
    <button class="icon-btn" id="logout" title="Cerrar sesión" aria-label="Cerrar sesión">${icon('logout')}</button>`;
  $('#account').onclick = openAccount;
  $('#logout').onclick = logout;
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', () => { if (ctx.user) render(); });
// Sesión vencida o cerrada en otro lado → volver al login
window.addEventListener('auth:expired', () => {
  if (!ctx.user) return;
  ctx.user = null;
  toast('Tu sesión expiró. Volvé a iniciar sesión.', 'err');
  showAuth();
});

async function logout() {
  try { await api.logout(); } catch { /* igual se sale */ }
  ctx.user = null;
  showAuth();
}

/** Mi cuenta: datos y cambio de contraseña (todos los usuarios). */
function openAccount() {
  const u = ctx.user;
  const m = modal(`
    <h2>Mi cuenta</h2>
    <p>${esc(u.name)} · <span class="muted">@${esc(u.username)}</span> · ${u.role === 'admin' ? 'Administrador' : 'Vendedor'}</p>
    <form class="stack" id="pw" style="gap:12px">
      <label class="field">Contraseña actual<input class="input" type="password" name="current" autocomplete="current-password" required></label>
      <label class="field">Nueva contraseña (mínimo 8 caracteres)<input class="input" type="password" name="next" autocomplete="new-password" minlength="8" required></label>
      <div class="error-text" id="pw-err"></div>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn" data-close>Cancelar</button><button class="btn btn-primary">Cambiar contraseña</button></div>
    </form>`);
  $('[data-close]', m.root).onclick = () => m.close();
  $('#pw', m.root).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api.changePassword(f.get('current'), f.get('next'));
      m.close();
      toast('Contraseña actualizada');
    } catch (err) {
      $('#pw-err', m.root).textContent = err.message;
    }
  };
}

/** Modal de análisis: pegar enlace → progreso → abre el prospecto guardado. */
/**
 * Modal de análisis (flujo existente). `onDone(resultado)` es opcional: lo usa el Generador de
 * Prospectos para vincular el análisis al prospecto generado antes de abrir el informe.
 */
export function openAnalyze(prefill = '', { autostart = false, onDone } = {}) {
  const m = modal(`
    <h2>Nuevo análisis</h2>
    <p>Pegá el enlace de Google Maps del negocio (botón «Compartir» de la ficha). Queda guardado como prospecto${ctx.isAdmin ? '' : ' asignado a vos'}.</p>
    <form class="row" id="an-form">
      <input class="input" id="an-url" type="url" required placeholder="https://maps.app.goo.gl/…" value="${esc(prefill)}" autocomplete="off">
      <button class="btn btn-primary" id="an-go" type="submit">${icon('sparkles')}Analizar</button>
    </form>
    <div class="progress hidden" id="an-progress">
      <div class="progress-track"><i id="an-bar"></i></div>
      <div class="progress-text"><span id="an-step">Preparando…</span><b class="num" id="an-pct">0%</b></div>
    </div>
    <div class="error-text" id="an-error"></div>`);
  const form = $('#an-form', m.root);
  const input = $('#an-url', m.root);
  const set = (p, text) => {
    $('#an-bar', m.root).style.width = `${p}%`;
    $('#an-pct', m.root).textContent = `${Math.round(p)}%`;
    if (text) $('#an-step', m.root).textContent = text;
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#an-error', m.root).textContent = '';
    $('#an-go', m.root).disabled = true;
    input.disabled = true;
    $('#an-progress', m.root).classList.remove('hidden');
    m.lock(true);
    set(2, 'Iniciando…');
    try {
      const done = await api.analyze(input.value.trim(), (ev) => {
        if (ev.tipo === 'progreso') set(ev.porcentaje, ev.mensaje);
      });
      set(100, 'Listo');
      if (onDone) await Promise.resolve(onDone(done)).catch(() => {});
      m.lock(false);
      m.close();
      if (!done.accesible) {
        toast(`${done.nombre} ya estaba en la base y está asignado a otra persona. Se actualizó su análisis.`);
        return;
      }
      toast(done.creado ? `${done.nombre} agregado a prospectos` : `${done.nombre} actualizado con el nuevo análisis`);
      navigate(`/prospectos/${encodeURIComponent(done.prospectId)}`);
    } catch (err) {
      m.lock(false);
      $('#an-error', m.root).textContent = err.message;
      $('#an-progress', m.root).classList.add('hidden');
      $('#an-go', m.root).disabled = false;
      input.disabled = false;
      input.focus();
    }
  });
  setTimeout(() => input.focus(), 30);
  if (autostart && prefill) form.requestSubmit();
}

async function watchServer() {
  const el = $('#server-state');
  try {
    await api.status();
    el.innerHTML = '<span class="dot"></span>Conectado';
  } catch {
    el.innerHTML = '<span class="dot off"></span>Sin conexión';
  }
}

/** Pantalla de acceso (login o creación del primer administrador). */
async function showAuth() {
  cleanup?.();
  cleanup = null;
  $('#app').classList.add('hidden');
  const box = $('#auth');
  box.classList.remove('hidden');
  let state = { setupRequired: false };
  try { state = await api.authState(); } catch { /* sin conexión: login igual */ }
  const done = (user) => startApp(user);
  if (state.setupRequired) renderSetup(box, state, done);
  else renderLogin(box, done);
}

async function startApp(user) {
  ctx.user = user;
  ctx.isAdmin = user.role === 'admin';
  try {
    ctx.meta = await api.meta();
    setStatuses(ctx.meta.statuses, ctx.meta.quickStatuses);
  } catch (err) {
    if (err.status === 401) return showAuth();
    $('#auth').innerHTML = `<div class="auth-card"><h1>La herramienta no responde</h1><p class="muted">${esc(err.message)}</p></div>`;
    return;
  }
  $('#auth').classList.add('hidden');
  $('#auth').innerHTML = '';
  $('#app').classList.remove('hidden');
  refreshNav();
  render();
}

(async function init() {
  setInterval(() => { if (ctx.user) watchServer(); }, 15000);
  try {
    const { user } = await api.me();
    startApp(user);
  } catch {
    showAuth();
  }
})();
