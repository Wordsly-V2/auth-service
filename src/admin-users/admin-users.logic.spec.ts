import {
    fillDailySeries,
    MAX_PAGE_SIZE,
    MAX_RANGE_DAYS,
    nextRoles,
    refuseAccountChange,
    resolveRange,
    toPaging,
} from '@/admin-users/admin-users.logic';

describe('admin users logic', () => {
    describe('toPaging', () => {
        it('defaults to the first page of 20', () => {
            expect(toPaging()).toEqual({ page: 1, pageSize: 20, skip: 0 });
        });

        it('clamps rather than refuses out-of-range values', () => {
            expect(toPaging(0, 0)).toEqual({ page: 1, pageSize: 1, skip: 0 });
            expect(toPaging(3, 1000)).toEqual({
                page: 3,
                pageSize: MAX_PAGE_SIZE,
                skip: 2 * MAX_PAGE_SIZE,
            });
        });
    });

    describe('refuseAccountChange', () => {
        const base = {
            actorId: 'actor',
            targetId: 'target',
            targetIsActiveAdmin: true,
            removesAdmin: true,
            activeAdminCount: 2,
        };

        it('allows demoting an admin while another remains', () => {
            expect(refuseAccountChange(base)).toBeNull();
        });

        it('refuses any change to your own account', () => {
            expect(refuseAccountChange({ ...base, targetId: 'actor' })).toMatch(
                /your own/,
            );
        });

        it('refuses removing the last active admin', () => {
            expect(
                refuseAccountChange({ ...base, activeAdminCount: 1 }),
            ).toMatch(/last active admin/);
        });

        it('does not count a change that keeps the admin role', () => {
            expect(
                refuseAccountChange({
                    ...base,
                    removesAdmin: false,
                    activeAdminCount: 1,
                }),
            ).toBeNull();
        });
    });

    describe('nextRoles', () => {
        it('grants and revokes only the assignable roles', () => {
            expect(nextRoles([], ['admin'])).toEqual(['admin']);
            expect(nextRoles(['admin'], [])).toEqual([]);
        });

        it('keeps roles the admin API does not manage', () => {
            expect(nextRoles(['beta', 'admin'], [])).toEqual(['beta']);
        });

        it('ignores unknown requested roles and duplicates', () => {
            expect(nextRoles([], ['admin', 'admin', 'root'])).toEqual([
                'admin',
            ]);
        });
    });

    describe('resolveRange', () => {
        const today = new Date('2026-09-26T15:00:00Z');

        it('defaults to the last 30 days ending today', () => {
            expect(resolveRange(undefined, undefined, today)).toEqual({
                from: '2026-08-28',
                to: '2026-09-26',
            });
        });

        it('keeps an explicit range', () => {
            expect(resolveRange('2026-01-01', '2026-01-31', today)).toEqual({
                from: '2026-01-01',
                to: '2026-01-31',
            });
        });

        it('refuses a backwards range', () => {
            expect(resolveRange('2026-02-01', '2026-01-01', today)).toMatch(
                /after/,
            );
        });

        it(`refuses more than ${MAX_RANGE_DAYS} days`, () => {
            expect(resolveRange('2025-01-01', '2026-01-01', today)).toMatch(
                /at most/,
            );
            expect(typeof resolveRange('2025-01-02', '2026-01-01')).toBe(
                'object',
            );
        });
    });

    describe('fillDailySeries', () => {
        it('has one point per day, zero where nothing happened', () => {
            expect(
                fillDailySeries({ from: '2026-09-01', to: '2026-09-03' }, [
                    { date: '2026-09-02', count: 4 },
                ]),
            ).toEqual([
                { date: '2026-09-01', count: 0 },
                { date: '2026-09-02', count: 4 },
                { date: '2026-09-03', count: 0 },
            ]);
        });
    });
});
