import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RequestsService } from './requests.service';
import { Client } from 'src/clients/entities/client.entity';
import { DocumentRequest } from './entities/document-request.entity';
import { DocumentRequestEvent } from './entities/document-request-event.entity';
import { DocumentRequestStatus } from './entities/document-request-status.enum';
import { sha256File } from '../common/utils/sha256-file';
import { InboxSort } from './dto/inbox-query.dto';
import { encodeCursor, decodeCursor } from './inbox-cursor';
jest.mock('../common/utils/sha256-file');

describe('RequestsService', () => {
  let inboxQb: {
    innerJoin: jest.Mock;
    select: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    limit: jest.Mock;
    getMany: jest.Mock;
  };
  let service: RequestsService;
  let requestRepo: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    existsBy: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let clientRepo: { findOneBy: jest.Mock; findOne: jest.Mock };
  let manager: {
    findOneBy: jest.Mock;
    findOne: jest.Mock;
    insert: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let qb: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  let eventRepo: { find: jest.Mock };

  beforeEach(async () => {
    eventRepo = { find: jest.fn() };
    requestRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      existsBy: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    clientRepo = { findOneBy: jest.fn(), findOne: jest.fn() };
    qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };
    manager = {
      findOneBy: jest.fn(),
      findOne: jest.fn(),
      insert: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    dataSource = {
      transaction: jest.fn(
        (first: unknown, second?: (m: typeof manager) => unknown) =>
          (
            (typeof first === 'function' ? first : second) as (
              m: typeof manager,
            ) => unknown
          )(manager),
      ),
    };
    inboxQb = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    requestRepo.createQueryBuilder.mockReturnValue(inboxQb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        { provide: getRepositoryToken(DocumentRequest), useValue: requestRepo },
        { provide: getRepositoryToken(Client), useValue: clientRepo },
        { provide: DataSource, useValue: dataSource },
        {
          provide: getRepositoryToken(DocumentRequestEvent),
          useValue: eventRepo,
        },
      ],
    }).compile();

    service = module.get<RequestsService>(RequestsService);
  });

  describe('updateStatus', () => {
    const actor = { id: 1 };
    const approve = { status: DocumentRequestStatus.Approved, version: 0 };

    it('rejects a non-final status before opening a transaction', async () => {
      await expect(
        service.updateStatus(2, 1, {
          status: DocumentRequestStatus.Pending,
          version: 0,
        }),
      ).rejects.toThrow('Review status must be Approved or Rejected');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('requires a reason when rejecting, before opening a transaction', async () => {
      await expect(
        service.updateStatus(2, 1, {
          status: DocumentRequestStatus.Rejected,
          version: 0,
        }),
      ).rejects.toThrow(
        'A rejection reason is required when rejecting a request.',
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('stops when the actor is not an accountant', async () => {
      manager.findOneBy.mockResolvedValue(null);
      await expect(service.updateStatus(2, 99, approve)).rejects.toThrow(
        'Only an accountant',
      );
      expect(qb.execute).not.toHaveBeenCalled();
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('approves, clears the rejection reason and inserts one event', async () => {
      const updated = {
        id: 2,
        status: DocumentRequestStatus.Approved,
        version: 1,
      };
      manager.findOneBy
        .mockResolvedValueOnce(actor)
        .mockResolvedValueOnce(updated);
      qb.execute.mockResolvedValue({ affected: 1 });

      const result = await service.updateStatus(2, 1, approve);

      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: DocumentRequestStatus.Approved,
          rejectionReason: null,
        }),
      );
      expect(manager.insert).toHaveBeenCalledTimes(1);
      expect(manager.insert).toHaveBeenCalledWith(
        DocumentRequestEvent,
        expect.objectContaining({
          fromStatus: DocumentRequestStatus.Reviewing,
          toStatus: DocumentRequestStatus.Approved,
          actorAccountant: actor,
        }),
      );
      expect(result).toBe(updated);
    });

    it('rejects with a reason and records the reason in the event', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(actor)
        .mockResolvedValueOnce({ id: 2 });
      qb.execute.mockResolvedValue({ affected: 1 });

      await service.updateStatus(2, 1, {
        status: DocumentRequestStatus.Rejected,
        rejectionReason: 'blurry',
        version: 0,
      });

      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: DocumentRequestStatus.Rejected,
          rejectionReason: 'blurry',
        }),
      );
      expect(manager.insert).toHaveBeenCalledWith(
        DocumentRequestEvent,
        expect.objectContaining({
          toStatus: DocumentRequestStatus.Rejected,
          reason: 'blurry',
        }),
      );
    });

    it('passes the id, the version and the reviewing status to the database guard', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(actor)
        .mockResolvedValueOnce({ id: 2 });
      qb.execute.mockResolvedValue({ affected: 1 });

      await service.updateStatus(2, 1, { ...approve, version: 7 });

      expect(qb.where).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          id: 2,
          version: 7,
          reviewing: DocumentRequestStatus.Reviewing,
        }),
      );
    });

    it('returns 404 when the request does not exist', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(actor)
        .mockResolvedValueOnce(null);
      qb.execute.mockResolvedValue({ affected: 0 });

      await expect(service.updateStatus(2, 1, approve)).rejects.toThrow(
        'Request does not exist.',
      );
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('returns 409 when someone changed the request (the version differs)', async () => {
      manager.findOneBy.mockResolvedValueOnce(actor).mockResolvedValueOnce({
        id: 2,
        version: 1,
        status: DocumentRequestStatus.Approved,
      });
      qb.execute.mockResolvedValue({ affected: 0 });

      await expect(service.updateStatus(2, 1, approve)).rejects.toThrow(
        ConflictException,
      );
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('returns 400 when the version matches but the request is not reviewing', async () => {
      manager.findOneBy.mockResolvedValueOnce(actor).mockResolvedValueOnce({
        id: 2,
        version: 0,
        status: DocumentRequestStatus.Pending,
      });
      qb.execute.mockResolvedValue({ affected: 0 });

      await expect(service.updateStatus(2, 1, approve)).rejects.toThrow(
        'Request can only be reviewed if it is currently in Reviewing status',
      );
      expect(manager.insert).not.toHaveBeenCalled();
    });
  });

  describe('saveDocument', () => {
    const file = {
      originalname: 'passport.pdf',
      filename: '1792-passport.pdf',
      path: 'uploads/1792-passport.pdf',
      mimetype: 'application/pdf',
      size: 1234,
    } as Express.Multer.File;
    const client = { id: 5 };
    const rejectedRequest = {
      id: 2,
      status: DocumentRequestStatus.Rejected,
      version: 3,
      client,
    };

    beforeEach(() => {
      jest.mocked(sha256File).mockResolvedValue('checksum123');
    });

    it('throws when no file is provided, before reading it or opening a transaction', async () => {
      await expect(
        service.saveDocument(
          2,
          5,
          3,
          undefined as unknown as Express.Multer.File,
        ),
      ).rejects.toThrow('No file uploaded or file rejected');
      expect(sha256File).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('stops when the actor is not a client', async () => {
      manager.findOneBy.mockResolvedValue(null);
      await expect(service.saveDocument(2, 99, 3, file)).rejects.toThrow(
        'Only a client',
      );
      expect(qb.execute).not.toHaveBeenCalled();
    });

    it('returns 404 when the request does not exist', async () => {
      manager.findOneBy.mockResolvedValue(client);
      manager.findOne.mockResolvedValue(null);
      await expect(service.saveDocument(2, 5, 3, file)).rejects.toThrow(
        'not found',
      );
      expect(qb.execute).not.toHaveBeenCalled();
    });

    it('stops when the actor is not the client of this request', async () => {
      manager.findOneBy.mockResolvedValue({ id: 9 });
      manager.findOne.mockResolvedValue(rejectedRequest);
      await expect(service.saveDocument(2, 9, 3, file)).rejects.toThrow(
        'client of this request',
      );
      expect(qb.execute).not.toHaveBeenCalled();
    });

    it('refuses an upload to an approved request', async () => {
      manager.findOneBy.mockResolvedValue(client);
      manager.findOne.mockResolvedValue({
        ...rejectedRequest,
        status: DocumentRequestStatus.Approved,
      });
      await expect(service.saveDocument(2, 5, 3, file)).rejects.toThrow(
        'approved',
      );
      expect(qb.execute).not.toHaveBeenCalled();
    });

    it('uploads, resets the decision fields and inserts one event', async () => {
      const updated = {
        id: 2,
        status: DocumentRequestStatus.Reviewing,
        version: 4,
      };
      manager.findOneBy
        .mockResolvedValueOnce(client)
        .mockResolvedValueOnce(updated);
      manager.findOne.mockResolvedValue(rejectedRequest);
      qb.execute.mockResolvedValue({ affected: 1 });

      const result = await service.saveDocument(2, 5, 3, file);

      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: DocumentRequestStatus.Reviewing,
          rejectionReason: null,
          reviewedAt: null,
          storageKey: '1792-passport.pdf',
          originalName: 'passport.pdf',
          mimeType: 'application/pdf',
          fileSize: 1234,
          checksum: 'checksum123',
        }),
      );
      expect(manager.insert).toHaveBeenCalledTimes(1);
      expect(manager.insert).toHaveBeenCalledWith(
        DocumentRequestEvent,
        expect.objectContaining({
          request: { id: 2 },
          fromStatus: DocumentRequestStatus.Rejected,
          toStatus: DocumentRequestStatus.Reviewing,
          actorClient: { id: 5 },
        }),
      );
      expect(result).toBe(updated);
    });

    it('stores the file name, never the full path', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(client)
        .mockResolvedValueOnce({ id: 2 });
      manager.findOne.mockResolvedValue(rejectedRequest);
      qb.execute.mockResolvedValue({ affected: 1 });

      await service.saveDocument(2, 5, 3, file);

      expect(qb.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ storageKey: file.path }),
      );
    });

    it('passes the id, the version and only the allowed statuses to the database guard', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(client)
        .mockResolvedValueOnce({ id: 2 });
      manager.findOne.mockResolvedValue(rejectedRequest);
      qb.execute.mockResolvedValue({ affected: 1 });

      await service.saveDocument(2, 5, 3, file);

      expect(qb.where).toHaveBeenCalledWith(expect.any(String), {
        id: 2,
        version: 3,
        statuses: [
          DocumentRequestStatus.Pending,
          DocumentRequestStatus.Rejected,
          DocumentRequestStatus.Reviewing,
        ],
      });
    });

    it('returns 409 when the version changed meanwhile', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(client)
        .mockResolvedValueOnce({ id: 2, version: 4 });
      manager.findOne.mockResolvedValue(rejectedRequest);
      qb.execute.mockResolvedValue({ affected: 0 });

      await expect(service.saveDocument(2, 5, 3, file)).rejects.toThrow(
        ConflictException,
      );
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('returns 400 when the version matches but the status no longer allows an upload', async () => {
      manager.findOneBy.mockResolvedValueOnce(client).mockResolvedValueOnce({
        id: 2,
        version: 3,
        status: DocumentRequestStatus.Approved,
      });
      manager.findOne.mockResolvedValue(rejectedRequest);
      qb.execute.mockResolvedValue({ affected: 0 });

      await expect(service.saveDocument(2, 5, 3, file)).rejects.toThrow(
        'pending, reviewing or rejected',
      );
      expect(manager.insert).not.toHaveBeenCalled();
    });
  });

  describe('getRequest', () => {
    it('throws when a request is not found', async () => {
      requestRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getRequest(3)).rejects.toThrow(
        'No request found with this id',
      );
    });
  });
  describe('getHistory', () => {
    it('returns 404 when the request does not exist', async () => {
      requestRepo.existsBy.mockResolvedValue(false);
      await expect(service.getHistory(9)).rejects.toThrow(
        'Request does not exist',
      );
      expect(eventRepo.find).not.toHaveBeenCalled();
    });

    it('returns an empty list when the request has no events', async () => {
      requestRepo.existsBy.mockResolvedValue(true);
      eventRepo.find.mockResolvedValue([]);
      await expect(service.getHistory(2)).resolves.toEqual([]);
    });

    it('reads the events in order, with both actor relations, in one query', async () => {
      requestRepo.existsBy.mockResolvedValue(true);
      eventRepo.find.mockResolvedValue([]);

      await service.getHistory(2);

      expect(eventRepo.find).toHaveBeenCalledTimes(1);
      expect(eventRepo.find).toHaveBeenCalledWith({
        where: { request: { id: 2 } },
        relations: { actorAccountant: true, actorClient: true },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    });

    it('maps each event and tells accountant and client actors apart', async () => {
      const first = new Date('2026-10-19T16:40:22.000Z');
      const second = new Date('2026-10-19T17:56:38.000Z');
      requestRepo.existsBy.mockResolvedValue(true);
      eventRepo.find.mockResolvedValue([
        {
          id: 1,
          fromStatus: DocumentRequestStatus.Reviewing,
          toStatus: DocumentRequestStatus.Rejected,
          reason: 'blurry',
          createdAt: first,
          actorAccountant: { id: 1, email: 'a@test.com' },
          actorClient: null,
        },
        {
          id: 2,
          fromStatus: DocumentRequestStatus.Rejected,
          toStatus: DocumentRequestStatus.Reviewing,
          reason: null,
          createdAt: second,
          actorAccountant: null,
          actorClient: { id: 5, email: 'c@test.com' },
        },
      ]);

      await expect(service.getHistory(2)).resolves.toEqual([
        {
          id: 1,
          fromStatus: DocumentRequestStatus.Reviewing,
          toStatus: DocumentRequestStatus.Rejected,
          reason: 'blurry',
          createdAt: first,
          actor: { type: 'accountant', id: 1 },
        },
        {
          id: 2,
          fromStatus: DocumentRequestStatus.Rejected,
          toStatus: DocumentRequestStatus.Reviewing,
          reason: null,
          createdAt: second,
          actor: { type: 'client', id: 5 },
        },
      ]);
    });
  });

  describe('getInbox', () => {
    const base = { accountantId: 1, sort: InboxSort.CreatedDesc, limit: 2 };
    const row = (id: number) => ({
      id,
      title: `t${id}`,
      status: DocumentRequestStatus.Pending,
      dueDate: null,
      createdAt: new Date('2026-10-01'),
      version: 0,
      client: { id: 5, username: 'client 5', email: 'c@test.com' },
    });

    it('always filters by the accountant', async () => {
      await service.getInbox(base);
      expect(inboxQb.where).toHaveBeenCalledWith(
        'r.accountantId = :accountantId',
        { accountantId: 1 },
      );
    });

    it('adds the optional filters only when they are sent', async () => {
      await service.getInbox(base);
      expect(inboxQb.andWhere).not.toHaveBeenCalled();

      await service.getInbox({
        ...base,
        clientId: 5,
        status: [
          DocumentRequestStatus.Pending,
          DocumentRequestStatus.Reviewing,
        ],
      });
      expect(inboxQb.andWhere).toHaveBeenCalledWith('r.clientId = :clientId', {
        clientId: 5,
      });
      expect(inboxQb.andWhere).toHaveBeenCalledWith(
        'r.status IN (:...statuses)',
        {
          statuses: [
            DocumentRequestStatus.Pending,
            DocumentRequestStatus.Reviewing,
          ],
        },
      );
    });

    it('sorts newest first by default, with the id as tie-breaker', async () => {
      await service.getInbox(base);
      expect(inboxQb.orderBy).toHaveBeenCalledWith('r.createdAt', 'DESC');
      expect(inboxQb.addOrderBy).toHaveBeenCalledWith('r.id', 'DESC');
    });

    it('sorts by due date and leaves out requests without one', async () => {
      await service.getInbox({ ...base, sort: InboxSort.DueAsc });
      expect(inboxQb.andWhere).toHaveBeenCalledWith('r.dueDate IS NOT NULL');
      expect(inboxQb.orderBy).toHaveBeenCalledWith('r.dueDate', 'ASC');
      expect(inboxQb.addOrderBy).toHaveBeenCalledWith('r.id', 'ASC');
    });

    it('asks for one extra row to know if there is a next page', async () => {
      await service.getInbox(base);
      expect(inboxQb.limit).toHaveBeenCalledWith(3);
    });

    it('returns a cursor for the last item when there is a next page', async () => {
      inboxQb.getMany.mockResolvedValue([row(9), row(8), row(7)]);
      const result = await service.getInbox(base);
      expect(result.items).toHaveLength(2);
      expect(decodeCursor(result.nextCursor as string)).toEqual({
        sort: InboxSort.CreatedDesc,
        id: 8,
      });
    });

    it('returns no cursor on the last page', async () => {
      inboxQb.getMany.mockResolvedValue([row(2), row(1)]);
      const result = await service.getInbox(base);
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it('returns only the chosen client fields, no email', async () => {
      inboxQb.getMany.mockResolvedValue([row(1)]);
      const result = await service.getInbox(base);
      expect(result.items[0].client).toEqual({ id: 5, username: 'client 5' });
    });

    it('rejects a cursor that cannot be decoded', async () => {
      await expect(
        service.getInbox({ ...base, cursor: 'garbage' }),
      ).rejects.toThrow('Invalid cursor');
    });

    it('rejects a cursor made for a different sort', async () => {
      const cursor = encodeCursor({ sort: InboxSort.DueAsc, id: 4 });
      await expect(service.getInbox({ ...base, cursor })).rejects.toThrow(
        'does not match the sort',
      );
    });
  });

  describe('createRequest', () => {
    it('throws when a client is not found', async () => {
      clientRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createRequest({
          clientId: 1,
          title: 'test',
          description: 'lorem ipsum',
        }),
      ).rejects.toThrow('Client does not exist.');
      expect(requestRepo.save).not.toHaveBeenCalled();
    });

    it("copies the client's accountant onto the new request", async () => {
      const accountant = { id: 7 };
      clientRepo.findOne.mockResolvedValue({ id: 1, accountant });
      requestRepo.save.mockResolvedValue({ id: 10 });

      await service.createRequest({ clientId: 1, title: 'test' });

      expect(requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ accountant }),
      );
    });
  });
});
