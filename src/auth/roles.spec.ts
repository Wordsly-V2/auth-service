import { bootstrapRoles, parseAdminEmails } from '@/auth/roles';

describe('parseAdminEmails', () => {
    it('trims, lowercases and drops empty entries', () => {
        expect([...parseAdminEmails(' A@x.com, ,b@Y.com,')]).toEqual([
            'a@x.com',
            'b@y.com',
        ]);
    });

    it('treats an unset variable as an empty list', () => {
        expect(parseAdminEmails(undefined).size).toBe(0);
    });
});

describe('bootstrapRoles', () => {
    const admins = parseAdminEmails('owner@example.com');

    it('adds admin for a listed address, keeping existing roles', () => {
        expect(bootstrapRoles(['editor'], 'Owner@Example.com', admins)).toEqual(
            ['editor', 'admin'],
        );
    });

    it('returns null when the role is already held', () => {
        expect(
            bootstrapRoles(['admin'], 'owner@example.com', admins),
        ).toBeNull();
    });

    it('returns null for an unlisted or missing address', () => {
        expect(bootstrapRoles([], 'other@example.com', admins)).toBeNull();
        expect(bootstrapRoles([], null, admins)).toBeNull();
    });
});
