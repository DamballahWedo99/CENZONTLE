# Third-party licenses

CENZONTLE is distributed under [Apache-2.0](../LICENSE). This directory holds the
license texts of third-party dependencies whose terms require shipping the full
license: either because the repository redistributes a binary derived from them,
or because the text does not exist in a clone of the repository (`node_modules/`
is not under version control).

The inventory of components and how we comply with each one lives in
[`../NOTICES.md`](../NOTICES.md), which links back to the files here. This
directory holds only the full texts. For the exhaustive listing of every
installed dependency and its license: `pnpm licenses list`.

Apache-2.0 is compatible, in one direction, with everything listed below:
CENZONTLE consumes these libraries, it does not fold their code into its own. The
weak copyleft of LGPL-2.1, LGPL-3.0 and EPL-2.0 attaches to *their* files, not to
ours, so the obligations are notice, corresponding source and the ability to
relink — not relicensing CENZONTLE. The exception is `avoid-nodes-edge`, whose
license is not OSI-approved at all; the one thing it forbids is republishing the
package on a registry, which nothing in this monorepo does. See the notes on each
file below.

## Files

### `LGPL-2.1.txt` — GNU Lesser General Public License 2.1

Applies to [`libavoid-js`](https://www.npmjs.com/package/libavoid-js) `0.4.5`
(which declares `LGPL-2.1-or-later`), a dependency of `apps/web`.

The repository **redistributes** `apps/web/public/libavoid.wasm`, a compiled
artifact of that library which really is tracked in git. That is why the text has
to travel with the repository — pointing at `node_modules/` is not enough.

Copied verbatim from `apps/web/node_modules/libavoid-js/LICENSE`, which the npm
package ships and which exists on your machine after `pnpm install`.

### `LGPL-3.0.txt` — GNU Lesser General Public License 3.0

Applies to **libvips** and to several of its internal libraries (glib, librsvg,
pango, libheif, libexif, fribidi, proxy-libintl), which arrive precompiled inside
the `@img/sharp-libvips-<platform>` packages of
[`sharp`](https://sharp.pixelplumbing.com/) — a dependency of `apps/api`.

The `@img/sharp-libvips-*` packages **include no license file**; they only
declare `"license": "LGPL-3.0-or-later"` in their `package.json` and list the
third-party libraries in their `README.md`. The text here is the one published by
the Free Software Foundation.

The LGPL-3.0 is not a standalone document: it incorporates by reference the terms
of the GNU General Public License version 3, available at
<https://www.gnu.org/licenses/gpl-3.0.txt>.

### `EPL-2.0.txt` — Eclipse Public License 2.0

Applies to [`elkjs`](https://github.com/kieler/elkjs) `0.11.1`, the graph layout
engine `apps/web` uses. The EPL-2.0 requires the license to accompany any
distribution of the program.

Copied verbatim from `apps/web/node_modules/elkjs/LICENSE.md` (it comes as
Markdown from upstream; the content was not modified).

### `avoid-nodes-edge.txt` — MIT with a redistribution restriction

Applies to [`avoid-nodes-edge`](https://www.npmjs.com/package/avoid-nodes-edge)
`0.3.1`, a dependency of `apps/web`. Its `package.json` declares
`"license": "SEE LICENSE IN LICENSE"`, so there is no SPDX identifier that sums
up the terms and the full text is the only valid reference.

It is based on MIT, with two differences from the standard text:

1. The grant of rights is narrower: it allows "use, copy, modify, merge,
   publish, and distribute", but **omits `sublicense` and `sell`** from the
   original MIT.
2. Clause 2 forbids republishing the package — modified or not — on any package
   registry (npm, GitHub Packages, etc.) without the holder's written permission.

Using it by installing from the official npm registry, the way CENZONTLE does, is
allowed: we do not republish the package on any registry. All seven
`package.json` files in the monorepo carry `"private": true`, so no `pnpm publish`
can push one by accident.

Copied verbatim from `apps/web/node_modules/avoid-nodes-edge/LICENSE`, which the
npm package ships and which exists on your machine after `pnpm install`.
