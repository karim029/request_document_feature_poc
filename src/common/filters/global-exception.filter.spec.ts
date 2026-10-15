import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let json: jest.Mock<void, [Record<string, unknown>]>;
  let status: jest.Mock;
  let host: ArgumentsHost;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    json = jest.fn<void, [Record<string, unknown>]>();
    status = jest.fn().mockReturnValue({ json });
    host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    logSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('passes a plain string message through with its status', () => {
    filter.catch(new HttpException('Teapot', 418), host);
    expect(status).toHaveBeenCalledWith(418);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Teapot',
        statusCode: 418,
      }),
    );
  });

  it('turns a NotFoundException into a readable string message', () => {
    filter.catch(new NotFoundException('Request does not exist.'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Request does not exist.',
      }),
    );
  });

  it('joins validation messages into one string', () => {
    filter.catch(
      new BadRequestException({
        message: ['a is required', 'b must be a string'],
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'a is required; b must be a string' }),
    );
  });

  it('hides unexpected errors from the client and logs them', () => {
    const boom = new Error('boom');
    filter.catch(boom, host);
    expect(logSpy).toHaveBeenCalledWith(boom);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Something went wrong. Please try again later');
    expect(JSON.stringify(body)).not.toContain('boom');
    expect(logSpy).toHaveBeenCalled();
  });
});
