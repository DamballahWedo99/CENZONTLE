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
}
