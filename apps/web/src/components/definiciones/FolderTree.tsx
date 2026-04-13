'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  ChevronRight, ChevronDown, FileText, Folder, FolderOpen,
  Plus, FolderPlus, MoreHorizontal, Pencil, Trash2, AlertTriangle,
  ArrowDownAZ, ArrowUpZA, CalendarPlus, CalendarClock, ArrowUpDown,
} from 'lucide-react';
import { DefinicionNode } from '@/types/definiciones';
import { useDefiniciones, type SortOption } from '@/context/DefinicionesContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const MENU_ITEM_CLASS = 'focus:bg-muted focus:text-foreground';

interface InlineInput {
  parentId: string | null;
  type: 'folder' | 'document';
  depth: number;
}

interface DeleteTarget {
  id: string;
  name: string;
  isFolder: boolean;
}

function InlineCreateInput({ input, onSubmit, onCancel }: {
  input: InlineInput;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const attempts = [50, 150, 300];
    const timers = attempts.map((delay) =>
      setTimeout(() => {
        if (document.activeElement !== inputRef.current && inputRef.current) {
          inputRef.current.focus();
        }
      }, delay),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
    } else {
      onCancel();
    }
  };

  return (
    <div
      className="flex items-center gap-1 py-1 px-2"
      style={{ paddingLeft: `${input.depth * 16 + 8}px` }}
    >
      <span className="shrink-0 w-4" />
      <span className="shrink-0 text-muted-foreground">
        {input.type === 'folder'
          ? <Folder className="h-4 w-4" />
          : <FileText className="h-4 w-4" />
        }
      </span>
      <input
        ref={inputRef}
        className="flex-1 bg-background border border-primary/50 rounded px-1.5 py-0.5 text-sm outline-none focus:border-primary"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={input.type === 'folder' ? 'Nombre de carpeta...' : 'Nombre de documento...'}
      />
    </div>
  );
}

function RenameInput({ value, onChange, onSubmit, onCancel }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const localRef = useRef<HTMLInputElement>(null);
  const hasFocusedRef = useRef(false);

  useEffect(() => {
    // Retry focus until we actually get it (Radix dropdown steals it during close)
    const attempts = [50, 150, 300];
    const timers = attempts.map((delay) =>
      setTimeout(() => {
        if (!hasFocusedRef.current && localRef.current) {
          localRef.current.focus();
          localRef.current.select();
          if (document.activeElement === localRef.current) {
            hasFocusedRef.current = true;
          }
        }
      }, delay),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const handleBlur = () => {
    // Only submit on blur if we had actually focused (prevents premature submit from Radix focus steal)
    if (hasFocusedRef.current) {
      onSubmit();
    }
  };

  return (
    <input
      ref={localRef}
      className="flex-1 bg-background border border-primary/50 rounded px-1.5 py-0.5 text-sm outline-none focus:border-primary"
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={handleBlur}
      onFocus={() => { hasFocusedRef.current = true; }}
      onKeyDown={e => {
        if (e.key === 'Enter') onSubmit();
        if (e.key === 'Escape') onCancel();
      }}
      onClick={e => e.stopPropagation()}
    />
  );
}

function TreeContainer({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div
      className="flex-1 overflow-y-auto py-1"
      onClick={onClick}
    >
      {children}
    </div>
  );
}

function TreeNode({ node, depth, inlineInput, setInlineInput, onRequestDelete }: {
  node: DefinicionNode;
  depth: number;
  inlineInput: InlineInput | null;
  setInlineInput: (input: InlineInput | null) => void;
  onRequestDelete: (target: DeleteTarget) => void;
}) {
  const { state, selectNode, toggleFolder, addFolder, addDocument, renameNode, expandFolder, getEffectiveAccessForNode } = useDefiniciones();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const skipNextClickRef = useRef(false);

  const isExpanded = state.expandedFolders.has(node.id);
  const isSelected = state.selectedId === node.id;
  const isFolder = node.type === 'folder';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false;
      return;
    }
    if (isFolder) {
      toggleFolder(node.id);
    }
    selectNode(node.id);
  };

  const suppressNextClick = () => {
    skipNextClickRef.current = true;
    // Auto-reset after 500ms in case the click never fires
    setTimeout(() => { skipNextClickRef.current = false; }, 500);
  };

  const handleRenameSubmit = () => {
    if (renameValue.trim() && renameValue !== node.name) {
      renameNode(node.id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  const handleNewDocument = () => {
    suppressNextClick();
    expandFolder(node.id);
    setInlineInput({ parentId: node.id, type: 'document', depth: depth + 1 });
  };

  const handleNewFolder = () => {
    suppressNextClick();
    expandFolder(node.id);
    setInlineInput({ parentId: node.id, type: 'folder', depth: depth + 1 });
  };

  const handleInlineSubmit = (name: string) => {
    if (inlineInput?.type === 'folder') {
      addFolder(inlineInput.parentId, name);
    } else if (inlineInput?.type === 'document' && inlineInput.parentId) {
      addDocument(inlineInput.parentId, name);
    }
    setInlineInput(null);
  };

  return (
    <div className="relative">
      <div
        data-node-id={node.id}
        className={`group flex items-center gap-1 py-1 px-2 rounded-md cursor-pointer text-sm transition-colors
          ${isSelected || menuOpen ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-muted/50'}
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
      >
        {isFolder ? (
          <span className="shrink-0 w-4 h-4 flex items-center justify-center text-muted-foreground">
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : (
          <span className="shrink-0 w-4" />
        )}

        <span className="shrink-0 text-muted-foreground">
          {isFolder
            ? (isExpanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />)
            : <FileText className="h-4 w-4" />
          }
        </span>

        {isRenaming ? (
          <RenameInput
            value={renameValue}
            onChange={setRenameValue}
            onSubmit={handleRenameSubmit}
            onCancel={() => { setRenameValue(node.name); setIsRenaming(false); }}
          />
        ) : (
          <span className="flex-1 truncate">{node.name}</span>
        )}

        {(getEffectiveAccessForNode(node.id).level === 'editor' || getEffectiveAccessForNode(node.id).level === 'owner') && (
        <DropdownMenu onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
            <button className={`shrink-0 transition-opacity p-0.5 rounded hover:bg-muted ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48" onCloseAutoFocus={e => e.preventDefault()}>
            {isFolder && (getEffectiveAccessForNode(node.id).level === 'editor' || getEffectiveAccessForNode(node.id).level === 'owner') && (
              <>
                <DropdownMenuItem onClick={handleNewDocument} className={MENU_ITEM_CLASS}>
                  <Plus className="h-4 w-4 mr-2" />
                  Nuevo documento
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleNewFolder} className={MENU_ITEM_CLASS}>
                  <FolderPlus className="h-4 w-4 mr-2" />
                  Nueva carpeta
                </DropdownMenuItem>
              </>
            )}
            {(getEffectiveAccessForNode(node.id).level === 'editor' || getEffectiveAccessForNode(node.id).level === 'owner') && (
              <>
                {isFolder && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => { suppressNextClick(); setRenameValue(node.name); setIsRenaming(true); }} className={MENU_ITEM_CLASS}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Renombrar
                </DropdownMenuItem>
              </>
            )}
            {getEffectiveAccessForNode(node.id).level === 'owner' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onRequestDelete({ id: node.id, name: node.name, isFolder })}
                  className="text-destructive focus:text-destructive focus:bg-muted"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>

      {isFolder && isExpanded && (
        <div>
          {node.children?.map(child => (
            <TreeNode key={child.id} node={child} depth={depth + 1} inlineInput={inlineInput} setInlineInput={setInlineInput} onRequestDelete={onRequestDelete} />
          ))}
          {inlineInput && inlineInput.parentId === node.id && (
            <InlineCreateInput
              input={inlineInput}
              onSubmit={handleInlineSubmit}
              onCancel={() => setInlineInput(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function FolderTree() {
  const { state, filteredTree, addFolder, addDocument, collapseAll, expandFolder, deleteNode, selectNode, setSortBy, getEffectiveAccessForNode: getAccess } = useDefiniciones();

  // Los botones de crear se habilitan según el contexto actual:
  // - Si hay un folder seleccionado → check acceso de ESE folder
  // - Si hay un doc seleccionado → check acceso del parent folder
  // - Si nada seleccionado → check si el vault default permite editor
  const canCreate = useMemo(() => {
    if (!state.selectedId) {
      // Nada seleccionado: verificar si al menos un nodo raíz permite editor
      return filteredTree.some((n) => {
        const level = getAccess(n.id).level;
        return level === 'editor' || level === 'owner';
      });
    }
    // Verificar acceso del nodo seleccionado (o su padre si es documento)
    const level = getAccess(state.selectedId).level;
    return level === 'editor' || level === 'owner';
  }, [state.selectedId, filteredTree, getAccess]);
  const [inlineInput, setInlineInput] = useState<InlineInput | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  useEffect(() => {
    if (!state.selectedId) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-node-id="${state.selectedId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [state.selectedId]);

  const getSelectedFolder = (): { id: string; depth: number } | null => {
    const selectedId = state.selectedId;
    if (!selectedId) return null;
    const node = findNodeById(filteredTree, selectedId);
    if (node?.type === 'folder') {
      return { id: selectedId, depth: getNodeDepth(filteredTree, selectedId) };
    }
    return null;
  };

  const handleNewFolder = () => {
    const folder = getSelectedFolder();
    if (folder) {
      expandFolder(folder.id);
      setInlineInput({ parentId: folder.id, type: 'folder', depth: folder.depth + 1 });
    } else {
      setInlineInput({ parentId: null, type: 'folder', depth: 0 });
    }
  };

  const handleNewDocument = () => {
    const folder = getSelectedFolder();
    if (folder) {
      expandFolder(folder.id);
      setInlineInput({ parentId: folder.id, type: 'document', depth: folder.depth + 1 });
    }
  };




  const handleInlineSubmit = (name: string) => {
    if (!inlineInput) return;
    if (inlineInput.type === 'folder') {
      addFolder(inlineInput.parentId, name);
    } else if (inlineInput.parentId) {
      addDocument(inlineInput.parentId, name);
    }
    setInlineInput(null);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      deleteNode(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Explorador</span>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={collapseAll}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Colapsar todo</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Ordenar</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setSortBy('name-asc')} className={`${MENU_ITEM_CLASS} ${state.sortBy === 'name-asc' ? 'bg-muted' : ''}`}>
                  <ArrowDownAZ className="h-4 w-4 mr-2" />
                  Nombre (A-Z)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('name-desc')} className={`${MENU_ITEM_CLASS} ${state.sortBy === 'name-desc' ? 'bg-muted' : ''}`}>
                  <ArrowUpZA className="h-4 w-4 mr-2" />
                  Nombre (Z-A)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSortBy('created-newest')} className={`${MENU_ITEM_CLASS} ${state.sortBy === 'created-newest' ? 'bg-muted' : ''}`}>
                  <CalendarPlus className="h-4 w-4 mr-2" />
                  Más recientes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('created-oldest')} className={`${MENU_ITEM_CLASS} ${state.sortBy === 'created-oldest' ? 'bg-muted' : ''}`}>
                  <CalendarPlus className="h-4 w-4 mr-2" />
                  Más antiguos
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSortBy('updated-newest')} className={`${MENU_ITEM_CLASS} ${state.sortBy === 'updated-newest' ? 'bg-muted' : ''}`}>
                  <CalendarClock className="h-4 w-4 mr-2" />
                  Última modificación
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNewDocument} disabled={!canCreate}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{canCreate ? 'Nuevo documento' : 'Sin permisos para crear'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNewFolder} disabled={!canCreate}>
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{canCreate ? 'Nueva carpeta' : 'Sin permisos para crear'}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <TreeContainer onClick={() => selectNode(null)}>
          {filteredTree.length === 0 && !inlineInput ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              No se encontraron resultados
            </div>
          ) : (
            <>
              {filteredTree.map(node => (
                <TreeNode key={node.id} node={node} depth={0} inlineInput={inlineInput} setInlineInput={setInlineInput} onRequestDelete={setDeleteTarget} />
              ))}
              {inlineInput && inlineInput.parentId === null && (
                <InlineCreateInput
                  input={inlineInput}
                  onSubmit={handleInlineSubmit}
                  onCancel={() => setInlineInput(null)}
                />
              )}
            </>
          )}
        </TreeContainer>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Eliminar {deleteTarget?.isFolder ? 'carpeta' : 'documento'}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.isFolder
                ? <>¿Eliminar la carpeta <strong>&quot;{deleteTarget?.name}&quot;</strong> y todo su contenido? Esta acción no se puede deshacer.</>
                : <>¿Eliminar <strong>&quot;{deleteTarget?.name}&quot;</strong>? Esta acción no se puede deshacer.</>
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3 pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function findNodeById(nodes: DefinicionNode[], id: string): DefinicionNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function getNodeDepth(nodes: DefinicionNode[], id: string, currentDepth = 0): number {
  for (const node of nodes) {
    if (node.id === id) return currentDepth;
    if (node.children) {
      const found = getNodeDepth(node.children, id, currentDepth + 1);
      if (found >= 0) return found;
    }
  }
  return -1;
}
