import path from 'node:path';

// Carga .env si existe (Node 20.12+). Las variables ya definidas en el entorno tienen prioridad.
try {
  process.loadEnvFile?.('.env');
} catch {
  /* sin .env: se usan valores por defecto */
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function list(name: string): string[] {
  return env(name, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const port = Number(env('PORT', '3000'));

export const config = {
  port,
  dataDir: path.resolve(env('DATA_DIR', './data')),
  publicBaseUrl: env('PUBLIC_BASE_URL', `http://localhost:${port}`).replace(/\/$/, ''),
  seller: {
    name: env('SELLER_NAME', 'Tu Nombre'),
    business: env('SELLER_BUSINESS', 'Gestor de Presencia Online'),
  },
  browser: {
    headless: env('HEADLESS', 'true') !== 'false',
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    mapsLanguage: env('MAPS_LANGUAGE', 'es'),
    navigationTimeoutMs: Number(env('NAVIGATION_TIMEOUT_MS', '45000')),
  },
  agentFactory: {
    webhookUrl: process.env.AGENT_FACTORY_WEBHOOK_URL || undefined,
    token: process.env.AGENT_FACTORY_TOKEN || undefined,
    agentEndpoints: list('AGENT_ENDPOINTS'),
  },
} as const;

export type AppConfig = typeof config;
