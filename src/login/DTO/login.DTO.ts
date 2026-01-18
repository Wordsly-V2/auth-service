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
