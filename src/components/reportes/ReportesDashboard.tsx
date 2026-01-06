/**
 * ReportesDashboard Component
 *
 * Responsibility: Data management, state coordination, layout
 *
 * SOLID Principles:
 * - Single Responsibility: Manages data and layout, delegates presentation
 * - Open/Closed: New report types/templates can be added via configuration
 * - Dependency Inversion: Depends on abstractions (types/interfaces)
 * - DRY: Column and template configuration centralized and reusable
 */

'use client';

import { useState } from 'react';
import { ReportesList } from './ReportesList';
import { ReportesStats } from './ReportesStats';
import { ReportGenerator } from './ReportGenerator';
import { ReportFilters } from './ReportFilters';
import {
  ReportData,
  ReportTableColumn,
  ReportTemplate,
  ReportType,
  ReportStatus,
  ReportPriority,
  ReportFormat,
  ReportGenerationRequest,
  ReportFilters as IReportFilters,
  ReportStatistics
} from '@/types/reportes';

// Column configuration (DRY - define once, use everywhere)
const COLUMNS: ReportTableColumn[] = [
  { key: 'name', label: 'Nombre', sortable: true },
  { key: 'type', label: 'Tipo', sortable: true },
  {
    key: 'createdAt',
    label: 'Fecha Creación',
    sortable: true,
    formatter: (value) => new Date(value as Date).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  },
  { key: 'createdBy', label: 'Creado por', sortable: true },
  { key: 'department', label: 'Departamento', sortable: true },
  { key: 'format', label: 'Formato' },
  {
    key: 'size',
    label: 'Tamaño',
    formatter: (value) => {
      if (!value) return 'N/A';
      const sizeInMB = (value as number) / (1024 * 1024);
      return sizeInMB < 1
        ? `${(sizeInMB * 1024).toFixed(0)} KB`
        : `${sizeInMB.toFixed(2)} MB`;
    }
  },
  { key: 'status', label: 'Estado', sortable: true },
  { key: 'priority', label: 'Prioridad', sortable: true },
  { key: 'actions', label: 'Acciones', width: 'w-[180px]' }
];

// Report Templates Configuration (Open/Closed - add new templates without modifying component)
const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'financial-monthly',
    name: 'Reporte Financiero Mensual',
    type: ReportType.FINANCIAL,
    description: 'Estado financiero consolidado mensual',
    defaultFormat: ReportFormat.PDF,
    availableFormats: [ReportFormat.PDF, ReportFormat.EXCEL],
    requiredFields: ['period', 'department'],
    estimatedTime: 5
  },
  {
    id: 'operational-daily',
    name: 'Reporte Operacional Diario',
    type: ReportType.OPERATIONAL,
    description: 'Resumen de operaciones diarias',
    defaultFormat: ReportFormat.PDF,
    availableFormats: [ReportFormat.PDF, ReportFormat.CSV],
    requiredFields: ['date'],
    estimatedTime: 2
  },
  {
    id: 'sales-summary',
    name: 'Resumen de Ventas',
    type: ReportType.SALES,
    description: 'Análisis de ventas por período',
    defaultFormat: ReportFormat.EXCEL,
    availableFormats: [ReportFormat.EXCEL, ReportFormat.CSV, ReportFormat.PDF],
    requiredFields: ['period', 'region'],
    estimatedTime: 3
  },
  {
    id: 'inventory-status',
    name: 'Estado de Inventario',
    type: ReportType.INVENTORY,
    description: 'Inventario actual y movimientos',
    defaultFormat: ReportFormat.EXCEL,
    availableFormats: [ReportFormat.EXCEL, ReportFormat.CSV],
    requiredFields: ['warehouse'],
    estimatedTime: 4
  },
  {
    id: 'personnel-attendance',
    name: 'Asistencia de Personal',
    type: ReportType.PERSONNEL,
    description: 'Registro de asistencia y horas trabajadas',
    defaultFormat: ReportFormat.PDF,
    availableFormats: [ReportFormat.PDF, ReportFormat.EXCEL],
    requiredFields: ['period', 'department'],
    estimatedTime: 3
  },
  {
    id: 'maintenance-log',
    name: 'Bitácora de Mantenimiento',
    type: ReportType.MAINTENANCE,
    description: 'Registro de mantenimientos realizados',
    defaultFormat: ReportFormat.PDF,
    availableFormats: [ReportFormat.PDF, ReportFormat.EXCEL],
    requiredFields: ['period', 'aircraft'],
    estimatedTime: 5
  },
  {
    id: 'custom-report',
    name: 'Reporte Personalizado',
    type: ReportType.CUSTOM,
    description: 'Reporte configurado a medida',
    defaultFormat: ReportFormat.PDF,
    availableFormats: [ReportFormat.PDF, ReportFormat.EXCEL, ReportFormat.CSV, ReportFormat.JSON],
    requiredFields: [],
    estimatedTime: 10
  }
];

// Mock data for demonstration
const MOCK_DATA: ReportData[] = [
  {
    id: '1',
    name: 'Reporte Financiero Diciembre 2025',
    type: ReportType.FINANCIAL,
    status: ReportStatus.COMPLETED,
    priority: ReportPriority.HIGH,
    createdAt: new Date('2026-01-02T09:30:00'),
    completedAt: new Date('2026-01-02T09:35:00'),
    createdBy: 'María González',
    department: 'Finanzas',
    description: 'Cierre financiero del mes de diciembre',
    dateRange: {
      start: new Date('2025-12-01'),
      end: new Date('2025-12-31')
    },
    format: ReportFormat.PDF,
    size: 2457600, // 2.4 MB
    downloadUrl: '/downloads/financial-dec-2025.pdf'
  },
  {
    id: '2',
    name: 'Operaciones Diarias - 01 Enero',
    type: ReportType.OPERATIONAL,
    status: ReportStatus.COMPLETED,
    priority: ReportPriority.NORMAL,
    createdAt: new Date('2026-01-01T18:00:00'),
    completedAt: new Date('2026-01-01T18:02:00'),
    createdBy: 'Carlos Ramírez',
    department: 'Operaciones',
    description: 'Resumen operativo del día',
    dateRange: {
      start: new Date('2026-01-01'),
      end: new Date('2026-01-01')
    },
    format: ReportFormat.PDF,
    size: 856000, // 856 KB
    downloadUrl: '/downloads/ops-daily-20260101.pdf'
  },
  {
    id: '3',
    name: 'Ventas Q4 2025',
    type: ReportType.SALES,
    status: ReportStatus.GENERATING,
    priority: ReportPriority.URGENT,
    createdAt: new Date('2026-01-02T10:15:00'),
    createdBy: 'Laura Martínez',
    department: 'Ventas',
    description: 'Análisis de ventas del cuarto trimestre',
    dateRange: {
      start: new Date('2025-10-01'),
      end: new Date('2025-12-31')
    },
    format: ReportFormat.EXCEL
  },
  {
    id: '4',
    name: 'Inventario Almacén Central',
    type: ReportType.INVENTORY,
    status: ReportStatus.COMPLETED,
    priority: ReportPriority.NORMAL,
    createdAt: new Date('2026-01-01T14:20:00'),
    completedAt: new Date('2026-01-01T14:24:00'),
    createdBy: 'Roberto Sánchez',
    department: 'Logística',
    description: 'Estado actual del inventario',
    dateRange: {
      start: new Date('2026-01-01'),
      end: new Date('2026-01-01')
    },
    format: ReportFormat.EXCEL,
    size: 1245000, // 1.2 MB
    downloadUrl: '/downloads/inventory-20260101.xlsx'
  },
  {
    id: '5',
    name: 'Asistencia Diciembre 2025',
    type: ReportType.PERSONNEL,
    status: ReportStatus.FAILED,
    priority: ReportPriority.HIGH,
    createdAt: new Date('2026-01-02T08:00:00'),
    createdBy: 'Ana Fernández',
    department: 'Recursos Humanos',
    description: 'Registro de asistencia del personal',
    dateRange: {
      start: new Date('2025-12-01'),
      end: new Date('2025-12-31')
    },
    format: ReportFormat.PDF
  },
  {
    id: '6',
    name: 'Mantenimiento Aeronaves - Diciembre',
    type: ReportType.MAINTENANCE,
    status: ReportStatus.COMPLETED,
    priority: ReportPriority.HIGH,
    createdAt: new Date('2026-01-02T07:30:00'),
    completedAt: new Date('2026-01-02T07:35:00'),
    createdBy: 'Jorge Morales',
    department: 'Mantenimiento',
    description: 'Bitácora completa de mantenimientos',
    dateRange: {
      start: new Date('2025-12-01'),
      end: new Date('2025-12-31')
    },
    format: ReportFormat.PDF,
    size: 4567000, // 4.5 MB
    downloadUrl: '/downloads/maintenance-dec-2025.pdf'
  },
  {
    id: '7',
    name: 'Análisis Personalizado - Marketing',
    type: ReportType.CUSTOM,
    status: ReportStatus.DRAFT,
    priority: ReportPriority.LOW,
    createdAt: new Date('2026-01-01T16:45:00'),
    createdBy: 'Patricia López',
    department: 'Marketing',
    description: 'Reporte personalizado de campañas',
    dateRange: {
      start: new Date('2025-11-01'),
      end: new Date('2025-12-31')
    },
    format: ReportFormat.EXCEL
  },
  {
    id: '8',
    name: 'Reporte Operacional Semanal',
    type: ReportType.OPERATIONAL,
    status: ReportStatus.ARCHIVED,
    priority: ReportPriority.NORMAL,
    createdAt: new Date('2025-12-28T10:00:00'),
    completedAt: new Date('2025-12-28T10:05:00'),
    createdBy: 'Carlos Ramírez',
    department: 'Operaciones',
    description: 'Resumen semanal archivado',
    dateRange: {
      start: new Date('2025-12-22'),
      end: new Date('2025-12-28')
    },
    format: ReportFormat.PDF,
    size: 1890000, // 1.9 MB
    downloadUrl: '/downloads/ops-week-52-2025.pdf'
  }
];

export function ReportesDashboard() {
  const [reports, setReports] = useState<ReportData[]>(MOCK_DATA);
  const [filters, setFilters] = useState<IReportFilters>({});

  // Calculate statistics
  const calculateStats = (): ReportStatistics => {
    const totalSize = reports.reduce((acc, r) => acc + (r.size || 0), 0);
    const now = new Date();
    const thisMonth = reports.filter(r =>
      r.createdAt.getMonth() === now.getMonth() &&
      r.createdAt.getFullYear() === now.getFullYear()
    );
    const thisWeek = reports.filter(r => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return r.createdAt >= weekAgo;
    });

    return {
      total: reports.length,
      completed: reports.filter(r => r.status === ReportStatus.COMPLETED).length,
      generating: reports.filter(r => r.status === ReportStatus.GENERATING).length,
      failed: reports.filter(r => r.status === ReportStatus.FAILED).length,
      totalSizeGB: totalSize / (1024 * 1024 * 1024),
      reportsThisMonth: thisMonth.length,
      reportsThisWeek: thisWeek.length
    };
  };

  // Apply filters to data
  const getFilteredReports = (): ReportData[] => {
    return reports.filter(report => {
      if (filters.type && report.type !== filters.type) return false;
      if (filters.status && report.status !== filters.status) return false;
      if (filters.priority && report.priority !== filters.priority) return false;
      if (filters.department && !report.department.toLowerCase().includes(filters.department.toLowerCase())) return false;
      if (filters.searchQuery && !report.name.toLowerCase().includes(filters.searchQuery.toLowerCase())) return false;
      return true;
    });
  };

  // Handle report generation
  const handleGenerateReport = (request: ReportGenerationRequest) => {
    const template = REPORT_TEMPLATES.find(t => t.id === request.templateId);
    if (!template) return;

    const newReport: ReportData = {
      id: `report-${Date.now()}`,
      name: request.name,
      type: template.type,
      status: ReportStatus.GENERATING,
      priority: request.priority,
      createdAt: new Date(),
      createdBy: 'Usuario Actual', // Would come from auth
      department: request.department,
      description: request.description || template.description,
      dateRange: request.dateRange,
      format: request.format
    };

    setReports([newReport, ...reports]);

    // Simulate report generation completion
    setTimeout(() => {
      setReports(prev => prev.map(r =>
        r.id === newReport.id
          ? {
              ...r,
              status: ReportStatus.COMPLETED,
              completedAt: new Date(),
              size: Math.floor(Math.random() * 5000000) + 500000,
              downloadUrl: `/downloads/${newReport.id}.${request.format}`
            }
          : r
      ));
    }, 3000);
  };

  // Handle report download
  const handleDownload = (report: ReportData) => {
    if (report.downloadUrl) {
      // Simulate download
      console.log('Downloading report:', report.name);
      alert(`Descargando: ${report.name} (${report.format.toUpperCase()})`);
    }
  };

  // Handle report deletion
  const handleDelete = (report: ReportData) => {
    if (confirm(`¿Estás seguro de eliminar "${report.name}"?`)) {
      setReports(reports.filter(r => r.id !== report.id));
    }
  };

  // Handle report retry
  const handleRetry = (report: ReportData) => {
    setReports(reports.map(r =>
      r.id === report.id
        ? { ...r, status: ReportStatus.GENERATING }
        : r
    ));

    // Simulate retry completion
    setTimeout(() => {
      setReports(prev => prev.map(r =>
        r.id === report.id
          ? {
              ...r,
              status: ReportStatus.COMPLETED,
              completedAt: new Date(),
              size: Math.floor(Math.random() * 5000000) + 500000,
              downloadUrl: `/downloads/${report.id}.${report.format}`
            }
          : r
      ));
    }, 3000);
  };

  const filteredReports = getFilteredReports();
  const stats = calculateStats();

  return (
    <div className="container mx-auto py-8 px-4 max-w-full overflow-x-hidden">
      {/* Header Section */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          Dashboard de Reportes
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-2">
          Generación y gestión de reportes - Aeroméxico
        </p>
      </header>

      {/* Statistics Cards */}
      <div className="mb-8">
        <ReportesStats stats={stats} />
      </div>

      {/* Report Generator */}
      <div className="mb-8 max-w-full">
        <ReportGenerator
          templates={REPORT_TEMPLATES}
          onGenerate={handleGenerateReport}
        />
      </div>

      {/* Filters */}
      <div className="mb-8 max-w-full">
        <ReportFilters
          filters={filters}
          onFiltersChange={setFilters}
        />
      </div>

      {/* Reports List */}
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 max-w-full">
        <ReportesList
          data={filteredReports}
          columns={COLUMNS}
          caption="Listado completo de reportes generados"
          onDownload={handleDownload}
          onDelete={handleDelete}
          onRetry={handleRetry}
        />
      </div>
    </div>
  );
}
