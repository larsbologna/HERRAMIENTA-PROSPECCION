/** Scripts que se ejecutan dentro del sitio web del negocio (ver nota en mapsScripts.ts). */

export interface RawWebsite {
  title: string;
  metaDescription: string;
  hasViewportMeta: boolean;
  horizontalOverflow: boolean;
  smallTextRatio: number;
  tapTargetsTooSmall: number;
  phoneLinks: string[];
  emailLinks: string[];
  hasContactForm: boolean;
  hasAddress: boolean;
  contactAboveFold: boolean;
  whatsappLinks: string[];
  hasFloatingWhatsapp: boolean;
  bookingProviders: string[];
  bookingKeywords: boolean;
  chatProviders: string[];
  socialLinks: string[];
  imageCount: number;
  brokenImages: number;
  hasH1: boolean;
  fontFamilies: string[];
  usesModernLayout: boolean;
  copyrightYear: number;
  legacyTech: string[];
  nav: { loadEventEnd: number; domContentLoaded: number; transferSize: number };
  resources: { count: number; transferSize: number };
}

export const EXTRACT_WEBSITE = String.raw`(() => {
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const html = document.documentElement.outerHTML;
  const lower = html.toLowerCase();
  const bodyText = (document.body ? document.body.innerText : '').slice(0, 50000);
  const links = qa('a[href]').map((a) => a.href);
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  const viewport = document.querySelector('meta[name="viewport"]');
  const docWidth = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);

  // Texto pequeño (<12px) sobre una muestra de nodos con texto.
  const textEls = qa('p, li, span, a, td, label').filter((el) => (el.textContent || '').trim().length > 20).slice(0, 400);
  const small = textEls.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12).length;

  // Objetivos táctiles pequeños (<32px) visibles.
  const tapSmall = qa('a, button').filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < vh * 3 && (r.height < 32 || r.width < 32);
  }).length;

  const phoneLinks = Array.from(new Set(links.filter((h) => h.startsWith('tel:'))));
  const emailLinks = Array.from(new Set(links.filter((h) => h.startsWith('mailto:'))));
  const hasContactForm = qa('form').some((f) => f.querySelector('textarea, input[type="email"], input[type="tel"]'));

  const aboveFold = qa('a[href^="tel:"], a[href*="wa.me"], a[href*="whatsapp"], a[href^="mailto:"], a[href*="contact" i], a[href*="contacto" i]')
    .some((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < vh && r.width > 0; });

  const whatsappLinks = Array.from(new Set(links.filter((h) => /wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|whatsapp:\/\//i.test(h))));
  const hasFloatingWhatsapp = qa('a, div, button').some((el) => {
    const label = ((el.getAttribute('href') || '') + ' ' + (el.className && el.className.baseVal === undefined ? el.className : '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
    if (!/whatsapp|wa\.me/.test(label)) return false;
    const pos = getComputedStyle(el).position;
    return pos === 'fixed' || pos === 'sticky';
  }) || /joinchat|wa-widget|whatsapp-float|elfsight-app.*whatsapp|getbutton\.io/.test(lower);

  const BOOKING = {
    'Calendly': /calendly\.com/, 'Booksy': /booksy\.com/, 'Fresha': /fresha\.com/, 'TheFork': /thefork|eltenedor/,
    'OpenTable': /opentable\./, 'Treatwell': /treatwell\./, 'Doctoralia': /doctoralia\./, 'SimplyBook': /simplybook\./,
    'Setmore': /setmore\.com/, 'Acuity': /acuityscheduling\.com/, 'Square Appointments': /squareup\.com\/appointments/,
    'Booking.com': /booking\.com/, 'Reservio': /reservio\./, 'Turnito / AgendaPro': /agendapro\.|turnito\./,
    'CoverManager': /covermanager\./, 'Google Calendar': /calendar\.google\.com\/calendar\/appointments/,
    'WooCommerce Bookings': /wc-bookings|woocommerce-bookings/, 'Amelia': /ameliabooking/, 'Bookly': /bookly/,
  };
  const bookingProviders = Object.keys(BOOKING).filter((k) => BOOKING[k].test(lower));
  const bookingKeywords = /reserv(a|ar|e) (online|ahora|tu|su)|pedir (cita|turno)|sacar turno|book (now|online)|agenda tu|reserva tu mesa/i.test(bodyText);

  const CHAT = {
    'Tawk.to': /tawk\.to/, 'Intercom': /intercom/, 'Crisp': /crisp\.chat/, 'Tidio': /tidio/, 'Zendesk': /zopim|zendesk/,
    'Drift': /drift\.com/, 'HubSpot Chat': /hs-scripts|hubspot/, 'Messenger': /connect\.facebook\.net.*customerchat/,
    'LiveChat': /livechatinc/, 'ManyChat': /manychat/, 'Chatbase / IA': /chatbase|botpress|voiceflow|landbot/,
  };
  const chatProviders = Object.keys(CHAT).filter((k) => CHAT[k].test(lower));

  const socialLinks = Array.from(new Set(links.filter((h) => /instagram\.com|facebook\.com|tiktok\.com|linkedin\.com|youtube\.com|twitter\.com|x\.com\//i.test(h)))).slice(0, 10);

  const imgs = qa('img');
  const brokenImages = imgs.filter((i) => i.complete && i.naturalWidth === 0 && (i.getAttribute('src') || '').length > 0).length;

  const fonts = new Set();
  qa('h1, h2, h3, p, a, button').slice(0, 200).forEach((el) => {
    const f = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (f) fonts.add(f);
  });

  const usesModernLayout = qa('body *').slice(0, 1500).some((el) => {
    const d = getComputedStyle(el).display;
    return d === 'flex' || d === 'grid' || d === 'inline-flex';
  });

  const years = (bodyText.match(/(?:©|copyright|&copy;)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi) || [])
    .map((m) => parseInt((m.match(/(\d{4})(?!.*\d{4})/) || ['0'])[0], 10)).filter((y) => y > 1995);
  const copyrightYear = years.length ? Math.max.apply(null, years) : 0;

  const legacyTech = [];
  if (qa('table').some((t) => t.querySelectorAll('table').length > 0)) legacyTech.push('Maquetación con tablas anidadas');
  if (/<frameset|<marquee|<font /i.test(html)) legacyTech.push('Etiquetas HTML obsoletas');
  if (/\.swf|shockwave/i.test(html)) legacyTech.push('Flash');
  const jq = html.match(/jquery[.-]?(1\.\d+)/i);
  if (jq) legacyTech.push('jQuery ' + jq[1]);
  if (location.protocol !== 'https:') legacyTech.push('Sin HTTPS');

  const nav = performance.getEntriesByType('navigation')[0] || {};
  const res = performance.getEntriesByType('resource');
  const addressRe = /(calle|avenida|av\.|c\/|carrera|plaza|paseo|street|st\.|road|ruta|\d{4,5}\s+[a-záéíóú]+)/i;

  return {
    title: document.title || '',
    metaDescription: (document.querySelector('meta[name="description"]') || { content: '' }).content || '',
    hasViewportMeta: !!viewport && /width\s*=\s*device-width/i.test(viewport.getAttribute('content') || ''),
    horizontalOverflow: docWidth > vw + 8,
    smallTextRatio: textEls.length ? small / textEls.length : 0,
    tapTargetsTooSmall: tapSmall,
    phoneLinks, emailLinks, hasContactForm,
    hasAddress: addressRe.test(bodyText),
    contactAboveFold: aboveFold,
    whatsappLinks, hasFloatingWhatsapp,
    bookingProviders, bookingKeywords, chatProviders, socialLinks,
    imageCount: imgs.length, brokenImages,
    hasH1: !!document.querySelector('h1'),
    fontFamilies: Array.from(fonts).slice(0, 8),
    usesModernLayout, copyrightYear, legacyTech,
    nav: { loadEventEnd: nav.loadEventEnd || 0, domContentLoaded: nav.domContentLoadedEventEnd || 0, transferSize: nav.transferSize || 0 },
    resources: { count: res.length, transferSize: res.reduce((s, r) => s + (r.transferSize || 0), 0) },
  };
})()`;
