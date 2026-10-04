# Prospección · CRM comercial para Gestores de Presencia Online

Plataforma local para construir y trabajar una base de prospectos a partir de Google Maps.
Pegás el enlace de un negocio y la herramienta lo audita, detecta problemas con argumentos de venta concretos, recomienda servicios, arma el presupuesto en pesos y escribe el mensaje de WhatsApp. Todo queda **guardado** para seguirlo en el pipeline comercial.

Servicios que ayuda a vender: **Optimización de Google Maps · Sitios web · Bot IA para WhatsApp · Automatización de atención · Sistema de reservas · Dashboard administrativo · Gestión de reputación**.

Funciona en tu computadora, sin Google Cloud ni APIs pagas (lee la ficha pública con Playwright).

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

### Secciones

| Sección | Para qué |
|---|---|
| **Dashboard** | Prospectos analizados, sin contactar, contactados, respondieron, reuniones, clientes, valor potencial y cerrado. Gráficos de prospectos por mes, valor acumulado, conversiones y estado comercial. Lista de "para contactar primero". |
| **Prospectos** | Tabla con búsqueda, filtros por estado, rubro y score, y orden por cualquier columna. |
| **Pipeline** | Kanban: Sin contactar → Contactado → Respondió → Reunión agendada → Propuesta enviada → Cliente / Perdido. Arrastrá las tarjetas; se guarda solo. |
| **Auditorías** | Nuevo análisis y registro de todos los análisis (incluidos los reanálisis). |
| **Perfil del prospecto** | Score por área, datos del negocio, problemas (impacto, motivo, servicio, beneficio), servicios recomendados, presupuesto, potencial económico, mensajes de WhatsApp, notas internas e historial. |
| **Métricas** | Conversión, ticket promedio, servicios más recomendados, rubros más analizados, scores promedio y distribución. |
| **Configuración** | Tus datos para los mensajes, tabla de precios y copia de seguridad. |

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
- La herramienta solo es accesible desde tu computadora (127.0.0.1).

---

## Por terminal

```bash
npm run analizar -- "https://maps.app.goo.gl/XXXX"     # analiza, guarda y muestra el resultado
npm run diagnose -- "https://maps.app.goo.gl/XXXX"     # modo diagnóstico del scraper
npm run diagnose -- "<url>" --visible                  # viendo el navegador
```

El **modo diagnóstico** muestra, para cada dato leído de Google Maps, el valor, el selector, el nivel de confianza y la fuente exacta, y genera `data/diagnostics/<fecha>/diagnostico.json` con el HTML de cada pestaña. Es la herramienta para ajustar selectores si Google cambia su página.

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
        └── views/         dashboard, prospects, pipeline, audits, prospect, metrics, settings
src/
├── server.ts              Arranque (127.0.0.1)
├── api/                   Rutas HTTP (node:http, sin frameworks)
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
test/                      Tests: unitarios, CRM, API, mensajes, diagnóstico y e2e con Chromium
```

### API local

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/analizar` | Analiza y guarda (progreso en streaming NDJSON) |
| GET | `/api/prospects` | Listado (`q`, `status`, `vertical`, `minScore`, `maxScore`, `sort`, `dir`) |
| GET / PATCH / DELETE | `/api/prospects/:id` | Detalle con mensajes · estado, notas, valor cerrado · borrar |
| POST | `/api/prospects/:id/activities` | Registrar actividad (nota, llamada, WhatsApp, email, reunión, otra) |
| GET | `/api/dashboard`, `/api/metrics`, `/api/audits` | Datos agregados |
| GET / PUT | `/api/settings` | Configuración y precios |
| GET | `/api/export` | Copia de seguridad JSON |

```bash
npm test           # 43 tests: unitarios, presupuesto, CRM, API, mensajes, diagnóstico y e2e con Chromium
npm run typecheck
```

## Limitaciones

- Google cambia a menudo su página de Maps. Si un dato deja de leerse, el modo diagnóstico indica qué selector ajustar en `src/scraper/scripts/mapsScripts.ts`.
- Leer Google Maps de forma automatizada va contra sus términos de uso; con muchas consultas seguidas Google puede pedir verificación o bloquear temporalmente.
- La frecuencia de reseñas y la tasa de respuesta se calculan sobre las reseñas más recientes (hasta 40): son orientativas.
- Dos negocios con el mismo nombre y dirección se consideran el mismo prospecto.
