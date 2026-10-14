import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { TransformMessageInterceptor } from './transform.message.interceptor';

describe('TransformMessageInterceptor', () => {
  it('wraps the handler result in the success envelope', async () => {
    const interceptor = new TransformMessageInterceptor();
    const next: CallHandler = { handle: () => of({ id: 1 }) };

    const result = await lastValueFrom(
      interceptor.intercept({} as ExecutionContext, next),
    );

    expect(result).toEqual({
      success: true,
      timestamp: expect.any(String),
      data: { id: 1 },
    });
  });
});