import {
  FileText,
  Globe,
  Brain,
  Send,
  FolderSearch,
  TextSearch,
  FileCode,
  BookOpen,
  BookText,
  BookMarked,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const TOOL_ICONS: Record<string, LucideIcon> = {
  web_search: Globe,
  read_initiative_documents: FileText,
  loading_context: Brain,
  submit_proposals: Send,
  submit_diagram: Send,
  // Code exploration tools (real source code via ripgrep sobre repos clonados)
  code_glob: FolderSearch,
  code_grep: TextSearch,
  code_read: FileCode,
  // Vault exploration tools (markdown de negocio via ripgrep sobre clone del Vault)
  vault_glob: BookOpen,
  vault_grep: BookText,
  vault_read: BookMarked,
};

export const TOOL_LABELS: Record<string, string> = {
  web_search: 'Investigación web',
  read_initiative_documents: 'Lectura de documentos',
  loading_context: 'Carga de contexto',
  submit_proposals: 'Propuestas generadas',
  submit_diagram: 'Diagrama generado',
  code_glob: 'Búsqueda por patrón',
  code_grep: 'Búsqueda en código',
  code_read: 'Lectura de archivo',
  vault_glob: 'Vault — buscar archivos',
  vault_grep: 'Vault — búsqueda de texto',
  vault_read: 'Vault — lectura',
};

export const TOOL_COLORS: Record<string, string> = {
  web_search: 'border-l-green-500',
  read_initiative_documents: 'border-l-purple-500',
  submit_proposals: 'border-l-primary',
  submit_diagram: 'border-l-primary',
  loading_context: 'border-l-muted-foreground',
  code_glob: 'border-l-cyan-500',
  code_grep: 'border-l-emerald-500',
  code_read: 'border-l-orange-500',
  vault_glob: 'border-l-amber-500',
  vault_grep: 'border-l-yellow-600',
  vault_read: 'border-l-amber-600',
};

export const PHASE_LABELS: Record<string, string> = {
  idle: 'Listo',
  researching: 'Investigando',
  analyzing: 'Analizando',
  proposing: 'Proponiendo',
  composing: 'Componiendo',
  done: 'Completado',
};
