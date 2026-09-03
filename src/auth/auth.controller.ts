import { AuthService } from '@/auth/auth.service';
import {
    IOAuthLoginResponseDTO,
    IOAuthUserDTO,
    JwtAuthPayload,
} from '@/auth/dto/auth.dto';
import { InternalOnly } from '@/common/decorators/internal-only.decorator';
import { Controller, Post } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';

/**
 * Every route here mints or destroys credentials on behalf of a named user, so
 * a valid user token is deliberately not enough to reach any of them.
 */
@Controller('auth')
@InternalOnly()
export class AuthController {
    constructor(private readonly loginService: AuthService) {}

    @Post('login-oauth')
    async handleOAuthLogin(
        @Payload()
        {
            user,
            userIpAddress,
        }: {
            user: IOAuthUserDTO;
            userIpAddress: string | undefined;
        },
    ): Promise<IOAuthLoginResponseDTO> {
        const response = await this.loginService.handleOAuthLogin(
            user,
            userIpAddress,
        );
        return response;
    }

    /**
     * Takes the raw refresh token, never a decoded payload: the signature is
     * checked inside the service that holds the keys.
     */
    @Post('refresh-token')
    async handleRefreshToken(
        @Payload()
        {
            refreshToken,
            userIpAddress,
        }: {
            refreshToken: string;
            userIpAddress: string | undefined;
        },
    ): Promise<IOAuthLoginResponseDTO> {
        return this.loginService.handleRefreshToken({
            refreshToken,
            userIpAddress,
        });
    }

    @Post('logout')
    handleLogout(
        @Payload()
        {
            user,
            isLoggedOutFromAllDevices,
        }: {
            user: JwtAuthPayload;
            isLoggedOutFromAllDevices: boolean;
        },
    ): Promise<{ success: boolean }> {
        return this.loginService.handleLogout(user, isLoggedOutFromAllDevices);
    }
}
