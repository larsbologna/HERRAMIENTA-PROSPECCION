/**
 * RUBROS: qué tipo de negocio es cada prospecto y cómo consigue clientes.
 *
 * Cada rubro tiene un MODELO COMERCIAL (turnos, reservas, productos o consultas) y su vocabulario
 * ("pedir un turno", "otra veterinaria"…). Con eso se eligen las oportunidades que tienen sentido
 * (a un pet shop nunca se le ofrecen turnos ni reservas; una veterinaria habla de TURNOS) y se
 * escriben los mensajes en el idioma del dueño.
 *
 * - Normalización: "Veterinaria", "Veterinarias", "Veterinario", "Clínica veterinaria" → Veterinarias.
 * - Detección: categoría de Google (confianza alta) → nombre (media) → descripción, web o bio de
 *   Instagram (baja: no se asigna sola, queda para asignar a mano). Nunca se inventa un rubro.
 * - Extensible: para sumar un rubro alcanza con agregar una entrada, o crearlo desde la app
 *   ("Agregar rubro"): se guarda en la base y se usa igual que los de fábrica.
 */

export type RubroModel = 'turnos' | 'reservas' | 'productos' | 'consultas';
/** Temas de oportunidad, en el orden en que le importan a cada rubro. */
export type Topic = 'contacto' | 'agenda' | 'catalogo' | 'reputacion' | 'maps' | 'web' | 'instagram';
export type RubroConfidence = 'alta' | 'media' | 'baja';
export type RubroSource = 'google' | 'nombre' | 'descripcion' | 'web' | 'instagram' | 'busqueda' | 'manual';

export interface RubroVocab {
  /** "otra veterinaria", "otro pet shop" (a quién se va el cliente). */
  otro: string;
  /** Qué quiere hacer el cliente: "hacer una consulta o pedir un turno". */
  necesidad: string;
  /** "pedir un turno" / "reservar una mesa" (solo si el rubro trabaja con agenda). */
  bookingVerb?: string;
  /** "turnos" / "reservas". */
  bookingNoun?: string;
  /** "clientes", "pacientes", "socios". */
  clientes: string;
  /** Plural en minúscula para hablar del rubro: "veterinarias", "pet shops". */
  plural: string;
}

export interface RubroProfile {
  key: string;
  /** Nombre visible (plural): "Veterinarias". */
  label: string;
  /** Texto de categoría o nombre que identifica al rubro (normalizado: sin acentos, minúsculas). */
  match: RegExp;
  model: RubroModel;
  /** Cómo agenda el rubro: turnos, reservas o nada (un pet shop no agenda). */
  booking: 'turnos' | 'reservas' | null;
  /** Vende productos (catálogo, pedidos). */
  products: boolean;
  vocab: RubroVocab;
  /** Temas de oportunidad en orden de importancia para este rubro. */
  focus: Topic[];
  custom?: boolean;
}

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const slug = (s: string) => norm(s).replace(/ /g, '-');

const FOCUS: Record<RubroModel, Topic[]> = {
  turnos: ['agenda', 'contacto', 'reputacion', 'maps', 'instagram', 'web'],
  reservas: ['agenda', 'contacto', 'maps', 'reputacion', 'web', 'instagram'],
  productos: ['catalogo', 'contacto', 'instagram', 'maps', 'reputacion', 'web'],
  consultas: ['contacto', 'web', 'reputacion', 'maps', 'instagram'],
};

type Def = Omit<RubroProfile, 'booking' | 'products' | 'focus' | 'vocab'> & Partial<Pick<RubroProfile, 'booking' | 'products' | 'focus'>> & { vocab: Partial<RubroVocab> & Pick<RubroVocab, 'otro'> };

function profile(d: Def): RubroProfile {
  const booking = d.booking !== undefined ? d.booking : d.model === 'turnos' ? 'turnos' : d.model === 'reservas' ? 'reservas' : null;
  const products = d.products ?? d.model === 'productos';
  return {
    ...d,
    booking,
    products,
    focus: d.focus ?? FOCUS[d.model],
    vocab: {
      necesidad: booking === 'turnos' ? 'hacer una consulta o pedir un turno' : booking === 'reservas' ? 'hacer una consulta o reservar' : products ? 'consultar por un producto o hacer un pedido' : 'hacer una consulta',
      clientes: 'clientes',
      plural: d.label.toLowerCase(),
      ...(booking === 'turnos' ? { bookingVerb: 'pedir un turno', bookingNoun: 'turnos' } : booking === 'reservas' ? { bookingVerb: 'reservar', bookingNoun: 'reservas' } : {}),
      ...d.vocab,
    },
  };
}

/** Rubros de fábrica. El orden importa: los específicos primero (el primero que coincide gana). */
export const BUILTIN_RUBROS: RubroProfile[] = [
  profile({ key: 'veterinarias', label: 'Veterinarias', model: 'turnos', match: /veterinari|hospital veterinario|clinica veterinaria/,
    vocab: { otro: 'otra veterinaria', necesidad: 'hacer una consulta o pedir un turno' }, focus: ['contacto', 'agenda', 'reputacion', 'web', 'maps', 'instagram'] }),
  profile({ key: 'pet-shops', label: 'Pet Shops', model: 'productos', match: /pet ?shop|tienda de (animales|mascotas)|alimento(s)? para mascotas|accesorios para mascotas|forrajeria|mascotas/,
    vocab: { otro: 'otro pet shop', necesidad: 'consultar por un producto o hacer un pedido' }, focus: ['catalogo', 'contacto', 'instagram', 'maps', 'reputacion', 'web'] }),
  profile({ key: 'barberias', label: 'Barberías', model: 'turnos', match: /barber/,
    vocab: { otro: 'otra barbería', necesidad: 'sacar un turno', bookingVerb: 'sacar un turno' }, focus: ['agenda', 'instagram', 'maps', 'contacto', 'reputacion', 'web'] }),
  profile({ key: 'peluquerias', label: 'Peluquerías', model: 'turnos', match: /peluquer|salon de belleza|estilista|coiffure|hair ?salon/,
    vocab: { otro: 'otra peluquería', necesidad: 'sacar un turno', bookingVerb: 'sacar un turno' }, focus: ['agenda', 'instagram', 'maps', 'contacto', 'reputacion', 'web'] }),
  profile({ key: 'estetica', label: 'Centros de estética', model: 'turnos', match: /estetic|\bspa\b|depilaci|manicur|\bunas\b|\bnails?\b|cosmetolog|pestanas|masaj|cosmiatr/,
    vocab: { otro: 'otro centro de estética', necesidad: 'consultar o pedir un turno' } }),
  profile({ key: 'odontologos', label: 'Odontólogos', model: 'turnos', match: /odont|dentist|dental|ortodonc/,
    vocab: { otro: 'otro consultorio', necesidad: 'pedir un turno', clientes: 'pacientes' }, focus: ['agenda', 'contacto', 'reputacion', 'web', 'maps', 'instagram'] }),
  profile({ key: 'consultorios', label: 'Consultorios y salud', model: 'turnos', match: /consultorio|medic[oa]|clinica|kinesi|fisioterap|psicolog|nutricion|centro de salud|pediatr|dermatolog|traumatolog|fonoaudiolog|podolog/,
    vocab: { otro: 'otro consultorio', necesidad: 'pedir un turno', clientes: 'pacientes' }, focus: ['agenda', 'contacto', 'reputacion', 'web', 'maps', 'instagram'] }),
  profile({ key: 'gimnasios', label: 'Gimnasios', model: 'consultas', match: /gimnasio|\bgym\b|fitness|crossfit|pilates|centro de entrenamiento|entrenamiento funcional|\bbox\b|artes marciales|yoga/,
    vocab: { otro: 'otro gimnasio', necesidad: 'consultar por los planes o una clase de prueba', clientes: 'socios' }, focus: ['contacto', 'web', 'instagram', 'maps', 'reputacion'] }),
  profile({ key: 'restaurantes', label: 'Restaurantes', model: 'reservas', products: false,
    match: /restaurant|parrilla|pizzer|bodegon|cantina|\bresto\b|sushi|hamburgues|rotiser|bistro|trattoria|comida|cerveceria|tenedor libre|empanad|asador|bar de tapas|\bbar\b/,
    vocab: { otro: 'otro restaurante', necesidad: 'reservar una mesa o hacer un pedido', bookingVerb: 'reservar una mesa', bookingNoun: 'reservas' } }),
  profile({ key: 'cafeterias', label: 'Cafeterías', model: 'consultas', match: /cafeter|\bcafe\b|coffee|panaderia|confiteria|heladeria|pasteleria/,
    vocab: { otro: 'otro lugar', necesidad: 'consultar o hacer un pedido' }, focus: ['maps', 'instagram', 'contacto', 'reputacion', 'web'] }),
  profile({ key: 'inmobiliarias', label: 'Inmobiliarias', model: 'consultas', match: /inmobiliari|bienes raices|real estate|propiedades/,
    vocab: { otro: 'otra inmobiliaria', necesidad: 'consultar por una propiedad' }, focus: ['contacto', 'web', 'instagram', 'maps', 'reputacion'] }),
  profile({ key: 'talleres-mecanicos', label: 'Talleres mecánicos', model: 'turnos', match: /taller|mecanic|lubricentro|gomeria|chapa y pintura|auto repair|service automotor|tren delantero/,
    vocab: { otro: 'otro taller', necesidad: 'pedir un presupuesto o un turno', bookingVerb: 'pedir un turno' }, focus: ['contacto', 'reputacion', 'agenda', 'maps', 'web'] }),
  profile({ key: 'estudios-juridicos', label: 'Estudios jurídicos', model: 'consultas', match: /abogad|estudio juridico|juridic|\blegal\b|escribani|notari/,
    vocab: { otro: 'otro estudio', necesidad: 'hacer una consulta' }, focus: ['contacto', 'web', 'reputacion', 'maps', 'instagram'] }),
  profile({ key: 'ferreterias', label: 'Ferreterías', model: 'productos', match: /ferreter|corralon|pintureria|materiales de construccion|bulonera/,
    vocab: { otro: 'otra ferretería', necesidad: 'consultar si tienen algo o pedir un presupuesto' } }),
  profile({ key: 'opticas', label: 'Ópticas', model: 'productos', match: /optica|anteojos|lentes de contacto/,
    vocab: { otro: 'otra óptica', necesidad: 'consultar por anteojos o lentes' } }),
  profile({ key: 'farmacias', label: 'Farmacias', model: 'productos', match: /farmacia|perfumeria/, vocab: { otro: 'otra farmacia' } }),
  profile({ key: 'kioscos', label: 'Kioscos', model: 'productos', match: /kiosco|quiosco|polirrubro|maxikiosco|drugstore/, vocab: { otro: 'otro kiosco' } }),
  profile({ key: 'tiendas', label: 'Tiendas', model: 'productos', match: /tienda|\bstore\b|boutique|ropa|indumentaria|zapateria|calzado|regaleria|bazar|jugueteria|libreria|accesorios|\bshop\b|moda/,
    vocab: { otro: 'otra tienda' } }),
];

/** Perfil para negocios sin rubro detectado (los mensajes hablan en general, sin turnos ni reservas). */
export const GENERAL_RUBRO: RubroProfile = profile({ key: 'general', label: 'Sin rubro', model: 'consultas', match: /$^/, vocab: { otro: 'otra opción', plural: 'negocios del rubro' } });

// ------------------------------------------------------------------ rubros personalizados

export interface CustomRubro {
  key: string;
  label: string;
  model: RubroModel;
  /** Palabras que identifican al rubro (además de las del nombre). */
  keywords: string[];
}

/** "Talleres mecánicos" → ["taller", "mecanic"]: raíces para comparar sin plurales ni género. */
export function stems(text: string): string[] {
  const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'para', 'con', 'a']);
  return norm(text).split(' ').filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => {
    let s = w;
    if (s.length > 5 && /es$/.test(s) && !/[aeiou]es$/.test(s.slice(0, -1))) s = s.slice(0, -2);
    else if (s.length > 4 && /s$/.test(s)) s = s.slice(0, -1);
    if (s.length > 5 && /[aeo]$/.test(s)) s = s.slice(0, -1);
    return s;
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function customProfile(c: CustomRubro): RubroProfile {
  const name = stems(c.label);
  const extra = c.keywords.map((k) => stems(k).join(' ')).filter(Boolean);
  // Todas las palabras del nombre (en cualquier orden) o alguna palabra clave extra.
  const nameRe = name.length ? name.map((w) => `(?=.*${escapeRe(w)})`).join('') + '.*' : '$^';
  const extraRe = extra.map((k) => escapeRe(k)).join('|');
  return profile({
    key: c.key, label: c.label, model: c.model, custom: true,
    match: new RegExp(extraRe ? `^(?:${nameRe})|${extraRe}` : `^(?:${nameRe})`),
    vocab: { otro: 'otra opción', plural: c.label.toLowerCase() },
  });
}

/** Clave normalizada para un rubro escrito a mano ("Ópticas" = "optica" = "ÓPTICAS"). */
export function rubroKeyFor(label: string): string {
  return stems(label).join('-') || slug(label);
}

// ------------------------------------------------------------------ catálogo (fábrica + personalizados)

export class RubroCatalog {
  private readonly customs: RubroProfile[];
  constructor(custom: CustomRubro[] = []) {
    const builtinKeys = new Set(BUILTIN_RUBROS.map((r) => r.key));
    this.customs = custom.filter((c) => !builtinKeys.has(c.key)).map(customProfile);
  }

  /** Todos los rubros: los personalizados primero (los creó el usuario: son más específicos que los de fábrica). */
  all(): RubroProfile[] {
    return [...this.customs, ...BUILTIN_RUBROS];
  }

  get(key: string | null | undefined): RubroProfile | undefined {
    if (!key) return undefined;
    return this.all().find((r) => r.key === key);
  }

  /** Perfil del prospecto (o el general si no tiene rubro). */
  profileFor(key: string | null | undefined): RubroProfile {
    return this.get(key) ?? GENERAL_RUBRO;
  }

  /**
   * Rubro a partir de lo que escribió el usuario ("veterinaria", "Veterinarias", "Clínica veterinaria",
   * "pet-shops"). Undefined si no corresponde a ninguno conocido.
   */
  resolve(input: string | null | undefined): RubroProfile | undefined {
    if (!input?.trim()) return undefined;
    const t = norm(input);
    const k = rubroKeyFor(input);
    return this.all().find((r) => r.key === input || r.key === k || rubroKeyFor(r.label) === k) ?? this.all().find((r) => r.match.test(t));
  }

  /** ¿Este texto (categoría, nombre…) corresponde al rubro? */
  matches(profile: RubroProfile, text: string | null | undefined): boolean {
    return !!text && profile.match.test(norm(text));
  }

  /**
   * Detecta el rubro de un negocio con la información disponible, de la más confiable a la menos.
   * Con confianza baja NO se asigna solo (se sugiere y se deja para asignar a mano).
   */
  detect(b: { category?: string | null; additionalCategories?: string[]; name?: string | null; description?: string | null; website?: string | null; instagramBio?: string | null }): RubroDetection | undefined {
    const tries: Array<[RubroSource, RubroConfidence, string | null | undefined]> = [
      ['google', 'alta', b.category],
      ['google', 'alta', b.additionalCategories?.join(' | ')],
      ['nombre', 'media', b.name],
      ['descripcion', 'baja', b.description],
      ['instagram', 'baja', b.instagramBio],
      ['web', 'baja', b.website?.replace(/^https?:\/\/(www\.)?/, '').replace(/[./-]+/g, ' ')],
    ];
    for (const [source, confidence, text] of tries) {
      if (!text?.trim()) continue;
      const t = norm(text);
      const hit = this.all().find((r) => r.match.test(t));
      if (hit) return { key: hit.key, label: hit.label, source, confidence };
    }
    return undefined;
  }
}

export interface RubroDetection {
  key: string;
  label: string;
  source: RubroSource;
  confidence: RubroConfidence;
}

/** Catálogo solo con los rubros de fábrica (para usos sin base de datos). */
export const DEFAULT_CATALOG = new RubroCatalog();
