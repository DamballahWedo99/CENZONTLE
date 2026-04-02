import { DefinicionNode } from '@/types/definiciones';
import { generateAdditionalDefiniciones } from './definiciones-generator';

const baseDefiniciones: DefinicionNode[] = [
  {
    id: 'folder-negocio',
    name: 'Reglas de Negocio',
    type: 'folder',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-03-20T14:30:00Z',
    children: [
      {
        id: 'doc-politica-precios',
        name: 'Política de Precios',
        type: 'document',
        tags: ['pricing', 'revenue', 'tarifas'],
        createdAt: '2026-01-15T10:00:00Z',
        updatedAt: '2026-03-18T09:00:00Z',
        content: `# Política de Precios

## Objetivo
Definir las reglas de negocio que gobiernan la estructura de tarifas y precios de los servicios.

## Reglas Generales

1. **Tarifa base**: Todo vuelo tiene una tarifa base que se calcula según la ruta, temporada y disponibilidad.
2. **Clases de servicio**: Se manejan 4 clases — Clase AM Plus, Clase Premier, Clase Turista y Clase Básica.
3. **Pricing dinámico**: Los precios se ajustan en tiempo real basándose en:
   - Ocupación del vuelo (>80% activa sobreprecio)
   - Días restantes para la salida
   - Demanda histórica de la ruta
   - Competencia directa en la misma ruta

## Descuentos Aplicables

| Tipo | Descuento | Condiciones |
|------|-----------|-------------|
| Empleado | 90% | Sujeto a disponibilidad |
| Familiar directo | 75% | Máximo 2 acompañantes |
| Convenio corporativo | 15-40% | Según contrato vigente |
| Programa de lealtad | 5-20% | Según tier del cliente |

## Restricciones
- No se pueden aplicar descuentos acumulables excepto lealtad + corporativo.
- Las tarifas promocionales tienen un tope máximo del 60% de descuento.
- Todo cambio de precio >20% requiere aprobación del Revenue Manager.
`,
      },
      {
        id: 'doc-politica-cancelacion',
        name: 'Política de Cancelación',
        type: 'document',
        tags: ['cancelación', 'reembolso', 'servicio-al-cliente'],
        createdAt: '2026-02-01T11:00:00Z',
        updatedAt: '2026-03-15T16:00:00Z',
        content: `# Política de Cancelación y Reembolsos

## Ventanas de Cancelación

### Cancelación gratuita
- **24 horas** después de la compra, siempre que la salida sea en >7 días.
- Aplica a todas las clases de servicio excepto Clase Básica.

### Cancelación con penalización
- **Clase Premier**: 20% de penalización
- **Clase AM Plus**: 35% de penalización
- **Clase Turista**: 50% de penalización
- **Clase Básica**: No reembolsable

## Reembolsos
- Forma de pago original: 5-10 días hábiles
- Crédito de viaje: inmediato, válido por 12 meses
- Los impuestos aeroportuarios siempre son reembolsables

## Casos Especiales
- **Fallecimiento**: Reembolso total con acta de defunción
- **Emergencia médica**: Reembolso total con certificado médico
- **Cancelación por aerolínea**: Reembolso total + compensación según regulación
`,
      },
      {
        id: 'doc-equipaje',
        name: 'Política de Equipaje',
        type: 'document',
        tags: ['equipaje', 'servicio-al-cliente', 'tarifas'],
        createdAt: '2026-02-05T09:00:00Z',
        updatedAt: '2026-03-20T11:00:00Z',
        content: `# Política de Equipaje

## Equipaje de Mano
- **Dimensiones máximas**: 55 x 40 x 25 cm (incluyendo ruedas y asas)
- **Peso máximo**: 10 kg
- **Artículo personal**: 1 bolso, mochila o maletín adicional (máx 40 x 30 x 15 cm)

## Equipaje Documentado

| Clase | Piezas incluidas | Peso máx. por pieza |
|-------|-----------------|---------------------|
| Básica | 0 (compra aparte) | 23 kg |
| Turista | 1 pieza | 23 kg |
| AM Plus | 1 pieza | 23 kg |
| Premier | 2 piezas | 32 kg |

## Sobrepeso y Sobredimensión
- **23-32 kg**: USD $75 doméstico, USD $100 internacional
- **32-45 kg**: USD $200 (solo en mostrador)
- **>45 kg**: No aceptado como equipaje, requiere servicio de carga

## Equipaje Especial
- Instrumentos musicales: aceptados en cabina si caben en compartimento superior
- Equipo deportivo: tarifa especial según tipo (golf, ski, surf)
- Mascotas en cabina: máximo 9 kg (incluyendo transportadora), costo variable
`,
      },
      {
        id: 'doc-programa-lealtad',
        name: 'Club Premier',
        type: 'document',
        tags: ['lealtad', 'club-premier', 'revenue', 'pasajero'],
        createdAt: '2026-02-10T14:00:00Z',
        updatedAt: '2026-03-22T10:00:00Z',
        content: `# Club Premier — Programa de Lealtad

## Niveles (Tiers)

| Tier | Puntos anuales | Beneficios clave |
|------|---------------|------------------|
| **Oro** | 20,000 | Priority check-in, 1 maleta extra |
| **Platino** | 50,000 | Sala VIP, upgrade sujeto a disp., 2 maletas extra |
| **Titanio** | 100,000 | Upgrade confirmado 48h antes, equipaje ilimitado |

## Acumulación de Puntos
- **Vuelos AM**: 1 punto por cada MXN $14 gastados (tarifa base + impuestos)
- **Vuelos SkyTeam**: 50-100% de los puntos según tier del socio
- **Partners**: Tarjetas de crédito, hoteles, autos — según convenio

## Redención
- Vuelos de premio: desde 10,000 puntos (doméstico ida)
- Upgrades: desde 5,000 puntos por segmento
- Puntos + efectivo: combinación flexible con mínimo 3,000 puntos

## Reglas de Expiración
- Puntos expiran a los 24 meses sin actividad en la cuenta
- La actividad se define como: acumular o redimir puntos
- Tiers se recalculan cada año calendario
`,
      },
    ],
  },
  {
    id: 'folder-dominio',
    name: 'Modelo de Dominio',
    type: 'folder',
    createdAt: '2026-01-20T08:00:00Z',
    updatedAt: '2026-03-25T11:00:00Z',
    children: [
      {
        id: 'doc-entidades',
        name: 'Entidades Principales',
        type: 'document',
        tags: ['dominio', 'entidades', 'modelo'],
        createdAt: '2026-01-20T08:00:00Z',
        updatedAt: '2026-03-25T11:00:00Z',
        content: `# Entidades del Dominio

## Pasajero
- **PNR** (Passenger Name Record): Identificador único de reserva (6 caracteres alfanuméricos)
- **Boleto electrónico**: Número de 13 dígitos que vincula el pago con el itinerario
- **Perfil Club Premier**: Número de membresía + tier (Oro, Platino, Titanio)

## Vuelo
- **Número de vuelo**: AM + 3-4 dígitos (ej: AM001)
- **Segmento**: Tramo individual de un itinerario (origen → destino)
- **Conexión**: Dos o más segmentos con escala intermedia (<24h)

## Reserva
- Estados válidos: \`Confirmada\` → \`Checked-in\` → \`Abordada\` → \`Completada\`
- Estados alternativos: \`Cancelada\`, \`No-show\`, \`En espera\`

## Tripulación
- **PIC** (Pilot in Command): Capitán responsable del vuelo
- **SIC** (Second in Command): Primer oficial
- **Purser**: Jefe de cabina responsable del servicio
`,
      },
      {
        id: 'doc-estados-reserva',
        name: 'Máquina de Estados — Reserva',
        type: 'document',
        tags: ['dominio', 'estados', 'reserva', 'modelo'],
        createdAt: '2026-02-20T10:00:00Z',
        updatedAt: '2026-03-26T14:00:00Z',
        content: `# Máquina de Estados — Reserva

## Diagrama de Transiciones

\`\`\`
En espera ──┐
            ├──→ Confirmada ──→ Checked-in ──→ Abordada ──→ Completada
            │         │              │
            │         ├──→ Cancelada  ├──→ No-show
            │         │
            └─────────┘
\`\`\`

## Reglas de Transición

| De | A | Condición |
|----|---|-----------|
| En espera | Confirmada | Pago recibido o lista de espera liberada |
| Confirmada | Checked-in | Check-in completado (web, app o mostrador) |
| Confirmada | Cancelada | Solicitud del pasajero o regla de negocio |
| Checked-in | Abordada | Escaneo de pase de abordar en puerta |
| Checked-in | No-show | Cierre de puerta sin escaneo |
| Abordada | Completada | Aterrizaje en destino final |

## Invariantes
- Una reserva cancelada no puede reactivarse (debe crearse nueva)
- No-show genera cargo automático excepto en clases reembolsables
- El estado \`Completada\` dispara acumulación de puntos Club Premier
`,
      },
      {
        id: 'folder-glosario',
        name: 'Glosario',
        type: 'folder',
        createdAt: '2026-02-10T09:00:00Z',
        updatedAt: '2026-03-22T10:00:00Z',
        children: [
          {
            id: 'doc-glosario-ops',
            name: 'Términos Operacionales',
            type: 'document',
            tags: ['glosario', 'operaciones', 'aviación'],
            createdAt: '2026-02-10T09:00:00Z',
            updatedAt: '2026-03-22T10:00:00Z',
            content: `# Glosario Operacional

| Término | Definición |
|---------|-----------|
| **ETOPS** | Extended-range Twin-engine Operational Performance Standards — Certificación para vuelos transoceánicos con bimotores |
| **MEL** | Minimum Equipment List — Lista de equipos mínimos para despacho |
| **NOTAM** | Notice to Airmen — Avisos sobre condiciones aeroportuarias |
| **OTP** | On-Time Performance — Métrica de puntualidad (objetivo: >85%) |
| **PSU** | Passenger Service Unit — Unidad de servicio sobre cada asiento |
| **Revenue pax** | Pasajero que pagó tarifa (excluye empleados, infantes en brazos) |
| **Yield** | Ingreso por pasajero por kilómetro volado |
| **Load factor** | Porcentaje de ocupación del avión (asientos vendidos / disponibles) |
| **Codeshare** | Acuerdo donde una aerolínea vende asientos en vuelos de otra |
| **Interline** | Acuerdo de transferencia de pasajeros/equipaje entre aerolíneas |
`,
          },
          {
            id: 'doc-glosario-tech',
            name: 'Términos Técnicos',
            type: 'document',
            tags: ['glosario', 'tecnología', 'sistemas'],
            createdAt: '2026-02-15T14:00:00Z',
            updatedAt: '2026-03-20T08:00:00Z',
            content: `# Glosario Técnico

| Término | Definición |
|---------|-----------|
| **PSS** | Passenger Service System — Sistema central de reservas (Amadeus Altéa) |
| **DCS** | Departure Control System — Sistema de check-in y control de salidas |
| **RMS** | Revenue Management System — Sistema de gestión de ingresos y pricing |
| **FFP** | Frequent Flyer Program — Club Premier en el caso de la aerolínea |
| **GDS** | Global Distribution System — Red de distribución (Amadeus, Sabre, Travelport) |
| **NDC** | New Distribution Capability — Estándar IATA para distribución moderna |
| **PNR** | Passenger Name Record — Registro maestro de reserva |
| **EMD** | Electronic Miscellaneous Document — Documento para servicios ancilares |
`,
          },
          {
            id: 'doc-glosario-comercial',
            name: 'Términos Comerciales',
            type: 'document',
            tags: ['glosario', 'comercial', 'revenue'],
            createdAt: '2026-03-01T10:00:00Z',
            updatedAt: '2026-03-25T15:00:00Z',
            content: `# Glosario Comercial

| Término | Definición |
|---------|-----------|
| **RASK** | Revenue per Available Seat Kilometer — Ingreso por asiento-km disponible |
| **CASK** | Cost per Available Seat Kilometer — Costo por asiento-km disponible |
| **Ancillary revenue** | Ingresos por servicios adicionales (equipaje, asientos, comidas) |
| **Fare basis** | Código que identifica la tarifa aplicada (ej: YOWMX, BLRMX) |
| **Bucket** | Clase de reserva dentro de una cabina (Y, B, M, H, Q, etc.) |
| **Overbooking** | Venta de más asientos que los disponibles para compensar no-shows |
| **Denied boarding** | Pasajero con reserva confirmada que no puede abordar por overbooking |
| **Involuntary rerouting** | Cambio de itinerario por causas operacionales de la aerolínea |
| **MCT** | Minimum Connecting Time — Tiempo mínimo de conexión en un aeropuerto |
| **Through fare** | Tarifa que cubre múltiples segmentos como un solo itinerario |
`,
          },
        ],
      },
    ],
  },
  {
    id: 'folder-procesos',
    name: 'Procesos',
    type: 'folder',
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-03-28T15:00:00Z',
    children: [
      {
        id: 'doc-check-in',
        name: 'Flujo de Check-in',
        type: 'document',
        tags: ['check-in', 'proceso', 'pasajero'],
        createdAt: '2026-02-01T10:00:00Z',
        updatedAt: '2026-03-28T15:00:00Z',
        content: `# Flujo de Check-in

## Canales Disponibles
1. **Web** (cenzontle.com): 48h - 1h antes de la salida
2. **App móvil**: 48h - 45min antes de la salida
3. **Kiosko aeropuerto**: 24h - 45min antes de la salida
4. **Mostrador**: 3h - 45min antes de la salida (60min para vuelos internacionales)

## Pasos del Proceso

\`\`\`
1. Identificación del pasajero (PNR o boleto electrónico)
2. Verificación de documentos (pasaporte/visa si aplica)
3. Selección/confirmación de asiento
4. Registro de equipaje documentado
5. Emisión de pase de abordar
6. Asignación de puerta de embarque
\`\`\`

## Reglas de Negocio
- El check-in web/app no permite equipaje con sobrepeso (>23kg Turista, >32kg Premier)
- Pasajeros con necesidades especiales deben hacer check-in en mostrador
- Grupos >9 pasajeros requieren check-in en mostrador
- Menores no acompañados (5-11 años) requieren check-in presencial
`,
      },
      {
        id: 'doc-embarque',
        name: 'Proceso de Embarque',
        type: 'document',
        tags: ['embarque', 'boarding', 'proceso'],
        createdAt: '2026-02-20T11:00:00Z',
        updatedAt: '2026-03-25T09:00:00Z',
        content: `# Proceso de Embarque

## Secuencia de Abordaje

1. **Pre-boarding**: Pasajeros con movilidad reducida, familias con infantes
2. **Zona 1**: Clase Premier, Titanio, Platino
3. **Zona 2**: Oro, AM Plus
4. **Zona 3**: Turista filas traseras
5. **Zona 4**: Turista filas delanteras
6. **Zona 5**: Clase Básica

## Tiempos Estándar
- **Doméstico**: Inicio 35min antes, cierre 15min antes
- **Internacional**: Inicio 45min antes, cierre 20min antes
- **Wide-body**: Inicio 50min antes, cierre 20min antes

## Políticas de Gate
- Pasajero que no se presenta al cierre → **No-show** automático
- Asiento liberado se ofrece a pasajeros en lista de espera
- Sobre-venta: Solicitar voluntarios antes de invocar IDB (Involuntary Denied Boarding)
`,
      },
      {
        id: 'doc-irregularidades',
        name: 'Manejo de Irregularidades',
        type: 'document',
        tags: ['irregularidades', 'proceso', 'servicio-al-cliente', 'operaciones'],
        createdAt: '2026-03-05T08:00:00Z',
        updatedAt: '2026-03-28T17:00:00Z',
        content: `# Manejo de Irregularidades Operacionales

## Tipos de Irregularidad

| Tipo | Definición | Compensación |
|------|-----------|--------------|
| **Retraso <2h** | Demora menor | Información + bebidas |
| **Retraso 2-4h** | Demora significativa | Alimentos + comunicación |
| **Retraso >4h** | Demora mayor | Hospedaje + transporte + alimentos |
| **Cancelación** | Vuelo no operado | Reembolso total o reasignación |
| **Desvío** | Aterrizaje en aeropuerto alterno | Transporte al destino original |

## Protocolo de Atención
1. Notificar al pasajero por canal de compra (push, SMS, email)
2. Activar protocolo de atención en sala según tipo de irregularidad
3. Ofrecer alternativas: siguiente vuelo, ruta alterna, reembolso
4. Registrar en sistema CRM para seguimiento y compensación

## Reglas de Reasignación Automática
- Prioridad: Premier > AM Plus > Turista > Básica
- Dentro de la misma clase: Club Premier Titanio > Platino > Oro > Sin membresía
- Familias con menores se reasignan juntas (no separar)
`,
      },
      {
        id: 'doc-servicio-abordo',
        name: 'Servicio a Bordo',
        type: 'document',
        tags: ['servicio', 'cabina', 'proceso', 'pasajero'],
        createdAt: '2026-03-10T09:00:00Z',
        updatedAt: '2026-03-27T14:00:00Z',
        content: `# Servicio a Bordo

## Servicio por Clase

### Clase Premier
- Bienvenida con bebida de cortesía
- Menú completo con opción de 3 platos (pre-seleccionable)
- Bar premium ilimitado
- Amenity kit en vuelos >3h
- Entretenimiento con pantalla individual + noise-cancelling

### Clase AM Plus / Turista
- Servicio de snack + bebida en vuelos <3h
- Comida completa en vuelos >3h (1 opción)
- Servicio de bar (con cargo en Turista, incluido en AM Plus)

### Clase Básica
- Sin servicio de alimentos incluido
- Compra a bordo disponible
- Entretenimiento en dispositivo personal (stream WiFi)

## Restricciones de Servicio
- No servir alcohol a menores de 18 años
- Límite de 3 bebidas alcohólicas por pasajero
- Suspender servicio de bar si el comandante lo indica
- Alimentos especiales (VGML, KSML, DBML) requieren pre-orden 24h antes
`,
      },
    ],
  },
  {
    id: 'folder-integraciones',
    name: 'Integraciones',
    type: 'folder',
    createdAt: '2026-03-01T08:00:00Z',
    updatedAt: '2026-03-27T12:00:00Z',
    children: [
      {
        id: 'doc-amadeus',
        name: 'Integración Amadeus',
        type: 'document',
        tags: ['amadeus', 'PSS', 'integración', 'API'],
        createdAt: '2026-03-01T08:00:00Z',
        updatedAt: '2026-03-27T12:00:00Z',
        content: `# Integración con Amadeus Altéa

## Sistemas Conectados
- **Altéa Reservation**: Gestión de reservas y PNRs
- **Altéa Inventory**: Control de inventario de asientos
- **Altéa Departure Control**: Check-in y control de vuelos

## APIs Principales

### Booking API
- Crear/modificar/cancelar reservas
- Rate limit: 500 TPS
- Timeout: 30s

### Ticketing API
- Emisión y reemisión de boletos
- Void de boletos (<24h)
- Rate limit: 200 TPS

## Reglas de Integración
- Toda escritura al PSS debe ser idempotente (usar \`transactionId\`)
- Reintentos con backoff exponencial (max 3 intentos)
- Circuit breaker: abrir después de 5 fallos consecutivos
- Logging obligatorio de request/response para auditoría
`,
      },
      {
        id: 'doc-skyteam',
        name: 'SkyTeam Alliance',
        type: 'document',
        tags: ['skyteam', 'alianza', 'integración', 'codeshare'],
        createdAt: '2026-03-05T10:00:00Z',
        updatedAt: '2026-03-25T16:00:00Z',
        content: `# SkyTeam Alliance — Integración

## Socios Principales
Delta Air Lines, Air France-KLM, Korean Air, China Airlines, Aerolíneas Argentinas, entre 19 miembros.

## Acuerdos Activos

### Codeshare
- AM vende con código propio vuelos operados por socios SkyTeam
- Revenue share según acuerdo bilateral (prorate o free-sale)
- Inventario sincronizado vía IATA Type-B messaging

### Interline
- Transferencia de equipaje entre socios sin re-check
- Tarjetas de embarque conectadas (through check-in)
- Manejo de irregularidades compartido

## Integración Técnica
- **SkyTeam Hub**: Plataforma central de intercambio de datos
- **SkyTeam Rebooking Tool**: Reasignación automática en irregularidades
- **SkyTeam Round the World**: Tarifa especial multi-socio

## Reglas de Negocio
- Acumulación de puntos Club Premier en vuelos de socios según convenio
- Acceso a salas VIP SkyTeam con membresía Platino o superior
- Prioridad de equipaje extendida a todos los socios
`,
      },
      {
        id: 'doc-pasarela-pagos',
        name: 'Pasarela de Pagos',
        type: 'document',
        tags: ['pagos', 'integración', 'API', 'revenue'],
        createdAt: '2026-03-10T11:00:00Z',
        updatedAt: '2026-03-28T09:00:00Z',
        content: `# Integración de Pasarela de Pagos

## Proveedores

| Proveedor | Uso | Región |
|-----------|-----|--------|
| **Cybersource** | Tarjetas crédito/débito | Global |
| **PayPal** | Wallet digital | US, MX, EU |
| **MercadoPago** | Pagos locales LATAM | MX, AR, BR |
| **OXXO Pay** | Pago en efectivo | MX |

## Flujo de Pago
1. Cliente selecciona método de pago
2. Tokenización de datos sensibles (PCI DSS Level 1)
3. Autorización con el banco emisor
4. Confirmación y emisión de boleto
5. Settlement T+1 (tarjetas) o T+3 (métodos alternativos)

## Reglas de Fraude
- 3D Secure obligatorio en transacciones >USD $500
- Score de fraude con Cybersource Decision Manager
- Blacklist de BINs y correos electrónicos
- Validación de IP vs país de emisión de tarjeta
`,
      },
    ],
  },
  {
    id: 'folder-regulatorio',
    name: 'Regulatorio y Compliance',
    type: 'folder',
    createdAt: '2026-02-15T08:00:00Z',
    updatedAt: '2026-03-29T10:00:00Z',
    children: [
      {
        id: 'doc-proteccion-datos',
        name: 'Protección de Datos (LFPDPPP)',
        type: 'document',
        tags: ['privacidad', 'compliance', 'datos-personales'],
        createdAt: '2026-02-15T08:00:00Z',
        updatedAt: '2026-03-29T10:00:00Z',
        content: `# Protección de Datos Personales

## Marco Legal
- **LFPDPPP**: Ley Federal de Protección de Datos Personales en Posesión de los Particulares
- **RGPD/GDPR**: Aplica para pasajeros de origen/destino UE
- **CCPA**: Aplica para residentes de California

## Datos que Recopilamos

| Categoría | Ejemplos | Base Legal |
|-----------|----------|-----------|
| Identificación | Nombre, pasaporte, INE | Contrato de transporte |
| Contacto | Email, teléfono | Consentimiento |
| Financieros | Tarjeta (tokenizada) | Contrato |
| Viaje | Itinerario, preferencias | Contrato + consentimiento |
| Salud | Necesidades especiales | Consentimiento explícito |

## Retención de Datos
- Datos de reserva: 5 años post-vuelo (obligación fiscal)
- Datos de lealtad: mientras la cuenta esté activa
- Datos de pago: solo token, nunca PAN completo
- Logs de acceso: 12 meses

## Derechos ARCO
- **Acceso**: Consulta de datos en 15 días hábiles
- **Rectificación**: Corrección en 15 días hábiles
- **Cancelación**: Eliminación cuando no haya obligación legal
- **Oposición**: Opt-out de comunicaciones comerciales
`,
      },
      {
        id: 'doc-regulacion-aerea',
        name: 'Regulación Aeronáutica',
        type: 'document',
        tags: ['regulación', 'aviación', 'compliance', 'operaciones'],
        createdAt: '2026-03-01T09:00:00Z',
        updatedAt: '2026-03-28T11:00:00Z',
        content: `# Regulación Aeronáutica Aplicable

## Autoridades
- **AFAC** (Agencia Federal de Aviación Civil): Regulador mexicano
- **FAA** (Federal Aviation Administration): Vuelos a/desde EUA
- **EASA** (European Union Aviation Safety Agency): Vuelos a/desde UE
- **IATA**: Estándares de la industria (no regulador, pero de facto obligatorio)

## Normativas Clave

### Derechos del Pasajero (NOM-078-SCT3)
- Información clara sobre condiciones del servicio
- Compensación por sobreventa (4x tarifa, max 400 UMA)
- Asistencia obligatoria en retrasos >2 horas
- Reembolso total si el retraso >4 horas

### Seguridad (Anexo 17 OACI)
- Screening obligatorio de pasajeros y equipaje
- Verificación contra listas de no-vuelo (TSA No Fly List)
- Protocolo de artículos prohibidos según regulación vigente

### Accesibilidad
- Obligación de transportar sillas de ruedas sin cargo
- Asistencia obligatoria para pasajeros con discapacidad
- Perros guía en cabina sin cargo ni restricción
`,
      },
    ],
  },
  {
    id: 'folder-kpis',
    name: 'KPIs y Métricas',
    type: 'folder',
    createdAt: '2026-03-15T08:00:00Z',
    updatedAt: '2026-03-29T12:00:00Z',
    children: [
      {
        id: 'doc-kpis-operacionales',
        name: 'KPIs Operacionales',
        type: 'document',
        tags: ['KPI', 'operaciones', 'métricas'],
        createdAt: '2026-03-15T08:00:00Z',
        updatedAt: '2026-03-29T12:00:00Z',
        content: `# KPIs Operacionales

## Puntualidad
- **OTP (On-Time Performance)**: % de vuelos que salen dentro de 15min de la hora programada
  - Objetivo: ≥85%
  - Benchmark industria: 80%
- **D0**: % de vuelos que salen exactamente a la hora programada
  - Objetivo: ≥50%

## Ocupación
- **Load Factor**: Pasajeros transportados / asientos disponibles
  - Objetivo: ≥82% anual
  - Estacional: ≥90% en temporada alta, ≥70% en baja
- **Break-even Load Factor**: Ocupación mínima para cubrir costos
  - Actual: ~72%

## Regularidad
- **Completion Rate**: % de vuelos operados vs programados
  - Objetivo: ≥99%
- **Diversion Rate**: % de vuelos desviados a aeropuerto alterno
  - Objetivo: <0.5%

## Equipaje
- **Mishandled Baggage Rate**: Maletas perdidas o dañadas por cada 1,000 pasajeros
  - Objetivo: <3.0
  - Benchmark IATA: 5.6
`,
      },
      {
        id: 'doc-kpis-comerciales',
        name: 'KPIs Comerciales',
        type: 'document',
        tags: ['KPI', 'revenue', 'métricas', 'comercial'],
        createdAt: '2026-03-18T10:00:00Z',
        updatedAt: '2026-03-29T15:00:00Z',
        content: `# KPIs Comerciales

## Revenue
- **RASK** (Revenue per ASK): Ingreso por asiento-kilómetro disponible
- **Yield**: Ingreso promedio por pasajero por kilómetro volado
- **Ancillary Revenue %**: Porcentaje de ingresos ancilares sobre total
  - Objetivo: ≥15% del ingreso total

## Distribución
- **Direct Channel Share**: % de ventas por canales propios (web + app)
  - Objetivo: ≥45%
- **NDC Adoption**: % de ventas vía NDC vs GDS legacy
  - Objetivo: ≥30% para 2027

## Satisfacción
- **NPS** (Net Promoter Score): Índice de recomendación
  - Objetivo: ≥45
- **CSAT** (Customer Satisfaction): Satisfacción post-vuelo
  - Objetivo: ≥4.2/5.0
- **FCR** (First Contact Resolution): Resolución en primer contacto
  - Objetivo: ≥75%
`,
      },
    ],
  },
  {
    id: 'folder-canales',
    name: 'Canales de Venta',
    type: 'folder',
    createdAt: '2026-01-25T09:00:00Z',
    updatedAt: '2026-03-28T14:00:00Z',
    children: [
      {
        id: 'doc-canal-web',
        name: 'Canal Web (cenzontle.com)',
        type: 'document',
        tags: ['canales', 'web', 'distribución', 'pasajero'],
        createdAt: '2026-01-25T09:00:00Z',
        updatedAt: '2026-03-20T10:00:00Z',
        content: `# Canal Web — cenzontle.com

## Funcionalidades
- Búsqueda y compra de vuelos
- Check-in online (48h antes)
- Gestión de reservas (cambio, cancelación)
- Selección de asiento y servicios adicionales
- Pago con múltiples métodos (tarjeta, PayPal, OXXO Pay)

## Stack Tecnológico
- Frontend: Next.js + React
- Backend: Microservicios en Node.js y Java
- CDN: Akamai para assets estáticos
- WAF: Cloudflare para protección DDoS

## Métricas de Rendimiento
- **Uptime SLA**: 99.95%
- **Time to Interactive**: <3s en 4G
- **Conversion Rate**: ~2.8% (búsqueda → compra)
- **Tráfico mensual**: ~12M visitas únicas
`,
      },
      {
        id: 'doc-canal-app',
        name: 'App Móvil',
        type: 'document',
        tags: ['canales', 'mobile', 'distribución', 'pasajero'],
        createdAt: '2026-02-01T10:00:00Z',
        updatedAt: '2026-03-22T11:00:00Z',
        content: `# App Móvil — la aerolínea

## Plataformas
- **iOS**: Swift/SwiftUI, mínimo iOS 16
- **Android**: Kotlin/Jetpack Compose, mínimo Android 10

## Features Exclusivas (vs Web)
- Pase de abordar en Apple Wallet / Google Pay
- Notificaciones push de cambios de puerta/retrasos
- Tracking de equipaje en tiempo real
- Biometría (Face ID / fingerprint) para login

## Integración con Servicios
- Firebase para push notifications
- Amadeus Mobile SDK para búsqueda de vuelos
- Apple Maps / Google Maps para navegación en aeropuerto

## Métricas
- **Usuarios activos mensuales**: ~2.5M
- **Rating App Store**: 4.6/5.0
- **Rating Play Store**: 4.3/5.0
- **Crash-free rate**: ≥99.5%
`,
      },
      {
        id: 'doc-canal-callcenter',
        name: 'Call Center',
        type: 'document',
        tags: ['canales', 'servicio-al-cliente', 'distribución'],
        createdAt: '2026-02-10T14:00:00Z',
        updatedAt: '2026-03-18T16:00:00Z',
        content: `# Call Center

## Líneas de Atención
- **Nacional**: 800-021-4000 (24/7)
- **Internacional**: +52-55-5133-4000
- **Club Premier Titanio**: Línea dedicada con atención prioritaria

## Capacidades
- Reservaciones nuevas y modificaciones
- Servicios especiales (UMNR, silla de ruedas, mascotas)
- Reclamos y compensaciones
- Soporte técnico para app/web

## Métricas Operativas
- **ASA** (Average Speed of Answer): <60 segundos
- **Abandonment Rate**: <5%
- **FCR** (First Contact Resolution): ≥75%
- **AHT** (Average Handle Time): ~8 minutos

## Tecnología
- ACD: Genesys Cloud
- CRM: Salesforce Service Cloud
- IVR: Menú automatizado con reconocimiento de voz
- Chatbot: IBM Watson para autoservicio (Tier 0)
`,
      },
      {
        id: 'doc-canal-agencias',
        name: 'Agencias de Viajes',
        type: 'document',
        tags: ['canales', 'distribución', 'GDS', 'comercial'],
        createdAt: '2026-02-15T09:00:00Z',
        updatedAt: '2026-03-25T10:00:00Z',
        content: `# Canal de Agencias de Viajes

## Tipos de Agencia
- **OTAs** (Online Travel Agencies): Despegar, Booking, Expedia
- **TMCs** (Travel Management Companies): CWT, BCD Travel, Amex GBT
- **Agencias tradicionales**: Consolidadores y minoristas

## Distribución GDS
- **Amadeus**: 55% del volumen de agencias
- **Sabre**: 30%
- **Travelport**: 15%

## Comisiones
- Comisión base: 1% sobre tarifa neta (eliminada en 2024, solo incentivos)
- Override de volumen: 2-5% según acuerdo anual
- Incentivos trimestrales por crecimiento de segmento

## NDC (New Distribution Capability)
- Migración progresiva de GDS a NDC
- NDC ofrece contenido diferenciado (bundles, ancilares)
- Surcharge de USD $5 por segmento en GDS legacy (a partir de Q3 2026)
`,
      },
    ],
  },
  {
    id: 'folder-flota',
    name: 'Flota y Operaciones',
    type: 'folder',
    createdAt: '2026-02-01T08:00:00Z',
    updatedAt: '2026-03-29T09:00:00Z',
    children: [
      {
        id: 'doc-tipos-aeronave',
        name: 'Tipos de Aeronave',
        type: 'document',
        tags: ['flota', 'aeronave', 'operaciones'],
        createdAt: '2026-02-01T08:00:00Z',
        updatedAt: '2026-03-29T09:00:00Z',
        content: `# Flota de la aerolínea

## Aeronaves en Operación

| Tipo | Cantidad | Capacidad | Rango | Uso principal |
|------|----------|-----------|-------|---------------|
| B737-800 | 42 | 160 pax | 5,400 km | Doméstico + Centroamérica |
| B737 MAX 8 | 18 | 174 pax | 6,500 km | Doméstico + Caribe |
| B737 MAX 9 | 12 | 186 pax | 6,500 km | Doméstico alta demanda |
| B787-8 | 10 | 243 pax | 13,600 km | Europa, Asia, Sudamérica |
| B787-9 | 8 | 274 pax | 14,100 km | Rutas de ultra largo alcance |
| E190 | 21 | 99 pax | 4,500 km | Rutas regionales (Regional Connect) |

## Configuración de Cabina (B787-9)
- **Clase Premier**: 36 asientos lie-flat (1-2-1)
- **AM Plus**: 28 asientos con extra legroom
- **Turista**: 210 asientos estándar (3-3-3)

## Mantenimiento
- **Check A**: Cada 500-800 horas de vuelo (~2 meses)
- **Check C**: Cada 18-24 meses
- **Check D**: Cada 6-10 años (overhaul completo)
`,
      },
      {
        id: 'doc-rutas',
        name: 'Red de Rutas',
        type: 'document',
        tags: ['rutas', 'operaciones', 'red', 'comercial'],
        createdAt: '2026-02-10T10:00:00Z',
        updatedAt: '2026-03-27T14:00:00Z',
        content: `# Red de Rutas

## Hubs
- **MEX** (Ciudad de México): Hub principal, 85% de conexiones
- **GDL** (Guadalajara): Hub secundario doméstico
- **MTY** (Monterrey): Hub secundario doméstico/US

## Cobertura

### Doméstico
- 44 destinos en México
- Frecuencia promedio: 3-8 vuelos diarios en rutas principales
- Rutas troncales: MEX-CUN, MEX-GDL, MEX-MTY, MEX-TIJ

### Internacional
- **Norteamérica**: 22 ciudades en EUA, 3 en Canadá
- **Centroamérica/Caribe**: 12 destinos
- **Sudamérica**: 7 destinos (BOG, SCL, EZE, GRU, LIM, UIO, CCS)
- **Europa**: 4 destinos (MAD, CDG, AMS, LHR)
- **Asia**: 2 destinos (NRT, ICN)

## Reglas de Programación
- Slot coordination en aeropuertos Level 3 (LHR, CDG, NRT)
- Minimum turn time: 45min doméstico, 90min internacional
- Crew rest requirements según regulación AFAC
`,
      },
      {
        id: 'folder-aeropuertos',
        name: 'Aeropuertos',
        type: 'folder',
        createdAt: '2026-02-20T08:00:00Z',
        updatedAt: '2026-03-28T10:00:00Z',
        children: [
          {
            id: 'doc-aicm',
            name: 'AICM (MEX)',
            type: 'document',
            tags: ['aeropuerto', 'MEX', 'hub', 'operaciones'],
            createdAt: '2026-02-20T08:00:00Z',
            updatedAt: '2026-03-28T10:00:00Z',
            content: `# AICM — Aeropuerto Internacional de la Ciudad de México (MEX)

## Datos Generales
- **Código IATA**: MEX
- **Terminales**: T1 (AM doméstico + algunos internacionales), T2 (AM internacional)
- **Operaciones AM diarias**: ~350 vuelos
- **Pasajeros anuales AM**: ~22M

## Instalaciones la aerolínea
- **Sala Premier T2**: Capacidad 250 personas, servicio de alimentos y bar
- **Sala Premier T1**: Capacidad 120 personas
- **Counters check-in**: 42 posiciones en T2, 28 en T1
- **Kioscos autoservicio**: 24 unidades (12 por terminal)

## Conexiones Inter-terminal
- Aerotrén gratuito entre T1 y T2 (frecuencia cada 3min)
- MCT (Minimum Connecting Time):
  - T2→T2: 60 minutos
  - T1→T2 o T2→T1: 120 minutos
  - Doméstico→Internacional: 90 minutos
`,
          },
          {
            id: 'doc-aifa',
            name: 'AIFA (NLU)',
            type: 'document',
            tags: ['aeropuerto', 'NLU', 'operaciones'],
            createdAt: '2026-03-01T09:00:00Z',
            updatedAt: '2026-03-25T11:00:00Z',
            content: `# AIFA — Aeropuerto Internacional Felipe Ángeles (NLU)

## Datos Generales
- **Código IATA**: NLU
- **Ubicación**: Santa Lucía, Estado de México
- **Terminal**: 1 terminal única
- **Operaciones AM**: Limitadas, rutas seleccionadas

## Consideraciones Operativas
- Transporte terrestre desde CDMX: ~1.5-2h en autobús
- Sin conexión directa con MEX (no son co-terminales)
- Reservas NLU no son intercambiables con MEX sin cargo
- Menor disponibilidad de servicios premium

## Rutas AM desde NLU
- Domésticas seleccionadas: CUN, TIJ, MID, VER
- Frecuencia limitada vs MEX
`,
          },
        ],
      },
    ],
  },
  {
    id: 'folder-experiencia',
    name: 'Experiencia del Cliente',
    type: 'folder',
    createdAt: '2026-02-05T08:00:00Z',
    updatedAt: '2026-03-29T16:00:00Z',
    children: [
      {
        id: 'doc-journey-map',
        name: 'Customer Journey Map',
        type: 'document',
        tags: ['experiencia', 'journey', 'pasajero', 'servicio-al-cliente'],
        createdAt: '2026-02-05T08:00:00Z',
        updatedAt: '2026-03-29T16:00:00Z',
        content: `# Customer Journey Map

## Etapas del Viaje

### 1. Inspiración y Búsqueda
- Touchpoints: Web, App, Redes sociales, Agencias
- Pain points: Comparación de precios, fechas flexibles
- Oportunidad: Personalización con historial de búsquedas

### 2. Reserva y Compra
- Touchpoints: Web, App, Call center, Agencia
- Pain points: Proceso de pago, selección de ancilares
- Oportunidad: Upselling inteligente de clase y servicios

### 3. Pre-vuelo
- Touchpoints: Email/SMS de recordatorio, Check-in, App
- Pain points: Documentación, equipaje, llegada al aeropuerto
- Oportunidad: Check-in proactivo, info de puerta en tiempo real

### 4. En el Aeropuerto
- Touchpoints: Counter, Kiosko, Sala VIP, Puerta de embarque
- Pain points: Filas, cambios de puerta, retrasos
- Oportunidad: Navegación indoor, notificaciones contextuales

### 5. A Bordo
- Touchpoints: Tripulación, IFE, WiFi, Servicio de alimentos
- Pain points: Espacio, entretenimiento, conectividad
- Oportunidad: Personalización del servicio según perfil

### 6. Post-vuelo
- Touchpoints: Equipaje, Transporte, Encuesta NPS, CRM
- Pain points: Espera de equipaje, reclamos
- Oportunidad: Seguimiento proactivo, oferta de próximo viaje
`,
      },
      {
        id: 'doc-personas',
        name: 'Buyer Personas',
        type: 'document',
        tags: ['experiencia', 'personas', 'segmentación', 'comercial'],
        createdAt: '2026-02-15T10:00:00Z',
        updatedAt: '2026-03-20T14:00:00Z',
        content: `# Buyer Personas

## 1. Viajero de Negocios — "Carlos"
- **Edad**: 35-50
- **Frecuencia**: 2-4 vuelos/mes
- **Clase preferida**: Premier o AM Plus
- **Prioridades**: Puntualidad, WiFi, flexibilidad de cambio
- **Club Premier**: Platino o Titanio
- **Decisor**: La empresa paga, pero Carlos elige aerolínea

## 2. Viajero de Placer — "María"
- **Edad**: 25-40
- **Frecuencia**: 2-4 vuelos/año
- **Clase preferida**: Turista o AM Plus
- **Prioridades**: Precio, destino, experiencia
- **Club Premier**: Oro o sin membresía
- **Decisor**: Ella misma, investiga en OTAs y redes sociales

## 3. Familia Viajera — "Los García"
- **Composición**: 2 adultos + 1-3 niños
- **Frecuencia**: 1-2 viajes/año
- **Clase preferida**: Turista
- **Prioridades**: Precio total, equipaje incluido, asientos juntos
- **Pain point principal**: Costo total alto por múltiples boletos

## 4. VFR (Visiting Friends & Relatives) — "Don José"
- **Edad**: 55+
- **Frecuencia**: 2-3 vuelos/año
- **Clase**: Turista o Básica
- **Prioridades**: Precio, vuelo directo, asistencia
- **Necesidades especiales**: Asistencia en aeropuerto, check-in presencial
`,
      },
      {
        id: 'doc-comunicaciones',
        name: 'Estrategia de Comunicaciones',
        type: 'document',
        tags: ['comunicaciones', 'marketing', 'canales', 'pasajero'],
        createdAt: '2026-03-01T11:00:00Z',
        updatedAt: '2026-03-28T13:00:00Z',
        content: `# Estrategia de Comunicaciones

## Canales de Comunicación

| Canal | Uso principal | Frecuencia |
|-------|--------------|-----------|
| **Email** | Confirmaciones, ofertas, encuestas | Transaccional + 2x/semana promo |
| **Push (App)** | Alertas de vuelo, ofertas personalizadas | Contextual |
| **SMS** | Confirmación de compra, cambios de vuelo | Solo transaccional |
| **WhatsApp** | Soporte y servicio al cliente | On-demand |

## Reglas de Contacto
- Máximo 3 comunicaciones promocionales por semana
- Opt-out inmediato obligatorio (CAN-SPAM, LFPDPPP)
- No enviar promos 24h antes del vuelo (solo info operativa)
- Segmentación por historial, tier y preferencias

## Personalización
- Motor de recomendación basado en historial de rutas
- Precio dinámico en emails según disponibilidad en tiempo real
- Contenido adaptado por idioma (ES, EN, PT, FR)
`,
      },
      {
        id: 'folder-feedback',
        name: 'Feedback y Encuestas',
        type: 'folder',
        createdAt: '2026-03-05T09:00:00Z',
        updatedAt: '2026-03-29T10:00:00Z',
        children: [
          {
            id: 'doc-encuesta-nps',
            name: 'Encuesta NPS Post-vuelo',
            type: 'document',
            tags: ['NPS', 'encuesta', 'experiencia', 'métricas'],
            createdAt: '2026-03-05T09:00:00Z',
            updatedAt: '2026-03-29T10:00:00Z',
            content: `# Encuesta NPS Post-vuelo

## Metodología
- Enviada por email 24h después del aterrizaje
- Pregunta principal: "¿Qué tan probable es que recomiende la aerolínea?" (0-10)
- Seguida de 3-5 preguntas de satisfacción por etapa del viaje

## Clasificación
- **Promotores** (9-10): Leales, recomiendan activamente
- **Pasivos** (7-8): Satisfechos pero vulnerables a competencia
- **Detractores** (0-6): Insatisfechos, riesgo de churn

## Análisis
- NPS = % Promotores - % Detractores
- Segmentación por ruta, clase, tier Club Premier
- Text mining de comentarios abiertos para detectar temas
- Dashboard en tiempo real para equipo de CX

## Acciones por Score
- **Detractor con comentario**: Escalación a equipo de recuperación (<48h)
- **Promotor**: Invitación a programa de referidos
- **Pasivo**: Oferta personalizada para siguiente viaje
`,
          },
          {
            id: 'doc-quejas-reclamos',
            name: 'Proceso de Quejas y Reclamos',
            type: 'document',
            tags: ['quejas', 'servicio-al-cliente', 'proceso', 'compliance'],
            createdAt: '2026-03-10T14:00:00Z',
            updatedAt: '2026-03-28T16:00:00Z',
            content: `# Proceso de Quejas y Reclamos

## Canales de Recepción
- Formulario web (cenzontle.com/contacto)
- Call center (opción 3 del IVR)
- Redes sociales (Twitter/X @AM_Escucha)
- PROFECO (quejas formales regulatorias)

## SLAs de Respuesta

| Tipo | Primer contacto | Resolución |
|------|----------------|------------|
| Equipaje dañado | 24h | 15 días |
| Equipaje perdido | Inmediato | 21 días (IATA) |
| Sobreventa | En el momento | Inmediato |
| Retraso/cancelación | En el momento | 30 días (compensación) |
| Servicio a bordo | 48h | 15 días |
| Cobro indebido | 48h | 30 días |

## Compensaciones Estándar
- **Voucher de viaje**: $500-$5,000 MXN según gravedad
- **Puntos Club Premier**: 1,000-10,000 puntos
- **Upgrade**: Para siguiente vuelo del pasajero
- **Reembolso parcial/total**: Según política y regulación
`,
          },
        ],
      },
    ],
  },
  {
    id: 'folder-seguridad',
    name: 'Seguridad y TI',
    type: 'folder',
    createdAt: '2026-02-20T08:00:00Z',
    updatedAt: '2026-03-29T14:00:00Z',
    children: [
      {
        id: 'doc-arquitectura-ti',
        name: 'Arquitectura de Sistemas',
        type: 'document',
        tags: ['arquitectura', 'sistemas', 'tecnología'],
        createdAt: '2026-02-20T08:00:00Z',
        updatedAt: '2026-03-29T14:00:00Z',
        content: `# Arquitectura de Sistemas

## Capas

### Capa de Presentación
- Web: Next.js (cenzontle.com)
- Mobile: Swift (iOS) + Kotlin (Android)
- Kioscos: Aplicación embebida (Electron)

### Capa de Servicios
- API Gateway: Kong
- Microservicios: Node.js + Java Spring Boot
- Event Bus: Apache Kafka
- Service Mesh: Istio

### Capa de Datos
- Transaccional: PostgreSQL (reservas, pagos)
- Analítica: Snowflake (data warehouse)
- Cache: Redis (sesiones, inventario hot)
- Search: Elasticsearch (búsqueda de vuelos)

### Infraestructura
- Cloud: AWS (primary) + Azure (DR)
- Container orchestration: EKS (Kubernetes)
- CI/CD: GitHub Actions + ArgoCD
- Monitoring: Datadog + PagerDuty
`,
      },
      {
        id: 'doc-seguridad-info',
        name: 'Políticas de Seguridad Informática',
        type: 'document',
        tags: ['seguridad', 'compliance', 'tecnología'],
        createdAt: '2026-03-01T08:00:00Z',
        updatedAt: '2026-03-28T15:00:00Z',
        content: `# Políticas de Seguridad Informática

## Estándares
- **PCI DSS Level 1**: Obligatorio por procesamiento de tarjetas
- **ISO 27001**: Certificación vigente del SGSI
- **SOC 2 Type II**: Para servicios cloud internos

## Control de Acceso
- MFA obligatorio para todos los empleados
- SSO vía Okta para aplicaciones internas
- Principio de menor privilegio (RBAC)
- Revisión trimestral de accesos

## Gestión de Vulnerabilidades
- Escaneo semanal con Qualys
- Pentest externo semestral
- Bug bounty program (HackerOne)
- Patch management: críticos <24h, altos <7 días

## Respuesta a Incidentes
- SOC 24/7 con Splunk SIEM
- Playbooks para top 10 escenarios
- RTO: 4h para sistemas críticos
- RPO: 1h para datos transaccionales
`,
      },
      {
        id: 'doc-disaster-recovery',
        name: 'Plan de Recuperación ante Desastres',
        type: 'document',
        tags: ['disaster-recovery', 'continuidad', 'operaciones', 'tecnología'],
        createdAt: '2026-03-10T09:00:00Z',
        updatedAt: '2026-03-27T11:00:00Z',
        content: `# Plan de Recuperación ante Desastres (DRP)

## Clasificación de Sistemas

| Tier | RTO | RPO | Ejemplos |
|------|-----|-----|----------|
| **Tier 1** | 1h | 15min | PSS, DCS, Pagos |
| **Tier 2** | 4h | 1h | Web, App, CRM |
| **Tier 3** | 24h | 4h | BI, Reportes, Email marketing |
| **Tier 4** | 72h | 24h | Desarrollo, Testing |

## Estrategia Multi-región
- **Primary**: AWS us-east-1 (Virginia)
- **DR**: Azure West US (California)
- **Data replication**: Real-time para Tier 1, async para Tier 2+

## Pruebas
- **Tabletop exercise**: Trimestral
- **Failover drill**: Semestral (fin de semana de baja demanda)
- **Full DR activation**: Anual

## Comunicación en Crisis
- Árbol de llamadas: CTO → VP Ops → Directors → Teams
- War room virtual: Teams channel #incident-response
- Status page: status.cenzontle.com
`,
      },
    ],
  },
  {
    id: 'folder-rrhh',
    name: 'Recursos Humanos',
    type: 'folder',
    createdAt: '2026-02-10T08:00:00Z',
    updatedAt: '2026-03-29T11:00:00Z',
    children: [
      {
        id: 'doc-estructura-org',
        name: 'Estructura Organizacional',
        type: 'document',
        tags: ['organización', 'equipo', 'estructura'],
        createdAt: '2026-02-10T08:00:00Z',
        updatedAt: '2026-03-29T11:00:00Z',
        content: `# Estructura Organizacional

## Dirección General
- **CEO**: Dirección estratégica y relación con consejo
- **CFO**: Finanzas, tesorería, relación con inversionistas
- **COO**: Operaciones de vuelo, mantenimiento, aeropuertos
- **CCO**: Comercial, revenue management, distribución
- **CTO**: Tecnología, transformación digital, data
- **CHRO**: Recursos humanos, cultura, capacitación

## Áreas Operativas Clave
- **Operaciones de Vuelo**: ~2,800 pilotos
- **Sobrecargos**: ~4,200 tripulantes de cabina
- **Mantenimiento**: ~3,500 técnicos
- **Aeropuertos**: ~2,000 agentes de servicio
- **Call Center**: ~800 agentes
- **Corporativo**: ~1,200 empleados

## Total de Empleados: ~14,500
`,
      },
      {
        id: 'doc-capacitacion',
        name: 'Programas de Capacitación',
        type: 'document',
        tags: ['capacitación', 'equipo', 'proceso'],
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-25T14:00:00Z',
        content: `# Programas de Capacitación

## Capacitación Obligatoria

### Tripulación de Vuelo
- **Initial training**: 6 meses (pilotos), 8 semanas (sobrecargos)
- **Recurrent**: Anual — procedimientos de emergencia, CRM, security
- **Type rating**: Por tipo de aeronave (B737, B787, E190)
- **Simulador**: Mínimo 4 sesiones anuales por piloto

### Personal de Tierra
- **Inducción**: 2 semanas — cultura, sistemas, procesos
- **DGR** (Dangerous Goods Regulations): Cada 2 años
- **Servicio al cliente**: Anual — manejo de conflictos, diversidad
- **Sistemas**: Amadeus, DCS, según función

## Plataforma de Aprendizaje
- LMS: Cornerstone OnDemand
- Contenido propio + proveedores externos (LinkedIn Learning)
- Gamificación con badges y leaderboards
- Tracking de horas de capacitación por empleado (objetivo: 40h/año)
`,
      },
      {
        id: 'doc-beneficios-empleados',
        name: 'Beneficios de Empleados',
        type: 'document',
        tags: ['beneficios', 'equipo', 'lealtad'],
        createdAt: '2026-03-05T11:00:00Z',
        updatedAt: '2026-03-20T09:00:00Z',
        content: `# Beneficios para Empleados

## Boletos de Empleado
- **Space available**: 90% de descuento en tarifa base (sujeto a disponibilidad)
- **Pases familiares**: Cónyuge + hijos — 75% de descuento
- **Buddy passes**: 2 pases anuales para amigos — 50% de descuento
- Restricción: No aplica en temporada alta (Semana Santa, Navidad, verano)

## Beneficios Financieros
- Fondo de ahorro: 13% de aportación patronal
- Vales de despensa: $2,500/mes
- Seguro de gastos médicos mayores: cobertura familiar
- Seguro de vida: 24 meses de salario

## Beneficios de Bienestar
- Gimnasio corporativo en oficinas centrales
- Programa de asistencia al empleado (EAP)
- Horario flexible para posiciones corporativas
- Home office: 2 días/semana para elegibles

## Convenios
- Descuentos en hoteles partner (Marriott, Hilton, IHG)
- Tarifa preferente en renta de autos (Hertz, National)
- Descuento en tiendas duty free
`,
      },
    ],
  },
  {
    id: 'folder-cargo',
    name: 'Cargo y Logística',
    type: 'folder',
    createdAt: '2026-03-01T08:00:00Z',
    updatedAt: '2026-03-29T13:00:00Z',
    children: [
      {
        id: 'doc-servicios-cargo',
        name: 'Servicios de Carga',
        type: 'document',
        tags: ['cargo', 'logística', 'operaciones', 'revenue'],
        createdAt: '2026-03-01T08:00:00Z',
        updatedAt: '2026-03-29T13:00:00Z',
        content: `# la aerolínea Cargo

## Productos

| Producto | Descripción | SLA |
|----------|-------------|-----|
| **General Cargo** | Carga estándar | Next available flight |
| **Express** | Prioridad en siguiente vuelo | Garantizado en primer vuelo |
| **Perishables** | Productos perecederos (flores, alimentos) | Cadena de frío garantizada |
| **Pharma** | Productos farmacéuticos (GDP compliant) | Temperatura controlada 2-8°C |
| **Live Animals** | Animales vivos (AVI) | Manejo especializado |
| **Valuables** | Alto valor (VAL) | Custodia y seguro obligatorio |

## Capacidad Belly Cargo
- **B737-800**: ~2,000 kg (bodega inferior)
- **B787-8**: ~12,000 kg (contenedores LD3)
- **B787-9**: ~15,000 kg

## Documentación
- AWB (Air Waybill): Obligatorio para toda carga
- Declaración de mercancías peligrosas (DGD) si aplica
- Certificado fitosanitario para perecederos de exportación
`,
      },
      {
        id: 'doc-handling-cargo',
        name: 'Handling y Almacenaje',
        type: 'document',
        tags: ['cargo', 'aeropuerto', 'proceso', 'logística'],
        createdAt: '2026-03-10T09:00:00Z',
        updatedAt: '2026-03-28T10:00:00Z',
        content: `# Handling y Almacenaje de Carga

## Proceso de Aceptación
1. Recepción en bodega de carga (cut-off: 4h antes del vuelo)
2. Pesaje, medición y verificación de documentos
3. Screening de seguridad (rayos X o inspección física)
4. Palletización o containerización (ULD)
5. Transferencia a rampa para carga en aeronave

## Almacenaje

| Tipo | Costo diario/kg | Free time |
|------|-----------------|-----------|
| General | $2.50 MXN | 48h |
| Refrigerado | $8.00 MXN | 24h |
| Seguridad (VAL) | $15.00 MXN | 24h |

## KPIs de Carga
- **Cargo revenue per ATK**: Ingreso por tonelada-km disponible
- **Load factor cargo**: Peso transportado / capacidad disponible
- **Claims ratio**: Reclamos por daño o pérdida / envíos totales
- **Dwell time**: Tiempo promedio en bodega (objetivo: <6h)
`,
      },
    ],
  },
];

export const mockDefiniciones: DefinicionNode[] = [
  ...baseDefiniciones,
  ...generateAdditionalDefiniciones(),
];
