import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { buildAnalysis, type analyze } from '../src/analyzer.js';
import { createApp, type AppDeps } from '../src/api/app.js';
import { UserRepository } from '../src/auth/users.js';
import { CrmRepository } from '../src/crm/repository.js';
import { openDatabase } from '../src/db/database.js';
import type { BusinessProfile } from '../src/domain/types.js';
import { loadPriceList } from '../src/proposal/budget.js';

export const profile = (name: string): BusinessProfile => ({
  sourceUrl: 'x', name, category: 'Peluquería', additionalCategories: [], rating: 4.2, reviewCount: 20, address: `Calle ${name}`,
  phone: '+54 341 555-0000', services: [], hasBooking: false, hasMenu: false, photoCount: 5, photoCountIsEstimate: false, photoUrls: [],
  posts: [], reviews: [], permanentlyClosed: false, socialLinks: [], scrapedAt: '', warnings: [],
});

/** Analizador falso: el nombre del negocio es la última parte de la URL. */
export const fakeAnalyze = (async (url, opts) => {
  opts?.onProgress?.({ percent: 50, message: 'mitad' });
  await new Promise((r) => setTimeout(r, 120));
  if (url.includes('falla')) throw new Error('Google Maps tardó demasiado');
  return buildAnalysis(url, profile(decodeURIComponent(url.split('/').pop()!)), undefined, { durationMs: 10 });
}) as typeof analyze;

export async function startApp(security: AppDeps['security'] = {}) {
  const webDir = mkdtempSync(path.join(os.tmpdir(), 'web-'));
  writeFileSync(path.join(webDir, 'index.html'), '<h1>App</h1>');
  mkdirSync(path.join(webDir, 'assets'));
  writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log(1)');
  const db = openDatabase(':memory:');
  // Precios en memoria: los tests nunca escriben el precios.json real.
  let prices = loadPriceList();
  const repo = new CrmRepository(db, () => prices, (p) => { prices = p; });
  const users = new UserRepository(db);
  const server = createApp({ repo, users, analyze: fakeAnalyze, webDir, log: () => {}, security }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, repo, users, webDir, close: () => server.close() };
}

/** Cliente HTTP con cookie de sesión (como un navegador). */
export class Client {
  cookie = '';
  constructor(readonly base: string, readonly headers: Record<string, string> = {}) {}

  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await fetch(this.base + p, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...this.headers, ...extra },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!.endsWith('=') ? '' : set.split(';')[0]!;
    return res;
  }
  async json(method: string, p: string, body?: unknown, extra?: Record<string, string>) {
    const res = await this.req(method, p, body, extra);
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, body: data, headers: res.headers };
  }
  get = (p: string) => this.json('GET', p);
  post = (p: string, b?: unknown) => this.json('POST', p, b ?? {});
  patch = (p: string, b: unknown) => this.json('PATCH', p, b);
  put = (p: string, b: unknown) => this.json('PUT', p, b);
  del = (p: string) => this.json('DELETE', p);

  async login(username: string, password: string) {
    return this.post('/api/auth/login', { username, password });
  }
  /** Analiza vía stream y devuelve las líneas. */
  async analyze(url: string) {
    const res = await this.req('POST', '/api/analizar', { url });
    return (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  }
}

export async function loggedClient(base: string, users: UserRepository, username: string, role: 'admin' | 'vendedor', name = username) {
  if (!users.list().some((u) => u.username === username)) await users.create({ username, name, role, password: 'secreta123' });
  const c = new Client(base);
  const r = await c.login(username, 'secreta123');
  if (r.status !== 200) throw new Error(`login ${username}: ${JSON.stringify(r.body)}`);
  return c;
}
