import {
  Controller, Post, Get, Delete, Param, Query, Res,
  UploadedFile, UseInterceptors, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Permission } from '@cenzontle/shared';
import { Permissions } from '../auth/decorators';
import { DocumentsService } from './documents.service';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { basename, extname } from 'path';
import { lookup } from 'mime-types';

/**
 * Endpoints de documentos. Todas las operaciones requieren autenticación
 * (JWT de Auth0). Upload y delete requieren permiso MANAGE_DOCUMENTS.
 */
@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  @Permissions(Permission.MANAGE_DOCUMENTS)
  @ApiOperation({ summary: 'Subir un documento' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    const { key, url } = await this.documentsService.upload(file, folder || 'documents');

    return {
      key,
      url,
      name: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    };
  }

  @Get('file/:type/:entityId/:filename')
  @ApiOperation({ summary: 'Descargar un documento' })
  async download(@Param('type') type: string, @Param('entityId') entityId: string, @Param('filename') filename: string, @Res() res: Response) {
    const key = `${type}/${entityId}/${filename}`;
    const { path, exists } = this.documentsService.getFilePath(key);
    if (!exists) throw new NotFoundException('Archivo no encontrado');

    const name = basename(path);
    const ext = extname(name);
    const contentType = lookup(ext) || 'application/octet-stream';

    const encodedName = encodeURIComponent(name);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
    createReadStream(path).pipe(res);
  }

  @Delete('file/:type/:entityId/:filename')
  @Permissions(Permission.MANAGE_DOCUMENTS)
  @ApiOperation({ summary: 'Eliminar un documento' })
  async remove(@Param('type') type: string, @Param('entityId') entityId: string, @Param('filename') filename: string) {
    const key = `${type}/${entityId}/${filename}`;
    await this.documentsService.delete(key);
    return { deleted: true };
  }
}
