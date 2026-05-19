import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  // Logger local — el filter se instancia con `new PrismaExceptionFilter()` en
  // main.ts antes del DI graph estar listo. No podemos inyectar PinoLogger.
  // El logger legacy igual sale como JSON vía useLogger global (pino transport).
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError & { code: string }, host: ArgumentsHost) {
    this.logger.error({ code: exception.code, message: exception.message }, `[PrismaException] Code: ${exception.code} ${exception.message}`);
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status: number;
    let message: string;

    switch (exception.code) {
      case 'P2002': {
        status = HttpStatus.CONFLICT;
        const fields = (exception.meta?.target as string[])?.join(', ') ?? 'campo';
        message = `Ya existe un registro con ese valor de ${fields}`;
        break;
      }
      case 'P2025':
        status = HttpStatus.NOT_FOUND;
        message = 'Registro no encontrado';
        break;
      case 'P2003':
        status = HttpStatus.BAD_REQUEST;
        message = 'Referencia a un registro que no existe';
        break;
      default:
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'Error de base de datos';
    }

    response.status(status).json({ statusCode: status, message });
  }
}
