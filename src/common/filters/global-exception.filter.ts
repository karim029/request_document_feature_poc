import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string;
    if (!isHttpException) {
      message = 'Something went wrong. Please try again later';
      this.logger.error(exception);
    } else {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const inner = (body as { message?: string | string[] }).message;
        message = Array.isArray(inner)
          ? inner.join('; ')
          : (inner ?? exception.message);
      }
    }

    res.status(status).json({
      success: false,
      message,
      statusCode: status,
      timestamp: new Date().toISOString(),
    });
  }
}
