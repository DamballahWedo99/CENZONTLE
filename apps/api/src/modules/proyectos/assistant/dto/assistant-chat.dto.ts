import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Tope del mensaje por turno. El contenido de la entidad NO viaja en el
 * mensaje (el backend lo carga fresco del vault/PG en cada turno), así que
 * 4K chars cubre cualquier instrucción razonable de edición.
 */
const MAX_MESSAGE_LEN = 4_000;

export class ProposalFeedbackDto {
  @ApiProperty({ description: 'ID de la propuesta (prop-<uuid>).' })
  @IsString()
  @Matches(/^prop-[a-f0-9-]{8,}$/i, { message: 'Formato de id de propuesta inválido' })
  id!: string;

  @ApiProperty({ enum: ['applied', 'rejected'] })
  @IsIn(['applied', 'rejected'])
  status!: 'applied' | 'rejected';
}

export class ProposalFeedbackBodyDto {
  @ApiProperty({ type: [ProposalFeedbackDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProposalFeedbackDto)
  feedback!: ProposalFeedbackDto[];
}

export class AssistantChatBodyDto {
  @ApiProperty({ description: 'Mensaje del usuario para este turno.' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_LEN)
  message!: string;

  @ApiPropertyOptional({
    description:
      'ID de sesión de un turno anterior. Si se omite o expiró, se crea una sesión nueva.',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({
    description:
      'Resultado de propuestas del turno anterior (aplicadas/descartadas por el usuario), para que el agente tenga continuidad.',
    type: [ProposalFeedbackDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProposalFeedbackDto)
  proposalFeedback?: ProposalFeedbackDto[];
}
