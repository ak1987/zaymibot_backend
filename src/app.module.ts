import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { VisitorsModule } from './visitors/visitors.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [UsersModule, VisitorsModule, TelegramModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
