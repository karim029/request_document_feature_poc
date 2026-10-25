import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  // The column is text (65,535 bytes): 10,000 characters fit even at 4 bytes each.
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  description?: string;

  @IsInt()
  clientId!: number;
}
