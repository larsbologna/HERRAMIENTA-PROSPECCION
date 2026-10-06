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
| **Prospección** | **El flujo principal.** Elegís rubro, zona y cantidad; la herramienta busca, descarta repetidos y te entrega los prospectos **ya analizados** (potencial, oportunidad y mensaje), organizados en **campañas**. Desde ahí, el **Modo Prospección Rápida**. Ver abajo. |
| **Dashboard** | Alerta de seguimientos pendientes y tu actividad (asignados, seguimientos, reuniones, conversión personal). Prospectos analizados, sin contactar, contactados, respondieron, reuniones, clientes, valor potencial y cerrado. Gráficos de prospectos por mes, valor acumulado, conversiones y estado comercial. Lista de "para contactar primero". |
| **Prospectos** | Tabla con búsqueda, filtros por estado, rubro, score y vendedor, próximo contacto, asignación masiva (admin) y orden por cualquier columna. |
| **Generador** | **Generador de Prospectos**: negocios nuevos de Google Maps por rubro, zona y cantidad, ordenados por oportunidad, con seguimiento comercial y estadísticas. Ver abajo. |
| **Pipeline** | Kanban: No contactado → Contactado → Respondió → Interesado → Reunión agendada → Propuesta enviada → Cliente, más Contactar después y No interesado / perdido. Arrastrá las tarjetas; se guarda solo. |
| **Auditorías** | Nuevo análisis y registro de todos los análisis (incluidos los reanálisis). |
| **Perfil del prospecto** | Responsable, próximo contacto, presupuesto **personalizable**, score por área, datos del negocio, problemas (impacto, motivo, servicio, beneficio), servicios recomendados, presupuesto, potencial económico, mensajes de WhatsApp, notas internas e historial. |
| **Métricas** | Conversión, ticket promedio, servicios más recomendados, rubros más analizados, scores promedio y distribución. |
| **Configuración** | Botones **Editar datos** (negocio, ciudad, presentación y web/Instagram que usan los mensajes de WhatsApp, con vista previa) y **Editar servicios y precios** (agregar, quitar y renombrar servicios; se recalculan todos los prospectos al instante). También copia de seguridad, usuarios y registro de actividad (solo administrador). |

### Flujo diario sugerido

**Con Prospección (recomendado):** Prospección → elegí *Barberías · Quilmes · 20* → **Buscar prospectos** → esperá que termine (podés dejarlo trabajando) → **Iniciar prospección rápida** → WhatsApp → **Contactado** → pasa solo al siguiente.

**Un negocio puntual:**

1. **Nuevo análisis** → pegá el enlace de Maps (botón *Compartir* de la ficha).
2. En el perfil, revisá los problemas y elegí el mensaje: **1er contacto**, **Corto** o **Seguimiento**. Editalo si querés, **Copiar** o **Abrir WhatsApp**, y después **Registrar envío** (pasa a *Contactado* y queda en el historial).
3. A medida que avanza, mové el prospecto en el **Pipeline** y anotá llamadas o reuniones en el **Historial**.
4. Al cerrar, pasalo a **Cliente** y ajustá el **valor cerrado** si acordaste otro precio.

Si analizás de nuevo un negocio (mismo nombre y dirección), se **actualiza** el prospecto: conserva estado, notas e historial, y suma una auditoría nueva.

---

## Prospección automática y Modo Prospección Rápida

**1. Buscar.** En **Prospección** elegís rubro (Barberías, Peluquerías, Gimnasios, Restaurantes, Veterinarias, Kioscos, Tiendas u otro), zona (Quilmes, Berazategui, Bernal u otra) y cantidad (10, 20, 30, 50 u otra) y tocás **Buscar prospectos**. La herramienta:

1. **Busca** en Google Maps **solo ese rubro**. Google mezcla resultados, así que cada negocio se acepta únicamente si su categoría o su nombre corresponde al rubro: una búsqueda de barberías trae solo barberías.
2. **Descarta duplicados** contra todo lo que ya tenés, de cualquier campaña y de cualquier día: Place ID, ficha y URL de Maps, teléfono, web, nombre más dirección y **nombres parecidos con la misma dirección** ("Barbería Los Primos" = "Los Primos Barber Club"). Después del análisis también compara **mismo Instagram** y **mismo WhatsApp**.
3. **Analiza cada negocio, de a uno**, para no exigir a la PC: Maps, web, Instagram con su Linktree, WhatsApp y reservas. Con eso arma oportunidades, potencial, argumento y mensaje. Si un análisis falla se reintenta una vez; si sigue fallando, se informa y se sigue con el próximo.
4. **Guarda** cada resultado apenas termina. Si se corta, lo hecho queda guardado.

La búsqueda corre en el servidor: la pantalla solo consulta el avance cada pocos segundos, así que podés dejarla trabajando o cerrar la pestaña. Si no hay suficientes negocios nuevos, entrega los que hay y lo dice: *"Se encontraron 7 prospectos nuevos válidos… No hay suficientes negocios nuevos para completar 20 sin repetir."* Nunca rellena con repetidos. Hay una búsqueda pesada por vez: Prospección, Generador y Análisis no corren al mismo tiempo.

**2. Campañas.** Cada búsqueda suma sus prospectos a la campaña **RUBRO — ZONA — MES** (por ejemplo, "BARBERÍAS — QUILMES — OCTUBRE"). Los rubros nunca se mezclan. Cada campaña muestra:
- encontrados y analizados;
- no contactados, contactados, respondieron, interesados y para contactar después;
- potencial alto, medio y bajo.

**3. Potencial comercial** (🔥 alto · 🟡 medio · ⚪ bajo), siempre con su **motivo** (por ejemplo, *"Potencial alto porque tiene 183 reseñas, Instagram encontrado, celular de contacto y 3 oportunidades confirmadas. No se detectó web propia."*). Se calcula solo con datos verificados: reseñas, canales encontrados, contacto disponible y oportunidades confirmadas. Sin teléfono ni WhatsApp verificado, o sin oportunidades confirmadas, es bajo.

**4. Oportunidades.** Para cada prospecto se muestra qué **tiene**, qué **no tiene**, qué **no se pudo verificar** y qué ofrecerle **y por qué**. Nunca se ofrece lo que ya tiene: si tiene web, se propone *mejorarla*; si reserva por Booksy, no se venden reservas. El mensaje lo reconoce: *"Vi que ya tienen Instagram y reservas online, que está muy bien, pero encontré…"*.

**5. Filtros combinables:** campaña, estado, potencial y búsqueda por nombre. La API también filtra por rubro y zona.

**6. Modo Prospección Rápida.** Muestra un prospecto por vez, solo los **no contactados** de la campaña, ordenados por potencial. Para cada uno se ve:
- Google Maps (calificación y reseñas, con ✓ verificado o ? no verificado);
- Instagram, Web, WhatsApp y Reservas (✓ / ✕ / ?);
- la oportunidad y el mensaje editable (completo o corto).

Los botones son:
- **Copiar mensaje**, **WhatsApp**, **Instagram**, **Google Maps** y **Web**: si un destino no existe, el botón aparece deshabilitado con "no disponible".
- **Contactado**: guarda el mensaje usado en el historial y pasa solo al siguiente.
- **Contactar después**: pide una fecha, la agenda en **Próximos contactos** y lo saca de pendientes.
- **No interesado**.
- **Siguiente →**: saltea al próximo sin volver al listado.

Los contactados desaparecen de pendientes y siguen en el historial.

**WhatsApp en la PC (lo que sí y lo que no se puede):**
- Una página web no puede controlar un chat ya abierto en WhatsApp Desktop: el único mecanismo oficial es el enlace `https://wa.me/<número>?text=<mensaje>`.
- Para que no se acumulen pestañas, todos los botones de WhatsApp usan **la misma pestaña**. wa.me es una página liviana que le pasa el chat a WhatsApp Desktop o al celular.
- Al tocar el botón, el mensaje **también se copia**. Si el chat se abre sin el texto, lo pegás con Ctrl+V.
- **Copiar mensaje** está siempre a mano.

**Estados:** No contactado · Contactado · Respondió · Interesado · Reunión agendada · Propuesta enviada · Cliente · Contactar después · No interesado / perdido. Los prospectos anteriores conservan su estado. "Sin contactar" y "Perdido" se muestran como "No contactado" y "No interesado / perdido".

---

## Generador de Prospectos

Sección **Generador**: indicá **rubro** (ej.: Barberías), **ciudad o zona** (ej.: Quilmes) y **cantidad** (1 a 50), y tocá **Generar**.

- Busca negocios reales en Google Maps: recorre **todas** las páginas de resultados (desplazando la lista) y, si no alcanza, prueba variantes de la búsqueda ("barberías en Quilmes", "barbería en Quilmes", "barberías Quilmes", "barbería cerca de Quilmes"), hasta completar la cantidad o agotar los resultados.
- **Nunca repite un negocio**: todo lo entregado queda guardado en la base (`data/prospeccion.db`) y no se vuelve a mostrar, ni a vos ni a otro usuario, aunque pasen días. Tampoco entrega negocios que ya analizaste en el CRM.
- **Duplicados** (criterio conservador: ante la duda, no se repite): Place ID → identificador de la ficha en la URL de Maps → nombre + dirección; además mismo teléfono, mismo sitio web propio, mismo nombre en la misma calle y altura, o mismo nombre con una ficha sin dirección. Dos sucursales reales (otra dirección y otro teléfono) se tratan como negocios distintos.
- Descarta los negocios **cerrados permanentemente** y los que **no están en la zona** pedida (la dirección tiene que mencionarla).
- **Nunca inventa ni completa**: si pedís 20 y hay 13 nuevos, entrega 13 y avisa *"Se encontraron 13 prospectos nuevos. No quedan más negocios sin analizar para este rubro y ubicación."*
- **Score de oportunidad (0–100)**, de mayor a menor. Cada punto suma solo si la carencia está verificada en la ficha:

  | Carencia | Puntos |
  |---|---|
  | Sin sitio web | +30 |
  | Ficha sin reclamar | +25 |
  | Sin WhatsApp visible (solo se verifica si no tiene web) | +20 |
  | Sin reservas/turnos online (+8 en rubros donde no se reserva) | +20 |
  | Sin teléfono | +15 |
  | Horarios incompletos o sin horarios | +10 |
  | Sin publicaciones | +10 |
  | Pocas reseñas (menos de 20) | +10 |
  | Calificación menor a 4 | +5 |

  Los pesos están en `src/generator/score.ts` (`SCORE_WEIGHTS`).
- **Analizar**: abre el análisis completo de siempre (mismo informe comercial, mensajes y presupuesto). Al terminar, el prospecto queda vinculado y muestra **Ver análisis**.
- **Seguimiento**: Nuevo → Contactado → Interesado (respondió) → Llamada agendada → Propuesta enviada → Cliente ganado / Perdido.
- **Estadísticas**: encontrados, pendientes, contactados, interesados, propuestas enviadas, ganados, perdidos y tasa de cierre (ganados sobre contactados).
- Cada vendedor ve lo que generó; el administrador ve todo el equipo. Se puede generar de a una búsqueda por vez. Tiempo máximo por búsqueda: `GENERATOR_TIMEOUT_MS` (15 minutos por defecto).

---

## Servicios, precios y presupuestos (pesos argentinos)

**Configuración → Servicios y precios → Editar servicios y precios** (solo administrador):

- Cambiar **pago inicial** y **abono mensual** de cada servicio, el **descuento por paquete** y la **moneda**.
- **Agregar servicios propios** (nombre, descripción y precio).
- **Quitar** servicios que no ofrecés (los de la herramienta se pueden **restaurar**; los propios se eliminan). Un servicio quitado no se recomienda, no entra en los presupuestos y no se menciona en los mensajes de WhatsApp.
- Cambiar el nombre y la descripción de cualquier servicio.

Al guardar, el presupuesto y el valor potencial de **todos** los prospectos se recalculan en el momento, y queda en el registro de actividad.

**Presupuesto de cada prospecto:** en el perfil, **Personalizar** permite elegir los servicios (incluidos los propios), ajustar el precio para ese cliente y aplicar un descuento. Reemplaza al plan recomendado automático, se conserva aunque reanalices el negocio y se puede **Volver al automático**. Lo puede hacer el vendedor asignado o un administrador.

Los presupuestos muestran **pago inicial + abono mensual**: no se suma un "total por N meses", porque no se sabe cuánto tiempo va a pagar cada cliente.

- **Valor potencial** de un prospecto = pago inicial del plan recomendado (o del personalizado), con descuento. El abono mensual se muestra aparte.
- **Plan completo** = pago inicial de todos los servicios de prioridad alta y media.
- **Ticket promedio** = promedio del valor potencial.

Todo se guarda en **`precios.json`**, que también se puede editar a mano:

```json
{
  "moneda": "ARS",
  "servicios": {
    "maps-optimization": { "pagoInicial": 250000, "mensual": 80000 },
    "website":           { "pagoInicial": 650000, "mensual": 35000, "nombre": "Landing page" },
    "booking-system":    { "pagoInicial": 320000, "mensual": 55000, "activo": false },
    "custom-diseno-de-logo": { "pagoInicial": 90000, "mensual": 0, "nombre": "Diseño de logo", "descripcion": "Logo y paleta" }
  },
  "descuentoPaquete": { "minimoServicios": 3, "porcentaje": 10 }
}
```

Si el archivo tiene un error, se siguen usando los últimos precios válidos y Configuración lo avisa. Un `mesesContrato` de versiones anteriores se ignora. Los precios incluidos son **de ejemplo**: reemplazalos por los tuyos.

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

## Canales encontrados y verificación cruzada

Antes de decir que a un negocio "le falta" algo, la herramienta revisa **todos sus canales**: la ficha de Google Maps, su web, su **Instagram** (bio, link de la bio, contacto del perfil de empresa) y, si el link es un **Linktree** o similar, cada enlace que contiene.

En el perfil del prospecto, la tarjeta **Canales encontrados** muestra Google Maps, página web, Instagram, WhatsApp, Facebook, reservas/turnos, menú online, teléfono y otros links, cada uno con:

| Símbolo | Significa |
|---|---|
| ✓ **Encontrado** | Se vio el canal (y dónde: Google Maps, Web, Instagram, Instagram (Linktree)) |
| ✗ **No encontrado** | Se revisaron **todos** los lugares donde podría estar y no aparece |
| ? **No verificado** | Algo no se pudo revisar (Instagram pidió iniciar sesión, la web no cargó, el Linktree no abrió…). **No significa que no exista** |

Si los canales se contradicen (Google enlaza una web e Instagram otra, el Instagram enlazado no existe, la web de Instagram no carga) aparece **Requiere revisión**.

**Nunca se recomienda algo que el negocio ya tiene.** Ejemplo: si Instagram enlaza un Linktree con Booksy, se descarta "no tiene reservas online" (queda en *"Descartados: el negocio ya lo tiene"*). Si tiene web pero solo figura en Instagram, en lugar de "no tiene web" se dice que **no está vinculada en Google Maps**.

### Niveles de cada argumento

- **Confirmado:** el dato se verificó en todos los canales. Es lo único que se usa en el mensaje.
- **Probable:** falta revisar algún canal, o es una deducción (por ejemplo, "WhatsApp sin respuesta automática", que no se ve desde afuera). Se muestra con el motivo, pero no va al mensaje.
- **Requiere revisión:** la información es contradictoria; se resuelve a mano.

Con Instagram se guardan: `instagram_url`, `instagram_username`, `instagram_contact_available`, `instagram_whatsapp_available`, `instagram_booking_available`, `instagram_website_url`, `instagram_external_link`, `instagram_linktree`, `instagram_booking_provider`, `instagram_analysis_status` (`ok`, `parcial`, `bloqueado`, `no_encontrado`, `error`) e `instagram_notes`. Si no se sabe un dato, queda en `null` (desconocido), nunca en `false`.

### Verificar presencia online

Los prospectos analizados antes de esta versión no tienen canales: se ven igual que siempre y sus argumentos se tratan como antes. El botón **Verificar presencia online** (tarjeta Canales) vuelve a revisar la web e Instagram **sin volver a leer Google Maps**, rearma argumentos y mensaje, y deja la actividad registrada. Conviene usarlo antes de contactar un prospecto viejo.

La revisión de Instagram se puede desactivar con `INSTAGRAM_CHECK=false` en `.env`.

### Mensaje de contacto

El mensaje se arma solo con argumentos **confirmados**, ordenados por prioridad comercial (1 = más importante), con un problema principal y, como mucho, dos más. Cada problema explica la **consecuencia** para el negocio, no el dato técnico. Estructura: saludo, presentación ("Soy Iván Bologna, Gestor de Presencia Online…"), contexto, problemas, servicios relacionados y el pedido de permiso para mandar un audio corto. Entre 120 y 220 palabras, sin frases de agencia ("potenciar", "siguiente nivel", "sin compromiso"…). Si no hay nada confirmado, el mensaje no inventa problemas.

Botones de la tarjeta **Mensaje de contacto**:

- **Abrir WhatsApp:** usa el enlace oficial de WhatsApp *Click to Chat*, `https://wa.me/<número>?text=<mensaje codificado>`, que el navegador abre como cualquier enlace. El sistema decide si lo muestra en WhatsApp Desktop, en la app del celular o en WhatsApp Web, así que funciona igual con WhatsApp Desktop cerrado, abierto, minimizado o en segundo plano. No se envía solo: lo revisás y lo mandás vos. La herramienta no usa `whatsapp://` ni controla la ventana o el proceso de WhatsApp, y no automatiza clics. El número es el WhatsApp confirmado (enlace de WhatsApp en la web, Instagram o Linktree, o el contacto de Instagram) o, si no hay, el teléfono de Google en formato internacional: `(0341) 15-555-0000` → `5493415550000`; un fijo queda `543414567890`, que sirve si el negocio usa WhatsApp Business. Si el número está incompleto, no se inventa: WhatsApp se abre para elegir el contacto. Después del clic aparece **Continuar en WhatsApp Web**, con el mismo chat, por si la app no lo abrió, y el mensaje queda copiado por si hay que pegarlo con Ctrl+V.
- **Abrir Instagram:** abre el perfil. Instagram no permite abrir un mensaje directo con texto cargado, así que no se inventan enlaces de DM: usá **Copiar mensaje** y pegalo.
- **Copiar mensaje** y **Registrar envío**.

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
        └── views/         auth, dashboard, prospecting, rapid, prospects, generator, pipeline, audits, prospect, metrics, settings
src/
├── server.ts              Arranque (127.0.0.1 por defecto; HOST/TRUST_PROXY para VPS)
├── usersCli.ts            Gestión de usuarios por terminal
├── api/                   Rutas HTTP (node:http, sin frameworks) con sesión y permisos por rol
├── auth/                  Contraseñas (scrypt), usuarios, sesiones, límite de intentos
├── crm/                   Repositorio SQLite, estados, estadísticas, importación de la V1
├── db/                    Conexión node:sqlite y migraciones versionadas
├── messages/              Mensajes de WhatsApp (primer contacto, corto, seguimiento) y prioridad comercial de cada problema
├── channels/              Instagram (perfil público + Linktree), enlaces y verificación cruzada de canales
├── generator/             Generador de Prospectos: búsqueda en Maps, duplicados, score y persistencia
├── prospecting/           Prospección automática: rubros, campañas, potencial, oportunidades y búsqueda en segundo plano
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
| POST | `/api/prospects/:id/verificar` | Verificar presencia online: revisa web, Instagram y canales y rearma argumentos y mensaje (streaming NDJSON) |
| PUT | `/api/prospects/:id/presupuesto` | Presupuesto personalizado `{override: {items, discountPct}}` o `{override: null}` |
| GET / POST / PATCH | `/api/followups`, `/api/prospects/:id/followups`, `/api/followups/:id` | Seguimientos: listar, agendar, marcar hecho o cancelado |
| POST | `/api/prospects/:id/activities` | Registrar actividad (nota, llamada, WhatsApp, email, reunión, otra) |
| GET | `/api/dashboard` | Datos agregados (del vendedor o globales) y KPIs personales |
| GET | `/api/metrics`, `/api/audits`, `/api/activity` | Métricas, auditorías y registro de actividad (admin) |
| GET / POST / PATCH | `/api/users`, `/api/users/:id` | Gestión de usuarios (admin) |
| GET | `/api/prospeccion` | Rubros, zonas, campañas con resumen y búsqueda en curso |
| POST | `/api/prospeccion/buscar` | Búsqueda automática `{rubro, zona, cantidad}` (en segundo plano) · `GET /api/prospeccion/trabajo` avance · `POST /api/prospeccion/trabajo/cancelar` |
| GET | `/api/prospeccion/prospectos`, `/api/prospeccion/cola` | Listado con filtros (`campana`, `rubro`, `zona`, `estado`, `potencial`, `q`) · cola de no contactados para "Siguiente" |
| GET / POST | `/api/prospeccion/ficha/:id`, `/api/prospeccion/:id/resultado` | Ficha del modo rápido · resultado del contacto `{estado, mensaje?, fecha?, nota?}` |
| POST | `/api/generador/generar` | Generador de Prospectos: `{rubro, zona, cantidad}` (progreso en streaming NDJSON) |
| GET / PATCH | `/api/generador`, `/api/generador/:id` | Prospectos generados (`estado`, `q`) · cambiar estado comercial |
| GET | `/api/generador/estadisticas`, `/api/generador/busquedas` | Estadísticas del seguimiento · búsquedas realizadas |
| POST | `/api/generador/:id/vincular` | Vincula el análisis completo (prospecto del CRM) |
| GET / PUT | `/api/settings` | Configuración y precios (admin) |
| GET | `/api/export` | Copia de seguridad JSON (admin) |

```bash
npm test           # 134 tests: unitarios, presupuesto, CRM, migraciones, autenticación y roles, API, mensajes, diagnóstico, confiabilidad, generador (dedupe, score, persistencia, API e interfaz), canales e Instagram simulado, mensajes, layout y e2e con Chromium
npm run typecheck
```

## Limitaciones

- Google cambia a menudo su página de Maps. Si un dato deja de leerse, el modo diagnóstico indica qué selector ajustar en `src/scraper/scripts/mapsScripts.ts`.
- Leer Google Maps de forma automatizada va contra sus términos de uso; con muchas consultas seguidas Google puede pedir verificación o bloquear temporalmente.
- La frecuencia de reseñas y la tasa de respuesta se calculan sobre las reseñas más recientes (hasta 40): son orientativas.
- Dos negocios con el mismo nombre y dirección se consideran el mismo prospecto.
- Instagram a veces pide iniciar sesión para ver un perfil (sobre todo con muchas consultas seguidas). En ese caso todo lo que dependa de Instagram queda **No verificado** y no se usa en el mensaje.
