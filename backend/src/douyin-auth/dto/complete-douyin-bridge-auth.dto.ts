import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CompleteDouyinBridgeAuthDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'authSessionId should not be empty' })
  authSessionId: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'uploadToken should not be empty' })
  uploadToken: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'cookieHeader should not be empty' })
  cookieHeader: string;
}
