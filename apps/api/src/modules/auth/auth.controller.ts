import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators';
import { AuthenticatedUser } from '@cenzontle/shared';
import { VerifyPasswordDto } from './dto/verify-password.dto';

@ApiTags('Auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user);
  }

  @Get('permissions')
  @ApiOperation({ summary: 'Get current user permissions' })
  getPermissions(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getPermissions(user);
  }

  // Throttle agresivo: este endpoint reenvía la password a Auth0. Sin
  // límite, un atacante con un JWT comprometido puede brute-force el
  // password del dueño legítimo (CWE-307) y, peor, gatillar el lockout
  // de Auth0 sobre la cuenta legítima (DoS lateral). 5 intentos/min por
  // sub del JWT (AuthAwareThrottlerGuard usa req.user.sub) es generoso
  // para typos honestos pero rompe automatización.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('verify-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Verifica la contraseña del usuario autenticado (step-up authentication). 204 si correcta, 401 si incorrecta. Límite 5/min.',
  })
  async verifyPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyPasswordDto,
  ): Promise<void> {
    await this.authService.assertPasswordValid(user, dto.password);
  }
}
