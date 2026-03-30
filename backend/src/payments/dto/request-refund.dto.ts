import { IsString, MaxLength, MinLength } from 'class-validator';

export class RequestRefundDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason: string;
}
