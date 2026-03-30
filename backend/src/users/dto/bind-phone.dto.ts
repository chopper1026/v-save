import { IsString, Matches } from 'class-validator';

export class BindPhoneDto {
  @IsString()
  @Matches(/^1\d{10}$/, {
    message: '手机号格式不正确，请输入 11 位大陆手机号',
  })
  phone: string;
}
