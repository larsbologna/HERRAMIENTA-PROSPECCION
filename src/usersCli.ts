/**
 * Gestión de usuarios por terminal (útil en un VPS):
 *
 *   npm run usuarios -- crear --usuario ivan --nombre "Iván" --rol admin [--email x@y.com]
 *   npm run usuarios -- listar
 *   npm run usuarios -- clave --usuario silvia          (nueva contraseña)
 *   npm run usuarios -- desactivar --usuario silvia
 *   npm run usuarios -- activar --usuario silvia
 *
 * La contraseña se pide sin mostrarla en pantalla (o con --password, por ejemplo en scripts).
 */
import { Writable } from 'node:stream';
import readline from 'node:readline';
import { openStores } from './crm/index.js';
import type { Role } from './auth/users.js';

const [command, ...rest] = process.argv.slice(2);
const arg = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

/** Pregunta una contraseña sin mostrarla. */
async function askPassword(label: string): Promise<string> {
  let muted = false;
  const output = new Writable({ write: (chunk, _enc, cb) => { if (!muted) process.stdout.write(chunk); cb(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  const ask = (q: string) => new Promise<string>((resolve) => {
    rl.question(q, (a) => resolve(a));
    muted = true;
  });
  const first = await ask(`${label}: `);
  muted = false;
  process.stdout.write('\n');
  const second = await ask('Repetila: ');
  muted = false;
  process.stdout.write('\n');
  rl.close();
  if (first !== second) throw new Error('Las contraseñas no coinciden.');
  return first;
}

async function main() {
  const { users, crm } = openStores();
  const findId = (username?: string) => {
    if (!username) throw new Error('Falta --usuario.');
    const u = users.list().find((x) => x.username === username.toLowerCase());
    if (!u) throw new Error(`No existe el usuario "${username}".`);
    return u;
  };

  switch (command) {
    case 'crear': {
      const password = arg('password') ?? (await askPassword('Contraseña (mínimo 8 caracteres)'));
      const u = await users.create({
        username: arg('usuario'),
        name: arg('nombre'),
        email: arg('email') ?? null,
        role: (arg('rol') ?? 'vendedor') as Role,
        password,
      });
      crm.logSystem('usuario', null, `Usuario ${u.username} (${u.role}) creado por terminal`);
      console.log(`✔ Usuario creado: ${u.username} · ${u.name} · ${u.role}`);
      break;
    }
    case 'listar': {
      const list = users.list();
      if (!list.length) console.log('No hay usuarios.');
      for (const u of list) {
        console.log(`${u.active ? '●' : '○'} ${u.username.padEnd(20)} ${u.name.padEnd(24)} ${u.role.padEnd(9)} ${u.lastLoginAt ? `último acceso ${u.lastLoginAt.slice(0, 16).replace('T', ' ')}` : 'nunca ingresó'}`);
      }
      break;
    }
    case 'clave': {
      const u = findId(arg('usuario'));
      const password = arg('password') ?? (await askPassword(`Nueva contraseña para ${u.username}`));
      await users.update(u.id, { password });
      crm.logSystem('usuario', null, `Contraseña de ${u.username} cambiada por terminal`);
      console.log(`✔ Contraseña actualizada. Se cerraron las sesiones abiertas de ${u.username}.`);
      break;
    }
    case 'desactivar':
    case 'activar': {
      const u = findId(arg('usuario'));
      await users.update(u.id, { active: command === 'activar' });
      crm.logSystem('usuario', null, `${u.username} ${command === 'activar' ? 'activado' : 'desactivado'} por terminal`);
      console.log(`✔ ${u.username} ${command === 'activar' ? 'activado' : 'desactivado'}.`);
      break;
    }
    default:
      console.log(`Uso:
  npm run usuarios -- crear --usuario ivan --nombre "Iván" --rol admin [--email ivan@mail.com]
  npm run usuarios -- listar
  npm run usuarios -- clave --usuario silvia
  npm run usuarios -- desactivar --usuario silvia
  npm run usuarios -- activar --usuario silvia`);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
});
