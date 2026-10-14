import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { TransformMessageInterceptor } from './transform.message.interceptor';

describe('TransformMessageInterceptor', () => {
  it('wraps the handler result in the success envelope', async () => {
    const interceptor = new TransformMessageInterceptor<{ id: number }>();
    const next: CallHandler<{ id: number }> = { handle: () => of({ id: 1 }) };

    const result = await lastValueFrom(
      interceptor.intercept({} as ExecutionContext, next),
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 1 });
    expect(typeof result.timestamp).toBe('string');
  });
});
