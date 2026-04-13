import { IsString, IsOptional, IsArray, MaxLength, ArrayMaxSize } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Límites para prevenir DoS vía commits gigantes al vault GitHub (CWE-770).
const MAX_TEXT = 20_000;
const MAX_LIST_ITEM = 2_000;
const MAX_LIST_SIZE = 100;

export class StoryPoFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_TEXT) background?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_TEXT) objective?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_TEXT) userStory?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_TEXT) whatHowWhen?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_TEXT) acceptanceCriteria?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_TEXT) additionalNotes?: string;
}

export class StoryTechnicalFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_TEXT) architecture?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_TEXT) integrationFlow?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(MAX_LIST_SIZE) @IsString({ each: true }) @MaxLength(MAX_LIST_ITEM, { each: true }) validations?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(MAX_LIST_SIZE) @IsString({ each: true }) @MaxLength(MAX_LIST_ITEM, { each: true }) errorHandling?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(MAX_LIST_SIZE) @IsString({ each: true }) @MaxLength(MAX_LIST_ITEM, { each: true }) implementationChecklist?: string[];
}

export class StoryQaFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_TEXT) testingStrategy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) linkedQAMatrixId?: string;
}
