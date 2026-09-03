export interface IUser {
  /** Primary key of the `User` profile row. Not the identity other services scope by. */
  id: string;
  /**
   * The `UserLogin` id — the identity every other service scopes rows by, and the
   * `sub` claim of the access token. Callers that need to compare the profile
   * against a token (e.g. the frontend's offline grace check) must use this, not `id`.
   */
  userLoginId: string;
  gmail: string | null;
  displayName: string;
  pictureUrl: string | null;
}
