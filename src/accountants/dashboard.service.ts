import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

type StatusCounts = Record<
  'pending' | 'reviewing' | 'approved' | 'rejected',
  number
>;

export interface TopClient {
  clientId: number;
  username: string;
  outstanding: number;
}

export interface DashboardResponse {
  countsByStatus: StatusCounts;
  overdueCount: number;
  avgReviewTurnaroundHours: number | null;
  topClientsByOutstanding: TopClient[];
}

interface CacheEntry {
  value: DashboardResponse;
  expiresAt: number;
}

/**
 * The dashboard: four small aggregate queries, with a short in-memory cache in front.
 *
 * Definitions follow DESIGN.md section 10: a request is open while it is pending or reviewing,
 * and overdue when it is open and its due date has passed.
 *
 * Staleness (DESIGN.md section 7): a cached dashboard can be up to DASHBOARD_CACHE_TTL_MS old
 * (30 seconds by default). Set DASHBOARD_CACHE_TTL_MS=0 to switch the cache off, for example to
 * measure the live version. The cache lives in this process, so several app instances would each
 * have their own copy.
 */
@Injectable()
export class DashboardService {
  private readonly ttlMs = Number(process.env.DASHBOARD_CACHE_TTL_MS ?? 30_000);
  private readonly cache = new Map<number, CacheEntry>();
  // Calls for the same accountant that arrive while the numbers are being computed share
  // that one computation, instead of each running the four queries.
  private readonly inFlight = new Map<number, Promise<DashboardResponse>>();

  constructor(private readonly dataSource: DataSource) {}

  async getDashboard(accountantId: number): Promise<DashboardResponse> {
    if (this.ttlMs <= 0) {
      return this.compute(accountantId);
    }

    const cached = this.cache.get(accountantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const running = this.inFlight.get(accountantId);
    if (running) {
      return running;
    }

    const computation = this.compute(accountantId)
      .then((value) => {
        this.cache.set(accountantId, {
          value,
          expiresAt: Date.now() + this.ttlMs,
        });
        return value;
      })
      .finally(() => {
        this.inFlight.delete(accountantId);
      });
    this.inFlight.set(accountantId, computation);
    return computation;
  }

  private async compute(accountantId: number): Promise<DashboardResponse> {
    await this.ensureAccountantExists(accountantId);

    const [
      countsByStatus,
      overdueCount,
      avgReviewTurnaroundHours,
      topClientsByOutstanding,
    ] = await Promise.all([
      this.getCountsByStatus(accountantId),
      this.getOverdueCount(accountantId),
      this.getAverageTurnaroundHours(accountantId),
      this.getTopClients(accountantId),
    ]);

    return {
      countsByStatus,
      overdueCount,
      avgReviewTurnaroundHours,
      topClientsByOutstanding,
    };
  }

  private async ensureAccountantExists(accountantId: number): Promise<void> {
    const rows = await this.dataSource.query<Array<{ id: number }>>(
      'SELECT id FROM accountant WHERE id = ?',
      [accountantId],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Accountant does not exist.');
    }
  }

  // Number of requests in each status.
  private async getCountsByStatus(accountantId: number): Promise<StatusCounts> {
    const rows = await this.dataSource.query<
      Array<{ status: string; n: string }>
    >(
      `SELECT status, COUNT(*) AS n
         FROM document_request
        WHERE accountantId = ?
        GROUP BY status`,
      [accountantId],
    );
    const counts: StatusCounts = {
      pending: 0,
      reviewing: 0,
      approved: 0,
      rejected: 0,
    };
    for (const row of rows) {
      counts[row.status as keyof StatusCounts] = Number(row.n);
    }
    return counts;
  }

  // Open requests whose due date has passed.
  private async getOverdueCount(accountantId: number): Promise<number> {
    const rows = await this.dataSource.query<Array<{ n: string }>>(
      `SELECT COUNT(*) AS n
         FROM document_request
        WHERE accountantId = ?
          AND status IN ('pending', 'reviewing')
          AND dueDate < CURDATE()`,
      [accountantId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  // Average time from "reviewing" to "approved" or "rejected", for decisions of the last 30 days.
  // Each decision is paired with the latest "reviewing" event before it (the id breaks a tie on
  // the timestamp), so a request with several review cycles counts once per decision. A decision
  // with no earlier "reviewing" event gives NULL, which AVG ignores.
  private async getAverageTurnaroundHours(
    accountantId: number,
  ): Promise<number | null> {
    const rows = await this.dataSource.query<Array<{ seconds: string | null }>>(
      `SELECT AVG(TIMESTAMPDIFF(SECOND,
                (SELECT MAX(up.createdAt)
                   FROM document_request_event up
                  WHERE up.requestId = decided.requestId
                    AND up.toStatus = 'reviewing'
                    AND (up.createdAt < decided.createdAt
                         OR (up.createdAt = decided.createdAt AND up.id < decided.id))),
                decided.createdAt)) AS seconds
         FROM document_request_event decided
         JOIN document_request r ON r.id = decided.requestId
        WHERE r.accountantId = ?
          AND decided.toStatus IN ('approved', 'rejected')
          AND decided.createdAt >= NOW() - INTERVAL 30 DAY`,
      [accountantId],
    );
    const seconds = rows[0]?.seconds;
    if (seconds === null || seconds === undefined) return null;
    return Math.round((Number(seconds) / 3600) * 100) / 100;
  }

  // The 10 clients with the most open requests. The counting happens first, on the index alone
  // (IDX_request_dashboard holds the client), and only the 10 winners are joined to the client table.
  private async getTopClients(accountantId: number): Promise<TopClient[]> {
    const rows = await this.dataSource.query<
      Array<{ clientId: number; username: string; outstanding: string }>
    >(
      `SELECT c.id AS clientId, c.username, top.outstanding
         FROM (
           SELECT clientId, COUNT(*) AS outstanding
             FROM document_request
            WHERE accountantId = ?
              AND status IN ('pending', 'reviewing')
            GROUP BY clientId
            ORDER BY outstanding DESC, clientId
            LIMIT 10
         ) top
         JOIN client c ON c.id = top.clientId
        ORDER BY top.outstanding DESC, c.id`,
      [accountantId],
    );
    return rows.map((row) => ({
      clientId: row.clientId,
      username: row.username,
      outstanding: Number(row.outstanding),
    }));
  }
}
