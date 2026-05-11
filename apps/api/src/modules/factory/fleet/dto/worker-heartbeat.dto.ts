import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max } from 'class-validator';

export class WorkerHeartbeatDto {
  @ApiProperty({ description: 'Slots actualmente en uso por agentes activos', minimum: 0, maximum: 32 })
  @IsInt()
  @Min(0)
  @Max(32)
  slotsUsed!: number;
}
