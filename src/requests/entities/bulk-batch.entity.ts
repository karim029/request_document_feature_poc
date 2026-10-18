import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";


@Entity()
export class BulkBatch{

    @PrimaryGeneratedColumn()
    id!: number
    @Index('UQ_bulk_batch_key', {unique: true})
    @Column({type: 'varchar', length: 64})
    idempotencyKey!: string
    @Column({type: 'char', length: 64})
    requestHash!: string
    @Column({type: 'text'})
    response!: string
    @CreateDateColumn()
    createdAt!: Date


}