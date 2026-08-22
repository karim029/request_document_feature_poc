import { Client } from "src/clients/entities/client.entity";
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";


@Entity()
export class Accountant {
    @PrimaryGeneratedColumn()
    id!: number
    @Column()
    username!: string
    @Column()
    email!: string
    @OneToMany(()=> Client, (client)=> client.accountant)
    clients!: Client[]

}