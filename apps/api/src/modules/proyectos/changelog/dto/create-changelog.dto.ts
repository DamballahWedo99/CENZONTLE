import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChangelogDto {
  @ApiProperty({ example: 'epic' })
  @IsString()
  @IsNotEmpty()
  entityType!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  entityId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  entityTitle!: string;

  @ApiProperty({ example: 'created' })
  @IsString()
  @IsNotEmpty()
  action!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  field?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  oldValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  newValue?: string;

}
