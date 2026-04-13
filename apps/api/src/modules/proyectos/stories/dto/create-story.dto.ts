import {
  IsString, IsNotEmpty, MaxLength, IsEnum, IsOptional,
  IsUUID, IsInt, Min, IsArray, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoryStatus } from '@prisma/client';
import { StoryPoFieldsDto, StoryTechnicalFieldsDto, StoryQaFieldsDto } from './story-content.dto';

export class CreateStoryDto {
  @ApiProperty({ example: 'Tokenizar pagos en checkout' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsUUID()
  epicId!: string;

  @ApiProperty()
  @IsUUID()
  podId!: string;

  @ApiPropertyOptional({ enum: StoryStatus })
  @IsOptional()
  @IsEnum(StoryStatus)
  status?: StoryStatus;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  storyPoints?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productOwnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sprintId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  labels?: string[];

  // Narrative content (will be stored in vault as markdown)
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => StoryPoFieldsDto)
  po?: StoryPoFieldsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => StoryTechnicalFieldsDto)
  technical?: StoryTechnicalFieldsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => StoryQaFieldsDto)
  qa?: StoryQaFieldsDto;
}
