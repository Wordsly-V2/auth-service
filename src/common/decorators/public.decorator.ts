import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opt a route out of the global access guard.
 *
 * The guard is global and deny-by-default, so anything reachable without a
 * token or the internal header has to say so explicitly here — which keeps the
 * list of unauthenticated surface greppable rather than implied by the absence
 * of a decorator.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
