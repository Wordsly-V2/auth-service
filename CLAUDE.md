# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Wordsly auth microservice (NestJS + Prisma + PostgreSQL, port 3001). Owns users and the token lifecycle, and is the identity provider for the whole mesh: it holds the only copy of the RSA signing keys and publishes the public half at `/.well-known/jwks.json`.

Reached through the gateway, which forwards but does not verify. Two global guards decide everything (`src/common/guard/`, registered as `APP_GUARD` in `app.module.ts`): `AccessGuard` is deny-by-default with two ways in — `@Public()`, or a valid RS256 access token — and `UserScopeGuard` refuses any request that tries to name the user it acts on. Handlers get the caller's id from `@CurrentUser()`, which reads the token's subject.

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
```

Config through `src/config/configuration.ts`; required vars validated at boot (`src/config/validate-env.ts`). Redis via `src/cache/cache.service.ts`.

## Token model (the heart of this service)

- **Access + refresh tokens are RS256 JWTs** (15m / 30d), payload `{ userLoginId, jti }`. This service is the only holder of the private keys; everyone else verifies against `/.well-known/jwks.json`.
- **Refresh tokens are persisted and rotated**: each refresh token's `jti` (uuidv7) links to a `RefreshToken` row. `handleRefreshToken` (`src/auth/auth.service.ts`) deletes the old row and inserts a new one on every refresh.
- **Reuse detection as theft detection**: a valid signature over a `jti` with no `RefreshToken` row means the token was already rotated away and is being replayed — that revokes ALL of the user's refresh tokens. Each row still stores `allocatedIp`, but a mismatch only logs a warning and rotates normally: a changed IP is almost always a network handover (notably when an offline client reconnects to flush queued practice), so revoking on it stranded legitimate syncs.
- Logout deletes by `jti` (or all rows with `isLoggedOutFromAllDevices`). Expired rows are swept by a daily cron (`src/auth/refresh-token-cleanup.service.ts`).

## Data model (`prisma/schema.prisma`)

Three tables, UUID PKs: `UserLogin` (provider identity, the id every other service scopes by), `User` (1:1 profile: gmail, displayName, pictureUrl), `RefreshToken`. OAuth login (`handleOAuthLogin`) upserts UserLogin + User by `providerUserId`.

## Conventions

- Path alias `@/*` → `src/*`; feature modules; controllers thin, logic in services; Prisma only via `PrismaService` in services; DTOs with class-validator (global ValidationPipe with `whitelist` + `transform`); kebab-case folders; 4-space indent, single quotes.
