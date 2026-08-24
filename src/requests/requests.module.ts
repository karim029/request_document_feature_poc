import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentRequest } from './entities/documentRequest';
import { Client } from 'src/clients/entities/client.entity';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentRequest, Client]),MulterModule.register({
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb)=>{
        const filename = `${Date.now()}-${file.originalname}`
        cb(null,filename)
      }
    })
  })],
  controllers: [RequestsController],
  providers: [RequestsService]
})
export class RequestsModule {}
