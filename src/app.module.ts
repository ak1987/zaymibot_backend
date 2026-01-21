import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrmConfig } from './ormconfig';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { VisitorsModule } from './visitors/visitors.module';
import { TelegramModule } from './telegram/telegram.module';
import { BinomModule } from './binom/binom.module';
import { TelegramUser } from './telegram/telegram-user.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot(OrmConfig),
    UsersModule,
    VisitorsModule,
    TelegramModule,
    BinomModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
