/**
 * ReportesListRow Component
 *
 * Responsibility: Individual row presentation with formatting
 *
 * SOLID Principles:
 * - Single Responsibility: Only formats and renders individual row
 * - Open/Closed: New formatters can be added without changing component
 * - DRY: Reuses formatter functions from column config
 */

import { TableCell, TableRow } from '@/components/ui/table';
import {
  ReportData,
  ReportTableColumn,
  ReportStatus,
  ReportPriority,
  ReportType,
  ReportFormat
} from '@/types/reportes';
import { ReportActions } from './ReportActions';

interface ReportesListRowProps {
  data: ReportData;
  columns: ReportTableColumn[];
  onDownload?: (report: ReportData) => void;
  onDelete?: (report: ReportData) => void;
  onRetry?: (report: ReportData) => void;
}

export function ReportesListRow({
  data,
  columns,
  onDownload,
  onDelete,
  onRetry
}: ReportesListRowProps) {
  const getCellValue = (column: ReportTableColumn) => {
    if (column.key === 'actions') return '';
    const value = data[column.key];
    return column.formatter ? column.formatter(value) : String(value);
  };

  // Status Badge Renderer
  const getStatusBadge = (status: ReportStatus) => {
    const baseClasses = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";

    const variants = {
      [ReportStatus.DRAFT]: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
      [ReportStatus.GENERATING]: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      [ReportStatus.COMPLETED]: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      [ReportStatus.FAILED]: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
      [ReportStatus.ARCHIVED]: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
    };

    const labels = {
      [ReportStatus.DRAFT]: "BORRADOR",
      [ReportStatus.GENERATING]: "GENERANDO",
      [ReportStatus.COMPLETED]: "COMPLETADO",
      [ReportStatus.FAILED]: "FALLIDO",
      [ReportStatus.ARCHIVED]: "ARCHIVADO",
    };

    return (
      <span className={`${baseClasses} ${variants[status]}`}>
        {labels[status]}
      </span>
    );
  };

  // Priority Badge Renderer
  const getPriorityBadge = (priority: ReportPriority) => {
    const baseClasses = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";

    const variants = {
      [ReportPriority.LOW]: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
      [ReportPriority.NORMAL]: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      [ReportPriority.HIGH]: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
      [ReportPriority.URGENT]: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    };

    return (
      <span className={`${baseClasses} ${variants[priority]}`}>
        {priority.toUpperCase()}
      </span>
    );
  };

  // Type Badge Renderer
  const getTypeBadge = (type: ReportType) => {
    const baseClasses = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";
    const variant = "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900 dark:text-fuchsia-200";

    const labels = {
      [ReportType.FINANCIAL]: "Financiero",
      [ReportType.OPERATIONAL]: "Operacional",
      [ReportType.SALES]: "Ventas",
      [ReportType.INVENTORY]: "Inventario",
      [ReportType.PERSONNEL]: "Personal",
      [ReportType.MAINTENANCE]: "Mantenimiento",
      [ReportType.CUSTOM]: "Personalizado",
    };

    return (
      <span className={`${baseClasses} ${variant}`}>
        {labels[type]}
      </span>
    );
  };

  // Format Badge Renderer
  const getFormatBadge = (format: ReportFormat) => {
    return (
      <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
        {format.toUpperCase()}
      </span>
    );
  };

  const renderCell = (column: ReportTableColumn) => {
    if (column.key === 'status') {
      return getStatusBadge(data.status);
    }
    if (column.key === 'priority') {
      return getPriorityBadge(data.priority);
    }
    if (column.key === 'type') {
      return getTypeBadge(data.type);
    }
    if (column.key === 'format') {
      return getFormatBadge(data.format);
    }
    if (column.key === 'actions') {
      return (
        <ReportActions
          report={data}
          onDownload={onDownload}
          onDelete={onDelete}
          onRetry={onRetry}
        />
      );
    }
    return getCellValue(column);
  };

  return (
    <TableRow className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
      {columns.map((column) => (
        <TableCell key={column.key} className={column.width}>
          {renderCell(column)}
        </TableCell>
      ))}
    </TableRow>
  );
}
