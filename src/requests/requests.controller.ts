import { Controller, Get, Param, ParseIntPipe, Req } from '@nestjs/common';
import { RequestsService } from './requests.service';

@Controller('requests')
export class RequestsController {
    constructor(private readonly requestsService: RequestsService){}

    @Get()
    getAllRequests(){
        return this.requestsService.getAllRequests()
    }

    @Get(':id')
    getRequest(@Param('id',ParseIntPipe) id: number){
        return this.requestsService.getRequest(id)
    }
}
