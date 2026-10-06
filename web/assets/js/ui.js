/** Utilidades de interfaz compartidas por todas las vistas. */

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- Formato ----------
const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('es-AR');
export const money = (n) => ars.format(Math.round(Number(n) || 0));
export const number = (n) => int.format(Number(n) || 0);
/** $ 12,3 M · $ 850 mil · $ 9.500 */
export function moneyShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return `$ ${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',')} M`;
  if (Math.abs(v) >= 1e4) return `$ ${Math.round(v / 1e3)} mil`;
  return money(v);
}
export const pct = (n) => `${String(Math.round((Number(n) || 0) * 10) / 10).replace('.', ',')}%`;
export function date(iso, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  return iso ? new Date(iso).toLocaleDateString('es-AR', opts) : '—';
}
export function dateTime(iso) {
  return iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}
export function ago(iso) {
  if (!iso) return '—';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'recién';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  return date(iso);
}
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const monthLabel = (key) => MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
export const monthLong = (key) => `${monthLabel(key)} ${key.slice(0, 4)}`;

// ---------- Piezas ----------
export const IMP = { Alto: 'alto', 'Medio-Alto': 'medio-alto', Medio: 'medio', Bajo: 'bajo' };
export const scoreClass = (s) => (s >= 70 ? '' : s >= 45 ? 'mid' : 'low');
export const scoreHtml = (s) => `<span class="score ${scoreClass(s)} num"><span class="score-bar"><i style="width:${Math.max(4, s)}%"></i></span>${s}</span>`;

let STATUSES = [];
export function setStatuses(list) { STATUSES = list; }
export const statuses = () => STATUSES;
export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label ?? id;
export const statusBadge = (id) => `<span class="badge st-${esc(id)}">${esc(statusLabel(id))}</span>`;
export function statusOptions(selected) {
  return STATUSES.map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
}

// ---------- Íconos (trazos simples, 24×24) ----------
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  audit: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  map: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  money: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
};
export const icon = (name, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] ?? ''}</svg>`;

// ---------- Toasts ----------
export function toast(text, kind = 'ok') {
  let zone = $('.toast-zone');
  if (!zone) {
    zone = document.createElement('div');
    zone.className = 'toast-zone';
    document.body.appendChild(zone);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  zone.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// ---------- Modal ----------
export function modal(html, { onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && !overlay.dataset.locked) close(); };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && !overlay.dataset.locked) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  return { root: overlay, close, lock: (v) => { overlay.dataset.locked = v ? '1' : ''; } };
}

export function confirmDialog(title, text, okLabel = 'Confirmar') {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="btn-row" style="justify-content:flex-end"><button class="btn" data-no>Cancelar</button><button class="btn btn-danger" data-yes>${esc(okLabel)}</button></div>`,
      { onClose: () => { if (!answered) resolve(false); } });
    $('[data-no]', m.root).onclick = () => m.close();
    $('[data-yes]', m.root).onclick = () => { answered = true; resolve(true); m.close(); };
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/**
 * Número para WhatsApp "Click to Chat" (solo dígitos, con código de país, sin "+") a partir del teléfono
 * como lo muestra Google o lo escribe el negocio. Argentina por defecto:
 *   "0341 15-555-0000" / "(0341) 155-550000" / "+54 9 341 555-0000" → 5493415550000 (celular: 54 + 9, sin 0 ni 15)
 *   "0341 456-7890" / "+54 341 456-7890" → 543414567890 (fijo: sirve si usan WhatsApp Business)
 * Quita espacios, guiones, paréntesis y puntos; no duplica el 54. Si el número está incompleto
 * (por ejemplo, sin característica) devuelve '' en lugar de inventar uno.
 */
export function waPhone(phone) {
  const raw = String(phone || '').trim();
  let d = raw.replace(/\D/g, '');
  const intl = /^(\+|00)/.test(raw);
  if (d.startsWith('00')) d = d.slice(2);
  const mobile15 = (rest) => {
    const m = rest.match(/^(\d{2,4})15(\d{6,8})$/);
    return m && m[1].length + m[2].length === 10 ? `549${m[1]}${m[2]}` : '';
  };
  /** Número argentino sin el 54 inicial: "9 341 5550000", "0341 15 5550000", "341 4567890"… */
  const argentina = (rest) => {
    rest = rest.replace(/^0/, '');
    if (rest.startsWith('9')) {
      const r = rest.slice(1).replace(/^0/, '');
      if (r.length === 10) return mobile15(r) || `549${r}`;
      return mobile15(r);
    }
    return mobile15(rest) || (rest.length === 10 ? `54${rest}` : '');
  };
  if (intl) {
    if (!d.startsWith('54')) return d.length >= 8 && d.length <= 15 ? d : '';
    let rest = d.slice(2);
    if (rest.startsWith('54') && rest.length >= 12) rest = rest.slice(2); // "+54 54 9 …": código duplicado
    return argentina(rest);
  }
  if (d.startsWith('54') && d.length >= 12 && d.length <= 13) return argentina(d.slice(2));
  return argentina(d);
}

/** ¿Celular o tablet? */
export const isTouchDevice = () => {
  try {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches);
  } catch {
    return false;
  }
};

/**
 * Enlace oficial de WhatsApp "Click to Chat": https://wa.me/<número>?text=<mensaje codificado>.
 * Lo abre el navegador como cualquier enlace; WhatsApp (app de escritorio, app del celular o WhatsApp Web)
 * decide dónde mostrar el chat. Sin número abre WhatsApp para elegir el contacto. No envía nada.
 */
export function waMeUrl(number, text) {
  const n = String(number || '').replace(/\D/g, '');
  return `https://wa.me/${n}?text=${encodeURIComponent(text || '')}`;
}

/** Respaldo: el mismo chat en WhatsApp Web (navegador). */
export function waWebUrl(number, text) {
  const n = String(number || '').replace(/\D/g, '');
  return `https://web.whatsapp.com/send?${n ? `phone=${n}&` : ''}text=${encodeURIComponent(text || '')}`;
}

/** Compatibilidad: enlace wa.me a partir de un teléfono. */
export function waLink(phone, text) {
  return waMeUrl(waPhone(phone), text);
}

export function emptyState(iconName, title, text, actionHtml = '') {
  return `<div class="card empty"><div class="icon">${icon(iconName)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${actionHtml}</div>`;
}

export function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}
