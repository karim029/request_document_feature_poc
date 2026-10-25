import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DashboardService } from './dashboard.service';

function setup(
  options: { accountantExists?: boolean; seconds?: string | null } = {},
) {
  const query = jest.fn((sql: string) => {
    if (sql.includes('FROM accountant')) {
      return Promise.resolve(
        options.accountantExists === false ? [] : [{ id: 1 }],
      );
    }
    if (sql.includes('GROUP BY status')) {
      return Promise.resolve([
        { status: 'pending', n: '3' },
        { status: 'approved', n: '5' },
      ]);
    }
    if (sql.includes('dueDate < CURDATE()'))
      return Promise.resolve([{ n: '2' }]);
    // The turnaround query pairs each decision with the latest review before it.
    if (sql.includes('TIMESTAMPDIFF') && sql.includes('MAX(up.createdAt)')) {
      return Promise.resolve([
        { seconds: options.seconds === undefined ? '14400' : options.seconds },
      ]);
    }
    if (sql.includes('GROUP BY clientId')) {
      return Promise.resolve([
        { clientId: 7, username: 'seed-client-7', outstanding: '4' },
      ]);
    }
    return Promise.reject(new Error(`unexpected query: ${sql}`));
  });
  const dataSource = { query } as unknown as DataSource;
  return { query, dataSource };
}

describe('DashboardService', () => {
  const originalTtl = process.env.DASHBOARD_CACHE_TTL_MS;

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.DASHBOARD_CACHE_TTL_MS;
    else process.env.DASHBOARD_CACHE_TTL_MS = originalTtl;
  });

  it('shapes the four answers, with 0 for a status that has no requests', async () => {
    delete process.env.DASHBOARD_CACHE_TTL_MS;
    const { dataSource } = setup();
    const result = await new DashboardService(dataSource).getDashboard(1);

    expect(result).toEqual({
      countsByStatus: { pending: 3, reviewing: 0, approved: 5, rejected: 0 },
      overdueCount: 2,
      avgReviewTurnaroundHours: 4,
      topClientsByOutstanding: [
        { clientId: 7, username: 'seed-client-7', outstanding: 4 },
      ],
    });
  });

  it('returns null turnaround when there are no decisions in the last 30 days', async () => {
    delete process.env.DASHBOARD_CACHE_TTL_MS;
    const { dataSource } = setup({ seconds: null });
    const result = await new DashboardService(dataSource).getDashboard(1);
    expect(result.avgReviewTurnaroundHours).toBeNull();
  });

  it('returns 404 for an unknown accountant, and does not cache the failure', async () => {
    delete process.env.DASHBOARD_CACHE_TTL_MS;
    const { query, dataSource } = setup({ accountantExists: false });
    const service = new DashboardService(dataSource);

    await expect(service.getDashboard(99)).rejects.toThrow(NotFoundException);
    await expect(service.getDashboard(99)).rejects.toThrow(NotFoundException);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('serves the second call from the cache: five queries for two calls', async () => {
    delete process.env.DASHBOARD_CACHE_TTL_MS;
    const { query, dataSource } = setup();
    const service = new DashboardService(dataSource);

    const first = await service.getDashboard(1);
    const second = await service.getDashboard(1);

    expect(second).toEqual(first);
    expect(query).toHaveBeenCalledTimes(5);
  });

  it('computes every time when the cache is switched off', async () => {
    process.env.DASHBOARD_CACHE_TTL_MS = '0';
    const { query, dataSource } = setup();
    const service = new DashboardService(dataSource);

    await service.getDashboard(1);
    await service.getDashboard(1);

    expect(query).toHaveBeenCalledTimes(10);
  });

  it('shares one computation between calls for the same accountant that arrive together', async () => {
    delete process.env.DASHBOARD_CACHE_TTL_MS;
    const { query, dataSource } = setup();
    const service = new DashboardService(dataSource);

    await Promise.all([service.getDashboard(1), service.getDashboard(1)]);

    expect(query).toHaveBeenCalledTimes(5);
  });
});
