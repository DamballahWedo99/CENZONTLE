# How-to: Levantar un worker del Forge

El **Forge** es la software factory: una flota de *workers* que reclaman historias
y las implementan con Claude Code headless. Es **opcional** — la app de proyectos
funciona sin ningún worker. Levanta uno solo cuando quieras procesar historias
con agentes de IA.

`apps/worker` es un CLI (`factory-worker`, Commander). Cada worker es una máquina
(tu laptop, un Mac Mini, una VM) que se registra como *compute node*.

---

## Prerrequisitos

- La **API corriendo** (`pnpm dev:api` o `pnpm dev`).
- Estar logueado como **AltaGerencia** (para generar el worker token).
- **Anthropic API key** configurada en la UI (Tokens IA) — el worker la recibe del
  backend en cada claim.
- En la máquina del worker: **Claude Code CLI** (`claude`) instalado y en PATH.
  Opcional para terminal en vivo: `tmux` y `ttyd`.

---

## 1. Generar un worker token (en la UI)

No hay CLI para esto — se crea en la UI:

**Factory → Fleet** (o gestión de nodos) → **Generar worker token**.
Te da un token `worker_XXXXXXXX...` que se muestra **una sola vez** — cópialo.

---

## 2. Build del worker

```bash
pnpm --filter @cenzontle/worker build      # compila a apps/worker/dist/cli.js
```

Para desarrollo sin build puedes usar `pnpm --filter @cenzontle/worker dev`
(corre con `tsx`), pero para registrar/correr conviene el build.

---

## 3. Registrar la máquina como nodo

```bash
node apps/worker/dist/cli.js register \
  --dashboard http://localhost:3001 \
  --token worker_XXXXXXXX \
  --slots 1
```

- `--dashboard` — URL de la API. En dev local con http, añade
  `FACTORY_WORKER_ALLOW_INSECURE=1` (la URL debe ser https en producción).
- `--slots` — cuántas historias concurrentes acepta este nodo (1–32).

El registro guarda la conexión en `~/.factory-worker/config.json` (incluido el
`nodeId` que asigna el backend). Modo `0600`.

---

## 4. Arrancar el daemon

```bash
node apps/worker/dist/cli.js start
# o sobreescribiendo slots sin re-registrar:
node apps/worker/dist/cli.js start --slots 2
```

El daemon manda heartbeats cada ~30s y hace polling para reclamar historias. Verás
el nodo aparecer "online" en la UI de Fleet.

Flag global de debug: `--verbose` (o `-v`).

---

## (Opcional) Instalar `factory-worker` como binario global

El `package.json` declara `"bin": { "factory-worker": "./dist/cli.js" }`. Para
tenerlo en PATH:

```bash
cd apps/worker && npm link        # o: npm i -g .
factory-worker register --dashboard http://localhost:3001 --token worker_XXXX
factory-worker start
```

No es necesario para desarrollar — `node apps/worker/dist/cli.js ...` funciona igual.

---

## Sandbox (ejecución de código generado)

El worker corre **código generado por IA**, así que aísla la ejecución:

| Modo | Plataforma |
|---|---|
| `sandbox-exec` | macOS (default ahí) |
| `nix` | Linux |
| `none` | sin aislamiento — requiere opt-in `FACTORY_WORKER_ALLOW_NO_SANDBOX=1` |

Override con `FACTORY_WORKER_SANDBOX_MODE`. El env del proceso es un **whitelist**
(no hereda `DATABASE_URL`, `VAULT_ENCRYPTION_KEY`, etc.). No quites el sandbox en
máquinas compartidas.

Todas las flags del worker: [configuration.md › Worker](configuration.md#worker-flags-de-runtime).

---

## Verificación

- `factory-worker start` no muestra errores de auth (401/404).
- En la UI de Fleet, el nodo aparece **online** con sus slots.
- Al subir una épica al Forge, el worker reclama historias y verás runs activos.

---

## Gotchas

- **Token solo se ve una vez** — si lo pierdes, genera otro y re-registra.
- **401 al start** → token revocado o incorrecto; **404** → nodo retirado (re-registra).
- **`claude` no encontrado** → instala Claude Code CLI o setea `CLAUDE_BIN`.
- **http rechazado** → `FACTORY_WORKER_ALLOW_INSECURE=1` solo en dev local.
- El worker es independiente del `pnpm dev`; corre en su propia terminal/máquina.
