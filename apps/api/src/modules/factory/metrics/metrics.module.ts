import { Module } from '@nestjs/common';
import { FactoryMetricsController } from './metrics.controller';
import { FactoryMetricsService } from './metrics.service';
import { FactoryAuthzModule } from '../authz/factory-authz.module';

@Module({
  imports: [FactoryAuthzModule],
  controllers: [FactoryMetricsController],
  providers: [FactoryMetricsService],
})
export class FactoryMetricsModule {}
