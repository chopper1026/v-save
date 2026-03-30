import { Module } from '@nestjs/common';
import { DouyinOfficialDetailService } from './douyin-official-detail.service';
import { DouyinSignatureService } from './douyin-signature.service';

@Module({
  providers: [DouyinSignatureService, DouyinOfficialDetailService],
  exports: [DouyinSignatureService, DouyinOfficialDetailService],
})
export class DouyinOfficialModule {}
