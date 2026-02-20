import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddedMessageStatusId1769010000000 implements MigrationInterface {
  name = 'AddedMessageStatusId1769010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tg_users" ADD "message_status_id" smallint NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tg_users" DROP COLUMN "message_status_id"`,
    );
  }
}
