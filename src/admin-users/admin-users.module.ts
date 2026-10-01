import { AdminUsersController } from '@/admin-users/admin-users.controller';
import { AdminUsersService } from '@/admin-users/admin-users.service';
import { MessagingModule } from '@/messaging/messaging.module';
import { Module } from '@nestjs/common';

@Module({
    imports: [MessagingModule],
    controllers: [AdminUsersController],
    providers: [AdminUsersService],
})
export class AdminUsersModule {}
