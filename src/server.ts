/**
 * Arranque de la plataforma de prospección.
 *
 *   npm start            → inicia y abre el navegador en http://localhost:3000
 *
 * Solo escucha en 127.0.0.1: no es accesible desde otros equipos de la red.
 * Los datos se guardan en data/prospeccion.db (SQLite).
 */
import { exec } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './api/app.js';
import { config } from './config/index.js';
import { DB_FILE, openCrm } from './crm/index.js';

const HOST = '127.0.0.1';
const url = `http://localhost:${config.port}`;

function openBrowser(target: string): void {
  const cmd = process.platform === 'win32' ? `start "" "${target}"` : process.platform === 'darwin' ? `open "${target}"` : `xdg-open "${target}"`;
  exec(cmd, () => {});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const open = process.argv.includes('--abrir');
  let repo;
  try {
    repo = openCrm();
  } catch (err) {
    console.error(`\n  No se pudo abrir la base de datos (${DB_FILE}).\n  ${(err as Error).message}\n`);
    process.exit(1);
  }
  const server = createApp({ repo });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`La herramienta ya está abierta en ${url}`);
      if (open) openBrowser(url);
      process.exit(0);
    }
    throw err;
  });
  server.listen(config.port, HOST, () => {
    console.log(`\n  Prospección lista: ${url}`);
    console.log(`  Base de datos: ${DB_FILE}`);
    console.log('  (cerrá esta ventana para detenerla)\n');
    if (open) openBrowser(url);
  });
}
