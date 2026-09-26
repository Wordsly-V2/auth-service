import {
    ArrayUnique,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
    ASSIGNABLE_ROLES,
    type AssignableRole,
} from '@/admin-users/admin-users.logic';
import {
    USER_LOGIN_STATUSES,
    type UserLoginStatus,
} from '@/auth/user-login-status';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListUsersQueryDto {
    /** Matched against email and display name, case-insensitively. */
    @IsOptional()
    @IsString()
    @MaxLength(200)
    q?: string;

    @IsOptional()
    @IsIn(ASSIGNABLE_ROLES)
    role?: AssignableRole;

    @IsOptional()
    @IsIn(USER_LOGIN_STATUSES)
    status?: UserLoginStatus;

    /** 1-based; clamped rather than refused past the bounds. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    pageSize?: number;
}

export class UserStatsQueryDto {
    /** Inclusive UTC day, `YYYY-MM-DD`. Defaults to 30 days before `to`. */
    @IsOptional()
    @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
    from?: string;

    /** Inclusive UTC day, `YYYY-MM-DD`. Defaults to today. */
    @IsOptional()
    @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
    to?: string;
}

export class UpdateRolesDto {
    /** The full set of assignable roles the user should hold. */
    @IsArray()
    @ArrayUnique()
    @IsIn(ASSIGNABLE_ROLES, { each: true })
    roles!: AssignableRole[];
}

export class UpdateStatusDto {
    @IsIn(USER_LOGIN_STATUSES)
    status!: UserLoginStatus;
}

/** One row of the users table. */
export interface AdminUserSummary {
    /** The `UserLogin` id: what every service scopes rows by. */
    userLoginId: string;
    email: string | null;
    displayName: string | null;
    pictureUrl: string | null;
    provider: string;
    status: string;
    roles: string[];
    /** Listed in ADMIN_EMAILS: revoking admin is undone at their next login. */
    bootstrapAdmin: boolean;
    /** Unexpired, unrotated refresh tokens, i.e. signed-in devices. */
    activeSessions: number;
    createdAt: string;
}

export interface AdminUserDetail extends AdminUserSummary {
    updatedAt: string;
    /** When a refresh token was last issued (sign-in or refresh), if ever. */
    lastSeenAt: string | null;
}

export interface AdminUserList {
    items: AdminUserSummary[];
    total: number;
    page: number;
    pageSize: number;
}

export interface AdminUserStats {
    from: string;
    to: string;
    totals: { users: number; admins: number; suspended: number };
    /** Accounts created within the range. */
    newUsers: number;
    /** Sign-ups per UTC day, one point per day of the range. */
    signups: { date: string; count: number }[];
}
