import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TransformMessageInterceptor } from './common/interceptors/transform-message.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

// The global setup, shared by main.ts and the integration tests so both run the same app.
export function configureApp(app: INestApplication): void {
  app.useGlobalInterceptors(new TransformMessageInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
