import path from 'node:path';
import { config } from '../config/index.js';
import { openDatabase } from '../db/database.js';
import { importLegacyReports } from './legacyImport.js';
import { CrmRepository } from './repository.js';

export const DB_FILE = path.join(config.dataDir, 'prospeccion.db');

/** Abre la base del CRM, aplica migraciones e importa informes antiguos si los hay. */
export function openCrm(file = DB_FILE): CrmRepository {
  const repo = new CrmRepository(openDatabase(file));
  const imported = importLegacyReports(repo, config.dataDir);
  if (imported.imported) console.log(`  Importados ${imported.imported} informe(s) de la versión anterior.`);
  for (const e of imported.errors) console.warn(`  No se pudo importar ${e}`);
  repo.refreshValuesIfPricesChanged();
  return repo;
}
