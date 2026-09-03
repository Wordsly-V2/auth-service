import { AccessGuard } from '@/common/guard/access.guard';
import { AuthenticatedRequest } from '@/common/guard/authenticated-request';
import { UnauthorizedException } from '@nestjs/common';

/**
 * The full entry matrix.
 *
 * This guard is the only thing standing between the internet and every route on
 * the service, so each way in — and each way *not* in — is pinned explicitly.
 * The case that matters most is the last one: a user token must not open a route
 * marked internal-only, because those routes mint and destroy credentials for
 * whatever identity the body names.
 */
describe('AccessGuard', () => {
    const INTERNAL_TOKEN = 'shared-internal-token';
    const PAYLOAD = {
        sub: 'user-1',
        userLoginId: 'user-1',
        sid: 'session-1',
        typ: 'access' as const,
        jti: 'jti-1',
    };

    let verify: jest.Mock;

    const buildContext = (request: Partial<AuthenticatedRequest>) => {
        const req = { headers: {}, ...request } as AuthenticatedRequest;
        return {
            request: req,
            context: {
                getType: () => 'http',
                getHandler: () => () => undefined,
                getClass: () => class {},
                switchToHttp: () => ({ getRequest: () => req }),
            } as never,
        };
    };

    const buildGuard = (metadata: Record<string, boolean> = {}) => {
        verify = jest.fn().mockResolvedValue(PAYLOAD);
        return new AccessGuard(
            { getAllAndOverride: (key: string) => metadata[key] } as never,
            { get: () => INTERNAL_TOKEN } as never,
            { verify } as never,
        );
    };

    it('lets a @Public() route through with no credentials at all', async () => {
        const guard = buildGuard({ isPublic: true });
        const { context } = buildContext({});

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(verify).not.toHaveBeenCalled();
    });

    it('admits a peer service on the internal token, with no user attached', async () => {
        const guard = buildGuard();
        const { context, request } = buildContext({
            headers: { 'x-service-token': INTERNAL_TOKEN } as never,
        });

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(request.isInternalCall).toBe(true);
        expect(request.user).toBeUndefined();
    });

    it('rejects a wrong internal token rather than falling through to it', async () => {
        const guard = buildGuard();
        const { context } = buildContext({
            headers: { 'x-service-token': 'not-the-token' } as never,
        });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it('attaches the verified identity for a bearer token', async () => {
        const guard = buildGuard();
        const { context, request } = buildContext({
            headers: { authorization: 'Bearer good-token' } as never,
        });

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(verify).toHaveBeenCalledWith('good-token', 'access');
        expect(request.user).toEqual({
            sub: 'user-1',
            sid: 'session-1',
            jti: 'jti-1',
        });
    });

    it('requires the token to be an access token', async () => {
        const guard = buildGuard();
        // A refresh token presented as a bearer credential must not pass; the
        // expected type is handed to the verifier, which enforces it.
        verify.mockRejectedValue(new UnauthorizedException());
        const { context } = buildContext({
            headers: { authorization: 'Bearer refresh-token' } as never,
        });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it('rejects a request with no credentials', async () => {
        const guard = buildGuard();
        const { context } = buildContext({});

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it.each([
        ['a non-bearer scheme', 'Basic abc'],
        ['a bearer with no value', 'Bearer'],
    ])('rejects %s', async (_label, authorization) => {
        const guard = buildGuard();
        const { context } = buildContext({
            headers: { authorization } as never,
        });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it('refuses a valid user token on an @InternalOnly() route', async () => {
        const guard = buildGuard({ isInternalOnly: true });
        const { context } = buildContext({
            headers: { authorization: 'Bearer good-token' } as never,
        });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        // It must not even be verified: the answer is no regardless of validity.
        expect(verify).not.toHaveBeenCalled();
    });

    it('still admits a peer service on an @InternalOnly() route', async () => {
        const guard = buildGuard({ isInternalOnly: true });
        const { context } = buildContext({
            headers: { 'x-service-token': INTERNAL_TOKEN } as never,
        });

        await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('skips non-HTTP transports, which have no headers to check', async () => {
        const guard = buildGuard();
        await expect(
            guard.canActivate({ getType: () => 'rpc' } as never),
        ).resolves.toBe(true);
    });
});
