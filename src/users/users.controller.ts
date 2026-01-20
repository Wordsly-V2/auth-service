import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { IUser } from './DTO/users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @MessagePattern('users.get_profile')
  getProfile(userLoginId: string): Promise<IUser> {
    return this.usersService.getProfile(userLoginId);
  }
}
