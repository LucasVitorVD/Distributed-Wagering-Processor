export const DATABASE_READINESS_CHECK = Symbol('DATABASE_READINESS_CHECK');
export const SQS_READINESS_CLIENT = Symbol('SQS_READINESS_CLIENT');

export interface DatabaseReadinessCheck {
  check(): Promise<void>;
}

export interface SqsReadinessClient {
  getQueueAttributes(queueUrl: string): Promise<void>;
  destroy(): void;
}
