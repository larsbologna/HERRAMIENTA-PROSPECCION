/**
 * Google Maps SIMULADO para el Generador de Prospectos: página de resultados de búsqueda con
 * carga progresiva al desplazarse (como Maps) y fichas de negocio con la estructura DOM real
 * (mismos selectores que usa EXTRACT_OVERVIEW).
 */

export interface FakePlace {
  slug: string;
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  /** Identificador de la ficha en la URL (0x…:0x…). */
  feature: string;
  placeId: string;
  rating?: number;
  reviews?: number;
  /** false = Google ofrece "Reclamar este negocio". */
  claimed?: boolean;
  hoursDays?: number;
  posts?: boolean;
  booking?: boolean;
  closed?: boolean;
  category?: string;
}

const hex = (n: number) => n.toString(16).padStart(12, '0');
let seq = 1;

/** Crea un negocio simulado con identificadores únicos (salvo que se indiquen). */
export function place(p: Partial<FakePlace> & { slug: string; name: string }): FakePlace {
  const n = seq++;
  return {
    feature: `0x95a3${hex(n)}:0x${hex(n * 7919)}`,
    placeId: `ChIJ${`Fake${n}`.padEnd(23, 'x')}`,
    category: 'Barbería',
    rating: 4.5,
    reviews: 80,
    claimed: true,
    hoursDays: 7,
    posts: true,
    booking: false,
    ...p,
  };
}

export function placeUrl(base: string, p: FakePlace): string {
  return `${base}/maps/place/${p.slug}/data=!4m7!3m6!1s${p.feature}!8m2!3d-34.72!4d-58.25!16s%2Fg%2F11${p.slug.replace(/-/g, '')}!19s${p.placeId}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export function placePage(p: FakePlace, base: string): string {
  const rows = DAYS.slice(0, p.hoursDays ?? 0).map((d) => `<tr><td>${d}</td><td aria-label="10:00–20:00">10:00–20:00</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(p.name)} - Google Maps</title>
<style>body{margin:0;font-family:Arial}div[role=main]{width:408px;height:100vh}.m6QErb{height:100vh;overflow-y:auto}</style></head><body>
<div role="main" aria-label="${esc(p.name)}"><div class="m6QErb DxyBCb" tabindex="-1">
  <h1 class="DUwDvf">${esc(p.name)}</h1>
  ${p.reviews ? `<div class="F7nice"><span><span aria-hidden="true">${String(p.rating).replace('.', ',')}</span></span><span><span aria-label="${p.reviews} reseñas">(${p.reviews})</span></span></div>` : '<div><span>Sin reseñas</span></div>'}
  <button class="DkEaL">${esc(p.category ?? '')}</button>
  ${p.closed ? '<span>Cerrado permanentemente</span>' : ''}
  <div role="tablist"><button role="tab">Descripción general</button><button role="tab">Reseñas</button><button role="tab">Información</button></div>
  ${p.address ? `<button data-item-id="address" aria-label="Dirección: ${esc(p.address)}">${esc(p.address)}</button>` : ''}
  ${rows ? `<div class="t39EBf" aria-label="horario"><table class="eK4R0e"><tbody>${rows}</tbody></table></div>` : ''}
  ${p.website ? `<a data-item-id="authority" aria-label="Sitio web: ${esc(p.website)}" href="${esc(p.website)}">${esc(p.website)}</a>` : ''}
  ${p.phone ? `<button data-item-id="phone:tel:${esc(p.phone.replace(/\s/g, ''))}" aria-label="Teléfono: ${esc(p.phone)}">${esc(p.phone)}</button>` : ''}
  <button data-item-id="oloc" aria-label="Plus Code: 7XQ8+2F">7XQ8+2F</button>
  ${p.booking ? `<a data-item-id="action:reserve" href="${base}/reservas" aria-label="Reservar turno">Reservar</a>` : ''}
  ${p.claimed === false ? '<a href="https://business.google.com/create">¿Es el propietario de este negocio? Reclamar este negocio</a>' : ''}
  ${p.posts ? '<div aria-label="Novedades del propietario"><div>Promo de corte + barba todos los martes, ¡te esperamos! hace 2 semanas</div></div>' : ''}
  ${p.claimed && !p.posts ? '<div class="jftiEf" data-review-id="r1" aria-label="Juan"><span class="wiI7pd">Muy bien</span><div class="CDe7pd">Respuesta del propietario: ¡gracias!</div></div>' : ''}
</div></div></body></html>`;
}

/** Página de resultados: muestra 5, carga 5 más cada vez que se desplaza la lista hasta el final. */
export function searchPage(cards: Array<{ place: FakePlace; url: string }>): string {
  const data = JSON.stringify(cards.map((c) => ({
    name: c.place.name,
    url: c.url,
    text: [c.place.name, c.place.category, c.place.closed ? 'Cerrado permanentemente' : 'Abierto'].join(' · '),
  })));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Resultados - Google Maps</title>
<style>body{margin:0;font-family:Arial}div[role=feed]{height:600px;overflow-y:auto;width:408px}.Nv2PK{height:150px;border-bottom:1px solid #ccc}</style></head><body>
<div role="main"><div role="feed" aria-label="Resultados"></div></div>
<script>
const all = ${data.replace(/</g, '\\u003c')};
const feed = document.querySelector('[role=feed]');
let shown = 0, loading = false;
function more() {
  for (const c of all.slice(shown, shown + 5)) {
    const d = document.createElement('div'); d.className = 'Nv2PK';
    const a = document.createElement('a'); a.className = 'hfpxzc'; a.href = c.url; a.setAttribute('aria-label', c.name);
    d.appendChild(a); const t = document.createElement('div'); t.textContent = c.text; d.appendChild(t); feed.appendChild(d);
  }
  shown = Math.min(all.length, shown + 5);
  if (shown >= all.length && !document.querySelector('.HlvSq')) {
    const end = document.createElement('span'); end.className = 'HlvSq'; end.textContent = 'Llegaste al final de la lista.'; feed.appendChild(end);
  }
}
more();
feed.addEventListener('scroll', () => {
  if (loading || shown >= all.length) return;
  if (feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 20) { loading = true; setTimeout(() => { more(); loading = false; }, 250); }
});
</script></body></html>`;
}

/**
 * "Barberías en Quilmes": 13 negocios válidos + trampas (tarjeta repetida, ficha duplicada con el
 * mismo teléfono, fuera de zona, cerrado, el mismo negocio escrito distinto) y una sucursal real.
 */
export function barberiasQuilmes(): { P: Record<string, FakePlace>; FEEDS: Record<string, string[]>; VALID: string[] } {
  const P: Record<string, FakePlace> = {};
  const add = (p: FakePlace) => (P[p.slug] = p);
  add(place({ slug: 'p1', name: 'Barbería Norte', address: 'Rivadavia 100, B1878 Quilmes, Provincia de Buenos Aires', phone: '011 4250-0001', website: 'https://barberianorte.com.ar' }));
  add(place({ slug: 'p2', name: 'Corte Fino', address: 'Mitre 200, Quilmes', phone: '011 4250-0002', claimed: false, posts: false, hoursDays: 0, reviews: 6, rating: 3.8 }));
  add(place({ slug: 'p3', name: 'Barbería El Faro', address: 'Alem 300, Quilmes', phone: '011 4250-0003', claimed: false, hoursDays: 4, posts: false }));
  add(place({ slug: 'p4', name: 'The Barber Club', address: 'Lavalle 400, Quilmes', phone: '011 4250-0004', website: 'https://barberclub.com.ar', booking: true }));
  add(place({ slug: 'p5', name: 'Navaja de Oro', address: 'Moreno 500, Quilmes', website: 'https://instagram.com/navajadeoro' }));
  add(place({ slug: 'p6', name: 'Barbería Don Pepe', address: 'Av. Calchaquí 1234, B1878 Quilmes, Provincia de Buenos Aires', phone: '011 4250-0006' }));
  add(place({ slug: 'p7', name: 'Estilo Urbano', address: 'Brown 700, Quilmes', phone: '011 4250-0007', posts: false }));
  add(place({ slug: 'p8', name: 'Barber Shop 8', address: 'Sarmiento 800, Quilmes', phone: '011 4250-0008', claimed: false }));
  add(place({ slug: 'p9', name: 'Clásica Barbería', address: 'Paz 900, Quilmes', phone: '011 4250-0009', website: 'https://clasica.com.ar', booking: true }));
  // Ficha duplicada del mismo negocio que p3 (otro Place ID, mismo teléfono).
  add(place({ slug: 'd2', name: 'El Faro Barber', address: 'L. N. Alem 300, Quilmes', phone: '+54 11 4250-0003' }));
  add(place({ slug: 'oz', name: 'Barbería Berazategui', address: 'Calle 14 500, Berazategui', phone: '011 4250-0010' }));
  add(place({ slug: 'cl', name: 'Barbería Cerrada', address: 'Roca 1100, Quilmes', phone: '011 4250-0011', closed: true }));
  // Sucursal real de p1: mismo nombre, otra dirección y otro teléfono → se entrega.
  add(place({ slug: 'br', name: 'Barbería Norte', address: 'Yrigoyen 1200, Quilmes', phone: '011 4250-0012' }));
  add(place({ slug: 'n1', name: 'Fade Masters', address: 'Garibaldi 1300, Quilmes', phone: '011 4250-0013' }));
  add(place({ slug: 'n2', name: 'Barbería Vintage', address: 'Olavarría 1400, Quilmes', phone: '011 4250-0014', website: 'https://vintage.com.ar' }));
  // Mismo negocio que p6 escrito distinto (otra ficha, otro teléfono).
  add(place({ slug: 'n3', name: 'Barberia Don Pepe SRL', address: 'Avenida Calchaqui 1234, Quilmes', phone: '011 4250-0099' }));
  add(place({ slug: 'n4', name: 'Los Muchachos Barbería', address: 'Humberto Primo 1500, Quilmes' }));

  const FEEDS: Record<string, string[]> = {
  'Barberías en Quilmes': ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p2', 'p8', 'p9', 'd2', 'oz', 'cl', 'br'],
  'Barbería en Quilmes': ['p4', 'p5', 'n1', 'n2', 'n3', 'n4'],
  'Barberías Quilmes': ['p1'],
  'Barbería cerca de Quilmes': ['p7'],
  };
  const VALID = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'br', 'n1', 'n2', 'n4'];
  return { P, FEEDS, VALID };
}
