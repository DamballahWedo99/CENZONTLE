import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class PublishToTrackerDto {
  @ApiProperty({ enum: ['linear', 'jira'], example: 'linear' })
  @IsString()
  @IsIn(['linear', 'jira'])
  provider!: 'linear' | 'jira';
}
