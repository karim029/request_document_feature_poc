import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RequestsService } from './requests.service';
import { Client } from 'src/clients/entities/client.entity';
import { DocumentRequest } from './entities/document-request.entity';
import { DocumentRequestEvent } from './entities/document-request-event.entity';
import { DocumentRequestStatus } from './entities/document-request-status.enum';

describe('RequestsService', () => {
  let service: RequestsService;
  let requestRepo: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };
  let clientRepo: { findOneBy: jest.Mock; findOne: jest.Mock };
  let manager: {
    findOneBy: jest.Mock;
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

  beforeEach(async () => {
    requestRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
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
      insert: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    dataSource = {
      transaction: jest.fn((callback: (m: typeof manager) => unknown) =>
        callback(manager),
      ),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        { provide: getRepositoryToken(DocumentRequest), useValue: requestRepo },
        { provide: getRepositoryToken(Client), useValue: clientRepo },
        { provide: DataSource, useValue: dataSource },
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
      manager.findOneBy.mockResolvedValueOnce(actor).mockResolvedValueOnce(null);
      qb.execute.mockResolvedValue({ affected: 0 });

      await expect(service.updateStatus(2, 1, approve)).rejects.toThrow(
        'Request does not exist.',
      );
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('returns 409 when someone changed the request (the version differs)', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(actor)
        .mockResolvedValueOnce({
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
      manager.findOneBy
        .mockResolvedValueOnce(actor)
        .mockResolvedValueOnce({
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
    const fakeFile = { path: 'uploads/test.pdf' } as Express.Multer.File;

    it('throws when no file is provided, before touching the database', async () => {
      await expect(
        service.saveDocument(1, undefined as unknown as Express.Multer.File),
      ).rejects.toThrow('No file uploaded or file rejected');
      expect(requestRepo.findOneBy).not.toHaveBeenCalled();
      expect(requestRepo.save).not.toHaveBeenCalled();
    });

    it('throws when the request does not exist', async () => {
      requestRepo.findOneBy.mockResolvedValue(null);
      await expect(service.saveDocument(1, fakeFile)).rejects.toThrow(
        'Request does not exist.',
      );
      expect(requestRepo.save).not.toHaveBeenCalled();
    });

    it('throws when the request is already approved', async () => {
      requestRepo.findOneBy.mockResolvedValue({
        id: 1,
        status: DocumentRequestStatus.Approved,
      });
      await expect(service.saveDocument(1, fakeFile)).rejects.toThrow(
        'Cannot upload file to an already approved request.',
      );
      expect(requestRepo.save).not.toHaveBeenCalled();
    });

    it('stores the file path and moves a pending request to Reviewing', async () => {
      requestRepo.findOneBy.mockResolvedValue({
        id: 1,
        status: DocumentRequestStatus.Pending,
      });
      await service.saveDocument(1, fakeFile);
      expect(requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          storageKey: 'uploads/test.pdf',
          status: DocumentRequestStatus.Reviewing,
        }),
      );
    });

    it('currently allows resubmitting a rejected request (moves it back to Reviewing)', async () => {
      requestRepo.findOneBy.mockResolvedValue({
        id: 1,
        status: DocumentRequestStatus.Rejected,
        rejectionReason: 'old reason',
      });
      await service.saveDocument(1, fakeFile);
      expect(requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: DocumentRequestStatus.Reviewing }),
      );
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