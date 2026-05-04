import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import type { IntegrationProvider } from '@cenzontle/shared';

export class DeleteIntegrationParamDto {
  @ApiProperty({ enum: ['linear', 'jira'] })
  @IsString()
  @IsIn(['linear', 'jira'])
  provider!: IntegrationProvider;
}
