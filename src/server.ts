/**
 * Arranque de la plataforma de prospección.
 *
 *   npm start          → uso local: inicia y abre el navegador en http://localhost:3000
 *   npm run serve      → servidor (VPS): inicia sin abrir navegador
 *
 * Por defecto escucha solo en 127.0.0.1. En un VPS se publica a través de Nginx (ver docs/DESPLIEGUE.md).
 * Los datos se guardan en data/prospeccion.db (SQLite).
 */
import { exec } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './api/app.js';
import { config } from './config/index.js';
import { DB_FILE, openStores } from './crm/index.js';

function openBrowser(target: string): void {
  const cmd = process.platform === 'win32' ? `start "" "${target}"` : process.platform === 'darwin' ? `open "${target}"` : `xdg-open "${target}"`;
  exec(cmd, () => {});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const open = process.argv.includes('--abrir');
  const localUrl = `http://localhost:${config.port}`;
  let stores;
  try {
    stores = openStores();
  } catch (err) {
    console.error(`\n  No se pudo abrir la base de datos (${DB_FILE}).\n  ${(err as Error).message}\n`);
    process.exit(1);
  }
  const server = createApp({ repo: stores.crm, users: stores.users, generator: stores.generator, prospecting: stores.prospecting });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`La herramienta ya está abierta en ${localUrl}`);
      if (open) openBrowser(localUrl);
      process.exit(0);
    }
    throw err;
  });
  // Limpieza periódica de sesiones vencidas.
  setInterval(() => stores.users.purgeExpiredSessions(), 6 * 3_600_000).unref();

  server.listen(config.port, config.host, () => {
    console.log(`\n  Prospección lista: ${config.publicUrl || localUrl}`);
    console.log(`  Escuchando en ${config.host}:${config.port}${config.trustProxy ? ' (detrás de proxy)' : ''}`);
    console.log(`  Base de datos: ${DB_FILE}`);
    if (stores.users.count() === 0) {
      console.log('\n  Todavía no hay usuarios. Creá el administrador:');
      console.log(`   · desde esta computadora: abrí ${localUrl}`);
      console.log('   · o por terminal: npm run usuarios -- crear --usuario ivan --nombre "Iván" --rol admin');
    }
    if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.trustProxy) {
      console.log('\n  ⚠ Escuchando en una interfaz pública sin proxy. Para internet, usá Nginx con HTTPS (docs/DESPLIEGUE.md).');
    }
    console.log('  (cerrá esta ventana para detenerla)\n');
    if (open) openBrowser(localUrl);
  });
}
