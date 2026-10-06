import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { analyze as defaultAnalyze, reverifyAnalysis as defaultReverify } from '../analyzer.js';
import { LoginRateLimiter } from '../auth/rateLimit.js';
import { ROLES, type Role, type User, type UserRepository } from '../auth/users.js';
import { ROOT_DIR, config } from '../config/index.js';
import { DB_FILE } from '../crm/index.js';
import { NotFoundError, endOfToday, type CrmRepository } from '../crm/repository.js';
import { dashboard, metrics, personalKpis } from '../crm/stats.js';
import { ACTIVITY_TYPES, MANUAL_ACTIVITY_TYPES, STATUSES, isStatus, type FollowupStatus, type ProspectFilter, type Settings } from '../crm/types.js';
import { DEFAULT_VERTICAL, VERTICALS } from '../domain/verticals.js';
import { buildInsight, buildMessages, buildSelection, MESSAGE_KEYS, type MessageKey } from '../messages/whatsapp.js';
import { generateProspects as defaultGenerate, MAX_CANTIDAD } from '../generator/generator.js';
import { GENERATOR_STATUSES, type GeneratorRepository } from '../generator/repository.js';
import { catalogFrom } from '../proposal/catalog.js';
import { channelOf } from '../channels/crossCheck.js';
import { isVerified } from '../domain/reliability.js';
import { ProspectingJobs, type JobState } from '../prospecting/job.js';
import { opportunityProfile } from '../prospecting/opportunities.js';
import type { ProspectingRepository } from '../prospecting/repository.js';
import { RUBROS, rubroKey, zonaKey } from '../prospecting/rubros.js';
import { SERVICE_CATALOG } from '../proposal/services.js';
import {
  HttpError,
  Router,
  clientIp,
  isDirectLocal,
  isHttps,
  parseCookies,
  readJson,
  requestOrigin,
  sendJson,
  serializeCookie,
} from './http.js';

export interface AppDeps {
  repo: CrmRepository;
  users: UserRepository;
  /** Función de análisis (se sustituye en tests). */
  analyze?: typeof defaultAnalyze;
  /** "Verificar presencia online" (se sustituye en tests). */
  reverify?: typeof defaultReverify;
  /** Carpeta de la interfaz web. */
  webDir?: string;
  /** Registro de actividad en la consola (se silencia en tests). */
  log?: (message: string) => void;
  /** Generador de Prospectos (historial persistente). Sin él, sus rutas responden 503. */
  generator?: GeneratorRepository;
  /** Función de generación (se sustituye en tests para usar fichas simuladas). */
  generate?: typeof defaultGenerate;
  /** Campañas de la prospección automática. Sin ellas, sus rutas responden 503. */
  prospecting?: ProspectingRepository;
  /** Sobrescribe opciones de proxy/seguridad (tests). */
  security?: Partial<Pick<typeof config, 'trustProxy' | 'publicUrl' | 'cookieSecure' | 'setupToken'>>;
}

const COOKIE = 'pros_sid';
const ADMIN: Role[] = ['admin'];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Cabeceras de seguridad para todas las respuestas. */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

export function createApp(deps: AppDeps): http.Server {
  const { repo, users } = deps;
  const runAnalysis = deps.analyze ?? defaultAnalyze;
  const runReverify = deps.reverify ?? defaultReverify;
  const webDir = deps.webDir ?? path.join(ROOT_DIR, 'web');
  const log = deps.log ?? ((m: string) => console.log(m));
  const sec = { trustProxy: config.trustProxy, publicUrl: config.publicUrl, cookieSecure: config.cookieSecure, setupToken: config.setupToken, ...deps.security };
  const limiter = new LoginRateLimiter();
  const ipLimiter = new LoginRateLimiter(30);
  let busy: { userName: string } | null = null;
  let generating: { userName: string } | null = null;
  const runGenerate = deps.generate ?? defaultGenerate;
  // Búsqueda automática (buscar → analizar → guardar) en segundo plano, de a un negocio por vez.
  const jobs = deps.generator && deps.prospecting
    ? new ProspectingJobs({ crm: repo, generator: deps.generator, prospecting: deps.prospecting, generate: runGenerate, analyze: runAnalysis, log })
    : undefined;
  /** Un solo trabajo pesado (Chromium) a la vez: análisis, generador o prospección automática. */
  const ensureIdle = () => {
    if (busy) throw new HttpError(409, `Ya hay un análisis en curso (${busy.userName}). Esperá a que termine.`);
    if (generating) throw new HttpError(409, `Ya hay una generación en curso (${generating.userName}). Esperá a que termine.`);
    if (jobs?.isRunning()) throw new HttpError(409, `Ya hay una búsqueda de prospectos en curso (${jobs.current()!.userName}). Esperá a que termine.`);
  };
  const needProspecting = () => {
    if (!jobs || !deps.prospecting) throw new HttpError(503, 'La prospección automática no está disponible.');
    return { jobs, prospecting: deps.prospecting };
  };

  const isAdmin = (u: User) => u.role === 'admin';
  const secureCookie = (req: http.IncomingMessage) => (sec.cookieSecure === 'true' ? true : sec.cookieSecure === 'false' ? false : isHttps(req, sec.trustProxy));
  const setSessionCookie = (req: http.IncomingMessage, res: http.ServerResponse, token: string) =>
    res.setHeader('Set-Cookie', serializeCookie(COOKIE, token, { maxAge: users.sessionDays * 86_400, secure: secureCookie(req) }));
  const clearSessionCookie = (req: http.IncomingMessage, res: http.ServerResponse) =>
    res.setHeader('Set-Cookie', serializeCookie(COOKIE, '', { maxAge: 0, secure: secureCookie(req) }));
  const publicUser = (u: User) => ({ id: u.id, name: u.name, username: u.username, email: u.email, role: u.role });

  const globalSettings = (): Settings => repo.settings({ sellerName: '', sellerBusiness: config.seller.business, sellerCity: '', sellerIntro: '', sellerLink: '' });
  /** Los mensajes de WhatsApp firman con el nombre del usuario conectado. */
  const sellerFor = (u: User) => {
    const s = globalSettings();
    return { sellerName: u.name || s.sellerName, sellerCity: s.sellerCity, sellerBusiness: s.sellerBusiness, sellerIntro: s.sellerIntro, sellerLink: s.sellerLink };
  };
  /** Un vendedor solo accede a sus prospectos; a los ajenos responde "no encontrado". */
  const ensureAccess = (u: User, prospectId: string) => {
    const assignee = repo.assigneeOf(prospectId);
    if (assignee === undefined || (!isAdmin(u) && assignee !== u.id)) throw new NotFoundError('Prospecto no encontrado.');
  };
  const needGenerator = (): GeneratorRepository => {
    if (!deps.generator) throw new HttpError(503, 'El Generador de Prospectos no está disponible.');
    return deps.generator;
  };
  /** Un vendedor solo ve y modifica los prospectos que generó él; el admin, todos. */
  const ensureGenerated = (u: User, id: string) => {
    const owner = needGenerator().ownerOf(id);
    if (owner === undefined || (!isAdmin(u) && owner !== u.id)) throw new NotFoundError('Prospecto generado no encontrado.');
  };
  const detailFor = (u: User, id: string) => {
    const detail = repo.get(id);
    const seller = sellerFor(u);
    return { ...detail, messages: buildMessages(detail, seller), messageSelection: buildSelection(detail, seller), messageInsight: buildInsight(detail, seller) };
  };

  /** La búsqueda en curso la ve quien la inició (y un administrador). */
  const visibleJob = (u: User, j: JobState | undefined) => (j && (isAdmin(u) || j.userId === u.id) ? j : null);

  /** Datos del Modo Prospección Rápida: lo justo para decidir y contactar, sin el análisis completo. */
  const quickCard = (u: User, id: string) => {
    const d = repo.get(id);
    const a = d.analysis;
    const ch = a?.channels;
    const q = a?.profile?.dataQuality;
    const chan = (cid: Parameters<typeof channelOf>[1]) => {
      const c = channelOf(ch, cid);
      return c ? { status: c.status, url: c.url ?? null, detail: c.detail ?? null, sources: c.sources } : null;
    };
    const seller = sellerFor(u);
    const ownWeb = channelOf(ch, 'web')?.status === 'encontrado' ? channelOf(ch, 'web')?.url : d.website && !/instagram|facebook|wa\.me|linktr/i.test(d.website) ? d.website : null;
    return {
      id: d.id, name: d.name, category: d.category, address: d.address, phone: d.phone, mapsUrl: d.mapsUrl,
      rating: d.rating, reviewCount: d.reviewCount, status: d.status, notes: d.notes,
      campaignId: d.campaignId, campaignLabel: d.campaignLabel, potentialLevel: d.potentialLevel, potentialReason: d.potentialReason,
      nextFollowupAt: d.nextFollowupAt, analyzedAt: d.analyzedAt,
      verified: a?.profile ? {
        rating: d.rating !== null && isVerified(q, 'rating'), reviewCount: d.reviewCount !== null && isVerified(q, 'reviewCount'),
        phone: !!d.phone && isVerified(q, 'phone'), hours: isVerified(q, 'hours'), website: isVerified(q, 'website'),
      } : null,
      channels: ch ? { instagram: chan('instagram'), web: chan('web'), whatsapp: chan('whatsapp'), reservas: chan('reservas'), review: ch.review } : null,
      whatsappNumber: ch?.whatsappNumber ?? null,
      whatsappSource: ch?.whatsappSource ?? null,
      instagramUrl: ch?.instagramUrl ?? null,
      websiteUrl: ownWeb ?? null,
      opportunities: a?.proposal ? opportunityProfile(a) : null,
      messages: buildMessages(d, seller),
      messageInsight: buildInsight(d, seller),
    };
  };

  const router = new Router()
    // ================================================================ público
    .on('GET', '/api/estado', () => ({ ok: true, ocupado: !!busy }), { public: true })

    .on('GET', '/api/auth/estado', ({ req }) => ({
      setupRequired: users.count() === 0,
      // Solo se puede crear el primer administrador desde esta máquina o con SETUP_TOKEN.
      setupAllowed: users.count() === 0 && (isDirectLocal(req) || !!sec.setupToken),
      setupNeedsToken: users.count() === 0 && !isDirectLocal(req) && !!sec.setupToken,
    }), { public: true })

    .on('POST', '/api/auth/setup', async ({ req, res }) => {
      const body = await readJson<Record<string, string>>(req);
      if (users.count() > 0) throw new HttpError(409, 'El administrador inicial ya fue creado. Iniciá sesión.');
      const tokenOk = !!sec.setupToken && body.setupToken === sec.setupToken;
      if (!isDirectLocal(req) && !tokenOk) {
        throw new HttpError(403, 'Por seguridad, el primer administrador se crea desde la misma computadora o con el SETUP_TOKEN configurado en el servidor.');
      }
      const user = await users.create({ name: body.name, email: body.email || null, username: body.username, password: body.password, role: 'admin' });
      const { token } = users.createSession(user.id, { ip: clientIp(req, sec.trustProxy), userAgent: req.headers['user-agent'] });
      setSessionCookie(req, res, token);
      repo.logSystem('usuario', user.id, `Administrador inicial creado: ${user.username}`);
      repo.logSystem('login', user.id, clientIp(req, sec.trustProxy));
      return { user: publicUser(user) };
    }, { public: true })

    .on('POST', '/api/auth/login', async ({ req, res }) => {
      const body = await readJson<{ username?: unknown; password?: unknown }>(req);
      const username = String(body.username ?? '').trim().toLowerCase();
      const ip = clientIp(req, sec.trustProxy);
      const key = `${ip}|${username}`;
      const wait = Math.max(limiter.blockedFor(key), ipLimiter.blockedFor(ip));
      if (wait) throw new HttpError(429, `Demasiados intentos. Probá de nuevo en ${Math.ceil(wait / 60)} minuto(s).`);
      const user = await users.verifyCredentials(username, String(body.password ?? ''));
      if (!user) {
        limiter.fail(key);
        ipLimiter.fail(ip);
        throw new HttpError(401, 'Usuario o contraseña incorrectos.');
      }
      limiter.success(key);
      const { token } = users.createSession(user.id, { ip, userAgent: req.headers['user-agent'] });
      setSessionCookie(req, res, token);
      repo.logSystem('login', user.id, ip);
      return { user: publicUser(user) };
    }, { public: true })

    // ================================================================ sesión
    .on('POST', '/api/auth/logout', ({ req, res, user }) => {
      users.deleteSession(parseCookies(req.headers.cookie)[COOKIE]);
      clearSessionCookie(req, res);
      repo.logSystem('logout', user.id, clientIp(req, sec.trustProxy));
      return { ok: true };
    })
    .on('GET', '/api/auth/me', ({ user }) => ({ user: publicUser(user) }))
    .on('PUT', '/api/auth/password', async ({ req, res, user }) => {
      const body = await readJson<{ current?: string; next?: string }>(req);
      await users.changeOwnPassword(user.id, String(body.current ?? ''), String(body.next ?? ''));
      // Cierra las demás sesiones: se crea una nueva para este navegador.
      users.deleteSession(parseCookies(req.headers.cookie)[COOKIE]);
      const { token } = users.createSession(user.id, { ip: clientIp(req, sec.trustProxy), userAgent: req.headers['user-agent'] });
      setSessionCookie(req, res, token);
      repo.logSystem('usuario', user.id, 'Cambió su contraseña');
      return { ok: true };
    })

    .on('GET', '/api/meta', ({ user }) => ({
      statuses: STATUSES,
      activityTypes: MANUAL_ACTIVITY_TYPES.map((id) => ({ id, label: ACTIVITY_TYPES[id] })),
      verticals: [...VERTICALS, DEFAULT_VERTICAL].map((v) => ({ id: v.id, label: v.label })),
      services: Object.values(SERVICE_CATALOG).map((s) => ({ id: s.id, name: s.name })),
      roles: ROLES,
      // Los administradores reciben la lista de usuarios para asignar prospectos.
      users: isAdmin(user) ? users.list().map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active })) : [],
    }))

    // ================================================================ análisis
    .on('POST', '/api/analizar', async ({ req, res, user }) => {
      if (busy) throw new HttpError(409, `Ya hay un análisis en curso (${busy.userName}). Esperá a que termine.`);
      ensureIdle();
      const body = await readJson<{ url?: unknown }>(req);
      const target = String(body.url ?? '').trim();
      if (!target) throw new HttpError(400, 'Pegá el enlace de Google Maps del negocio.');

      busy = { userName: user.name };
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });
      // X-Accel-Buffering: Nginx no acumula el progreso (llega en vivo).
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      const line = (obj: unknown) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
      };
      // Latido: mantiene viva la conexión a través de proxies (Cloudflare corta tras 100 s sin datos).
      const heartbeat = setInterval(() => line({ tipo: 'latido' }), 15_000);
      log(`→ ${user.username} analiza ${target.slice(0, 80)}`);
      try {
        const result = await runAnalysis(target, {
          signal: controller.signal,
          onProgress: (p) => line({ tipo: 'progreso', porcentaje: Math.min(p.percent, 98), mensaje: p.message }),
        });
        const saved = repo.saveAnalysis(result, { userId: user.id });
        const accessible = isAdmin(user) || saved.assignedUserId === user.id;
        line({ tipo: 'progreso', porcentaje: 100, mensaje: saved.created ? 'Prospecto guardado.' : 'Prospecto actualizado con el nuevo análisis.' });
        line({
          tipo: 'resultado',
          prospectId: accessible ? saved.id : null,
          creado: saved.created,
          accesible: accessible,
          nombre: result.profile.name,
          score: result.audit.overallScore,
        });
        log(`✔ ${result.profile.name} (${(result.durationMs / 1000).toFixed(1)} s) ${saved.created ? 'nuevo' : 'reanalizado'}`);
      } catch (err) {
        line({ tipo: 'error', mensaje: (err as Error).message });
        log(`✖ ${(err as Error).message}`);
      } finally {
        clearInterval(heartbeat);
        busy = null;
        res.end();
      }
      return undefined;
    })

    // ================================================================ generador de prospectos
    // Busca negocios nuevos en Google Maps (rubro + zona), sin repetir nunca uno ya entregado.
    .on('POST', '/api/generador/generar', async ({ req, res, user }) => {
      const gen = needGenerator();
      if (generating) throw new HttpError(409, `Ya hay una generación en curso (${generating.userName}). Esperá a que termine.`);
      ensureIdle();
      const body = await readJson<{ rubro?: unknown; zona?: unknown; cantidad?: unknown }>(req);
      const rubro = String(body.rubro ?? '').trim().replace(/\s+/g, ' ');
      const zona = String(body.zona ?? '').trim().replace(/\s+/g, ' ');
      const cantidad = Number(body.cantidad);
      if (!rubro || rubro.length > 80) throw new HttpError(400, 'Indicá el rubro (ej.: Barberías).');
      if (!zona || zona.length > 80) throw new HttpError(400, 'Indicá la ciudad o zona (ej.: Quilmes).');
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) throw new HttpError(400, `La cantidad tiene que ser entre 1 y ${MAX_CANTIDAD}.`);

      generating = { userName: user.name };
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      const line = (obj: unknown) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
      };
      const heartbeat = setInterval(() => line({ tipo: 'latido' }), 15_000);
      const runId = gen.startRun({ rubro, zona, requested: cantidad, userId: user.id });
      log(`→ ${user.username} genera ${cantidad} × "${rubro}" en ${zona}`);
      try {
        const result = await runGenerate({ rubro, zona, cantidad }, {
          known: gen.knownKeys(),
          signal: controller.signal,
          onProgress: (p) => line({ tipo: 'progreso', porcentaje: Math.min(p.percent, 98), mensaje: p.message }),
        });
        const items = gen.saveRun(runId, { rubro, zona, userId: user.id }, result);
        repo.logSystem('generador', user.id, `Generó ${items.length} prospecto(s) de "${rubro}" en ${zona} (pedidos: ${cantidad})`);
        line({ tipo: 'progreso', porcentaje: 100, mensaje: result.message });
        line({ tipo: 'resultado', runId, encontrados: items.length, pedidos: cantidad, agotado: result.exhausted, mensaje: result.message, estadisticas: result.stats, items });
        log(`✔ generador: ${items.length}/${cantidad} "${rubro}" en ${zona}`);
      } catch (err) {
        line({ tipo: 'error', mensaje: (err as Error).message });
        log(`✖ generador: ${(err as Error).message}`);
      } finally {
        clearInterval(heartbeat);
        generating = null;
        res.end();
      }
      return undefined;
    })
    .on('GET', '/api/generador', ({ query, user }) => {
      const gen = needGenerator();
      const owner = isAdmin(user) ? query.get('usuario') || undefined : user.id;
      return {
        items: gen.list({ userId: owner === 'me' ? user.id : owner, status: query.get('estado') ?? undefined, q: query.get('q') ?? undefined, runId: query.get('busqueda') ?? undefined }),
        statuses: GENERATOR_STATUSES,
      };
    })
    .on('GET', '/api/generador/estadisticas', ({ query, user }) => {
      const owner = isAdmin(user) ? query.get('usuario') || undefined : user.id;
      return { stats: needGenerator().stats(owner === 'me' ? user.id : owner) };
    })
    .on('GET', '/api/generador/busquedas', ({ user }) => ({ items: needGenerator().runs(isAdmin(user) ? undefined : user.id) }))
    .on('PATCH', '/api/generador/:id', async ({ req, params, user }) => {
      const gen = needGenerator();
      ensureGenerated(user, params.id!);
      const body = await readJson<{ status?: unknown }>(req);
      return { item: gen.setStatus(params.id!, body.status) };
    })
    // Después del análisis completo (flujo existente), se vincula el prospecto del CRM.
    .on('POST', '/api/generador/:id/vincular', async ({ req, params, user }) => {
      const gen = needGenerator();
      ensureGenerated(user, params.id!);
      const body = await readJson<{ prospectId?: unknown }>(req);
      const prospectId = String(body.prospectId ?? '');
      if (!prospectId) throw new HttpError(400, 'Falta el análisis a vincular.');
      ensureAccess(user, prospectId);
      return { item: gen.linkProspect(params.id!, prospectId) };
    })

    // ================================================================ prospección automática
    // Pantalla principal: rubros, zonas, campañas con su resumen y la búsqueda en curso.
    .on('GET', '/api/prospeccion', ({ user }) => {
      const { jobs: j, prospecting } = needProspecting();
      const scope = isAdmin(user) ? undefined : user.id;
      const campaigns = prospecting.list()
        .map((c) => ({ ...c, summary: prospecting.summary(c.id, scope) }))
        .filter((c) => c.summary.analyzed > 0 || c.summary.found > 0 || isAdmin(user));
      return {
        rubros: RUBROS.map((r) => r.label),
        zonas: [...new Set(['Quilmes', 'Berazategui', 'Bernal', ...prospecting.zonas()])],
        maxCantidad: MAX_CANTIDAD,
        campaigns,
        job: visibleJob(user, j.current()),
      };
    })
    .on('POST', '/api/prospeccion/buscar', async ({ req, user }) => {
      const { jobs: j } = needProspecting();
      const body = await readJson<{ rubro?: unknown; zona?: unknown; cantidad?: unknown }>(req);
      const rubro = String(body.rubro ?? '').trim().replace(/\s+/g, ' ');
      const zona = String(body.zona ?? '').trim().replace(/\s+/g, ' ');
      const cantidad = Number(body.cantidad);
      if (!rubro || rubro.length > 80) throw new HttpError(400, 'Elegí el rubro (ej.: Barberías).');
      if (!zona || zona.length > 80) throw new HttpError(400, 'Elegí la zona (ej.: Quilmes).');
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) throw new HttpError(400, `La cantidad tiene que ser entre 1 y ${MAX_CANTIDAD}.`);
      ensureIdle();
      log(`→ ${user.username} prospección: ${cantidad} × "${rubro}" en ${zona}`);
      return { job: j.start({ rubro, zona, cantidad, user: { id: user.id, name: user.name } }) };
    })
    .on('GET', '/api/prospeccion/trabajo', ({ user }) => ({ job: visibleJob(user, needProspecting().jobs.current()) }))
    .on('POST', '/api/prospeccion/trabajo/cancelar', ({ user }) => {
      const { jobs: j } = needProspecting();
      const cur = j.current();
      if (cur && (isAdmin(user) || cur.userId === user.id)) j.cancel();
      return { ok: true };
    })
    // Listado liviano con filtros combinables: campaña, rubro, zona, estado, potencial.
    .on('GET', '/api/prospeccion/prospectos', ({ query, user }) => {
      needProspecting();
      const estado = query.get('estado') || 'todos';
      const potencial = query.get('potencial');
      const items = repo.list({
        campaignId: query.get('campana') || undefined,
        rubro: query.get('rubro') ? rubroKey(query.get('rubro')!) : undefined,
        zona: query.get('zona') ? zonaKey(query.get('zona')!) : undefined,
        status: estado === 'pendientes' ? 'sin_contactar' : estado,
        potential: potencial === 'alto' || potencial === 'medio' || potencial === 'bajo' ? potencial : undefined,
        q: query.get('q') ?? undefined,
        assignedTo: isAdmin(user) ? undefined : user.id,
        sort: 'potentialLevel',
        dir: 'asc',
      });
      return { items, total: items.length };
    })
    // Cola de "Siguiente prospecto": solo los NO contactados de la campaña / filtros.
    .on('GET', '/api/prospeccion/cola', ({ query, user }) => {
      const { prospecting } = needProspecting();
      const potencial = query.get('potencial');
      return {
        items: prospecting.queue({
          campaignId: query.get('campana') || undefined,
          rubro: query.get('rubro') ? rubroKey(query.get('rubro')!) : undefined,
          zona: query.get('zona') ? zonaKey(query.get('zona')!) : undefined,
          potential: potencial === 'alto' || potencial === 'medio' || potencial === 'bajo' ? potencial : undefined,
          userId: isAdmin(user) ? undefined : user.id,
        }),
      };
    })
    // Tarjeta del Modo Prospección Rápida: solo lo necesario para contactar (liviana).
    .on('GET', '/api/prospeccion/ficha/:id', ({ params, user }) => {
      ensureAccess(user, params.id!);
      return quickCard(user, params.id!);
    })
    // Resultado del contacto: estado + (mensaje enviado | fecha para contactar después | nota).
    .on('POST', '/api/prospeccion/:id/resultado', async ({ req, params, user }) => {
      ensureAccess(user, params.id!);
      const body = await readJson<{ estado?: unknown; fecha?: unknown; mensaje?: unknown; nota?: unknown }>(req);
      const estado = String(body.estado ?? '');
      if (!isStatus(estado)) throw new HttpError(400, 'Estado inválido.');
      const nota = String(body.nota ?? '').trim();
      const mensaje = String(body.mensaje ?? '').trim();
      if (estado === 'contactar_despues') {
        const fecha = String(body.fecha ?? '');
        if (!fecha || Number.isNaN(Date.parse(fecha))) throw new HttpError(400, 'Elegí la fecha para volver a contactarlo.');
        repo.addFollowup(params.id!, { dueAt: new Date(fecha).toISOString(), note: nota || 'Contactar después' }, user.id);
      }
      repo.update(params.id!, { status: estado }, user.id);
      deps.generator?.syncFromCrm(params.id!, estado);
      if (estado === 'contactado' && mensaje) repo.addActivity(params.id!, 'whatsapp', `Mensaje enviado (Prospección rápida):\n\n${mensaje.slice(0, 4500)}`, user.id);
      else if (nota && estado !== 'contactar_despues') repo.addActivity(params.id!, 'nota', nota.slice(0, 4500), user.id);
      return { ok: true, status: estado };
    })

    // ================================================================ prospectos
    .on('GET', '/api/prospects', ({ query, user }) => {
      const num = (k: string) => (query.has(k) && query.get(k) !== '' ? Number(query.get(k)) : undefined);
      const assigned = query.get('assigned') || undefined;
      const filter: ProspectFilter = {
        q: query.get('q') ?? undefined,
        status: query.get('status') ?? undefined,
        vertical: query.get('vertical') || undefined,
        minScore: num('minScore'),
        maxScore: num('maxScore'),
        sort: (query.get('sort') as ProspectFilter['sort']) ?? undefined,
        dir: query.get('dir') === 'asc' ? 'asc' : 'desc',
        // Vendedor: siempre solo los suyos. Admin: todos, sin asignar, los suyos o los de un vendedor.
        assignedTo: !isAdmin(user) ? user.id : assigned === 'me' ? user.id : assigned,
      };
      return { items: repo.list(filter) };
    })
    .on('GET', '/api/prospects/:id', ({ params, user }) => {
      ensureAccess(user, params.id!);
      return detailFor(user, params.id!);
    })
    // "Verificar presencia online": vuelve a revisar web e Instagram antes de generar el mensaje.
    .on('POST', '/api/prospects/:id/verificar', async ({ res, params, user }) => {
      ensureAccess(user, params.id!);
      if (busy) throw new HttpError(409, `Ya hay un análisis en curso (${busy.userName}). Esperá a que termine.`);
      const detail = repo.get(params.id!);
      if (!detail.analysis?.profile?.name) throw new HttpError(400, 'Este prospecto no tiene un análisis guardado: usá "Reanalizar".');
      ensureIdle();
      busy = { userName: user.name };
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      const line = (obj: unknown) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
      };
      const heartbeat = setInterval(() => line({ tipo: 'latido' }), 15_000);
      try {
        const result = await runReverify({ ...detail.analysis, url: detail.analysis.url || detail.mapsUrl }, {
          onProgress: (p) => line({ tipo: 'progreso', porcentaje: Math.min(p.percent, 98), mensaje: p.message }),
        });
        const saved = repo.saveAnalysis(result, { userId: user.id });
        repo.addActivity(saved.id, 'otro', 'Presencia online verificada (web, Instagram y canales de contacto)', user.id);
        line({ tipo: 'progreso', porcentaje: 100, mensaje: 'Canales verificados.' });
        line({ tipo: 'resultado', prospectId: saved.id, canales: result.channels?.channels.length ?? 0 });
      } catch (err) {
        line({ tipo: 'error', mensaje: (err as Error).message });
      } finally {
        clearInterval(heartbeat);
        busy = null;
        res.end();
      }
      return undefined;
    })
    // Presupuesto personalizado del prospecto: { items: [{id, setup, monthly}], discountPct } o null para volver al automático.
    .on('PUT', '/api/prospects/:id/presupuesto', async ({ req, params, user }) => {
      ensureAccess(user, params.id!);
      const body = await readJson<{ override?: unknown }>(req);
      if (!('override' in body)) throw new HttpError(400, 'Falta el presupuesto.');
      repo.setBudgetOverride(params.id!, body.override ?? null, user.id);
      return detailFor(user, params.id!);
    })
    // "Otra versión" del mensaje de WhatsApp: devuelve una variante distinta de la anterior.
    .on('GET', '/api/prospects/:id/mensaje', ({ params, query, user }) => {
      ensureAccess(user, params.id!);
      const tipo = query.get('tipo') ?? 'primerContacto';
      if (!(MESSAGE_KEYS as readonly string[]).includes(tipo)) throw new HttpError(400, 'Tipo de mensaje inválido.');
      const key = tipo as MessageKey;
      const requested = Math.max(1, Math.min(10_000, Number.parseInt(query.get('variante') ?? '1', 10) || 1));
      const detail = repo.get(params.id!);
      const seller = sellerFor(user);
      const previous = buildMessages(detail, seller, requested - 1)[key];
      // Si la combinación coincide con la anterior, se prueba la siguiente (hasta 12 intentos).
      for (let v = requested; v < requested + 12; v++) {
        const text = buildMessages(detail, seller, v)[key];
        if (text !== previous) return { tipo: key, variante: v, texto: text, seleccion: buildSelection(detail, seller, v), insight: buildInsight(detail, seller, v), mensajes: buildMessages(detail, seller, v) };
      }
      return { tipo: key, variante: requested, texto: buildMessages(detail, seller, requested)[key], seleccion: buildSelection(detail, seller, requested), insight: buildInsight(detail, seller, requested), mensajes: buildMessages(detail, seller, requested) };
    })
    .on('PATCH', '/api/prospects/:id', async ({ req, params, user }) => {
      ensureAccess(user, params.id!);
      const body = await readJson<Record<string, unknown>>(req);
      if (body.status !== undefined && !isStatus(body.status)) throw new HttpError(400, 'Estado inválido.');
      if (body.assignedUserId !== undefined && !isAdmin(user)) throw new HttpError(403, 'Solo un administrador puede reasignar prospectos.');
      repo.update(
        params.id!,
        {
          status: body.status as never,
          notes: body.notes === undefined ? undefined : String(body.notes),
          closedValue: body.closedValue === undefined ? undefined : body.closedValue === null || body.closedValue === '' ? null : Number(body.closedValue),
          assignedUserId: body.assignedUserId === undefined ? undefined : body.assignedUserId ? String(body.assignedUserId) : null,
        },
        user.id,
      );
      if (body.status !== undefined) deps.generator?.syncFromCrm(params.id!, String(body.status));
      return detailFor(user, params.id!);
    })
    .on('DELETE', '/api/prospects/:id', ({ params }) => {
      repo.delete(params.id!);
      return { ok: true };
    }, { roles: ADMIN })
    .on('POST', '/api/prospects/assign', async ({ req, user }) => {
      const body = await readJson<{ ids?: unknown; userId?: unknown }>(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 1000) : [];
      if (!ids.length) throw new HttpError(400, 'Elegí al menos un prospecto.');
      const target = body.userId ? String(body.userId) : null;
      for (const id of ids) repo.update(id, { assignedUserId: target }, user.id);
      return { ok: true, count: ids.length };
    }, { roles: ADMIN })
    .on('POST', '/api/prospects/:id/activities', async ({ req, params, user }) => {
      ensureAccess(user, params.id!);
      const body = await readJson<{ type?: unknown; content?: unknown }>(req);
      return repo.addActivity(params.id!, String(body.type ?? ''), String(body.content ?? ''), user.id);
    })

    // ================================================================ seguimientos
    .on('POST', '/api/prospects/:id/followups', async ({ req, params, user }) => {
      ensureAccess(user, params.id!);
      const body = await readJson<{ dueAt?: unknown; note?: unknown }>(req);
      return repo.addFollowup(params.id!, { dueAt: String(body.dueAt ?? ''), note: String(body.note ?? '') }, user.id);
    })
    .on('PATCH', '/api/followups/:id', async ({ req, params, user }) => {
      const f = repo.followup(Number(params.id));
      if (!f) throw new NotFoundError('Seguimiento no encontrado.');
      ensureAccess(user, f.prospectId);
      const body = await readJson<{ status?: unknown }>(req);
      return repo.setFollowupStatus(f.id, String(body.status ?? '') as FollowupStatus, user.id);
    })
    .on('GET', '/api/followups', ({ query, user }) => {
      // Vendedor: los suyos. Admin: los suyos por defecto, o de todo el equipo con ?scope=equipo.
      const team = isAdmin(user) && query.get('scope') === 'equipo';
      return {
        items: repo.followups({ userId: team ? undefined : user.id, until: query.get('hasta') === 'hoy' ? endOfToday() : undefined }),
      };
    })

    // ================================================================ dashboard y métricas
    .on('GET', '/api/dashboard', ({ user }) => {
      // Los números del equipo completo son solo para administradores; un vendedor ve los suyos.
      const scope = isAdmin(user) ? undefined : user.id;
      const base = dashboard(repo.allForStats(scope), repo.statusChanges(scope));
      const today = endOfToday();
      const mineDue = repo.followups({ userId: user.id, until: today });
      const overdue = mineDue.filter((f) => f.overdue).length;
      const teamDue = isAdmin(user) ? repo.followups({ until: today }) : mineDue;
      return {
        ...base,
        personal: personalKpis(repo.allForStats(user.id), mineDue.length, overdue),
        followupsDue: teamDue.slice(0, 12),
        followupsDueCount: teamDue.length,
        scope: isAdmin(user) ? 'equipo' : 'personal',
      };
    })
    .on('GET', '/api/metrics', () => metrics(repo.allForStats()), { roles: ADMIN })
    .on('GET', '/api/audits', () => ({ items: repo.audits({ limit: 1000 }) }), { roles: ADMIN })
    .on('GET', '/api/activity', ({ query }) => ({
      items: repo.activityLog({ userId: query.get('userId') || undefined, type: query.get('type') || undefined, limit: Number(query.get('limit') ?? 300) }),
    }), { roles: ADMIN })

    // ================================================================ usuarios (solo admin)
    .on('GET', '/api/users', () => ({ items: users.list() }), { roles: ADMIN })
    .on('POST', '/api/users', async ({ req, user }) => {
      const body = await readJson<Record<string, unknown>>(req);
      const created = await users.create({
        name: body.name as string,
        email: (body.email as string) || null,
        username: body.username as string,
        password: body.password as string,
        role: body.role as Role,
      });
      repo.logSystem('usuario', user.id, `Creó el usuario ${created.username} (${created.role})`);
      return { user: created };
    }, { roles: ADMIN })
    .on('PATCH', '/api/users/:id', async ({ req, params, user }) => {
      const body = await readJson<Record<string, unknown>>(req);
      if (params.id === user.id && (body.active === false || body.role === 'vendedor')) {
        throw new HttpError(400, 'No podés desactivarte ni quitarte el rol de administrador a vos mismo.');
      }
      const updated = await users.update(params.id!, {
        name: body.name as string | undefined,
        email: body.email === undefined ? undefined : (body.email as string) || null,
        username: body.username as string | undefined,
        role: body.role as Role | undefined,
        active: body.active === undefined ? undefined : Boolean(body.active),
        password: body.password ? String(body.password) : undefined,
      });
      const what = [
        body.active === false ? 'desactivó' : body.active === true ? 'reactivó' : 'editó',
        body.password ? '(nueva contraseña)' : '',
      ].filter(Boolean).join(' ');
      repo.logSystem('usuario', user.id, `${what} al usuario ${updated.username}`);
      return { user: updated };
    }, { roles: ADMIN })

    // ================================================================ configuración (solo admin)
    .on('GET', '/api/settings', () => {
      const prices = repo.prices();
      return {
        settings: globalSettings(),
        prices: prices ?? null,
        priceError: repo.priceError ?? null,
        pricesFile: path.join(ROOT_DIR, 'precios.json'),
        databaseFile: DB_FILE,
        services: Object.values(SERVICE_CATALOG).map((s) => ({ id: s.id, name: s.name, description: s.pitch })),
        // Catálogo efectivo: servicios de la herramienta (con cambios) + servicios propios.
        catalog: catalogFrom(prices),
      };
    }, { roles: ADMIN })
    .on('PUT', '/api/settings', async ({ req, user }) => {
      const body = await readJson<Partial<Settings>>(req);
      repo.saveSettings(body);
      repo.logSystem('configuracion', user.id, 'Datos del negocio actualizados (mensajes de WhatsApp)');
      return { settings: globalSettings() };
    }, { roles: ADMIN })
    // Edición de precios desde la app: guarda precios.json y recalcula todos los prospectos.
    .on('PUT', '/api/settings/prices', async ({ req, user }) => {
      const body = await readJson<{ prices?: unknown }>(req);
      const { prices, recalculated } = repo.updatePrices(body.prices, user.id);
      return { prices, recalculated, priceError: null };
    }, { roles: ADMIN })
    .on('GET', '/api/export', ({ res }) => {
      const date = new Date().toISOString().slice(0, 10);
      sendJson(res, 200, repo.exportAll(), { 'Content-Disposition': `attachment; filename="prospectos-${date}.json"` });
      return undefined;
    }, { roles: ADMIN });

  async function serveStatic(res: http.ServerResponse, pathname: string): Promise<void> {
    // Rutas de la app (sin extensión) → index.html; archivos → web/
    const rel = path.extname(pathname) ? pathname : '/index.html';
    let file: string;
    try {
      file = path.resolve(webDir, `.${decodeURIComponent(rel)}`);
    } catch {
      return sendJson(res, 400, { error: 'Ruta inválida.' });
    }
    if (!file.startsWith(path.resolve(webDir) + path.sep)) return sendJson(res, 403, { error: 'Prohibido.' });
    try {
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(content);
    } catch {
      sendJson(res, 404, { error: 'No encontrado.' });
    }
  }

  /** Orígenes válidos: el mismo con el que se pidió la página (directo o a través del proxy) y PUBLIC_URL. */
  function originAllowed(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true; // curl, navegación directa
    if (origin === requestOrigin(req, sec.trustProxy)) return true;
    if (sec.publicUrl && origin === sec.publicUrl) return true;
    const port = req.socket.localPort ?? config.port;
    return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
  }

  return http.createServer((req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (isHttps(req, sec.trustProxy)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');

    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return sendJson(res, 400, { error: 'Ruta inválida.' });
    }
    const origin = req.headers.origin;

    // index.html abierto con doble clic (origin "null") solo puede consultar si la herramienta está iniciada.
    if (origin === 'null' && req.method === 'GET' && url.pathname === '/api/estado') {
      return sendJson(res, 200, { ok: true, ocupado: !!busy }, { 'Access-Control-Allow-Origin': 'null' });
    }
    // Protección CSRF: otras webs abiertas en el navegador no pueden usar la API.
    if (!originAllowed(req)) return sendJson(res, 403, { error: 'Origen no permitido.' });

    if (url.pathname.startsWith('/api/')) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const session = users.userForSession(token);
      if (session?.renewed && token) setSessionCookie(req, res, token);
      router
        .handle(req, res, url, session?.user)
        .then((handled) => {
          if (!handled) sendJson(res, 404, { error: 'Ruta no encontrada.' });
        })
        .catch((err) => sendJson(res, 500, { error: (err as Error).message }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Método no permitido.' });
    void serveStatic(res, url.pathname);
  });
}
