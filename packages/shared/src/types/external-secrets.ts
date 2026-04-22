/**
 * Credencial externa que el backend necesita para integrar con un proveedor
 * de terceros (API keys de Stripe/Twilio, merchant codes de PSPs, OAuth
 * client_secrets, etc.) — cosas que el sistema NO puede generar por sí solo:
 * requieren contrato con el proveedor.
 *
 * El **valor** se almacena encriptado con AES-256-GCM en Postgres via
 * `CryptoService`. La API nunca devuelve el plaintext; solo el runtime
 * (vía `ExternalSecretsService.getByName`) lo desencripta on-demand para
 * servicios internos que lo consumen (ej: payment gateway, SMS sender).
 *
 * Scope: **globales por organización** (una sola `STRIPE_API_KEY` compartida
 * entre todas las iniciativas). Identificador canónico: `name` único, estilo
 * env var (UPPER_SNAKE_CASE).
 */
export interface ExternalSecret {
  id: string;
  /** Identificador canónico estilo env var: `STRIPE_API_KEY`, `TWILIO_AUTH_TOKEN`. Único. */
  name: string;
  /** Proveedor legible para UI: "Stripe", "Twilio", "SAP Ariba". Opcional. */
  vendor: string | null;
  /** Descripción libre (propósito, dónde se usa). Opcional. */
  description: string | null;
  /**
   * Valor enmascarado para UI: primeros y últimos chars con `••••` en medio.
   * La API NUNCA devuelve plaintext — solo esta versión. Ej: `sk_live_••••••••1234`.
   */
  maskedValue: string;
  /** Última vez que el valor fue rotado (o creado). ISO. */
  lastRotatedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input para crear un `ExternalSecret`. El `value` plaintext solo viaja en
 * la request; se encripta server-side y nunca se persiste/logea sin encriptar.
 *
 * Si se provee `sourceDependencyId`, la dependencia que originó la creación
 * se auto-marca como `resolved` con nota referenciando el secret — cierra el
 * loop entre "detectar credencial requerida" y "credencial provista".
 */
export interface CreateExternalSecretInput {
  /** UPPER_SNAKE_CASE. Único en la org. */
  name: string;
  /** Valor plaintext; solo aquí, nunca se persiste sin encriptar. */
  value: string;
  vendor?: string;
  description?: string;
  /**
   * UUID de la `DiscoveredDependency` o `EpicDependency` que originó la
   * creación. Si se provee, la dep se auto-resuelve con `linkedSecretId`.
   */
  sourceDependencyId?: string;
}
