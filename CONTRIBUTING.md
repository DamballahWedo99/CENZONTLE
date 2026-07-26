# Cómo contribuir a CENZONTLE

Gracias por tomarte el tiempo. Esta guía cubre lo que necesitas saber para que tu
contribución llegue a `main`: cómo orientarte en el repo, qué flujo seguir y qué
checks debe pasar tu cambio.

Si es tu primera vez aquí, arranca por el
**[Getting Started](docs/getting-started.md)**: te lleva de `git clone` a la app
corriendo y con login en ~20–30 min. No sigas leyendo esto hasta tenerla
levantada — casi todo lo de abajo asume que puedes correr el proyecto.

Participar implica aceptar el [Código de Conducta](CODE_OF_CONDUCT.md).

---

## Cómo puedes ayudar

El código no es la única contribución valiosa, ni la más escasa:

- **Reproducciones de bugs.** Un repro mínimo que podamos correr vale más que
  cinco reportes vagos. Confirmar (o descartar) un bug que alguien más reportó
  también ayuda muchísimo.
- **Documentación.** Si un paso de la instalación te falló, si un `.env.example`
  no explica para qué sirve una variable, si `docs/troubleshooting.md` no cubre
  el error con el que chocaste — arréglalo. Ese PR se mergea rápido.
- **Traducciones.** La documentación está en español. Si quieres traducir `docs/`
  o el README a otro idioma, abre un issue primero para acordar dónde vivirían
  los archivos; todavía no hay una estructura definida para eso.
- **Triage.** Responder issues, pedir la información que falta, señalar
  duplicados.
- **Código.** Bugs, funcionalidades acordadas, tests que hoy no existen.

---

## Por dónde empezar

Dos etiquetas en GitHub marcan trabajo listo para agarrar:

- **[`good first issue`](https://github.com/DamballahWedo99/CENZONTLE/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)**
  — acotado, con contexto suficiente para resolverlo sin conocer todo el repo.
- **[`help wanted`](https://github.com/DamballahWedo99/CENZONTLE/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22)**
  — cosas que sabemos que hacen falta y que no vamos a alcanzar a hacer pronto.
  Suelen ser más grandes que las anteriores.

Comenta en el issue antes de ponerte a trabajar ("voy con este") para que nadie
duplique el esfuerzo. Si llevas tiempo y ya no puedes seguir, dilo también: no
pasa nada, pero que quede libre.

¿No hay nada etiquetado que te llame? Levanta el proyecto y usa la lista de
verificación del [Getting Started](docs/getting-started.md#checklist-de-verificación).
Todo lo que te haya costado más de lo debido es un buen primer PR de docs.

---

## Antes de escribir código

**Para cambios grandes, abre o comenta un issue primero.** Funcionalidad nueva,
refactor amplio, cambio en el schema de Prisma, nueva dependencia, cambio en un
contrato de API: describe qué quieres hacer y por qué antes de escribirlo. Cuesta
diez minutos y evita las dos peores formas de perder el tiempo — duplicar lo que
alguien ya está haciendo, o terminar un PR que no se va a mergear porque va en
contra de una decisión que no estaba escrita en ningún lado.

**Los arreglos pequeños y obvios van directo a PR.** Un typo, un enlace roto, un
bug de una línea con causa evidente, un mensaje de error confuso. No hace falta
ceremonia para eso.

Si dudas de qué lado cae tu cambio, abre el issue. Es la opción barata.

---

## Reportar un bug

Los issues usan plantillas — elige la que corresponda:

| Plantilla | Para |
|---|---|
| [🐛 Reporte de bug](https://github.com/DamballahWedo99/CENZONTLE/issues/new?template=bug_report.yml) | Algo no funciona como debería |
| [✨ Propuesta de funcionalidad](https://github.com/DamballahWedo99/CENZONTLE/issues/new?template=feature_request.yml) | Una mejora o capacidad nueva |

Las preguntas de uso y las ideas a medio cocinar van a
[Discussions](https://github.com/DamballahWedo99/CENZONTLE/discussions), no a
issues.

> [!WARNING]
> **Las vulnerabilidades de seguridad nunca van en un issue público.** Sigue
> [SECURITY.md](SECURITY.md), que explica cómo abrir un reporte privado y qué
> comportamientos ya conocemos y son intencionales (el worker corriendo con
> permisos amplios dentro de un sandbox, entre otros). Léelo antes de reportar:
> te ahorra el trabajo de documentar algo que ya está documentado.

Antes de abrir un issue de bug, revisa
[docs/troubleshooting.md](docs/troubleshooting.md) — cubre la mayoría de los
fallos de setup. Y al pegar logs, **borra los secretos** (tokens,
`INTERNAL_API_KEY`, `VAULT_ENCRYPTION_KEY`, claves de Anthropic o de Auth0).

---

## Dónde vive qué

Mapa para orientarte sin tener que leer todo el repo. El detalle de cómo encaja
está en [docs/architecture.md](docs/architecture.md).

| Quieres tocar… | Vas a `…` |
|---|---|
| Una pantalla o ruta del frontend | `apps/web/src/app/` (App Router: `proyectos/`, `factory/`, `equipo/`, `login/`) |
| Un componente de UI | `apps/web/src/components/` (los primitivos de Radix en `components/ui/`) |
| Estado compartido del frontend | `apps/web/src/context/` — React Context, alcance por layout de ruta |
| La llamada del frontend a la API | `apps/web/src/app/api/proxy/[...path]/route.ts` (el BFF proxy) |
| **Un endpoint nuevo** | `apps/api/src/modules/<feature>/` — controller + service + dto en el mismo módulo |
| Guards, filtros, throttler, storage | `apps/api/src/common/` |
| El modelo de datos | `apps/api/prisma/schema.prisma` + la migración generada en `apps/api/prisma/migrations/` |
| **Cómo el worker ejecuta una historia** | `apps/worker/src/lib/runner.ts` |
| El aislamiento del código generado | `apps/worker/src/lib/sandbox.ts` (`sandbox-exec` en macOS, `firejail` en Linux) |
| La verificación de Definition of Done | `apps/worker/src/lib/dod-verifier.ts` y `dod-verifier-agent.ts` |
| El CLI del worker (`register`, `start`) | `apps/worker/src/cli.ts` y `apps/worker/src/commands/` |
| **Un tipo que usan web y api** | `packages/shared/src/types/` + exportarlo en `packages/shared/src/index.ts` |
| Config base de TypeScript o ESLint | `packages/ts-config/`, `packages/eslint-config/` |
| Una variable de entorno | el `.env.example` del workspace **y** [docs/configuration.md](docs/configuration.md) |
| La documentación | `docs/` (framework [Diátaxis](https://diataxis.fr)) |

Dónde van los tests:

- **api** — Jest, archivos `*.spec.ts` **junto al código** que prueban.
- **web** y **worker** — Vitest, archivos `*.test.ts` junto al código (en web
  también hay carpetas `__tests__/` para módulos grandes).
- **e2e de web** — Playwright en `apps/web/e2e/`
  (`pnpm --filter @cenzontle/web test:e2e`; la primera vez, `test:e2e:install`
  baja Chromium). No corren en `pnpm test`.

### El directorio `.claude/`

El repo versiona la configuración de [Claude Code](https://claude.com/claude-code)
que usan quienes lo mantienen. Un detalle que conviene conocer antes de que te
sorprenda:

`.claude/settings.json` registra un hook `SessionStart` que ejecuta
`.claude/hooks/start-dev-servers.sh` **automáticamente** al abrir el proyecto con
Claude Code. Ese script copia los `.env` que falten desde el repo principal, corre
`pnpm install`, compila `packages/shared`, ejecuta `prisma generate` y pasa el
lint. Está escrito para el flujo de worktrees de quienes mantienen el proyecto:
en un clon normal no hará nada útil, pero sí correrá.

Si prefieres que no se ejecute, borra `.claude/settings.json` de tu copia local
(no lo commitees) o abre el proyecto con otro editor. Nada del desarrollo normal
depende de ese hook: los comandos de `pnpm` documentados aquí funcionan por sí
solos.

---

## Flujo de trabajo (git)

- **Branches por feature**, nunca commits directos a `main`.
- Nombra la branch por su intención: `feat/qa-pipeline`, `fix/staging-gate`, etc.
- Abre un **PR contra `main`**. Mantén los PRs enfocados (un cambio coherente).
  Tres cambios independientes son tres PRs, y los tres avanzan más rápido así.
- Antes de stagear: `git status` y `git diff` para revisar lo que vas a commitear.
- La [plantilla de PR](.github/PULL_REQUEST_TEMPLATE.md) se llena sola al abrirlo;
  borra las secciones que no apliquen, pero no la dejes vacía.

### Mensajes de commit

Prefijo + descripción del **por qué** (no solo el qué). Consistente dentro del PR
(español o inglés, pero uno solo):

| Prefijo | Para |
|---|---|
| `Feat:` | Nueva funcionalidad |
| `Fix:` | Corrección de bug |
| `Refactor:` | Cambio interno sin alterar comportamiento |
| `Docs:` | Documentación |
| `Test:` | Tests |
| `Chore:` | Tooling, deps, mantenimiento |

Ejemplo: `Feat: pipeline de QA multi-agente con verificación adversarial`.

---

## Checks antes de abrir el PR

El CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) corre
**type-check, lint, test y build** en cada PR. Correr lo mismo en local antes de
abrirlo te ahorra el ciclo de push → esperar → arreglar → push:

```bash
pnpm type-check     # tipos en shared + web + api + worker
pnpm lint           # ESLint en todos los workspaces
pnpm test           # Jest (api) + Vitest (web/worker)
pnpm build          # build de producción de todo
```

Para iterar más rápido, filtra por workspace:
`pnpm --filter @cenzontle/api test`, `pnpm --filter @cenzontle/web type-check`.

- Si tocaste `packages/shared`, recuerda que `pnpm dev`/`type-check` ya hacen su
  build; en duda: `pnpm --filter @cenzontle/shared build`.
- Si tocaste el schema de Prisma, genera la migración con
  `pnpm --filter @cenzontle/api exec prisma migrate dev --name <desc>` y commitea
  el `.sql` resultante (el CLI de Prisma vive en `apps/api`, no en la raíz — ver
  [docs/database.md](docs/database.md)).
- Si `pnpm test` te falla en algo que no tocaste, verifica contra `main` limpio
  antes de perseguirlo: puede ser un fallo preexistente y no tuyo. Si lo es,
  dilo en el PR en vez de intentar arreglarlo ahí mismo.

---

## Convenciones de código

Resumen; el detalle vive en [CLAUDE.md](CLAUDE.md).

### Nombrado
- Directorios: `kebab-case` (`modules/proyectos`, `app/factory/agents`).
- Componentes React: `PascalCase` (`AgentCard.tsx`).
- Módulos NestJS: `kebab-case`, estructura `modules/<feature>/` (controller +
  service + dto).
- Tipos compartidos: `PascalCase`, en `packages/shared/src/types/`.

### Imports
- Dependencias de workspace con `workspace:*`.
- Tipos compartidos desde `@cenzontle/shared`.
- Web: alias `@/*` → `./src/*`. Componentes UI desde `@/components/ui/`.
- No subir más de 2 niveles con imports relativos (`../../` máx).

### Estilo
- **Frontend:** Tailwind 4 (no CSS modules), Radix UI como base, Lucide para
  iconos, React Context para estado (no Redux/Zustand). D3/XYFlow para viz.
- **Backend:** un módulo NestJS por feature; `class-validator` en los DTOs;
  Swagger documentado; logging con pino estructurado.
- Strict mode de TypeScript en todos los workspaces.

### Principios
SOLID, DRY, KISS, YAGNI (en ese orden de prioridad). Sin TODOs ni stubs en código
que se mergea; arregla causas raíz, no síntomas; no deshabilites tests para que
pase el build.

---

## Migraciones y secretos

- **No edites `.sql` de migraciones a mano** (salvo SQL que Prisma no expresa,
  como índices parciales — documéntalo en el archivo).
- **Nunca commitees secretos.** Los `.env`/`.env.local` están en `.gitignore`. Si
  agregas una variable nueva, **documéntala** en el `.env.example` correspondiente
  y en [docs/configuration.md](docs/configuration.md).
- Tampoco pegues secretos en la descripción del PR, en los logs que adjuntes ni
  en capturas de pantalla.

---

## Autorevisión antes de pedir review

Antes de marcar el PR como listo, date una pasada adversarial sobre lo que
cambiaste, especialmente si tocaste:

- **Auth, endpoints, input de usuario, crypto, env vars** → revisión de seguridad.
- **Módulos nuevos, schema, contratos de API** → revisión de arquitectura.
- **Cualquier código** → revisión de calidad (bugs, edge cases, cobertura).

Incluye en el PR: qué cambió, por qué, cómo lo probaste, y cualquier hallazgo
pendiente. Si sabes que algo quedó a medias, escríbelo tú en "Notas para quien
revisa" en vez de esperar a que se note en el review.

---

## Qué esperar del review

Sé honesto contigo: **CENZONTLE lo mantiene poca gente, en tiempo limitado.** No
hay SLA. Un PR puede tener respuesta el mismo día o quedarse quieto una o dos
semanas, sobre todo si es grande o toca el Forge. Si pasó ese tiempo sin señales,
un comentario recordatorio en el PR es bienvenido y no molesta a nadie.

Lo que hace que un PR se mergee rápido:

- **Alcance acotado.** Un cambio coherente que se puede revisar de una sentada.
- **El porqué explicado.** El diff dice qué cambiaste; la descripción tiene que
  decir por qué, y qué alternativa descartaste.
- **Tests.** Idealmente uno que falla sin tu cambio y pasa con él. Para un bug,
  ese test es la mejor prueba de que lo entendiste.
- **Checks verdes** antes de pedir review.
- **Un issue previo** cuando el cambio no es trivial.

Lo que lo frena, en orden de gravedad:

- Mezclar refactor + feature + reformateo en el mismo PR. Es la causa número uno
  de los PRs que se quedan estancados: nadie puede revisarlo por partes.
- Reformatear archivos que no tenían que ver con tu cambio (ensucia el diff).
- Cambiar comportamiento visible sin actualizar `docs/`.
- Agregar dependencias sin justificar por qué no alcanzaba con lo que ya hay.

El review va a hacer preguntas y a pedir cambios. Va sobre el código, nunca sobre
quien lo escribió; y si un comentario del review no se entiende o te parece
equivocado, discútelo — eso también es parte del proceso.

---

## Licencia de las contribuciones

CENZONTLE se distribuye bajo la **[Apache License 2.0](./LICENSE)**. Al enviar un
PR aceptas que tu contribución se licencie bajo esos mismos términos (es lo que
la propia Apache-2.0 establece en su sección 5). Conservas el copyright de lo que
escribiste; lo que otorgas es la licencia para usarlo.

**No hay CLA que firmar** ni papeleo adicional: abrir el PR es todo.

Si incorporas código de terceros, asegúrate de que su licencia sea compatible,
consérvale sus avisos de copyright, y agrégalo a
[NOTICES.md](NOTICES.md) si trae obligaciones de atribución o es copyleft
(GPL/LGPL/AGPL/MPL/EPL).

---

## Código de conducta

Este proyecto se rige por el [Código de Conducta](CODE_OF_CONDUCT.md). Aplica a
issues, PRs, discussions y a cualquier otro espacio del proyecto. Léelo antes de
participar.

---

¿Dudas que esta guía no resuelve?
[Discussions](https://github.com/DamballahWedo99/CENZONTLE/discussions) o
[docs/](docs/README.md).
