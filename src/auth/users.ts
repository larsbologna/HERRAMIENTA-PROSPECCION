import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db/database.js';
import { transaction } from '../db/database.js';
import { NotFoundError, ValidationError } from '../crm/repository.js';
import { dummyHash, hashPassword, validatePassword, verifyPassword } from './password.js';

export type Role = 'admin' | 'vendedor';
export const ROLES: Array<{ id: Role; label: string }> = [
  { id: 'admin', label: 'Administrador' },
  { id: 'vendedor', label: 'Vendedor' },
];

export interface User {
  id: string;
  name: string;
  email: string | null;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

type Row = Record<string, unknown>;

function toUser(r: Row): User {
  return {
    id: String(r.id),
    name: String(r.name),
    email: (r.email as string) ?? null,
    username: String(r.username),
    role: r.role as Role,
    active: Boolean(Number(r.active)),
    createdAt: String(r.created_at),
    lastLoginAt: (r.last_login_at as string) ?? null,
  };
}

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

export interface UserInput {
  name?: string;
  email?: string | null;
  username?: string;
  role?: Role;
  active?: boolean;
  password?: string;
}

/**
 * Usuarios y sesiones.
 * Las sesiones guardan solo el SHA-256 del token: si alguien copia la base, no puede usar las sesiones.
 */
export class UserRepository {
  constructor(
    private readonly db: Db,
    readonly sessionDays = 30,
  ) {}

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as Row).n);
  }

  list(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY active DESC, role ASC, name COLLATE NOCASE').all() as Row[]).map(toUser);
  }

  get(id: string): User {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new NotFoundError('Usuario no encontrado.');
    return toUser(r);
  }

  private validate(input: UserInput, creating: boolean): void {
    if (creating || input.name !== undefined) {
      const name = String(input.name ?? '').trim();
      if (name.length < 2 || name.length > 80) throw new ValidationError('El nombre debe tener entre 2 y 80 caracteres.');
    }
    if (creating || input.username !== undefined) {
      if (!USERNAME_RE.test(String(input.username ?? ''))) {
        throw new ValidationError('El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.');
      }
    }
    if (input.email !== undefined && input.email !== null && input.email !== '' && !EMAIL_RE.test(String(input.email))) {
      throw new ValidationError('El email no es válido.');
    }
    if ((creating || input.role !== undefined) && input.role !== 'admin' && input.role !== 'vendedor') {
      throw new ValidationError('Rol inválido.');
    }
    if (creating || input.password !== undefined) {
      const err = validatePassword(input.password);
      if (err) throw new ValidationError(err);
    }
  }

  private assertUsernameFree(username: string, exceptId?: string): void {
    const r = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as Row | undefined;
    if (r && r.id !== exceptId) throw new ValidationError('Ese nombre de usuario ya existe.');
  }

  async create(input: UserInput): Promise<User> {
    this.validate(input, true);
    this.assertUsernameFree(String(input.username));
    const hash = await hashPassword(String(input.password));
    const id = randomUUID();
    const ts = now();
    this.db
      .prepare('INSERT INTO users (id, name, email, username, password_hash, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(id, String(input.name).trim(), input.email ? String(input.email).trim() : null, String(input.username).trim().toLowerCase(), hash, input.role!, ts, ts);
    return this.get(id);
  }

  /** Edita un usuario. Impide dejar el sistema sin administradores activos. */
  async update(id: string, input: UserInput): Promise<User> {
    const current = this.get(id);
    this.validate(input, false);
    if (input.username !== undefined) this.assertUsernameFree(String(input.username), id);
    const losesAdmin = current.role === 'admin' && current.active && (input.role === 'vendedor' || input.active === false);
    if (losesAdmin && this.activeAdmins() <= 1) throw new ValidationError('Tiene que quedar al menos un administrador activo.');
    const hash = input.password !== undefined ? await hashPassword(String(input.password)) : undefined;
    transaction(this.db, () => {
      const sets: string[] = [];
      const vals: (string | number | null)[] = [];
      const set = (col: string, v: string | number | null) => {
        sets.push(`${col} = ?`);
        vals.push(v);
      };
      if (input.name !== undefined) set('name', String(input.name).trim());
      if (input.email !== undefined) set('email', input.email ? String(input.email).trim() : null);
      if (input.username !== undefined) set('username', String(input.username).trim().toLowerCase());
      if (input.role !== undefined) set('role', input.role);
      if (input.active !== undefined) set('active', input.active ? 1 : 0);
      if (hash) set('password_hash', hash);
      if (sets.length) {
        set('updated_at', now());
        this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
      }
      // Desactivar o cambiar la contraseña cierra todas sus sesiones.
      if (input.active === false || hash) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    });
    return this.get(id);
  }

  activeAdmins(): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`).get() as Row).n);
  }

  /** Devuelve el usuario si usuario + contraseña son correctos y está activo. */
  async verifyCredentials(username: string, password: string): Promise<User | undefined> {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? '').trim()) as Row | undefined;
    if (!r) {
      await verifyPassword(String(password ?? ''), await dummyHash());
      return undefined;
    }
    const ok = await verifyPassword(String(password ?? ''), String(r.password_hash));
    if (!ok || !Number(r.active)) return undefined;
    return toUser(r);
  }

  async changeOwnPassword(id: string, current: string, next: string): Promise<void> {
    const r = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new NotFoundError('Usuario no encontrado.');
    if (!(await verifyPassword(String(current ?? ''), String(r.password_hash)))) throw new ValidationError('La contraseña actual no es correcta.');
    const err = validatePassword(next);
    if (err) throw new ValidationError(err);
    this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(await hashPassword(next), now(), id);
  }

  // ---------------------------------------------------------------- sesiones

  createSession(userId: string, meta: { ip?: string; userAgent?: string } = {}): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString('base64url');
    const ts = now();
    const expiresAt = new Date(Date.now() + this.sessionDays * 86_400_000).toISOString();
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sha256(token), userId, ts, ts, expiresAt, meta.ip ?? null, (meta.userAgent ?? '').slice(0, 300) || null);
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(ts, userId);
    return { token, expiresAt };
  }

  /**
   * Usuario de una sesión válida. La sesión se renueva sola con el uso
   * (como máximo una escritura por hora para no cargar la base).
   */
  userForSession(token: string | undefined): { user: User; renewed?: string } | undefined {
    if (!token || token.length > 200) return undefined;
    const r = this.db
      .prepare(`SELECT s.token_hash, s.expires_at, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
      .get(sha256(token)) as Row | undefined;
    if (!r) return undefined;
    if (Date.parse(String(r.expires_at)) < Date.now() || !Number(r.active)) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(String(r.token_hash));
      return undefined;
    }
    let renewed: string | undefined;
    if (Date.now() - Date.parse(String(r.last_seen_at)) > 3_600_000) {
      renewed = new Date(Date.now() + this.sessionDays * 86_400_000).toISOString();
      this.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(now(), renewed, String(r.token_hash));
    }
    return { user: toUser(r), renewed };
  }

  deleteSession(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  purgeExpiredSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  }
}
