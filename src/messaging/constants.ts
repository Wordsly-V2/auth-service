/**
 * Published (through the outbox) after an admin deletes an account.
 * vocabulary-, learning- and curriculum-service delete every row of that user.
 * Payload: `UserDeletedEvent`. Keyed by `userLoginId`.
 */
export const USER_DELETED_TOPIC = 'user_deleted';

export interface UserDeletedEvent {
    /** The deleted `UserLogin.id`. */
    userLoginId: string;
    /** ISO time of the delete. */
    deletedAt: string;
}
