import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram.service';
import { TelegramUsersService } from './telegram-users.service';
import { ScheduledMessagesService } from './scheduled-messages.service';
import { TelegramUser } from './telegram-user.entity';
import { BinomModule } from '../binom/binom.module';

@Module({
  imports: [
    BinomModule,
    TypeOrmModule.forFeature([TelegramUser]),
  ],
  providers: [TelegramService, TelegramUsersService, ScheduledMessagesService],
  exports: [TelegramService],
})
export class TelegramModule {}
