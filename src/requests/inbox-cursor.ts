import { BadRequestException } from '@nestjs/common';

export interface InboxCursor {
  sort: string;
  id: number;
}

export function encodeCursor(cursor: InboxCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string): InboxCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<InboxCursor>;
    if (typeof parsed.sort !== 'string' || !Number.isInteger(parsed.id)) {
      throw new Error('bad cursor');
    }
    return parsed as InboxCursor;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
