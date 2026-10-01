jest.mock('uuid', () => ({ v7: () => '00000000-0000-7000-8000-000000000000' }));

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
            delete: jest.Mock;
        };
        user: { deleteMany: jest.Mock };
        refreshToken: { deleteMany: jest.Mock };
    };
    let invalidateUser: jest.Mock;
    let outbox: { enqueue: jest.Mock };
    let relay: { flush: jest.Mock; isPublished: jest.Mock };
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
                delete: jest.fn().mockResolvedValue({}),
            },
            user: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
            refreshToken: {
                deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
            },
        };
        invalidateUser = jest.fn().mockResolvedValue(undefined);
        outbox = { enqueue: jest.fn().mockResolvedValue('event-1') };
        relay = {
            flush: jest.fn().mockResolvedValue(undefined),
            isPublished: jest.fn().mockResolvedValue(true),
        };
        const prisma = {
            $transaction: jest.fn((run: (client: typeof tx) => unknown) =>
                run(tx),
            ),
        };
        service = new AdminUsersService(
            prisma as never,
            { invalidateUser } as never,
            { get: () => '' } as never,
            outbox,
            relay as never,
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

    describe('deleteAccount', () => {
        it('queues user_deleted in the same transaction, then deletes the account', async () => {
            target([]);
            const result = await service.deleteAccount(ACTOR, TARGET);

            expect(outbox.enqueue).toHaveBeenCalledWith(
                tx,
                'user_deleted',
                { userLoginId: TARGET, deletedAt: result.deletedAt },
                TARGET,
            );
            expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({
                where: { userLoginId: TARGET },
            });
            expect(tx.user.deleteMany).toHaveBeenCalledWith({
                where: { userLoginId: TARGET },
            });
            expect(tx.userLogin.delete).toHaveBeenCalledWith({
                where: { id: TARGET },
            });
            expect(invalidateUser).toHaveBeenCalledWith(TARGET);
            expect(relay.isPublished).toHaveBeenCalledWith('event-1');
            expect(result).toMatchObject({
                userLoginId: TARGET,
                sessionsEnded: 3,
                eventPublished: true,
            });
        });

        it('still deletes when Kafka is down, and says the event is waiting', async () => {
            target([]);
            relay.isPublished.mockResolvedValue(false);

            await expect(
                service.deleteAccount(ACTOR, TARGET),
            ).resolves.toMatchObject({ eventPublished: false });
            expect(tx.userLogin.delete).toHaveBeenCalled();
        });

        it('refuses deleting your own account and queues nothing', async () => {
            tx.userLogin.findUnique.mockResolvedValue({
                id: ACTOR,
                roles: ['admin'],
                status: 'active',
            });

            await expect(service.deleteAccount(ACTOR, ACTOR)).rejects.toThrow(
                ConflictException,
            );
            expect(outbox.enqueue).not.toHaveBeenCalled();
            expect(tx.userLogin.delete).not.toHaveBeenCalled();
        });

        it('refuses deleting the last active admin', async () => {
            target(['admin']);
            tx.userLogin.count.mockResolvedValue(1);

            await expect(service.deleteAccount(ACTOR, TARGET)).rejects.toThrow(
                /last active admin/,
            );
            expect(outbox.enqueue).not.toHaveBeenCalled();
        });

        it('lets you delete another admin while one stays', async () => {
            target(['admin']);
            await service.deleteAccount(ACTOR, TARGET);
            expect(tx.userLogin.delete).toHaveBeenCalled();
        });
    });
});
