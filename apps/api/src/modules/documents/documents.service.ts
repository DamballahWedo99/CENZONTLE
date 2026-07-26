import 'dotenv/config';
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, resolve, sep } from 'path';
import { homedir } from 'os';

const STORAGE_ROOT = process.env.DOCUMENTS_DIR || join(homedir(), '.cenzontle', 'documents');

@Injectable()
export class DocumentsService {
  constructor() {
    if (!existsSync(STORAGE_ROOT)) {
      mkdirSync(STORAGE_ROOT, { recursive: true });
    }
  }

  async upload(file: Express.Multer.File, folder: string = 'documents'): Promise<{ key: string; url: string }> {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${folder}/${randomUUID()}-${safeName}`;
    const dir = join(STORAGE_ROOT, folder);

    // CWE-22 FIX: Validar TANTO el directorio como el filepath ANTES de cualquier
    // operación de filesystem. Antes, mkdirSync se ejecutaba antes del check y
    // permitía creación de directorios arbitrarios vía path traversal en `folder`.
    if (!resolve(dir).startsWith(resolve(STORAGE_ROOT))) {
      throw new Error('Invalid folder path');
    }
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filePath = join(STORAGE_ROOT, key);
    if (!resolve(filePath).startsWith(resolve(STORAGE_ROOT))) {
      throw new Error('Invalid file path');
    }

    writeFileSync(filePath, file.buffer);

    return {
      key,
      url: `/api/documents/file/${key}`,
    };
  }

  getFilePath(key: string): { path: string; exists: boolean } {
    const filePath = join(STORAGE_ROOT, key);
    const resolvedRoot = resolve(STORAGE_ROOT);
    const resolvedFile = resolve(filePath);
    const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
    if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(rootWithSep)) {
      throw new NotFoundException('Invalid key');
    }
    return { path: filePath, exists: existsSync(filePath) };
  }

  async delete(key: string): Promise<void> {
    const { path, exists } = this.getFilePath(key);
    if (exists) unlinkSync(path);
  }
}
