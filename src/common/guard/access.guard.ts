import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { AuthenticatedRequest } from '@/common/guard/authenticated-request';
import { TokenService } from '@/auth/token.service';
import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * The single entry check for every route, registered globally.
 *
 * Global and deny-by-default on purpose: this service sits behind a proxy that
 * forwards whatever it is given, so a controller that simply forgot a decorator
 * must not end up publicly readable. Two ways in:
 *
 *   1. `@Public()` — discovery, health, and the OAuth handshake itself. The
 *      refresh endpoint is here too: the refresh token is itself the credential
 *      and is verified inside the service before anything is issued.
 *   2. A valid access token — identity attached to the request for
 *      `@CurrentUser()` to read.
 */
@Injectable()
export class AccessGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
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

        const token = readBearerToken(request);
        if (!token) {
            throw new UnauthorizedException('Missing access token');
        }

        const payload = await this.tokenService.verify(token, 'access');
        request.user = {
            sub: payload.sub,
            sid: payload.sid,
            jti: payload.jti,
            roles: readRoles(payload.roles),
        };
        return true;
    }
}

/**
 * The `roles` claim, keeping only string entries. Tokens minted before the
 * claim existed have none, which reads as no roles rather than an error.
 */
function readRoles(claim: unknown): string[] {
    if (!Array.isArray(claim)) return [];
    return claim.filter((role): role is string => typeof role === 'string');
}

function readBearerToken(request: AuthenticatedRequest): string | null {
    const header = request.headers.authorization;
    if (!header) return null;

    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value;
}
