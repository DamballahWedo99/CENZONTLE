import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from './guards';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
