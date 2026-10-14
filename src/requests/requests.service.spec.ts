import { Test, TestingModule } from '@nestjs/testing';
import { RequestsService } from './requests.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Client } from 'src/clients/entities/client.entity';
import { DocumentRequest } from './entities/documentRequest';
import { DocumentRequestStatus } from './entities/documentRequest-status';

describe('RequestsService', () => {
  let service: RequestsService;
  let requestRepo: { find: jest.Mock; findOneBy: jest.Mock; save: jest.Mock }
  let clientRepo: { findOneBy: jest.Mock }


  beforeEach(async () => {
    requestRepo = { find: jest.fn(), findOneBy: jest.fn(), save: jest.fn() }
    clientRepo = { findOneBy: jest.fn() }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        { provide: getRepositoryToken(DocumentRequest), useValue: requestRepo },
        { provide: getRepositoryToken(Client), useValue: clientRepo }
      ],
    }).compile();

    service = module.get<RequestsService>(RequestsService);
  });

  describe('updateStatus', () => {
    
    it('throws when request is not in Reviewing', async () => {
      requestRepo.findOneBy.mockResolvedValue({ id: 1, status: DocumentRequestStatus.Pending })
      await expect(service.updateStatus(1, { status: DocumentRequestStatus.Approved })).rejects.toThrow('Request can only be reviewed if it is currently in Reviewing status')
      expect(requestRepo.save).not.toHaveBeenCalled()

    })
    it('throws when the request does not exist', async () => {
      requestRepo.findOneBy.mockResolvedValue(null)
      await expect(service.updateStatus(1, { status: DocumentRequestStatus.Approved })).rejects.toThrow('Request does not exist.')
      expect(requestRepo.save).not.toHaveBeenCalled()
    })
    it('throws when the status is neither approved or rejected', async () => {
      requestRepo.findOneBy.mockResolvedValue({ id: 1, status: DocumentRequestStatus.Reviewing })
      await expect(service.updateStatus(1, { status: DocumentRequestStatus.Pending })).rejects.toThrow('Review status must be Approved or Rejected')
      expect(requestRepo.save).not.toHaveBeenCalled()
    })
    it('throw if rejected without a reason', async () => {
      requestRepo.findOneBy.mockResolvedValue({ id: 1, status: DocumentRequestStatus.Reviewing })
      await expect(service.updateStatus(1, { status: DocumentRequestStatus.Rejected })).rejects.toThrow('A rejection reason is required when rejecting a request.')
      expect(requestRepo.save).not.toHaveBeenCalled()

    })
    it('saves the request when status is rejected a rejection reason is provided', async () => {
      requestRepo.findOneBy.mockResolvedValue({ id: 1, status: DocumentRequestStatus.Reviewing })
      await service.updateStatus(1, { status: DocumentRequestStatus.Rejected, rejectionReason: 'test' })
      expect(requestRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: DocumentRequestStatus.Rejected, rejectionReason: 'test' }))


    })

    it('make sure request status change to approved, and rejection reason is null', async () => {
      requestRepo.findOneBy.mockResolvedValue({ id: 1, status: DocumentRequestStatus.Reviewing, rejectionReason: 'test' })
      await service.updateStatus(1, { status: DocumentRequestStatus.Approved })
      expect(requestRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: DocumentRequestStatus.Approved, rejectionReason: null }))
    })

  })
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
          documentPath: 'uploads/test.pdf',
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
   describe('getRequest', ()=>{
    it('throws when a request is not found', async()=>{
      requestRepo.findOneBy.mockResolvedValue(null)
      await expect(service.getRequest(3)).rejects.toThrow('No request found with this id')
    })
  })

  describe('createRequest',()=>{
    it('throws when a client is not found', async()=>{
      clientRepo.findOneBy.mockResolvedValue(null)
      await expect(service.createRequest({clientId: 1, title: 'test', description: 'lorem ipsum'})).rejects.toThrow('Client does not exist.')
    })
  })

});
