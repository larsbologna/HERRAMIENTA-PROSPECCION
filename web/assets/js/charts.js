/**
 * Gráficos en SVG sin librerías.
 * - Una sola escala por gráfico, grilla recesiva, marcas finas con extremos redondeados.
 * - Tooltip en cada barra/punto (zona de hover más grande que la marca).
 * - Texto siempre en tonos de texto, nunca en el color de la serie.
 */
import { esc } from './ui.js';

const GREEN = '#5DD62C';
const NEUTRAL = '#8C8C8C';
let tip;

function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    document.body.appendChild(tip);
  }
  return tip;
}
function bindTooltip(root, getHtml) {
  const t = tooltip();
  root.addEventListener('mousemove', (e) => {
    const target = e.target.closest('[data-i]');
    if (!target || !root.contains(target)) return t.classList.remove('show');
    t.innerHTML = getHtml(Number(target.dataset.i), target);
    t.classList.add('show');
    const x = Math.min(window.innerWidth - t.offsetWidth - 12, e.clientX + 14);
    t.style.left = `${x}px`;
    t.style.top = `${e.clientY - t.offsetHeight - 12}px`;
  });
  root.addEventListener('mouseleave', () => t.classList.remove('show'));
}

/** Escala con marcas "redondas": paso 1, 2, 2,5 o 5 × 10^n; enteros si los datos son enteros. */
function niceScale(rawMax, ticks = 4, integer = true) {
  if (rawMax <= 0) return { max: ticks, step: 1, ticks };
  const rough = rawMax / ticks;
  const exp = 10 ** Math.floor(Math.log10(rough));
  const n = rough / exp;
  let step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * exp;
  if (integer) step = Math.max(1, Math.ceil(step));
  const count = Math.max(1, Math.ceil(rawMax / step));
  return { max: step * count, step, ticks: count };
}

/** Rectángulo con solo los extremos superiores redondeados (anclado a la base). */
function topRounded(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function frame(width, height, pad) {
  return { w: width - pad.l - pad.r, h: height - pad.t - pad.b };
}

function yAxis(scale, pad, inner, width, fmt) {
  const { max, ticks } = scale;
  let out = '<g class="grid">';
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const y = pad.t + inner.h - (inner.h * i) / ticks;
    out += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y}" y2="${y}"/>`;
    out += `<text class="axis" x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
  }
  return out + '</g>';
}

/**
 * Barras verticales (una serie).
 * data: [{ label, value, tip? }]
 */
export function barChart(el, data, { height = 220, fmt = String, tipFmt = fmt, color = GREEN } = {}) {
  const width = Math.max(el.clientWidth, 280);
  const pad = { t: 10, r: 8, b: 26, l: 44 };
  const inner = frame(width, height, pad);
  const scale = niceScale(Math.max(...data.map((d) => d.value), 0));
  const max = scale.max;
  const step = inner.w / data.length;
  const bw = Math.min(28, step * 0.62);
  let bars = '';
  data.forEach((d, i) => {
    const h = (d.value / max) * inner.h;
    const x = pad.l + step * i + (step - bw) / 2;
    const y = pad.t + inner.h - h;
    bars += `<rect class="hit" data-i="${i}" x="${pad.l + step * i}" y="${pad.t}" width="${step}" height="${inner.h}"/>`;
    bars += `<path class="mark" d="${topRounded(x, y, bw, h)}" fill="${color}"/>`;
    bars += `<text class="axis" x="${pad.l + step * i + step / 2}" y="${height - 8}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img">${yAxis(scale, pad, inner, width, fmt)}${bars}</svg>`;
  bindTooltip(el, (i) => `<b>${esc(data[i].tip ?? data[i].label)}</b>${esc(tipFmt(data[i].value))}`);
}

/**
 * Barras agrupadas (2 series, con leyenda arriba).
 * data: [{ label, a, b }], series: [{ key:'a', name, color }, …]
 */
export function groupedBars(el, data, series, { height = 220, fmt = String } = {}) {
  const width = Math.max(el.clientWidth, 280);
  const pad = { t: 10, r: 8, b: 26, l: 36 };
  const inner = frame(width, height, pad);
  const scale = niceScale(Math.max(...data.flatMap((d) => series.map((s) => d[s.key])), 0));
  const max = scale.max;
  const step = inner.w / data.length;
  const bw = Math.min(14, (step * 0.7) / series.length - 2);
  let bars = '';
  data.forEach((d, i) => {
    const groupW = series.length * bw + (series.length - 1) * 2;
    const gx = pad.l + step * i + (step - groupW) / 2;
    bars += `<rect class="hit" data-i="${i}" x="${pad.l + step * i}" y="${pad.t}" width="${step}" height="${inner.h}"/>`;
    series.forEach((s, j) => {
      const h = (d[s.key] / max) * inner.h;
      bars += `<path class="mark" d="${topRounded(gx + j * (bw + 2), pad.t + inner.h - h, bw, h, 3)}" fill="${s.color}"/>`;
    });
    bars += `<text class="axis" x="${pad.l + step * i + step / 2}" y="${height - 8}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  const legend = `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  el.innerHTML = `${legend}<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img">${yAxis(scale, pad, inner, width, fmt)}${bars}</svg>`;
  bindTooltip(el, (i) => `<b>${esc(data[i].tip ?? data[i].label)}</b>${series.map((s) => `${esc(s.name)}: ${esc(fmt(data[i][s.key]))}`).join('<br>')}`);
}

/**
 * Área con línea (serie acumulada).
 * data: [{ label, value, tip? }]
 */
export function areaChart(el, data, { height = 220, fmt = String, tipFmt = fmt } = {}) {
  const width = Math.max(el.clientWidth, 280);
  const pad = { t: 12, r: 12, b: 26, l: 60 };
  const inner = frame(width, height, pad);
  const scale = niceScale(Math.max(...data.map((d) => d.value), 0), 4, false);
  const max = scale.max;
  const step = data.length > 1 ? inner.w / (data.length - 1) : inner.w;
  const pts = data.map((d, i) => [pad.l + step * i, pad.t + inner.h - (d.value / max) * inner.h]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const area = `${line}L${pts.at(-1)[0]},${pad.t + inner.h}L${pts[0][0]},${pad.t + inner.h}Z`;
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  let marks = '';
  pts.forEach((p, i) => {
    marks += `<rect class="hit" data-i="${i}" x="${p[0] - step / 2}" y="${pad.t}" width="${step}" height="${inner.h}"/>`;
    if (i % Math.ceil(data.length / 12) === 0 || i === data.length - 1) {
      marks += `<text class="axis" x="${p[0]}" y="${height - 8}" text-anchor="middle">${esc(data[i].label)}</text>`;
    }
  });
  const last = pts.at(-1);
  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${GREEN}" stop-opacity=".28"/><stop offset="1" stop-color="${GREEN}" stop-opacity="0"/></linearGradient></defs>
    ${yAxis(scale, pad, inner, width, fmt)}
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="${GREEN}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${GREEN}" stroke="#202020" stroke-width="2"/>
    ${marks}</svg>`;
  bindTooltip(el, (i) => `<b>${esc(data[i].tip ?? data[i].label)}</b>${esc(tipFmt(data[i].value))}`);
}

/**
 * Barras horizontales etiquetadas (ranking, embudo, estados).
 * rows: [{ label, value, text, tone? ('muted'|'danger'), tip? }]
 */
export function hBars(el, rows, { max } = {}) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  el.innerHTML = `<div class="hbars">${rows
    .map(
      (r, i) => `<div class="hbar-row" data-i="${i}">
        <span class="lbl" title="${esc(r.label)}">${esc(r.label)}</span>
        <span class="track"><i class="${r.tone ?? ''}" style="width:${r.value > 0 ? Math.max(2, (r.value / top) * 100) : 0}%"></i></span>
        <span class="val num">${esc(r.text ?? r.value)}</span></div>`,
    )
    .join('')}</div>`;
  if (rows.some((r) => r.tip)) bindTooltip(el, (i) => rows[i].tip ?? '');
}

export const COLORS = { GREEN, NEUTRAL };
