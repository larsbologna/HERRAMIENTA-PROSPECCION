import path from 'node:path';
import { config } from '../config/index.js';
import { openDatabase } from '../db/database.js';
import { UserRepository } from '../auth/users.js';
import { importLegacyReports } from './legacyImport.js';
import { CrmRepository } from './repository.js';

export const DB_FILE = path.join(config.dataDir, 'prospeccion.db');

/** Abre la base: CRM + usuarios, aplica migraciones e importa informes antiguos si los hay. */
export function openStores(file = DB_FILE): { crm: CrmRepository; users: UserRepository } {
  const db = openDatabase(file);
  const crm = prepareCrm(new CrmRepository(db));
  return { crm, users: new UserRepository(db, config.sessionDays) };
}

/** Abre solo el CRM (uso por terminal). */
export function openCrm(file = DB_FILE): CrmRepository {
  return openStores(file).crm;
}

function prepareCrm(repo: CrmRepository): CrmRepository {
  const imported = importLegacyReports(repo, config.dataDir);
  if (imported.imported) console.log(`  Importados ${imported.imported} informe(s) de la versión anterior.`);
  for (const e of imported.errors) console.warn(`  No se pudo importar ${e}`);
  repo.refreshValuesIfPricesChanged();
  return repo;
}
