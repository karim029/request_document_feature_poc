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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { UpdateRequestDto } from './dto/update-request.dto';
import { ActorId } from 'src/common/decorators/actor-id.decorator';
import { InboxQueryDto } from './dto/inbox-query.dto';
import { BulkCreateRequestDto } from './dto/bulk-create-request.dto';
import { BulkRequestsService } from './entities/bulk-request-create.service';
type MulterFile = Express.Multer.File;

@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly bulkRequestsService: BulkRequestsService,
  ) {}

  @Get()
  getInbox(@Query() query: InboxQueryDto) {
    return this.requestsService.getInbox(query);
  }

  @Get(':id')
  getRequest(@Param('id', ParseIntPipe) id: number) {
    return this.requestsService.getRequest(id);
  }

  @Post()
  createNewRequest(@Body() createRequestDto: CreateRequestDto) {
    return this.requestsService.createRequest(createRequestDto);
  }

  @Post('bulk')
  createBulk(
    @ActorId() actorId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: BulkCreateRequestDto,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 64) {
      throw new BadRequestException(
        'The Idempotency-Key header is required (up to 64 characters).',
      );
    }
    return this.bulkRequestsService.create(actorId, idempotencyKey, dto);
  }

  @Post('upload/:id')
  @UseInterceptors(FileInterceptor('file'))
  uploadRequestFile(
    @Param('id', ParseIntPipe) requestId: number,
    @ActorId() actorId: number,
    @Body('version', ParseIntPipe) version: number,
    @UploadedFile() file: MulterFile,
  ) {
    return this.requestsService.saveDocument(requestId, actorId, version, file);
  }

  @Patch('review/:id')
  updateRequestStatus(
    @Param('id', ParseIntPipe) id: number,
    @ActorId() actorId: number,
    @Body() updateRequestDto: UpdateRequestDto,
  ) {
    return this.requestsService.updateStatus(id, actorId, updateRequestDto);
  }

  @Get(':id/history')
  getRequestHistory(@Param('id', ParseIntPipe) requestId: number) {
    return this.requestsService.getHistory(requestId);
  }
}
