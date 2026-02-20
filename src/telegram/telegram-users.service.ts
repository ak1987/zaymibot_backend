import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramUser } from './telegram-user.entity';

@Injectable()
export class TelegramUsersService {
  constructor(
    @InjectRepository(TelegramUser)
    private telegramUserRepository: Repository<TelegramUser>,
  ) {}

  /**
   * Creates a new Telegram user.
   * @param userId Telegram user ID
   * @param alias Optional Telegram username/alias
   */
  async createUser(userId: number, alias?: string | null): Promise<TelegramUser> {
    const newUser = this.telegramUserRepository.create({
      id: userId,
      alias: alias || null,
    });
    return await this.telegramUserRepository.save(newUser);
  }

  /**
   * Updates user's updated_at timestamp.
   * Optionally updates alias if provided.
   * @param userId Telegram user ID
   * @param alias Optional Telegram username/alias
   * @returns Number of affected rows (0 if user doesn't exist)
   */
  async updateUser(userId: number, alias?: string | null): Promise<number> {
    const updateData: Record<string, any> = { updated_at: () => 'NOW()' };
    
    if (alias !== undefined) {
      updateData.alias = alias;
    }

    const result = await this.telegramUserRepository
      .createQueryBuilder()
      .update(TelegramUser)
      .set(updateData)
      .where('id = :userId', { userId })
      .execute();

    return result.affected || 0;
  }

  /**
   * Returns all users who have not yet received all 4 scheduled messages (message_status_id < 4).
   */
  async getUsersWithPendingScheduledMessages(): Promise<TelegramUser[]> {
    return this.telegramUserRepository
      .createQueryBuilder('u')
      .where('u.message_status_id < :maxStatus', { maxStatus: 4 })
      .orderBy('u.created_at', 'ASC')
      .getMany();
  }

  /**
   * Sets message_status_id for a user (after sending a scheduled message).
   */
  async setMessageStatusId(userId: number, statusId: number): Promise<number> {
    const result = await this.telegramUserRepository
      .createQueryBuilder()
      .update(TelegramUser)
      .set({ message_status_id: statusId, updated_at: () => 'NOW()' })
      .where('id = :userId', { userId })
      .execute();
    return result.affected ?? 0;
  }
}
