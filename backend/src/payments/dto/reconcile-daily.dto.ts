import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class ReconcileDailyDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
