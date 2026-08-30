import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Accountant } from './entities/accountant.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Accountant])],
    exports: [TypeOrmModule]
})
export class AcountantsModule {}
