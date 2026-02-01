import { IUser } from '@/users/dto/users.dto';
import { UsersService } from '@/users/users.service';
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { InternalServiceGuard } from '@/guard/internal-service/internal-service.guard';

@Controller('users')
@UseGuards(InternalServiceGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':userLoginId/profile')
  getProfile(@Param('userLoginId') userLoginId: string): Promise<IUser> {
    return this.usersService.getProfile(userLoginId);
  }
}
