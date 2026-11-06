import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  DATABASE_READINESS_CHECK,
  SQS_READINESS_CLIENT,
  type DatabaseReadinessCheck,
  type SqsReadinessClient,
} from './health.tokens.js';

export type DependencyStatus = 'up' | 'down';

export interface ReadinessResponse {
  status: 'ok' | 'error';
  checks: {
    database: DependencyStatus;
    sqs: DependencyStatus;
  };
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(DATABASE_READINESS_CHECK)
    private readonly database: DatabaseReadinessCheck,
    @Inject(SQS_READINESS_CLIENT)
    private readonly sqs: SqsReadinessClient,
  ) {}

  async checkReadiness(): Promise<ReadinessResponse> {
    const [database, sqs] = await Promise.all([
      this.checkDatabase(),
      this.checkSqs(),
    ]);
    const isReady = database === 'up' && sqs === 'up';

    return {
      status: isReady ? 'ok' : 'error',
      checks: { database, sqs },
    };
  }

  onModuleDestroy(): void {
    this.sqs.destroy();
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      await this.database.check();
      return 'up';
    } catch {
      this.logger.warn('PostgreSQL readiness check failed.');
      return 'down';
    }
  }

  private async checkSqs(): Promise<DependencyStatus> {
    const queueUrl = process.env.SQS_QUEUE_URL;
    if (!queueUrl) {
      this.logger.warn('SQS readiness check failed: SQS_QUEUE_URL is missing.');
      return 'down';
    }

    try {
      await this.sqs.getQueueAttributes(queueUrl);
      return 'up';
    } catch {
      this.logger.warn('SQS readiness check failed.');
      return 'down';
    }
  }
}
