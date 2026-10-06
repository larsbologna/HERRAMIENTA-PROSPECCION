import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

/**
 * Base de datos SQLite con el módulo incluido en Node (node:sqlite, Node ≥ 22.13):
 * sin dependencias nativas que compilar, así funciona igual en Windows, Mac y Linux.
 */
export type Db = DatabaseSyncType;

/**
 * Migraciones en orden. NUNCA modificar una ya publicada: agregar una nueva al final.
 * PRAGMA user_version guarda cuántas se aplicaron.
 */
export const MIGRATIONS: string[] = [
  // 1 · Esquema inicial del CRM
  `
  CREATE TABLE prospects (
    id               TEXT PRIMARY KEY,
    dedupe_key       TEXT NOT NULL UNIQUE,
    name             TEXT NOT NULL,
    category         TEXT,
    vertical_id      TEXT,
    vertical_label   TEXT,
    maps_url         TEXT NOT NULL,
    address          TEXT,
    phone            TEXT,
    website          TEXT,
    rating           REAL,
    review_count     INTEGER,
    score            INTEGER NOT NULL,
    area_scores_json TEXT NOT NULL DEFAULT '[]',
    status           TEXT NOT NULL DEFAULT 'sin_contactar',
    max_stage        INTEGER NOT NULL DEFAULT 0,
    notes            TEXT NOT NULL DEFAULT '',
    closed_value     INTEGER,
    potential_value  INTEGER NOT NULL DEFAULT 0,
    project_total    INTEGER NOT NULL DEFAULT 0,
    problems_count   INTEGER NOT NULL DEFAULT 0,
    high_impact_count INTEGER NOT NULL DEFAULT 0,
    problems_json    TEXT NOT NULL DEFAULT '[]',
    services_json    TEXT NOT NULL DEFAULT '[]',
    budget_json      TEXT NOT NULL DEFAULT '{}',
    analyzed_at      TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    last_activity_at TEXT NOT NULL
  );
  CREATE INDEX idx_prospects_status ON prospects(status);
  CREATE INDEX idx_prospects_created ON prospects(created_at);

  CREATE TABLE audits (
    id             TEXT PRIMARY KEY,
    prospect_id    TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    created_at     TEXT NOT NULL,
    score          INTEGER NOT NULL,
    problems_count INTEGER NOT NULL,
    duration_ms    INTEGER NOT NULL DEFAULT 0,
    source         TEXT NOT NULL DEFAULT 'analisis',
    result_json    TEXT NOT NULL
  );
  CREATE INDEX idx_audits_prospect ON audits(prospect_id, created_at);

  CREATE TABLE activities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    from_status TEXT,
    to_status   TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_activities_prospect ON activities(prospect_id, created_at);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // 2 · Multiusuario: usuarios, sesiones, seguimientos, asignación y actividad por usuario.
  //     Conserva todos los datos existentes (los prospectos quedan sin asignar).
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'vendedor')),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    ip           TEXT,
    user_agent   TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE followups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id  TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
    due_at       TEXT NOT NULL,
    note         TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'hecho', 'cancelado')),
    created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX idx_followups_pending ON followups(status, due_at);
  CREATE INDEX idx_followups_prospect ON followups(prospect_id);

  ALTER TABLE prospects ADD COLUMN assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
  CREATE INDEX idx_prospects_assigned ON prospects(assigned_user_id);
  ALTER TABLE audits ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

  -- activities: se agrega user_id y el prospecto pasa a ser opcional (login/logout no tienen prospecto).
  CREATE TABLE activities_v2 (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id TEXT REFERENCES prospects(id) ON DELETE CASCADE,
    user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
    type        TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    from_status TEXT,
    to_status   TEXT,
    created_at  TEXT NOT NULL
  );
  INSERT INTO activities_v2 (id, prospect_id, type, content, from_status, to_status, created_at)
    SELECT id, prospect_id, type, content, from_status, to_status, created_at FROM activities;
  DROP TABLE activities;
  ALTER TABLE activities_v2 RENAME TO activities;
  CREATE INDEX idx_activities_prospect ON activities(prospect_id, created_at);
  CREATE INDEX idx_activities_user ON activities(user_id, created_at);
  `,
  // 3 · Generador de Prospectos: búsquedas y negocios entregados (historial que evita repetir)
  `
  CREATE TABLE generator_runs (
    id           TEXT PRIMARY KEY,
    user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
    rubro        TEXT NOT NULL,
    zona         TEXT NOT NULL,
    requested    INTEGER NOT NULL,
    found        INTEGER NOT NULL DEFAULT 0,
    exhausted    INTEGER NOT NULL DEFAULT 0,
    stats_json   TEXT NOT NULL DEFAULT '{}',
    message      TEXT,
    created_at   TEXT NOT NULL,
    finished_at  TEXT
  );
  CREATE TABLE generated_prospects (
    id                TEXT PRIMARY KEY,
    run_id            TEXT REFERENCES generator_runs(id) ON DELETE SET NULL,
    user_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
    name              TEXT NOT NULL,
    address           TEXT,
    phone             TEXT,
    website           TEXT,
    category          TEXT,
    rating            REAL,
    review_count      INTEGER,
    maps_url          TEXT NOT NULL,
    place_id          TEXT,
    feature_id        TEXT,
    url_key           TEXT,
    name_key          TEXT,
    address_key       TEXT,
    street_key        TEXT,
    phone_key         TEXT,
    website_key       TEXT,
    rubro             TEXT NOT NULL,
    zona              TEXT NOT NULL,
    score             INTEGER NOT NULL,
    score_points      INTEGER NOT NULL DEFAULT 0,
    reasons_json      TEXT NOT NULL DEFAULT '[]',
    unverified_json   TEXT NOT NULL DEFAULT '[]',
    facts_json        TEXT NOT NULL DEFAULT '{}',
    status            TEXT NOT NULL DEFAULT 'nuevo'
                      CHECK (status IN ('nuevo','contactado','interesado','llamada','propuesta','ganado','perdido')),
    max_stage         INTEGER NOT NULL DEFAULT 0,
    prospect_id       TEXT REFERENCES prospects(id) ON DELETE SET NULL,
    discovered_at     TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    status_changed_at TEXT
  );
  CREATE UNIQUE INDEX ux_generated_place ON generated_prospects(place_id) WHERE place_id IS NOT NULL;
  CREATE UNIQUE INDEX ux_generated_feature ON generated_prospects(feature_id) WHERE feature_id IS NOT NULL;
  CREATE INDEX idx_generated_user ON generated_prospects(user_id, score DESC);
  CREATE INDEX idx_generated_status ON generated_prospects(status);
  CREATE INDEX idx_generated_run ON generated_prospects(run_id);
  `,
  // 4 · Presupuesto personalizado por prospecto (servicios y precios elegidos a mano)
  `
  ALTER TABLE prospects ADD COLUMN budget_override_json TEXT;
  `,
  // 5 · Prospección automática: campañas (rubro + zona + mes), potencial comercial y claves extra
  //     anti-duplicados (Instagram y WhatsApp). Solo agrega: no cambia ni borra datos existentes.
  `
  CREATE TABLE campaigns (
    id          TEXT PRIMARY KEY,
    rubro       TEXT NOT NULL,
    rubro_key   TEXT NOT NULL,
    zona        TEXT NOT NULL,
    zona_key    TEXT NOT NULL,
    month       TEXT NOT NULL,
    label       TEXT NOT NULL,
    user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE UNIQUE INDEX ux_campaign ON campaigns(rubro_key, zona_key, month);
  ALTER TABLE prospects ADD COLUMN campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL;
  ALTER TABLE prospects ADD COLUMN potential_level TEXT;
  ALTER TABLE prospects ADD COLUMN potential_reason TEXT;
  ALTER TABLE prospects ADD COLUMN instagram_key TEXT;
  ALTER TABLE prospects ADD COLUMN whatsapp_key TEXT;
  CREATE INDEX idx_prospects_campaign ON prospects(campaign_id, status);
  CREATE INDEX idx_prospects_instagram ON prospects(instagram_key);
  CREATE INDEX idx_prospects_whatsapp ON prospects(whatsapp_key);
  ALTER TABLE generator_runs ADD COLUMN campaign_id TEXT;
  ALTER TABLE generated_prospects ADD COLUMN campaign_id TEXT;
  ALTER TABLE generated_prospects ADD COLUMN discard_reason TEXT;
  ALTER TABLE generated_prospects ADD COLUMN analysis_error TEXT;
  `,
  // 6 · Rubros: rubro detectado o asignado a cada prospecto (con fuente y confianza), rubros
  //     personalizados, oportunidades y contactos resumidos para listar rápido. Solo agrega.
  `
  CREATE TABLE rubros (
    key           TEXT PRIMARY KEY,
    label         TEXT NOT NULL,
    model         TEXT NOT NULL CHECK (model IN ('turnos', 'reservas', 'productos', 'consultas')),
    keywords_json TEXT NOT NULL DEFAULT '[]',
    user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL
  );
  ALTER TABLE prospects ADD COLUMN rubro_key TEXT;
  ALTER TABLE prospects ADD COLUMN rubro_source TEXT;
  ALTER TABLE prospects ADD COLUMN rubro_confidence TEXT;
  ALTER TABLE prospects ADD COLUMN opps_json TEXT;
  ALTER TABLE prospects ADD COLUMN contact_json TEXT;
  CREATE INDEX idx_prospects_rubro ON prospects(rubro_key, status);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Carga node:sqlite silenciando solo su aviso de "experimental" (el resto de avisos sigue igual). */
function loadSqlite(): typeof import('node:sqlite') {
  const original = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning?.message;
    if (/SQLite is an experimental feature/i.test(text ?? '')) return;
    return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  } catch (err) {
    throw new Error(
      `Esta herramienta necesita Node.js 22.13 o superior (tenés ${process.version}). Descargá la versión LTS desde https://nodejs.org. Detalle: ${(err as Error).message}`,
    );
  } finally {
    process.emitWarning = original;
  }
}

/** Abre (o crea) la base y aplica las migraciones pendientes. ":memory:" para tests. */
export function openDatabase(file: string): Db {
  const { DatabaseSync } = loadSqlite();
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (current > MIGRATIONS.length) {
    throw new Error('La base de datos fue creada con una versión más nueva de la herramienta. Actualizá la herramienta.');
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Ejecuta fn en una transacción: si falla, no queda nada a medias. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
