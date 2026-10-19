import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { UpdateRequestDto } from './dto/update-request.dto';
type MulterFile = Express.Multer.File;

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get()
  getAllRequests() {
    return this.requestsService.getAllRequests();
  }

  @Get(':id')
  getRequest(@Param('id', ParseIntPipe) id: number) {
    return this.requestsService.getRequest(id);
  }

  @Post()
  createNewRequest(@Body() createRequestDto: CreateRequestDto) {
    return this.requestsService.createRequest(createRequestDto);
  }

  @Post('upload/:id')
  @UseInterceptors(FileInterceptor('file'))
  uploadRequestFile(
    @Param('id', ParseIntPipe) requestId: number,
    @UploadedFile() file: MulterFile,
  ) {
    return this.requestsService.saveDocument(requestId, file);
  }

  @Patch('review/:id')
  updateRequestStatus(
    @Param('id', ParseIntPipe) id: number,
    @Headers('x-actor-id') rawActorId: string,
    @Body() updateRequestDto: UpdateRequestDto,
  ) {
    const actorId = Number(rawActorId)
    if(!Number.isInteger(actorId) || actorId <= 0){
      throw new BadRequestException('The X-Actor-Id header must be a positive integer')
    }
    return this.requestsService.updateStatus(id,actorId ,updateRequestDto);
  }
}
