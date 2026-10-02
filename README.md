# Prospección · Gestor de Presencia Online

Pegás el enlace de Google Maps de un negocio y en uno o dos minutos obtenés:

1. **Datos del negocio** (calificación, reseñas, teléfono, web, horarios…)
2. **Problemas detectados**, cada uno con
3. **Impacto estimado** (Bajo / Medio / Medio-Alto / Alto)
4. **Motivo** (cómo afecta al negocio, con sus datos reales)
5. **Servicio recomendado**
6. **Beneficio para el cliente**
7. **Mensaje de WhatsApp** listo para editar y copiar
8. **Presupuesto sugerido** (plan recomendado y plan completo)

Funciona en tu computadora. No usa APIs de Google ni Google Cloud: lee la información pública de la ficha con un navegador automático (Playwright).

---

## Cómo se usa

**Requisito único:** tener [Node.js](https://nodejs.org) instalado (versión LTS).

| Sistema | Iniciar |
|---|---|
| Windows | Doble clic en **`iniciar.bat`** |
| Mac | Doble clic en **`iniciar.command`** (la primera vez: clic derecho → Abrir) |
| Linux / terminal | `npm install && npm run setup` (solo la primera vez) y luego `npm start` |

La primera vez instala lo necesario (unos minutos). Después se abre sola en el navegador (`http://localhost:3000`).
Mientras la ventana negra siga abierta, también podés abrir **`index.html`** con doble clic.

1. Copiá el enlace del negocio en Google Maps (botón **Compartir**).
2. Pegalo y pulsá **Analizar**.
3. Revisá los problemas, editá el mensaje y copialo.

Para cerrar la herramienta, cerrá la ventana negra.

---

## Personalizar

**Tus precios:** editá **`precios.json`** (moneda, pago inicial y cuota mensual de cada servicio, descuento por paquete). Los cambios se aplican en el siguiente análisis, sin reiniciar.

**Tu nombre en el mensaje:** copiá `.env.example` como `.env` y completá `SELLER_NAME`. Igual podés editar el mensaje antes de copiarlo.

**Textos de los argumentos:** están en `src/proposal/salesArguments.ts`, uno por tipo de problema.

---

## Si algo falla

| Mensaje | Qué hacer |
|---|---|
| "La herramienta no está iniciada" | Abrí `iniciar.bat` / `iniciar.command`. |
| "Falta el navegador de Playwright" | Ejecutá una vez `npx playwright install chromium`. |
| "Google Maps tardó demasiado" | Probá de nuevo. Si se repite, esperá unos minutos (Google limita muchas consultas seguidas). |
| "No se pudo leer la ficha" | Asegurate de copiar el enlace de un **negocio**, no de una búsqueda. |
| Algún dato sale mal o vacío | Ejecutá el modo diagnóstico (abajo) y revisá qué selector falló. |

Un análisis se cancela solo a los 3 minutos o si cerrás la página. Se hace un análisis a la vez.

### Modo diagnóstico

Para comprobar cómo lee la herramienta una ficha real de Google Maps:

```bash
npm run diagnose -- "https://maps.app.goo.gl/XXXX"
npm run diagnose -- "<url>" --visible        # viendo el navegador
```

Muestra, para cada dato, el valor obtenido, el selector usado, el nivel de confianza y la fuente exacta, y genera `data/diagnostics/<fecha>/diagnostico.json` con el HTML de cada pestaña.

---

## Estructura

```
index.html               Interfaz (única pantalla)
iniciar.bat / .command   Iniciadores con doble clic
precios.json             Tus precios (presupuesto sugerido)
src/
├── server.ts            Servidor local mínimo (solo accesible desde tu computadora)
├── analyzer.ts          Análisis completo: Maps → web → problemas → mensaje → presupuesto
├── scraper/             Lectura de la ficha de Maps y análisis del sitio web (Playwright)
├── auditor/             Detección de problemas por área y rubro
├── proposal/            Argumentos comerciales, servicios, mensaje de WhatsApp y presupuesto
├── domain/              Tipos y perfiles por rubro
├── diagnostics/         Modo diagnóstico del scraper
├── cli.ts               Análisis por terminal: npm run analizar -- "<url>"
└── diagnose.ts          Modo diagnóstico por terminal
test/                    Tests (con una ficha de Maps simulada)
```

```bash
npm test           # tests (unitarios + análisis completo con Chromium)
npm run typecheck
```

## Limitaciones

- Google cambia a menudo su página de Maps. Si un dato deja de leerse, el modo diagnóstico muestra qué selector ajustar en `src/scraper/scripts/mapsScripts.ts`.
- Leer Google Maps de forma automatizada va contra sus términos de uso; con muchas consultas seguidas Google puede pedir verificación o bloquear temporalmente.
- La frecuencia de reseñas y la tasa de respuesta se calculan sobre las reseñas más recientes (hasta 40): son orientativas.
- Si Maps no muestra el total de fotos, la herramienta no afirma que "tiene pocas fotos".
