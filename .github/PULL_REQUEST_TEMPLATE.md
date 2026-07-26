<!--
Gracias por contribuir. Antes de abrir el PR, revisa CONTRIBUTING.md.
Las secciones que no apliquen puedes borrarlas — no dejes plantilla vacía.
-->

## Qué cambia

<!-- Una o dos frases. El título del PR ya dice el "qué"; aquí interesa el alcance. -->

## Por qué

<!--
El contexto que no se ve en el diff: qué problema resuelve, qué alternativa
descartaste y por qué. Si cierra un issue, escribe "Closes #123".
-->

## Cómo lo probaste

<!--
Concreto y reproducible. "Corrí los tests" no dice nada; "agregué un caso en
apps/api/src/modules/factory/qa/qa-campaign.service.spec.ts que cubre el CAS
concurrente, y verifiqué a mano el gate en la UI" sí.
-->

## Checklist

- [ ] `pnpm type-check` pasa
- [ ] `pnpm lint` pasa
- [ ] `pnpm test` pasa
- [ ] El commit usa un prefijo del repo (`Feat:` `Fix:` `Refactor:` `Docs:` `Test:` `Chore:`)
- [ ] No incluye secretos, `.env`, ni credenciales reales (tampoco en logs o capturas)

<!-- Marca solo lo que aplique a este cambio: -->

- [ ] **Schema de Prisma tocado** → generé la migración con `pnpm --filter @cenzontle/api exec prisma migrate dev --name <desc>` y commiteé el `.sql`
- [ ] **Variable de entorno nueva** → la documenté en el `.env.example` correspondiente **y** en `docs/configuration.md`
- [ ] **Dependencia nueva con licencia copyleft o de atribución** (GPL/LGPL/AGPL/MPL/EPL) → la agregué a `NOTICES.md`
- [ ] **Cambio de comportamiento visible** → actualicé la documentación en `docs/`

## Notas para quien revisa

<!--
Dónde mirar primero, qué parte te preocupa, qué dejaste fuera a propósito.
Si hay algo que sabes que está a medias, dilo aquí en vez de esperar que se note.
-->
