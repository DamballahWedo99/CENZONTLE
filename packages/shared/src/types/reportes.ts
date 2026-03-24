/**
 * Type definitions for Reports Dashboard
 * Single source of truth for data structure (DRY principle)
 *
 * SOLID Principles Applied:
 * - Interface Segregation: Focused, minimal interfaces
 * - Open/Closed: New report types can be added via configuration
 * - Dependency Inversion: Components depend on these abstractions
 */

/**
 * Report Types - Extensible enumeration
 * Open/Closed: Add new types without modifying existing code
 */
export enum ReportType {
  FINANCIAL = 'financial',
  OPERATIONAL = 'operational',
  SALES = 'sales',
  INVENTORY = 'inventory',
  PERSONNEL = 'personnel',
  MAINTENANCE = 'maintenance',
  CUSTOM = 'custom'
}

/**
 * Report Status - Lifecycle tracking
 */
export enum ReportStatus {
  DRAFT = 'draft',
  GENERATING = 'generating',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ARCHIVED = 'archived'
}

/**
 * Report Format - Export options
 */
export enum ReportFormat {
  PDF = 'pdf',
  EXCEL = 'excel',
  CSV = 'csv',
  JSON = 'json'
}

/**
 * Report Priority - Scheduling and execution order
 */
export enum ReportPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent'
}

/**
 * Date Range Preset - Quick filters
 */
export enum DateRangePreset {
  TODAY = 'today',
  YESTERDAY = 'yesterday',
  LAST_7_DAYS = 'last_7_days',
  LAST_30_DAYS = 'last_30_days',
  THIS_MONTH = 'this_month',
  LAST_MONTH = 'last_month',
  THIS_QUARTER = 'this_quarter',
  THIS_YEAR = 'this_year',
  CUSTOM = 'custom'
}

/**
 * Core Report Data Structure
 * Single Responsibility: Represents a single report entity
 */
export interface ReportData {
  id: string;
  name: string;
  type: ReportType;
  status: ReportStatus;
  priority: ReportPriority;
  createdAt: Date;
  completedAt?: Date;
  createdBy: string;
  department: string;
  description: string;
  dateRange: {
    start: Date;
    end: Date;
  };
  format: ReportFormat;
  size?: number; // File size in bytes
  downloadUrl?: string;
}

/**
 * Report Template Configuration
 * Open/Closed: Define templates without modifying component logic
 */
export interface ReportTemplate {
  id: string;
  name: string;
  type: ReportType;
  description: string;
  icon?: string;
  defaultFormat: ReportFormat;
  availableFormats: ReportFormat[];
  requiredFields: string[];
  estimatedTime: number; // in minutes
}

/**
 * Report Filter Criteria
 * Interface Segregation: Only filter-related properties
 */
export interface ReportFilters {
  type?: ReportType;
  status?: ReportStatus;
  priority?: ReportPriority;
  department?: string;
  dateRange?: DateRangePreset;
  customDateRange?: {
    start: Date;
    end: Date;
  };
  searchQuery?: string;
}

/**
 * Report Generation Request
 * Single Responsibility: Represents a report creation request
 */
export interface ReportGenerationRequest {
  templateId: string;
  name: string;
  description?: string;
  dateRange: {
    start: Date;
    end: Date;
  };
  format: ReportFormat;
  priority: ReportPriority;
  department: string;
  additionalParams?: Record<string, unknown>;
}

/**
 * Table Column Configuration
 * Open/Closed: Extend without modifying component logic
 */
export interface ReportTableColumn {
  key: keyof ReportData | 'actions';
  label: string;
  sortable?: boolean;
  formatter?: (value: ReportData[keyof ReportData]) => string;
  width?: string;
}

/**
 * Dashboard Statistics
 * Single Responsibility: Aggregated metrics display
 */
export interface ReportStatistics {
  total: number;
  completed: number;
  generating: number;
  failed: number;
  totalSizeGB: number;
  reportsThisMonth: number;
  reportsThisWeek: number;
}

/**
 * Export Options Configuration
 * Open/Closed: Add new export options without modifying components
 */
export interface ExportOptions {
  format: ReportFormat;
  includeMetadata: boolean;
  compress: boolean;
  password?: string;
}
