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

/** Cómo se obtuvo cada dato de la descripción general (para la confiabilidad del dato). */
export interface OverviewMeta {
  /** Selector que encontró el nombre ('' = no se encontró encabezado). */
  name: string;
  category: string;
  /** 'F7nice' (bloque de calificación) | 'estrellas-encabezado' | ''. */
  rating: string;
  /** 'F7nice-aria' | 'F7nice-parentesis' | 'boton-encabezado' | ''. */
  reviews: string;
  /** Texto "Sin reseñas" / "No reviews" en el encabezado. */
  noReviewsText: boolean;
  /** Cantidad de filas de información con data-item-id (dirección, teléfono, web…). */
  itemIds: number;
  address: string;
  phone: string;
  website: string;
  hours: string;
  menu: string;
  booking: string;
  description: string;
  /** Texto exacto del que se leyó el total de fotos. */
  photoLabel: string;
  /** 'aria-label' (botón o sección de fotos) | 'texto-panel' (menos fiable) | ''. */
  photoCount: string;
  /** Hay sección de fotos/imagen principal en la ficha. */
  photoSection: boolean;
  /** Google invita a "Agregar fotos" (ficha sin fotos del propietario). */
  addPhotoPrompt: boolean;
  /** Se encontró la sección de Novedades / publicaciones del propietario. */
  postsSection: boolean;
  /** 'enlace' (business.google.com) | 'texto' | ''. */
  unclaimed: string;
  /** 'respuesta-propietario' | 'novedades-propietario' | ''. */
  claimed: string;
  /** Hay pestañas (la ficha es un negocio, no una búsqueda). */
  tabs: boolean;
  /** Place ID leído de la URL de la ficha (!19s…). */
  placeIdFromUrl: string;
  /** Place IDs distintos que aparecen en el HTML (el de la ficha y, a veces, de negocios cercanos). */
  placeIdCandidates: string[];
  /** Página de verificación anti-robots o de consentimiento. */
  blocked: boolean;
}

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
  meta: OverviewMeta;
}

export const EXTRACT_OVERVIEW = String.raw`(() => {
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const txt = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
  const aria = (el) => (el ? (el.getAttribute('aria-label') || '').trim() : '');
  const meta = {};

  let h1 = q('h1.DUwDvf'); meta.name = h1 ? 'h1.DUwDvf' : '';
  if (!h1) { h1 = q('div[role="main"] h1'); meta.name = h1 ? 'div[role=main] h1' : ''; }
  if (!h1) { h1 = q('h1'); meta.name = h1 ? 'h1' : ''; }
  const main = (h1 && h1.closest('div[role="main"]')) || q('div[role="main"][aria-label]') || document.body;
  const item = (id) => q('[data-item-id="' + id + '"]', main);

  // Zonas: las reseñas (y sus autores, con "N reseñas · N fotos") NUNCA cuentan como datos de la ficha.
  const inReview = (el) => !!el.closest('[data-review-id], .jftiEf, .jJc9Ad');
  const tablist = q('[role="tablist"]', main);
  meta.tabs = !!tablist;
  // Encabezado = todo lo que está antes de las pestañas (nombre, calificación, categoría, estado).
  const inHeader = (el) => !inReview(el) && (!tablist ? false : !!(el.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING) && !tablist.contains(el));
  const headerText = qa('*', main).filter((el) => inHeader(el) && el.children.length === 0).map(txt).join(' \n ');
  const ownText = (el) => qa('*', el).filter((n) => !inReview(n) && n.children.length === 0).map(txt).join(' \n ');

  // --- Calificación y reseñas (solo del encabezado) ---
  let ratingText = '';
  let reviewsText = '';
  meta.rating = ''; meta.reviews = '';
  const f7 = q('div.F7nice', main);
  if (f7 && !inReview(f7)) {
    ratingText = txt(q('span[aria-hidden="true"]', f7));
    if (ratingText) meta.rating = 'F7nice';
    const labelled = qa('span[aria-label]', f7).map(aria).find((a) => /\d/.test(a) && !/estrella|star/i.test(a));
    if (labelled) { reviewsText = labelled; meta.reviews = 'F7nice-aria'; }
    else if (/\(\s*\d/.test(txt(f7))) { reviewsText = txt(f7); meta.reviews = 'F7nice-parentesis'; }
  }
  if (!ratingText) {
    const stars = qa('span[role="img"][aria-label*="estrella" i], span[role="img"][aria-label*="star" i]', main).find(inHeader);
    ratingText = aria(stars);
    if (ratingText) meta.rating = 'estrellas-encabezado';
  }
  if (!reviewsText) {
    const btn = qa('button, span', main).filter(inHeader).map((el) => aria(el) || txt(el))
      .find((t) => /\d[\d.,]*\s*(mil\s+)?(reseñas|opiniones|reviews)/i.test(t) && t.length < 60);
    if (btn) { reviewsText = btn; meta.reviews = 'boton-encabezado'; }
  }
  meta.noReviewsText = /(^|\s)(sin reseñas|sin opiniones|no reviews|0 reseñas|0 reviews)(\s|$)/i.test(headerText);

  // --- Datos de contacto ---
  meta.itemIds = qa('[data-item-id]', main).filter((el) => !inReview(el)).length;
  meta.phone = '';
  let phoneEl = q('[data-item-id^="phone:tel:"]', main);
  if (phoneEl) meta.phone = 'data-item-id';
  else { phoneEl = q('button[aria-label^="Teléfono" i], button[aria-label^="Phone" i]', main); if (phoneEl) meta.phone = 'aria-label'; }
  let phone = '';
  if (phoneEl) {
    const id = phoneEl.getAttribute('data-item-id') || '';
    phone = id.startsWith('phone:tel:') ? id.replace('phone:tel:', '') : aria(phoneEl);
  }
  let websiteEl = q('a[data-item-id="authority"]', main); meta.website = websiteEl ? 'data-item-id' : '';
  if (!websiteEl) { websiteEl = q('a[aria-label^="Sitio web" i], a[aria-label^="Website" i]', main); meta.website = websiteEl ? 'aria-label' : ''; }
  let menuEl = q('a[data-item-id="menu"]', main); meta.menu = menuEl ? 'data-item-id' : '';
  if (!menuEl) { menuEl = qa('a[aria-label*="Menú" i], a[aria-label^="Menu" i], a[aria-label*="Carta" i]', main).find((el) => !inReview(el)); meta.menu = menuEl ? 'aria-label' : ''; }
  const bookingEl = qa('a[data-item-id^="action:"][href*="reserv" i], a[aria-label*="Reserv" i], a[aria-label*="Book" i], a[aria-label*="Pedir cita" i], a[aria-label*="cita" i], a[aria-label*="Appointment" i]', main).find((el) => !inReview(el));
  const bookingButton = !!bookingEl || qa('button, a', main).some((el) => !inReview(el) && /^(reservar|reserva|book|book online|pedir cita|reservar mesa)$/i.test(txt(el)));
  meta.booking = bookingEl ? 'enlace' : bookingButton ? 'boton' : '';
  const orderEl = q('a[aria-label*="Pedir" i]:not([aria-label*="cita" i]), a[aria-label*="Order" i], a[data-item-id*="order" i]', main);
  const addressEl = item('address');
  meta.address = addressEl ? 'data-item-id' : '';

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
  meta.hours = hoursRows.length ? 'tabla' : hoursAria ? 'aria-label' : '';

  // --- Descripción (resumen de la ficha; la del propietario está en la pestaña Información) ---
  let description = ''; meta.description = '';
  for (const [sel, name] of [['div.PYvSYb', 'PYvSYb'], ['div[aria-label^="Acerca de" i] div.PbZDve', 'acerca-de'], ['div.WeS02d', 'WeS02d']]) {
    const el = q(sel, main);
    if (el && !inReview(el) && txt(el)) { description = txt(el); meta.description = name; break; }
  }

  // --- Estado de la ficha ---
  const panelText = txt(main).slice(0, 20000);
  const claimLink = qa('a[href*="business.google.com"]', main).find((a) => !inReview(a) && /reclam|propietari|claim|own this/i.test(txt(a) + ' ' + aria(a)));
  const ownPanelText = ownText(main);
  const claimText = /reclam[ae] (este|el) negocio|claim this business|¿eres (el|la) propietari|¿es (el|la) propietari|own this business\?/i.test(ownPanelText);
  meta.unclaimed = claimLink ? 'enlace' : claimText ? 'texto' : '';
  const ownerReply = qa('div.CDe7pd', main).length > 0 || /respuesta del propietario|response from the owner/i.test(panelText);
  // Novedades: el contenedor se identifica por su aria-label o por un título h2 corto (nunca por el texto de todo el panel).
  const postSection = qa('div[aria-label]', main).find((el) => el !== main && !inReview(el) && /^(novedades|del propietario|from the owner|updates from|actualizaciones)/i.test(aria(el)))
    || qa('h2', main).find((el) => !inReview(el) && txt(el).length < 60 && /novedades|del propietario|from the owner|updates from|actualizaciones/i.test(txt(el)));
  meta.postsSection = !!postSection;
  meta.claimed = ownerReply ? 'respuesta-propietario' : postSection ? 'novedades-propietario' : '';
  const unclaimed = !!meta.unclaimed;
  const claimedSignals = !!meta.claimed;
  // Solo el encabezado: una reseña que diga "pensé que estaba cerrado permanentemente" no cuenta.
  const permanentlyClosed = /cerrado permanentemente|permanently closed|cerrado definitivamente/i.test(headerText);

  // --- Fotos ---
  const photoUrls = Array.from(new Set(qa('img', main)
    .filter((img) => !inReview(img))
    .map((img) => img.getAttribute('src') || '')
    .filter((src) => /googleusercontent\.com|ggpht\.com|streetviewpixels/i.test(src) && !/\/a\/|=s\d{2}-|w36-h36|w32-h32/.test(src))));
  // "123 fotos", "Ver fotos (123)", "Photos (1.2K)". Se descartan las estadísticas de autores ("12 reseñas · 40 fotos").
  const photoRe = /(\d[\d.,]*\s*(?:mil|k)?)\s+(?:fotos|photos|imágenes)|(?:fotos|photos)\s*\((\d[\d.,]*\s*(?:mil|k)?)\)/i;
  const authorStats = /(reseñas?|reviews?|opiniones)\s*·\s*\d/i;
  let photoCountText = ''; meta.photoCount = ''; meta.photoLabel = '';
  for (const el of qa('button[aria-label], div[aria-label], a[aria-label]', main)) {
    if (inReview(el) || el === main) continue;
    const t = aria(el);
    if (authorStats.test(t)) continue;
    const m = t.match(photoRe);
    if (m) { photoCountText = m[1] || m[2] || ''; meta.photoCount = 'aria-label'; meta.photoLabel = t.slice(0, 80); break; }
  }
  if (!photoCountText) {
    const line = ownPanelText.split(/\n| {2,}/).find((l) => photoRe.test(l) && !authorStats.test(l));
    const m = line && line.match(photoRe);
    if (m) { photoCountText = m[1] || m[2] || ''; meta.photoCount = 'texto-panel'; meta.photoLabel = line.trim().slice(0, 80); }
  }
  meta.photoSection = photoUrls.length > 0 || qa('button[aria-label^="Foto" i], button[aria-label^="Photo" i]', main).some((el) => !inReview(el));
  meta.addPhotoPrompt = qa('button, a', main).some((el) => !inReview(el) && /^(agregar|añadir|subir) (una )?fotos?$|^add (a )?photos?$/i.test((aria(el) || txt(el)).trim()));

  // --- Publicaciones (Novedades / Del propietario) ---
  const posts = [];
  if (postSection) {
    const container = postSection.tagName === 'H2' ? (postSection.parentElement && postSection.parentElement.parentElement) : postSection;
    if (container && container !== main) {
      const dateRe = /(hace\s+\S+\s+\S+|\d+\s+\S+\s+ago|an?\s+\S+\s+ago|ayer|yesterday)/i;
      qa('div', container).forEach((d) => {
        if (inReview(d)) return;
        const t = txt(d);
        if (t && t.length > 30 && t.length < 1500 && d.children.length < 6) {
          const m = t.match(dateRe);
          posts.push({ text: t.slice(0, 400), date: m ? m[0] : '' });
        }
      });
    }
  }

  // --- Redes sociales enlazadas ---
  const socialLinks = Array.from(new Set(qa('a[href]', main).filter((a) => !inReview(a)).map((a) => a.href)
    .filter((h) => /instagram\.com|facebook\.com|tiktok\.com|twitter\.com|x\.com\/|linkedin\.com|youtube\.com/i.test(h) && !/google\./i.test(h))));

  // --- Histograma de estrellas ---
  const histogram = qa('tr[aria-label]', main).filter((tr) => !inReview(tr)).map((tr) => aria(tr))
    .filter((a) => /estrella|star/i.test(a))
    .map((a) => { const m = a.match(/(\d)[^\d]+([\d.,]+)/); return m ? [m[1], m[2]] : null; })
    .filter(Boolean);

  // --- Place ID: primero la URL de la ficha (!19sChIJ…); el HTML puede incluir los de negocios cercanos ---
  const urlPid = decodeURIComponent(location.href).match(/!19s(ChIJ[0-9A-Za-z_-]{20,})/);
  meta.placeIdFromUrl = urlPid ? urlPid[1] : '';
  const html = document.documentElement.innerHTML;
  const counts = {};
  for (const m of html.matchAll(/ChIJ[0-9A-Za-z_-]{20,}/g)) counts[m[0]] = (counts[m[0]] || 0) + 1;
  meta.placeIdCandidates = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 10);
  const pid = meta.placeIdFromUrl || meta.placeIdCandidates[0] || '';

  meta.blocked = /\/sorry\/|consent\.google\./.test(location.href) || /tráfico inusual|unusual traffic|no soy un robot|not a robot/i.test(panelText.slice(0, 3000));
  meta.category = '';
  let category = '';
  for (const [sel, name] of [['button.DkEaL', 'button.DkEaL'], ['button[jsaction*="category"]', 'jsaction category'], ['span.DkEaL', 'span.DkEaL']]) {
    const el = q(sel, main);
    if (el && txt(el)) { category = txt(el); meta.category = name; break; }
  }

  return {
    name: txt(h1),
    category,
    ratingText, reviewsText,
    address: aria(addressEl) || txt(addressEl),
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
    placeId: pid,
    panelText,
    meta,
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

export interface RawAbout {
  items: string[];
  description: string;
  sections: number;
}

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
  // Secciones de la pestaña (Accesibilidad, Pagos…): indican que la pestaña cargó.
  const sections = qa('div.iP2t7d, div[role="region"]').length;
  return { items: Array.from(new Set(items)), description, sections };
})()`;
