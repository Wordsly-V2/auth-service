import { AuthCookieService, REFRESH_TOKEN_COOKIE } from '@/auth/auth-cookie.service';
import { AuthService } from '@/auth/auth.service';
import { IOAuthUserDTO, JwtAuthPayload } from '@/auth/dto/auth.dto';
import { Public } from '@/common/decorators/public.decorator';
// `import type`: AuthenticatedRequest appears in a decorated handler signature,
// and emitDecoratorMetadata would otherwise emit a runtime reference to an
// interface that does not exist at runtime.
import type { AuthenticatedRequest } from '@/common/guard/authenticated-request';
import { Body, Controller, Get, Logger, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * The browser-facing half of authentication, moved here from the gateway.
 *
 * It lived in the gateway because the gateway was the only thing browsers could
 * reach. The consequence was that the gateway ran the Google handshake, held a
 * copy of the verification key, and decoded refresh tokens on behalf of this
 * service — which then minted tokens from whatever it was handed without ever
 * checking a signature. Everything that decides who someone is now happens here,
 * and the gateway simply forwards the request.
 */
@Controller('auth')
export class AuthSessionController {
    private readonly logger = new Logger(AuthSessionController.name);

    constructor(
        private readonly authService: AuthService,
        private readonly cookies: AuthCookieService,
        private readonly configService: ConfigService,
    ) {}

    @Public()
    @Get('google')
    @UseGuards(AuthGuard('google'))
    google(): void {
        // Never runs: the guard redirects to Google first.
    }

    @Public()
    @Get('google/redirect')
    @UseGuards(AuthGuard('google'))
    async googleRedirect(
        @Req() req: Request & { user: IOAuthUserDTO },
        @Res() res: Response,
    ) {
        const frontendRedirectUrl = this.configService.get<string>(
            'googleOAuth.frontendRedirectUrl',
        ) as string;

        try {
            const { accessToken, refreshToken } =
                await this.authService.handleOAuthLogin(req.user, req.ip);

            if (this.cookies.isBodyDelivery()) {
                return res.redirect(
                    `${frontendRedirectUrl}?access_token=${accessToken}` +
                        `&refresh_token=${encodeURIComponent(refreshToken)}`,
                );
            }

            this.cookies.set(res, refreshToken);
            return res.redirect(
                `${frontendRedirectUrl}?access_token=${accessToken}`,
            );
        } catch (error) {
            // The detail is logged, not redirected: this used to serialise the
            // whole exception into the query string, putting internal state in
            // the address bar, browser history and any referrer.
            this.logger.error('Google OAuth login failed', error as Error);
            return res.redirect(`${frontendRedirectUrl}?error=login_failed`);
        }
    }

    /**
     * Rotate the refresh token.
     *
     * Public because an expired access token is the normal reason to be here —
     * the refresh token is itself the credential, and it is verified inside the
     * service before anything is issued.
     */
    @Public()
    @Get('refresh-token')
    async refresh(@Req() req: Request, @Res() res: Response) {
        const isBodyDelivery = this.cookies.isBodyDelivery();

        // In body mode the token lives in the client's storage and arrives as a
        // header; in cookie mode the browser sends it automatically.
        const refreshToken = isBodyDelivery
            ? (req.headers['x-refresh-token'] as string | undefined)
            : (req.cookies as Record<string, string> | undefined)?.[
                  REFRESH_TOKEN_COOKIE
              ];

        if (!refreshToken) {
            return res.status(401).json({ message: 'Refresh token not found' });
        }

        try {
            const { accessToken, refreshToken: rotated } =
                await this.authService.handleRefreshToken({
                    refreshToken,
                    userIpAddress: req.ip,
                });

            if (isBodyDelivery) {
                return res
                    .status(200)
                    .json({ accessToken, refreshToken: rotated });
            }

            this.cookies.set(res, rotated);
            return res.status(200).json({ accessToken });
        } catch (error) {
            this.logger.warn(`Refresh failed: ${String(error)}`);
            return res.status(401).json({ message: 'Refresh token rejected' });
        }
    }

    /**
     * End this device's session, or every session for the user.
     *
     * Authenticated by the caller's own access token — the identity acted on is
     * the token's subject, never anything the body names.
     */
    @Post('logout')
    async logout(
        @Req() req: AuthenticatedRequest,
        @Body() body: { isLoggedOutFromAllDevices?: boolean } = {},
        @Res() res: Response,
    ) {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ message: 'Unauthenticated' });
        }

        await this.authService.handleLogout(
            user as unknown as JwtAuthPayload,
            body.isLoggedOutFromAllDevices ?? false,
        );

        this.cookies.clear(res);
        return res.status(200).json({ message: 'Logged out successfully' });
    }
}
