import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Hash de contraseñas con scrypt (incluido en Node): sal aleatoria por usuario y
 * comparación en tiempo constante. Formato guardado: scrypt$N$r$p$sal$hash (base64).
 * Nunca se guarda la contraseña en texto plano.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password: unknown): string | undefined {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password.length > 200) return 'La contraseña es demasiado larga.';
  return undefined;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64!, 'base64');
  const key = await scrypt(String(password), Buffer.from(saltB64!, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash ficticio para comparar cuando el usuario no existe (evita revelar usuarios por tiempo de respuesta). */
let dummy: string | undefined;
export async function dummyHash(): Promise<string> {
  dummy ??= await hashPassword(randomBytes(12).toString('hex'));
  return dummy;
}
