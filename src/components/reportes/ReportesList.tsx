/**
 * ReportesList Component
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
import { ReportData, ReportTableColumn } from '@/types/reportes';
import { ReportesListRow } from './ReportesListRow';

interface ReportesListProps {
  data: ReportData[];
  columns: ReportTableColumn[];
  caption?: string;
  onDownload?: (report: ReportData) => void;
  onDelete?: (report: ReportData) => void;
  onRetry?: (report: ReportData) => void;
}

export function ReportesList({
  data,
  columns,
  caption,
  onDownload,
  onDelete,
  onRetry
}: ReportesListProps) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-x-auto max-w-full">
      <Table>
        {caption && <TableCaption>{caption}</TableCaption>}

        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className="font-semibold">
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center text-zinc-500 h-24">
                No hay reportes disponibles
              </TableCell>
            </TableRow>
          ) : (
            data.map((item) => (
              <ReportesListRow
                key={item.id}
                data={item}
                columns={columns}
                onDownload={onDownload}
                onDelete={onDelete}
                onRetry={onRetry}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
