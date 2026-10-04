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
const MIGRATIONS: string[] = [
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
