import { api } from './api.js';
import { $, esc, icon, modal, setStatuses, toast } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as prospects from './views/prospects.js';
import * as prospect from './views/prospect.js';
import * as pipeline from './views/pipeline.js';
import * as audits from './views/audits.js';
import * as metrics from './views/metrics.js';
import * as settings from './views/settings.js';

const NAV = [
  { path: '/', label: 'Dashboard', icon: 'dashboard', view: dashboard },
  { path: '/prospectos', label: 'Prospectos', icon: 'users', view: prospects },
  { path: '/pipeline', label: 'Pipeline', icon: 'kanban', view: pipeline },
  { path: '/auditorias', label: 'Auditorías', icon: 'audit', view: audits },
  { path: '/metricas', label: 'Métricas', icon: 'chart', view: metrics },
  { path: '/configuracion', label: 'Configuración', icon: 'settings', view: settings },
];

export const ctx = { meta: null, navigate, openAnalyze, refreshNav };
let cleanup = null;
let renderToken = 0;

function route(pathname) {
  const m = pathname.match(/^\/prospectos\/([^/]+)$/);
  if (m) return { view: prospect, params: { id: decodeURIComponent(m[1]) }, nav: '/prospectos' };
  const item = NAV.find((n) => n.path === pathname) ?? NAV[0];
  return { view: item.view, params: {}, nav: item.path };
}

async function render() {
  const token = ++renderToken;
  const r = route(location.pathname);
  cleanup?.();
  cleanup = null;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.getAttribute('href') === r.nav);
  const main = $('#view');
  main.innerHTML = '<div class="card"><div class="skeleton" style="width:40%"></div><div class="skeleton" style="margin-top:12px"></div></div>';
  try {
    const out = await r.view.render(main, r.params, ctx);
    if (token === renderToken) cleanup = typeof out === 'function' ? out : null;
  } catch (err) {
    if (token !== renderToken) return;
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

function refreshNav(counts = {}) {
  $('#nav').innerHTML = NAV.map(
    (n) => `<a href="${n.path}" data-link>${icon(n.icon)}<span>${n.label}</span>${counts[n.path] != null ? `<span class="count">${counts[n.path]}</span>` : ''}</a>`,
  ).join('');
  const current = route(location.pathname).nav;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.getAttribute('href') === current);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', render);

/** Modal de análisis: pegar enlace → progreso → abre el prospecto guardado. */
export function openAnalyze(prefill = '', { autostart = false } = {}) {
  const m = modal(`
    <h2>Nuevo análisis</h2>
    <p>Pegá el enlace de Google Maps del negocio (botón «Compartir» de la ficha). Queda guardado como prospecto.</p>
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
      m.lock(false);
      m.close();
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
    el.innerHTML = '<span class="dot off"></span>Sin conexión con la herramienta';
  }
}

(async function init() {
  refreshNav();
  try {
    ctx.meta = await api.meta();
    setStatuses(ctx.meta.statuses);
  } catch (err) {
    $('#view').innerHTML = `<div class="card empty"><h3>La herramienta no responde</h3><p>${esc(err.message)}</p></div>`;
    return;
  }
  render();
  setInterval(watchServer, 15000);
})();
