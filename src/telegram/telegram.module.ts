import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { BinomModule } from '../binom/binom.module';

@Module({
  imports: [BinomModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
