import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSystemSettingsDto {
  @IsBoolean()
  registrationEnabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
