import { Transform, Type } from 'class-transformer';
import {
  IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min,
} from 'class-validator';
import { DocumentRequestStatus } from '../entities/document-request-status.enum';

export enum InboxSort {
  CreatedDesc = 'createdAt_desc',
  DueAsc = 'dueDate_asc',
}

export class InboxQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  accountantId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  clientId?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value : [value],
  )
  @IsEnum(DocumentRequestStatus, { each: true })
  status?: DocumentRequestStatus[];

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true')
  @IsBoolean()
  overdue?: boolean;

  @IsOptional()
  @IsEnum(InboxSort)
  sort: InboxSort = InboxSort.CreatedDesc;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string;
}