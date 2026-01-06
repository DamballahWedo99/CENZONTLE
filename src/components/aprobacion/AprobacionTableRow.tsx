/**
 * AprobacionTableRow Component
 *
 * Responsibility: Individual row presentation with formatting
 *
 * SOLID Principles:
 * - Single Responsibility: Only formats and renders individual row
 * - Open/Closed: New formatters can be added without changing component
 * - DRY: Reuses formatter functions from column config
 * - KISS: Simplified to use only generic formatters, no special case logic
 */

import { TableCell, TableRow } from '@/components/ui/table';
import { TransaccionMensualData, TransaccionMensualTableColumn } from '@/types/aprobacion';

interface AprobacionTableRowProps {
  data: TransaccionMensualData;
  columns: TransaccionMensualTableColumn[];
  totalRows: number;
}

export function AprobacionTableRow({ data, columns, totalRows }: AprobacionTableRowProps) {
  const getCellValue = (column: TransaccionMensualTableColumn) => {
    const value = data[column.key];
    return column.formatter ? column.formatter(value) : String(value);
  };

  const rowHeight = `calc(100% / ${totalRows})`;

  // Determine row color based on aprobacionFinal
  const isLowApproval = data.aprobacionFinal < 83;
  const rowColorClass = isLowApproval
    ? 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/30'
    : 'bg-green-50 dark:bg-green-950/20 hover:bg-green-100 dark:hover:bg-green-950/30';

  return (
    <TableRow
      className={rowColorClass}
      style={{ height: rowHeight }}
    >
      {columns.map((column) => (
        <TableCell key={column.key}>
          {getCellValue(column)}
        </TableCell>
      ))}
    </TableRow>
  );
}
