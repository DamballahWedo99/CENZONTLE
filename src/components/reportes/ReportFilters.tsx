/**
 * ReportFilters Component
 *
 * Responsibility: Filter controls for report list
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles filter UI and state
 * - Interface Segregation: Focused filter interface
 * - KISS: Simple controlled inputs
 */

'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  ReportFilters as IReportFilters,
  ReportType,
  ReportStatus,
  ReportPriority
} from '@/types/reportes';

interface ReportFiltersProps {
  filters: IReportFilters;
  onFiltersChange: (filters: IReportFilters) => void;
}

export function ReportFilters({ filters, onFiltersChange }: ReportFiltersProps) {
  const handleReset = () => {
    onFiltersChange({});
  };

  const updateFilter = <K extends keyof IReportFilters>(
    key: K,
    value: IReportFilters[K]
  ) => {
    onFiltersChange({
      ...filters,
      [key]: value || undefined,
    });
  };

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 max-w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Filtros
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          className="text-xs"
        >
          Limpiar Filtros
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-w-full">
        {/* Search */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Buscar
          </label>
          <Input
            type="text"
            placeholder="Nombre del reporte..."
            value={filters.searchQuery || ''}
            onChange={(e) => updateFilter('searchQuery', e.target.value)}
          />
        </div>

        {/* Type Filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Tipo
          </label>
          <select
            value={filters.type || ''}
            onChange={(e) => updateFilter('type', e.target.value as ReportType)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 text-sm"
          >
            <option value="">Todos</option>
            <option value={ReportType.FINANCIAL}>Financiero</option>
            <option value={ReportType.OPERATIONAL}>Operacional</option>
            <option value={ReportType.SALES}>Ventas</option>
            <option value={ReportType.INVENTORY}>Inventario</option>
            <option value={ReportType.PERSONNEL}>Personal</option>
            <option value={ReportType.MAINTENANCE}>Mantenimiento</option>
            <option value={ReportType.CUSTOM}>Personalizado</option>
          </select>
        </div>

        {/* Status Filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Estado
          </label>
          <select
            value={filters.status || ''}
            onChange={(e) => updateFilter('status', e.target.value as ReportStatus)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 text-sm"
          >
            <option value="">Todos</option>
            <option value={ReportStatus.DRAFT}>Borrador</option>
            <option value={ReportStatus.GENERATING}>Generando</option>
            <option value={ReportStatus.COMPLETED}>Completado</option>
            <option value={ReportStatus.FAILED}>Fallido</option>
            <option value={ReportStatus.ARCHIVED}>Archivado</option>
          </select>
        </div>

        {/* Priority Filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Prioridad
          </label>
          <select
            value={filters.priority || ''}
            onChange={(e) => updateFilter('priority', e.target.value as ReportPriority)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 text-sm"
          >
            <option value="">Todas</option>
            <option value={ReportPriority.LOW}>Baja</option>
            <option value={ReportPriority.NORMAL}>Normal</option>
            <option value={ReportPriority.HIGH}>Alta</option>
            <option value={ReportPriority.URGENT}>Urgente</option>
          </select>
        </div>

        {/* Department Filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Departamento
          </label>
          <Input
            type="text"
            placeholder="Nombre del departamento..."
            value={filters.department || ''}
            onChange={(e) => updateFilter('department', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
