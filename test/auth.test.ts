import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { Client, loggedClient, startApp } from './helpers.js';

test('contraseñas: hash con sal, nunca en texto plano', async () => {
  const a = await hashPassword('secreta123');
  const b = await hashPassword('secreta123');
  assert.match(a, /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/);
  assert.notEqual(a, b, 'cada hash usa una sal distinta');
  assert.doesNotMatch(a, /secreta123/);
  assert.ok(await verifyPassword('secreta123', a));
  assert.ok(!(await verifyPassword('otra', a)));
  assert.ok(!(await verifyPassword('secreta123', 'basura')));
});

test('primer administrador: solo desde la misma máquina o con SETUP_TOKEN, y una sola vez', async () => {
  const app = await startApp({ setupToken: 'tok-123' });
  try {
    const c = new Client(app.base);
    assert.equal((await c.get('/api/auth/estado')).body.setupRequired, true);
    assert.equal((await c.get('/api/prospects')).status, 401, 'sin sesión no hay datos');
    // A través de un proxy (internet) sin token: rechazado
    const viaProxy = new Client(app.base, { 'X-Forwarded-For': '203.0.113.9' });
    const denied = await viaProxy.post('/api/auth/setup', { name: 'Iván', username: 'ivan', password: 'secreta123' });
    assert.equal(denied.status, 403);
    assert.equal((await viaProxy.get('/api/auth/estado')).body.setupNeedsToken, true);
    // Con el token correcto: permitido
    const ok = await viaProxy.post('/api/auth/setup', { name: 'Iván', username: 'ivan', password: 'secreta123', setupToken: 'tok-123' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.role, 'admin');
    assert.equal((await viaProxy.get('/api/auth/me')).body.user.username, 'ivan', 'queda con la sesión iniciada');
    // Una sola vez
    assert.equal((await c.post('/api/auth/setup', { name: 'X', username: 'otro', password: 'secreta123' })).status, 409);
    // Contraseña corta rechazada en la creación de usuarios
    assert.equal((await viaProxy.post('/api/users', { name: 'S', username: 'silvia', password: 'corta', role: 'vendedor' })).status, 400);
  } finally {
    app.close();
    rmSync(app.webDir, { recursive: true, force: true });
  }
});

test('login, cookie segura, bloqueo por intentos y logout', async () => {
  const app = await startApp({ trustProxy: true });
  try {
    await app.users.create({ username: 'ivan', name: 'Iván', role: 'admin', password: 'secreta123' });
    const c = new Client(app.base, { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.7' });
    const bad = await c.login('ivan', 'incorrecta');
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, 'Usuario o contraseña incorrectos.');
    assert.equal((await c.login('nadie', 'x')).body.error, 'Usuario o contraseña incorrectos.', 'mismo mensaje: no revela usuarios');
    const res = await c.req('POST', '/api/auth/login', { username: 'IVAN', password: 'secreta123' });
    assert.equal(res.status, 200, 'el usuario no distingue mayúsculas');
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Secure/, 'detrás de HTTPS la cookie es Secure');
    assert.ok(res.headers.get('strict-transport-security'));
    assert.equal((await c.get('/api/auth/me')).status, 200);
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    assert.equal((await c.get('/api/auth/me')).status, 401, 'logout cierra la sesión');

    const attacker = new Client(app.base, { 'X-Forwarded-For': '192.0.2.50' });
    for (let i = 0; i < 5; i++) await attacker.login('ivan', 'mala' + i);
    const locked = await attacker.login('ivan', 'secreta123');
    assert.equal(locked.status, 429, 'tras 5 fallos, bloquea aunque la contraseña sea correcta');
    assert.equal((await new Client(app.base, { 'X-Forwarded-For': '198.51.100.8' }).login('ivan', 'secreta123')).status, 200, 'otra IP no queda bloqueada');
  } finally {
    app.close();
    rmSync(app.webDir, { recursive: true, force: true });
  }
});

test('roles, asignación y aislamiento entre vendedores', async () => {
  const app = await startApp();
  try {
    const ivan = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván');
    const silvia = await loggedClient(app.base, app.users, 'silvia', 'vendedor', 'Silvia');
    const marcos = await loggedClient(app.base, app.users, 'marcos', 'vendedor', 'Marcos');

    // El admin analiza: queda asignado al admin y los vendedores no lo ven
    const pid = (await ivan.analyze('https://maps.app.goo.gl/Parrilla Tito')).at(-1).prospectId;
    assert.equal((await silvia.get('/api/prospects')).body.items.length, 0);
    assert.equal((await silvia.get(`/api/prospects/${pid}`)).status, 404, 'un prospecto ajeno no existe para el vendedor');
    assert.equal((await silvia.patch(`/api/prospects/${pid}`, { status: 'contactado' })).status, 404);

    // El admin lo asigna a Silvia
    const silviaId = app.users.list().find((u) => u.username === 'silvia')!.id;
    const assigned = await ivan.patch(`/api/prospects/${pid}`, { assignedUserId: silviaId });
    assert.equal(assigned.body.assignedUserName, 'Silvia');
    assert.ok(assigned.body.activities.some((a: any) => a.type === 'asignacion' && a.content === 'Asignado a Silvia'));
    assert.equal((await silvia.get('/api/prospects')).body.items.length, 1);
    assert.equal((await marcos.get('/api/prospects')).body.items.length, 0, 'Marcos no ve lo de Silvia');
    const detail = (await silvia.get(`/api/prospects/${pid}`)).body;
    assert.match(detail.messages.primerContacto, /Soy Silvia/, 'el mensaje firma con el vendedor conectado');

    // El vendedor trabaja su prospecto pero no puede reasignar ni borrar
    assert.equal((await silvia.patch(`/api/prospects/${pid}`, { status: 'contactado', notes: 'Atiende a la tarde' })).body.status, 'contactado');
    assert.equal((await silvia.patch(`/api/prospects/${pid}`, { assignedUserId: null })).status, 403);
    assert.equal((await silvia.del(`/api/prospects/${pid}`)).status, 403);

    // Lo que analiza un vendedor queda asignado a él
    const own = (await marcos.analyze('https://maps.app.goo.gl/Gimnasio Norte')).at(-1);
    assert.equal(own.accesible, true);
    assert.equal((await marcos.get('/api/prospects')).body.items[0].assignedUserName, 'Marcos');
    // Si reanaliza un negocio que es de otra persona, no obtiene acceso
    const foreign = (await marcos.analyze('https://maps.app.goo.gl/Parrilla Tito')).at(-1);
    assert.equal(foreign.accesible, false);
    assert.equal(foreign.prospectId, null);

    // El admin ve todo y filtra
    assert.equal((await ivan.get('/api/prospects')).body.items.length, 2);
    assert.equal((await ivan.get(`/api/prospects?assigned=${silviaId}`)).body.items.length, 1);
    assert.equal((await ivan.get('/api/prospects?assigned=me')).body.items.length, 0);
    const bulk = await ivan.post('/api/prospects/assign', { ids: [own.prospectId], userId: null });
    assert.equal(bulk.body.count, 1);
    assert.equal((await ivan.get('/api/prospects?assigned=none')).body.items.length, 1);

    // Rutas solo para administradores
    for (const p of ['/api/settings', '/api/users', '/api/metrics', '/api/audits', '/api/activity', '/api/export']) {
      assert.equal((await silvia.get(p)).status, 403, p);
    }
    assert.equal((await silvia.put('/api/settings', { sellerCity: 'X' })).status, 403);
    assert.equal((await silvia.post('/api/users', { name: 'X', username: 'xx', password: 'secreta123', role: 'admin' })).status, 403);
    assert.deepEqual((await silvia.get('/api/meta')).body.users, [], 'el vendedor no recibe la lista de usuarios');
  } finally {
    app.close();
    rmSync(app.webDir, { recursive: true, force: true });
  }
});

test('seguimientos, KPIs personales y alertas del dashboard', async () => {
  const app = await startApp();
  try {
    const ivan = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván');
    const silvia = await loggedClient(app.base, app.users, 'silvia', 'vendedor', 'Silvia');
    const a = (await silvia.analyze('https://maps.app.goo.gl/Peluquería A')).at(-1).prospectId;
    const b = (await silvia.analyze('https://maps.app.goo.gl/Peluquería B')).at(-1).prospectId;
    await silvia.patch(`/api/prospects/${a}`, { status: 'reunion' });
    await silvia.patch(`/api/prospects/${b}`, { status: 'contactado' });
    await silvia.patch(`/api/prospects/${b}`, { status: 'cliente' });

    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const f1 = await silvia.post(`/api/prospects/${a}/followups`, { dueAt: yesterday, note: 'Mandar presupuesto' });
    assert.equal(f1.status, 200);
    assert.equal(f1.body.overdue, true);
    await silvia.post(`/api/prospects/${a}/followups`, { dueAt: nextWeek, note: 'Llamar' });
    assert.equal((await silvia.post(`/api/prospects/${a}/followups`, { dueAt: 'mañana' })).status, 400);

    const d = (await silvia.get('/api/dashboard')).body;
    assert.equal(d.scope, 'personal');
    assert.equal(d.personal.assigned, 2);
    assert.equal(d.personal.followupsPending, 1, 'pendientes hasta hoy (incluye vencidos)');
    assert.equal(d.personal.followupsOverdue, 1);
    assert.equal(d.personal.meetings, 2, 'llegaron a reunión o más (el cliente también pasó por esa etapa)');
    assert.equal(d.personal.meetingsNow, 1);
    assert.equal(d.personal.clients, 1);
    assert.equal(d.personal.conversionRate, 50);
    assert.equal(d.followupsDue[0].note, 'Mandar presupuesto');
    assert.equal(d.kpis.analyzed, 2, 'el vendedor ve sus números, no los del equipo');

    const list = (await silvia.get(`/api/prospects?sort=nextFollowup&dir=asc`)).body.items;
    assert.equal(list[0].nextFollowupAt, new Date(yesterday).toISOString());

    // El admin ve las alertas del equipo
    assert.equal((await ivan.get('/api/dashboard')).body.followupsDueCount, 1);
    assert.equal((await ivan.get('/api/followups?scope=equipo&hasta=hoy')).body.items.length, 1);

    // Completar
    const done = await silvia.patch(`/api/followups/${f1.body.id}`, { status: 'hecho' });
    assert.equal(done.body.status, 'hecho');
    assert.equal((await silvia.get('/api/dashboard')).body.personal.followupsPending, 0);
    const marcos = await loggedClient(app.base, app.users, 'marcos', 'vendedor');
    assert.equal((await marcos.patch(`/api/followups/${f1.body.id}`, { status: 'cancelado' })).status, 404, 'no puede tocar seguimientos ajenos');
  } finally {
    app.close();
    rmSync(app.webDir, { recursive: true, force: true });
  }
});

test('registro de actividad por usuario: login, logout, estado, WhatsApp, nota, análisis', async () => {
  const app = await startApp();
  try {
    const ivan = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván');
    const silvia = await loggedClient(app.base, app.users, 'silvia', 'vendedor', 'Silvia');
    const id = (await silvia.analyze('https://maps.app.goo.gl/Bar Uno')).at(-1).prospectId;
    await silvia.patch(`/api/prospects/${id}`, { status: 'contactado' });
    await silvia.post(`/api/prospects/${id}/activities`, { type: 'whatsapp', content: 'Mensaje enviado' });
    await silvia.post(`/api/prospects/${id}/activities`, { type: 'nota', content: 'Prefiere audios' });
    await silvia.post('/api/auth/logout');

    const log = (await ivan.get('/api/activity')).body.items;
    const bySilvia = log.filter((a: any) => a.userName === 'Silvia').map((a: any) => a.type);
    for (const t of ['login', 'logout', 'creado', 'estado', 'whatsapp', 'nota']) assert.ok(bySilvia.includes(t), `falta ${t}`);
    const est = log.find((a: any) => a.type === 'estado');
    assert.equal(est.prospectName, 'Bar Uno');
    assert.ok(est.createdAt);
    assert.equal((await ivan.get('/api/activity?type=login')).body.items.every((a: any) => a.type === 'login'), true);
  } finally {
    app.close();
    rmSync(app.webDir, { recursive: true, force: true });
  }
});

test('gestión de usuarios: crear, editar, desactivar, contraseña y protecciones', async () => {
  const app = await startApp();
  try {
    const ivan = await loggedClient(app.base, app.users, 'ivan', 'admin', 'Iván');
    const created = await ivan.post('/api/users', { name: 'Silvia Gómez', username: 'silvia', email: 'silvia@mail.com', password: 'secreta123', role: 'vendedor' });
    assert.equal(created.status, 200);
    assert.equal(created.body.user.password_hash, undefined, 'nunca se devuelve el hash');
    assert.equal((await ivan.post('/api/users', { name: 'Otra', username: 'SILVIA', password: 'secreta123', role: 'vendedor' })).status, 400, 'usuario duplicado');
    assert.equal((await ivan.post('/api/users', { name: 'Otra', username: 'otra', email: 'no-es-mail', password: 'secreta123', role: 'vendedor' })).status, 400);

    const silvia = new Client(app.base);
    assert.equal((await silvia.login('silvia', 'secreta123')).status, 200);
    const sid = created.body.user.id;
    assert.equal((await ivan.patch(`/api/users/${sid}`, { name: 'Silvia G.' })).body.user.name, 'Silvia G.');

    // Desactivar: cierra sus sesiones y no puede volver a entrar
    await ivan.patch(`/api/users/${sid}`, { active: false });
    assert.equal((await silvia.get('/api/auth/me')).status, 401);
    assert.equal((await silvia.login('silvia', 'secreta123')).status, 401);
    await ivan.patch(`/api/users/${sid}`, { active: true, password: 'nueva-clave-1' });
    assert.equal((await silvia.login('silvia', 'nueva-clave-1')).status, 200);

    // Cambio de la propia contraseña
    assert.equal((await silvia.put('/api/auth/password', { current: 'mal', next: 'otra-clave-2' })).status, 400);
    assert.equal((await silvia.put('/api/auth/password', { current: 'nueva-clave-1', next: 'otra-clave-2' })).status, 200);
    assert.equal((await silvia.get('/api/auth/me')).status, 200, 'sigue conectada tras cambiar la contraseña');

    // Protecciones: no desactivarse a sí mismo ni quedar sin administradores
    const me = app.users.list().find((u) => u.username === 'ivan')!.id;
    assert.equal((await ivan.patch(`/api/users/${me}`, { active: false })).status, 400);
    assert.equal((await ivan.patch(`/api/users/${me}`, { role: 'vendedor' })).status, 400);
    const promoted = await ivan.patch(`/api/users/${sid}`, { role: 'admin' });
    assert.equal(promoted.body.user.role, 'admin');
  } finally {
    app.close();
    rmSync(app.webDir, { recursive: true, force: true });
  }
});

test('detrás de Nginx/Cloudflare: origen del dominio público aceptado, otros rechazados', async () => {
  const app = await startApp({ trustProxy: true, publicUrl: 'https://crm.ejemplo.com' });
  try {
    const ivan = await loggedClient(app.base, app.users, 'ivan', 'admin');
    const proxied = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'crm.ejemplo.com' };
    assert.equal((await ivan.json('GET', '/api/prospects', undefined, { ...proxied, Origin: 'https://crm.ejemplo.com' })).status, 200);
    assert.equal((await ivan.json('GET', '/api/prospects', undefined, { Origin: 'https://crm.ejemplo.com' })).status, 200, 'PUBLIC_URL');
    assert.equal((await ivan.json('POST', '/api/prospects/assign', { ids: ['x'] }, { ...proxied, Origin: 'https://evil.com' })).status, 403);
  } finally {
    app.close();
    rmSync(app.webDir, { recursive: true, force: true });
  }
});
