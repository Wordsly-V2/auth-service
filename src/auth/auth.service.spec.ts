// `uuid` v13 ships ESM only, which Jest's CJS runtime cannot load. Nothing here
// depends on real id generation, so stub it rather than transforming the package.
jest.mock('uuid', () => ({ v7: () => '00000000-0000-7000-8000-000000000000' }));

import { AuthService, REFRESH_REUSE_GRACE_MS } from '@/auth/auth.service';
import { IOAuthUserDTO, JwtAuthPayload } from '@/auth/dto/auth.dto';
import { UnauthorizedException } from '@nestjs/common';

/**
 * Covers the theft-detection branches of `handleRefreshToken`:
 * a token replayed after the grace window burns the whole token family, one
 * replayed inside it (another tab, a retry after a lost response) gets a fresh
 * pair, and a refresh from a new IP only warns and rotates — the latter is what
 * lets a client that was offline reconnect on a different network and flush its
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
    const ANY_DATE = expect.any(Date) as Date;

    const payload = (): JwtAuthPayload => ({
        sub: USER_LOGIN_ID,
        userLoginId: USER_LOGIN_ID,
        sid: SESSION_ID,
        typ: 'refresh',
        jti: JTI,
    });

    const row = (overrides: Record<string, unknown> = {}) => ({
        id: 'row-1',
        jwtId: JTI,
        userLoginId: USER_LOGIN_ID,
        sessionId: SESSION_ID,
        allocatedIp: '203.0.113.7',
        rotatedAt: null,
        userLogin: { status: 'active', roles: ['admin'] },
        ...overrides,
    });

    type RefreshTokenMock = {
        findUnique: jest.Mock;
        updateMany: jest.Mock;
        deleteMany: jest.Mock;
        create: jest.Mock;
    };
    let transaction: { refreshToken: RefreshTokenMock };
    /** Writes made outside the transaction; revocation must land here. */
    let outside: { refreshToken: { deleteMany: jest.Mock } };
    let tokenService: { verify: jest.Mock; issueTokens: jest.Mock };
    let service: AuthService;

    const buildService = (): AuthService => {
        transaction = {
            refreshToken: {
                findUnique: jest.fn(),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                create: jest.fn().mockResolvedValue(undefined),
            },
        };
        outside = {
            refreshToken: {
                deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
        };

        const prismaService = {
            ...outside,
            $transaction: jest.fn((fn: (tx: typeof transaction) => unknown) =>
                fn(transaction),
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

    const refresh = (userIpAddress = '203.0.113.7') =>
        service.handleRefreshToken({ refreshToken: PRESENTED, userIpAddress });

    beforeEach(() => {
        service = buildService();
    });

    it('verifies the presented token as a refresh token before touching the database', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue(row());

        await refresh();

        // An access token presented here must not be accepted, so the expected type
        // is part of the call and not merely assumed.
        expect(tokenService.verify).toHaveBeenCalledWith(PRESENTED, 'refresh');
    });

    it('revokes every refresh token, outside the transaction, when an unknown jti is replayed', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue(null);

        await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);

        // Revoking inside the transaction and then throwing would roll the
        // revocation back, so it must happen on the non-transactional client.
        expect(outside.refreshToken.deleteMany).toHaveBeenCalledWith({
            where: { userLoginId: USER_LOGIN_ID },
        });
        expect(transaction.refreshToken.create).not.toHaveBeenCalled();
    });

    it('revokes every refresh token when a token rotated past the grace window is replayed', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue(
            row({
                rotatedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000),
            }),
        );

        await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);

        expect(outside.refreshToken.deleteMany).toHaveBeenCalledWith({
            where: { userLoginId: USER_LOGIN_ID },
        });
        expect(transaction.refreshToken.create).not.toHaveBeenCalled();
    });

    it('issues a fresh pair when a token rotated moments ago is presented again', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue(
            row({ rotatedAt: new Date(Date.now() - 2000) }),
        );

        const result = await refresh();

        expect(result).toEqual({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
        });
        expect(outside.refreshToken.deleteMany).not.toHaveBeenCalled();
        // The pair the other refresh issued is retired, so the session keeps a
        // single live refresh token.
        expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith({
            where: { sessionId: SESSION_ID, rotatedAt: null },
            data: { rotatedAt: ANY_DATE },
        });
        expect(transaction.refreshToken.create).toHaveBeenCalled();
    });

    it('falls back to the grace path when a concurrent refresh claimed the row first', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue(row());
        transaction.refreshToken.updateMany
            .mockResolvedValueOnce({ count: 0 }) // lost the claim
            .mockResolvedValueOnce({ count: 1 }); // retired the winner's token

        await refresh();

        expect(transaction.refreshToken.updateMany).toHaveBeenNthCalledWith(2, {
            where: { sessionId: SESSION_ID, rotatedAt: null },
            data: { rotatedAt: ANY_DATE },
        });
        expect(outside.refreshToken.deleteMany).not.toHaveBeenCalled();
    });

    it('rotates normally when the IP changed, without revoking anything', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue(
            row({ allocatedIp: '198.51.100.4' }),
        );

        const result = await refresh();

        expect(result).toEqual({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
        });
        expect(outside.refreshToken.deleteMany).not.toHaveBeenCalled();

        // The old row is marked rotated (so reuse after the grace window is
        // caught) and a new jti replaces it, so refresh tokens stay single-use.
        expect(transaction.refreshToken.updateMany).toHaveBeenCalledTimes(1);
        expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith({
            where: { id: 'row-1', rotatedAt: null },
            data: { rotatedAt: ANY_DATE },
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
        transaction.refreshToken.findUnique.mockResolvedValue(row());

        await refresh();

        // Roles come from the row, not the presented token, so a grant or a
        // revocation lands at the next refresh.
        expect(service.generateJwtToken).toHaveBeenCalledWith(
            USER_LOGIN_ID,
            SESSION_ID,
            ['admin'],
        );
        expect(transaction.refreshToken.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ sessionId: SESSION_ID }),
            }),
        );
    });

    it('rejects a refresh for an account that is no longer active, without rotating', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue(
            row({ userLogin: { status: 'suspended', roles: [] } }),
        );

        await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);

        // Not theft, so the user's other sessions are left alone; and nothing is
        // claimed or issued for the locked-out account.
        expect(outside.refreshToken.deleteMany).not.toHaveBeenCalled();
        expect(transaction.refreshToken.updateMany).not.toHaveBeenCalled();
        expect(transaction.refreshToken.create).not.toHaveBeenCalled();
    });

    it('still treats a replayed token as theft before looking at account status', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue(null);

        await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);

        expect(outside.refreshToken.deleteMany).toHaveBeenCalledWith({
            where: { userLoginId: USER_LOGIN_ID },
        });
    });

    it('prunes rotated rows of the session that are past the grace window', async () => {
        transaction.refreshToken.findUnique.mockResolvedValue(row());

        await refresh();

        expect(transaction.refreshToken.deleteMany).toHaveBeenCalledWith({
            where: {
                sessionId: SESSION_ID,
                rotatedAt: { lt: ANY_DATE },
            },
        });
    });
});

/**
 * Covers the two ways `handleOAuthLogin` used to go wrong for a real user: a
 * non-active account signing straight back in, and a Google account whose email
 * another row still held failing on the unique constraint (seen as login_failed).
 */
describe('AuthService.handleOAuthLogin', () => {
    const USER_LOGIN_ID = '11111111-1111-1111-1111-111111111111';
    const OTHER_USER_LOGIN_ID = '55555555-5555-5555-5555-555555555555';
    const EMAIL = 'learner@example.com';

    const oauthUser = (): IOAuthUserDTO => ({
        id: 'google-sub-1',
        provider: 'google',
        email: EMAIL,
        displayName: 'Learner',
        picture: 'https://example.com/p.png',
    });

    let transaction: {
        userLogin: {
            findUnique: jest.Mock;
            create: jest.Mock;
            update: jest.Mock;
        };
        user: { findUnique: jest.Mock; update: jest.Mock; upsert: jest.Mock };
        refreshToken: { create: jest.Mock };
    };
    let cacheService: { invalidateUser: jest.Mock };
    let adminEmails: string;
    let generateJwtToken: jest.SpyInstance;
    let service: AuthService;

    beforeEach(() => {
        transaction = {
            userLogin: {
                findUnique: jest.fn().mockResolvedValue({
                    id: USER_LOGIN_ID,
                    status: 'active',
                    roles: [],
                }),
                create: jest.fn(),
                update: jest.fn(({ data }: { data: { roles: string[] } }) => ({
                    id: USER_LOGIN_ID,
                    status: 'active',
                    roles: data.roles,
                })),
            },
            user: {
                findUnique: jest.fn().mockResolvedValue(null),
                update: jest.fn().mockResolvedValue(undefined),
                upsert: jest.fn().mockResolvedValue(undefined),
            },
            refreshToken: { create: jest.fn().mockResolvedValue(undefined) },
        };
        cacheService = {
            invalidateUser: jest.fn().mockResolvedValue(undefined),
        };

        const prismaService = {
            $transaction: jest.fn((fn: (tx: typeof transaction) => unknown) =>
                fn(transaction),
            ),
        };

        adminEmails = '';
        service = new AuthService(
            prismaService as never,
            {} as never,
            {
                get: (key: string) =>
                    key === 'adminEmails' ? adminEmails : undefined,
            } as never,
            cacheService as never,
        );
        generateJwtToken = jest.spyOn(service, 'generateJwtToken');
        generateJwtToken.mockResolvedValue({
            accessToken: 'access',
            refreshToken: 'refresh',
            refreshJti: 'jti',
            sid: 'sid',
        });
        jest.spyOn(
            service as unknown as { getRefreshTokenExpiresAt: () => Date },
            'getRefreshTokenExpiresAt',
        ).mockReturnValue(new Date('2026-09-12T00:00:00.000Z'));
        // The transaction's failure log is expected noise in the rejection tests.
        jest.spyOn(
            (service as unknown as { logger: { error: () => void } }).logger,
            'error',
        ).mockImplementation(() => undefined);
    });

    it('signs in an active account', async () => {
        await expect(
            service.handleOAuthLogin(oauthUser(), '203.0.113.7'),
        ).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' });
        expect(transaction.refreshToken.create).toHaveBeenCalled();
    });

    it('refuses a non-active account and issues nothing', async () => {
        transaction.userLogin.findUnique.mockResolvedValue({
            id: USER_LOGIN_ID,
            status: 'suspended',
        });

        await expect(
            service.handleOAuthLogin(oauthUser(), '203.0.113.7'),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(transaction.user.upsert).not.toHaveBeenCalled();
        expect(transaction.refreshToken.create).not.toHaveBeenCalled();
    });

    it('moves an email held by another account instead of failing on the unique constraint', async () => {
        transaction.user.findUnique.mockResolvedValue({
            id: 'other-user',
            userLoginId: OTHER_USER_LOGIN_ID,
        });

        await service.handleOAuthLogin(oauthUser(), '203.0.113.7');

        expect(transaction.user.update).toHaveBeenCalledWith({
            where: { id: 'other-user' },
            data: { gmail: null },
        });
        const [upsertArgs] = transaction.user.upsert.mock.calls[0] as [
            { update: { gmail: string } },
        ];
        expect(upsertArgs.update.gmail).toBe(EMAIL);
        // The previous holder's cached profile would otherwise keep showing it.
        expect(cacheService.invalidateUser).toHaveBeenCalledWith(
            OTHER_USER_LOGIN_ID,
        );
    });

    it('leaves the email alone when the account already holds it', async () => {
        transaction.user.findUnique.mockResolvedValue({
            id: 'own-user',
            userLoginId: USER_LOGIN_ID,
        });

        await service.handleOAuthLogin(oauthUser(), '203.0.113.7');

        expect(transaction.user.update).not.toHaveBeenCalled();
        expect(cacheService.invalidateUser).toHaveBeenCalledTimes(1);
    });

    it('grants the admin role to an address listed in ADMIN_EMAILS, case-insensitively', async () => {
        adminEmails = 'someone@else.com, Learner@Example.com';

        await service.handleOAuthLogin(oauthUser(), '203.0.113.7');

        expect(transaction.userLogin.update).toHaveBeenCalledWith({
            where: { id: USER_LOGIN_ID },
            data: { roles: ['admin'] },
        });
        expect(generateJwtToken).toHaveBeenCalledWith(
            USER_LOGIN_ID,
            expect.any(String),
            ['admin'],
        );
    });

    it('does not touch roles for an address that is not listed', async () => {
        adminEmails = 'someone@else.com';

        await service.handleOAuthLogin(oauthUser(), '203.0.113.7');

        expect(transaction.userLogin.update).not.toHaveBeenCalled();
        expect(generateJwtToken).toHaveBeenCalledWith(
            USER_LOGIN_ID,
            expect.any(String),
            [],
        );
    });

    it('keeps an existing admin role even when the address is no longer listed', async () => {
        transaction.userLogin.findUnique.mockResolvedValue({
            id: USER_LOGIN_ID,
            status: 'active',
            roles: ['admin'],
        });

        await service.handleOAuthLogin(oauthUser(), '203.0.113.7');

        expect(transaction.userLogin.update).not.toHaveBeenCalled();
        expect(generateJwtToken).toHaveBeenCalledWith(
            USER_LOGIN_ID,
            expect.any(String),
            ['admin'],
        );
    });
});
