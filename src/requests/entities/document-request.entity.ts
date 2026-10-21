import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DocumentRequestStatus } from './document-request-status.enum';
import { Client } from '../../clients/entities/client.entity';
import { Accountant } from '../../accountants/entities/accountant.entity';

@Entity()
@Index('IDX_request_inbox_created', ['accountant', 'createdAt', 'id'])
@Index('IDX_request_inbox_due', ['accountant', 'dueDate', 'id'])
@Index('IDX_request_inbox_status_created',['accountant','status','createdAt','id'])
@Index('IDX_request_reviewer', ['reviewer'])
export class DocumentRequest {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({
    type: 'enum',
    enum: DocumentRequestStatus,
    default: DocumentRequestStatus.Pending,
  })
  status!: DocumentRequestStatus;

  // MariaDB cannot infer a union type, so the type is explicit
  @Column({ type: 'varchar', length: 255, nullable: true })
  rejectionReason?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'date', nullable: true })
  dueDate?: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  reviewedAt?: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  storageKey?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  originalName?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mimeType?: string | null;

  @Column({ type: 'int', nullable: true })
  fileSize?: number | null;

  @Column({ type: 'char', length: 64, nullable: true })
  checksum?: string | null;

  @Column({ type: 'int', default: 0 })
  version!: number;

  @ManyToOne(() => Client, (client) => client.requests, { nullable: false })
  client!: Client;

  @ManyToOne(() => Accountant, { nullable: false })
  accountant!: Accountant;

  @ManyToOne(() => Accountant, { nullable: true })
  reviewer?: Accountant | null;
}
