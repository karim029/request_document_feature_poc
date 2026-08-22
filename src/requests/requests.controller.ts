import { Controller, Get, Param, Req } from '@nestjs/common';
import { RequestsService } from './requests.service';

@Controller('requests')
export class RequestsController {
    constructor(private readonly requestsService: RequestsService){}

    @Get()
    getAllRequests(){
        return this.requestsService.getAllRequests()
    }
}
