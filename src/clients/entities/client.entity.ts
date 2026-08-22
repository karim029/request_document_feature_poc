import { Accountant } from "src/accountants/entities/accountant.entity";
import { DocumentRequest } from "src/requests/entities/documentRequest";
import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class Client {
    
    @PrimaryGeneratedColumn()
    id!: number
    @Column()
    username!: string
    @Column()
    email!: string
    @ManyToOne(()=> Accountant, (accountant)=> accountant.clients)
    accountant!: Accountant
    @OneToMany(()=> DocumentRequest, (request)=> request.client)
    requests!: DocumentRequest[]
}