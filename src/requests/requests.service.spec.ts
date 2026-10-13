import { Test, TestingModule } from '@nestjs/testing';
import { RequestsService } from './requests.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Client } from 'src/clients/entities/client.entity';
import { DocumentRequest } from './entities/documentRequest';

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
});
