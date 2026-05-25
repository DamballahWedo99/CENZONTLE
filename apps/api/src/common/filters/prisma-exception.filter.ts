import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/**
 * Filtro global de errores Prisma. Convierte códigos `P*` específicos en
 * status HTTP semánticos con mensajes accionables (en dev) o genéricos
 * (en prod, para no leakear schema interno).
 *
 * Logs:
 *  - Siempre loggea código + meta + path + method para forensics
 *  - En dev incluye message completo del error (puede contener nombres de
 *    tablas/columnas — útil para debug)
 *  - En prod omite el message detallado (defensa contra info leak)
 *
 * NUEVO: P2021 (tabla no existe) se trata como 503 Service Unavailable con
 * un mensaje accionable indicando que falta correr la migración. Antes
 * caía al default 500 "Error de base de datos" que es opaco para el
 * operador y no ayuda a diagnosticar.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  // Logger local — el filter se instancia con `new PrismaExceptionFilter()` en
  // main.ts antes del DI graph estar listo. No podemos inyectar PinoLogger.
  // El logger legacy igual sale como JSON vía useLogger global (pino transport).
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError & { code: string }, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const isDev = process.env.NODE_ENV !== 'production';

    let status: number;
    let message: string;
    let hint: string | undefined;

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
      case 'P2021': {
        // P2021: "The table `<x>` does not exist in the current database."
        // Causa típica: la migración no se ha aplicado todavía.
        // Devolvemos 503 (Service Unavailable) en vez de 500 — no es un bug
        // del backend, es una misconfig del operador.
        status = HttpStatus.SERVICE_UNAVAILABLE;
        const table = (exception.meta?.table as string | undefined) ?? 'desconocida';
        message = isDev
          ? `Tabla "${table}" no existe en la base de datos. Falta aplicar migraciones.`
          : 'Servicio temporalmente no disponible';
        hint = isDev
          ? 'Ejecuta: pnpm --filter @cenzontle/api exec prisma migrate deploy'
          : undefined;
        break;
      }
      case 'P2022': {
        // P2022: column does not exist — schema drift / Prisma client desactualizado.
        status = HttpStatus.SERVICE_UNAVAILABLE;
        const col = (exception.meta?.column as string | undefined) ?? 'desconocida';
        message = isDev
          ? `Columna "${col}" no existe — schema desactualizado.`
          : 'Servicio temporalmente no disponible';
        hint = isDev
          ? 'Ejecuta: pnpm --filter @cenzontle/api exec prisma generate && prisma migrate deploy'
          : undefined;
        break;
      }
      case 'P2034':
        // Conflicto de concurrencia en transacción Serializable — el caller
        // debería reintentar. NO es un error del backend, es contention real.
        status = HttpStatus.CONFLICT;
        message = 'Conflicto de concurrencia — reintenta la operación';
        break;
      case 'P1001':
      case 'P1002':
        // Postgres no responde o conexión rechazada.
        status = HttpStatus.SERVICE_UNAVAILABLE;
        message = 'Base de datos no disponible';
        hint = isDev ? 'Verifica que Postgres esté corriendo: docker compose up -d postgres' : undefined;
        break;
      default:
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = isDev
          ? `Error de base de datos (${exception.code}): ${exception.message.split('\n')[0]}`
          : 'Error de base de datos';
    }

    // Log estructurado SIEMPRE — el operador en prod ve el código + meta +
    // path para diagnosticar sin necesidad de reproducir. El mensaje
    // completo (potencialmente con schema info) sólo en dev.
    this.logger.error(
      {
        event: 'prisma.exception',
        code: exception.code,
        meta: exception.meta,
        path: request.url,
        method: request.method,
        userId: (request as Request & { user?: { sub?: string } }).user?.sub ?? 'anon',
        clientVersion: exception.clientVersion,
        // Stack solo primeras 5 líneas para no inflar logs.
        stack: exception.stack?.split('\n').slice(0, 5).join('\n'),
        // Message completo SOLO en dev — puede contener nombres de tablas/cols.
        rawMessage: isDev ? exception.message : undefined,
      },
      `[PrismaException] code=${exception.code} status=${status} ${request.method} ${request.url} — ${message}`,
    );

    response.status(status).json({
      statusCode: status,
      message,
      ...(hint ? { hint } : {}),
      ...(isDev ? { code: exception.code } : {}),
    });
  }
}
