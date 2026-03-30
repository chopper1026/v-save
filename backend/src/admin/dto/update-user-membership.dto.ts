import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserMembershipDto {
  @IsIn(['FREE', 'VIP'])
  membershipLevel: 'FREE' | 'VIP';

  @IsOptional()
  @IsISO8601()
  vipExpireDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

