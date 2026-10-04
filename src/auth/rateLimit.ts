/**
 * Límite de intentos de login en memoria: tras `max` fallos en `windowMs` para la misma
 * clave (IP + usuario), se bloquea durante `lockMs`. Frena ataques de fuerza bruta.
 */
export class LoginRateLimiter {
  private readonly attempts = new Map<string, { fails: number; first: number; lockedUntil: number }>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 15 * 60_000,
  ) {}

  /** Segundos de bloqueo restantes (0 = puede intentar). */
  blockedFor(key: string): number {
    const e = this.attempts.get(key);
    if (!e) return 0;
    const left = e.lockedUntil - Date.now();
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  fail(key: string): void {
    const t = Date.now();
    const e = this.attempts.get(key);
    if (!e || t - e.first > this.windowMs) {
      this.attempts.set(key, { fails: 1, first: t, lockedUntil: 0 });
      return;
    }
    e.fails++;
    if (e.fails >= this.max) e.lockedUntil = t + this.lockMs;
    if (this.attempts.size > 10_000) this.prune();
  }

  success(key: string): void {
    this.attempts.delete(key);
  }

  private prune(): void {
    const t = Date.now();
    for (const [k, e] of this.attempts) if (t - e.first > this.windowMs && e.lockedUntil < t) this.attempts.delete(k);
  }
}
