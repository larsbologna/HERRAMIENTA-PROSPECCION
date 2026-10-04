import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Carpeta raíz del proyecto (donde están index.html y precios.json). */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Carga .env si existe (Node 20.12+). Las variables ya definidas en el entorno tienen prioridad.
try {
  process.loadEnvFile?.(path.join(ROOT_DIR, '.env'));
} catch {
  /* sin .env: se usan valores por defecto */
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export const config = {
  port: Number(env('PORT', '3000')),
  /**
   * Interfaz donde escucha. 127.0.0.1 (por defecto) = solo esta máquina; detrás de Nginx en un VPS
   * también conviene 127.0.0.1 (Nginx publica el sitio). 0.0.0.0 solo si sabés lo que hacés.
   */
  host: env('HOST', '127.0.0.1'),
  /** "true" detrás de Nginx/Cloudflare: usa X-Forwarded-* y CF-Connecting-IP para IP y HTTPS. */
  trustProxy: env('TRUST_PROXY', 'false') === 'true',
  /** URL pública (p. ej. https://crm.tudominio.com). Se acepta como origen válido de las peticiones. */
  publicUrl: env('PUBLIC_URL', '').replace(/\/$/, ''),
  /** Cookie de sesión con Secure: "auto" (si la petición llegó por HTTPS), "true" o "false". */
  cookieSecure: env('COOKIE_SECURE', 'auto'),
  sessionDays: Number(env('SESSION_DAYS', '30')),
  /** Token para crear el primer administrador desde fuera de la máquina (VPS). */
  setupToken: process.env.SETUP_TOKEN || undefined,
  /** Solo se usa para guardar los resultados del modo diagnóstico. */
  dataDir: path.resolve(ROOT_DIR, env('DATA_DIR', './data')),
  seller: {
    name: env('SELLER_NAME', '[tu nombre]'),
    business: env('SELLER_BUSINESS', 'Gestor de Presencia Online'),
  },
  browser: {
    headless: env('HEADLESS', 'true') !== 'false',
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    mapsLanguage: env('MAPS_LANGUAGE', 'es'),
    navigationTimeoutMs: Number(env('NAVIGATION_TIMEOUT_MS', '45000')),
  },
  /** Tiempo máximo de un análisis completo: pasado este tiempo se cancela. */
  analysisTimeoutMs: Number(env('ANALYSIS_TIMEOUT_MS', '180000')),
} as const;
