declare module 'jspdf-autotable' {
  import { jsPDF } from 'jspdf';

  interface AutoTableOptions {
    head?: any[][];
    body?: any[][];
    foot?: any[][];
    startY?: number;
    styles?: any;
    headStyles?: any;
    footStyles?: any;
    didParseCell?: (data: any) => void;
    [key: string]: any;
  }

  export default function autoTable(doc: jsPDF, options: AutoTableOptions): void;
}
