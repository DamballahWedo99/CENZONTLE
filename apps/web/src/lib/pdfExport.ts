/**
 * PDF Export Utility
 *
 * Generates PDF reports from dashboard data
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { TransaccionMensualData, TransaccionMensualTableColumn } from '@cenzontle/shared';

interface ExportPDFOptions {
  data: TransaccionMensualData[];
  columns: TransaccionMensualTableColumn[];
  totals: TransaccionMensualData;
  stats: {
    totalTransacciones: number;
    transaccionesEnviadas3DS: number;
    aprobacionCompuesta: number;
    aprobacion3DS: number;
  };
  filters: {
    region: string;
    year: number;
    tab?: string;
    dateRange?: DateRange;
  };
}

export function exportToPDF(options: ExportPDFOptions) {
  const { data, columns, totals, stats, filters } = options;

  // Create PDF document
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  // Title
  doc.setFontSize(18);
  doc.text('Dashboard de Aprobación', 14, 15);

  // Filters info
  doc.setFontSize(10);
  let yPos = 25;
  doc.text(`Región: ${filters.region}`, 14, yPos);

  // Show date range if available
  if (filters.dateRange?.from && filters.dateRange?.to) {
    const fromDate = format(filters.dateRange.from, "dd MMM yyyy", { locale: es });
    const toDate = format(filters.dateRange.to, "dd MMM yyyy", { locale: es });
    doc.text(`Período: ${fromDate} - ${toDate}`, 80, yPos);
  } else {
    doc.text(`Año: ${filters.year}`, 80, yPos);
  }

  if (filters.tab) {
    doc.text(`Vista: ${filters.tab}`, 160, yPos);
  }

  // Statistics
  yPos += 10;
  doc.setFontSize(12);
  doc.text('Estadísticas', 14, yPos);

  yPos += 7;
  doc.setFontSize(9);
  doc.text(`Aprobación Compuesta: ${stats.aprobacionCompuesta.toFixed(2)}%`, 14, yPos);
  doc.text(`Aprobación 3DS: ${stats.aprobacion3DS.toFixed(2)}%`, 80, yPos);

  yPos += 5;
  doc.text(`Transacciones Totales: ${stats.totalTransacciones.toLocaleString('es-MX')}`, 14, yPos);
  doc.text(`Transacciones Enviadas a 3DS: ${stats.transaccionesEnviadas3DS.toLocaleString('es-MX')}`, 80, yPos);

  // Prepare table data
  const tableHeaders = columns.map(col => col.label);
  const tableRows = data.map(item =>
    columns.map(col => {
      const value = item[col.key];
      return col.formatter ? col.formatter(value) : String(value);
    })
  );

  // Prepare totals row (will be added as footer, not body)
  const totalsRow = columns.map(col => {
    const value = totals[col.key];
    return col.formatter ? col.formatter(value) : String(value);
  });

  // Generate table
  autoTable(doc, {
    head: [tableHeaders],
    body: tableRows,
    startY: yPos + 10,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [71, 85, 105], textColor: 255 },
    footStyles: { fillColor: [241, 245, 249], textColor: 0, fontStyle: 'bold' },
    foot: [totalsRow],
    didParseCell: (data) => {
      // Color rows based on approval rate (only body section)
      if (data.section === 'body') {
        const rowData = tableRows[data.row.index];
        const aprobacionFinalIndex = columns.findIndex(col => col.key === 'aprobacionFinal');

        if (aprobacionFinalIndex !== -1) {
          const aprobacionValue = parseFloat(rowData[aprobacionFinalIndex].replace('%', ''));

          if (aprobacionValue < 83) {
            data.cell.styles.fillColor = [254, 226, 226]; // red-100
          } else {
            data.cell.styles.fillColor = [220, 252, 231]; // green-100
          }
        }
      }
    }
  });

  // Footer
  const pageCount = doc.getNumberOfPages();
  doc.setFontSize(8);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.text(
      `Generado el ${new Date().toLocaleDateString('es-MX')} - Página ${i} de ${pageCount}`,
      14,
      doc.internal.pageSize.height - 10
    );
  }

  // Save PDF
  const fileName = `Dashboard_Aprobacion_${filters.region}_${filters.year}.pdf`;
  doc.save(fileName);
}
