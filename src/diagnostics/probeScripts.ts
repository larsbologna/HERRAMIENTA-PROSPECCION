/**
 * Sondas de diagnóstico que se ejecutan DENTRO de Google Maps.
 *
 * Reproducen, en el MISMO ORDEN, las cadenas de selectores de src/scraper/scripts/mapsScripts.ts,
 * pero en lugar de devolver solo el valor registran cada intento: selector, atributo leído,
 * cuántos elementos coinciden, valor y fragmento HTML del elemento.
 *
 * Si se modifica un selector en mapsScripts.ts hay que reflejarlo aquí. El diagnóstico compara
 * el valor de la estrategia ganadora con el que obtuvo el scraper real y marca cualquier diferencia
 * como DISCREPANCIA, así que un desajuste entre ambos archivos no pasa desapercibido.
 */

export type BaseConfidence = 'alta' | 'media' | 'baja';

export interface ProbeAttempt {
  /** Posición en la cadena (1 = primera estrategia que prueba el scraper). */
  orden: number;
  selector: string;
  /** Qué se lee del elemento: innerText, aria-label, href, data-item-id, regex… */
  lectura: string;
  /** Confianza intrínseca de la estrategia (atributo estable > clase CSS > texto/regex). */
  confianzaBase: BaseConfidence;
  nota?: string;
  /** Elementos que coinciden con el selector en el contenedor. */
  coincidencias: number;
  /** Valor leído del primer elemento (o del texto que coincide con la regex). */
  valor: unknown;
  /** outerHTML (recortado) del elemento del que se leyó el valor. */
  html?: string;
  /** Texto exacto que coincidió (para estrategias por regex). */
  textoCoincidente?: string;
}

export interface ProbeField {
  attempts: ProbeAttempt[];
  /** Índice (0-based) de la estrategia ganadora, -1 si ninguna. */
  winner: number;
  value: unknown;
  /** Datos extra específicos del campo (p. ej. todos los Place ID candidatos). */
  extra?: Record<string, unknown>;
}

export interface OverviewProbe {
  container: { selector: string; html?: string };
  pageTitle: string;
  fields: Record<string, ProbeField>;
}

export interface ReviewsProbe {
  container: { selector: string; nodes: number };
  /** Para cada subcampo: cuántas reseñas se resolvieron con cada selector. */
  subfields: Record<string, { attempts: Array<{ selector: string; lectura: string; confianzaBase: BaseConfidence; aciertos: number }>; sinValor: number }>;
  sampleHtml?: string;
}

export interface AboutProbe {
  items: Array<{ selector: string; confianzaBase: BaseConfidence; coincidencias: number }>;
  description: { selector: string; valor: string; html?: string };
  total: number;
}

/** Utilidades comunes inyectadas en cada sonda. */
const HELPERS = String.raw`
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const txt = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
  const aria = (el) => (el ? (el.getAttribute('aria-label') || '').trim() : '');
  const snip = (el) => (el && el.outerHTML ? el.outerHTML.replace(/\s+/g, ' ').slice(0, 400) : undefined);
  const READ = {
    'innerText': (el) => txt(el),
    'aria-label': (el) => aria(el),
    'href': (el) => (el && el.href) || '',
    'href|aria-label': (el) => (el ? (el.href || aria(el)) : ''),
    'aria-label|innerText': (el) => aria(el) || txt(el),
    'existe': (el) => !!el,
  };
  const attempt = (orden, root, st) => {
    const els = qa(st.selector, root);
    const el = els[0];
    return { orden, selector: st.selector, lectura: st.lectura, confianzaBase: st.conf, nota: st.nota,
      coincidencias: els.length, valor: el ? READ[st.lectura](el) : null, html: snip(el), _el: el };
  };
  const strip = (a) => { delete a._el; return a; };
  // Modo "elemento": gana la primera estrategia que encuentra un elemento (aunque esté vacío),
  // igual que "q(a) || q(b)" en el scraper.
  const chainElement = (root, strategies) => {
    const attempts = strategies.map((st, i) => attempt(i + 1, root, st));
    const winner = attempts.findIndex((a) => a.coincidencias > 0);
    return { attempts: attempts.map(strip), winner, value: winner >= 0 ? attempts[winner].valor : '' };
  };
  // Modo "valor": gana la primera estrategia con valor no vacío, igual que "txt(a) || txt(b)".
  const chainValue = (root, strategies) => {
    const attempts = strategies.map((st, i) => attempt(i + 1, root, st));
    const winner = attempts.findIndex((a) => !!a.valor);
    return { attempts: attempts.map(strip), winner, value: winner >= 0 ? attempts[winner].valor : '' };
  };
  const regexField = (orden, text, re, sourceLabel, conf, nota) => {
    const m = text.match(re);
    let ctx;
    if (m && m.index !== undefined) ctx = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\s+/g, ' ');
    return { orden, selector: sourceLabel, lectura: 'regex ' + re.toString(), confianzaBase: conf, nota,
      coincidencias: m ? 1 : 0, valor: !!m, textoCoincidente: m ? m[0] : undefined, html: ctx };
  };
`;

export const PROBE_OVERVIEW = String.raw`(() => {
  ${HELPERS}
  const fields = {};

  // --- Contenedor y nombre (mismo orden que EXTRACT_OVERVIEW) ---
  const nameChain = chainElement(document, [
    { selector: 'h1.DUwDvf', lectura: 'innerText', conf: 'media', nota: 'clase CSS de Google (cambia sin aviso)' },
    { selector: 'div[role="main"] h1', lectura: 'innerText', conf: 'alta', nota: 'estructura semántica (role=main + h1)' },
    { selector: 'h1', lectura: 'innerText', conf: 'baja', nota: 'cualquier h1 de la página' },
  ]);
  fields.name = nameChain;
  const h1 = q('h1.DUwDvf') || q('div[role="main"] h1') || q('h1');
  let containerSel = 'document.body';
  let main = h1 && h1.closest('div[role="main"]');
  if (main) containerSel = 'h1 → closest(div[role="main"])';
  else { main = q('div[role="main"][aria-label]'); if (main) containerSel = 'div[role="main"][aria-label]'; }
  if (!main) main = document.body;

  // --- Categoría ---
  fields.category = chainValue(main, [
    { selector: 'button.DkEaL', lectura: 'innerText', conf: 'media', nota: 'clase CSS de Google' },
    { selector: 'button[jsaction*="category"]', lectura: 'innerText', conf: 'alta', nota: 'acción interna "category" del botón' },
    { selector: 'span.DkEaL', lectura: 'innerText', conf: 'media', nota: 'clase CSS de Google' },
  ]);

  // --- Calificación ---
  const f7 = q('div.F7nice', main);
  {
    const a1 = attempt(1, main, { selector: 'div.F7nice span[aria-hidden="true"]', lectura: 'innerText', conf: 'media', nota: 'clase CSS de Google; número visible junto a las estrellas' });
    const a2 = attempt(2, main, { selector: 'span[role="img"][aria-label*="estrella" i], span[role="img"][aria-label*="star" i]', lectura: 'aria-label', conf: 'alta', nota: 'etiqueta accesible de las estrellas' });
    const winner = f7 && a1.valor ? 0 : (a2.valor ? 1 : -1);
    fields.rating = { attempts: [strip(a1), strip(a2)], winner, value: winner === 0 ? a1.valor : winner === 1 ? a2.valor : '' };
  }

  // --- Cantidad de reseñas (réplica exacta de la lógica condicional del scraper) ---
  {
    const labelledEls = f7 ? qa('span[aria-label]', f7).filter((el) => /\d/.test(aria(el)) && !/estrella|star/i.test(aria(el))) : [];
    const a1 = { orden: 1, selector: 'div.F7nice span[aria-label] (con dígitos y sin "estrella")', lectura: 'aria-label', confianzaBase: 'media',
      nota: 'etiqueta accesible "N reseñas" dentro del bloque de calificación', coincidencias: labelledEls.length,
      valor: labelledEls[0] ? aria(labelledEls[0]) : null, html: snip(labelledEls[0]) };
    const a2 = { orden: 2, selector: 'div.F7nice', lectura: 'innerText', confianzaBase: 'baja',
      nota: 'texto completo del bloque (incluye la calificación: puede leer "4,1" como cantidad)', coincidencias: f7 ? 1 : 0,
      valor: f7 ? txt(f7) : null, html: snip(f7) };
    const re = /\d[\d.,]*\s*(reseñas|opiniones|reviews)/i;
    const cand = qa('button, span', main).find((el) => re.test(aria(el) || txt(el)));
    const a3 = { orden: 3, selector: 'button, span (texto con "N reseñas")', lectura: 'aria-label|innerText + regex', confianzaBase: 'baja',
      nota: 'búsqueda por texto en todo el panel', coincidencias: cand ? 1 : 0, valor: cand ? (aria(cand) || txt(cand)) : null, html: snip(cand) };
    let winner = -1;
    if (f7) winner = a1.valor ? 0 : (a2.valor ? 1 : -1);
    if (winner === -1 && a3.valor) winner = 2;
    const all = [a1, a2, a3];
    fields.reviewCount = { attempts: all, winner, value: winner >= 0 ? all[winner].valor : '' };
  }

  // --- Contacto ---
  fields.address = chainValue(main, [
    { selector: '[data-item-id="address"]', lectura: 'aria-label', conf: 'alta', nota: 'atributo estable data-item-id' },
    { selector: '[data-item-id="address"]', lectura: 'innerText', conf: 'alta', nota: 'atributo estable data-item-id' },
  ]);
  {
    const e1 = q('[data-item-id^="phone:tel:"]', main);
    const e2 = q('button[aria-label^="Teléfono" i], button[aria-label^="Phone" i]', main);
    const a1 = { orden: 1, selector: '[data-item-id^="phone:tel:"]', lectura: 'data-item-id', confianzaBase: 'alta', nota: 'número en formato internacional dentro del atributo',
      coincidencias: qa('[data-item-id^="phone:tel:"]', main).length, valor: e1 ? (e1.getAttribute('data-item-id') || '').replace('phone:tel:', '') : null, html: snip(e1) };
    const a2 = { orden: 2, selector: 'button[aria-label^="Teléfono" i], button[aria-label^="Phone" i]', lectura: 'aria-label', confianzaBase: 'media', nota: 'etiqueta accesible (formato local)',
      coincidencias: qa('button[aria-label^="Teléfono" i], button[aria-label^="Phone" i]', main).length, valor: e2 ? aria(e2) : null, html: snip(e2) };
    const winner = e1 ? 0 : (e2 ? 1 : -1);
    fields.phone = { attempts: [a1, a2], winner, value: winner === 0 ? a1.valor : winner === 1 ? a2.valor : '' };
  }
  fields.website = chainElement(main, [
    { selector: 'a[data-item-id="authority"]', lectura: 'href|aria-label', conf: 'alta', nota: 'atributo estable data-item-id' },
    { selector: 'a[aria-label^="Sitio web" i], a[aria-label^="Website" i]', lectura: 'href|aria-label', conf: 'media', nota: 'etiqueta accesible' },
  ]);
  fields.plusCode = chainValue(main, [
    { selector: '[data-item-id="oloc"]', lectura: 'aria-label', conf: 'alta' },
    { selector: '[data-item-id="oloc"]', lectura: 'innerText', conf: 'alta' },
  ]);
  fields.menuUrl = chainElement(main, [
    { selector: 'a[data-item-id="menu"]', lectura: 'href', conf: 'alta', nota: 'atributo estable data-item-id' },
    { selector: 'a[aria-label*="Menú" i], a[aria-label^="Menu" i], a[aria-label*="Carta" i]', lectura: 'href', conf: 'baja', nota: 'por texto: puede coincidir con otros enlaces' },
  ]);
  fields.bookingUrl = chainElement(main, [
    { selector: 'a[data-item-id^="action:"][href*="reserv" i], a[aria-label*="Reserv" i], a[aria-label*="Book" i], a[aria-label*="Pedir cita" i], a[aria-label*="cita" i], a[aria-label*="Appointment" i]', lectura: 'href', conf: 'media', nota: 'por etiqueta accesible' },
  ]);
  {
    const re = /^(reservar|reserva|book|book online|pedir cita|reservar mesa)$/i;
    const btn = qa('button, a', main).find((el) => re.test(txt(el)));
    const viaLink = fields.bookingUrl.winner >= 0;
    const a2 = { orden: 2, selector: 'button, a (texto exacto "Reservar", "Pedir cita"…)', lectura: 'innerText + regex', confianzaBase: 'baja',
      nota: 'botón por texto', coincidencias: btn ? 1 : 0, valor: !!btn, html: snip(btn) };
    const a1 = { ...fields.bookingUrl.attempts[0], valor: viaLink, lectura: 'existe' };
    fields.bookingButton = { attempts: [a1, a2], winner: viaLink ? 0 : (btn ? 1 : -1), value: viaLink || !!btn };
  }
  fields.orderUrl = chainElement(main, [
    { selector: 'a[aria-label*="Pedir" i]:not([aria-label*="cita" i]), a[aria-label*="Order" i], a[data-item-id*="order" i]', lectura: 'href', conf: 'media' },
  ]);

  // --- Horarios ---
  {
    const sels = ['table.eK4R0e', 'table.WgFkxc', 'div[aria-label*="horario" i] table, div[aria-label*="hours" i] table'];
    const confs = ['media', 'media', 'alta'];
    const attempts = sels.map((s, i) => {
      const t = q(s, main);
      const rows = t ? qa('tr', t).filter((tr) => qa('td', tr).length >= 2 && txt(qa('td', tr)[0])).length : 0;
      return { orden: i + 1, selector: s, lectura: 'tr > td[0] innerText + td[1] aria-label|innerText', confianzaBase: confs[i],
        nota: i < 2 ? 'clase CSS de Google' : 'tabla dentro del bloque de horario', coincidencias: qa(s, main).length, valor: rows, html: snip(t) };
    });
    const winner = attempts.findIndex((a) => a.coincidencias > 0);
    fields.hoursRows = { attempts, winner, value: winner >= 0 ? attempts[winner].valor : 0 };
    fields.hoursAria = chainElement(main, [
      { selector: 'div.t39EBf[aria-label], div[aria-label*="Ocultar el horario" i], div[aria-label*="horario semanal" i], div[aria-label*="weekly hours" i]', lectura: 'aria-label', conf: 'media', nota: 'resumen accesible del horario semanal' },
    ]);
  }

  // --- Descripción ---
  fields.description = chainValue(main, [
    { selector: 'div.PYvSYb', lectura: 'innerText', conf: 'baja', nota: 'clase CSS; suele ser el RESUMEN EDITORIAL de Google, no la descripción del dueño' },
    { selector: 'div[aria-label^="Acerca de" i] div.PbZDve', lectura: 'innerText', conf: 'media', nota: 'bloque "Acerca de"' },
    { selector: 'div.WeS02d', lectura: 'innerText', conf: 'baja', nota: 'clase CSS de Google' },
  ]);

  // --- Estado de la ficha (por texto del panel) ---
  const panelText = txt(main).slice(0, 20000);
  const panelLabel = 'texto visible del panel (innerText, primeros 20.000 caracteres)';
  {
    const a = regexField(1, panelText, /reclam[ae] (este|el) negocio|claim this business|¿eres (el|la) propietari|¿es (el|la) propietari|own this business\?/i, panelLabel, 'media', 'aviso "Reclamar este negocio"');
    fields.unclaimed = { attempts: [a], winner: a.valor ? 0 : -1, value: a.valor };
    const b = regexField(1, panelText, /respuesta del propietario|response from the owner|del propietario|from the owner/i, panelLabel, 'baja', 'indicio indirecto: respuestas o publicaciones del dueño');
    fields.claimedSignals = { attempts: [b], winner: b.valor ? 0 : -1, value: b.valor };
    const c = regexField(1, panelText, /cerrado permanentemente|permanently closed|cerrado definitivamente/i, panelLabel, 'media');
    fields.permanentlyClosed = { attempts: [c], winner: c.valor ? 0 : -1, value: c.valor };
  }

  // --- Fotos ---
  {
    const imgs = qa('img', main);
    const urls = Array.from(new Set(imgs.map((img) => img.getAttribute('src') || '')
      .filter((src) => /googleusercontent\.com|ggpht\.com|streetviewpixels/i.test(src) && !/\/a\/|=s\d{2}-|w36-h36|w32-h32/.test(src))));
    fields.photoUrls = { attempts: [{ orden: 1, selector: 'img[src*=googleusercontent|ggpht|streetviewpixels] (sin avatares)', lectura: 'src', confianzaBase: 'baja',
      nota: 'solo las imágenes cargadas en pantalla, no el total de la ficha', coincidencias: urls.length, valor: urls.length }], winner: urls.length ? 0 : -1, value: urls.length };

    const photoRe = /(\d[\d.,]*\s*(?:mil|k)?)\s+(?:fotos|photos|imágenes)|(?:fotos|photos)\s*\((\d[\d.,]*\s*(?:mil|k)?)\)/i;
    const labelled = qa('button[aria-label], div[aria-label]', main);
    let winner = -1, value = '', matched, html, source;
    for (const el of labelled) {
      const m = aria(el).match(photoRe);
      if (m) { winner = 0; value = m[1] || m[2] || ''; matched = m[0]; html = snip(el); source = 'aria-label'; break; }
    }
    if (winner === -1) {
      const m = panelText.match(photoRe);
      if (m) { winner = 1; value = m[1] || m[2] || ''; matched = m[0]; source = 'panel'; }
    }
    fields.photoCountText = { winner, value, attempts: [
      { orden: 1, selector: 'button[aria-label], div[aria-label] (regex "N fotos" / "fotos (N)")', lectura: 'aria-label + regex', confianzaBase: 'media',
        coincidencias: source === 'aria-label' ? 1 : 0, valor: source === 'aria-label' ? value : null, textoCoincidente: source === 'aria-label' ? matched : undefined, html: source === 'aria-label' ? html : undefined },
      { orden: 2, selector: panelLabel, lectura: 'regex', confianzaBase: 'baja',
        coincidencias: source === 'panel' ? 1 : 0, valor: source === 'panel' ? value : null, textoCoincidente: source === 'panel' ? matched : undefined },
    ] };
  }

  // --- Publicaciones ---
  {
    const section = qa('div[aria-label], h2', main).find((el) => /novedades|del propietario|from the owner|updates from|actualizaciones/i.test(aria(el) || txt(el)));
    let count = 0;
    if (section) {
      const container = section.tagName === 'H2' ? (section.parentElement && section.parentElement.parentElement) : section;
      if (container) count = Math.min(10, qa('div', container).filter((d) => { const t = txt(d); return t && t.length > 30 && t.length < 1500 && d.children.length < 6; }).length);
    }
    fields.posts = { winner: section ? 0 : -1, value: count, attempts: [{ orden: 1, selector: 'div[aria-label], h2 con texto "Novedades" / "Del propietario" / "From the owner"', lectura: 'divs con 30–1500 caracteres dentro de la sección',
      confianzaBase: 'baja', nota: 'heurística por texto: puede confundir respuestas del dueño a reseñas con publicaciones', coincidencias: section ? 1 : 0, valor: count,
      html: snip(section), textoCoincidente: section ? (aria(section) || txt(section)).slice(0, 80) : undefined }] };
  }

  // --- Redes sociales e histograma ---
  {
    const links = Array.from(new Set(qa('a[href]', main).map((a) => a.href)
      .filter((h) => /instagram\.com|facebook\.com|tiktok\.com|twitter\.com|x\.com\/|linkedin\.com|youtube\.com/i.test(h) && !/google\./i.test(h))));
    fields.socialLinks = { winner: links.length ? 0 : -1, value: links.length, extra: { enlaces: links }, attempts: [{ orden: 1, selector: 'a[href] (dominios de redes sociales)', lectura: 'href',
      confianzaBase: 'media', coincidencias: links.length, valor: links.length }] };
    const rows = qa('tr[aria-label]', main).filter((tr) => /estrella|star/i.test(aria(tr)));
    fields.histogram = { winner: rows.length ? 0 : -1, value: rows.length, extra: { filas: rows.map(aria) }, attempts: [{ orden: 1, selector: 'tr[aria-label*="estrella"|"star"]', lectura: 'aria-label',
      confianzaBase: 'alta', coincidencias: rows.length, valor: rows.length, html: snip(rows[0]) }] };
  }

  // --- Place ID: el scraper toma la PRIMERA coincidencia de todo el HTML ---
  {
    const html = document.documentElement.innerHTML;
    const all = html.match(/ChIJ[0-9A-Za-z_-]{20,}/g) || [];
    const counts = {};
    all.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    const first = all[0] || '';
    let ctx;
    if (first) { const i = html.indexOf(first); ctx = html.slice(Math.max(0, i - 120), i + first.length + 40).replace(/\s+/g, ' '); }
    fields.placeId = { winner: first ? 0 : -1, value: first, extra: { candidatos: counts, distintos: Object.keys(counts).length },
      attempts: [{ orden: 1, selector: 'document.documentElement.innerHTML', lectura: 'regex /ChIJ[0-9A-Za-z_-]{20,}/ (primera coincidencia)', confianzaBase: 'media',
        nota: 'busca en TODO el HTML: puede tomar el ID de otro negocio', coincidencias: all.length, valor: first, html: ctx }] };
  }

  return { container: { selector: containerSel, html: snip(main) ? snip(main).slice(0, 200) : undefined }, pageTitle: document.title, fields };
})()`;

export const PROBE_REVIEWS = String.raw`(() => {
  ${HELPERS}
  let containerSel = 'div.jftiEf[data-review-id]';
  let nodes = qa(containerSel);
  if (!nodes.length) { containerSel = 'div[data-review-id][aria-label]'; nodes = qa(containerSel); }
  const seen = new Set();
  nodes = nodes.filter((n) => { const id = n.getAttribute('data-review-id'); if (seen.has(id)) return false; seen.add(id); return true; });

  const defs = {
    autor: [['[aria-label] (el propio nodo)', 'aria-label', 'media', (n) => aria(n)], ['div.d4r55', 'innerText', 'media', (n) => txt(q('div.d4r55', n))]],
    estrellas: [['span.kvMYJc', 'aria-label', 'media', (n) => aria(q('span.kvMYJc', n))],
      ['span[role="img"][aria-label*="estrella"|"star"]', 'aria-label', 'alta', (n) => aria(q('span[role="img"][aria-label*="estrella" i], span[role="img"][aria-label*="star" i]', n))],
      ['span.fzvQIb', 'innerText', 'media', (n) => txt(q('span.fzvQIb', n))]],
    fecha: [['span.rsqaWe', 'innerText', 'media', (n) => txt(q('span.rsqaWe', n))], ['span.xRkPPb', 'innerText', 'media', (n) => txt(q('span.xRkPPb', n))],
      ['texto del nodo + regex "hace …"/"… ago"', 'regex', 'baja', (n) => ((txt(n).match(/(hace\s+\S+(\s+\S+)?|\d+\s+\S+\s+ago|an?\s+\S+\s+ago)/i) || [''])[0])]],
    texto: [['span.wiI7pd', 'innerText', 'media', (n) => txt(q('span.wiI7pd', n))], ['div.MyEned', 'innerText', 'media', (n) => txt(q('div.MyEned', n))]],
    respuestaDueño: [['div.CDe7pd', 'existe', 'media', (n) => !!q('div.CDe7pd', n)],
      ['texto del nodo + regex "Respuesta del propietario"', 'regex', 'media', (n) => /respuesta del propietario|response from the owner/i.test(txt(n))]],
  };
  const subfields = {};
  for (const key of Object.keys(defs)) {
    const attempts = defs[key].map(([selector, lectura, conf]) => ({ selector, lectura, confianzaBase: conf, aciertos: 0 }));
    let sinValor = 0;
    nodes.forEach((n) => {
      // La estrella usa la lógica del scraper: primero el elemento (kvMYJc o role=img) y luego fzvQIb.
      let hit = -1;
      if (key === 'estrellas') {
        if (q('span.kvMYJc', n)) hit = aria(q('span.kvMYJc', n)) ? 0 : -1;
        else if (q('span[role="img"][aria-label*="estrella" i], span[role="img"][aria-label*="star" i]', n)) hit = 1;
        if (hit === -1 && txt(q('span.fzvQIb', n))) hit = 2;
      } else {
        hit = defs[key].findIndex((d) => !!d[3](n));
      }
      if (hit >= 0) attempts[hit].aciertos++;
      else sinValor++;
    });
    subfields[key] = { attempts, sinValor };
  }
  return { container: { selector: containerSel, nodes: nodes.length }, subfields, sampleHtml: snip(nodes[0]) };
})()`;

export const PROBE_ABOUT = String.raw`(() => {
  ${HELPERS}
  const sels = [['div.iP2t7d li', 'media'], ['div[role="region"] li', 'alta'], ['div.fontBodyMedium ul li', 'baja']];
  const all = new Set();
  const items = sels.map(([selector, conf]) => {
    const lis = qa(selector);
    lis.forEach((li) => { const l = aria(li.querySelector('[aria-label]')) || txt(li); if (l && l.length < 120) all.add(l); });
    return { selector, confianzaBase: conf, coincidencias: lis.length };
  });
  const d = document.querySelector('div.PbZDve');
  return { items, description: { selector: 'div.PbZDve', valor: txt(d), html: snip(d) }, total: all.size };
})()`;
