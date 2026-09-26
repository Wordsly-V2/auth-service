# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Wordsly auth microservice (NestJS + Prisma + PostgreSQL, port 3001). Owns users and the token lifecycle, and is the identity provider for the whole mesh: it holds the only copy of the RSA signing keys and publishes the public half at `/.well-known/jwks.json`.

Reached through the gateway, which forwards but does not verify. Three global guards decide everything (`src/common/guard/`, registered as `APP_GUARD` in `app.module.ts`, in this order): `AccessGuard` is deny-by-default with two ways in — `@Public()`, or a valid RS256 access token — and attaches `{sub, sid, jti, roles}`; `RolesGuard` enforces `@Roles('admin')` (`src/common/decorators/roles.decorator.ts`, 403 without the role, no-op without the decorator); `UserScopeGuard` refuses any request that tries to name the user it acts on, except an admin on an `@Roles('admin')` route (admin routes live under `/admin/users`). Handlers get the caller's id from `@CurrentUser()`, which reads the token's subject.

`AuthSessionController` is the browser-facing half (the Google handshake, refresh rotation, logout). It moved here from the gateway, which used to run the handshake and decode refresh tokens on this service's behalf — this service then minted tokens from whatever it was handed without checking a signature.

## Commands

```bash
npm run start:dev          # watch mode on PORT (default 3001)
npm run build              # prisma generate + nest build
npm run lint               # eslint --fix
npm run test               # jest (rootDir=src, *.spec.ts)
npx jest path/to/file.spec.ts   # single test file
npx prisma migrate dev     # create/apply migrations
npx prisma generate        # regenerate client after schema changes
npm run keys:generate -- --append   # add a JWT signing key to the set in .env (rotation)
npm run admin:grant -- <email> [--revoke]   # grant/revoke the admin role (account must exist)
```

Config through `src/config/configuration.ts`; required vars validated at boot (`src/config/validate-env.ts`). Redis via `src/cache/cache.service.ts`.

## Token model (the heart of this service)

- **Access + refresh tokens are RS256 JWTs** (15m / 30d), payload `{ userLoginId, jti }`. This service is the only holder of the private keys; everyone else verifies against `/.well-known/jwks.json`.
- **Refresh tokens are persisted and rotated**: each refresh token's `jti` (uuidv7) links to a `RefreshToken` row. `handleRefreshToken` (`src/auth/auth.service.ts`) deletes the old row and inserts a new one on every refresh.
- **Reuse detection as theft detection**: a valid signature over a `jti` with no `RefreshToken` row means the token was already rotated away and is being replayed — that revokes ALL of the user's refresh tokens. Each row still stores `allocatedIp`, but a mismatch only logs a warning and rotates normally: a changed IP is almost always a network handover (notably when an offline client reconnects to flush queued practice), so revoking on it stranded legitimate syncs.
- **Roles**: `UserLogin.roles` (text[]) is signed into the **access token only** as `roles` (the refresh token never carries it). Login and every refresh re-read it from the DB, so a change lands within one access-token lifetime. `ADMIN_EMAILS` (optional, case-insensitive) adds `admin` at OAuth login and never removes it (`src/auth/roles.ts`). `/profile` also returns `roles`, but that is only for showing UI; services authorize from the token.
- Logout deletes by `jti` (or all rows with `isLoggedOutFromAllDevices`). Expired rows are swept by a daily cron (`src/auth/refresh-token-cleanup.service.ts`).

## Admin API (`src/admin-users/`)

`@Roles('admin')` at class level under `/admin/users` (the gateway routes it here): `GET /` (search `q` over email and display name, filters `role`, `status`, paging clamped to 100), `GET stats?from&to` (UTC days, default last 30, max 365: totals, sign-ups per day), `GET :id` (with `lastSeenAt` = newest refresh token, `bootstrapAdmin` = listed in `ADMIN_EMAILS`, so revoking admin is undone at their next login), `PATCH :id/roles {roles}` (only `ASSIGNABLE_ROLES`; other roles are kept), `PATCH :id/status {status}` (`USER_LOGIN_STATUSES` in `src/auth/user-login-status.ts`; suspending deletes every refresh token), `POST :id/sessions/revoke`. Writes run in a serializable transaction (a clash answers 409), refuse changing your own account and removing the last active admin (409, pure rails in `admin-users.logic.ts`), invalidate the cached profile, and log one `admin_action {actor, action, target, …}` line. A suspended user's live access token still works until it expires (at most 15 min); there is no denylist.

## Data model (`prisma/schema.prisma`)

Three tables, UUID PKs: `UserLogin` (provider identity, the id every other service scopes by), `User` (1:1 profile: gmail, displayName, pictureUrl), `RefreshToken`. `UserLogin.roles` holds authorization roles. Bump `cacheKeys.userProfile()` whenever the profile payload shape changes. OAuth login (`handleOAuthLogin`) upserts UserLogin + User by `providerUserId`.

## Conventions

- Path alias `@/*` → `src/*`; feature modules; controllers thin, logic in services; Prisma only via `PrismaService` in services; DTOs with class-validator (global ValidationPipe with `whitelist` + `transform`); kebab-case folders; 4-space indent, single quotes.

## Database rules

- **Never use database enums** (workspace-wide rule, see `../../CLAUDE.md`): no Prisma `enum`, no `CREATE TYPE … AS ENUM`. Use `String` columns; the allowed values live in code as an `as const` list + union type and are validated at the boundary.
