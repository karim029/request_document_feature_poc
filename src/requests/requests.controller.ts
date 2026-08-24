import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create.request.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
type MulterFile = Express.Multer.File

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

    @Post('upload/:id')
    @UseInterceptors(FileInterceptor('file'))
    uploadRequestFile(@Param('id',ParseIntPipe) requestId: number, @UploadedFile() file: MulterFile){
      return this.requestsService.saveDocument(requestId, file)
    }
}
