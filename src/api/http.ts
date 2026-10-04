import type http from 'node:http';
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

type Handler = (ctx: { req: http.IncomingMessage; res: http.ServerResponse; params: Record<string, string>; query: URLSearchParams }) => unknown;

/** Router por método + patrón ("/api/prospects/:id"). */
export class Router {
  private readonly routes: Array<{ method: string; regex: RegExp; keys: string[]; handler: Handler }> = [];

  on(method: string, pattern: string, handler: Handler): this {
    const keys: string[] = [];
    const regex = new RegExp(
      `^${pattern.replace(/\/:([a-zA-Z]+)/g, (_m, k: string) => {
        keys.push(k);
        return '/([^/]+)';
      })}$`,
    );
    this.routes.push({ method, regex, keys, handler });
    return this;
  }

  /** Devuelve true si alguna ruta atendió la petición. */
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = url.pathname.match(r.regex);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
      try {
        const out = await r.handler({ req, res, params, query: url.searchParams });
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
