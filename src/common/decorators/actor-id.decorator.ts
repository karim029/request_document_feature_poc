import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { Request } from 'express';

export const ActorId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const raw = request.headers['x-actor-id'];
    const actorId = Number(Array.isArray(raw) ? raw[0] : raw);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      throw new BadRequestException(
        'The X-Actor-Id header must be a positive integer',
      );
    }
    return actorId;
  },
);