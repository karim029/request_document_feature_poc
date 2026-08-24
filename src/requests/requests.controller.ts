import { Body, Controller, Get, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create.request.dto';

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

    @Post()
    createNewRequest(@Body() createRequestDto: CreateRequestDto){
        return this.requestsService.createRequest(createRequestDto)
    }
}
