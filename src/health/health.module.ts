import { Module } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { MetricsModule } from '../common/metrics/metrics.module.js';
import { HealthController, MetricsController } from './health.controller.js';
import { HealthService } from './health.service.js';
import {
  DATABASE_READINESS_CHECK,
  SQS_READINESS_CLIENT,
  type DatabaseReadinessCheck,
  type SqsReadinessClient,
} from './health.tokens.js';

@Module({
  imports: [MetricsModule],
  controllers: [HealthController, MetricsController],
  providers: [
    HealthService,
    {
      provide: DATABASE_READINESS_CHECK,
      inject: [EntityManager],
      useFactory: (entityManager: EntityManager): DatabaseReadinessCheck => ({
        check: async () => {
          await entityManager.getConnection().execute('select 1');
        },
      }),
    },
    {
      provide: SQS_READINESS_CLIENT,
      useFactory: (): SqsReadinessClient => {
        const client = new SQSClient({
          ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
          ...(process.env.SQS_ENDPOINT
            ? { endpoint: process.env.SQS_ENDPOINT }
            : {}),
        });

        return {
          getQueueAttributes: async (queueUrl) => {
            await client.send(
              new GetQueueAttributesCommand({
                QueueUrl: queueUrl,
                AttributeNames: ['QueueArn'],
              }),
            );
          },
          destroy: () => client.destroy(),
        };
      },
    },
  ],
})
export class HealthModule {}
