import { ADMIN_ROLE } from '@/auth/roles';

/** Roles an admin may hand out from the admin API. */
export const ASSIGNABLE_ROLES = [ADMIN_ROLE] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Default and maximum span of a stats request, in days (inclusive). */
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 365;

export interface Paging {
    page: number;
    pageSize: number;
    skip: number;
}

/** 1-based page, clamped to sane bounds rather than refused. */
export function toPaging(page?: number, pageSize?: number): Paging {
    const safePage = Math.max(1, Math.floor(page ?? 1));
    const safeSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, Math.floor(pageSize ?? DEFAULT_PAGE_SIZE)),
    );
    return {
        page: safePage,
        pageSize: safeSize,
        skip: (safePage - 1) * safeSize,
    };
}

/**
 * Why an admin may not make this change, or `null` when it is allowed.
 *
 * Two rails, both about not locking the panel out: nobody changes their own
 * roles or status from here (an admin who demotes themselves by mistake cannot
 * undo it), and the last active admin is never demoted or suspended.
 */
export function refuseAccountChange(params: {
    actorId: string;
    targetId: string;
    /** The target currently holds `admin` and is active. */
    targetIsActiveAdmin: boolean;
    /** The change leaves the target without an active admin role. */
    removesAdmin: boolean;
    /** Active admins right now, the target included. */
    activeAdminCount: number;
}): string | null {
    if (params.actorId === params.targetId) {
        return 'You cannot change your own account here';
    }
    if (
        params.targetIsActiveAdmin &&
        params.removesAdmin &&
        params.activeAdminCount <= 1
    ) {
        return 'This is the last active admin';
    }
    return null;
}

/** Roles after replacing the assignable ones, keeping any others untouched. */
export function nextRoles(
    current: readonly string[],
    requested: readonly string[],
): string[] {
    const assignable = ASSIGNABLE_ROLES as readonly string[];
    const kept = current.filter((role) => !assignable.includes(role));
    const granted = assignable.filter((role) => requested.includes(role));
    return [...kept, ...granted];
}

export interface DateRange {
    /** Inclusive, `YYYY-MM-DD` (UTC). */
    from: string;
    /** Inclusive, `YYYY-MM-DD` (UTC). */
    to: string;
}

/**
 * Fill in a missing end (today) and start (`DEFAULT_RANGE_DAYS` back), and
 * refuse ranges that are backwards or longer than `MAX_RANGE_DAYS`. Returns the
 * refusal reason as a string so the caller picks the exception.
 */
export function resolveRange(
    from: string | undefined,
    to: string | undefined,
    today: Date = new Date(),
): DateRange | string {
    const end = to ?? isoDate(today);
    const start =
        from ?? isoDate(addDays(parseIsoDate(end), -(DEFAULT_RANGE_DAYS - 1)));
    const span = daysBetween(start, end) + 1;
    if (span < 1) return '`from` must not be after `to`';
    if (span > MAX_RANGE_DAYS) {
        return `The range may span at most ${MAX_RANGE_DAYS} days`;
    }
    return { from: start, to: end };
}

/** One point per day of the range, zero where the rows have nothing. */
export function fillDailySeries(
    range: DateRange,
    rows: readonly { date: string; count: number }[],
): { date: string; count: number }[] {
    const byDate = new Map(rows.map((row) => [row.date, row.count]));
    const series: { date: string; count: number }[] = [];
    for (
        let day = parseIsoDate(range.from);
        isoDate(day) <= range.to;
        day = addDays(day, 1)
    ) {
        const date = isoDate(day);
        series.push({ date, count: byDate.get(date) ?? 0 });
    }
    return series;
}

export function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function parseIsoDate(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
}

export function addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 86_400_000);
}

function daysBetween(from: string, to: string): number {
    return Math.round(
        (parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) /
            86_400_000,
    );
}
