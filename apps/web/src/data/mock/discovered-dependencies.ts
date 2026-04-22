/**
 * Mocks de `DiscoveredDependency` para visualizar la UI del gestor de
 * credenciales externas sin tener que correr el agente completo (costoso
 * en tokens Claude). Cubren todos los estados visuales:
 *
 *  1. Credencial bloqueante crítica sin resolver (rojo + botón "Resolver")
 *  2. Merchant code de PSP (bloqueante, alta severidad)
 *  3. Credencial opcional (no bloqueante, medium)
 *  4. Servicio de terceros bloqueante sin ser API
 *  5. Ya resuelta con linkedSecretId (badge verde "Secret provisto")
 *  6. Dep regular SIN requiresCredential (para contrastar)
 *
 * Activar con query param `?mockDeps=true` en la URL de una épica. Ver
 * `EpicFullPage.tsx` para el toggle.
 */

import type { DiscoveredDependency } from '@cenzontle/shared';

export const MOCK_DISCOVERED_DEPENDENCIES: DiscoveredDependency[] = [
  {
    id: 'ai-dep-mock-stripe-00000001-0001-0001-0001-000000000001',
    title: 'Stripe API Key',
    description:
      'Credencial secreta requerida para tokenizar y cobrar tarjetas en el flujo de checkout. Sin ella el backend no puede procesar pagos en producción.',
    severity: 'critical',
    type: 'api',
    vendor: 'Stripe',
    requiresCredential: true,
    isBlocking: true,
    mdContent: `**Naturaleza**: API key privada (\`sk_live_*\`) emitida por el dashboard de Stripe. Identifica a la cuenta del merchant y firma cada request al endpoint \`POST /v1/charges\`.

**Dónde se usa**: backend en \`PaymentGatewayService.chargeCard()\`, llamado desde el controller \`POST /api/checkout/charge\`.

**Cómo obtenerla**:
1. Iniciar sesión en [dashboard.stripe.com](https://dashboard.stripe.com/apikeys).
2. Ir a Developers → API keys → Standard keys.
3. Copiar la **Secret key** (empieza con \`sk_live_\` en producción, \`sk_test_\` en sandbox).
4. Pegar en el dialog como \`STRIPE_API_KEY\`.

**Owner sugerido**: Product Owner del módulo Pagos + CFO (autoriza gasto en producción).

**Impacto si falta**:
- Endpoint \`/api/checkout/charge\` responde 503 \`PAYMENT_GATEWAY_UNAVAILABLE\`.
- Todo el flujo de compra queda bloqueado. No hay degradación parcial — es all-or-nothing.

**Documentación oficial**: https://stripe.com/docs/keys`,
  },
  {
    id: 'ai-dep-mock-adyen00-0002-0002-0002-0002-000000000002',
    title: 'Adyen Merchant Account ID',
    description:
      'Identificador de cuenta merchant asignado por Adyen. Sin él las transacciones se rechazan con "invalid merchant".',
    severity: 'high',
    type: 'api',
    vendor: 'Adyen',
    requiresCredential: true,
    isBlocking: true,
    mdContent: `**Naturaleza**: Código alfanumérico de ~12 caracteres (\`CompanyNameECOM\`) que identifica a la cuenta del merchant en la red Adyen. Se envía en el campo \`merchantAccount\` de cada request.

**Dónde se usa**: \`AdyenClient.createPayment()\` — requiere enviar \`merchantAccount\` y \`apiKey\` juntos.

**Cómo obtenerla**:
1. Iniciar sesión en [ca-live.adyen.com](https://ca-live.adyen.com).
2. Settings → Account structure → Merchant accounts.
3. Copiar el código del merchant deseado (hay uno por región / canal).

**Owner sugerido**: Ops de Pagos (quien firmó el contrato con Adyen).

**Nota**: requiere tanto el \`ADYEN_MERCHANT_ACCOUNT\` como el \`ADYEN_API_KEY\` — ambos son secretos separados.`,
  },
  {
    id: 'ai-dep-mock-twilio00-0003-0003-0003-0003-000000000003',
    title: 'Twilio Auth Token',
    description:
      'Token para enviar SMS de verificación 2FA. Opcional — si falta, el flujo 2FA se desactiva pero el resto del sistema funciona.',
    severity: 'medium',
    type: 'api',
    vendor: 'Twilio',
    requiresCredential: true,
    isBlocking: false,
    mdContent: `**Naturaleza**: Auth Token de Twilio usado junto con el Account SID para firmar requests.

**Dónde se usa**: \`SmsVerificationService.sendOtp()\` — llamado solo si el usuario activó 2FA por SMS.

**Cómo obtenerlo**: Twilio Console → Account → API keys & tokens → Copy "Live Credentials" → Auth Token.

**Impacto si falta**:
- 2FA por SMS queda desactivado.
- Los usuarios pueden seguir usando TOTP (Google Authenticator) como fallback.
- El sistema NO bloquea — degrada funcionalidad específica.

**Owner sugerido**: Security Engineer.`,
  },
  {
    id: 'ai-dep-mock-sapariba-0004-0004-0004-0004-000000000004',
    title: 'SAP Ariba Gateway Endpoint + Cert',
    description:
      'Endpoint y certificado mTLS para enviar órdenes de compra a SAP Ariba. El proveedor los emite tras firmar contrato.',
    severity: 'critical',
    type: 'service',
    vendor: 'SAP Ariba',
    requiresCredential: true,
    isBlocking: true,
    mdContent: `**Naturaleza**: Endpoint URL privado + certificado cliente \`.p12\` emitido por SAP Ariba para autenticación mTLS.

**Dónde se usa**: \`AribaIntegrationService.submitPurchaseOrder()\`.

**Cómo obtenerlos**:
1. Firmar contrato con SAP Ariba (si aún no existe).
2. Esperar 3-5 días hábiles a que envíen credenciales por canal seguro.
3. Guardar el endpoint como \`ARIBA_GATEWAY_URL\` y el contenido del \`.p12\` (base64) como \`ARIBA_CLIENT_CERT\`.

**Owner sugerido**: Procurement Manager + Seguridad de TI.

**Nota**: este NO es una API key plana — el cert se rota cada 12 meses por política de SAP. Agenda un recordatorio al crear el secret.`,
  },
  {
    id: 'ai-dep-mock-sendgrid-0005-0005-0005-0005-000000000005',
    title: 'SendGrid API Key',
    description:
      'API key de SendGrid para envío transaccional de emails. YA resuelta — este es un ejemplo del estado post-resolución.',
    severity: 'high',
    type: 'api',
    vendor: 'SendGrid',
    requiresCredential: true,
    isBlocking: true,
    // Si este campo existe, el UI renderiza el badge verde "Secret provisto"
    linkedSecretId: 'mock-secret-uuid-sendgrid-01234567-89ab',
    mdContent: `**Naturaleza**: API key para enviar emails transaccionales (confirmaciones, recuperación de contraseña).

**Dónde se usa**: \`EmailService.send()\` — centralizado, llamado desde múltiples flows.

**Estado**: ya resuelta. El secret \`SENDGRID_API_KEY\` fue registrado en Settings y está disponible en runtime.`,
  },
  {
    id: 'ai-dep-mock-regular0-0006-0006-0006-0006-000000000006',
    title: 'Redis de staging del equipo de Infra',
    description:
      'Dependencia de infraestructura provista internamente. No requiere credencial externa — solo coordinación con Infra.',
    severity: 'medium',
    type: 'service',
    // Sin vendor, sin requiresCredential, sin isBlocking — dep tradicional.
    mdContent: `**Naturaleza**: Cluster de Redis 7.x compartido que el equipo de Infra provisiona para el entorno de staging.

**Estrategia de mock**: en tests unitarios usar \`ioredis-mock\`. En integración levantar contenedor efímero con testcontainers.

**Owner sugerido**: Team Infra.`,
  },
];
