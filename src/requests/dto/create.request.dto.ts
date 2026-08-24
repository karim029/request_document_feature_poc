import { IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator"

export class CreateRequestDto{
    @IsString()
    @IsNotEmpty()
    title!: string

    @IsString()
    @IsOptional()
    description?: string
    
    @IsInt()
    clientId!: number

}
