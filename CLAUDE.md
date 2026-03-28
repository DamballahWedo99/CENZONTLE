# CENZONTLE

Plataforma de Software Factory y gestión de proyectos. Monorepo Turborepo con pnpm workspaces.

## Estructura

```
apps/
  web/     → Next.js 16 + React 19 + Tailwind 4 + Radix UI
  api/     → NestJS 11 + Express + Swagger
packages/
  shared/  → Tipos compartidos (tsup: CJS + ESM)
  ts-config/   → Configuraciones TypeScript base
  eslint-config/ → Configuraciones ESLint compartidas
```

## Comandos

```bash
pnpm dev          # Dev completo (web + api)
pnpm dev:web      # Solo frontend
pnpm dev:api      # Solo backend
pnpm build        # Build de producción
pnpm lint         # Lint todos los workspaces
pnpm test         # Tests todos los workspaces
pnpm type-check   # Verificación de tipos
pnpm clean        # Limpia cache de Turbo
```

### Por workspace

```bash
# Web
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web lint

# API
pnpm --filter api dev
pnpm --filter api build
pnpm --filter api test

# Shared
pnpm --filter @cenzontle/shared build
```

## Convenciones de código

### TypeScript
- Strict mode habilitado en todos los workspaces
- Web: `@/*` apunta a `./src/*` (alias Next.js)
- API: Sin path aliases, resolución estándar de Node
- Shared exporta CJS + ESM con declaraciones de tipos

### Nombrado
- Directorios: kebab-case (`app/factory/agents`, `modules/proyectos`)
- Componentes React: PascalCase (`AgentCard.tsx`, `BatchDetail.tsx`)
- Módulos NestJS: kebab-case con estructura `modules/<feature>/`
- Tipos compartidos: PascalCase para interfaces/types

### Imports
- Dependencias de workspace con `workspace:*` en package.json
- Importar tipos compartidos desde `@cenzontle/shared`
- Componentes UI desde `@/components/ui/` (Radix UI wrappers)
- No usar imports relativos que suban más de 2 niveles (`../../` max)

### Estilo frontend
- Tailwind CSS 4 para estilos, no CSS modules
- Radix UI como base de componentes
- Lucide React para iconos
- React Context API para estado (no Redux/Zustand)
- Visualizaciones con D3, Dagre, XYFlow

### Estilo backend
- Un módulo NestJS por feature (`modules/proyectos`, `modules/factory`)
- Decoradores habilitados (emitDecoratorMetadata)
- class-validator para validación de DTOs
- Swagger para documentación de API

### Organización de archivos
- Web: `app/` (rutas), `components/`, `context/`, `data/`, `hooks/`, `lib/`, `types/`
- API: `modules/` (features), cada módulo con controller + service + dto
- Shared: `src/types/` (modelos de dominio), `src/index.ts` (barrel export)

## Módulos del proyecto

- **Proyectos**: Gestión con iniciativas, épicas e historias de usuario
- **Factory**: Automatización de software factory (agents, batches, pipelines, DAGs, releases, gates)
- **Equipo**: Gestión de equipos
- **Auth**: Autenticación
- **Aprobacion**: Flujos de aprobación
- **Reportes**: Sistema de reportes
- **Integrations**: Integraciones externas

## Reglas de commits

- Mensajes en español o inglés, consistente dentro del mismo PR
- Prefijos: `Feat:`, `Fix:`, `Chorus:`, `Refactor:`, `Docs:`, `Test:`
- Branch por feature, nunca directamente en main
