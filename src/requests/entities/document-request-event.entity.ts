import { Column, CreateDateColumn, Entity, Index, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { DocumentRequest } from "./document-request.entity";
import { DocumentRequestStatus } from "./document-request-status.enum";
import { Accountant } from "src/accountants/entities/accountant.entity";
import { Client } from "src/clients/entities/client.entity";


@Entity()
@Index('IDX_event_request_history',['request','createdAt','id'])
export class DocumentRequestEvent {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({type: 'enum',enum: DocumentRequestStatus, nullable: true})
  fromStatus?: DocumentRequestStatus

  @Column({type: 'enum', enum: DocumentRequestStatus, nullable: false})
  toStatus!: DocumentRequestStatus

  @Column({type: 'text', nullable: true})
  reason?: string

  @CreateDateColumn()
  createdAt!: Date

  @ManyToOne(()=> Accountant ,{nullable: true})
  actorAccountant?: Accountant | null
  @ManyToOne(()=> Client ,{nullable: true})
  actorClient?: Client | null
  @ManyToOne(()=>DocumentRequest, {nullable: false})
  requestId!: DocumentRequest
}