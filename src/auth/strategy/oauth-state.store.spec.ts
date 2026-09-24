import type { Request } from 'express';
import { CookieStateStore, OAUTH_STATE_COOKIE } from './oauth-state.store';

describe('CookieStateStore', () => {
    const makeReq = (cookies: Record<string, string> = {}) => {
        const res = { cookie: jest.fn(), clearCookie: jest.fn() };
        return { req: { cookies, res } as unknown as Request, res };
    };

    it('issues a random state and sets it as an httpOnly lax cookie', () => {
        const store = new CookieStateStore(true);
        const { req, res } = makeReq();
        const callback = jest.fn();

        store.store(req, {}, callback);

        const [, state] = callback.mock.calls[0] as [null, string];
        expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
        expect(res.cookie).toHaveBeenCalledWith(
            OAUTH_STATE_COOKIE,
            state,
            expect.objectContaining({
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
            }),
        );
    });

    it('accepts the state its own cookie carries, and clears the cookie', () => {
        const store = new CookieStateStore(false);
        const { req, res } = makeReq({ [OAUTH_STATE_COOKIE]: 'abc123' });
        const callback = jest.fn();

        store.verify(req, 'abc123', callback);

        expect(callback).toHaveBeenCalledWith(null, true);
        expect(res.clearCookie).toHaveBeenCalled();
    });

    it.each([
        ['a mismatched state', { [OAUTH_STATE_COOKIE]: 'abc123' }, 'zzz999'],
        ['no state cookie (forged callback link)', {}, 'abc123'],
        ['no state parameter', { [OAUTH_STATE_COOKIE]: 'abc123' }, ''],
    ])('rejects %s', (_label, cookies, provided) => {
        const store = new CookieStateStore(false);
        const { req, res } = makeReq(cookies);
        const callback = jest.fn();

        store.verify(req, provided, callback);

        expect(callback).toHaveBeenCalledWith(null, false, expect.anything());
        expect(res.clearCookie).toHaveBeenCalled();
    });
});
