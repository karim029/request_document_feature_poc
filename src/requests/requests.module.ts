import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentRequest } from './entities/documentRequest';
import { Client } from 'src/clients/entities/client.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentRequest, Client])],
  controllers: [RequestsController],
  providers: [RequestsService]
})
export class RequestsModule {}
