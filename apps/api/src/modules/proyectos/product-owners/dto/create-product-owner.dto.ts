import { IsString, IsNotEmpty, IsEmail, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductOwnerDto {
  @ApiProperty({ example: 'Carlos Méndez' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'carlos.mendez@cenzontle.app' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: 'https://i.pravatar.cc/150?u=carlos' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
