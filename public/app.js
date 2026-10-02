const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = { steps: [], current: null, source: null, report: null };

const els = {
  form: $('#audit-form'), url: $('#url'), submit: $('#submit'), formError: $('#form-error'), hero: $('#hero'),
  progressPanel: $('#progress-panel'), progressTitle: $('#progress-title'), pct: $('#pct'), fill: $('#progress-fill'),
  stepsList: $('#steps'), log: $('#log'), shotsPanel: $('#shots-panel'), gallery: $('#gallery'),
  reportPanel: $('#report-panel'), report: $('#report'), reportTitle: $('#report-title'),
  history: $('#history'), lightbox: $('#lightbox'), toast: $('#toast'),
};

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function scoreClass(n) { return n >= 75 ? 'good' : n >= 50 ? 'warn' : 'bad'; }

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) throw new Error(body.error || `Error ${res.status}`);
  return { status: res.status, body };
}

// ---------- Historial ----------
async function loadHistory() {
  try {
    const { body } = await api('/api/audits');
    if (!body.length) return;
    els.history.innerHTML = body.map((r) => `
      <li><a href="#/audit/${esc(r.id)}" data-id="${esc(r.id)}">
        <span class="h-name">${esc(r.name || r.id)}</span>
        <span class="h-meta">${esc(r.category || '')}${r.rating ? ` · ${r.rating.toFixed(1)}★` : ''} · ${new Date(r.createdAt).toLocaleDateString('es-ES')}</span>
        <span class="h-score ${scoreClass(r.overallScore)}">${r.overallScore}</span>
      </a></li>`).join('');
    markActive();
  } catch { /* sin historial */ }
}

function markActive() {
  els.history.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.id === state.current));
}

async function loadAgentsInfo() {
  try {
    const { body } = await api('/api/agents');
    $('#agents-info').textContent = body.length ? `Agentes IA conectados: ${body.length}` : 'Sin agentes IA conectados (opcional)';
  } catch { /* nada */ }
}

// ---------- Progreso ----------
function renderSteps(statuses = {}) {
  els.stepsList.innerHTML = state.steps.map((s) =>
    `<li class="${statuses[s.id] || 'pending'}" data-step="${s.id}"><span class="dot"></span>${esc(s.label)}</li>`).join('');
}

function setProgress(p) {
  els.fill.style.width = `${p}%`;
  els.pct.textContent = `${Math.round(p)}%`;
}

function addLog(msg, err = false) {
  const li = document.createElement('li');
  li.textContent = msg;
  if (err) li.className = 'err';
  els.log.appendChild(li);
  els.log.scrollTop = els.log.scrollHeight;
}

function addShot(shot, url) {
  els.shotsPanel.classList.remove('hidden');
  if (els.gallery.querySelector(`[data-id="${shot.id}"]`)) return;
  const fig = document.createElement('figure');
  fig.dataset.id = shot.id;
  fig.innerHTML = `<img src="${esc(url)}" alt="${esc(shot.label)}"><figcaption>${esc(shot.label)}</figcaption>`;
  els.gallery.appendChild(fig);
}

function resetView() {
  state.source?.close();
  state.report = null;
  els.log.innerHTML = '';
  els.gallery.innerHTML = '';
  els.report.innerHTML = '';
  els.shotsPanel.classList.add('hidden');
  els.reportPanel.classList.add('hidden');
  els.progressPanel.classList.add('hidden');
  setProgress(0);
}

function follow(id) {
  resetView();
  state.current = id;
  markActive();
  els.hero.classList.add('compact');
  els.progressPanel.classList.remove('hidden');
  els.progressTitle.textContent = 'Analizando…';
  const statuses = {};
  renderSteps(statuses);

  const source = new EventSource(`/api/audits/${id}/events`);
  state.source = source;
  source.onmessage = (msg) => {
    const e = JSON.parse(msg.data);
    if (e.type === 'step') {
      statuses[e.step] = e.status;
      renderSteps(statuses);
      setProgress(e.progress);
    } else if (e.type === 'log') {
      addLog(e.message);
      setProgress(e.progress);
    } else if (e.type === 'screenshot') {
      addShot(e.screenshot, e.url);
    } else if (e.type === 'done') {
      source.close();
      setProgress(100);
      els.progressTitle.textContent = 'Análisis completado';
      showReport(id, { keepProgress: true });
      loadHistory();
    } else if (e.type === 'error') {
      source.close();
      els.progressTitle.textContent = 'El análisis falló';
      addLog(e.message, true);
      els.submit.disabled = false;
    }
  };
  source.onerror = () => {
    // El servidor cierra el stream al terminar; si no hubo "done", se consulta el estado.
    source.close();
  };
}

// ---------- Informe ----------
async function showReport(id, { keepProgress = false } = {}) {
  if (!keepProgress) resetView();
  state.current = id;
  markActive();
  els.hero.classList.add('compact');

  const { status, body } = await api(`/api/audits/${id}`).catch((err) => { toast(err.message); return {}; });
  if (status === 202) return follow(id);
  if (!body || !body.id) return;
  state.report = body;

  const html = await fetch(`/api/audits/${id}/html`).then((r) => r.text());
  els.report.innerHTML = html;
  els.reportTitle.textContent = body.profile.name || 'Informe';
  $('#download-pdf').href = `/api/audits/${id}/pdf`;
  $('#download-json').href = `/api/audits/${id}`;
  $('#open-qr').href = `/r/${id}`;
  $('#open-wa').href = body.proposal.whatsappLink || '#';
  els.reportPanel.classList.remove('hidden');
  els.submit.disabled = false;

  if (!keepProgress && body.screenshots.length) {
    body.screenshots.forEach((s) => addShot(s, `/files/${id}/${s.file}`));
  }
  if (!keepProgress) els.reportPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Eventos ----------
els.form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  els.formError.textContent = '';
  els.submit.disabled = true;
  try {
    const { body } = await api('/api/audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: els.url.value.trim() }),
    });
    location.hash = `#/audit/${body.id}`;
  } catch (err) {
    els.formError.textContent = err.message;
    els.submit.disabled = false;
  }
});

$('#copy-msg').addEventListener('click', async () => {
  if (!state.report) return;
  try {
    await navigator.clipboard.writeText(state.report.proposal.whatsappMessage);
    toast('Mensaje copiado');
  } catch {
    toast('No se pudo copiar');
  }
});

$('#copy-args').addEventListener('click', async () => {
  if (!state.current) return;
  try {
    const text = await fetch(`/api/audits/${state.current}/arguments.txt`).then((r) => r.text());
    await navigator.clipboard.writeText(text);
    toast('Argumentos comerciales copiados');
  } catch {
    toast('No se pudo copiar');
  }
});

$('#download-pdf').addEventListener('click', (ev) => {
  const a = ev.currentTarget;
  if (a.dataset.busy) return ev.preventDefault();
  a.dataset.busy = '1';
  const label = a.textContent;
  a.textContent = 'Generando PDF…';
  setTimeout(() => { a.textContent = label; delete a.dataset.busy; }, 6000);
});

$('#new-audit').addEventListener('click', () => {
  location.hash = '';
  resetView();
  state.current = null;
  markActive();
  els.hero.classList.remove('compact');
  els.url.value = '';
  els.url.focus();
});

document.addEventListener('click', (ev) => {
  const img = ev.target.closest('.gallery img, .rp-shots img');
  if (img) {
    els.lightbox.querySelector('img').src = img.src;
    els.lightbox.classList.remove('hidden');
  } else if (ev.target.closest('#lightbox')) {
    els.lightbox.classList.add('hidden');
  }
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') els.lightbox.classList.add('hidden'); });

function route() {
  const m = location.hash.match(/^#\/audit\/([\w-]+)/);
  if (m && m[1] !== state.current) showReport(m[1]);
}
window.addEventListener('hashchange', route);

(async function init() {
  state.steps = await api('/api/steps').then((r) => r.body).catch(() => []);
  loadHistory();
  loadAgentsInfo();
  route();
})();
