# How-to: Base de datos (Prisma + PostgreSQL)

La persistencia es PostgreSQL vía Prisma 7. El schema vive en
`apps/api/prisma/schema.prisma` y las migraciones en `apps/api/prisma/migrations/`.

Todos los comandos se corren desde la raíz con `--filter @cenzontle/api` (o desde
`apps/api/`). Necesitan `DATABASE_URL` en `apps/api/.env`.

---

## Comandos esenciales

```bash
# Generar el cliente Prisma (automático en postinstall/predev, pero por si acaso)
pnpm --filter @cenzontle/api exec prisma generate

# Aplicar migraciones pendientes (LO QUE USAS NORMALMENTE)
pnpm --filter @cenzontle/api exec prisma migrate deploy

# Ver el estado de migraciones (qué falta, drift)
pnpm --filter @cenzontle/api exec prisma migrate status

# Seed (¡OJO: solo LIMPIA tablas, no crea datos!)
pnpm --filter @cenzontle/api exec prisma db seed

# Abrir Prisma Studio (explorador visual de la BD)
pnpm --filter @cenzontle/api exec prisma studio
```

---

## `migrate deploy` vs `migrate dev` — usa deploy

- **`migrate deploy`** — aplica solo las migraciones pendientes, **nunca resetea**,
  no es interactivo. Es lo correcto para arrancar local y para producción.
- **`migrate dev`** — para **crear** una migración nueva tras editar el schema. Hace
  detección de drift y puede ofrecer **resetear la BD** (destructivo). Úsalo solo
  cuando estés cambiando el schema, y revisa lo que propone.

```bash
# Solo cuando MODIFICAS schema.prisma y quieres una migración nueva:
pnpm --filter @cenzontle/api exec prisma migrate dev --name descripcion_del_cambio
```

> Las migraciones se generan con Prisma; **no edites el `.sql` a mano** salvo para
> cosas que Prisma no expresa (p.ej. índices parciales únicos en SQL crudo, que
> este repo sí usa — busca `CREATE UNIQUE INDEX ... WHERE` en las migraciones).

---

## El seed

`apps/api/prisma/seed.ts` **solo borra** las tablas de dominio (epicPod,
podProductOwner, epic, initiative, productOwner, pod) y termina con
*"all tables cleared. Create data from the UI."* No crea usuarios ni datos.

→ La data (pods, iniciativas, épicas, historias) se crea **desde la UI** una vez
logueado. Corre el seed solo si quieres una BD limpia desde cero.

---

## Postgres dual: nativo vs Docker

Si ya tenías PostgreSQL **nativo** (Homebrew, etc.) escuchando en `:5432`, el
contenedor de Docker **no podrá** mapear ese puerto, o peor: tu `DATABASE_URL`
puede apuntar al Postgres equivocado. Síntoma típico: "se perdió la base de datos"
o tablas que aparecen/desaparecen según con qué cliente te conectes.

**Antes de asumir pérdida de datos**, verifica QUIÉN escucha en :5432:

```bash
lsof -i :5432            # ¿postgres nativo, Docker, o ambos?
docker compose ps        # ¿el contenedor está corriendo?
```

Opciones:
- **Usar solo Docker:** detén el Postgres nativo (`brew services stop postgresql`)
  y deja que el contenedor tome el `:5432`.
- **Usar solo el nativo:** no levantes el servicio postgres de Docker; crea la BD
  y el rol manualmente con las credenciales de tu `DATABASE_URL`.
- **Convivencia:** mapea el contenedor a otro puerto (`"5433:5432"` en
  `docker-compose.yml`) y ajusta `DATABASE_URL` a `:5433`.

El `migrate deploy` siempre se aplica a la BD de `DATABASE_URL` — asegúrate de que
sea la que el API realmente usa.

---

## Drift en el historial de migraciones

Este repo creció con un híbrido `db push` + migraciones, así que puede haber
migraciones aplicadas en una BD que no están en el folder (lo verás en
`migrate status` como *"migrations from the database are not found locally"*). Eso
**no bloquea** `migrate deploy` — deploy solo va folder → BD aplicando lo que
falte. No corras `migrate reset` para "arreglar" el drift en una BD con datos
reales.

---

## Errores comunes

| Síntoma | Causa | Solución |
|---|---|---|
| `relation "..." does not exist` (P2021) | Migraciones sin aplicar | `prisma migrate deploy` |
| `Environment variable not found: DATABASE_URL` | Falta `.env` | `cp apps/api/.env.example apps/api/.env` y rellenar |
| `Can't reach database server` | Postgres no está arriba o puerto incorrecto | `docker compose up -d postgres` / revisar puerto |
| El API arrancó pero queries fallan tras agregar modelos | Cliente Prisma viejo en memoria | reinicia `pnpm dev` (regenera/recarga el cliente) |

Más en [troubleshooting.md](troubleshooting.md).
