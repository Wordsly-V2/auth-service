// `uuid` v13 ships ESM only, which Jest's CJS runtime cannot load. Nothing here
// depends on real id generation, so stub it rather than transforming the package.
jest.mock('uuid', () => ({ v7: () => '00000000-0000-7000-8000-000000000000' }));

import { AuthService } from '@/auth/auth.service';
import { UnauthorizedException } from '@nestjs/common';

/**
 * Covers the two theft-detection branches of `handleRefreshToken`:
 * a replayed (already-rotated) jti burns the whole token family, while a
 * refresh from a new IP only warns and rotates — the latter is what lets a
 * client that was offline reconnect on a different network and flush its
 * queued practice instead of being logged out everywhere.
 */
describe('AuthService.handleRefreshToken', () => {
  const USER_LOGIN_ID = '11111111-1111-1111-1111-111111111111';
  const JTI = '22222222-2222-2222-2222-222222222222';

  let transaction: {
    refreshToken: {
      findUnique: jest.Mock;
      deleteMany: jest.Mock;
      delete: jest.Mock;
      create: jest.Mock;
    };
  };
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
        (fn: (tx: typeof transaction) => unknown) => fn(transaction) as unknown,
      ),
    };

    const instance = new AuthService(
      prismaService as never,
      {} as never,
      {} as never,
      {} as never,
    );

    jest.spyOn(instance, 'generateJwtToken').mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      tokenJti: '33333333-3333-3333-3333-333333333333',
    });
    jest
      .spyOn(
        instance as unknown as { getRefreshTokenExpiresAt: () => Date },
        'getRefreshTokenExpiresAt',
      )
      .mockReturnValue(new Date('2026-09-12T00:00:00.000Z'));

    return instance;
  };

  beforeEach(() => {
    service = buildService();
  });

  it('revokes every refresh token when a rotated-away jti is replayed', async () => {
    transaction.refreshToken.findUnique.mockResolvedValue(null);

    await expect(
      service.handleRefreshToken({
        jwtPayload: { userLoginId: USER_LOGIN_ID, jti: JTI },
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
      allocatedIp: '198.51.100.4',
    });

    const result = await service.handleRefreshToken({
      jwtPayload: { userLoginId: USER_LOGIN_ID, jti: JTI },
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
          jwtId: '33333333-3333-3333-3333-333333333333',
          allocatedIp: '203.0.113.7',
        }),
      }),
    );
  });

  it('rotates normally when the IP matches', async () => {
    transaction.refreshToken.findUnique.mockResolvedValue({
      id: 'row-1',
      jwtId: JTI,
      userLoginId: USER_LOGIN_ID,
      allocatedIp: '203.0.113.7',
    });

    await service.handleRefreshToken({
      jwtPayload: { userLoginId: USER_LOGIN_ID, jti: JTI },
      userIpAddress: '203.0.113.7',
    });

    expect(transaction.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(transaction.refreshToken.create).toHaveBeenCalled();
  });
});
