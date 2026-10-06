/** Cliente de la API local. Todas las respuestas de error traen { error }. */
async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new CustomEvent('auth:expired'));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data;
}

export const api = {
  meta: () => request('GET', '/api/meta'),
  status: () => request('GET', '/api/estado'),
  dashboard: () => request('GET', '/api/dashboard'),
  metrics: () => request('GET', '/api/metrics'),
  audits: () => request('GET', '/api/audits'),
  prospects: (params = {}) => request('GET', '/api/prospects?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null))),
  prospect: (id) => request('GET', `/api/prospects/${encodeURIComponent(id)}`),
  messageVariant: (id, tipo, variante) => request('GET', `/api/prospects/${encodeURIComponent(id)}/mensaje?tipo=${encodeURIComponent(tipo)}&variante=${variante}`),
  update: (id, body) => request('PATCH', `/api/prospects/${encodeURIComponent(id)}`, body),
  setBudget: (id, override) => request('PUT', `/api/prospects/${encodeURIComponent(id)}/presupuesto`, { override }),
  remove: (id) => request('DELETE', `/api/prospects/${encodeURIComponent(id)}`),
  addActivity: (id, type, content) => request('POST', `/api/prospects/${encodeURIComponent(id)}/activities`, { type, content }),
  settings: () => request('GET', '/api/settings'),
  saveSettings: (body) => request('PUT', '/api/settings', body),
  savePrices: (prices) => request('PUT', '/api/settings/prices', { prices }),

  // Sesión y usuarios
  authState: () => request('GET', '/api/auth/estado'),
  me: () => request('GET', '/api/auth/me'),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  setup: (body) => request('POST', '/api/auth/setup', body),
  changePassword: (current, next) => request('PUT', '/api/auth/password', { current, next }),
  users: () => request('GET', '/api/users'),
  createUser: (body) => request('POST', '/api/users', body),
  updateUser: (id, body) => request('PATCH', `/api/users/${encodeURIComponent(id)}`, body),
  activity: (params = {}) => request('GET', '/api/activity?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v))),
  assign: (ids, userId) => request('POST', '/api/prospects/assign', { ids, userId }),

  // Seguimientos
  addFollowup: (id, dueAt, note) => request('POST', `/api/prospects/${encodeURIComponent(id)}/followups`, { dueAt, note }),
  setFollowup: (id, status) => request('PATCH', `/api/followups/${encodeURIComponent(id)}`, { status }),

  /** Análisis con progreso: onEvent recibe cada línea del stream. Devuelve el evento final. */
  analyze(url, onEvent) {
    return streamNdjson('/api/analizar', { url }, onEvent);
  },

  // Generador de Prospectos
  generate: (body, onEvent) => streamNdjson('/api/generador/generar', body, onEvent),
  /** "Verificar presencia online": vuelve a revisar web e Instagram del prospecto (progreso en vivo). */
  verifyPresence: (id, onEvent) => streamNdjson(`/api/prospects/${encodeURIComponent(id)}/verificar`, {}, onEvent),
  generated: (params = {}) => request('GET', '/api/generador?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null))),
  generatorStats: (params = {}) => request('GET', '/api/generador/estadisticas?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null))),
  generatorRuns: () => request('GET', '/api/generador/busquedas'),
  setGeneratedStatus: (id, status) => request('PATCH', `/api/generador/${encodeURIComponent(id)}`, { status }),
  linkGenerated: (id, prospectId) => request('POST', `/api/generador/${encodeURIComponent(id)}/vincular`, { prospectId }),

  // Prospección automática (búsqueda en segundo plano + modo rápido)
  prospecting: () => request('GET', '/api/prospeccion'),
  prospectingSearch: (body) => request('POST', '/api/prospeccion/buscar', body),
  prospectingJob: () => request('GET', '/api/prospeccion/trabajo'),
  prospectingCancel: () => request('POST', '/api/prospeccion/trabajo/cancelar'),
  prospectingList: (params = {}) => request('GET', '/api/prospeccion/prospectos?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null))),
  prospectingQueue: (params = {}) => request('GET', '/api/prospeccion/cola?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null))),
  quickCard: (id) => request('GET', `/api/prospeccion/ficha/${encodeURIComponent(id)}`),
  contactResult: (id, body) => request('POST', `/api/prospeccion/${encodeURIComponent(id)}/resultado`, body),
  // Rubros (de fábrica + creados por el usuario)
  rubros: () => request('GET', '/api/rubros'),
  createRubro: (body) => request('POST', '/api/rubros', body),
  setRubro: (id, rubro) => request('PATCH', `/api/prospects/${encodeURIComponent(id)}`, { rubro }),
  followups: (params = {}) => request('GET', '/api/followups?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v))),
};

/** POST con respuesta en streaming NDJSON (progreso en vivo). Devuelve el evento final (resultado). */
async function streamNdjson(url, body, onEvent) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 401) window.dispatchEvent(new CustomEvent('auth:expired'));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let last = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      onEvent?.(ev);
      if (ev.tipo === 'resultado' || ev.tipo === 'error') last = ev;
    }
  }
  if (!last) throw new Error('La conexión con la herramienta se interrumpió. Probá de nuevo.');
  if (last.tipo === 'error') throw new Error(last.mensaje);
  return last;
}
