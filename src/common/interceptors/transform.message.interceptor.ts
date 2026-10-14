import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import {map} from 'rxjs/operators'
export interface ResponseMessage<T>{
  success: boolean,
  timestamp: string,
  data: T
}

@Injectable()
export class TransformMessageInterceptor<T> implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {

    return next.handle().pipe(map((data: T) => ({
      success: true,
      timestamp: new Date().toISOString(),
      data: data,

    })))
  }
}
