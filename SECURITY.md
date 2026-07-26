# Política de seguridad

## Reportar una vulnerabilidad

**No abras un issue público.** Usa el reporte privado de GitHub:

**[→ Reportar una vulnerabilidad](https://github.com/DamballahWedo99/CENZONTLE/security/advisories/new)**

Eso abre un canal privado entre tú y quienes mantienen el proyecto. El reporte
queda oculto hasta que exista un arreglo.

Incluye, en la medida de lo posible:

- Qué componente afecta (`apps/web`, `apps/api`, `apps/worker`) y en qué versión o commit.
- Los pasos para reproducirlo. Un repro que podamos correr vale más que una descripción larga.
- El impacto que ves: qué puede leer, modificar o ejecutar alguien que abuse de esto.
- Si tienes una idea del arreglo, dila.

**Qué esperar:** este es un proyecto mantenido por poca gente. Buscamos acusar
recibo en un plazo de una semana y acordar contigo la ventana de divulgación
según la gravedad. Si no obtienes respuesta, insiste — no es desinterés.

No hay programa de recompensas.

---

## Antes de reportar: lo que ya sabemos

CENZONTLE es una plataforma que **ejecuta código generado por IA**. Varias cosas
que parecen vulnerabilidades son decisiones de diseño conscientes y documentadas.
Estas **no** son hallazgos nuevos:

- El worker corre `claude` con `--dangerously-skip-permissions`
  (`apps/worker/src/lib/runner.ts`, `dod-verifier-agent.ts`). Es intencional: el
  agente debe trabajar sin pedir confirmación en cada acción. **El aislamiento
  real lo da el sandbox del sistema operativo, no la CLI.**
- `FACTORY_WORKER_ALLOW_NO_SANDBOX=1` desactiva ese aislamiento. Es un opt-in
  doble y deliberado (ver más abajo).
- `FACTORY_WORKER_ALLOW_INSECURE=1` permite `dashboardUrl` por HTTP plano.
- `INTERNAL_API_KEY` es un secreto compartido entre el BFF de `apps/web` y la
  API — un workaround documentado (CWE-306) mientras se completa el relay de
  tokens de Auth0.

Lo que **sí** queremos que nos reportes: formas de **escapar** del sandbox,
saltarse los guards de rol o de pod, leer secretos de otro tenant, inyección
(SQL, comando, prompt) que escale privilegios, o cualquier ruta que exponga los
secretos cifrados en la base de datos.

---

## Modelo de seguridad: lo que debes entender antes de correr esto

> [!WARNING]
> El Forge descarga instrucciones de un servidor, se las pasa a un modelo de
> lenguaje y **ejecuta el código resultante en tu máquina**, con tus
> credenciales de Git y acceso a la red. Trátalo con el mismo cuidado que
> darías a un runner de CI autoalojado. La app de gestión de proyectos
> (`apps/web` + `apps/api`) funciona perfectamente **sin** levantar ningún
> worker; si solo quieres explorar la plataforma, no levantes uno.

### Aislamiento del código generado

El worker envuelve cada ejecución con el sandbox nativo del sistema
(`apps/worker/src/lib/sandbox.ts`):

| Modo | Plataforma | Cuándo se usa |
|---|---|---|
| `sandbox-exec` | macOS | Auto-detectado (perfil SBPL) |
| `firejail` | Linux | Auto-detectado si está instalado |
| `none` | cualquiera | Solo con **doble** opt-in explícito |

Correr sin sandbox exige `FACTORY_WORKER_SANDBOX_MODE=none` **y**
`FACTORY_WORKER_ALLOW_NO_SANDBOX=1`. Si falta el segundo, el worker **aborta cada
run justo antes de lanzar `claude`**: el daemon arranca y hace heartbeat con
normalidad, pero ninguna historia avanza. Esa fricción es intencional: sin
aislamiento, una prompt injection en el contenido de una historia puede leer las
credenciales del host (`~/.ssh`, `~/.aws`, `~/.config/gh`).

En Linux, `firejail` no viene instalado por defecto. Si no lo instalas
(`apt install firejail`), el worker resuelve el modo a `none` y se detiene en cada
run en vez de correr sin protección.

### Secretos

- Los tokens de GitHub, las API keys de Anthropic y los *external secrets* se
  guardan **cifrados en la base de datos** con AES-256-GCM, no en `.env`. La
  llave maestra es `VAULT_ENCRYPTION_KEY`.
- **Rotar `VAULT_ENCRYPTION_KEY` invalida todo lo ya cifrado.** No es una
  rotación en caliente: requiere re-cifrar.
- Genera cada secreto con entropía real (`openssl rand -base64 32` /
  `openssl rand -hex 32`). No reutilices valores entre entornos.
- Los valores de `docker-compose.yml` (`cenzontle_dev`) son **solo para
  desarrollo local**. Nunca los uses en una máquina accesible desde la red.

### Autenticación

Auth0 es obligatorio; **no hay bypass de desarrollo**. Si no está configurado,
el middleware falla cerrado (503) en vez de dejar pasar. El control de acceso
combina roles (`AltaGerencia`, `ProductOwner`, `TechLead`, `QA`, `Viewer`) con
filtrado por pod, y las acciones sensibles (VoBo de épicas, release gate)
requieren step-up auth.

### Antes de exponer esto a una red

Este proyecto está pensado y probado para **desarrollo local**. Si vas a
desplegarlo:

- [ ] TLS en todo; nunca `FACTORY_WORKER_ALLOW_INSECURE`.
- [ ] Sandbox activo en todos los workers; nunca `FACTORY_WORKER_ALLOW_NO_SANDBOX`.
- [ ] `VAULT_ENCRYPTION_KEY` e `INTERNAL_API_KEY` generados con entropía real y fuera del repo.
- [ ] Con múltiples réplicas de la API, un **Redis compartido**: el rate limiter guarda ahí sus contadores, y sin él los límites son por réplica en vez de globales.
- [ ] Credenciales de Postgres y del bucket S3 distintas de las de `docker-compose.yml`.
- [ ] Workers en máquinas desechables, con tokens de Git de alcance mínimo.

### Costos

Los agentes consumen la API de Anthropic con **tu** API key. Una épica encolada
lanza varios agentes en paralelo y el verificador de DoD reintenta ante fallos,
lo que aproximadamente duplica el costo de esa etapa. Empieza con una historia
pequeña y revisa el dashboard de costos antes de encolar trabajo grande.

---

## Alcance

**Dentro:** el código de este repositorio — `apps/web`, `apps/api`,
`apps/worker`, `packages/*`.

**Fuera:** vulnerabilidades en dependencias de terceros (repórtalas upstream; si
nos afectan directamente, avísanos igual), en Auth0, Anthropic, GitHub o tu
proveedor de infraestructura, y cualquier problema derivado de correr el proyecto
con los guardarraíles desactivados a propósito.
