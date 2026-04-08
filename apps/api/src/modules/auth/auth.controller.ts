import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators';
import { AuthenticatedUser } from '@cenzontle/shared';

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
}
