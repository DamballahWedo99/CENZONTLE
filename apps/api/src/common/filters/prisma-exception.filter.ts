import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError & { code: string }, host: ArgumentsHost) {
    console.error(`[PrismaException] Code: ${exception.code}`, exception.message);
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
