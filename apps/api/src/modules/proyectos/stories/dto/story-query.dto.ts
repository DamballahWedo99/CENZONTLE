import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { StoryStatus } from '@prisma/client';

export class StoryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  epicId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  podId?: string;

  @ApiPropertyOptional({ enum: StoryStatus })
  @IsOptional()
  @IsEnum(StoryStatus)
  status?: StoryStatus;
}
