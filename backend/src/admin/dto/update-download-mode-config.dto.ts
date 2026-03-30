import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DownloadPolicyMode } from '../../download-mode/download-mode.types';

export class UpdateDownloadModeConfigDto {
  @IsEnum(DownloadPolicyMode)
  mode: DownloadPolicyMode;

  @IsOptional()
  @IsString()
  reason?: string;
}
