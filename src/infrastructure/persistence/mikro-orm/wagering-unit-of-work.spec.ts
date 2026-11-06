import { describe, expect, it, vi } from 'vitest';
import { MetricsService } from '../../../common/metrics/metrics.module.js';
import { MikroOrmWageringUnitOfWork } from './wagering-unit-of-work.js';

describe('MikroOrmWageringUnitOfWork', () => {
  it.each(['40P01', '55P03', '40001'])(
    'counts PostgreSQL lock conflict code %s and rethrows it',
    async (code) => {
      const error = Object.assign(new Error('database lock conflict'), {
        code,
      });
      const em = {
        transactional: vi.fn().mockRejectedValue(error),
      };
      const metrics = new MetricsService();
      const unitOfWork = new MikroOrmWageringUnitOfWork(em as never, metrics);

      await expect(unitOfWork.transaction(async () => 'ok')).rejects.toBe(
        error,
      );
      expect((await metrics.getMetrics()).body).toContain(
        'wagering_lock_conflicts_total 1',
      );
    },
  );

  it('does not count unrelated database errors as lock conflicts', async () => {
    const error = Object.assign(new Error('database unavailable'), {
      code: '08006',
    });
    const em = { transactional: vi.fn().mockRejectedValue(error) };
    const metrics = new MetricsService();
    const unitOfWork = new MikroOrmWageringUnitOfWork(em as never, metrics);

    await expect(unitOfWork.transaction(async () => 'ok')).rejects.toBe(error);
    expect((await metrics.getMetrics()).body).toContain(
      'wagering_lock_conflicts_total 0',
    );
  });
});
