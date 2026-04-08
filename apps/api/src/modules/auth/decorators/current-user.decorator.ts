import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '@cenzontle/shared';

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;
    return data ? user?.[data] : user;
  },
);
