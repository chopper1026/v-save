import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'DISABLED'])
  accountStatus: 'ACTIVE' | 'DISABLED';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

