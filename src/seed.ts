import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DocumentRequest } from "./requests/entities/documentRequest";
import { Accountant } from "./accountants/entities/accountant.entity";
import { Client } from "./clients/entities/client.entity";
import { Repository } from "typeorm";
import { DocumentRequestStatus } from "./requests/entities/documentRequest-status";

async function seed(){
    const app = await NestFactory.createApplicationContext(AppModule)

    const docReqRepo = app.get<Repository<DocumentRequest>>(getRepositoryToken(DocumentRequest))
    const accRepo = app.get<Repository<Accountant>>(getRepositoryToken(Accountant))
    const clientRepo = app.get<Repository<Client>>(getRepositoryToken(Client))

    const acc1 = await accRepo.save({
        username: "accountant 1",
        email: "accountant1@test.com"
    })
    
    const acc2 = await accRepo.save({
        username: "accountant 2",
        email: "accountant2@test.com"
    })
    console.log("accountants saved: ", acc1, acc2)

    const clients = await clientRepo.save([{
        username: "client 1",
        email: "client1@test.com",
        accountant: acc1
    },{
        username: "client 2",
        email: "client2@test.com",
        accountant: acc2
    },{
        username: "client 3",
        email: "client3@test.com",
        accountant: acc1
    },{
        username: "client 4",
        email: "client4@test.com",
        accountant: acc2
    }])
    
    console.log('Clients Saved', clients)

    const documents = await docReqRepo.save([
        {
            title: "Business Registration License",
            description: "Please provide the license as soon as possible",
            status: DocumentRequestStatus.Pending,
            client: clients[0]
        },
        {
            title: "Passport Copy",
            description: "Needed for KYC verification",
            status: DocumentRequestStatus.Reviewing,
            documentPath: "uploads/fake-passport.pdf",
            client: clients[1]
        },
        {
            title: "Bank Statement",
            description: "Last 3 months statement required",
            status: DocumentRequestStatus.Approved,
            documentPath: "uploads/fake-bank-statement.pdf",
            client: clients[2]
        },
        {
            title: "Tax Certificate",
            description: "Original certificate needed",
            status: DocumentRequestStatus.Rejected,
            documentPath: "uploads/fake-tax-cert.pdf",
            rejectionReason: "Document is blurry, please resubmit a clearer scan",
            client: clients[3]
        }
    ]);

    console.log('Documents saved', documents);

    await app.close()
}
seed()