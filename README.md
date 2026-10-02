# Herramienta de Prospección · Gestor de Presencia Online

Pegas el enlace de Google Maps de un negocio y la herramienta genera **automáticamente** un informe de auditoría comercial: problemas, oportunidades, servicios que puedes venderle con su prioridad, potencial de mejora y un **mensaje listo para enviar por WhatsApp**. El informe se puede exportar a PDF.

- ✅ **Sin Google Cloud Console ni APIs de pago**: usa Playwright para leer la información pública que se ve en la ficha.
- ✅ 100% local: Node.js + TypeScript, los informes se guardan en disco (`./data`).
- ✅ Preparada para **agentes IA** y para integrarse con tu **FÁBRICA DE AGENTES IA** (webhook + agentes HTTP).

---

## Puesta en marcha

Requisitos: **Node.js 20+**.

```bash
npm install
npm run setup          # descarga Chromium para Playwright (solo la primera vez)
cp .env.example .env   # opcional: tu nombre para el mensaje de WhatsApp, puerto, etc.
npm run dev            # http://localhost:3000
```

Producción: `npm run build && npm start`.

### Uso por línea de comandos

```bash
npm run audit -- "https://maps.app.goo.gl/XXXX" --pdf
```

> El archivo `.env` se carga automáticamente; las variables exportadas en la terminal tienen prioridad.

---

## Qué hace

### 1. Extracción (Playwright)
De la ficha de Google Maps: nombre, categoría, calificación, nº de reseñas, dirección, teléfono, web, horarios, fotos (cantidad y URLs visibles), descripción, servicios/atributos (pestaña *Información*), botón de reservas, menú/carta, publicaciones, histograma de estrellas, si la ficha está reclamada, redes sociales y Place ID. Además abre la pestaña de reseñas, las ordena por **más recientes** y analiza una muestra (fecha, estrellas, si el dueño respondió).

Del sitio web (si existe): tiempo de carga, peso, HTTPS, adaptación móvil (viewport, desbordamiento, texto pequeño), contacto (tel, email, formulario, dirección, visible al entrar), **botón de WhatsApp**, **reservas online** (Calendly, Booksy, Fresha, TheFork, Doctoralia…), chats/bots ya instalados, tecnología antigua, año del copyright.

Capturas: ficha, reseñas, información, web escritorio y web móvil.

Todo se guarda en `data/reports/<id>/report.json` (+ `screenshots/`).

### 2. Auditoría
Reglas puras y testeables en `src/auditor/rules/`:

| Área | Detecta |
|---|---|
| Google Maps | ficha no reclamada, categoría genérica, sin/pobre descripción, horarios ausentes o incompletos, pocas fotos, sin publicaciones, pocos atributos, sin carta (gastronomía), sin reservas online |
| Sitio web | no tiene / es una red social / no carga, sin HTTPS, no adaptada a móvil, lenta, diseño anticuado, contacto poco claro, sin WhatsApp, sin reservas online |
| WhatsApp | enlace visible o no, sin respuesta automática, potencial de automatización, oportunidad de agente IA |
| Reputación | volumen de reseñas, calificación, tasa de respuesta, negativas sin responder, frecuencia de reseñas recientes |
| Sistema QR | si conviene y con qué urgencia, con estimación de reseñas/mes |

Los umbrales se adaptan al **rubro** detectado (`src/domain/verticals.ts`: gastronomía, salud, belleza, fitness, alojamiento…).

### 3. Argumentos comerciales (uno por cada problema)
`src/proposal/salesArguments.ts` convierte **cada problema detectado** en un argumento de venta listo para usar, con los datos reales del negocio (nº de reseñas, calificación, rubro, tiempo de carga…):

```
Problema detectado:
Tiene pocas reseñas (23).
Impacto estimado:
Alto
Motivo:
Muchos usuarios comparan negocios similares antes de elegir. Con 23 reseñas, Peluquería Lola queda por
debajo de los negocios de belleza y bienestar mejor posicionados (que suelen superar las 100), lo que
reduce la confianza y las conversiones, y también su posición en Google Maps.
Servicio recomendado:
Sistema QR para reseñas y Optimización de Google Maps.
Beneficio para el cliente:
Un flujo constante de reseñas positivas que aumenta la confianza, mejora el posicionamiento y convierte
más búsquedas en clientes.
```

- Impacto: **Bajo / Medio / Medio-Alto / Alto**, ordenados de mayor a menor.
- Cada servicio de la propuesta muestra qué problemas concretos **resuelve**.
- En la interfaz: botón **Copiar argumentos** (texto plano en este formato). API: `GET /api/audits/:id/arguments.txt`.
- Para cambiar un texto, edita su entrada en `ARGUMENTS`. Un test comprueba que todo problema que detecta el auditor tenga su argumento.
- Los problemas que aporten agentes IA sin argumento propio también se convierten (impacto según gravedad y servicio según área).

### 4. Propuesta comercial
`src/proposal/proposalEngine.ts` decide qué servicios ofrecer, con **encaje (0-100)** y **prioridad** (alta/media/baja):
Optimización Google Maps · Sistema QR para reseñas · Sitio web profesional · Bot IA para WhatsApp · Dashboard administrativo · Sistema de reservas · Automatización de atención.

### 5. Informe
Resumen ejecutivo · Problemas (en formato de argumento comercial) · Oportunidades · Servicios recomendados · Prioridad · Potencial de mejora (hoy → con mejoras) · Mensaje de WhatsApp. El mismo HTML se muestra en pantalla y se exporta a PDF (Chromium), así lo que ves es lo que envías.

### 6. Sistema QR de reseñas (demo funcional)
Cada informe incluye una página de valoración propia lista para enseñar al cliente: `http://localhost:3000/r/<id>` (y su QR en `/api/audits/<id>/qr.png`).
- **5★** → redirige a Google para dejar la reseña (enlace directo *escribir reseña* si se detectó el Place ID).
- **1-4★** → guarda el comentario en privado (`data/reports/<id>/qr-feedback.json`, consultable en `/api/audits/<id>/feedback`).

Para usarla con clientes reales, define `PUBLIC_BASE_URL` con tu dominio público.

---

## Arquitectura

```
src/
├── config/          Configuración por variables de entorno
├── domain/          Tipos (contrato del JSON) y perfiles por rubro
├── scraper/         Playwright: Google Maps + análisis del sitio web
│   └── scripts/     Código que corre dentro del navegador (selectores centralizados)
├── auditor/         Reglas de auditoría, métricas, puntuaciones y evaluación QR
├── proposal/        Catálogo de servicios, motor de propuesta y mensaje de WhatsApp
├── report/          Resumen ejecutivo, render HTML, PDF y QR
├── agents/          Contrato de agentes IA, registro y agente HTTP remoto
├── integrations/    Webhook a la FÁBRICA DE AGENTES IA
├── pipeline/        Orquestador con eventos de progreso + cola de trabajos
├── storage/         Persistencia en disco (informes y feedback QR)
├── server/          API Express + SSE + página QR
└── cli.ts           Uso por terminal
public/              Interfaz web (HTML/CSS/JS sin build)
test/                Unit tests + e2e con Chromium contra una ficha de Maps simulada
```

Flujo: `Maps → Web → Auditoría → Agentes IA → Propuesta → Informe (JSON + HTML + PDF)`.

---

## API (para integraciones)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/audits` `{ "url": "…" }` | Lanza un análisis → `{ id }` |
| GET | `/api/audits/:id/events` | Progreso en tiempo real (Server-Sent Events) |
| GET | `/api/audits/:id` | Informe completo (JSON) — 202 mientras se procesa |
| GET | `/api/audits` | Historial |
| GET | `/api/audits/:id/html` | Informe renderizado (fragmento HTML) |
| GET | `/api/audits/:id/arguments.txt` | Argumentos comerciales en texto plano |
| GET | `/api/audits/:id/pdf` | Descarga PDF |
| GET | `/api/audits/:id/qr.png` | QR de la página de valoración |
| GET | `/api/audits/:id/feedback` | Feedback interno captado por el QR |
| GET | `/r/:id` | Página pública de valoración |
| GET | `/api/agents` | Agentes IA registrados |

---

## Agentes IA y FÁBRICA DE AGENTES IA

**1. Webhook de salida.** Con `AGENT_FACTORY_WEBHOOK_URL` cada informe terminado se envía por POST:

```json
{ "type": "prospect.audit.completed", "version": 1, "sentAt": "…",
  "links": { "report": "…", "pdf": "…", "qrPage": "…", "screenshots": ["…"] },
  "report": { /* AuditReport completo, ver src/domain/types.ts */ } }
```

**2. Agentes que enriquecen el análisis.** Con `AGENT_ENDPOINTS=url1,url2` cada agente recibe por POST `{ "type": "prospect.audit.enrich", "version": 1, "input": AgentInput }` y puede responder:

```json
{ "findings": [{ "id": "seo-x", "area": "maps", "severity": "medium", "title": "…", "detail": "…" }],
  "opportunities": [], "executiveSummary": "…", "whatsappMessage": "…", "notes": "…" }
```

Los hallazgos se fusionan, se recalculan puntuaciones y propuesta, y los textos opcionales reemplazan a los generados. Los agentes corren en paralelo con timeout: si uno falla, el informe sale igual (queda registrado en `agentContributions`).

**3. Agentes locales en TypeScript** (p. ej. uno que llame a un LLM):

```ts
import { agentRegistry } from './src/agents/registry.js';

agentRegistry.register({
  id: 'copywriter', name: 'Copywriter IA', description: 'Reescribe el mensaje de WhatsApp',
  async run(input, signal) {
    const message = await miLLM(`Reescribe este mensaje para ${input.profile.name}: ${input.proposal.whatsappMessage}`, { signal });
    return { whatsappMessage: message };
  },
});
```

---

## Tests

```bash
npm test         # unit tests + e2e (Chromium real contra test/fixtures/maps.html)
npm run typecheck
```

## Limitaciones conocidas

- Google cambia a menudo las clases CSS de Maps. El scraper usa primero atributos estables (`data-item-id`, `aria-label`, roles) y deja todos los selectores en `src/scraper/scripts/mapsScripts.ts` para ajustarlos fácilmente. Si algo deja de leerse, aparece en *Notas del análisis* del informe.
- Si Google muestra un captcha (muchas consultas seguidas desde la misma IP), espera unos minutos o usa `HEADLESS=false` para resolverlo a mano.
- Frecuencia y tasa de respuesta se calculan sobre una muestra de reseñas recientes (hasta 40): son orientativas.
- El número de fotos solo es exacto cuando Maps lo muestra; si no, se cuentan las visibles (marcado como estimación).
- Maps solo muestra públicamente la categoría principal (las secundarias no son visibles sin acceso al perfil).
