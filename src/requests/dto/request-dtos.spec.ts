import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRequestDto } from './create-request.dto';
import { BulkCreateRequestDto } from './bulk-create-request.dto';
import { UpdateRequestDto } from './update-request.dto';
import { DocumentRequestStatus } from '../entities/document-request-status.enum';

// The same steps as the global ValidationPipe: transform the plain body, then validate it.
async function errorsFor(
  cls:
    | typeof CreateRequestDto
    | typeof BulkCreateRequestDto
    | typeof UpdateRequestDto,
  body: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map((error) => error.property);
}

describe('request DTOs', () => {
  describe('CreateRequestDto', () => {
    it('accepts a title of 255 characters', async () => {
      expect(
        await errorsFor(CreateRequestDto, {
          title: 'a'.repeat(255),
          clientId: 1,
        }),
      ).toEqual([]);
    });

    it('rejects a title of 256 characters', async () => {
      expect(
        await errorsFor(CreateRequestDto, {
          title: 'a'.repeat(256),
          clientId: 1,
        }),
      ).toEqual(['title']);
    });

    it('accepts a description of 10,000 characters', async () => {
      expect(
        await errorsFor(CreateRequestDto, {
          title: 'a',
          description: 'd'.repeat(10000),
          clientId: 1,
        }),
      ).toEqual([]);
    });

    it('rejects a description of 10,001 characters', async () => {
      expect(
        await errorsFor(CreateRequestDto, {
          title: 'a',
          description: 'd'.repeat(10001),
          clientId: 1,
        }),
      ).toEqual(['description']);
    });
  });

  describe('BulkCreateRequestDto', () => {
    it('accepts a description of 10,000 characters', async () => {
      expect(
        await errorsFor(BulkCreateRequestDto, {
          title: 'a',
          description: 'd'.repeat(10000),
          clientIds: [1],
        }),
      ).toEqual([]);
    });

    it('rejects a description of 10,001 characters', async () => {
      expect(
        await errorsFor(BulkCreateRequestDto, {
          title: 'a',
          description: 'd'.repeat(10001),
          clientIds: [1],
        }),
      ).toEqual(['description']);
    });
  });

  describe('UpdateRequestDto', () => {
    const reject = { status: DocumentRequestStatus.Rejected, version: 0 };
    const approve = { status: DocumentRequestStatus.Approved, version: 0 };

    it('accepts a normal reason when rejecting, and trims it', async () => {
      const dto = plainToInstance(UpdateRequestDto, {
        ...reject,
        rejectionReason: '  blurry scan  ',
      });
      expect(await validate(dto)).toEqual([]);
      expect(dto.rejectionReason).toBe('blurry scan');
    });

    it('rejects a reason of 256 characters', async () => {
      expect(
        await errorsFor(UpdateRequestDto, {
          ...reject,
          rejectionReason: 'a'.repeat(256),
        }),
      ).toEqual(['rejectionReason']);
    });

    it('rejects a reason of only spaces when rejecting', async () => {
      expect(
        await errorsFor(UpdateRequestDto, {
          ...reject,
          rejectionReason: '   ',
        }),
      ).toEqual(['rejectionReason']);
    });

    it('rejects a missing reason when rejecting', async () => {
      expect(await errorsFor(UpdateRequestDto, reject)).toEqual([
        'rejectionReason',
      ]);
    });

    it('accepts an approval without a reason', async () => {
      expect(await errorsFor(UpdateRequestDto, approve)).toEqual([]);
    });
  });
});
