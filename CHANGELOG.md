# Changelog

Todos los cambios relevantes de CENZONTLE se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el
proyecto se adhiere al [Versionado Semántico](https://semver.org/lang/es/).

## Cómo leer este archivo

- Cada versión agrupa sus cambios en **Añadido**, **Cambiado**, **Corregido**,
  **Obsoleto**, **Eliminado** y **Seguridad**.
- El bloque **⚠️ Requiere acción** aparece primero en cada versión y lista lo que
  tienes que hacer tú al actualizar: aplicar migraciones de base de datos, definir
  variables de entorno nuevas o ajustar tu despliegue. Si solo lees una parte de una
  versión, que sea esa.
- Las entradas describen qué cambia para quien **usa** el proyecto, no qué archivos se
  tocaron.

---

## [Unreleased]

Sin cambios registrados todavía.

---

## [0.1.0] - 2026-07-26

Primera versión pública del monorepo. CENZONTLE es una plataforma de gestión de
proyectos con una software factory ("el Forge") integrada: defines iniciativas, épicas
e historias, agentes de IA te ayudan a redactarlas y diagramarlas, y el Forge despacha
esas historias a una flota de workers que corren Claude Code para implementarlas,
verificarlas contra un Definition of Done y llevarlas hasta un release gate humano.

### ⚠️ Requiere acción

Esta es la primera versión: si vienes de un clon anterior a la publicación, trátalo como
una instalación desde cero.

**Base de datos — 47 migraciones de Prisma que aplicar**

```bash
pnpm --filter @cenzontle/api exec prisma migrate deploy
```

Sin esto, el API arranca pero devuelve `503` con el código `P2021` (`relation "..." does
not exist`) en cuanto tocas cualquier endpoint. Detalles y resolución de problemas en
[`docs/database.md`](docs/database.md).

**Variables de entorno obligatorias**

El API (`apps/api/.env`) necesita estas tres, y las tres son nuevas si vienes de un
estado anterior del proyecto:

| Variable | Para qué sirve | Cómo generarla |
| --- | --- | --- |
| `DATABASE_URL` | Conexión a PostgreSQL | El `docker-compose.yml` incluido usa `postgresql://cenzontle:cenzontle_dev@localhost:5432/cenzontle` |
| `VAULT_ENCRYPTION_KEY` | Llave maestra AES-256-GCM con la que se cifran **todos** los secretos guardados en la base (tokens de GitHub, API key de Anthropic, external secrets) | `openssl rand -base64 32` |
| `INTERNAL_API_KEY` | Secreto compartido entre el BFF de `apps/web` y el API | `openssl rand -hex 32` |

Sin `VAULT_ENCRYPTION_KEY` el API **no arranca**: el servicio de cifrado falla en el
arranque (`VAULT_ENCRYPTION_KEY missing or too short`) en lugar de cifrar con una llave
por defecto insegura. Rotarla invalida todo lo ya cifrado en la base: exige re-cifrado
manual.

`INTERNAL_API_KEY` va con **exactamente el mismo valor** en `apps/api/.env` y en
`apps/web/.env.local`, como piden los `.env.example` y
[`docs/configuration.md`](docs/configuration.md). Ojo: en 0.1.0 ningún componente lo
verifica todavía —el BFF autentica reenviando el access token de Auth0 del usuario—, así
que no lo trates como control de acceso.

Con `NODE_ENV=production` se suman las credenciales de almacenamiento (`S3_ACCESS_KEY`,
`S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`): si faltan, el API aborta el arranque. En
local solo advierte y las operaciones de archivos fallan hasta que las configures.

**Auth0 es obligatorio y no tiene bypass de desarrollo.** Sin las variables de Auth0
configuradas en web y API, el middleware falla cerrado con `503` y no puedes entrar ni en
local. La guía paso a paso está en [`docs/auth0-setup.md`](docs/auth0-setup.md); la
referencia completa de variables (incluidas `REDIS_*`, `S3_*`, `ANTHROPIC_API_KEY` y las
opcionales de step-up auth `AUTH0_M2M_*`) está en
[`docs/configuration.md`](docs/configuration.md).

**Servicios de apoyo.** `docker compose up -d` levanta PostgreSQL 16, Redis 7 y MinIO,
que son las dependencias de infraestructura del API (base, throttling/caché de sesiones
y almacenamiento de documentos y assets de branding).

**Worker del Forge.** El CLI `factory-worker` ejecuta código generado por IA en tu
máquina. Por defecto corre dentro de un sandbox (`sandbox-exec` en macOS, `firejail` en
Linux). Desactivarlo exige un **doble opt-in explícito**:
`FACTORY_WORKER_SANDBOX_MODE=none` **y** `FACTORY_WORKER_ALLOW_NO_SANDBOX=1`; si falta el
segundo, el daemon arranca pero aborta cada historia antes de lanzar el agente. Ver
[`docs/forge-worker.md`](docs/forge-worker.md).

### Añadido

#### Gestión de proyectos

- **Jerarquía completa de trabajo**: iniciativas → épicas → historias de usuario, con
  estados, story points, fechas, asignación por células (pods) y matriz de trazabilidad.
- **Vault de definiciones**: editor Tiptap propio respaldado por un repositorio de
  GitHub, con árbol de carpetas, vista de grafo de documentos y changelog por documento.
  El vault es la fuente de verdad del contenido; CENZONTLE es el único que escribe en él.
- **Generación de épicas con IA**: un agente de Claude redacta la épica a partir de tu
  contexto y la deja versionada en el vault.
- **Generación de historias con tres agentes en cadena** (Product Owner → Tech Lead →
  QA): el PO propone el alcance, el Tech Lead aporta diseño técnico y el QA la estrategia
  de pruebas. El número de historias lo decide el agente según el alcance real de la
  épica, con tope defensivo. Cada historia se materializa como carpeta en el vault con
  definición de negocio, definición técnica y estrategia de testing.
- **Dependencias y orden entre historias**: el Tech Lead emite un DAG de bloqueos
  (`blockedBy`) y las dependencias externas descubiertas se listan con badges de tipo
  duro/blando; aceptar propuestas refresca el grafo sin recargar la página.
- **Diagramas de épica generados por IA** con panel lateral de pasos y documento de flujo
  guardado en el vault, más un editor XYFlow con pan/zoom estilo Figma, nodos
  personalizados, temas configurables, persistencia y autoguardado. Cada nodo del grafo
  debe estar justificado en al menos un paso del documento (rango validado de 3 a 10
  pasos).
- **Tab de Diseño en épicas** con handoff a Claude para generar la referencia visual que
  luego consume el Forge.
- **Agente de conexiones del vault**: analiza todos los documentos, asigna tags temáticos
  al frontmatter y así puebla la vista de grafo con conexiones reales. Preserva los tags
  existentes y solo acepta tags que conecten entre 2 y 5 documentos.
- **Resúmenes ejecutivos de iniciativa**: el backend calcula todas las métricas desde la
  base (progreso, story points, distribución por estado, carga por pod, línea de tiempo,
  dependencias) y la IA solo redacta la lectura ejecutiva anclada a esas cifras, con un
  bloque de KPIs y cinco visualizaciones D3 (salud, calendario vs avance, distribución de
  historias, carga por pod y progreso por épica). La IA nunca produce números.
- **Asistente lateral de edición**: un chat que lee el vault, el código y los documentos,
  y propone ediciones de iniciativas, épicas e historias con diff y aplicación
  human-in-the-loop. El agente nunca escribe directo: tú apruebas cada cambio. Las
  sesiones sobreviven a recargas del navegador.
- **Protocolo de Visto Bueno** con tres aprobaciones (PO, Tech Lead, QA) y step-up
  authentication por contraseña antes de aprobar. Alta Gerencia puede aprobar en
  cualquier rol y el changelog conserva el nombre real de quien aprobó.
- **Exportación de iniciativas, épicas e historias** a PDF, Excel, Word, CSV y JSON,
  desde el menú contextual (clic derecho) con confirmación por escritura para acciones
  destructivas.
- **Documentos adjuntos**: subida a S3, preview inline de PDFs e imágenes en las tarjetas
  y copia sincronizada al vault con el texto extraído, para que los agentes puedan leerlos
  como contexto.
- **Bóveda de secretos externos**: credenciales de terceros cifradas, con resolución
  automática de la dependencia descubierta que las motivó. La API solo devuelve el valor
  enmascarado.
- **Modelo agnóstico de tracker**: los proyectos pueden vivir con o sin herramienta
  externa; cuando no hay integración configurada, la UI usa identificadores cortos
  internos y oculta los botones del tracker.
- **Módulos de Equipo, Aprobaciones y Reportes**, con dashboards de gráficas y gestión de
  miembros y células vía la Management API de Auth0.

#### El Forge

- **Command Center de la software factory**: dashboard multi-batch, monitor de flota y
  gestión de nodos de cómputo.
- **CLI `factory-worker`**: se registra contra el dashboard con un token, expone slots de
  ejecución y corre Claude Code en modo headless para implementar historias. Incluye
  scripts de preflight que detectan setup faltante antes de arrancar el runner.
- **Pipeline de cuatro etapas** — Forge → Staged → QA Testing → Released — con tablero
  visual del estado de cada batch.
- **Cola del Forge**: envías al Forge una épica ya aprobada y un planner LLM organiza las
  historias en waves respetando el DAG de dependencias.
- **Definition of Done configurable**: criterios basados en evidencia, verificador
  adversarial que juzga cada criterio contra el diff, reintentos con backoff ante fallos
  de infraestructura, escaneo de seguridad **diferencial** (solo penaliza advisories
  nuevos frente a la rama base) y un verificador dedicado de seguridad de código donde
  solo los hallazgos altos bloquean.
- **Auto-merge entre historias** con resolución automática de conflictos.
- **Staging gate**: aprobación humana del batch consolidado con cinco capas defensivas
  (intersección de células, rol, step-up de contraseña, readiness de estado y control de
  concurrencia optimista).
- **Preview de batches**: levanta la aplicación generada en un entorno aislado, con
  allowlist de variables de entorno (nunca expone la llave de cifrado ni la cadena de la
  base) y bind a `127.0.0.1`.
- **Pipeline de QA automático multi-agente**: al mergear un batch, una campaña abre en
  paralelo cuatro lentes (suite de pruebas del repositorio, E2E en entorno efímero,
  seguridad diferencial y rendimiento/accesibilidad), verifica los fallos de forma
  adversarial —refutadores que votan por mayoría conservadora—, sintetiza un reporte con
  recomendación de rollout o rollback y confianza honesta, y lo presenta en un release
  gate humano con step-up auth. Un lente que falla no aborta la campaña.
- **Dashboards con datos reales**, todos alimentados por endpoints del backend y no por
  datos de ejemplo:
  - **PRs**: qué pull requests existen por historia y por batch, cruzado con el estado y
    el diffstat en vivo de GitHub, con caché de TTL asimétrico para no quemar el rate
    limit.
  - **Costos**: agregación de costo y tokens de todas las corridas de agentes (planner,
    generador y verificador, reintentos incluidos) por batch y por historia, con
    proyección a 30 días y un panel de "Costo de reintentos del DoD" que mide el
    desperdicio del loop de verificación.
  - **Logs**: stream de eventos derivado del estado ya persistido (ciclo de vida de la
    épica y de la corrida, hitos técnicos del worker y veredictos del DoD), así que
    sobrevive a reinicios del API, del worker o del navegador y se reconstruye
    retroactivamente para batches viejos.
  - **Velocity**: estimado en story points contra esfuerzo real (costo, duración y
    reintentos), con clasificación sobre/calibrado/sub-estimado y un badge de desviación
    en el detalle de la historia.
  - **QA**: estado de la campaña, hallazgos por lente y aprobación del release gate.
- **Loop de calibración al agente PO**: los agregados numéricos de velocity se inyectan
  al prompt del Product Owner para que sus próximas estimaciones aprendan del histórico.
- **Terminal en vivo del agente** (ttyd + tmux) para ver a Claude Code trabajando, con
  subida de imágenes, hitos, resumen al completar la corrida y drawer de detalle por
  agente.
- **Ajustes de IA por agente** en `/factory/settings → Tokens IA`: cada agente (PO, Tech
  Lead, QA, épicas, diagramas, asistente, worker y verificador de DoD) elige su modelo de
  Claude y su nivel de esfuerzo, con catálogo de modelos verificado en vivo, además de
  máximo de reintentos del DoD y duración máxima de corrida.
- **Métricas de la factory** de costo y latencia por agente.

#### Infraestructura y seguridad

- **Monorepo Turborepo + pnpm workspaces**: `apps/web` (Next.js 16, React 19, Tailwind 4,
  Radix UI), `apps/api` (NestJS 11, Prisma 7, PostgreSQL, Redis, Socket.IO),
  `apps/worker` (CLI del Forge) y los paquetes compartidos `shared`, `ts-config` y
  `eslint-config`.
- **Autenticación Auth0 con patrón BFF**: el navegador nunca habla directo con el API;
  el frontend proxea las llamadas del lado del servidor.
- **RBAC de cinco roles y 25 permisos** sobre toda la aplicación, más **ReBAC a nivel de
  carpeta** en el vault, con matriz de permisos editable en la UI y aplicación del lado
  del servidor.
- **Cifrado en reposo AES-256-GCM** de todos los secretos guardados en la base.
- **Sandbox de ejecución** del código generado por IA, específico por sistema operativo.
- **Aislamiento por git worktree** para los agentes, de modo que dos corridas nunca se
  pisen el árbol de trabajo.
- **Branding por organización**: logo expandido, imagotipo colapsado, favicon y nombre,
  configurables desde la UI, con almacenamiento S3/MinIO compatible con AWS y R2. Título
  del navegador, sidebar y pantalla de login reaccionan sin recargar.
- **`docker-compose.yml`** con PostgreSQL 16, Redis 7 y MinIO para levantar el entorno
  local completo.
- **Observabilidad**: logging estructurado con Pino y redacción de cabeceras y campos
  sensibles, filtro de excepciones de Prisma que traduce los errores de base a mensajes
  accionables (por ejemplo, "corre `prisma migrate deploy`"), healthcheck de S3 al
  arranque y auditoría estructurada de las mutaciones administrativas.
- **Throttling** de endpoints sensibles con almacenamiento en Redis compartido entre
  réplicas y comportamiento fail-open si Redis se cae.
- **Documentación de onboarding** siguiendo el framework Diátaxis en
  [`docs/`](docs/README.md): tutorial de puesta en marcha, explicación de la arquitectura,
  referencia de configuración y guías de Auth0, base de datos, worker del Forge y
  resolución de problemas. Más [`README.md`](README.md),
  [`CONTRIBUTING.md`](CONTRIBUTING.md) y [`SECURITY.md`](SECURITY.md).
- **Plantillas de colaboración** en [`.github/`](.github): reporte de bug, solicitud de
  funcionalidad, plantilla de pull request y configuración de Dependabot.
- **Licencia Apache-2.0** ([`LICENSE`](LICENSE)), declarada también en el campo `license`
  de los siete `package.json` del monorepo. Las atribuciones de terceros —incluidas las
  dependencias con copyleft (LGPL, EPL, AGPL) y la única cuya licencia no está aprobada
  por la OSI— viven en [`NOTICES.md`](NOTICES.md), con los textos completos en
  [`LICENSES/`](LICENSES). La convivencia en el proyecto se rige por el
  [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1).
- El cliente de Prisma se regenera solo en el `postinstall` del API, así que después de
  un `pull` con migraciones nuevas el proyecto compila sin pasos manuales.

### Cambiado

- El repositorio pasó de ser una aplicación Next.js única a un **monorepo Turborepo con
  backend NestJS**. Los comandos ahora se corren desde la raíz (`pnpm dev`, `pnpm build`,
  `pnpm test`) o con `--filter` por workspace.
- El vault se **reestructuró a una jerarquía anidada** (`iniciativas/<slug-id>/epics/<slug-id>/`
  con subcarpetas de diagramas, documentos, dependencias, matrices e historias), de modo
  que los agentes leen automáticamente todo el material de una épica antes de proponer
  historias. La migración de vaults existentes es idempotente y se dispara desde un
  endpoint de administración.
- **Épicas e historias colapsaron sus campos separados a un único documento markdown**
  por entidad, lo que simplifica la edición y la sincronización con el vault.
- Los **dashboards del Forge dejaron de mostrar datos de ejemplo**: PRs, costos, logs y
  velocity consumen endpoints reales, y las vistas que todavía no tienen fuente de datos
  muestran un estado vacío honesto en lugar de cifras inventadas.
- El panel de eficiencia por componente se reemplazó por **"Costo de reintentos del
  DoD"**: el costo por cada mil tokens era una constante del modelo y no accionable; el
  desperdicio del loop de verificación sí lo es.
- Un fallo del verificador de DoD ahora marca el criterio como **omitido**, no como
  fallido: un error del medidor no penaliza al agente que escribió el código.
- El editor de definiciones dejó de depender de Obsidian y pasó a ser un **editor propio
  basado en Tiptap** dentro de la aplicación.
- El selector de vault se movió a Ajustes y la acción se renombró a "Vincular", para que
  quede claro que asocia un repositorio existente en lugar de crear uno.
- La referencia de diseño ahora viaja **inline en el prompt** del agente que escribe el
  código, porque el worker corre Claude Code sin herramientas de vault y no podía leerla
  de otro modo. Es lo que permite resultados fieles al diseño.
- **Una instalación nueva arranca vacía de verdad.** Antes, los sprints y las ceremonias
  se inicializaban con datos inventados que ninguna API reemplazaba nunca, y el detalle de
  un batch del Forge mostraba épicas de ejemplo fijas. Ahora ambos parten vacíos y la UI
  muestra su estado vacío correspondiente hasta que exista información real.
- El ejemplo que guía al agente de épicas se reescribió sobre un **dominio ficticio**. El
  formato y el nivel de detalle son los mismos —de ellos depende la calidad de lo que
  genera—, pero ya no describe la operación de ninguna organización concreta.

### Corregido

- El dashboard de costos del Forge crasheaba con `Cannot read properties of undefined` y,
  cuando no crasheaba, mostraba datos ficticios.
- La vista de logs del Forge quedaba permanentemente vacía con el mensaje "Logs del Forge
  sin conectar".
- El preview de proyectos Vite mostraba una página en blanco (ahora se sirve por el dev
  server en vez de como estático) y los procesos de preview quedaban huérfanos al cerrar
  el API (ahora se matan por grupo de procesos y en `SIGINT`/`SIGTERM`).
- Épicas válidas se reportaban como "definición incompleta" por un desajuste entre los
  encabezados requeridos del frontend y los del backend.
- Recargar `/factory/settings` redirigía a `/factory` porque el gate de autenticación
  evaluaba permisos antes de terminar de cargar la sesión.
- Los gráficos D3 provocaban un hydration mismatch en el render del servidor.
- `pnpm lint` fallaba en los workspaces `web` y `shared` por configuraciones de ESLint
  inexistentes.
- El build de Next.js rompía en la página de Definiciones por usar `useSearchParams()` sin
  un límite de `Suspense`.
- El agente de diagramas podía emitir nodos decorativos sin ningún paso que los
  justificara, y el rango declarado de 3 a 10 pasos era solo una sugerencia del prompt:
  ahora ambos se validan y se rechaza el diagrama incoherente.
- El agente PO alucinaba rutas del vault cuando el prompt le pedía leer material que la
  épica no tenía; ahora descubre las rutas reales antes de leer.
- Las respuestas de los agentes se truncaban a mitad de JSON al superar el límite de
  tokens de salida.
- Los identificadores cortos internos sustituyen al guión vacío que aparecía en siete
  lugares de la UI cuando no había tracker externo configurado.
- Los enlaces a ramas y pull requests del Forge apuntaban a un repositorio fijo, así que
  daban 404 para cualquiera que configurara el suyo. Ahora se derivan del repositorio
  configurado, y cuando no hay ninguno muestran texto plano en vez de un enlace roto.
- Tres vistas del Forge llamaban `useMemo` de forma condicional, después de un retorno
  temprano. React identifica los hooks por orden de llamada, así que ese orden se
  desalineaba al pasar de "cargando" a "cargado" — y en dos de ellas el hook afectado era
  el que valida el esquema de la URL que se carga en un `iframe`.
- La tarjeta de métricas de un batch leía el reloj durante el render, lo que hacía el
  render impuro y podía provocar desajustes de hidratación.

### Seguridad

- **Inyección de prompt (CWE-1427)**: el texto que escribe el usuario se escapa antes de
  llegar a los agentes generadores, y el contenido de documentos y rutas del vault se
  inyecta con banners que lo marcan explícitamente como datos, no como instrucciones.
- **Autorización a nivel de objeto por células (CWE-639 / BOLA)** en iniciativas, épicas
  e historias, fail-closed: quien no tiene células asignadas no ve nada, y `findOne`
  devuelve `404` en vez de `403` para no filtrar la existencia de identificadores. Los
  agentes que emiten eventos autorizan por la **unión** de las células de la épica y las
  de sus historias, cerrando una fuga en épicas sin células propias. Crear o reasignar
  contenido a otra célula también quedó bloqueado.
- **Path traversal**: guards en la resolución de rutas del vault, en las referencias de
  diseño y en los documentos de flujo previos.
- **Secretos**: cifrado AES-256-GCM con derivación de llave e IV aleatorio por operación;
  el valor en claro nunca se devuelve por HTTP ni se escribe en logs. Escaneo del diff
  antes de hacer push, bloqueo de nombres de variables reservadas y depuración de
  secretos (`scrubSecrets`) en salidas de herramientas, en el razonamiento visible de los
  agentes y en la evidencia de QA. El sandbox del worker le niega al agente la lectura de
  las credenciales del host (`~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.netrc`, `~/.npmrc` y
  compañía), y la URL autenticada del clon se redacta de logs y mensajes de error antes de
  llegar al backend o a la UI.
- **Inyección de YAML** en el frontmatter del vault y **inyección en logs (CWE-117)**
  neutralizadas con normalización estricta.
- **Assets de branding**: solo se aceptan imágenes ráster (nada de SVG, para evitar XSS),
  se validan los magic bytes contra el tipo declarado y se sirven con `nosniff`, CSP
  restrictiva y `Content-Disposition: inline`.
- **Terminal de agentes**: defensa en tres capas contra escape de shell y bitácora de
  auditoría en JSONL.
- **Guard del worker fail-closed** por defecto y forzado de completitud bloqueado cuando
  `NODE_ENV=production`.
- **Throttling** en `verify-password` y en los endpoints de aprobación.
- Operaciones destructivas (como realinear la rama de desarrollo contra `main`)
  protegidas por rol y step-up de contraseña.
- Política de reporte de vulnerabilidades publicada en [`SECURITY.md`](SECURITY.md).

---

## Nota sobre la estabilidad

CENZONTLE está **antes de la 1.0**. Mientras la versión mayor sea `0`, cualquier release
menor puede traer cambios incompatibles: endpoints de la API, formas de los payloads,
esquema de la base de datos, nombres de variables de entorno y contratos de los tipos
compartidos pueden cambiar sin período de deprecación. Fija una versión concreta si
construyes encima y lee el bloque **⚠️ Requiere acción** de cada versión antes de
actualizar.

[Unreleased]: https://github.com/DamballahWedo99/CENZONTLE/commits/main
[0.1.0]: https://github.com/DamballahWedo99/CENZONTLE/tree/main
