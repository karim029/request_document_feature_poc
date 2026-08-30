import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { DocumentRequestStatus } from "./documentRequest-status";
import { Client } from "../../clients/entities/client.entity";

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
    @Column({ type: 'varchar', length: 255, nullable: true }) // my sql doesn't support type interference 
    rejectionReason?: string | null
    @CreateDateColumn()
    createdAt!: Date
    @UpdateDateColumn()
    updatedAt!: Date
    @Column({ type: 'varchar', length: 255, nullable: true })
    documentPath?: string
    @ManyToOne(()=> Client, (client)=> client.requests)
    client!: Client


}