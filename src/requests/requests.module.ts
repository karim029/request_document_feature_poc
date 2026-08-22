import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentRequest } from './entities/documentRequest';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentRequest])],
  controllers: [RequestsController],
  providers: [RequestsService]
})
export class RequestsModule {}
