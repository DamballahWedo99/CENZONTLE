/**
 * Reportes Page Route
 *
 * Responsibility: Route orchestration and data coordination
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles routing and top-level coordination
 * - KISS: Minimal logic, delegates to dashboard component
 * - Open/Closed: Can add metadata, layouts without changing dashboard
 */

import { ReportesDashboard } from '@/components/reportes/ReportesDashboard';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard de Reportes - Aeroméxico',
  description: 'Sistema de generación y gestión de reportes para Aeroméxico',
};

export default function ReportesPage() {
  return <ReportesDashboard />;
}
