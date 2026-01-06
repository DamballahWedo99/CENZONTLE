/**
 * Aprobación Page Route
 *
 * Responsibility: Route orchestration and data coordination
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles routing and top-level coordination
 * - KISS: Minimal logic, delegates to dashboard component
 * - Open/Closed: Can add metadata, layouts without changing dashboard
 */

import { AprobacionDashboard } from '@/components/aprobacion/AprobacionDashboard';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard de Aprobación - Aeroméxico',
  description: 'Sistema de gestión de solicitudes de aprobación para Aeroméxico',
};

export default function AprobacionPage() {
  return <AprobacionDashboard />;
}
