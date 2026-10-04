/** Cliente de la API local. Todas las respuestas de error traen { error }. */
async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
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
  update: (id, body) => request('PATCH', `/api/prospects/${encodeURIComponent(id)}`, body),
  remove: (id) => request('DELETE', `/api/prospects/${encodeURIComponent(id)}`),
  addActivity: (id, type, content) => request('POST', `/api/prospects/${encodeURIComponent(id)}/activities`, { type, content }),
  settings: () => request('GET', '/api/settings'),
  saveSettings: (body) => request('PUT', '/api/settings', body),

  /** Análisis con progreso: onEvent recibe cada línea del stream. Devuelve el evento final. */
  async analyze(url, onEvent) {
    const res = await fetch('/api/analizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
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
  },
};
