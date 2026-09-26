import { AdminUsersController } from '@/admin-users/admin-users.controller';
import { AdminUsersService } from '@/admin-users/admin-users.service';
import { Module } from '@nestjs/common';

@Module({
    controllers: [AdminUsersController],
    providers: [AdminUsersService],
})
export class AdminUsersModule {}
