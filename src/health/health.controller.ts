import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from '../common/metrics/metrics.module.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  checkLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async checkReadiness(
    @Res({ passthrough: true }) response: Response,
  ): Promise<Awaited<ReturnType<HealthService['checkReadiness']>>> {
    const result = await this.healthService.checkReadiness();
    response.status(
      result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return result;
  }
}

@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  async metrics(
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const metrics = await this.metricsService.getMetrics();
    response.type(metrics.contentType);
    return metrics.body;
  }
}
