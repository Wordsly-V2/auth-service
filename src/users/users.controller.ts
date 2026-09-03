import { IUser } from '@/users/dto/users.dto';
import { UsersService } from '@/users/users.service';
import { Controller, Get, Param } from '@nestjs/common';

/**
 * No per-controller guard: AccessGuard and OwnerGuard run globally. A peer
 * service may read any profile; a browser may read only its own, and `me` is
 * rewritten to the token's subject before this handler sees it.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':userLoginId/profile')
  getProfile(@Param('userLoginId') userLoginId: string): Promise<IUser> {
    return this.usersService.getProfile(userLoginId);
  }
}
