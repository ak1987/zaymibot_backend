import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedTgUsers1769009412331 implements MigrationInterface {
    name = 'AddedTgUsers1769009412331'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tg_users" ("id" bigint NOT NULL, "alias" character varying(32), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9ca7cb460931bb8da0685e39fc8" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "tg_users"`);
    }

}
