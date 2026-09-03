// `uuid` v13 ships ESM only, which Jest's CJS runtime cannot load. Nothing here
// depends on real id generation, so stub it rather than transforming the package.
jest.mock('uuid', () => ({ v7: () => '00000000-0000-7000-8000-000000000000' }));

import { AuthService } from '@/auth/auth.service';
import { JwtAuthPayload } from '@/auth/dto/auth.dto';
import { UnauthorizedException } from '@nestjs/common';

/**
 * Covers the two theft-detection branches of `handleRefreshToken`:
 * a replayed (already-rotated) jti burns the whole token family, while a
 * refresh from a new IP only warns and rotates — the latter is what lets a
 * client that was offline reconnect on a different network and flush its
 * queued practice instead of being logged out everywhere.
 *
 * Also pins the two properties the token split depends on: the presented token
 * is verified as a *refresh* token before anything is looked up, and rotation
 * carries the session id forward so logout can still find the device.
 */
describe('AuthService.handleRefreshToken', () => {
    const USER_LOGIN_ID = '11111111-1111-1111-1111-111111111111';
    const JTI = '22222222-2222-2222-2222-222222222222';
    const SESSION_ID = '44444444-4444-4444-4444-444444444444';
    const NEW_REFRESH_JTI = '33333333-3333-3333-3333-333333333333';
    const PRESENTED = 'presented.refresh.token';

    const payload = (): JwtAuthPayload => ({
        sub: USER_LOGIN_ID,
        userLoginId: USER_LOGIN_ID,
        sid: SESSION_ID,
        typ: 'refresh',
        jti: JTI,
    });

    let transaction: {
        refreshToken: {
            findUnique: jest.Mock;
            deleteMany: jest.Mock;
            delete: jest.Mock;
            create: jest.Mock;
        };
    };
    let tokenService: { verify: jest.Mock; issueTokens: jest.Mock };
    let service: AuthService;

    const buildService = (): AuthService => {
        transaction = {
            refreshToken: {
                findUnique: jest.fn(),
                deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
                delete: jest.fn().mockResolvedValue(undefined),
                create: jest.fn().mockResolvedValue(undefined),
            },
        };

        const prismaService = {
            $transaction: jest.fn(
                (fn: (tx: typeof transaction) => unknown) =>
                    fn(transaction) as unknown,
            ),
        };

        tokenService = {
            verify: jest.fn().mockResolvedValue(payload()),
            issueTokens: jest.fn(),
        };

        const instance = new AuthService(
            prismaService as never,
            tokenService as never,
            {} as never,
            {} as never,
        );

        jest.spyOn(instance, 'generateJwtToken').mockResolvedValue({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            refreshJti: NEW_REFRESH_JTI,
            sid: SESSION_ID,
        });
        jest.spyOn(
            instance as unknown as { getRefreshTokenExpiresAt: () => Date },
            'getRefreshTokenExpiresAt',
        ).mockReturnValue(new Date('2026-09-12T00:00:00.000Z'));

        return instance;
    };

    beforeEach(() => {
        service = buildService();
    });

    it('verifies the presented token as a refresh token before touching the database', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue({
            id: 'row-1',
            jwtId: JTI,
            userLoginId: USER_LOGIN_ID,
            sessionId: SESSION_ID,
            allocatedIp: '203.0.113.7',
        });

        await service.handleRefreshToken({
            refreshToken: PRESENTED,
            userIpAddress: '203.0.113.7',
        });

        // An access token presented here must not be accepted, so the expected type
        // is part of the call and not merely assumed.
        expect(tokenService.verify).toHaveBeenCalledWith(PRESENTED, 'refresh');
    });

    it('revokes every refresh token when a rotated-away jti is replayed', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue(null);

        await expect(
            service.handleRefreshToken({
                refreshToken: PRESENTED,
                userIpAddress: '203.0.113.7',
            }),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(transaction.refreshToken.deleteMany).toHaveBeenCalledWith({
            where: { userLoginId: USER_LOGIN_ID },
        });
        expect(transaction.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rotates normally when the IP changed, without revoking anything', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue({
            id: 'row-1',
            jwtId: JTI,
            userLoginId: USER_LOGIN_ID,
            sessionId: SESSION_ID,
            allocatedIp: '198.51.100.4',
        });

        const result = await service.handleRefreshToken({
            refreshToken: PRESENTED,
            userIpAddress: '203.0.113.7',
        });

        expect(result).toEqual({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
        });
        expect(transaction.refreshToken.deleteMany).not.toHaveBeenCalled();

        // Rotation is unchanged: the old row is deleted and a new jti replaces it,
        // so refresh tokens stay single-use.
        expect(transaction.refreshToken.delete).toHaveBeenCalledWith({
            where: { id: 'row-1' },
        });
        expect(transaction.refreshToken.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    userLoginId: USER_LOGIN_ID,
                    jwtId: NEW_REFRESH_JTI,
                    allocatedIp: '203.0.113.7',
                }),
            }),
        );
    });

    it('carries the session id across rotation so logout can still find the device', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue({
            id: 'row-1',
            jwtId: JTI,
            userLoginId: USER_LOGIN_ID,
            sessionId: SESSION_ID,
            allocatedIp: '203.0.113.7',
        });

        await service.handleRefreshToken({
            refreshToken: PRESENTED,
            userIpAddress: '203.0.113.7',
        });

        expect(service.generateJwtToken).toHaveBeenCalledWith(
            USER_LOGIN_ID,
            SESSION_ID,
        );
        expect(transaction.refreshToken.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ sessionId: SESSION_ID }),
            }),
        );
    });

    it('rotates normally when the IP matches', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue({
            id: 'row-1',
            jwtId: JTI,
            userLoginId: USER_LOGIN_ID,
            sessionId: SESSION_ID,
            allocatedIp: '203.0.113.7',
        });

        await service.handleRefreshToken({
            refreshToken: PRESENTED,
            userIpAddress: '203.0.113.7',
        });

        expect(transaction.refreshToken.deleteMany).not.toHaveBeenCalled();
        expect(transaction.refreshToken.create).toHaveBeenCalled();
    });
});
