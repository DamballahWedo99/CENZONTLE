import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';

/**
 * Metadata key usada por `WorkerAuthGuard` para identificar rutas que
 * requieren autenticación con worker token Bearer (en lugar de Auth0 JWT).
 */
export const IS_WORKER_ROUTE_KEY = 'isWorkerRoute';

/**
 * Decorator para marcar un endpoint como "worker route" — usa Bearer token
 * worker en lugar de JWT Auth0.
 *
 * Uso típico (combinado con @Public() para skipear JwtAuthGuard global):
 * ```
 * @Public()
 * @WorkerRoute()
 * @Post('register')
 * register(@WorkerNode() node: { id: string }, @Body() dto: WorkerRegisterDto) {}
 * ```
 */
export const WorkerRoute = () => SetMetadata(IS_WORKER_ROUTE_KEY, true);

/**
 * Decorator que extrae el `workerNode` del request (attached por
 * `WorkerAuthGuard` después de validar el token).
 *
 * Lanza `InternalServerErrorException` si el guard no attach-eó el objeto
 * — esto solo puede pasar por misconfiguration (ruta sin guard, orden de
 * guards mal). Mejor fallar ruidosamente que pasar `undefined` al handler
 * y producir un `TypeError: Cannot read properties of undefined`.
 */
export const WorkerNode = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{
      workerNode?: { id: string; tokenId: string };
    }>();
    if (!request.workerNode) {
      throw new InternalServerErrorException(
        'WorkerAuthGuard did not attach workerNode — check route is decorated with @WorkerRoute() and @UseGuards(WorkerAuthGuard)',
      );
    }
    return request.workerNode;
  },
);
