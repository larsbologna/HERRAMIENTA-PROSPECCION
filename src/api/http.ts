import type http from 'node:http';
import type { Role, User } from '../auth/users.js';
import { NotFoundError, ValidationError } from '../crm/repository.js';

/** Utilidades HTTP mínimas (sin frameworks). */

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export async function readJson<T = Record<string, unknown>>(req: http.IncomingMessage, limit = 200_000): Promise<T> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new HttpError(413, 'Petición demasiado grande.');
  }
  if (!body.trim()) return {} as T;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as T;
  } catch {
    throw new HttpError(400, 'El cuerpo de la petición no es JSON válido.');
  }
}

/** Traduce errores de dominio a respuestas HTTP con mensajes legibles. */
export function sendError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
  if (err instanceof NotFoundError) return sendJson(res, 404, { error: err.message });
  if (err instanceof ValidationError) return sendJson(res, 400, { error: err.message });
  console.error(err);
  sendJson(res, 500, { error: 'Error interno. Revisá la ventana de la herramienta para más detalle.' });
}


export interface RouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Usuario autenticado (siempre presente salvo en rutas públicas). */
  user: User;
}
type Handler = (ctx: RouteContext) => unknown;

export interface RouteOptions {
  /** Ruta accesible sin sesión. */
  public?: boolean;
  /** Roles permitidos (por defecto: cualquier usuario con sesión). */
  roles?: Role[];
}

// ---------------------------------------------------------------- cookies y proxy

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* cookie malformada: se ignora */
    }
  }
  return out;
}

export function serializeCookie(name: string, value: string, opts: { maxAge?: number; secure?: boolean }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    opts.maxAge !== undefined ? `Max-Age=${Math.max(0, Math.floor(opts.maxAge))}` : '',
    opts.secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

const first = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h)?.split(',')[0]?.trim() || undefined;

/** IP real del cliente (detrás de proxy, solo si se confía en él). */
export function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const ip = first(req.headers['cf-connecting-ip']) ?? first(req.headers['x-real-ip']) ?? first(req.headers['x-forwarded-for']);
    if (ip) return ip;
  }
  return req.socket.remoteAddress ?? 'desconocida';
}

export function isHttps(req: http.IncomingMessage, trustProxy: boolean): boolean {
  if ((req.socket as { encrypted?: boolean }).encrypted) return true;
  return trustProxy && first(req.headers['x-forwarded-proto']) === 'https';
}

/** Origen con el que el navegador ve la app (para validar el header Origin). */
export function requestOrigin(req: http.IncomingMessage, trustProxy: boolean): string {
  const host = (trustProxy ? first(req.headers['x-forwarded-host']) : undefined) ?? req.headers.host ?? '';
  return `${isHttps(req, trustProxy) ? 'https' : 'http'}://${host}`;
}

/** Conexión directa desde esta misma máquina, sin pasar por un proxy. */
export function isDirectLocal(req: http.IncomingMessage): boolean {
  const viaProxy = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'forwarded'].some((h) => req.headers[h] !== undefined);
  const addr = req.socket.remoteAddress ?? '';
  return !viaProxy && (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1');
}

/** Router por método + patrón ("/api/prospects/:id") con control de sesión y rol por ruta. */
export class Router {
  private readonly routes: Array<{ method: string; regex: RegExp; keys: string[]; handler: Handler; opts: RouteOptions }> = [];

  on(method: string, pattern: string, handler: Handler, opts: RouteOptions = {}): this {
    const keys: string[] = [];
    const regex = new RegExp(
      `^${pattern.replace(/\/:([a-zA-Z]+)/g, (_m, k: string) => {
        keys.push(k);
        return '/([^/]+)';
      })}$`,
    );
    this.routes.push({ method, regex, keys, handler, opts });
    return this;
  }

  /** Devuelve true si alguna ruta atendió la petición. */
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, user: User | undefined): Promise<boolean> {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = url.pathname.match(r.regex);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      // Middleware de autorización: sesión obligatoria salvo rutas públicas, y rol permitido.
      if (!r.opts.public && !user) {
        sendJson(res, 401, { error: 'Tu sesión expiró. Volvé a iniciar sesión.' });
        return true;
      }
      if (r.opts.roles && (!user || !r.opts.roles.includes(user.role))) {
        sendJson(res, 403, { error: 'No tenés permiso para esta acción.' });
        return true;
      }
      let params: Record<string, string>;
      try {
        params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
      } catch {
        sendJson(res, 400, { error: 'Ruta inválida.' });
        return true;
      }
      try {
        const out = await r.handler({ req, res, params, query: url.searchParams, user: user as User });
        if (out !== undefined && !res.writableEnded) sendJson(res, 200, out);
      } catch (err) {
        sendError(res, err);
      }
      return true;
    }
    if (pathMatched) {
      sendJson(res, 405, { error: 'Método no permitido.' });
      return true;
    }
    return false;
  }
}
