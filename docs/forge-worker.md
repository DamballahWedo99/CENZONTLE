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
- Una **herramienta de sandbox** para aislar la ejecución del código generado:
  - **macOS** — `sandbox-exec` ya viene con el sistema, no instalas nada.
  - **Linux** — instala **firejail**: `sudo apt install firejail`
    (Debian/Ubuntu), `sudo dnf install firejail` (Fedora),
    `sudo pacman -S firejail` (Arch).

  Sin una de las dos, el worker **no puede correr historias** (detalle abajo en
  [Sandbox](#sandbox-ejecución-de-código-generado)).

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

El worker spawnea `claude` con `--dangerously-skip-permissions`, así que el agente
tiene tools sin gate en la máquina. El sandbox es el **único control de aislamiento
a nivel de SO** del proyecto: envuelve cada spawn para denegar lectura y escritura
de los directorios donde viven credenciales del host (`~/.ssh`, `~/.aws`,
`~/.config/gh`, `~/.config/gcloud`, `~/.kube`, `~/.gnupg`, `~/.netrc`, `~/.docker`,
`~/.npmrc`, `~/.cargo/credentials`, `~/.pypirc`, `~/.terraformrc`).

Modos válidos (`apps/worker/src/lib/sandbox.ts`):

| Modo | Plataforma | Cómo se implementa |
|---|---|---|
| `sandbox-exec` | macOS | Perfil SBPL inline (`allow default` + `deny file-read*`/`file-write*` sobre los paths de arriba) |
| `firejail` | Linux | `firejail --quiet --private-tmp --blacklist=<path>… -- claude …` |
| `none` | cualquiera | **Sin aislamiento.** Requiere doble opt-in (abajo) |

### Detección automática

1. Si `FACTORY_WORKER_SANDBOX_MODE` vale exactamente `sandbox-exec`, `firejail` o
   `none`, se usa ese valor. **Cualquier otro valor se ignora en silencio** y cae al
   auto-detect.
2. macOS con `sandbox-exec` en PATH → `sandbox-exec`.
3. Linux con `firejail` en PATH → `firejail`.
4. En cualquier otro caso → `none`.

Es decir: **en Linux sin firejail instalado el modo detectado es `none`**, aunque no
hayas configurado nada.

### Qué pasa en modo `none`

El worker se niega a ejecutar salvo que hayas puesto **`FACTORY_WORKER_ALLOW_NO_SANDBOX=1`**.
Correr sin sandbox exige por tanto **dos** cosas a la vez: que el modo resuelva a
`none` (porque no tienes la herramienta instalada, o porque forzaste
`FACTORY_WORKER_SANDBOX_MODE=none`) **y** esa segunda variable con el valor exacto
`1`. Con una sola de las dos, no se ejecuta nada.

Ojo con **dónde** falla: la verificación ocurre al spawnear `claude`, no al arrancar
el daemon. Entonces `factory-worker start` levanta bien y el nodo aparece **online**
en Fleet, pero **cada historia que reclame aborta antes del spawn** con el evento
`run.sandbox.unavailable` y un error del tipo:

```
No sandbox available on linux and FACTORY_WORKER_ALLOW_NO_SANDBOX is not '1'.
```

La cura correcta es instalar firejail, no poner la variable de bypass.

### Límites del sandbox

No es hermético, y no pretende serlo: `claude` necesita red (API de Anthropic),
exec (git, pnpm, node) y un filesystem amplio (workdir + libs del sistema). El
objetivo acotado es el ataque más probable — *prompt injection* en el markdown de
la épica que intente leer credenciales del host.

Como defensa complementaria, el `env` del proceso hijo se construye con un
**whitelist** explícito (`HOME`, `PATH`, `USER`, `LANG`, la credencial de Anthropic
y los secretos que el backend scopeó para ese claim): no hereda `DATABASE_URL`,
`VAULT_ENCRYPTION_KEY`, `AWS_*` ni nada más del host.

No quites el sandbox en máquinas compartidas ni en producción.

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
- **El nodo está online pero toda historia falla con `Sandbox unavailable`** → falta
  la herramienta de sandbox. En Linux, `sudo apt install firejail`. Ver
  [Sandbox](#sandbox-ejecución-de-código-generado).
- El worker es independiente del `pnpm dev`; corre en su propia terminal/máquina.
