import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DocumentRequest } from './entities/documentRequest';
import { Repository } from 'typeorm';

@Injectable()
export class RequestsService {
    constructor(@InjectRepository(DocumentRequest)
    private requestRepository: Repository<DocumentRequest>,
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

}
