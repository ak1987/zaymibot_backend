import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TelegramUser } from './telegram-user.entity';
import { TelegramService } from './telegram.service';
import { TelegramUsersService } from './telegram-users.service';
import { getTelegramData } from './telegram.service';

const FIVE_MIN_MS = 5 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;
const THIRTY_H_MS = 30 * 60 * 60 * 1000;
const RANDOM_DELAY_MAX_MS = 15000;

@Injectable()
export class ScheduledMessagesService {
  private readonly logger = new Logger(ScheduledMessagesService.name);

  constructor(
    private readonly telegramUsersService: TelegramUsersService,
    private readonly telegramService: TelegramService,
  ) {}

  @Cron('* * * * *')
  async handleScheduledMessages(): Promise<void> {
    const users = await this.telegramUsersService.getUsersWithPendingScheduledMessages();
    const now = Date.now();

    for (const user of users) {
      const createdMs = new Date(user.created_at).getTime();
      const status = user.message_status_id;

      if (status === 0 && createdMs <= now - FIVE_MIN_MS) {
        this.scheduleSend(user, '5min', 1);
      } else if (status === 1 && createdMs <= now - FIFTEEN_MIN_MS) {
        this.scheduleSend(user, '15min', 2);
      } else if (status === 2 && createdMs <= now - TWENTY_FOUR_H_MS) {
        this.scheduleSend(user, '24h', 3);
      } else if (status === 3 && createdMs <= now - THIRTY_H_MS) {
        this.scheduleSend(user, '30h', 4);
      }
    }
  }

  private scheduleSend(user: TelegramUser, key: '5min' | '15min' | '24h' | '30h', nextStatusId: number): void {
    const delayMs = Math.floor(Math.random() * (RANDOM_DELAY_MAX_MS + 1));
    setTimeout(() => {
      this.sendScheduledMessage(user.id, key, nextStatusId).catch((err) => {
        this.logger.warn(`Scheduled message ${key} for user ${user.id} failed: ${err?.message ?? err}`);
      });
    }, delayMs);
  }

  private async sendScheduledMessage(userId: number, key: '5min' | '15min' | '24h' | '30h', nextStatusId: number): Promise<void> {
    const data = getTelegramData();
    const scheduled = data.scheduled?.[key];
    if (!scheduled) {
      this.logger.warn(`No scheduled config for key ${key}`);
      return;
    }

    const firstName = await this.telegramService.getFirstNameByUserId(userId);
    const text = scheduled.text.replace(/%username%/g, firstName);
    const message = `${text}\n\n${scheduled.link}`;

    await this.telegramService.sendTextToUser(userId, message);
    await this.telegramUsersService.setMessageStatusId(userId, nextStatusId);
    this.logger.log(`Sent scheduled ${key} to user ${userId}, status -> ${nextStatusId}`);
  }
}
