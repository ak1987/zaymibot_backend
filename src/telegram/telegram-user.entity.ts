import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tg_users')
export class TelegramUser {
  @PrimaryColumn('bigint')
  id: number; // Telegram user ID

  @Column({ type: 'varchar', length: 32, nullable: true })
  alias: string | null; // Telegram username/alias

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
