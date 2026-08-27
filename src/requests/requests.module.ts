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
    limits: {fileSize: 5 * 1024 * 1024},
    fileFilter(req, file, callback) {
      if(!file.mimetype.match(/\/(jpg|jpeg|png|pdf)$/)){
        return callback(null, false)
      }
      callback(null, true)
    },
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, callback)=>{
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        const originalName = file.originalname.replace(/\s+/g, '-')
        const filename = `${uniqueSuffix}-${originalName}`
        callback(null,filename)
      }
    })
  })],
  controllers: [RequestsController],
  providers: [RequestsService]
})
export class RequestsModule {}
