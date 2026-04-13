import { IsOptional, IsEnum, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InitiativeStatus } from '@prisma/client';

export class InitiativeQueryDto {
  @ApiPropertyOptional({ enum: InitiativeStatus })
  @IsOptional()
  @IsEnum(InitiativeStatus)
  status?: InitiativeStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
