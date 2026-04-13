export interface DefinicionNode {
  id: string;
  name: string;
  type: 'folder' | 'document';
  icon?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  content?: string;
  children?: DefinicionNode[];
  /**
   * Metadatos parseados del frontmatter YAML del archivo (si existe).
   * Key → value ambos como strings. No se muestra dentro del editor Tiptap
   * sino como una tabla separada encima del body.
   */
  metadata?: Record<string, string>;
}
