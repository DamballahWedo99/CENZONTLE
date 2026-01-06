/**
 * ReportGenerator Component
 *
 * Responsibility: Report creation form with template selection
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles report generation form
 * - Open/Closed: New templates can be added without modifying component
 * - DRY: Reuses template configuration for form fields
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ReportTemplate,
  ReportFormat,
  ReportPriority,
  ReportGenerationRequest,
  DateRangePreset
} from '@/types/reportes';

interface ReportGeneratorProps {
  templates: ReportTemplate[];
  onGenerate: (request: ReportGenerationRequest) => void;
}

export function ReportGenerator({ templates, onGenerate }: ReportGeneratorProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [reportName, setReportName] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<ReportFormat>(ReportFormat.PDF);
  const [priority, setPriority] = useState<ReportPriority>(ReportPriority.NORMAL);
  const [datePreset, setDatePreset] = useState<DateRangePreset>(DateRangePreset.THIS_MONTH);
  const [department, setDepartment] = useState('');

  const handleGenerate = () => {
    if (!selectedTemplate || !reportName) {
      alert('Por favor completa todos los campos obligatorios');
      return;
    }

    const dateRange = getDateRangeFromPreset(datePreset);

    const request: ReportGenerationRequest = {
      templateId: selectedTemplate,
      name: reportName,
      description,
      dateRange,
      format,
      priority,
      department,
    };

    onGenerate(request);

    // Reset form
    setReportName('');
    setDescription('');
    setSelectedTemplate('');
    setDepartment('');
  };

  const getDateRangeFromPreset = (preset: DateRangePreset) => {
    const today = new Date();
    const start = new Date();
    const end = new Date();

    switch (preset) {
      case DateRangePreset.TODAY:
        break;
      case DateRangePreset.YESTERDAY:
        start.setDate(today.getDate() - 1);
        end.setDate(today.getDate() - 1);
        break;
      case DateRangePreset.LAST_7_DAYS:
        start.setDate(today.getDate() - 7);
        break;
      case DateRangePreset.LAST_30_DAYS:
        start.setDate(today.getDate() - 30);
        break;
      case DateRangePreset.THIS_MONTH:
        start.setDate(1);
        break;
      case DateRangePreset.LAST_MONTH:
        start.setMonth(today.getMonth() - 1, 1);
        end.setMonth(today.getMonth(), 0);
        break;
      case DateRangePreset.THIS_QUARTER:
        const quarter = Math.floor(today.getMonth() / 3);
        start.setMonth(quarter * 3, 1);
        break;
      case DateRangePreset.THIS_YEAR:
        start.setMonth(0, 1);
        break;
    }

    return { start, end };
  };

  const selectedTemplateData = templates.find(t => t.id === selectedTemplate);

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800 max-w-full">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
        Generar Nuevo Reporte
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-full">
        {/* Template Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Tipo de Reporte *
          </label>
          <select
            value={selectedTemplate}
            onChange={(e) => {
              setSelectedTemplate(e.target.value);
              const template = templates.find(t => t.id === e.target.value);
              if (template) {
                setFormat(template.defaultFormat);
              }
            }}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50"
          >
            <option value="">Selecciona un tipo...</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          {selectedTemplateData && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {selectedTemplateData.description}
            </p>
          )}
        </div>

        {/* Report Name */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Nombre del Reporte *
          </label>
          <Input
            type="text"
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            placeholder="Ej: Reporte Mensual Enero 2026"
            className="w-full"
          />
        </div>

        {/* Department */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Departamento
          </label>
          <Input
            type="text"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="Ej: Finanzas"
            className="w-full"
          />
        </div>

        {/* Date Range Preset */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Período
          </label>
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DateRangePreset)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50"
          >
            <option value={DateRangePreset.TODAY}>Hoy</option>
            <option value={DateRangePreset.YESTERDAY}>Ayer</option>
            <option value={DateRangePreset.LAST_7_DAYS}>Últimos 7 días</option>
            <option value={DateRangePreset.LAST_30_DAYS}>Últimos 30 días</option>
            <option value={DateRangePreset.THIS_MONTH}>Este mes</option>
            <option value={DateRangePreset.LAST_MONTH}>Mes pasado</option>
            <option value={DateRangePreset.THIS_QUARTER}>Este trimestre</option>
            <option value={DateRangePreset.THIS_YEAR}>Este año</option>
          </select>
        </div>

        {/* Format */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Formato
          </label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ReportFormat)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50"
            disabled={!selectedTemplateData}
          >
            {selectedTemplateData?.availableFormats.map((fmt) => (
              <option key={fmt} value={fmt}>
                {fmt.toUpperCase()}
              </option>
            )) || <option value={ReportFormat.PDF}>PDF</option>}
          </select>
        </div>

        {/* Priority */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Prioridad
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as ReportPriority)}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50"
          >
            <option value={ReportPriority.LOW}>Baja</option>
            <option value={ReportPriority.NORMAL}>Normal</option>
            <option value={ReportPriority.HIGH}>Alta</option>
            <option value={ReportPriority.URGENT}>Urgente</option>
          </select>
        </div>

        {/* Description */}
        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Descripción (Opcional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Información adicional sobre el reporte..."
            rows={3}
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50"
          />
        </div>
      </div>

      {/* Generate Button */}
      <div className="mt-6 flex justify-end">
        <Button
          onClick={handleGenerate}
          disabled={!selectedTemplate || !reportName}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          Generar Reporte
        </Button>
      </div>
    </div>
  );
}
