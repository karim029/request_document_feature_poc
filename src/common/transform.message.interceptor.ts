import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Response } from 'express';
import {map} from 'rxjs/operators'
export interface ResponseMessage<T>{
  success: number,
  timeStamp: string,
  data: T
}

@Injectable()
export class TransformMessageInterceptor<T> implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {

    const ctx = context.switchToHttp()
    const res = ctx.getResponse<Response>()
    

    return next.handle().pipe(map((data: T) => ({
      success: res.statusCode ?? 200,
      data: data,
      timeStamp: new Date().toISOString()

    })))
  }
}
