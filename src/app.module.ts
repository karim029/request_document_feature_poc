import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Accountant } from './accountants/entities/accountant.entity';
import { Client } from './clients/entities/client.entity';
import { DocumentRequest } from './requests/entities/document-request.entity';
import { RequestsModule } from './requests/requests.module';
import { AccountantsModule } from './accountants/accountants.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_DATABASE'),
        entities: [Accountant, Client, DocumentRequest],
        synchronize: false,
        timezone: 'Z',
      }),
    }),
    RequestsModule,
    AccountantsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
