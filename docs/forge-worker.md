# How-to: Bring up a Forge worker

The **Forge** is the software factory: a fleet of *workers* that claim stories and
implement them with headless Claude Code. It is **optional** — the project app works
without a single worker. Bring one up only when you want to process stories with AI
agents.

`apps/worker` is a CLI (`factory-worker`, Commander). Each worker is a machine (your
laptop, a Mac Mini, a VM) that registers as a *compute node*.

---

## Prerequisites

- The **API running** (`pnpm dev:api` or `pnpm dev`).
- Signed in as **Alta Gerencia** (`alta_gerencia`) — only senior management can
  create compute nodes and mint worker tokens.
- **Anthropic API key** configured in Settings ("Configuración") → Automatización →
  **Anthropic API Key** (`/factory/settings?section=anthropic-key`) — the worker
  receives it from the backend on every claim.
- On the worker machine: **Claude Code CLI** (`claude`) installed and on PATH.
- On the worker machine: **`tmux` and `ttyd`**. They are **not optional**: the worker
  streams the agent's log through `tmux` + `ttyd` so you can watch the run live, and
  if either binary is missing every claimed story fails immediately with exit code
  `127`. Install with `brew install tmux ttyd` (macOS), or on Linux install `tmux`
  from your package manager and `ttyd` following
  [its own instructions](https://github.com/tsl0922/ttyd#installation).
- A **sandbox tool** to isolate execution of the generated code:
  - **macOS** — `sandbox-exec` ships with the system, nothing to install.
  - **Linux** — install **firejail**: `sudo apt install firejail`
    (Debian/Ubuntu), `sudo dnf install firejail` (Fedora),
    `sudo pacman -S firejail` (Arch).

  Without one of the two, the worker **cannot run stories** (details below in
  [Sandbox](#sandbox-running-generated-code)).

---

## 1. Create the node and generate a worker token (in the UI)

There is no CLI for this — both steps happen in the UI:

1. Go to Settings → Infraestructura → **Nodos de cómputo** ("Compute nodes")
   (`/factory/settings?section=nodes`). The panel is titled **Gestión de flota**
   ("Fleet management").
2. Fill in the row at the bottom (name, type, slots) and click **Crear nodo**
   ("Create node").
3. On the new node's row, click **Generar** ("Generate"). The dialog shows a
   `worker_…` token **exactly once** — copy it. It also builds the full
   `factory-worker register … && factory-worker start` command for you. Creating
   the node in step 2 opens that same dialog on its own, so the first token
   costs you no extra click.

The command the dialog hands you does **not** carry
`FACTORY_WORKER_ALLOW_INSECURE=1`. On an `http://` dashboard the dialog flags
that separately and you add it yourself — see
[Register the machine as a node](#3-register-the-machine-as-a-node).

`/factory/agents` shows a *"Fleet Monitor"* panel, but it cannot create nodes or mint
tokens. Node registration and worker tokens live only in Settings → **Nodos de
cómputo**.

---

## 2. Build the worker

```bash
pnpm --filter @cenzontle/worker build      # compiles to apps/worker/dist/cli.js
```

For development without a build you can use `pnpm --filter @cenzontle/worker dev`
(runs through `tsx`), but for registering and running, the build is the better option.

---

## 3. Register the machine as a node

```bash
# The dashboard URL must be https. There is no exception for localhost, so on
# local dev you export this first — in the same shell you will run `start` from,
# because `start` builds the same client and fails the same way.
export FACTORY_WORKER_ALLOW_INSECURE=1

node apps/worker/dist/cli.js register \
  --dashboard http://localhost:3001 \
  --token worker_XXXXXXXX \
  --slots 1
```

- `--dashboard` — URL of the API. The check lives in the API client's
  constructor (`apps/worker/src/lib/api-client.ts:77-85`), so without
  `FACTORY_WORKER_ALLOW_INSECURE=1` an `http://` URL throws before the command
  does anything at all. Never set it outside local dev: `claim-story` returns
  the Anthropic API key in cleartext on every response.
- `--slots` — how many concurrent stories this node accepts (1–32).

Registration saves the connection in `~/.factory-worker/config.json` (including the
`nodeId` the backend assigns). Mode `0600`.

---

## 4. Start the daemon

```bash
# `start` re-reads the saved dashboard URL and re-runs the https check, so this
# has to be set here too if you opened a new shell.
export FACTORY_WORKER_ALLOW_INSECURE=1

node apps/worker/dist/cli.js start
# or override slots without re-registering:
node apps/worker/dist/cli.js start --slots 2
```

The daemon heartbeats every 30 s and polls for claimable stories every 5 s. You will
see the node turn **online** in Settings → **Nodos de cómputo**.

Global debug flag: `--verbose` (or `-v`).

---

## 5. Stop the daemon

There is no `factory-worker stop`. `start` is a long-running foreground process — stop
it with `Ctrl-C`, or send it `SIGTERM` (`kill <pid>`) if you put it in the background.

Both signals trigger the same graceful shutdown: the worker stops heartbeating and
stops claiming immediately, then waits up to 60 s for runs already in flight to
finish, and exits 0. With no active runs the exit is immediate.

If the 60 s drain expires with runs still going, the worker exits anyway and logs
`shutdown.timeout` with the stuck run ids. Those runs are not lost silently — the
backend's run sweeper marks them `abandoned` after 10 min without progress and
releases their stories, so another worker can re-claim them. The node itself stays at
its last reported status until the fleet sweeper marks it `offline`, 90 s after the
last heartbeat.

---

## (Optional) Install `factory-worker` as a global binary

`package.json` declares `"bin": { "factory-worker": "./dist/cli.js" }`. To get it on
your PATH:

```bash
cd apps/worker && npm link        # or: npm i -g .
export FACTORY_WORKER_ALLOW_INSECURE=1   # local dev only — http dashboard
factory-worker register --dashboard http://localhost:3001 --token worker_XXXX
factory-worker start
```

Not required for development — `node apps/worker/dist/cli.js ...` works the same.

---

## Sandbox (running generated code)

The worker spawns `claude` with `--dangerously-skip-permissions`, so the agent has
ungated tools on the machine. The sandbox is the project's **only OS-level isolation
control**: it wraps every spawn to deny reads and writes to the directories where host
credentials live (`~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.config/gcloud`, `~/.kube`,
`~/.gnupg`, `~/.netrc`, `~/.docker`, `~/.npmrc`, `~/.cargo/credentials`, `~/.pypirc`,
`~/.terraformrc`).

Valid modes (`apps/worker/src/lib/sandbox.ts`):

| Mode | Platform | How it is implemented |
|---|---|---|
| `sandbox-exec` | macOS | Inline SBPL profile (`allow default` + `deny file-read*`/`file-write*` over the paths above) |
| `firejail` | Linux | `firejail --quiet --private-tmp --blacklist=<path>… -- claude …` |
| `none` | any | **No isolation.** Requires a double opt-in (below) |

### Automatic detection

1. If `FACTORY_WORKER_SANDBOX_MODE` is exactly `sandbox-exec`, `firejail`, or `none`,
   that value is used. **Any other value is silently ignored** and falls through to
   auto-detection.
2. macOS with `sandbox-exec` on PATH → `sandbox-exec`.
3. Linux with `firejail` on PATH → `firejail`.
4. Anything else → `none`.

In other words: **on Linux without firejail installed the detected mode is `none`**,
even if you configured nothing.

### What happens in `none` mode

The worker refuses to run unless you set **`FACTORY_WORKER_ALLOW_NO_SANDBOX=1`**.
Running without a sandbox therefore takes **two** things at once: the mode must
resolve to `none` (because you do not have the tool installed, or because you forced
`FACTORY_WORKER_SANDBOX_MODE=none`) **and** that second variable must hold exactly
`1`. With only one of the two, nothing runs.

Watch **where** it fails: the check happens when `claude` is spawned, not when the
daemon starts. So `factory-worker start` comes up fine and the node shows as
**online**, but **every story it claims aborts before the spawn** with the
`run.sandbox.unavailable` event and an error like:

```
No sandbox available on linux and FACTORY_WORKER_ALLOW_NO_SANDBOX is not '1'.
```

The right cure is to install firejail, not to set the bypass variable.

### Limits of the sandbox

It is not hermetic, and does not aim to be: `claude` needs the network (Anthropic's
API), exec (git, pnpm, node), and a wide filesystem (workdir + system libraries). The
narrow goal is the most likely attack — *prompt injection* in the epic's markdown
trying to read host credentials.

As a complementary defense, the child process's `env` is built from an explicit
**whitelist** (`HOME`, `PATH`, `USER`, `LANG`, the Anthropic credential, and the
secrets the backend scoped to that claim): it does not inherit `DATABASE_URL`,
`VAULT_ENCRYPTION_KEY`, `AWS_*`, or anything else from the host.

Do not remove the sandbox on shared machines or in production.

Every worker flag: [configuration.md › Worker](configuration.md#worker-runtime-flags).

---

## Verification

- `factory-worker start` shows no auth errors (401/404).
- In Settings → **Nodos de cómputo**, the node shows **online** with its slots.
- Once you enqueue an epic to the Forge, the worker claims stories and you see active
  runs.

---

## Gotchas

- **The token is shown only once** — if you lose it, generate another one and
  re-register.
- **401 on start** → token revoked or wrong; **404** → node retired (re-register).
- **`claude` not found** → install the Claude Code CLI or set `CLAUDE_BIN`.
- **Every story fails with exit code `127` right after being claimed** → `tmux` or
  `ttyd` is missing on the worker machine. Install both, or point `TMUX_BIN` /
  `TTYD_BIN` at them.
- **`register` or `start` throws `dashboardUrl debe usar HTTPS` before doing
  anything** → export `FACTORY_WORKER_ALLOW_INSECURE=1` in that shell. Local dev
  only.
- **The node is online but every story fails with `Sandbox unavailable`** → the
  sandbox tool is missing. On Linux, `sudo apt install firejail`. See
  [Sandbox](#sandbox-running-generated-code).
- The worker is independent of `pnpm dev`; it runs in its own terminal/machine.
