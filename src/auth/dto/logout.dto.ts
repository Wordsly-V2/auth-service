import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Body of `POST /auth/logout`.
 *
 * A class rather than an interface because interfaces are erased at compile
 * time: the handler used to read this flag straight off an unvalidated object,
 * so the string `"false"` — which is truthy — ended every session on every
 * device instead of just this one.
 *
 * The identity acted on still comes from the access token, never from here.
 */
export class LogoutDto {
    @IsOptional()
    @IsBoolean()
    isLoggedOutFromAllDevices?: boolean;
}
