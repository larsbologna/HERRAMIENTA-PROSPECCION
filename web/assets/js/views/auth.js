import { api } from '../api.js';
import { $, icon } from '../ui.js';

const brand = `<div class="auth-brand"><span class="brand-mark">P</span><div><b>Prospección</b><small>CRM comercial</small></div></div>`;

/** Login: usuario + contraseña. La sesión queda iniciada (cookie) hasta cerrar sesión. */
export function renderLogin(box, onDone) {
  box.innerHTML = `
    <form class="auth-card" id="login" autocomplete="on">
      ${brand}
      <h1>Iniciar sesión</h1>
      <p class="muted">Ingresá con tu usuario para ver tus prospectos.</p>
      <label class="field">Usuario<input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label>
      <label class="field">Contraseña<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div class="error-text" id="err"></div>
      <button class="btn btn-primary auth-submit" type="submit">${icon('check')}Entrar</button>
      <p class="faint auth-foot">¿Olvidaste la contraseña? Pedile a un administrador que te asigne una nueva.</p>
    </form>`;
  const form = $('#login', box);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    $('#err', box).textContent = '';
    try {
      const { user } = await api.login(String(f.get('username')).trim(), String(f.get('password')));
      onDone(user);
    } catch (err) {
      $('#err', box).textContent = err.message;
      btn.disabled = false;
      $('input[name=password]', form).select();
    }
  };
  // Foco inicial solo si el usuario todavía no está escribiendo (evita robarle el foco al campo de contraseña).
  setTimeout(() => { if (!box.contains(document.activeElement)) $('input[name=username]', box)?.focus(); }, 30);
}

/** Primera vez: crear el administrador. Solo funciona desde la misma computadora o con SETUP_TOKEN. */
export function renderSetup(box, state, onDone) {
  if (!state.setupAllowed) {
    box.innerHTML = `<div class="auth-card">${brand}
      <h1>Falta crear el administrador</h1>
      <p class="muted">Por seguridad, el primer usuario se crea desde la computadora donde corre la herramienta, o por terminal:</p>
      <p><code>npm run usuarios -- crear --usuario ivan --nombre "Iván" --rol admin</code></p>
      <p class="faint">En un VPS también podés definir <code>SETUP_TOKEN</code> en el archivo .env y recargar esta página.</p></div>`;
    return;
  }
  box.innerHTML = `
    <form class="auth-card" id="setup">
      ${brand}
      <h1>Crear administrador</h1>
      <p class="muted">Es el primer usuario: va a tener acceso total y podrá crear a los vendedores.</p>
      <label class="field">Nombre (aparece en los mensajes de WhatsApp)<input class="input" name="name" required maxlength="80" placeholder="Ej.: Iván"></label>
      <label class="field">Usuario<input class="input" name="username" required pattern="[A-Za-z0-9._\\-]{3,32}" autocapitalize="none" placeholder="ivan"></label>
      <label class="field">Email (opcional)<input class="input" name="email" type="email"></label>
      <label class="field">Contraseña (mínimo 8 caracteres)<input class="input" name="password" type="password" minlength="8" autocomplete="new-password" required></label>
      ${state.setupNeedsToken ? '<label class="field">Código de instalación (SETUP_TOKEN)<input class="input" name="setupToken" required></label>' : ''}
      <div class="error-text" id="err"></div>
      <button class="btn btn-primary auth-submit" type="submit">${icon('check')}Crear y entrar</button>
    </form>`;
  const form = $('#setup', box);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      const { user } = await api.setup(body);
      onDone(user);
    } catch (err) {
      $('#err', box).textContent = err.message;
    }
  };
}
