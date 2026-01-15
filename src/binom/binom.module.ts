import { Module } from '@nestjs/common';
import { BinomService } from './binom.service';

@Module({
  providers: [BinomService],
  exports: [BinomService]
})
export class BinomModule {}
