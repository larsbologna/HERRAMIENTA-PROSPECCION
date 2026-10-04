# Prospección · CRM comercial para Gestores de Presencia Online

Plataforma local para construir y trabajar una base de prospectos a partir de Google Maps.
Pegás el enlace de un negocio y la herramienta lo audita, detecta problemas con argumentos de venta concretos, recomienda servicios, arma el presupuesto en pesos y escribe el mensaje de WhatsApp. Todo queda **guardado** para seguirlo en el pipeline comercial.

Servicios que ayuda a vender: **Optimización de Google Maps · Sitios web · Bot IA para WhatsApp · Automatización de atención · Sistema de reservas · Dashboard administrativo · Gestión de reputación**.

Funciona en tu computadora o en un VPS para todo el equipo (**multiusuario** con roles), sin Google Cloud ni APIs pagas (lee la ficha pública con Playwright).

---

## Cómo se usa

**Requisito:** [Node.js](https://nodejs.org) **22.13 o superior** (versión LTS).

| Sistema | Iniciar |
|---|---|
| Windows | Doble clic en **`iniciar.bat`** |
| Mac | Doble clic en **`iniciar.command`** (la primera vez: clic derecho → Abrir) |
| Terminal | `npm install && npm run setup` (solo la primera vez) y luego `npm start` |

La primera vez instala lo necesario. Después se abre sola en `http://localhost:3000`.
Para cerrarla, cerrá la ventana negra. Tus datos quedan guardados.

**Primer ingreso:** la herramienta pide crear el **administrador** (nombre, usuario y contraseña). Desde ahí se entra siempre con usuario y contraseña; la sesión se mantiene 30 días hasta que cierres sesión.

### Usuarios y roles

| | Administrador | Vendedor |
|---|---|---|
| Dashboard | Global + su actividad | Solo sus prospectos + su actividad |
| Prospectos / Pipeline / Perfil | Todos, con filtro por vendedor y asignación | **Mis prospectos**: los que analizó o le asignaron |
| Notas, historial, mensajes, seguimientos | ✔ | ✔ (en sus prospectos) |
| Asignar / eliminar prospectos | ✔ | — |
| Auditorías, Métricas globales | ✔ | — |
| Configuración, precios, usuarios, registro de actividad | ✔ | — |

- **Configuración → Usuarios:** crear, editar, cambiar contraseña, desactivar o reactivar vendedores y administradores.
- **Configuración → Actividad:** quién hizo qué y cuándo (login, logout, cambios de estado, WhatsApp, notas, análisis, asignaciones, seguimientos).
- Cada negocio que analiza un vendedor queda asignado a él. Los mensajes de WhatsApp se firman con el nombre del usuario.
- **Seguimientos:** en el perfil del prospecto agendás el próximo contacto (fecha, hora y recordatorio) y lo marcás *Hecho* o *Cancelado*. El Dashboard avisa "N seguimientos pendientes" y muestra los de hoy y los vencidos.
- Al reasignar un prospecto, sus seguimientos pendientes pasan al nuevo responsable.
- Para usar la herramienta desde internet con todo el equipo: **[docs/DESPLIEGUE.md](docs/DESPLIEGUE.md)** (VPS Hostinger/Contabo, Nginx, HTTPS, Cloudflare).

### Secciones

| Sección | Para qué |
|---|---|
| **Dashboard** | Alerta de seguimientos pendientes y tu actividad (asignados, seguimientos, reuniones, conversión personal). Prospectos analizados, sin contactar, contactados, respondieron, reuniones, clientes, valor potencial y cerrado. Gráficos de prospectos por mes, valor acumulado, conversiones y estado comercial. Lista de "para contactar primero". |
| **Prospectos** | Tabla con búsqueda, filtros por estado, rubro, score y vendedor, próximo contacto, asignación masiva (admin) y orden por cualquier columna. |
| **Pipeline** | Kanban: Sin contactar → Contactado → Respondió → Reunión agendada → Propuesta enviada → Cliente / Perdido. Arrastrá las tarjetas; se guarda solo. |
| **Auditorías** | Nuevo análisis y registro de todos los análisis (incluidos los reanálisis). |
| **Perfil del prospecto** | Responsable, próximo contacto, score por área, datos del negocio, problemas (impacto, motivo, servicio, beneficio), servicios recomendados, presupuesto, potencial económico, mensajes de WhatsApp, notas internas e historial. |
| **Métricas** | Conversión, ticket promedio, servicios más recomendados, rubros más analizados, scores promedio y distribución. |
| **Configuración** | Datos del negocio, tabla de precios, copia de seguridad, usuarios y registro de actividad (solo administrador). |

### Flujo diario sugerido

1. **Nuevo análisis** → pegá el enlace de Maps (botón *Compartir* de la ficha).
2. En el perfil, revisá los problemas y elegí el mensaje: **1er contacto**, **Corto** o **Seguimiento**. Editalo si querés, **Copiar** o **Abrir WhatsApp**, y después **Registrar envío** (pasa a *Contactado* y queda en el historial).
3. A medida que avanza, mové el prospecto en el **Pipeline** y anotá llamadas o reuniones en el **Historial**.
4. Al cerrar, pasalo a **Cliente** y ajustá el **valor cerrado** si acordaste otro precio.

Si analizás de nuevo un negocio (mismo nombre y dirección), se **actualiza** el prospecto: conserva estado, notas e historial, y suma una auditoría nueva.

---

## Precios y presupuestos (pesos argentinos)

Se configuran en **`precios.json`** (editalo con cualquier editor de texto):

```json
{
  "moneda": "ARS",
  "mesesContrato": 12,
  "servicios": {
    "maps-optimization": { "pagoInicial": 250000, "mensual": 80000 },
    "website":           { "pagoInicial": 650000, "mensual": 35000 }
  },
  "descuentoPaquete": { "minimoServicios": 3, "porcentaje": 10 }
}
```

- **Valor potencial** de un prospecto = plan recomendado (pago inicial con descuento + abono × meses de contrato).
- **Total del proyecto** = lo mismo con el plan completo.
- **Ticket promedio** = promedio del valor potencial.
- Al guardar `precios.json`, **todos** los prospectos se recalculan solos. Si el archivo tiene un error, se siguen usando los últimos precios válidos y Configuración lo avisa.
- Los precios incluidos son **de ejemplo**: reemplazalos por los tuyos.

---

## Datos y copia de seguridad

- Base de datos: **`data/prospeccion.db`** (SQLite). Copiar ese archivo es una copia de seguridad completa.
- Configuración → **Descargar copia (JSON)** exporta prospectos, auditorías, historial y configuración.
- Si existen informes de la primera versión (`data/reports/*/report.json`), se importan solos al iniciar (una sola vez).
- Por defecto la herramienta solo es accesible desde tu computadora (127.0.0.1). Para acceso remoto, ver [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).
- Las contraseñas se guardan con hash scrypt; nunca en texto plano.

---

## Por terminal

```bash
npm run analizar -- "https://maps.app.goo.gl/XXXX"     # analiza, guarda y muestra el resultado
npm run analizar -- "<url>" --confiabilidad            # + valor, estado, confianza, fuente y método de cada dato
npm run diagnose -- "https://maps.app.goo.gl/XXXX"     # modo diagnóstico del scraper
npm run diagnose -- "<url>" --visible                  # viendo el navegador

npm run usuarios -- crear --usuario ivan --nombre "Iván" --rol admin   # crear usuario (pide la contraseña)
npm run usuarios -- listar
npm run usuarios -- clave --usuario silvia                             # nueva contraseña
npm run usuarios -- desactivar --usuario silvia                        # o: activar
```

El **modo diagnóstico** muestra, para cada dato leído de Google Maps, el valor, el selector, el nivel de confianza y la fuente exacta, y genera `data/diagnostics/<fecha>/diagnostico.json` con el HTML de cada pestaña. Es la herramienta para ajustar selectores si Google cambia su página.

---

## Confiabilidad del dato

Cada dato leído de Google Maps guarda **valor obtenido, estado, confianza, fuente y método**. Se ve en el perfil del prospecto (sección **Confiabilidad**) y por terminal con `npm run analizar -- "<url>" --confiabilidad`.

| Estado | Significa | ¿Se usa para argumentar? |
|---|---|---|
| **Encontrado** | El dato se leyó de la ficha | Sí, con confianza alta o media |
| **Valor real 0** | Se comprobó que no tiene (p. ej. "Sin reseñas", o la ficha cargó completa y no hay teléfono) | Sí, con confianza alta o media |
| **No encontrado** | No se pudo leer y no hay prueba de que falte | **No**: no se afirma nada |
| **Error de extracción** | La ficha o una pestaña no cargó, o Google bloqueó la lectura | **No** |

**Regla central:** un problema solo se afirma (y genera argumento comercial) si los datos en los que se apoya están verificados. Si no, queda en la lista *"No se afirman (dato sin verificar)"* y no resta puntos al score. Cada argumento muestra el dato que lo respalda.

Falsos positivos que se corrigieron:

- **Reseñas:** si no se lee el contador, ya no se dice "Solo 0 reseñas". "Sin reseñas" comprobado sí cuenta como 0. El contador se valida contra el histograma de estrellas y contra la muestra leída.
- **Frecuencia y última reseña:** solo se evalúan si se pudieron ordenar las reseñas por "Más recientes". Antes, con el orden "Más relevantes", podía decir "no recibe reseñas hace meses" sin ser cierto.
- **Fotos:** se ignoran las estadísticas de autores de reseñas ("Local Guide · 12 reseñas · 340 fotos"). Sin un total visible, no se afirma que tenga pocas fotos.
- **Publicaciones:** una "Respuesta del propietario" ya no se toma como publicación. "Sin publicaciones" solo se afirma si se recorrió la ficha completa.
- **Descripción:** se prioriza la del propietario (pestaña Información). El resumen de la ficha puede escribirlo Google, así que no se usa para decir que es "muy breve".
- **Cerrado permanentemente:** solo cuenta si figura en el encabezado, no en el texto de una reseña.
- **Ficha reclamada:** se considera reclamada si el propietario responde reseñas o publica novedades. Si las señales se contradicen, queda "sin determinar".
- **Place ID:** se toma de la URL. Si la página tiene varios (negocios cercanos), se descarta.
- **Bloqueo de Google:** el análisis se detiene con un aviso y no guarda un prospecto con datos vacíos.
- **WhatsApp sin respuesta automática:** solo se afirma si se revisó una web propia.

### Validar con negocios reales

Google cambia su página seguido. Antes de usar la herramienta con clientes, y cada tanto, conviene comparar con la ficha real:

1. Elegí 10 negocios variados: con y sin web, con muchas y con pocas reseñas, reclamados y sin reclamar, uno sin reseñas.
2. Corré `npm run diagnose -- "<url>"` con cada uno. El final muestra la tabla de confiabilidad.
3. Abrí la ficha en el navegador y compará reseñas, calificación, fotos, descripción, publicaciones y "Reclamar este negocio".
4. Si un dato sale **No encontrado** y existe en la ficha, el selector cambió: el diagnóstico (`data/diagnostics/…/diagnostico.json` y el HTML guardado) indica cuál ajustar en `src/scraper/scripts/mapsScripts.ts`.

---

## Arquitectura

```
index.html                 Página de acceso (redirige a la app si está iniciada)
iniciar.bat / .command     Iniciadores con doble clic (verifican Node ≥ 22.13)
precios.json               Precios en ARS (editables)
web/                       Interfaz (SPA sin build)
├── index.html
└── assets/
    ├── styles.css         Sistema de diseño
    └── js/
        ├── app.js         Layout, rutas y modal de análisis
        ├── api.js         Cliente de la API
        ├── charts.js      Gráficos SVG
        ├── ui.js          Formato, íconos, modales, avisos
        └── views/         auth, dashboard, prospects, pipeline, audits, prospect, metrics, settings
src/
├── server.ts              Arranque (127.0.0.1 por defecto; HOST/TRUST_PROXY para VPS)
├── usersCli.ts            Gestión de usuarios por terminal
├── api/                   Rutas HTTP (node:http, sin frameworks) con sesión y permisos por rol
├── auth/                  Contraseñas (scrypt), usuarios, sesiones, límite de intentos
├── crm/                   Repositorio SQLite, estados, estadísticas, importación de la V1
├── db/                    Conexión node:sqlite y migraciones versionadas
├── messages/              Mensajes de WhatsApp (primer contacto, corto, seguimiento)
├── analyzer.ts            Análisis completo (Maps → web → auditoría → propuesta → presupuesto)
├── scraper/               Playwright: Google Maps y sitio web          ┐
├── auditor/               Reglas de auditoría por área y rubro          │ lógica validada
├── proposal/              Argumentos, servicios, presupuesto            │ (sin cambios de comportamiento)
├── diagnostics/           Modo diagnóstico del scraper                  ┘
├── domain/                Tipos y perfiles por rubro
├── cli.ts / diagnose.ts   Uso por terminal
deploy/                    Ejemplos de Nginx y systemd para VPS
docs/DESPLIEGUE.md         Guía de despliegue
test/                      Tests: unitarios, CRM, API, mensajes, diagnóstico y e2e con Chromium
```

### API

Todas las rutas requieren sesión salvo las de `/api/auth` (login, estado, alta inicial). Las marcadas *admin* responden 403 a un vendedor; un prospecto ajeno responde 404.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` · `/api/auth/logout` | Iniciar / cerrar sesión (cookie `HttpOnly`) |
| GET / PUT | `/api/auth/me` · `/api/auth/password` | Usuario actual · cambiar la propia contraseña |
| POST | `/api/analizar` | Analiza y guarda (progreso en streaming NDJSON) |
| GET | `/api/prospects` | Listado (`q`, `status`, `vertical`, `minScore`, `maxScore`, `sort`, `dir`; admin: `assigned=me\|none\|<id>`) |
| GET / PATCH / DELETE | `/api/prospects/:id` | Detalle con mensajes · estado, notas, valor cerrado, responsable (admin) · borrar (admin) |
| POST | `/api/prospects/assign` | Asignación masiva (admin) |
| GET / POST / PATCH | `/api/followups`, `/api/prospects/:id/followups`, `/api/followups/:id` | Seguimientos: listar, agendar, marcar hecho o cancelado |
| POST | `/api/prospects/:id/activities` | Registrar actividad (nota, llamada, WhatsApp, email, reunión, otra) |
| GET | `/api/dashboard` | Datos agregados (del vendedor o globales) y KPIs personales |
| GET | `/api/metrics`, `/api/audits`, `/api/activity` | Métricas, auditorías y registro de actividad (admin) |
| GET / POST / PATCH | `/api/users`, `/api/users/:id` | Gestión de usuarios (admin) |
| GET / PUT | `/api/settings` | Configuración y precios (admin) |
| GET | `/api/export` | Copia de seguridad JSON (admin) |

```bash
npm test           # 59 tests: unitarios, presupuesto, CRM, migraciones, autenticación y roles, API, mensajes, diagnóstico, confiabilidad (fichas trampa) y e2e con Chromium
npm run typecheck
```

## Limitaciones

- Google cambia a menudo su página de Maps. Si un dato deja de leerse, el modo diagnóstico indica qué selector ajustar en `src/scraper/scripts/mapsScripts.ts`.
- Leer Google Maps de forma automatizada va contra sus términos de uso; con muchas consultas seguidas Google puede pedir verificación o bloquear temporalmente.
- La frecuencia de reseñas y la tasa de respuesta se calculan sobre las reseñas más recientes (hasta 40): son orientativas.
- Dos negocios con el mismo nombre y dirección se consideran el mismo prospecto.
