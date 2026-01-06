/**
 * ReportActions Component
 *
 * Responsibility: Action buttons for individual reports (download, preview, delete)
 *
 * SOLID Principles:
 * - Single Responsibility: Only renders action buttons
 * - Interface Segregation: Minimal props interface
 * - Open/Closed: New actions can be added via props
 */

import { Button } from '@/components/ui/button';
import { ReportData, ReportStatus } from '@/types/reportes';

interface ReportActionsProps {
  report: ReportData;
  onDownload?: (report: ReportData) => void;
  onDelete?: (report: ReportData) => void;
  onRetry?: (report: ReportData) => void;
}

export function ReportActions({
  report,
  onDownload,
  onDelete,
  onRetry
}: ReportActionsProps) {
  const canDownload = report.status === ReportStatus.COMPLETED && report.downloadUrl;
  const canRetry = report.status === ReportStatus.FAILED;

  return (
    <div className="flex gap-2 items-center justify-end">
      {/* Download Button */}
      {canDownload && onDownload && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDownload(report)}
          className="text-xs"
        >
          Descargar
        </Button>
      )}

      {/* Retry Button */}
      {canRetry && onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRetry(report)}
          className="text-xs text-orange-600 hover:text-orange-700"
        >
          Reintentar
        </Button>
      )}

      {/* Delete Button */}
      {onDelete && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDelete(report)}
          className="text-xs text-red-600 hover:text-red-700"
        >
          Eliminar
        </Button>
      )}
    </div>
  );
}
