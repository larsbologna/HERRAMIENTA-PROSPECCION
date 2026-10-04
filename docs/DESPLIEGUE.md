# Despliegue en un VPS (acceso remoto para el equipo)

Guía para publicar la herramienta en un servidor propio (Hostinger VPS, Contabo u otro con **Ubuntu 22.04/24.04**) y que los vendedores entren desde cualquier lugar con usuario y contraseña.

```
Navegador ──HTTPS──▶ (Cloudflare, opcional) ──▶ Nginx :443 ──▶ Node 127.0.0.1:3000 ──▶ data/prospeccion.db
```

- La app **solo escucha en 127.0.0.1**: nadie llega a Node directamente, todo pasa por Nginx con HTTPS.
- Un solo proceso y un solo archivo SQLite: no hace falta base de datos externa.
- Requisitos mínimos: **2 GB de RAM** (Chromium usa ~300–500 MB por análisis), 1–2 vCPU, 10 GB de disco.

---

## 1. Preparar el servidor

Conectate por SSH como root (o con un usuario con sudo):

```bash
apt update && apt upgrade -y
apt install -y git nginx ufw curl

# Node.js 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v      # tiene que ser 22.13 o superior

# Firewall: solo SSH y web
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

Usuario sin privilegios para la app:

```bash
useradd --system --create-home --home-dir /opt/prospeccion --shell /usr/sbin/nologin prospeccion
```

## 2. Instalar la herramienta

```bash
# Copiá el proyecto a /opt/prospeccion (git clone, scp o rsync), por ejemplo:
git clone <URL-del-repositorio> /tmp/prospeccion && cp -a /tmp/prospeccion/. /opt/prospeccion/
cd /opt/prospeccion
chown -R prospeccion:prospeccion /opt/prospeccion

# Dependencias del sistema para Chromium (como root)
npx playwright install-deps chromium

# Dependencias del proyecto y el navegador (como el usuario de la app)
sudo -u prospeccion npm ci
sudo -u prospeccion npx playwright install chromium
```

Si tenés datos de tu computadora, copiá `data/prospeccion.db` a `/opt/prospeccion/data/` **con la herramienta cerrada en ambos lados**. La base se actualiza sola al nuevo formato al iniciar (los prospectos existentes quedan "sin asignar").

## 3. Configuración (`.env`)

```bash
sudo -u prospeccion cp .env.example .env
sudo -u prospeccion nano .env
```

```ini
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=true
PUBLIC_URL=https://crm.tudominio.com
COOKIE_SECURE=auto
SESSION_DAYS=30
```

`TRUST_PROXY=true` es **obligatorio** detrás de Nginx: así la app conoce la IP real (para bloquear intentos de login) y sabe que la conexión es HTTPS (cookie `Secure`).

## 4. Servicio (arranque automático)

```bash
cp deploy/prospeccion.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now prospeccion
systemctl status prospeccion          # debe decir "active (running)"
journalctl -u prospeccion -f          # registros en vivo
```

## 5. Nginx + HTTPS

1. En tu proveedor de dominio (o en Cloudflare) creá un registro **A** `crm` → IP del VPS.
2. Configurá Nginx:

```bash
cp deploy/nginx.conf.example /etc/nginx/sites-available/prospeccion
nano /etc/nginx/sites-available/prospeccion        # reemplazá crm.tudominio.com
ln -s /etc/nginx/sites-available/prospeccion /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

3. Certificado gratuito (Let's Encrypt):

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d crm.tudominio.com --redirect
```

Puntos importantes de la configuración (ya incluidos en el ejemplo):

| Qué | Por qué |
|---|---|
| `proxy_buffering off` en `/api/analizar` | El progreso del análisis llega en streaming; con buffer la barra queda congelada. |
| `proxy_read_timeout 300s` en `/api/analizar` | Un análisis puede tardar hasta 3 minutos. |
| `X-Forwarded-For / Proto / Host` | IP real, HTTPS y validación de origen (protección CSRF). |
| `limit_req` en `/api/auth/login` | Segunda barrera contra fuerza bruta (la app ya bloquea 15 min tras 5 fallos). |

## 6. Crear el primer administrador

Opción A — por terminal (recomendada):

```bash
cd /opt/prospeccion
sudo -u prospeccion npm run usuarios -- crear --usuario ivan --nombre "Iván" --rol admin
# te pide la contraseña sin mostrarla
```

Opción B — desde el navegador: poné `SETUP_TOKEN=<código>` en `.env` (generalo con `openssl rand -hex 16`), reiniciá (`systemctl restart prospeccion`), entrá a `https://crm.tudominio.com` y completá el formulario con ese código. **Después borrá `SETUP_TOKEN`** del `.env` y reiniciá. Mientras haya al menos un usuario, el alta inicial queda deshabilitada de todas formas.

Después, desde **Configuración → Usuarios** creás a los vendedores.

Otros comandos útiles:

```bash
sudo -u prospeccion npm run usuarios -- listar
sudo -u prospeccion npm run usuarios -- clave --usuario silvia          # nueva contraseña
sudo -u prospeccion npm run usuarios -- desactivar --usuario silvia
sudo -u prospeccion npm run usuarios -- activar --usuario silvia
```

## 7. Cloudflare (opcional)

Si el dominio está en Cloudflare con el proxy activado (nube naranja):

- **SSL/TLS → modo "Full (strict)"** (el VPS ya tiene certificado de Let's Encrypt). Nunca "Flexible": rompe la cookie segura y genera redirecciones infinitas.
- Cloudflare corta las respuestas que tardan más de **100 s sin datos**; la app manda un latido cada 15 s durante el análisis, así que no se corta.
- La app toma la IP real de `CF-Connecting-IP` (con `TRUST_PROXY=true`).
- Para que nadie pueda saltear Cloudflare, podés permitir el puerto 443 solo a [sus rangos de IP](https://www.cloudflare.com/ips/) en `ufw`.
- No hace falta ninguna regla de caché: la API responde con `Cache-Control: no-store`.

## 8. Copias de seguridad

Toda la información está en **`/opt/prospeccion/data/prospeccion.db`**. Copia diaria consistente (se puede hacer con la app funcionando):

```bash
apt install -y sqlite3
mkdir -p /var/backups/prospeccion
cat > /etc/cron.daily/prospeccion-backup <<'EOS'
#!/bin/sh
sqlite3 /opt/prospeccion/data/prospeccion.db ".backup '/var/backups/prospeccion/prospeccion-$(date +%F).db'"
find /var/backups/prospeccion -name '*.db' -mtime +30 -delete
EOS
chmod +x /etc/cron.daily/prospeccion-backup
```

Bajá las copias a otra máquina de vez en cuando (`scp root@IP:/var/backups/prospeccion/*.db .`). También está **Configuración → Descargar copia (JSON)** desde la app.

## 9. Actualizar a una versión nueva

```bash
cd /opt/prospeccion
sqlite3 data/prospeccion.db ".backup 'data/antes-de-actualizar.db'"
sudo -u prospeccion git pull         # o copiá los archivos nuevos
sudo -u prospeccion npm ci
systemctl restart prospeccion
```

Las migraciones de la base se aplican solas al iniciar.

## Seguridad: qué ya hace la app

- Contraseñas guardadas con **scrypt** y sal aleatoria; nunca en texto plano.
- Sesión en cookie `HttpOnly` + `SameSite=Lax` + `Secure` (con HTTPS). En la base solo se guarda el hash del token. Cerrar sesión, desactivar un usuario o cambiar su contraseña invalida sus sesiones.
- Bloqueo tras 5 intentos fallidos de login (15 minutos) por usuario e IP.
- Permisos verificados en el servidor en cada petición: un vendedor no puede ver ni modificar prospectos de otro, ni la configuración, precios, usuarios o métricas globales.
- Protección CSRF por origen, cabeceras `Content-Security-Policy`, `X-Frame-Options`, `nosniff` y HSTS bajo HTTPS.
- El primer administrador solo se crea desde la misma máquina, por terminal o con `SETUP_TOKEN`.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| 502 Bad Gateway | La app no está corriendo: `systemctl status prospeccion` y `journalctl -u prospeccion -n 50`. |
| El login vuelve a pedir usuario | Falta `TRUST_PROXY=true`, o Cloudflare está en modo "Flexible". |
| "Origen no permitido" al guardar | Revisá `PUBLIC_URL` (con `https://` y sin barra final) y que Nginx envíe `X-Forwarded-Host`. |
| La barra del análisis no avanza | Falta `proxy_buffering off` en `/api/analizar`. |
| El análisis falla al abrir el navegador | Falta `npx playwright install-deps chromium` (como root) o la memoria es insuficiente. |
| Google pide verificación | Muchos análisis seguidos desde la IP del VPS: espaciá los análisis. |
