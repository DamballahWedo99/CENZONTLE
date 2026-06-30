# Cómo contribuir a CENZONTLE

Gracias por contribuir. Esta guía cubre el flujo de trabajo, las convenciones y
los checks que tu cambio debe pasar. Si es tu primera vez, arranca por el
[Getting Started](docs/getting-started.md).

---

## Flujo de trabajo (git)

- **Branches por feature**, nunca commits directos a `main`.
- Nombra la branch por su intención: `feat/qa-pipeline`, `fix/staging-gate`, etc.
- Abre un **PR contra `main`**. Mantén los PRs enfocados (un cambio coherente).
- Antes de stagear: `git status` y `git diff` para revisar lo que vas a commitear.

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

Corre estos desde la raíz y deben pasar:

```bash
pnpm type-check     # tipos en shared + web + api + worker
pnpm lint           # ESLint en todos los workspaces
pnpm test           # Jest (api) + Vitest (web/worker)
```

- Si tocaste `packages/shared`, recuerda que `pnpm dev`/`type-check` ya hacen su
  build; en duda: `pnpm --filter @cenzontle/shared build`.
- Si tocaste el schema de Prisma, genera la migración con
  `prisma migrate dev --name <desc>` y commitea el `.sql` resultante (ver
  [docs/database.md](docs/database.md)).

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

---

## Code review

Antes de pedir review (o de reportar "terminado"), conviene una autorevisión
adversarial sobre lo que cambiaste, especialmente si tocaste:
- **Auth, endpoints, input de usuario, crypto, env vars** → revisión de seguridad.
- **Módulos nuevos, schema, contratos de API** → revisión de arquitectura.
- **Cualquier código** → revisión de calidad (bugs, edge cases, cobertura).

Incluye en el PR: qué cambió, por qué, cómo lo probaste, y cualquier hallazgo
pendiente.

---

## Estructura del repo (recordatorio)

```
apps/web · apps/api · apps/worker
packages/shared · packages/ts-config · packages/eslint-config
docs/ · docker-compose.yml
```

Dudas sobre cómo encaja todo: [docs/architecture.md](docs/architecture.md).
