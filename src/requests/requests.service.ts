import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DocumentRequest } from './entities/documentRequest';
import { Repository } from 'typeorm';
import { CreateRequestDto } from './dto/create.request.dto';
import { Client } from 'src/clients/entities/client.entity';
import { DocumentRequestStatus } from './entities/documentRequest-status';

@Injectable()
export class RequestsService {
    constructor(@InjectRepository(DocumentRequest)
    private requestRepository: Repository<DocumentRequest>, @InjectRepository(Client) private clientRepository: Repository<Client>
){}


    async getAllRequests(){
       return await this.requestRepository.find()
    }

    async getRequest(id: number){
        const request = await this.requestRepository.findOneBy({id})
        if(!request){
            throw new NotFoundException('No request found with this id')
        }
        return request
    }

    async createRequest(createRequestDto: CreateRequestDto){

        const client = await this.clientRepository.findOneBy({id: createRequestDto.clientId})
        if(!client){
            throw new NotFoundException('Client does not exist.')
        }

        const newRequest = {
            title: createRequestDto.title,
            description: createRequestDto.description,
            client: client
        }

        return await this.requestRepository.save(newRequest)

    }

    async saveDocument(requestId: number ,file: Express.Multer.File ){

       // fetch the request
       const req = await this.requestRepository.findOneBy({id: requestId})
       if(!req){
        throw new NotFoundException('Request does not exist.')
       }
       if(req.status === DocumentRequestStatus.Approved || req.status === DocumentRequestStatus.Rejected ){
        throw new BadRequestException('Cannot upload file!')
       }
       req.documentPath = file.path
       req.status = DocumentRequestStatus.Reviewing
       return await this.requestRepository.save(req)
     
    }

}
