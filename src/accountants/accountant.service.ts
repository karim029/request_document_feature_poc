import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

type StatusCounts = Record<'pending' | 'reviewing' | 'approved' | 'rejected', number>;

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

/**
 * The naive (live) dashboard: four small aggregate queries, run on every call.
 * Definitions follow DESIGN.md section 10: a request is open while it is pending or reviewing,
 * and overdue when it is open and its due date has passed.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly dataSource: DataSource) {}

  async getDashboard(accountantId: number): Promise<DashboardResponse> {
    await this.ensureAccountantExists(accountantId);

    // The four queries run at the same time. To compare with running them one after another,
    // await each of them in turn instead (that is a measurable change: see PERFORMANCE.md).
    const [countsByStatus, overdueCount, avgReviewTurnaroundHours, topClientsByOutstanding] =
      await Promise.all([
        this.getCountsByStatus(accountantId),
        this.getOverdueCount(accountantId),
        this.getAverageTurnaroundHours(accountantId),
        this.getTopClients(accountantId),
      ]);

    return { countsByStatus, overdueCount, avgReviewTurnaroundHours, topClientsByOutstanding };
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
    const rows = await this.dataSource.query<Array<{ status: string; n: string }>>(
      `SELECT status, COUNT(*) AS n
         FROM document_request
        WHERE accountantId = ?
        GROUP BY status`,
      [accountantId],
    );
    const counts: StatusCounts = { pending: 0, reviewing: 0, approved: 0, rejected: 0 };
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
  private async getAverageTurnaroundHours(accountantId: number): Promise<number | null> {
    const rows = await this.dataSource.query<Array<{ seconds: string | null }>>(
      `SELECT AVG(TIMESTAMPDIFF(SECOND, up.createdAt, decided.createdAt)) AS seconds
         FROM document_request_event decided
         JOIN document_request_event up
           ON up.requestId = decided.requestId AND up.toStatus = 'reviewing'
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

  // The 10 clients with the most open requests.
  private async getTopClients(accountantId: number): Promise<TopClient[]> {
    const rows = await this.dataSource.query<
      Array<{ clientId: number; username: string; outstanding: string }>
    >(
      `SELECT c.id AS clientId, c.username, COUNT(*) AS outstanding
         FROM document_request r
         JOIN client c ON c.id = r.clientId
        WHERE r.accountantId = ?
          AND r.status IN ('pending', 'reviewing')
        GROUP BY c.id, c.username
        ORDER BY outstanding DESC, c.id
        LIMIT 10`,
      [accountantId],
    );
    return rows.map((row) => ({
      clientId: row.clientId,
      username: row.username,
      outstanding: Number(row.outstanding),
    }));
  }
}