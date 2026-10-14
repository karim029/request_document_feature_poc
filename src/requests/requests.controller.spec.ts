import { Test, TestingModule } from '@nestjs/testing';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

describe('RequestsController', () => {
  let controller: RequestsController;
  let fakeService: {
    getAllRequests: jest.Mock;
    getRequest: jest.Mock;
    createRequest: jest.Mock;
    saveDocument: jest.Mock;
    updateStatus: jest.Mock;
  };

  beforeEach(async () => {
    fakeService = {
      getAllRequests: jest.fn(),
      getRequest: jest.fn(),
      createRequest: jest.fn(),
      saveDocument: jest.fn(),
      updateStatus: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RequestsController],
      providers: [{ provide: RequestsService, useValue: fakeService }],
    }).compile();

    controller = module.get<RequestsController>(RequestsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
