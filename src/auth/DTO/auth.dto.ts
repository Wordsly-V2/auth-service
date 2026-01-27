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

export type JwtAuthPayload = {
  userLoginId: string;
  exp?: number;
  iat?: number;
  iss?: string;
  sub?: string;
  aud?: string;
  nbf?: number;
  jti?: string;
};
