/**
 * Type definitions for Transacciones Mensuales Dashboard
 * Single source of truth for data structure (DRY principle)
 */

export interface TransaccionMensualData {
  id: string;
  mes: string;
  aprobacionBase: number;          // Porcentaje de aprobación base
  aprobacionRetry: number;         // Porcentaje de aprobación en retry
  aprobacionCompuesta: number;     // Porcentaje de aprobación compuesta
  trxAprobadasTotales: number;     // Cantidad de transacciones aprobadas
  trxEnviadasTotales: number;      // Cantidad de transacciones enviadas
  trxAuthCon3DS: number;           // Cantidad de transacciones autenticadas con 3DS
  pctAutenticadoCon3DS: number;    // Porcentaje autenticado con 3DS
  aprobadoCon3DS: number;          // Porcentaje aprobado con 3DS
  aprobacionFinal: number;         // Porcentaje de aprobación final
}

/**
 * Table column configuration
 * Open/Closed principle - extend without modifying component logic
 */
export interface TransaccionMensualTableColumn {
  key: keyof TransaccionMensualData;
  label: string;
  sortable?: boolean;
  formatter?: (value: TransaccionMensualData[keyof TransaccionMensualData]) => string;
}
