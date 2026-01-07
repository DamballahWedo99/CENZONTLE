/**
 * AprobacionDashboard Component
 *
 * Responsibility: Data management, state coordination, layout
 *
 * SOLID Principles:
 * - Single Responsibility: Manages data and layout, delegates presentation to table
 * - Open/Closed: New columns can be added to COLUMNS array without changing component logic
 * - Dependency Inversion: Depends on abstractions (types/interfaces)
 * - DRY: Column configuration centralized and reusable
 */

'use client';

import { useState, useMemo } from 'react';
import type { DateRange } from 'react-day-picker';
import { AprobacionTable } from './AprobacionTable';
import { DataSourceFilter, type DataSource } from './DataSourceFilter';
import { YearSelector } from './YearSelector';
import { AprobacionD3Chart } from './chart/AprobacionD3Chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Download, BarChart3, Table as TableIcon } from 'lucide-react';
import { exportToPDF } from '@/lib/pdfExport';
import {
  TransaccionMensualData,
  TransaccionMensualTableColumn
} from '@/types/aprobacion';

/**
 * Formatter utilities (DRY principle)
 */
const formatPercentage = (value: number): string => {
  return `${value.toFixed(2)}%`;
};

const formatNumber = (value: number): string => {
  return value.toLocaleString('es-MX');
};

// Column configuration (DRY - define once, use everywhere)
const COLUMNS: TransaccionMensualTableColumn[] = [
  {
    key: 'mes',
    label: 'Mes',
    sortable: true
  },
  {
    key: 'aprobacionBase',
    label: 'Aprobación base',
    sortable: true,
    formatter: (value) => formatPercentage(value as number)
  },
  {
    key: 'aprobacionRetry',
    label: 'Aprobación retry',
    sortable: true,
    formatter: (value) => formatPercentage(value as number)
  },
  {
    key: 'aprobacionCompuesta',
    label: 'Aprobación compuesta',
    sortable: true,
    formatter: (value) => formatPercentage(value as number)
  },
  {
    key: 'trxAprobadasTotales',
    label: 'Trx aprobadas totales',
    sortable: true,
    formatter: (value) => formatNumber(value as number)
  },
  {
    key: 'trxEnviadasTotales',
    label: 'Trx enviadas totales',
    sortable: true,
    formatter: (value) => formatNumber(value as number)
  },
  {
    key: 'trxAuthCon3DS',
    label: 'Transacciones auth con 3DS',
    sortable: true,
    formatter: (value) => formatNumber(value as number)
  },
  {
    key: 'pctAutenticadoCon3DS',
    label: '% Autenticado con 3DS',
    sortable: true,
    formatter: (value) => formatPercentage(value as number)
  },
  {
    key: 'aprobadoCon3DS',
    label: 'Aprobado con 3DS',
    sortable: true,
    formatter: (value) => formatPercentage(value as number)
  },
  {
    key: 'aprobacionFinal',
    label: 'Aprobación final',
    sortable: true,
    formatter: (value) => formatPercentage(value as number)
  }
];

/**
 * Mock data for 12 months with coherent mathematical relationships
 *
 * Coherence rules:
 * - trxAprobadasTotales <= trxEnviadasTotales
 * - trxAuthCon3DS <= trxEnviadasTotales
 * - pctAutenticadoCon3DS = (trxAuthCon3DS / trxEnviadasTotales) * 100
 * - aprobacionFinal = (trxAprobadasTotales / trxEnviadasTotales) * 100
 * - aprobacionCompuesta ≈ aprobacionBase + aprobacionRetry
 */
const MOCK_DATA: TransaccionMensualData[] = [
  {
    id: '1',
    mes: 'Enero',
    aprobacionBase: 70.30,
    aprobacionRetry: 8.50,
    aprobacionCompuesta: 78.80,
    trxAprobadasTotales: 7880,
    trxEnviadasTotales: 10000,
    trxAuthCon3DS: 7000,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 75.20,
    aprobacionFinal: 82.50
  },
  {
    id: '2',
    mes: 'Febrero',
    aprobacionBase: 77.20,
    aprobacionRetry: 8.90,
    aprobacionCompuesta: 86.10,
    trxAprobadasTotales: 9458,
    trxEnviadasTotales: 10985,
    trxAuthCon3DS: 7689,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 82.50,
    aprobacionFinal: 89.20
  },
  {
    id: '3',
    mes: 'Marzo',
    aprobacionBase: 76.80,
    aprobacionRetry: 10.20,
    aprobacionCompuesta: 87.00,
    trxAprobadasTotales: 10440,
    trxEnviadasTotales: 12000,
    trxAuthCon3DS: 8400,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 83.10,
    aprobacionFinal: 89.80
  },
  {
    id: '4',
    mes: 'Abril',
    aprobacionBase: 72.10,
    aprobacionRetry: 9.20,
    aprobacionCompuesta: 81.30,
    trxAprobadasTotales: 8943,
    trxEnviadasTotales: 11000,
    trxAuthCon3DS: 7700,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 78.50,
    aprobacionFinal: 84.60
  },
  {
    id: '5',
    mes: 'Mayo',
    aprobacionBase: 78.10,
    aprobacionRetry: 9.40,
    aprobacionCompuesta: 87.50,
    trxAprobadasTotales: 11375,
    trxEnviadasTotales: 13000,
    trxAuthCon3DS: 9100,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 84.20,
    aprobacionFinal: 90.30
  },
  {
    id: '6',
    mes: 'Junio',
    aprobacionBase: 79.50,
    aprobacionRetry: 8.70,
    aprobacionCompuesta: 88.20,
    trxAprobadasTotales: 12348,
    trxEnviadasTotales: 14000,
    trxAuthCon3DS: 9800,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 85.30,
    aprobacionFinal: 91.10
  },
  {
    id: '7',
    mes: 'Julio',
    aprobacionBase: 80.20,
    aprobacionRetry: 8.30,
    aprobacionCompuesta: 88.50,
    trxAprobadasTotales: 13275,
    trxEnviadasTotales: 15000,
    trxAuthCon3DS: 10500,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 86.00,
    aprobacionFinal: 91.40
  },
  {
    id: '8',
    mes: 'Agosto',
    aprobacionBase: 78.90,
    aprobacionRetry: 9.60,
    aprobacionCompuesta: 88.50,
    trxAprobadasTotales: 12390,
    trxEnviadasTotales: 14000,
    trxAuthCon3DS: 9800,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 85.50,
    aprobacionFinal: 91.20
  },
  {
    id: '9',
    mes: 'Septiembre',
    aprobacionBase: 77.40,
    aprobacionRetry: 10.80,
    aprobacionCompuesta: 88.20,
    trxAprobadasTotales: 11466,
    trxEnviadasTotales: 13000,
    trxAuthCon3DS: 9100,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 84.80,
    aprobacionFinal: 90.80
  },
  {
    id: '10',
    mes: 'Octubre',
    aprobacionBase: 76.50,
    aprobacionRetry: 11.20,
    aprobacionCompuesta: 87.70,
    trxAprobadasTotales: 10524,
    trxEnviadasTotales: 12000,
    trxAuthCon3DS: 8400,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 83.90,
    aprobacionFinal: 90.50
  },
  {
    id: '11',
    mes: 'Noviembre',
    aprobacionBase: 69.50,
    aprobacionRetry: 10.80,
    aprobacionCompuesta: 80.30,
    trxAprobadasTotales: 8833,
    trxEnviadasTotales: 11000,
    trxAuthCon3DS: 7700,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 76.20,
    aprobacionFinal: 83.80
  },
  {
    id: '12',
    mes: 'Diciembre',
    aprobacionBase: 71.40,
    aprobacionRetry: 10.50,
    aprobacionCompuesta: 81.90,
    trxAprobadasTotales: 8190,
    trxEnviadasTotales: 10000,
    trxAuthCon3DS: 7000,
    pctAutenticadoCon3DS: 70.00,
    aprobadoCon3DS: 77.80,
    aprobacionFinal: 85.20
  }
];

export function AprobacionDashboard() {
  const [data] = useState<TransaccionMensualData[]>(MOCK_DATA);
  const [selectedSource, setSelectedSource] = useState<DataSource>('MIT');
  const [activeTab, setActiveTab] = useState<'general' | 'afops'>('general');
  const [selectedDateRange, setSelectedDateRange] = useState<DateRange | undefined>({
    from: new Date(2026, 0, 1),
    to: new Date(2026, 11, 31)
  });
  const [showChart, setShowChart] = useState(false);

  // Filter columns based on active tab (remove 3DS columns and retry for AFOPS)
  const visibleColumns = useMemo(() => {
    if (selectedSource === 'MIT' && activeTab === 'afops') {
      // Remove 3DS-related columns and retry column for AFOPS tab
      return COLUMNS.filter(
        col => !['aprobacionRetry', 'trxAuthCon3DS', 'pctAutenticadoCon3DS', 'aprobadoCon3DS'].includes(col.key as string)
      );
    }
    return COLUMNS;
  }, [selectedSource, activeTab]);

  // Statistics for dashboard header (memoized for performance)
  const stats = useMemo(() => {
    const totalTransacciones = data.reduce((sum, d) => sum + d.trxEnviadasTotales, 0);
    const transaccionesEnviadas3DS = data.reduce((sum, d) => sum + d.trxAuthCon3DS, 0);
    const transaccionesAprobadas = data.reduce((sum, d) => sum + d.trxAprobadasTotales, 0);
    const aprobacionCompuesta = data.reduce((sum, d) => sum + d.aprobacionCompuesta, 0) / data.length;
    const aprobacion3DS = data.reduce((sum, d) => sum + d.aprobadoCon3DS, 0) / data.length;
    const aprobacionBase = data.reduce((sum, d) => sum + d.aprobacionBase, 0) / data.length;
    const aprobacionFinal = data.reduce((sum, d) => sum + d.aprobacionFinal, 0) / data.length;

    return {
      totalTransacciones,
      transaccionesEnviadas3DS,
      transaccionesAprobadas,
      aprobacionCompuesta,
      aprobacion3DS,
      aprobacionBase,
      aprobacionFinal
    };
  }, [data]);

  // Totals row data (memoized for performance)
  const totals = useMemo(() => {
    const count = data.length;
    return {
      id: 'totals',
      mes: 'Total',
      aprobacionBase: data.reduce((sum, d) => sum + d.aprobacionBase, 0) / count,
      aprobacionRetry: data.reduce((sum, d) => sum + d.aprobacionRetry, 0) / count,
      aprobacionCompuesta: data.reduce((sum, d) => sum + d.aprobacionCompuesta, 0) / count,
      trxAprobadasTotales: data.reduce((sum, d) => sum + d.trxAprobadasTotales, 0),
      trxEnviadasTotales: data.reduce((sum, d) => sum + d.trxEnviadasTotales, 0),
      trxAuthCon3DS: data.reduce((sum, d) => sum + d.trxAuthCon3DS, 0),
      pctAutenticadoCon3DS: data.reduce((sum, d) => sum + d.pctAutenticadoCon3DS, 0) / count,
      aprobadoCon3DS: data.reduce((sum, d) => sum + d.aprobadoCon3DS, 0) / count,
      aprobacionFinal: data.reduce((sum, d) => sum + d.aprobacionFinal, 0) / count
    };
  }, [data]);

  // Handle PDF export
  const handleExportPDF = () => {
    const regionLabels: Record<DataSource, string> = {
      MIT: 'MIT (México)',
      DEUNA: 'DEUNA (Europa y Japón)',
      Scotiabank: 'Scotiabank (EUA)',
      Adyen: 'Adyen (Canadá y Brasil)',
      Worldpay: 'Worldpay (Resto del mundo)'
    };

    exportToPDF({
      data,
      columns: visibleColumns,
      totals,
      stats,
      filters: {
        region: regionLabels[selectedSource],
        year: selectedDateRange?.from?.getFullYear() ?? new Date().getFullYear(),
        tab: selectedSource === 'MIT' ? activeTab.toUpperCase() : undefined,
        dateRange: selectedDateRange
      }
    });
  };

  return (
    <div className="w-full py-8 px-4 flex flex-col gap-8">
      {/* Dashboard Title and Filter */}
      <div className="w-full flex-shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            Dashboard de Aprobación
          </h1>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowChart(!showChart)}
                >
                  {showChart ? (
                    <TableIcon className="h-4 w-4" />
                  ) : (
                    <BarChart3 className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{showChart ? 'Ver Tabla' : 'Ver Gráfica'}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleExportPDF}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Exportar PDF</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-4">
          {selectedSource === 'MIT' && (
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'general' | 'afops')}>
              <TabsList>
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="afops">AFOPS</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <YearSelector
            selectedDateRange={selectedDateRange}
            onDateRangeChange={setSelectedDateRange}
          />
          <DataSourceFilter
            selectedSource={selectedSource}
            onSourceChange={setSelectedSource}
          />
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="w-full grid grid-cols-1 md:grid-cols-4 gap-4 flex-shrink-0">
        {selectedSource === 'MIT' && activeTab === 'afops' ? (
          // AFOPS-specific cards (no 3DS metrics)
          <>
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Aprobación Base</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-2">
                {stats.aprobacionBase.toFixed(2)}%
              </p>
            </div>
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Aprobación Final</p>
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400 mt-2">
                {stats.aprobacionFinal.toFixed(2)}%
              </p>
            </div>
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Transacciones Aprobadas Totales</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-2">
                {stats.transaccionesAprobadas.toLocaleString('es-MX')}
              </p>
            </div>
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Transacciones Enviadas Totales</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mt-2">
                {stats.totalTransacciones.toLocaleString('es-MX')}
              </p>
            </div>
          </>
        ) : (
          // General cards (default with 3DS metrics)
          <>
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Aprobación Compuesta</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-2">
                {stats.aprobacionCompuesta.toFixed(2)}%
              </p>
            </div>
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Aprobación 3DS</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-2">
                {stats.aprobacion3DS.toFixed(2)}%
              </p>
            </div>
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Transacciones Totales</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mt-2">
                {stats.totalTransacciones.toLocaleString('es-MX')}
              </p>
            </div>
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Transacciones Enviadas a 3DS Totales</p>
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-2">
                {stats.transaccionesEnviadas3DS.toLocaleString('es-MX')}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Chart or Table Section */}
      {showChart ? (
        <div className="w-full flex-shrink-0">
          <AprobacionD3Chart
            data={data}
            config={{
              metrics: selectedSource === 'MIT' && activeTab === 'afops'
                ? [
                    {
                      key: 'aprobacionFinal',
                      label: 'Aprobación Final',
                      color: 'hsl(24.6 95% 53.1%)', // orange-600
                      type: 'area',
                      fillOpacity: 0.3,
                      strokeWidth: 2
                    }
                  ]
                : undefined // Use default metrics
            }}
          />
        </div>
      ) : (
        <div className="w-full flex-shrink-0">
          <AprobacionTable
            data={data}
            columns={visibleColumns}
            totals={totals}
          />
        </div>
      )}
    </div>
  );
}
