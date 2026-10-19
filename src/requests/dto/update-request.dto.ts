import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { DocumentRequestStatus } from '../entities/document-request-status.enum';

export class UpdateRequestDto {
  @IsNotEmpty()
  @IsEnum(DocumentRequestStatus)
  status!: DocumentRequestStatus;

  @IsString()
  @IsOptional()
  rejectionReason?: string | null;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  version!: number;
}
