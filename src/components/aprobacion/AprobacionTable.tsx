/**
 * AprobacionTable Component
 *
 * Responsibility: Data presentation using shadcn Table
 *
 * SOLID Principles:
 * - Single Responsibility: Only renders table structure
 * - Liskov Substitution: Type-safe props ensure predictable behavior
 * - Interface Segregation: Receives only what it needs (data + columns)
 * - KISS: Simple mapping logic, no complex state
 */

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TransaccionMensualData, TransaccionMensualTableColumn } from '@/types/aprobacion';
import { AprobacionTableRow } from './AprobacionTableRow';

interface AprobacionTableProps {
  data: TransaccionMensualData[];
  columns: TransaccionMensualTableColumn[];
  totals: TransaccionMensualData;
  caption?: string;
}

export function AprobacionTable({ data, columns, totals, caption }: AprobacionTableProps) {
  // Filter out any totals rows from data
  const filteredData = data.filter((item) => item.id !== 'totals');

  return (
    <div className="h-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-auto">
      <Table className="min-w-full" style={{ height: '100%' }}>
        {caption && <TableCaption>{caption}</TableCaption>}

        <TableHeader className="sticky top-0 z-10 bg-white dark:bg-zinc-950">
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className="font-semibold min-w-[140px]"
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody style={{ height: '100%' }}>
          {filteredData.length === 0 ? (
            <TableRow>
              <td colSpan={columns.length} className="p-2 text-center text-zinc-500 h-24">
                No hay datos disponibles
              </td>
            </TableRow>
          ) : (
            <>
              {filteredData.map((item) => (
                <AprobacionTableRow
                  key={item.id}
                  data={item}
                  columns={columns}
                  totalRows={filteredData.length}
                />
              ))}

              {/* Totals Row */}
              <TableRow className="font-bold bg-zinc-100 dark:bg-zinc-800 border-t-2">
                {columns.map((column) => {
                  const value = totals[column.key];
                  const displayValue = column.formatter ? column.formatter(value) : String(value);
                  return (
                    <TableCell key={column.key}>
                      {displayValue}
                    </TableCell>
                  );
                })}
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
