import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserRoleDto {
  @IsIn(['SUPER_ADMIN', 'USER'])
  role: 'SUPER_ADMIN' | 'USER';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

