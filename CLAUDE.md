# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Wordsly auth microservice (NestJS + Prisma + PostgreSQL, port 3001). Owns users and token lifecycle. Internal-only: every controller is guarded by `InternalServiceGuard` (`src/guard/internal-service/`), which requires the shared `x-service-token` header — only the api-gateway calls this service. Note: controllers use `@Payload()` from `@nestjs/microservices`, but these are plain HTTP `@Post` handlers, not RPC.

## Commands

```bash
npm run start:dev          # watch mode on PORT (default 3001)
npm run build              # prisma generate + nest build
npm run lint               # eslint --fix
npm run test               # jest (rootDir=src, *.spec.ts)
npx jest path/to/file.spec.ts   # single test file
npx prisma migrate dev     # create/apply migrations
npx prisma generate        # regenerate client after schema changes
```

Config through `src/config/configuration.ts`; required vars validated at boot (`src/config/validate-env.ts`). Redis via `src/cache/cache.service.ts`.

## Token model (the heart of this service)

- **Access + refresh tokens are RS256 JWTs** (15m / 30d), payload `{ userLoginId, jti }`. The key pair must match the api-gateway's.
- **Refresh tokens are persisted and rotated**: each refresh token's `jti` (uuidv7) links to a `RefreshToken` row. `handleRefreshToken` (`src/auth/auth.service.ts`) deletes the old row and inserts a new one on every refresh.
- **IP binding as theft detection**: each refresh row stores `allocatedIp`; a refresh from a different IP revokes ALL of the user's refresh tokens.
- Logout deletes by `jti` (or all rows with `isLoggedOutFromAllDevices`). Expired rows are swept by a daily cron (`src/auth/refresh-token-cleanup.service.ts`).

## Data model (`prisma/schema.prisma`)

Three tables, UUID PKs: `UserLogin` (provider identity, the id every other service scopes by), `User` (1:1 profile: gmail, displayName, pictureUrl), `RefreshToken`. OAuth login (`handleOAuthLogin`) upserts UserLogin + User by `providerUserId`.

## Conventions

- Path alias `@/*` → `src/*`; feature modules; controllers thin, logic in services; Prisma only via `PrismaService` in services; DTOs with class-validator (global ValidationPipe with `whitelist` + `transform`); kebab-case folders; 4-space indent, single quotes.
