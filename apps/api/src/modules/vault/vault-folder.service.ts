import { Injectable, Logger } from '@nestjs/common';
import { VaultService, VaultTreeNode } from './vault.service';

export interface MoveFolderResult {
  filesMoved: number;
  copyErrors: string[];
  deleteErrors: string[];
}

/**
 * Helpers compuestos sobre VaultService para operaciones de folder completo.
 * GitHub Contents API no tiene rename ni move nativos — estos son secuencias
 * de read+write+delete con logica de rollback best-effort.
 */
@Injectable()
export class VaultFolderService {
  private readonly logger = new Logger(VaultFolderService.name);

  constructor(private readonly vault: VaultService) {}

  /**
   * Mueve un folder entero de `fromFolder` a `toFolder`.
   *
   * Algoritmo (minimiza ventana de inconsistencia):
   *   1. Lista archivos en fromFolder (listTree recursivo).
   *   2. Copia todos: read(old) + write(new). Si UNO falla, aborta sin borrar viejos.
   *      → state: old intacto, new parcial (removible manualmente).
   *   3. Si todas las copias OK: borra todos los viejos.
   *      → state: new completo, old removido. Si delete falla parcial, old
   *      queda como basura (removible).
   *
   * Ventaja: en ningun momento tenemos "old parcial" (que seria el peor estado
   * posible — perder archivos). El peor caso es "ambos existen" (duplicacion).
   */
  async moveFolder(
    fromFolder: string,
    toFolder: string,
    commitMsgCopy: string,
    commitMsgDelete: string,
  ): Promise<MoveFolderResult> {
    if (fromFolder === toFolder) {
      this.logger.log(`[moveFolder] noop: from === to (${fromFolder})`);
      return { filesMoved: 0, copyErrors: [], deleteErrors: [] };
    }

    const tree = await this.vault.listTree(fromFolder).catch(() => []);
    const files = this.flattenFiles(tree);

    if (files.length === 0) {
      this.logger.log(`[moveFolder] source folder empty or missing: ${fromFolder}`);
      return { filesMoved: 0, copyErrors: [], deleteErrors: [] };
    }

    this.logger.log(`[moveFolder] ${files.length} file(s): ${fromFolder} → ${toFolder}`);

    // Paso 1: copy all to new location.
    const writtenOldPaths: string[] = [];
    const copyErrors: string[] = [];

    for (const fromPath of files) {
      const relative = this.relativeTo(fromFolder, fromPath);
      const toPath = `${toFolder}/${relative}`;
      try {
        const note = await this.vault.readNote(fromPath);
        if (!note) {
          this.logger.warn(`[moveFolder] skip missing ${fromPath}`);
          continue;
        }
        await this.vault.writeNote(toPath, note.content, commitMsgCopy);
        writtenOldPaths.push(fromPath);
      } catch (err: any) {
        copyErrors.push(`${fromPath} → ${toPath}: ${err?.message ?? 'unknown'}`);
      }
    }

    if (copyErrors.length > 0) {
      this.logger.error(
        `[moveFolder] ${copyErrors.length}/${files.length} copies failed. Old folder preserved. Errors: ${copyErrors.join('; ')}`,
      );
      return { filesMoved: 0, copyErrors, deleteErrors: [] };
    }

    // Paso 2: delete old files.
    const deleteErrors: string[] = [];
    for (const fromPath of writtenOldPaths) {
      try {
        await this.vault.deleteNote(fromPath, commitMsgDelete);
      } catch (err: any) {
        deleteErrors.push(`${fromPath}: ${err?.message ?? 'unknown'}`);
      }
    }

    if (deleteErrors.length > 0) {
      this.logger.warn(
        `[moveFolder] ${deleteErrors.length}/${writtenOldPaths.length} deletes failed. New folder OK, old has leftovers. Errors: ${deleteErrors.join('; ')}`,
      );
    } else {
      this.logger.log(`[moveFolder] ✓ moved ${writtenOldPaths.length} files`);
    }

    return {
      filesMoved: writtenOldPaths.length - deleteErrors.length,
      copyErrors: [],
      deleteErrors,
    };
  }

  /**
   * Elimina recursivamente todos los archivos bajo un folder. Es best-effort:
   * cada archivo se borra con un commit independiente; si alguno falla se logea
   * pero el resto sigue. GitHub Contents API no tiene delete-folder nativo.
   */
  async deleteFolder(folder: string, commitMsgMain: string): Promise<number> {
    const tree = await this.vault.listTree(folder).catch(() => []);
    const files = this.flattenFiles(tree);

    if (files.length === 0) {
      this.logger.log(`[deleteFolder] folder empty or missing: ${folder}`);
      return 0;
    }

    this.logger.log(`[deleteFolder] ${files.length} file(s) in ${folder}`);

    let first = true;
    let successCount = 0;
    for (const filePath of files) {
      const basename = filePath.split('/').pop() ?? filePath;
      const msg = first
        ? commitMsgMain
        : `chore(vault): cleanup ${basename} (cascade)`;
      try {
        await this.vault.deleteNote(filePath, msg);
        successCount++;
      } catch (err: any) {
        this.logger.warn(`[deleteFolder] failed to delete ${filePath}: ${err?.message}`);
      }
      first = false;
    }

    return successCount;
  }

  /**
   * Aplana un VaultTreeNode[] a un array de paths de archivos (solo files,
   * no folders). Preserva orden DFS.
   */
  private flattenFiles(tree: VaultTreeNode[]): string[] {
    const out: string[] = [];
    const walk = (nodes: VaultTreeNode[]) => {
      for (const node of nodes) {
        if (node.type === 'file') {
          out.push(node.path);
        }
        if (node.children && node.children.length > 0) {
          walk(node.children);
        }
      }
    };
    walk(tree);
    return out;
  }

  /**
   * Calcula path relativo. Si `fullPath = 'iniciativas/x/epics/y/index.md'` y
   * `folder = 'iniciativas/x/epics/y'`, retorna `'index.md'`. Si el prefijo no
   * coincide (edge case de listTree), retorna fullPath sin modificar.
   */
  private relativeTo(folder: string, fullPath: string): string {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    if (fullPath.startsWith(prefix)) {
      return fullPath.slice(prefix.length);
    }
    return fullPath;
  }
}
