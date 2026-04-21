# Third-Party Notices

CENZONTLE depende de software de terceros que requiere atribución y
cumplimiento con términos de licencia específicos. Este archivo documenta
esas dependencias.

## libavoid-js

CENZONTLE utiliza **libavoid-js** (una versión JavaScript/WebAssembly de
**libavoid**) para routing ortogonal de aristas en el creador de diagramas
arquitectónicos (`apps/web/src/components/proyectos/epicas/DiagramViewer.tsx`).

- **Componente**: `libavoid-js`
- **Versión**: 0.4.5
- **Autor upstream**: Michael Wybrow et al. (motor C++ original, Monash
  University / Adaptagrams project)
- **Port a JavaScript/WASM**: Vladyslav Hnatiuk (Aksem)
- **Licencia**: **LGPL-2.1-or-later**
- **Source code**: <https://github.com/Aksem/libavoid-js>
- **Upstream C++ (adaptagrams)**: <https://github.com/Aksem/adaptagrams>

### Cumplimiento LGPL-2.1

- CENZONTLE **usa** libavoid-js como dependencia binaria (WASM) sin
  modificaciones al código fuente.
- El archivo `libavoid.wasm` se sirve desde `apps/web/public/` en su
  forma original publicada en npm.
- El source code de libavoid-js está disponible públicamente en los
  links arriba. Cualquier usuario final puede obtenerlo, modificarlo,
  y recompilar una versión alternativa del `.wasm`.
- No modificamos la biblioteca. Si en algún momento se hacen
  modificaciones al código de libavoid-js o a su build WASM, esas
  modificaciones deberán publicarse bajo LGPL-2.1-or-later y
  enlazarse aquí.

### Artículo de referencia

Wybrow, M., Marriott, K., & Stuckey, P. (2010). *Orthogonal connector
routing*. En Eppstein, D., & Gansner, E. (Eds.), Graph Drawing (pp.
219–231). Springer.
<https://people.eng.unimelb.edu.au/pstuckey/papers/gd09.pdf>

## avoid-nodes-edge

Wrapper idiomático de React Flow sobre `libavoid-js`.

- **Componente**: `avoid-nodes-edge`
- **Versión**: 0.3.1
- **Autor**: Awais Shah
- **Licencia**: MIT con restricción de no-republicación en package
  registries (ver `apps/web/node_modules/avoid-nodes-edge/LICENSE`)
- **Source**: <https://github.com/awaisshah228/react-flow-avoid-nodes-routing>

CENZONTLE usa el package publicado sin modificaciones — la cláusula
de no-republicación no aplica porque no redistribuimos el package
en ningún registry.

## ELK.js (elkjs)

Motor de auto-layout layered usado como pipeline previo al routing.

- **Componente**: `elkjs`
- **Versión**: ^0.11.1
- **Licencia**: EPL-2.0
- **Source**: <https://github.com/kieler/elkjs>

## Actualizaciones

Este archivo debe actualizarse cuando:
- Se agrega una nueva dependencia con licencia copyleft (LGPL, GPL, MPL, EPL).
- Se actualiza una dependencia atribuida aquí a una versión mayor.
- Se modifica el código fuente de alguna dependencia LGPL/GPL.
