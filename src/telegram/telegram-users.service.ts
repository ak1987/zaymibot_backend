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
}
