# Avisos de terceros (Third-Party Notices)

CENZONTLE se publica bajo [Apache-2.0](LICENSE), pero incorpora software de
terceros con términos propios. Este archivo documenta las dependencias que
**requieren atribución explícita, imponen obligaciones de copyleft, o cuya
licencia no es OSI-aprobada**. No pretende ser un inventario de los ~1900
paquetes del árbol de dependencias (para eso está `pnpm-lock.yaml`): lista lo
que un fork necesita entender antes de redistribuir.

Los textos completos de las licencias que **obligan** a acompañarlos están en
[`LICENSES/`](LICENSES/). Para el inventario exhaustivo de todo lo instalado:
`pnpm licenses list`.

## Índice

| Componente | Licencia | ¿OSI? | Dónde vive |
|---|---|---|---|
| [libavoid-js](#libavoid-js-lgpl-21-or-later) | LGPL-2.1-or-later | Sí | `apps/web` + binario WASM versionado |
| [libvips (vía sharp)](#libvips-vía-sharp-lgpl-30-or-later) | LGPL-3.0-or-later | Sí | Binarios descargados de npm |
| [elkjs](#elkjs-epl-20) | EPL-2.0 | Sí | `apps/web` |
| [pdf.js](#pdfjs-de-mozilla-apache-20) | Apache-2.0 | Sí | Worker versionado en `apps/web/public` |
| [shadcn/ui](#shadcnui-mit) | MIT | Sí | Código copiado en `apps/web/src/components/ui` |
| [avoid-nodes-edge](#avoid-nodes-edge--licencia-no-osi-aprobada) | MIT modificada | **No** | `apps/web` |
| [Imágenes Docker](#imágenes-de-infraestructura-docker-compose) | Varias | **Parcial** | `docker-compose.yml` |
| [Copyleft débil transitivo](#copyleft-débil-y-licencias-duales-transitivas) | MPL-2.0, CC-BY-4.0, duales | Sí | Dependencias indirectas |

Además, la sección [Marcas registradas](#marcas-registradas) cubre los brand
marks de terceros reproducidos en la UI.

---

## libavoid-js (LGPL-2.1-or-later)

Routing ortogonal de aristas con obstacle avoidance en el editor de diagramas
arquitectónicos de épicas
(`apps/web/src/components/proyectos/epicas/DiagramViewer.tsx`). Es un port
JavaScript/WebAssembly de **libavoid**, una de las librerías C++ del proyecto
**Adaptagrams**.

- **Paquete**: `libavoid-js`
- **Versión**: `0.4.5` (exacta; el `package.json` la fija sin rango)
- **Licencia**: **LGPL-2.1-or-later** → [`LICENSES/LGPL-2.1.txt`](LICENSES/LGPL-2.1.txt)
- **Port a JS/WASM**: Vladyslav Hnatiuk (Aksem) — <https://github.com/Aksem/libavoid-js>
- **Upstream C++**: Adaptagrams (Michael Wybrow et al., Immersive Analytics Lab,
  Monash University) — <https://github.com/mjwybrow/adaptagrams>
- **Fork usado para el build WASM**: <https://github.com/Aksem/adaptagrams>

El binario compilado conserva las rutas de sus fuentes
(`./adaptagrams/cola/libavoid/router.cpp`, `orthogonal.cpp`, `makepath.cpp`, …),
lo que confirma la procedencia.

### Cumplimiento LGPL-2.1 — leer antes de forkear

**CENZONTLE redistribuye el binario compilado.** `apps/web/public/libavoid.wasm`
(485 460 bytes) está **versionado en git**, no es un artefacto de build ignorado.
Cualquiera que clone el repo recibe una copia de una obra LGPL en forma de objeto,
así que aplican las obligaciones de la sección 6 de la LGPL-2.1, no solo las de
uso interno.

Cómo se cumplen hoy:

- **Sin modificaciones.** El `.wasm` es idéntico al publicado en npm dentro de
  `libavoid-js@0.4.5`. `apps/web/scripts/copy-libavoid-wasm.mjs` corre en el
  `postinstall` del workspace `web` y lo copia tal cual desde
  `node_modules/libavoid-js/dist/`, de modo que cada `pnpm install` lo
  resincroniza con la versión que resolvió el lockfile.
- **Fuente correspondiente disponible.** El código fuente completo y las
  instrucciones de build (Emscripten + WebIDL Bindings, vía Docker) están
  públicos en los repos enlazados arriba.
- **Relinking posible.** La versión es exacta y el WASM se carga en runtime desde
  la ruta estática `/libavoid.wasm`. Quien quiera usar una build propia de
  libavoid solo tiene que reemplazar ese archivo: no hace falta recompilar
  CENZONTLE.
- **Aviso de licencia.** El texto íntegro de la LGPL-2.1 viaja en el paquete npm
  (`apps/web/node_modules/libavoid-js/LICENSE` — pnpm no eleva esta dependencia
  a la raíz) y está reproducido byte a byte en
  [`LICENSES/LGPL-2.1.txt`](LICENSES/LGPL-2.1.txt).

**Si modificas libavoid-js o su build WASM**, esas modificaciones deben
publicarse bajo LGPL-2.1-or-later y enlazarse desde este archivo.

### Artículo de referencia

Wybrow, M., Marriott, K., & Stuckey, P. (2010). *Orthogonal connector routing*.
En Eppstein, D., & Gansner, E. (Eds.), Graph Drawing (pp. 219–231). Springer.
<https://people.eng.unimelb.edu.au/pstuckey/papers/gd09.pdf>

---

## libvips (vía sharp) (LGPL-3.0-or-later)

`sharp` procesa imágenes en el backend antes de mandarlas a Claude como bloques
multimodales
(`apps/api/src/modules/factory/agent-tools/document-readers/image-reader.ts`:
reescalado a 1568 px, re-encode a JPEG y tope de 50 MP contra decompression
bombs).

**`sharp` en sí es Apache-2.0, pero no es el software que hace el trabajo.**
sharp es un wrapper: la implementación real está en **libvips**, que se instala
como binario precompilado bajo **LGPL-3.0-or-later**. La licencia del wrapper no
te exime de las obligaciones de la librería que embebe.

En el árbol de dependencias conviven **dos** cadenas sharp → libvips:

| Origen | sharp | Paquete `@img/sharp-libvips-*` | libvips |
|---|---|---|---|
| `apps/api` (dependencia directa) | `0.33.5` | `1.0.4` (`1.0.5` en `linux-arm`) | `8.15.3` |
| `next@16.1.1` (optionalDependency, optimización de imágenes) | `0.34.5` | `1.2.4` | `8.17.3` |

- **Wrapper**: `sharp` — Apache-2.0 — Lovell Fuller — <https://github.com/lovell/sharp>
- **Binarios**: `@img/sharp-libvips-<plataforma>` — **LGPL-3.0-or-later**
  (campo `license` del paquete) → [`LICENSES/LGPL-3.0.txt`](LICENSES/LGPL-3.0.txt)
- **libvips upstream**: <https://github.com/libvips/libvips>
- **Empaquetado de los binarios**: <https://github.com/lovell/sharp-libvips>

Cada paquete `@img/sharp-libvips-*` trae una librería nativa
(`lib/libvips-cpp.42.dylib` en macOS ARM, `.so` en Linux) con libvips **y sus
dependencias enlazadas estáticamente**. Varias también son LGPLv3: `glib`,
`pango`, `librsvg`, `libheif`, `libexif`, `fribidi` y `proxy-libintl`. El resto
del bundle es MPL-2.0 (`cairo`), MIT, BSD y licencias tipo libpng/libtiff/zlib.
La tabla completa está en el `README.md` de cada paquete
(`node_modules/.pnpm/@img+sharp-libvips-<plataforma>@<versión>/node_modules/@img/sharp-libvips-<plataforma>/README.md`).

### Qué significa esto en la práctica

- **El repo no vendorea nada de libvips.** No hay un solo binario de libvips
  versionado en git; npm los descarga en install. Clonar CENZONTLE **no** te
  convierte en redistribuidor de código LGPL-3.0.
- **Publicar una imagen Docker o un tarball de deploy sí lo hace.** El artefacto
  incluiría `libvips-cpp.*`, así que aplican las obligaciones de la LGPL-3.0
  (aviso, fuente correspondiente y posibilidad de relinking). Ese es el escenario
  que un fork debe planear.
- **Se puede usar la libvips del sistema.** sharp busca una instalación global
  compatible y puede compilarse contra ella en vez de bajar el prebuilt. El
  comportamiento se controla con las variables de entorno
  `SHARP_FORCE_GLOBAL_LIBVIPS` y `SHARP_IGNORE_GLOBAL_LIBVIPS`
  (`apps/api/node_modules/sharp/lib/libvips.js`). Enlazar dinámicamente contra una libvips
  del sistema es la vía más limpia para cumplir la LGPL, porque el relinking es
  trivial para el usuario final.

---

## elkjs (EPL-2.0)

Auto-layout layered de los diagramas: corre como paso previo al routing de
libavoid
(`apps/web/src/components/proyectos/epicas/diagram-layout/elk-layout.ts` y
`useGroupedLayout.ts`).

- **Paquete**: `elkjs`
- **Versión**: `0.11.1` (resuelta en `pnpm-lock.yaml`; el `package.json` declara `^0.11.1`)
- **Licencia**: **EPL-2.0** → [`LICENSES/EPL-2.0.txt`](LICENSES/EPL-2.0.txt)
- **Autor**: Ulf Rüegg / proyecto KIELER — <https://github.com/kieler/elkjs>
- **Upstream**: Eclipse Layout Kernel (ELK) — <https://www.eclipse.org/elk/>

elkjs es la parte de layout de ELK (escrita en Java) llevada al mundo JavaScript.
El algoritmo layered se basa en las ideas de Sugiyama et al.

La EPL-2.0 es copyleft **débil y por archivo**: obliga a liberar bajo EPL los
archivos de elkjs que modifiques, pero no contamina el código que solo lo
consume. CENZONTLE usa el paquete publicado sin modificaciones; el
`elk.bundled.js` se importa desde `node_modules` y no se versiona ninguna copia
en el repo.

---

## pdf.js de Mozilla (Apache-2.0)

Visor de PDFs de documentos
(`apps/web/src/components/documents/PdfViewer.tsx`).

- **Componente**: `pdf.js` (paquete npm `pdfjs-dist`)
- **Versión**: `5.4.296`
- **Licencia**: **Apache-2.0**
- **Copyright**: Mozilla Foundation — <https://github.com/mozilla/pdf.js>

**Hay una copia del worker versionada en git**: `apps/web/public/pdf.worker.min.mjs`
(1 046 214 bytes). No es un artefacto de build ignorado — se sirve como asset
estático y `PdfViewer.tsx` lo registra con
`pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'`.

Verificación de la versión: el encabezado del archivo declara
`pdfjsVersion = 5.4.296` y el bundle lleva incrustada la misma constante que usa
para validar la compatibilidad con la API (`"5.4.296"`). La copia es idéntica
byte a byte (SHA-256 `dbcae78a…`) a `pdfjs-dist/build/pdf.worker.min.mjs` de la
versión `5.4.296` del lockfile: no está modificada. El encabezado conserva
íntegro el aviso de licencia (`@licstart`, «Copyright 2024 Mozilla Foundation»,
Apache-2.0), que **no debe removerse al minificar ni al reemplazar el worker**.

`pdfjs-dist@5.4.296` entra al árbol por dos caminos independientes que
convergen en la misma versión:

- `react-pdf@10.4.1` (MIT) en `apps/web`
- `pdf-parse@2.4.5` (Apache-2.0) en `apps/api`

La copia en `public/` debe actualizarse a mano cuando suba `pdfjs-dist`: a
diferencia de `libavoid.wasm`, **no hay script de postinstall que la
resincronice**. Un desfase entre el worker versionado y la versión de la API hace
que pdf.js falle en runtime con un error de versión.

---

## shadcn/ui (MIT)

`apps/web/components.json` declara la configuración del CLI de shadcn/ui:
estilo `new-york`, `baseColor` `neutral`, variables CSS activadas, RSC activado
y `lucide` como librería de iconos.

- **Proyecto**: shadcn/ui — <https://github.com/shadcn-ui/ui>
- **Licencia**: **MIT**

shadcn/ui **no es una dependencia de npm**: su modelo es copiar el código fuente
al repo para que quede bajo tu control. Por eso
`apps/web/src/components/ui/` contiene **24 componentes versionados en git**
(los 24 archivos `.tsx` del directorio están rastreados):

- **18 conservan el formato original del CLI** (comillas dobles, sin comentarios
  del proyecto): `avatar`, `badge`, `button`, `calendar`, `checkbox`, `dialog`,
  `dropdown-menu`, `input`, `label`, `popover`, `select`, `separator`, `sheet`,
  `sidebar`, `skeleton`, `table`, `tabs`, `tooltip`.
- **6 fueron escritos o adaptados en el repo** sobre el mismo patrón (primitiva
  de Radix + helper `cn`), con el estilo del proyecto y documentación propia:
  `collapsible`, `confirm-dialog`, `date-picker`, `round-checkbox`, `switch`,
  `type-to-confirm-dialog`.

El aviso de copyright y el permiso de la licencia MIT de shadcn/ui aplican al
código derivado de los primeros. La MIT no obliga a marcar cada archivo, pero
esta sección cumple el requisito de conservar el aviso.

### Radix UI y utilidades asociadas

Los componentes copiados no funcionan solos: se apoyan en primitivas sin estilo
y utilidades que **sí** son dependencias de npm. Versiones exactas del lockfile:

- **Radix UI** — **MIT** — <https://github.com/radix-ui/primitives>
  - `radix-ui` `1.4.3` (paquete paraguas)
  - `@radix-ui/react-avatar` `1.1.11`, `react-checkbox` `1.3.3`,
    `react-collapsible` `1.1.12`, `react-dialog` `1.1.15`,
    `react-dropdown-menu` `2.1.16`, `react-icons` `1.3.2`,
    `react-popover` `1.1.15`, `react-select` `2.2.6`, `react-separator` `1.1.8`,
    `react-slot` `1.2.4`, `react-switch` `1.2.6`, `react-tabs` `1.1.13`,
    `react-tooltip` `1.2.8`
- `lucide-react` `0.562.0` — **ISC** — <https://github.com/lucide-icons/lucide>
- `class-variance-authority` `0.7.1` — **Apache-2.0**
- `clsx` `2.1.1` — **MIT**
- `tailwind-merge` `3.5.0` — **MIT**

Todas son licencias permisivas: atribución y nada más.

---

## avoid-nodes-edge — licencia NO OSI-aprobada

> [!WARNING]
> **Si forkeas CENZONTLE, lee esta sección completa.** Es la única dependencia
> del repo cuya licencia **no** es open source según la definición de la OSI.

Wrapper idiomático de React Flow / XYFlow sobre `libavoid-js`. Expone
`AvoidNodesEdge` y el hook `useAvoidNodesRouterFromWorker`, que corre el router
de libavoid en un Web Worker (`DiagramViewer.tsx`).

- **Paquete**: `avoid-nodes-edge`
- **Versión**: `0.3.1` (exacta; el `package.json` la fija sin rango)
- **Autor**: Awais Shah (awaisshah228) — copyright 2024-2026
- **Fuente**: <https://github.com/awaisshah228/react-flow-avoid-nodes-routing>
- **Licencia**: texto propio titulado *«MIT License — No Redistribution on
  Package Registries»*. El `package.json` declara `SEE LICENSE IN LICENSE`, no
  un identificador SPDX, precisamente porque **no existe un SPDX que la
  describa** → [`LICENSES/avoid-nodes-edge.txt`](LICENSES/avoid-nodes-edge.txt)

### Qué permite y qué prohíbe

Parte de la MIT, pero con dos diferencias respecto del texto estándar: la
concesión de derechos es **más estrecha** (omite `sublicense` y `sell`) y agrega
una cláusula que **rompe el criterio de "libre redistribución"**. Por eso **no es
OSI-aprobada** y no cuenta como software libre ni open source. Según su texto:

- **Sí puedes**: usar, copiar, modificar, fusionar (`merge`), publicar y
  distribuir el software dentro de tu propio proyecto, instalándolo desde el
  paquete oficial de npm.
- **Sí puedes**: forkear el repo para uso personal, contribuciones o
  modificaciones internas no publicadas.
- **NO se concede** el derecho a sublicenciar ni a vender el software, a
  diferencia de la MIT estándar.
- **NO puedes**: republicar, redistribuir ni resubir el software —completo o
  parcial, modificado o no— **como paquete en ningún registry**: npm, yarn,
  pnpm, GitHub Packages o cualquier otra plataforma de distribución de paquetes,
  **salvo con permiso escrito previo del titular del copyright**. La restricción
  alcanza a forks, copias y obras derivadas.
- El texto advierte que violar esa cláusula constituye infracción de copyright y
  puede derivar en DMCA takedown, disputa en npm y/o acción legal.

### Cómo lo cumple CENZONTLE

CENZONTLE usa el paquete publicado **sin modificaciones** y no vendorea su
código: llega vía `pnpm install` desde el npm oficial. Ninguno de los siete
`package.json` del monorepo se publica a ningún registry (todos llevan
`"private": true`), de modo que la cláusula 2 nunca se activa.

### Reglas para un fork

1. **No publiques a npm** ningún paquete de este monorepo que arrastre
   `avoid-nodes-edge`, ni siquiera bajo otro nombre o scope. Quitar el
   `"private": true` sin quitar antes esta dependencia sería una infracción,
   a menos que consigas permiso escrito del titular.
2. **No copies el código** de `avoid-nodes-edge` dentro de tu repo para después
   publicarlo. La restricción cubre forks y obras «sustancialmente similares».
3. **Distribuir tu aplicación está bien** (Docker, SaaS, binario, repo público):
   lo prohibido es la republicación *como paquete en un registry*, no el uso.
4. Si tu proyecto necesita una cadena 100 % OSI, sustituye esta capa: es un
   wrapper delgado, y `libavoid-js` (LGPL-2.1) sigue siendo usable directamente.

---

## Marcas registradas

`apps/web/src/components/icons/` contiene dos componentes que reproducen brand
marks de terceros para identificar integraciones en la UI:

| Archivo | Marca | Titular |
|---|---|---|
| `LinearIcon.tsx` | Logo de Linear | Linear Orbit, Inc. |
| `AnthropicIcon.tsx` | Logo de Anthropic | Anthropic PBC |

Ambos componentes documentan en sus comentarios que el `path` SVG proviene de
**simple-icons** (<https://simple-icons.org>), proyecto que publica los datos de
sus iconos bajo **CC0-1.0** (dominio público).

**CC0 cubre el copyright del archivo SVG, no los derechos de marca.** Son cosas
distintas y hay que tratarlas por separado:

- «Linear» y su logotipo son marcas de Linear Orbit, Inc.
- «Anthropic», «Claude» y sus logotipos son marcas de Anthropic PBC.
- Los demás nombres de producto citados en el repo (PostgreSQL, Redis, MinIO,
  Auth0, GitHub, Docker, Next.js, NestJS…) son marcas de sus respectivos
  titulares.

En CENZONTLE estas marcas se usan **exclusivamente de forma nominativa**: para
identificar el servicio de terceros con el que se integra cada funcionalidad, de
modo que la persona usuaria reconozca a dónde apunta un botón o una sección. Este
uso **no implica afiliación, patrocinio, aval ni respaldo** de Linear Orbit, Inc.
ni de Anthropic PBC hacia CENZONTLE ni hacia sus autores.

La licencia Apache-2.0 del proyecto **no otorga derechos sobre marcas** (ver su
sección 6). Si forkeas o redistribuyes CENZONTLE bajo otro nombre, revisa los
lineamientos de marca de cada titular antes de conservar sus logos: el uso
nominativo tiene límites y las políticas cambian.

---

## Imágenes de infraestructura (docker-compose)

`docker-compose.yml` levanta el stack de desarrollo local. Las imágenes **no se
redistribuyen** desde este repo —el compose solo las referencia y Docker las baja
de su registry— pero sus licencias importan si las incorporas a un despliegue
propio.

| Servicio | Imagen | Puertos | Licencia | ¿OSI-aprobada? |
|---|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432 | PostgreSQL License | Sí |
| `redis` | `redis:7-alpine` | 6379 | Depende de la versión — ver abajo | **Depende** |
| `minio` | `minio/minio:latest` | 9000, 9001 | AGPL-3.0 | Sí, pero copyleft fuerte de red |
| `minio-init` | `minio/mc:latest` | — | AGPL-3.0 | Sí, pero copyleft fuerte de red |

### PostgreSQL

La PostgreSQL License es permisiva (estilo BSD/MIT) y OSI-aprobada. La variante
`-alpine` añade el sistema base de Alpine Linux: `musl` libc (MIT), BusyBox
(GPL-2.0-only) y otros paquetes con licencias propias. Distribuir la imagen
completa implica cumplir también con esas.

### Redis — cuidado, la licencia cambió

> [!IMPORTANT]
> **Redis dejó de ser open source a partir de la versión 7.4.** No asumas que
> «Redis es BSD» por lo que recordabas de hace unos años.

Historial relevante:

- **Hasta 7.2.x** — BSD-3-Clause, OSI-aprobada.
- **Desde 7.4 (2024)** — doble licencia **RSALv2 / SSPLv1**. Ninguna de las dos
  es OSI-aprobada: son licencias *source-available* que restringen ofrecer Redis
  como servicio gestionado a terceros.
- **Desde 8.0 (2025)** — se agregó **AGPLv3** como tercera opción, que sí es
  OSI-aprobada. La 8.x se puede tomar bajo AGPLv3.

El tag `7-alpine` sigue la línea 7.x, que hoy resuelve a versiones **7.4+**, es
decir **RSALv2/SSPLv1**. Si necesitas una cadena OSI limpia tienes tres salidas:
fijar un tag de la línea 7.2 (BSD, pero sin soporte), pasar a Redis 8.x tomándolo
bajo AGPLv3, o migrar a un fork BSD como **Valkey** (proyecto de la Linux
Foundation, compatible a nivel de protocolo).

### MinIO

Tanto el servidor (`minio/minio`) como el cliente (`minio/mc`, usado por
`minio-init` para crear el bucket `cenzontle-documents`) están bajo
**AGPL-3.0**. Es OSI-aprobada, pero es el copyleft más fuerte: su sección 13
extiende las obligaciones a la interacción por red, no solo a la distribución
del binario.

Ejecutar la imagen oficial **sin modificar** como servicio separado, al que
CENZONTLE accede por la API S3, no obliga a liberar el código de CENZONTLE:
la AGPL de MinIO cubre a MinIO. Pero si **modificas** MinIO y lo ofreces por red,
debes publicar tus modificaciones bajo AGPL-3.0. Si tu producto empaqueta o
distribuye MinIO, consulta a tu área legal antes de asumir nada.

### Los tags flotantes son el problema de fondo

Ninguna imagen está fijada a una versión exacta ni a un digest: `16-alpine`,
`7-alpine` y `latest` son tags móviles. Consecuencias:

- **La licencia efectiva puede cambiar sin que cambie una sola línea del repo.**
  Un `docker compose pull` puede traer una versión bajo términos distintos. Esto
  ya pasó con Redis 7.2 → 7.4 y con MinIO (Apache-2.0 → AGPL-3.0 en 2021).
- **`latest` no es reproducible.** Dos personas que levanten el stack con semanas
  de diferencia pueden correr versiones distintas de MinIO.

Para producción, fija digests (`imagen@sha256:…`) y reaudita la licencia en cada
bump. `docker-compose.yml` es el stack de desarrollo local —las credenciales son
`cenzontle_dev` en texto plano— y no está pensado para desplegarse tal cual.

---

## Copyleft débil y licencias duales transitivas

Ninguna de las de abajo es dependencia directa del repo: llegan arrastradas por
otras. No exigen acompañar el texto de su licencia en un clon (viven en
`node_modules/`, que no está versionado) ni condicionan el código de CENZONTLE,
pero **sí** entran en la categoría que `CONTRIBUTING.md` y la plantilla de PR
marcan como reportable (MPL), así que quedan documentadas para que una auditoría
no las descubra por sorpresa.

| Paquete | Versión | Licencia | Llega vía | Cuándo importa |
|---|---|---|---|---|
| `lightningcss` | `1.32.0` | MPL-2.0 | `@tailwindcss/postcss` → `@tailwindcss/node`; `vitest` → `vite` | Build y dev |
| `axe-core` | `4.11.1` | MPL-2.0 | `eslint-config-next` → `eslint-plugin-jsx-a11y` | Solo lint |
| `caniuse-lite` | `1.0.30001781` | CC-BY-4.0 | `next`, `browserslist` | Build |
| `dompurify` | `3.3.3` | MPL-2.0 **OR** Apache-2.0 | `jspdf`, `streamdown` → `mermaid` | Runtime web |
| `jszip` | `3.10.1` | MIT **OR** GPL-3.0-or-later | `docx`, `exceljs` | Runtime web |

Qué implica cada caso:

- **MPL-2.0** es copyleft **por archivo**, igual que la EPL-2.0: si modificas un
  archivo fuente de `lightningcss` o `axe-core`, esa versión modificada se
  publica bajo MPL-2.0. Consumir el paquete sin tocarlo no contagia nada.
- **Licencias duales**: `dompurify` y `jszip` te dejan elegir. CENZONTLE toma
  **Apache-2.0** para `dompurify` y **MIT** para `jszip`, ambas permisivas. La
  opción GPL-3.0 de `jszip` **no** aplica salvo que alguien la elija
  explícitamente, cosa que este repo no hace.
- **CC-BY-4.0** (`caniuse-lite`) es una licencia de datos, no de código, y solo
  exige atribución. Esta línea la cumple.

---

## Cuándo actualizar este archivo

Actualiza `NOTICES.md` cuando:

- **Se agregue una dependencia con licencia copyleft** (LGPL, GPL, AGPL, MPL,
  EPL, CDDL) o **source-available / no OSI-aprobada** (SSPL, BSL, RSAL, Elastic
  License, o textos a medida como el de `avoid-nodes-edge`).
- **Se versione en git un binario o un asset de terceros**, como ya pasa con
  `apps/web/public/libavoid.wasm` y `apps/web/public/pdf.worker.min.mjs`.
  Versionar el artefacto convierte el repo en redistribuidor y activa
  obligaciones que el uso vía `node_modules` no activa.
- **Se copie código de terceros al repo** en vez de consumirlo como paquete
  (el modelo de shadcn/ui), aunque la licencia sea permisiva.
- **Cambie la versión de algo listado aquí.** Las versiones de este archivo son
  exactas y salen de `pnpm-lock.yaml`, no del rango semver del `package.json`:
  un `^` puede mover la versión real sin tocar el `package.json`.
- **Cambie la licencia de una dependencia** entre versiones. Pasa más de lo que
  parece: Redis en 7.4, MinIO en 2021, Terraform, Elasticsearch. Revísalo en cada
  bump mayor y en cada PR de Dependabot que toque las dependencias de arriba.
- **Se modifique el código fuente de una dependencia LGPL/GPL/EPL/AGPL.** En ese
  caso hay que publicar las modificaciones bajo la misma licencia y enlazarlas
  desde aquí.
- **Se reproduzca un brand mark nuevo** en la UI: se agrega a la tabla de
  [Marcas registradas](#marcas-registradas).
- **Se cambie una imagen de `docker-compose.yml`** o se fijen sus digests.

Documentos relacionados: [`LICENSE`](LICENSE) (licencia del proyecto),
[`SECURITY.md`](SECURITY.md) (reporte de vulnerabilidades),
[`CONTRIBUTING.md`](CONTRIBUTING.md) (flujo de contribución).
