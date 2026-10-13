import { Test, TestingModule } from '@nestjs/testing';
import { RequestsService } from './requests.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Client } from 'src/clients/entities/client.entity';
import { DocumentRequest } from './entities/documentRequest';
import { DocumentRequestStatus } from './entities/documentRequest-status';
import { stat } from 'fs';

describe('RequestsService', () => {
  let service: RequestsService;
  let requestRepo: {find: jest.Mock; findOneBy: jest.Mock; save: jest.Mock}
  let clientRepo: {findOneBy: jest.Mock}


  beforeEach(async () => {
    requestRepo = {find: jest.fn(), findOneBy: jest.fn(), save: jest.fn()}
    clientRepo = {findOneBy: jest.fn()}
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        {provide: getRepositoryToken(DocumentRequest), useValue: requestRepo},
        {provide: getRepositoryToken(Client), useValue: clientRepo}
      ],
    }).compile();

    service = module.get<RequestsService>(RequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws when request is not in Reviewing', async()=> {
    requestRepo.findOneBy.mockResolvedValue({id: 1, status: DocumentRequestStatus.Pending})
    await expect(service.updateStatus(1,{status: DocumentRequestStatus.Approved})).rejects.toThrow('Request can only be reviewed if it is currently in Reviewing status')
    expect(requestRepo.save).not.toHaveBeenCalled()

  })

  it('make sure request status change to approved, and rejection reason is null', async()=>{
    requestRepo.findOneBy.mockResolvedValue({id:1, status: DocumentRequestStatus.Reviewing, rejectionReason: 'test'})
    await service.updateStatus(1, {status: DocumentRequestStatus.Approved})
    expect(requestRepo.save).toHaveBeenCalledWith(expect.objectContaining({status: DocumentRequestStatus.Approved, rejectionReason: null}))
  })
});
