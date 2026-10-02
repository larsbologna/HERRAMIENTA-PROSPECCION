/**
 * Scripts que se ejecutan DENTRO de la página de Google Maps.
 *
 * Se mantienen como strings (y no como funciones TypeScript) por dos motivos:
 *  1. El transpilador puede inyectar helpers (p. ej. `__name`) que no existen en el navegador.
 *  2. Google cambia sus clases CSS con frecuencia: tener todos los selectores juntos aquí
 *     facilita actualizarlos sin tocar la lógica del scraper.
 *
 * Estrategia: primero atributos estables (data-item-id, aria-label, role), luego clases
 * conocidas y, por último, expresiones regulares sobre el texto visible.
 */

/** Datos raw devueltos por EXTRACT_OVERVIEW (se normalizan en mapsScraper.ts). */
export interface RawOverview {
  name: string;
  category: string;
  ratingText: string;
  reviewsText: string;
  address: string;
  phone: string;
  website: string;
  plusCode: string;
  menuUrl: string;
  bookingUrl: string;
  bookingButton: boolean;
  orderUrl: string;
  hoursRows: Array<[string, string]>;
  hoursAria: string;
  description: string;
  unclaimed: boolean;
  claimedSignals: boolean;
  permanentlyClosed: boolean;
  photoUrls: string[];
  photoCountText: string;
  posts: Array<{ text: string; date: string }>;
  socialLinks: string[];
  histogram: Array<[string, string]>;
  placeId: string;
  panelText: string;
}

export const EXTRACT_OVERVIEW = String.raw`(() => {
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const txt = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
  const aria = (el) => (el ? (el.getAttribute('aria-label') || '').trim() : '');

  const h1 = q('h1.DUwDvf') || q('div[role="main"] h1') || q('h1');
  const main = (h1 && h1.closest('div[role="main"]')) || q('div[role="main"][aria-label]') || document.body;
  const item = (id) => q('[data-item-id="' + id + '"]', main);

  // --- Rating y reseñas ---
  let ratingText = '';
  let reviewsText = '';
  const f7 = q('div.F7nice', main);
  if (f7) {
    ratingText = txt(q('span[aria-hidden="true"]', f7));
    const labelled = qa('span[aria-label]', f7).map(aria).find((a) => /\d/.test(a) && !/estrella|star/i.test(a));
    reviewsText = labelled || txt(f7);
  }
  if (!ratingText) {
    const stars = q('span[role="img"][aria-label*="estrella" i], span[role="img"][aria-label*="star" i]', main);
    ratingText = aria(stars);
  }
  if (!reviewsText) {
    const btn = qa('button, span', main).map((el) => aria(el) || txt(el))
      .find((t) => /\d[\d.,]*\s*(reseñas|opiniones|reviews)/i.test(t));
    reviewsText = btn || '';
  }

  // --- Datos de contacto ---
  const phoneEl = q('[data-item-id^="phone:tel:"]', main) || q('button[aria-label^="Teléfono" i], button[aria-label^="Phone" i]', main);
  let phone = '';
  if (phoneEl) {
    const id = phoneEl.getAttribute('data-item-id') || '';
    phone = id.startsWith('phone:tel:') ? id.replace('phone:tel:', '') : aria(phoneEl);
  }
  const websiteEl = q('a[data-item-id="authority"]', main) || q('a[aria-label^="Sitio web" i], a[aria-label^="Website" i]', main);
  const menuEl = q('a[data-item-id="menu"]', main) || q('a[aria-label*="Menú" i], a[aria-label^="Menu" i], a[aria-label*="Carta" i]', main);
  const bookingEl = q('a[data-item-id^="action:"][href*="reserv" i], a[aria-label*="Reserv" i], a[aria-label*="Book" i], a[aria-label*="Pedir cita" i], a[aria-label*="cita" i], a[aria-label*="Appointment" i]', main);
  const bookingButton = !!bookingEl || qa('button, a', main).some((el) => /^(reservar|reserva|book|book online|pedir cita|reservar mesa)$/i.test(txt(el)));
  const orderEl = q('a[aria-label*="Pedir" i]:not([aria-label*="cita" i]), a[aria-label*="Order" i], a[data-item-id*="order" i]', main);

  // --- Horarios ---
  const hoursRows = [];
  const table = q('table.eK4R0e', main) || q('table.WgFkxc', main) || q('div[aria-label*="horario" i] table, div[aria-label*="hours" i] table', main);
  if (table) {
    qa('tr', table).forEach((tr) => {
      const cells = qa('td', tr);
      if (cells.length >= 2) {
        const day = txt(cells[0]);
        const hours = aria(cells[1]) || txt(cells[1]);
        if (day) hoursRows.push([day, hours]);
      }
    });
  }
  const hoursAriaEl = q('div.t39EBf[aria-label], div[aria-label*="Ocultar el horario" i], div[aria-label*="horario semanal" i], div[aria-label*="weekly hours" i]', main);
  const hoursAria = aria(hoursAriaEl);

  // --- Descripción ---
  const description = txt(q('div.PYvSYb', main)) || txt(q('div[aria-label^="Acerca de" i] div.PbZDve', main)) || txt(q('div.WeS02d', main));

  // --- Estado de la ficha ---
  const panelText = txt(main).slice(0, 20000);
  const unclaimed = /reclam[ae] (este|el) negocio|claim this business|¿eres (el|la) propietari|¿es (el|la) propietari|own this business\?/i.test(panelText);
  const claimedSignals = /respuesta del propietario|response from the owner|del propietario|from the owner/i.test(panelText);
  const permanentlyClosed = /cerrado permanentemente|permanently closed|cerrado definitivamente/i.test(panelText);

  // --- Fotos ---
  const photoUrls = Array.from(new Set(qa('img', main)
    .map((img) => img.getAttribute('src') || '')
    .filter((src) => /googleusercontent\.com|ggpht\.com|streetviewpixels/i.test(src) && !/\/a\/|=s\d{2}-|w36-h36|w32-h32/.test(src))));
  // "123 fotos", "Ver fotos (123)", "Photos (1.2K)"
  const photoRe = /(\d[\d.,]*\s*(?:mil|k)?)\s+(?:fotos|photos|imágenes)|(?:fotos|photos)\s*\((\d[\d.,]*\s*(?:mil|k)?)\)/i;
  const photoSources = qa('button[aria-label], div[aria-label]', main).map(aria).concat([panelText]);
  let photoCountText = '';
  for (const t of photoSources) {
    const m = t.match(photoRe);
    if (m) { photoCountText = m[1] || m[2] || ''; break; }
  }

  // --- Publicaciones (Novedades / Del propietario) ---
  const posts = [];
  const postSection = qa('div[aria-label], h2', main).find((el) => /novedades|del propietario|from the owner|updates from|actualizaciones/i.test(aria(el) || txt(el)));
  if (postSection) {
    const container = postSection.tagName === 'H2' ? (postSection.parentElement && postSection.parentElement.parentElement) : postSection;
    if (container) {
      const dateRe = /(hace\s+\S+\s+\S+|\d+\s+\S+\s+ago|an?\s+\S+\s+ago|ayer|yesterday)/i;
      qa('div', container).forEach((d) => {
        const t = txt(d);
        if (t && t.length > 30 && t.length < 1500 && d.children.length < 6) {
          const m = t.match(dateRe);
          posts.push({ text: t.slice(0, 400), date: m ? m[0] : '' });
        }
      });
    }
  }

  // --- Redes sociales enlazadas ---
  const socialLinks = Array.from(new Set(qa('a[href]', main).map((a) => a.href)
    .filter((h) => /instagram\.com|facebook\.com|tiktok\.com|twitter\.com|x\.com\/|linkedin\.com|youtube\.com/i.test(h) && !/google\./i.test(h))));

  // --- Histograma de estrellas ---
  const histogram = qa('tr[aria-label]', main).map((tr) => aria(tr))
    .filter((a) => /estrella|star/i.test(a))
    .map((a) => { const m = a.match(/(\d)[^\d]+([\d.,]+)/); return m ? [m[1], m[2]] : null; })
    .filter(Boolean);

  // --- Place ID (para el enlace directo de "escribir reseña") ---
  const html = document.documentElement.innerHTML;
  const pid = html.match(/(ChIJ[0-9A-Za-z_-]{20,})/);

  return {
    name: txt(h1),
    category: txt(q('button.DkEaL', main)) || txt(q('button[jsaction*="category"]', main)) || txt(q('span.DkEaL', main)),
    ratingText, reviewsText,
    address: aria(item('address')) || txt(item('address')),
    phone,
    website: websiteEl ? (websiteEl.href || aria(websiteEl)) : '',
    plusCode: aria(item('oloc')) || txt(item('oloc')),
    menuUrl: menuEl ? menuEl.href || '' : '',
    bookingUrl: bookingEl ? bookingEl.href || '' : '',
    bookingButton,
    orderUrl: orderEl ? orderEl.href || '' : '',
    hoursRows, hoursAria, description,
    unclaimed, claimedSignals, permanentlyClosed,
    photoUrls: photoUrls.slice(0, 40), photoCountText,
    posts: posts.slice(0, 10), socialLinks, histogram,
    placeId: pid ? pid[1] : '',
    panelText,
  };
})()`;

export interface RawReview {
  author: string;
  ratingText: string;
  date: string;
  text: string;
  hasOwnerResponse: boolean;
}

export const EXTRACT_REVIEWS = String.raw`(() => {
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const txt = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
  const aria = (el) => (el ? (el.getAttribute('aria-label') || '').trim() : '');
  let nodes = qa('div.jftiEf[data-review-id]');
  if (!nodes.length) nodes = qa('div[data-review-id][aria-label]');
  const seen = new Set();
  const out = [];
  nodes.forEach((n) => {
    const id = n.getAttribute('data-review-id');
    if (seen.has(id)) return;
    seen.add(id);
    const starsEl = q('span.kvMYJc', n) || q('span[role="img"][aria-label*="estrella" i], span[role="img"][aria-label*="star" i]', n);
    const ratingText = aria(starsEl) || txt(q('span.fzvQIb', n));
    const date = txt(q('span.rsqaWe', n)) || txt(q('span.xRkPPb', n)) ||
      ((txt(n).match(/(hace\s+\S+(\s+\S+)?|\d+\s+\S+\s+ago|an?\s+\S+\s+ago)/i) || [''])[0]);
    const body = txt(q('span.wiI7pd', n)) || txt(q('div.MyEned', n));
    const full = txt(n);
    const hasOwnerResponse = !!q('div.CDe7pd', n) || /respuesta del propietario|response from the owner/i.test(full);
    out.push({ author: aria(n) || txt(q('div.d4r55', n)), ratingText, date, text: body.slice(0, 600), hasOwnerResponse });
  });
  return out;
})()`;

export const EXTRACT_ABOUT = String.raw`(() => {
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const txt = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
  const aria = (el) => (el ? (el.getAttribute('aria-label') || '').trim() : '');
  const items = [];
  qa('div.iP2t7d li, div[role="region"] li, div.fontBodyMedium ul li').forEach((li) => {
    const label = aria(li.querySelector('[aria-label]')) || txt(li);
    if (label && label.length < 120) items.push(label);
  });
  const description = txt(document.querySelector('div.PbZDve')) || '';
  return { items: Array.from(new Set(items)), description };
})()`;
