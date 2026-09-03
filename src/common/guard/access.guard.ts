import { IS_INTERNAL_ONLY_KEY } from '@/common/decorators/internal-only.decorator';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { AuthenticatedRequest } from '@/common/guard/authenticated-request';
import { isValidInternalToken } from '@/common/internal-token';
import { TokenService } from '@/auth/token.service';
import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

/**
 * The single entry check for every route, registered globally.
 *
 * Global and deny-by-default on purpose: this service sits behind a proxy that
 * forwards whatever it is given, so a controller that simply forgot a decorator
 * must not end up publicly readable. Three ways in, in order:
 *
 *   1. `@Public()` — discovery, health, and the OAuth handshake itself.
 *   2. The internal service token — a peer service, no end-user identity.
 *   3. A valid access token — a browser, identity attached to the request.
 *
 * `@InternalOnly()` removes step 3 for routes where a user token must never be
 * sufficient, such as anything that mints or destroys credentials.
 */
@Injectable()
export class AccessGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly configService: ConfigService,
        private readonly tokenService: TokenService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Kafka handlers and other non-HTTP transports have no headers to check
        // and are not reachable from outside the cluster.
        if (context.getType() !== 'http') return true;

        const isPublic = this.reflector.getAllAndOverride<boolean>(
            IS_PUBLIC_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (isPublic) return true;

        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();

        const isInternalOnly = this.reflector.getAllAndOverride<boolean>(
            IS_INTERNAL_ONLY_KEY,
            [context.getHandler(), context.getClass()],
        );

        const internalToken = this.configService.get<string>(
            'internalServiceToServiceToken',
        );
        if (
            isValidInternalToken(
                request.headers['x-service-token'] as string | undefined,
                internalToken,
            )
        ) {
            request.isInternalCall = true;
            return true;
        }

        if (isInternalOnly) {
            throw new UnauthorizedException(
                'This endpoint is callable only by internal services',
            );
        }

        const token = readBearerToken(request);
        if (!token) {
            throw new UnauthorizedException('Missing access token');
        }

        const payload = await this.tokenService.verify(token, 'access');
        request.user = {
            sub: payload.sub,
            sid: payload.sid,
            jti: payload.jti,
        };
        return true;
    }
}

function readBearerToken(request: AuthenticatedRequest): string | null {
    const header = request.headers.authorization;
    if (!header) return null;

    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value;
}
