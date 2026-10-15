import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DocumentRequestStatus } from '../entities/document-request-status.enum';

export class UpdateRequestDto {
  @IsNotEmpty()
  @IsEnum(DocumentRequestStatus)
  status!: DocumentRequestStatus;

  @IsString()
  @IsOptional()
  rejectionReason?: string | null;
}
