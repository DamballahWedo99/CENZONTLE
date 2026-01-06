/**
 * ReportesStats Component
 *
 * Responsibility: Display aggregated statistics in card format
 *
 * SOLID Principles:
 * - Single Responsibility: Only displays statistics, no business logic
 * - Interface Segregation: Receives only statistics data
 * - KISS: Simple mapping of stats to cards
 */

import { ReportStatistics } from '@/types/reportes';

interface ReportesStatsProps {
  stats: ReportStatistics;
}

export function ReportesStats({ stats }: ReportesStatsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Reports */}
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Total Reportes
        </p>
        <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mt-2">
          {stats.total}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          {stats.totalSizeGB.toFixed(2)} GB almacenados
        </p>
      </div>

      {/* Completed */}
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Completados
        </p>
        <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-2">
          {stats.completed}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          {stats.reportsThisWeek} esta semana
        </p>
      </div>

      {/* Generating */}
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          En Proceso
        </p>
        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-2">
          {stats.generating}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Generando actualmente
        </p>
      </div>

      {/* Failed */}
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Fallidos
        </p>
        <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-2">
          {stats.failed}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Requieren atención
        </p>
      </div>
    </div>
  );
}
