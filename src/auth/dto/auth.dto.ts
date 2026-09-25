/** A Google profile as passport hands it over, before it is normalised. */
export interface IOAuthProfileDTO {
    id: string;
    displayName: string;
    emails: { value: string }[];
    photos: { value: string }[];
    provider: string;
}

export interface IOAuthUserDTO {
    id: string;
    displayName: string;
    email: string;
    picture: string;
    provider: 'google' | 'facebook';
}

export interface IOAuthLoginResponseDTO {
    accessToken: string;
    refreshToken: string;
}

/** Discriminates an access token from a refresh token. See TokenService. */
export type TokenType = 'access' | 'refresh';

/**
 * Claims carried by the tokens this service issues.
 *
 * `sub` is the identity every service scopes by (the `UserLogin` id). The
 * duplicate `userLoginId` is the pre-migration claim name, kept only so tokens
 * minted before the cutover and after it are both readable by consumers that
 * have not switched yet; it is removed once nothing reads it.
 */
export interface JwtAuthPayload {
    sub: string;
    /** @deprecated Use `sub`. Retained for one migration window. */
    userLoginId: string;
    /** Session id. Stable across refresh rotation, so logout can target a device. */
    sid: string;
    typ: TokenType;
    jti: string;
    /** Authorization roles (e.g. "admin"). Access tokens only; absent on older tokens. */
    roles?: string[];
    iss?: string;
    aud?: string | string[];
    exp?: number;
    iat?: number;
    nbf?: number;
}
