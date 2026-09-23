# Third-Party Notices

CENZONTLE is released under [Apache-2.0](LICENSE), but it ships third-party
software with terms of its own. This file documents the dependencies that
**require explicit attribution, impose copyleft obligations, or carry a license
that is not OSI-approved**. It is not an inventory of the ~1900 packages in the
dependency tree — `pnpm-lock.yaml` is that — it lists what a fork needs to
understand before redistributing.

The full texts of the licenses that **require** you to ship them along live in
[`LICENSES/`](LICENSES/). For the exhaustive inventory of everything installed:
`pnpm licenses list`.

## Index

| Component | License | OSI? | Where it lives |
|---|---|---|---|
| [libavoid-js](#libavoid-js-lgpl-21-or-later) | LGPL-2.1-or-later | Yes | `apps/web` + a WASM binary tracked in git |
| [libvips (via sharp)](#libvips-via-sharp-lgpl-30-or-later) | LGPL-3.0-or-later | Yes | Binaries downloaded from npm |
| [elkjs](#elkjs-epl-20) | EPL-2.0 | Yes | `apps/web` |
| [pdf.js](#pdfjs-from-mozilla-apache-20) | Apache-2.0 | Yes | Worker tracked in `apps/web/public` |
| [shadcn/ui](#shadcnui-mit) | MIT | Yes | Source copied into `apps/web/src/components/ui` |
| [avoid-nodes-edge](#avoid-nodes-edge--not-an-osi-approved-license) | Modified MIT | **No** | `apps/web` |
| [Docker images](#infrastructure-images-docker-compose) | Various | **Partial** | `docker-compose.yml` |
| [Transitive weak copyleft](#weak-copyleft-and-transitive-dual-licenses) | MPL-2.0, CC-BY-4.0, dual | Yes | Indirect dependencies |

On top of that, the [Trademarks](#trademarks) section covers the third-party
brand marks reproduced in the UI.

---

## libavoid-js (LGPL-2.1-or-later)

Orthogonal edge routing with obstacle avoidance in the architecture diagram
editor for epics
(`apps/web/src/components/proyectos/epicas/DiagramViewer.tsx`). It is a
JavaScript/WebAssembly port of **libavoid**, one of the C++ libraries of the
**Adaptagrams** project.

- **Package**: `libavoid-js`
- **Version**: `0.4.5` (exact; `package.json` pins it with no range)
- **License**: **LGPL-2.1-or-later** → [`LICENSES/LGPL-2.1.txt`](LICENSES/LGPL-2.1.txt)
- **JS/WASM port**: Vladyslav Hnatiuk (Aksem) — <https://github.com/Aksem/libavoid-js>
- **Upstream C++**: Adaptagrams (Michael Wybrow et al., Immersive Analytics Lab,
  Monash University) — <https://github.com/mjwybrow/adaptagrams>
- **Fork used for the WASM build**: <https://github.com/Aksem/adaptagrams>

The compiled binary keeps the paths of its sources
(`./adaptagrams/cola/libavoid/router.cpp`, `orthogonal.cpp`, `makepath.cpp`, …),
which confirms its provenance.

### LGPL-2.1 compliance — read before you fork

**CENZONTLE redistributes the compiled binary.** `apps/web/public/libavoid.wasm`
(485 460 bytes) is **tracked in git**; it is not an ignored build artifact.
Anyone who clones the repo receives a copy of an LGPL work in object form, so the
obligations of section 6 of the LGPL-2.1 apply, not just the ones for internal
use.

How they are met today:

- **No modifications.** The `.wasm` is identical to the one published on npm
  inside `libavoid-js@0.4.5`. `apps/web/scripts/copy-libavoid-wasm.mjs` runs in
  the `postinstall` of the `web` workspace and copies it as-is from
  `node_modules/libavoid-js/dist/`, so every `pnpm install` resyncs it with the
  version the lockfile resolved.
- **Corresponding source available.** The full source and the build instructions
  (Emscripten + WebIDL Bindings, via Docker) are public in the repositories
  linked above.
- **Relinking is possible.** The version is exact and the WASM is loaded at
  runtime from the static path `/libavoid.wasm`. Anyone who wants to use their
  own libavoid build only has to replace that file — you do not have to
  recompile CENZONTLE.
- **License notice.** The full text of the LGPL-2.1 is reproduced byte for byte
  in [`LICENSES/LGPL-2.1.txt`](LICENSES/LGPL-2.1.txt), which is tracked in git
  and readable in a fresh clone. The same text also ships inside the npm package
  itself, at `apps/web/node_modules/libavoid-js/LICENSE` after you run
  `pnpm install` — pnpm does not hoist this dependency to the root — but that
  path exists only once dependencies are installed, so the copy under
  `LICENSES/` is the one that travels with the repository.

**If you modify libavoid-js or its WASM build**, those modifications have to be
published under LGPL-2.1-or-later and linked from this file.

### Reference paper

Wybrow, M., Marriott, K., & Stuckey, P. (2010). *Orthogonal connector routing*.
In Eppstein, D., & Gansner, E. (Eds.), Graph Drawing (pp. 219–231). Springer.
<https://people.eng.unimelb.edu.au/pstuckey/papers/gd09.pdf>

---

## libvips (via sharp) (LGPL-3.0-or-later)

`sharp` processes images on the backend before sending them to Claude as
multimodal blocks
(`apps/api/src/modules/factory/agent-tools/document-readers/image-reader.ts`:
downscale to 1568 px, re-encode to JPEG and a 50 MP ceiling against decompression
bombs).

**`sharp` itself is Apache-2.0, but it is not the software doing the work.**
sharp is a wrapper: the real implementation is **libvips**, which is installed as
a precompiled binary under **LGPL-3.0-or-later**. The wrapper's license does not
exempt you from the obligations of the library it embeds.

Two sharp → libvips chains coexist in the dependency tree:

| Origin | sharp | `@img/sharp-libvips-*` package | libvips |
|---|---|---|---|
| `apps/api` (direct dependency) | `0.33.5` | `1.0.4` (`1.0.5` on `linux-arm`) | `8.15.3` |
| `next@16.1.1` (optionalDependency, image optimization) | `0.34.5` | `1.2.4` | `8.17.3` |

- **Wrapper**: `sharp` — Apache-2.0 — Lovell Fuller — <https://github.com/lovell/sharp>
- **Binaries**: `@img/sharp-libvips-<platform>` — **LGPL-3.0-or-later**
  (the package's `license` field) → [`LICENSES/LGPL-3.0.txt`](LICENSES/LGPL-3.0.txt)
- **libvips upstream**: <https://github.com/libvips/libvips>
- **Binary packaging**: <https://github.com/lovell/sharp-libvips>

Each `@img/sharp-libvips-*` package carries a native library
(`lib/libvips-cpp.42.dylib` on macOS ARM, `.so` on Linux) with libvips **and its
dependencies statically linked**. Several of those are LGPLv3 too: `glib`,
`pango`, `librsvg`, `libheif`, `libexif`, `fribidi` and `proxy-libintl`. The rest
of the bundle is MPL-2.0 (`cairo`), MIT, BSD and libpng/libtiff/zlib-style
licenses. The full table is in each package's `README.md`
(`node_modules/.pnpm/@img+sharp-libvips-<platform>@<version>/node_modules/@img/sharp-libvips-<platform>/README.md`,
available after `pnpm install`).

### What this means in practice

- **The repo vendors nothing from libvips.** There is not one libvips binary
  tracked in git; npm downloads them at install time. Cloning CENZONTLE does
  **not** make you a redistributor of LGPL-3.0 code.
- **Publishing a Docker image or a deploy tarball does.** The artifact would
  include `libvips-cpp.*`, so the LGPL-3.0 obligations apply (notice,
  corresponding source and the ability to relink). That is the scenario a fork
  has to plan for.
- **You can use the system libvips.** sharp looks for a compatible global
  installation and can be compiled against it instead of downloading the
  prebuilt binary. The behavior is controlled by the environment variables
  `SHARP_FORCE_GLOBAL_LIBVIPS` and `SHARP_IGNORE_GLOBAL_LIBVIPS`
  (`apps/api/node_modules/sharp/lib/libvips.js`). Linking dynamically against a
  system libvips is the cleanest way to comply with the LGPL, because relinking
  is then trivial for the end user.

---

## elkjs (EPL-2.0)

Layered auto-layout of the diagrams: it runs as the step before libavoid's
routing
(`apps/web/src/components/proyectos/epicas/diagram-layout/elk-layout.ts` and
`useGroupedLayout.ts`).

- **Package**: `elkjs`
- **Version**: `0.11.1` (resolved in `pnpm-lock.yaml`; `package.json` declares `^0.11.1`)
- **License**: **EPL-2.0** → [`LICENSES/EPL-2.0.txt`](LICENSES/EPL-2.0.txt)
- **Author**: Ulf Rüegg / the KIELER project — <https://github.com/kieler/elkjs>
- **Upstream**: Eclipse Layout Kernel (ELK) — <https://www.eclipse.org/elk/>

elkjs is the layout part of ELK (written in Java) carried over to the JavaScript
world. The layered algorithm is based on the ideas of Sugiyama et al.

The EPL-2.0 is **weak, per-file** copyleft: it requires you to release under EPL
the elkjs files you modify, but it does not contaminate code that merely consumes
it. CENZONTLE uses the published package unmodified; `elk.bundled.js` is imported
from `node_modules` and no copy is tracked in the repo.

---

## pdf.js from Mozilla (Apache-2.0)

PDF viewer for documents
(`apps/web/src/components/documents/PdfViewer.tsx`).

- **Component**: `pdf.js` (npm package `pdfjs-dist`)
- **Version**: `5.4.296`
- **License**: **Apache-2.0**
- **Copyright**: Mozilla Foundation — <https://github.com/mozilla/pdf.js>

**A copy of the worker is tracked in git**: `apps/web/public/pdf.worker.min.mjs`
(1 046 214 bytes). It is not an ignored build artifact — it is served as a static
asset and `PdfViewer.tsx` registers it with
`pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'`.

Version check: the file header declares `pdfjsVersion = 5.4.296` and the bundle
embeds the same constant it uses to validate API compatibility (`"5.4.296"`). The
copy is identical byte for byte (SHA-256 `dbcae78a…`) to
`pdfjs-dist/build/pdf.worker.min.mjs` from version `5.4.296` of the lockfile, so
it is unmodified. The header keeps the license notice intact (`@licstart`,
"Copyright 2024 Mozilla Foundation", Apache-2.0), and it **must not be stripped
when minifying or when replacing the worker**.

`pdfjs-dist@5.4.296` enters the tree along two independent paths that converge on
the same version:

- `react-pdf@10.4.1` (MIT) in `apps/web`
- `pdf-parse@2.4.5` (Apache-2.0) in `apps/api`

The copy in `public/` has to be updated by hand when `pdfjs-dist` moves: unlike
`libavoid.wasm`, **no postinstall script resyncs it**. A mismatch between the
tracked worker and the API version makes pdf.js fail at runtime with a version
error.

---

## shadcn/ui (MIT)

`apps/web/components.json` declares the shadcn/ui CLI configuration: `new-york`
style, `neutral` `baseColor`, CSS variables on, RSC on and `lucide` as the icon
library.

- **Project**: shadcn/ui — <https://github.com/shadcn-ui/ui>
- **License**: **MIT**

shadcn/ui **is not an npm dependency**: its model is to copy the source into your
repo so it stays under your control. That is why
`apps/web/src/components/ui/` holds **24 components tracked in git** (all 24
`.tsx` files in the directory are tracked):

- **18 keep the CLI's original formatting** (double quotes, no project comments):
  `avatar`, `badge`, `button`, `calendar`, `checkbox`, `dialog`,
  `dropdown-menu`, `input`, `label`, `popover`, `select`, `separator`, `sheet`,
  `sidebar`, `skeleton`, `table`, `tabs`, `tooltip`.
- **6 were written or adapted in this repo** on the same pattern (a Radix
  primitive plus the `cn` helper), in the project's style and with their own
  documentation: `collapsible`, `confirm-dialog`, `date-picker`,
  `round-checkbox`, `switch`, `type-to-confirm-dialog`.

The shadcn/ui MIT copyright notice and permission apply to the code derived from
the first group. MIT does not require marking every file, but this section
satisfies the requirement to preserve the notice.

### Radix UI and related utilities

The copied components do not work on their own: they lean on unstyled primitives
and utilities that **are** npm dependencies. Exact versions from the lockfile:

- **Radix UI** — **MIT** — <https://github.com/radix-ui/primitives>
  - `radix-ui` `1.4.3` (umbrella package)
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

All permissive licenses: attribution and nothing else.

---

## avoid-nodes-edge — not an OSI-approved license

> [!WARNING]
> **If you fork CENZONTLE, read this section in full.** It is the only dependency
> in the repo whose license is **not** open source under the OSI definition.

An idiomatic React Flow / XYFlow wrapper around `libavoid-js`. It exposes
`AvoidNodesEdge` and the `useAvoidNodesRouterFromWorker` hook, which runs the
libavoid router in a Web Worker (`DiagramViewer.tsx`).

- **Package**: `avoid-nodes-edge`
- **Version**: `0.3.1` (exact; `package.json` pins it with no range)
- **Author**: Awais Shah (awaisshah228) — copyright 2024-2026
- **Source**: <https://github.com/awaisshah228/react-flow-avoid-nodes-routing>
- **License**: a bespoke text titled *"MIT License — No Redistribution on
  Package Registries"*. `package.json` declares `SEE LICENSE IN LICENSE` rather
  than an SPDX identifier, precisely because **no SPDX identifier describes it**
  → [`LICENSES/avoid-nodes-edge.txt`](LICENSES/avoid-nodes-edge.txt), the copy
  tracked in git and readable in a fresh clone

### What it allows and what it forbids

It starts from MIT, with two differences from the standard text: the grant of
rights is **narrower** (it omits `sublicense` and `sell`) and it adds a clause
that **breaks the "free redistribution" criterion**. That is why it is **not
OSI-approved** and does not count as free or open source software. Per its text:

- **You may**: use, copy, modify, `merge`, publish and distribute the software
  inside your own project, installing it from the official npm package.
- **You may**: fork the repo for personal use, contributions or unpublished
  internal modifications.
- **You are not granted** the right to sublicense or sell the software, unlike
  standard MIT.
- **You may not**: republish, redistribute or re-upload the software — whole or
  partial, modified or not — **as a package on any registry**: npm, yarn, pnpm,
  GitHub Packages or any other package distribution platform, **except with the
  copyright holder's prior written permission**. The restriction covers forks,
  copies and derivative works.
- The text warns that violating that clause constitutes copyright infringement
  and may lead to a DMCA takedown, an npm dispute and/or legal action.

### How CENZONTLE complies

CENZONTLE uses the published package **unmodified** and does not vendor its
code: it arrives through `pnpm install` from the official npm registry. None of
the seven `package.json` files in the monorepo is published to any registry (all
carry `"private": true`), so clause 2 never fires.

### Rules for a fork

1. **Do not publish to npm** any package of this monorepo that pulls in
   `avoid-nodes-edge`, not even under another name or scope. Removing
   `"private": true` without first removing this dependency would be an
   infringement, unless you obtain written permission from the holder.
2. **Do not copy the code** of `avoid-nodes-edge` into your repo and then publish
   it. The restriction covers forks and "substantially similar" works.
3. **Distributing your application is fine** (Docker, SaaS, a binary, a public
   repo): what is forbidden is republication *as a package on a registry*, not
   use.
4. If your project needs a 100 % OSI chain, replace this layer: it is a thin
   wrapper, and `libavoid-js` (LGPL-2.1) remains usable directly.

---

## Trademarks

`apps/web/src/components/icons/` holds two components that reproduce third-party
brand marks to identify integrations in the UI:

| File | Mark | Holder |
|---|---|---|
| `LinearIcon.tsx` | Linear logo | Linear Orbit, Inc. |
| `AnthropicIcon.tsx` | Anthropic logo | Anthropic PBC |

Both components document in their comments that the SVG `path` comes from
**simple-icons** (<https://simple-icons.org>), a project that publishes its icon
data under **CC0-1.0** (public domain).

**CC0 covers the copyright of the SVG file, not trademark rights.** Those are
different things and have to be handled separately:

- "Linear" and its logo are trademarks of Linear Orbit, Inc.
- "Anthropic", "Claude" and their logos are trademarks of Anthropic PBC.
- The other product names cited in the repo (PostgreSQL, Redis, MinIO, Auth0,
  GitHub, Docker, Next.js, NestJS…) are trademarks of their respective holders.

In CENZONTLE these marks are used **nominatively only**: to identify the
third-party service each feature integrates with, so the user recognizes where a
button or a section points. This use **implies no affiliation, sponsorship,
endorsement or backing** by Linear Orbit, Inc. or Anthropic PBC of CENZONTLE or
its authors.

The project's Apache-2.0 license **grants no trademark rights** (see its section
6). If you fork or redistribute CENZONTLE under another name, review each
holder's brand guidelines before keeping their logos: nominative use has limits
and policies change.

---

## Infrastructure images (docker-compose)

`docker-compose.yml` brings up the local development stack. The images are **not
redistributed** from this repo — the compose file only references them and Docker
pulls them from their registry — but their licenses matter if you fold them into
a deployment of your own.

| Service | Image | Ports | License | OSI-approved? |
|---|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432 | PostgreSQL License | Yes |
| `redis` | `redis:7-alpine` | 6379 | Depends on the version — see below | **Depends** |
| `minio` | `minio/minio:latest` | 9000, 9001 | AGPL-3.0 | Yes, but strong network copyleft |
| `minio-init` | `minio/mc:latest` | — | AGPL-3.0 | Yes, but strong network copyleft |

### PostgreSQL

The PostgreSQL License is permissive (BSD/MIT style) and OSI-approved. The
`-alpine` variant adds the Alpine Linux base system: `musl` libc (MIT), BusyBox
(GPL-2.0-only) and other packages with licenses of their own. Distributing the
full image means complying with those too.

### Redis — the license changed

> [!IMPORTANT]
> **Redis stopped being open source as of version 7.4.** Do not assume "Redis is
> BSD" from what you remember a few years ago.

The relevant history:

- **Up to 7.2.x** — BSD-3-Clause, OSI-approved.
- **From 7.4 (2024)** — dual **RSALv2 / SSPLv1**. Neither is OSI-approved: they
  are *source-available* licenses that restrict offering Redis as a managed
  service to third parties.
- **From 8.0 (2025)** — **AGPLv3** was added as a third option, and that one is
  OSI-approved. 8.x can be taken under AGPLv3.

The `7-alpine` tag follows the 7.x line, which today resolves to **7.4+**, that
is **RSALv2/SSPLv1**. If you need a clean OSI chain you have three ways out: pin
a tag from the 7.2 line (BSD, but unsupported), move to Redis 8.x and take it
under AGPLv3, or migrate to a BSD fork such as **Valkey** (a Linux Foundation
project, protocol-compatible).

### MinIO

Both the server (`minio/minio`) and the client (`minio/mc`, used by `minio-init`
to create the `cenzontle-documents` bucket) are under **AGPL-3.0**. It is
OSI-approved, but it is the strongest copyleft: its section 13 extends the
obligations to network interaction, not just to distributing the binary.

Running the official image **unmodified** as a separate service that CENZONTLE
reaches over the S3 API does not force you to release CENZONTLE's code: MinIO's
AGPL covers MinIO. But if you **modify** MinIO and offer it over a network, you
have to publish your modifications under AGPL-3.0. If your product bundles or
distributes MinIO, talk to your legal team before assuming anything.

### Floating tags are the underlying problem

No image is pinned to an exact version or a digest: `16-alpine`, `7-alpine` and
`latest` are moving tags. The consequences:

- **The effective license can change without a single line of the repo
  changing.** A `docker compose pull` can bring in a version under different
  terms. This already happened with Redis 7.2 → 7.4 and with MinIO
  (Apache-2.0 → AGPL-3.0 in 2021).
- **`latest` is not reproducible.** Two people who bring up the stack weeks apart
  can end up running different versions of MinIO.

For production, pin digests (`image@sha256:…`) and re-audit the license on every
bump. `docker-compose.yml` is the local development stack — the credentials are
`cenzontle_dev` in plain text — and it is not meant to be deployed as-is.

---

## Weak copyleft and transitive dual licenses

None of the packages below is a direct dependency of the repo: they are pulled in
by others. They do not require shipping their license text in a clone (they live
in `node_modules/`, which is not tracked) and they do not constrain CENZONTLE's
code, but they **do** fall into the category `CONTRIBUTING.md` and the pull
request template flag as reportable (MPL), so they are documented here to keep an
audit from finding them by surprise.

| Package | Version | License | Arrives via | When it matters |
|---|---|---|---|---|
| `lightningcss` | `1.32.0` | MPL-2.0 | `@tailwindcss/postcss` → `@tailwindcss/node`; `vitest` → `vite` | Build and dev |
| `axe-core` | `4.11.1` | MPL-2.0 | `eslint-config-next` → `eslint-plugin-jsx-a11y` | Lint only |
| `caniuse-lite` | `1.0.30001781` | CC-BY-4.0 | `next`, `browserslist` | Build |
| `dompurify` | `3.3.3` | MPL-2.0 **OR** Apache-2.0 | `jspdf`, `streamdown` → `mermaid` | Web runtime |
| `jszip` | `3.10.1` | MIT **OR** GPL-3.0-or-later | `docx`, `exceljs` | Web runtime |

What each case implies:

- **MPL-2.0** is **per-file** copyleft, same as EPL-2.0: if you modify a source
  file of `lightningcss` or `axe-core`, that modified version is published under
  MPL-2.0. Consuming the package without touching it spreads nothing.
- **Dual licenses**: `dompurify` and `jszip` let you choose. CENZONTLE takes
  **Apache-2.0** for `dompurify` and **MIT** for `jszip`, both permissive. The
  GPL-3.0 option on `jszip` does **not** apply unless someone picks it
  explicitly, which this repo does not.
- **CC-BY-4.0** (`caniuse-lite`) is a data license, not a code license, and only
  requires attribution. This line satisfies it.

---

## When to update this file

Update `NOTICES.md` when:

- **A dependency with a copyleft license is added** (LGPL, GPL, AGPL, MPL, EPL,
  CDDL) or one that is **source-available / not OSI-approved** (SSPL, BSL, RSAL,
  the Elastic License, or a bespoke text like `avoid-nodes-edge`'s).
- **A third-party binary or asset is tracked in git**, as already happens with
  `apps/web/public/libavoid.wasm` and `apps/web/public/pdf.worker.min.mjs`.
  Tracking the artifact makes the repo a redistributor and triggers obligations
  that consuming it through `node_modules` does not.
- **Third-party code is copied into the repo** instead of consumed as a package
  (the shadcn/ui model), even under a permissive license.
- **The version of anything listed here changes.** The versions in this file are
  exact and come from `pnpm-lock.yaml`, not from the semver range in
  `package.json`: a `^` can move the real version without `package.json`
  changing.
- **A dependency changes its license** between versions. It happens more than you
  would think: Redis in 7.4, MinIO in 2021, Terraform, Elasticsearch. Check it on
  every major bump and on every Dependabot PR that touches the dependencies
  above.
- **The source of an LGPL/GPL/EPL/AGPL dependency is modified.** In that case the
  modifications have to be published under the same license and linked from here.
- **A new brand mark is reproduced** in the UI: add it to the
  [Trademarks](#trademarks) table.
- **An image in `docker-compose.yml` changes** or its digests get pinned.

Related documents: [`LICENSE`](LICENSE) (the project's license),
[`SECURITY.md`](SECURITY.md) (reporting vulnerabilities),
[`CONTRIBUTING.md`](CONTRIBUTING.md) (contribution workflow).
