import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { DocumentRequestStatus } from "./documentRequest-status";
import { Client } from "src/clients/entities/client.entity";

@Entity()
export class DocumentRequest {

    @PrimaryGeneratedColumn()
    id!: number
    @Column()
    title!: string
    @Column({nullable: true})
    description?: string
    @Column({type: 'enum', enum: DocumentRequestStatus, default: DocumentRequestStatus.Pending })
    status!: DocumentRequestStatus 
    @Column({nullable: true})
    rejectionReason?: string
    @CreateDateColumn()
    createdAt!: Date
    @UpdateDateColumn()
    updatedAt!: Date
    @ManyToOne(()=> Client, (client)=> client.requests)
    client!: Client


}