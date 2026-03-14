/**
 * Document Exporter
 *
 * Handles exporting AI-generated EpicDocuments to various file formats:
 * PDF (jspdf), Excel (exceljs), Word (docx), and CSV.
 */

import { EpicDocument } from '@/types/proyectos';

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s-]/g, '');
}

export async function exportToPDF(doc: EpicDocument): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  await import('jspdf-autotable');

  const pdf = new jsPDF();
  let y = 20;

  // Title
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.text(doc.name, 14, y);
  y += 10;

  // Date
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(128, 128, 128);
  pdf.text(`Generado: ${new Date(doc.uploadedAt).toLocaleDateString('es-MX')}`, 14, y);
  y += 12;
  pdf.setTextColor(0, 0, 0);

  // Sections
  for (const section of doc.sections ?? []) {
    if (y > 260) { pdf.addPage(); y = 20; }

    pdf.setFontSize(13);
    pdf.setFont('helvetica', 'bold');
    pdf.text(section.title, 14, y);
    y += 7;

    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    const lines = pdf.splitTextToSize(section.content, 180);
    for (const line of lines) {
      if (y > 275) { pdf.addPage(); y = 20; }
      pdf.text(line, 14, y);
      y += 5;
    }
    y += 6;
  }

  pdf.save(`${sanitizeFilename(doc.name)}.pdf`);
}

export async function exportToExcel(doc: EpicDocument): Promise<void> {
  const ExcelJS = await import('exceljs');
  const { saveAs } = await import('file-saver');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(doc.name.slice(0, 31)); // Excel max sheet name length

  // Header row
  sheet.columns = [
    { header: 'Sección', key: 'section', width: 30 },
    { header: 'Contenido', key: 'content', width: 80 },
  ];

  // Style header
  const headerRow = sheet.getRow(1);
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18181B' } };
  headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };

  // Add sections
  for (const section of doc.sections ?? []) {
    const row = sheet.addRow({ section: section.title, content: section.content });
    row.getCell('content').alignment = { wrapText: true };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `${sanitizeFilename(doc.name)}.xlsx`);
}

export async function exportToWord(doc: EpicDocument): Promise<void> {
  const { Document, Paragraph, TextRun, Packer } = await import('docx');
  const { saveAs } = await import('file-saver');

  const children: InstanceType<typeof Paragraph>[] = [];

  // Title
  children.push(
    new Paragraph({
      children: [new TextRun({ text: doc.name, bold: true, size: 32 })],
      spacing: { after: 200 },
    })
  );

  // Date
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generado: ${new Date(doc.uploadedAt).toLocaleDateString('es-MX')}`,
          size: 18,
          color: '808080',
        }),
      ],
      spacing: { after: 400 },
    })
  );

  // Sections
  for (const section of doc.sections ?? []) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: section.title, bold: true, size: 26 })],
        spacing: { before: 300, after: 100 },
      })
    );

    // Split content by newlines
    const lines = section.content.split('\n');
    for (const line of lines) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 22 })],
          spacing: { after: 80 },
        })
      );
    }
  }

  const wordDoc = new Document({
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(wordDoc);
  saveAs(blob, `${sanitizeFilename(doc.name)}.docx`);
}

export async function exportToCSV(doc: EpicDocument): Promise<void> {
  const { saveAs } = await import('file-saver');

  const escape = (str: string) => `"${str.replace(/"/g, '""')}"`;

  let csv = 'Sección,Contenido\n';
  for (const section of doc.sections ?? []) {
    csv += `${escape(section.title)},${escape(section.content)}\n`;
  }

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM for Excel compatibility
  saveAs(blob, `${sanitizeFilename(doc.name)}.csv`);
}
