import { IsOptional, IsEnum, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EpicStatus, Priority } from '@prisma/client';

export class EpicQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  initiativeId?: string;

  @ApiPropertyOptional({ enum: EpicStatus })
  @IsOptional()
  @IsEnum(EpicStatus)
  status?: EpicStatus;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  podId?: string;
}
