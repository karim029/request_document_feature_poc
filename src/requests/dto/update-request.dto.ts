import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { DocumentRequestStatus } from '../entities/document-request-status.enum';

export class UpdateRequestDto {
  @IsNotEmpty()
  @IsEnum(DocumentRequestStatus)
  status!: DocumentRequestStatus;

  // Trimmed first, so a reason of only spaces counts as empty. Required when rejecting;
  // when approving it is checked only if one is sent.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf(
    (dto: UpdateRequestDto) =>
      dto.status === DocumentRequestStatus.Rejected || !!dto.rejectionReason,
  )
  @IsString()
  @IsNotEmpty({
    message: 'A rejection reason is required when rejecting a request.',
  })
  @MaxLength(255)
  rejectionReason?: string | null;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  version!: number;
}
