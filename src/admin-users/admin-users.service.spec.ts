import { AdminUsersService } from '@/admin-users/admin-users.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('AdminUsersService writes', () => {
    const ACTOR = '00000000-0000-4000-8000-000000000001';
    const TARGET = '00000000-0000-4000-8000-000000000002';

    let tx: {
        userLogin: {
            findUnique: jest.Mock;
            count: jest.Mock;
            update: jest.Mock;
        };
        refreshToken: { deleteMany: jest.Mock };
    };
    let invalidateUser: jest.Mock;
    let service: AdminUsersService;

    const target = (roles: string[], status = 'active') =>
        tx.userLogin.findUnique.mockResolvedValue({
            id: TARGET,
            roles,
            status,
        });

    beforeEach(() => {
        tx = {
            userLogin: {
                findUnique: jest.fn(),
                count: jest.fn().mockResolvedValue(2),
                update: jest.fn().mockResolvedValue({}),
            },
            refreshToken: {
                deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
            },
        };
        invalidateUser = jest.fn().mockResolvedValue(undefined);
        const prisma = {
            $transaction: jest.fn((run: (client: typeof tx) => unknown) =>
                run(tx),
            ),
        };
        service = new AdminUsersService(
            prisma as never,
            { invalidateUser } as never,
            { get: () => '' } as never,
        );
        // The read-back after a write is not what these cases are about.
        jest.spyOn(service, 'detail').mockResolvedValue({} as never);
    });

    it('grants admin and invalidates the cached profile', async () => {
        target([]);
        await service.setRoles(ACTOR, TARGET, ['admin']);

        expect(tx.userLogin.update).toHaveBeenCalledWith({
            where: { id: TARGET },
            data: { roles: ['admin'] },
        });
        expect(invalidateUser).toHaveBeenCalledWith(TARGET);
    });

    it('refuses changing your own roles with 409', async () => {
        tx.userLogin.findUnique.mockResolvedValue({
            id: ACTOR,
            roles: ['admin'],
            status: 'active',
        });

        await expect(service.setRoles(ACTOR, ACTOR, [])).rejects.toThrow(
            ConflictException,
        );
        expect(tx.userLogin.update).not.toHaveBeenCalled();
    });

    it('refuses demoting the last active admin', async () => {
        target(['admin']);
        tx.userLogin.count.mockResolvedValue(1);

        await expect(service.setRoles(ACTOR, TARGET, [])).rejects.toThrow(
            /last active admin/,
        );
    });

    it('suspending ends every session', async () => {
        target([]);
        await service.setStatus(ACTOR, TARGET, 'suspended');

        expect(tx.userLogin.update).toHaveBeenCalledWith({
            where: { id: TARGET },
            data: { status: 'suspended' },
        });
        expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({
            where: { userLoginId: TARGET },
        });
    });

    it('reactivating leaves sessions alone', async () => {
        target([], 'suspended');
        await service.setStatus(ACTOR, TARGET, 'active');

        expect(tx.refreshToken.deleteMany).not.toHaveBeenCalled();
    });

    it('404s for an unknown account and writes nothing', async () => {
        tx.userLogin.findUnique.mockResolvedValue(null);

        await expect(service.revokeSessions(ACTOR, TARGET)).rejects.toThrow(
            NotFoundException,
        );
        expect(tx.refreshToken.deleteMany).not.toHaveBeenCalled();
        expect(invalidateUser).not.toHaveBeenCalled();
    });

    it('reports how many sessions a revoke ended', async () => {
        target([]);
        await expect(service.revokeSessions(ACTOR, TARGET)).resolves.toEqual({
            sessionsEnded: 3,
        });
    });
});
