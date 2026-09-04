import { IUser } from '@/users/dto/users.dto';
import { UsersService } from '@/users/users.service';
import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '@/common/guard/current-user.decorator';

/**
 * No per-controller guard: AccessGuard and UserScopeGuard run globally. The
 * route used to be `users/:userLoginId/profile`, so which profile you got was
 * decided by a segment the caller wrote and a guard had to second-guess. There
 * is only one profile reachable here now — the token holder's.
 */
@Controller('profile')
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Get()
    getProfile(@CurrentUser() userLoginId: string): Promise<IUser> {
        return this.usersService.getProfile(userLoginId);
    }
}
