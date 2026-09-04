import { AccessGuard } from '@/common/guard/access.guard';
import { AuthenticatedRequest } from '@/common/guard/authenticated-request';
import { UnauthorizedException } from '@nestjs/common';

/**
 * The full entry matrix.
 *
 * This guard is the only thing standing between the internet and every route on
 * the service, so each way in — and each way *not* in — is pinned explicitly.
 * The case that matters most is the retired internal token: it used to admit a
 * caller with no identity at all, and the ownership check then waved those
 * callers through for any user id.
 */
describe('AccessGuard', () => {
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
            { verify } as never,
        );
    };

    it('lets a @Public() route through with no credentials at all', async () => {
        const guard = buildGuard({ isPublic: true });
        const { context } = buildContext({});

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(verify).not.toHaveBeenCalled();
    });

    it('no longer admits a peer service on the retired internal token', async () => {
        const guard = buildGuard();
        const { context } = buildContext({
            headers: { 'x-service-token': 'shared-internal-token' },
        });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it('attaches the verified identity for a bearer token', async () => {
        const guard = buildGuard();
        const { context, request } = buildContext({
            headers: { authorization: 'Bearer good-token' },
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
            headers: { authorization: 'Bearer refresh-token' },
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
            headers: { authorization },
        });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
    });

    it('skips non-HTTP transports, which have no headers to check', async () => {
        const guard = buildGuard();
        await expect(
            guard.canActivate({ getType: () => 'rpc' } as never),
        ).resolves.toBe(true);
    });
});
