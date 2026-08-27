import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DocumentRequest } from './entities/documentRequest';
import { Repository } from 'typeorm';
import { CreateRequestDto } from './dto/create.request.dto';
import { Client } from 'src/clients/entities/client.entity';
import { DocumentRequestStatus } from './entities/documentRequest-status';
import { UpdateRequestDto } from './dto/update.request.dto';

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
       if(req.status === DocumentRequestStatus.Approved){
        throw new BadRequestException('Cannot upload file to an already approved request.')
       }
       req.documentPath = file.path
       req.status = DocumentRequestStatus.Reviewing
       return await this.requestRepository.save(req)
     
    }

    async updateStatus(id: number, updateRequestDto: UpdateRequestDto){
        const req = await this.requestRepository.findOneBy({id:id})
        if(!req){
         throw new NotFoundException('Request does not exist.')
       }
       if (updateRequestDto.status !== DocumentRequestStatus.Approved && updateRequestDto.status !== DocumentRequestStatus.Rejected) {
         throw new BadRequestException('Review status must be Approved or Rejected');
        }
        if(req.status !== DocumentRequestStatus.Reviewing){
            throw new BadRequestException('Request can only be reviewed if it is currently in Reviewing status')
        }
        if (updateRequestDto.status === DocumentRequestStatus.Rejected && !updateRequestDto.rejectionReason) {
            throw new BadRequestException('A rejection reason is required when rejecting a request.');
        }
        req.status = updateRequestDto.status
        if(req.status === DocumentRequestStatus.Approved){
            req.rejectionReason = null
        }else{
            req.rejectionReason = updateRequestDto.rejectionReason
        }
       
       return await this.requestRepository.save(req)
    }

}
