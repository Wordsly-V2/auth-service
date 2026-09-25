/** The role that unlocks the curriculum admin API (`/admin/path/*`). */
export const ADMIN_ROLE = 'admin';

/**
 * Parse ADMIN_EMAILS (comma separated) into a lookup set. Addresses are
 * compared case-insensitively: Google normalises the case it reports, but an
 * operator typing the list by hand should not have to match it.
 */
export function parseAdminEmails(raw: string | undefined): Set<string> {
    return new Set(
        (raw ?? '')
            .split(',')
            .map((email) => email.trim().toLowerCase())
            .filter((email) => email.length > 0),
    );
}

/**
 * Roles a login should hold once ADMIN_EMAILS is applied, or `null` when nothing
 * changes. Only ever adds: taking an address off the list does not demote an
 * admin who was granted the role, since the grant may just as well have come
 * from `admin:grant`, and a mistyped env var should not lock the owner out.
 */
export function bootstrapRoles(
    current: readonly string[],
    email: string | null | undefined,
    adminEmails: ReadonlySet<string>,
): string[] | null {
    if (!email || !adminEmails.has(email.trim().toLowerCase())) return null;
    if (current.includes(ADMIN_ROLE)) return null;
    return [...current, ADMIN_ROLE];
}
