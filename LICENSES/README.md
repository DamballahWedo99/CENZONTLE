# Licencias de terceros

CENZONTLE se distribuye bajo [Apache-2.0](../LICENSE). Este directorio guarda los
textos de licencia de dependencias de terceros cuyo cumplimiento exige acompañar
la licencia completa: porque el repositorio redistribuye un binario derivado de
ellas, o porque el texto no existe en un clon del repositorio (`node_modules/` no
está bajo control de versiones).

El inventario de componentes y cómo cumplimos con cada uno vive en
[`../NOTICES.md`](../NOTICES.md), que enlaza de vuelta a los archivos de aquí.
Este directorio guarda solo los textos íntegros. Para el listado exhaustivo de
todas las dependencias instaladas y sus licencias: `pnpm licenses list`.

## Archivos

### `LGPL-2.1.txt` — GNU Lesser General Public License 2.1

Aplica a [`libavoid-js`](https://www.npmjs.com/package/libavoid-js) `0.4.5`
(declara `LGPL-2.1-or-later`), dependencia de `apps/web`.

El repositorio **redistribuye** `apps/web/public/libavoid.wasm`, un artefacto
compilado de esa biblioteca que sí está rastreado en git. Por eso el texto tiene
que viajar con el repositorio y no basta con apuntar a `node_modules/`.

Copiado literal de `apps/web/node_modules/libavoid-js/LICENSE`.

### `LGPL-3.0.txt` — GNU Lesser General Public License 3.0

Aplica a **libvips** y a varias de sus bibliotecas internas (glib, librsvg,
pango, libheif, libexif, fribidi, proxy-libintl), que llegan precompiladas
dentro de los paquetes `@img/sharp-libvips-<plataforma>` de
[`sharp`](https://sharp.pixelplumbing.com/) — dependencia de `apps/api`.

Los paquetes `@img/sharp-libvips-*` **no incluyen archivo de licencia**; solo
declaran `"license": "LGPL-3.0-or-later"` en su `package.json` y listan las
bibliotecas de terceros en su `README.md`. El texto que está aquí es el
publicado por la Free Software Foundation.

La LGPL-3.0 no es un documento autónomo: incorpora por referencia los términos
de la GNU General Public License versión 3, disponible en
<https://www.gnu.org/licenses/gpl-3.0.txt>.

### `EPL-2.0.txt` — Eclipse Public License 2.0

Aplica a [`elkjs`](https://github.com/kieler/elkjs) `0.11.1`, el motor de layout
de grafos que usa `apps/web`. La EPL-2.0 exige que la licencia acompañe a
cualquier distribución del programa.

Copiado literal de `apps/web/node_modules/elkjs/LICENSE.md` (viene en Markdown
desde upstream; el contenido no se modificó).

### `avoid-nodes-edge.txt` — MIT con restricción de redistribución

Aplica a [`avoid-nodes-edge`](https://www.npmjs.com/package/avoid-nodes-edge)
`0.3.1`, dependencia de `apps/web`. Su `package.json` declara
`"license": "SEE LICENSE IN LICENSE"`, así que no hay identificador SPDX que
resuma los términos y el texto completo es la única referencia válida.

Está basado en la MIT, con dos diferencias respecto del texto estándar:

1. La concesión de derechos es más estrecha: permite «use, copy, modify, merge,
   publish, and distribute», pero **omite `sublicense` y `sell`** de la MIT
   original.
2. La cláusula 2 prohíbe republicar el paquete —modificado o no— en cualquier
   registro de paquetes (npm, GitHub Packages, etc.) sin permiso escrito del
   titular.

Usarlo instalándolo desde el npm oficial, como hace CENZONTLE, sí está
permitido: no republicamos el paquete en ningún registro.

Copiado literal de `apps/web/node_modules/avoid-nodes-edge/LICENSE`.
