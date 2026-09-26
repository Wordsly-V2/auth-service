import {
    AdminUserDetail,
    AdminUserList,
    AdminUserStats,
    ListUsersQueryDto,
    UpdateRolesDto,
    UpdateStatusDto,
    UserStatsQueryDto,
} from '@/admin-users/dto/admin-users.dto';
import { AdminUsersService } from '@/admin-users/admin-users.service';
import { ADMIN_ROLE } from '@/auth/roles';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/guard/current-user.decorator';
import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
} from '@nestjs/common';

/**
 * Account administration under `/admin/users` (the gateway routes it here).
 * Admins only: the access token's `roles` claim must hold `admin`, which is
 * also what lets these routes name the account they act on (`:id`, the
 * `UserLogin` id) past UserScopeGuard.
 */
@Roles(ADMIN_ROLE)
@Controller('admin/users')
export class AdminUsersController {
    constructor(private readonly adminUsers: AdminUsersService) {}

    @Get()
    list(@Query() query: ListUsersQueryDto): Promise<AdminUserList> {
        return this.adminUsers.list(query);
    }

    // Declared before `:id`, which would otherwise swallow it.
    @Get('stats')
    stats(@Query() query: UserStatsQueryDto): Promise<AdminUserStats> {
        return this.adminUsers.stats(query);
    }

    @Get(':id')
    detail(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDetail> {
        return this.adminUsers.detail(id);
    }

    @Patch(':id/roles')
    setRoles(
        @CurrentUser() actorId: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateRolesDto,
    ): Promise<AdminUserDetail> {
        return this.adminUsers.setRoles(actorId, id, body.roles);
    }

    @Patch(':id/status')
    setStatus(
        @CurrentUser() actorId: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateStatusDto,
    ): Promise<AdminUserDetail> {
        return this.adminUsers.setStatus(actorId, id, body.status);
    }

    /** Sign the account out everywhere: every refresh token is deleted. */
    @Post(':id/sessions/revoke')
    @HttpCode(200)
    revokeSessions(
        @CurrentUser() actorId: string,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<{ sessionsEnded: number }> {
        return this.adminUsers.revokeSessions(actorId, id);
    }
}
