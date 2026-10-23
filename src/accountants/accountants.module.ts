import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Accountant } from './entities/accountant.entity';
import { DashboardController } from './accountant.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Accountant])],
  exports: [TypeOrmModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class AccountantsModule {}
