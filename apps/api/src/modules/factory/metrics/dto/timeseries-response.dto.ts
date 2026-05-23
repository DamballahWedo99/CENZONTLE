import { ApiProperty } from '@nestjs/swagger';

export class MetricsBucketDto {
  @ApiProperty({
    description: 'ISO timestamp del inicio del bucket (hora redonda, UTC).',
    example: '2026-05-19T13:00:00.000Z',
  })
  time!: string;

  @ApiProperty({
    description:
      'Slots ocupados durante el bucket — runs (claimed|running|completed) cuya ventana [startedAt, completedAt) overlapa con [time, time+1h). Para in-flight runs sin completedAt, se usa now() como upper bound. Cap a currentCapacityTotal (un slot no puede ocuparse más de una vez).',
  })
  capacityUsed!: number;

  @ApiProperty({
    description:
      'Tokens "new" (input + output + cache_creation) sumados de los runs que reportaron usage en este bucket. Para horas pasadas, solo cuenta runs con completedAt en el bucket. Para la hora actual, suma también parciales de runs in-flight (generatorUsage agregado vía /progress).',
  })
  tokensNew!: number;

  @ApiProperty({
    description:
      'Tokens cached (cache_read) — separados por transparencia, mismo split que /factory/queue/:batchId/detail.',
  })
  tokensCached!: number;
}

export class FactoryMetricsResponseDto {
  @ApiProperty({
    description: 'ISO timestamp en que se calculó la respuesta.',
    example: '2026-05-19T14:23:01.000Z',
  })
  generatedAt!: string;

  @ApiProperty({
    description: 'Número de buckets devueltos (siempre 24 — fixed window 24h).',
    example: 24,
  })
  bucketsCount!: number;

  @ApiProperty({
    description: 'Tamaño del bucket en milisegundos (siempre 3_600_000 — 1h).',
    example: 3_600_000,
  })
  bucketDurationMs!: number;

  @ApiProperty({
    type: [MetricsBucketDto],
    description:
      'Array ordenado ASC por tiempo. buckets[0] = hace 23h, buckets[23] = hora actual en curso.',
  })
  buckets!: MetricsBucketDto[];

  @ApiProperty({
    description:
      'Slots ocupados ahora mismo — count de AgentRun en status claimed|running.',
  })
  currentCapacityUsed!: number;

  @ApiProperty({
    description:
      'Capacity total del fleet — sum(ComputeNode.totalSlots WHERE effective_status=online).',
  })
  currentCapacityTotal!: number;

  @ApiProperty({
    description: 'Número de ComputeNodes online (no retired).',
  })
  onlineNodeCount!: number;
}
