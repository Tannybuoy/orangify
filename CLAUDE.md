# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm install

# Typecheck all packages
pnpm run typecheck

# Build everything (typecheck + build all packages)
pnpm run build

# Run the frontend app (orange-logo)
pnpm --filter @workspace/orange-logo run dev

# Run the API server
pnpm --filter @workspace/api-server run dev

# Push DB schema changes to Postgres (dev only)
pnpm --filter @workspace/db run push

# Regenerate API hooks and Zod schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Typecheck a specific package
pnpm --filter @workspace/orange-logo run typecheck
```

## Architecture

This is a **pnpm monorepo** with packages in three directories:

```
artifacts/       # Deployable applications
  orange-logo/   # Main React/Vite frontend
  api-server/    # Express 5 API server
  mockup-sandbox/ # Component sandbox (standalone, not connected to api-server)

lib/             # Shared libraries (consumed by artifacts)
  db/            # Drizzle ORM schema + PostgreSQL client
  api-spec/      # OpenAPI spec (source of truth for API types)
  api-client-react/  # Generated: React Query hooks (do not edit manually)
  api-zod/           # Generated: Zod validators (do not edit manually)

scripts/         # Utility scripts
```

### API Codegen Flow

`lib/api-spec/openapi.yaml` is the single source of truth for the API contract. Running codegen (via Orval) writes generated files into:
- `lib/api-client-react/src/generated/` — TanStack React Query hooks
- `lib/api-zod/src/generated/` — Zod schemas and TypeScript types

**Never edit files inside `generated/` directories.** Edit `openapi.yaml` and re-run codegen instead.

### Main App: `artifacts/orange-logo`

A purely client-side React app. The core logic lives in `src/lib/orangify.ts`, which uses the Canvas API to:
1. Load the uploaded image (with special handling for SVGs via DOMParser)
2. Scale images down to a 2048px cap
3. Replace all non-transparent, non-near-white pixels (luminance < 220) with `rgb(255, 106, 0)`
4. Return both the original and orangified image as data URLs

The UI is a two-panel layout: upload/controls on the left, before/after slider comparison on the right.

### Database: `lib/db`

Schema is defined in `lib/db/src/schema/index.ts` (currently empty). Each table should export a Drizzle table, a `drizzle-zod` insert schema, and TypeScript types. Use `pnpm --filter @workspace/db run push` to apply schema to a dev database (not `migrate` — this project uses `push` for dev).

### API Server: `artifacts/api-server`

Express 5, built with esbuild into a CJS bundle at `dist/index.mjs`. Currently has only a `/health` route. New routes go in `src/routes/` and are registered in `src/routes/index.ts`.

## TypeScript Setup

The root `tsconfig.json` uses TypeScript project references for the lib packages (`lib/db`, `lib/api-client-react`, `lib/api-zod`). Artifact packages have their own `tsconfig.json` files. The base config (`tsconfig.base.json`) enables `strictNullChecks`, `noImplicitAny`, and `useUnknownInCatchVariables`.

Use `zod/v4` imports (not `zod`) — the workspace uses Zod v3.25+ which exposes the v4 API at that path.

## Supply-Chain Security

`pnpm-workspace.yaml` enforces a 1-day minimum release age for all npm packages (`minimumReleaseAge: 1440`). Do not disable this. The only exceptions are `@replit/*` packages and `stripe-replit-sync`.
