# AGENTS.md

Guidance for automated agents working in this repository.

## Stack

TypeScript + Electron desktop app. Bundled with `electron-builder`. Tests use
`vitest`. Linting uses `eslint` with `@typescript-eslint`.

## Commands

- `npm install` — install dependencies
- `npm run lint` — run eslint
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — run vitest unit tests
- `npm run compile` — compile TypeScript to `dist/`
- `npm run build` — compile and package distributables via electron-builder
  (current OS only; CI builds macOS + Windows + Linux).

## Releasing

- Driven by `.github/workflows/release.yml` using
  [`googleapis/release-please-action`](https://github.com/googleapis/release-please-action).
  Releases are **automatic** from commits: release-please parses
  [Conventional Commits](https://www.conventionalcommits.org/) and keeps a
  release PR up to date on `main`. Merging that PR bumps `package.json`, tags
  `vX.Y.Z`, and creates the GitHub release.
  - `fix:` → patch, `feat:` → minor, `feat!:`/`fix!:`/etc. → major.
- `renovate.json` flattens dependency updates to the `deps:` conventional-commit
  type (`semanticCommitType: "deps"`), so release-please groups them under a
  dedicated **Dependencies** changelog section. Major/breaking dependency bumps
  keep the `!` marker (`deps!:`) and drive a major release; all other dependency
  updates create a patch release. Configured via `release-please-config.json`
  (explicit `changelog-sections`) and `.release-please-manifest.json`.
- When a release is created, the `build` matrix builds macOS/Windows/Linux
  artifacts (`npm run build`) and uploads them to the release via `gh`.
  Distributables are **unsigned** (no signing certs).
- `workflow_dispatch` with a `tag` input rebuilds and re-uploads assets for an
  existing tag (no version bump). Leave it empty for the normal release-please run.
- Local `npm run build` is for verifying packaging on the dev machine only.

## Local ATEM simulator (no hardware needed)

- `npm run mock` — run the built-in Node ATEM simulator (UDP/9910) locally. It
  speaks the exact protocol `atem-connection` expects, so the app connects exactly
  as to real hardware, and exposes an HTTP control at :9932 (`/set?program=2&preview=3`).
- `npm run mock:pyatem` — pyAtemSim launcher (kept for reference only; it uses an
  older ATEM header format that `atem-connection` does not understand, so it will
  NOT connect to this app).
- `docker compose up` — run the Node ATEM simulator in a container (UDP/9910 + :9932).
- Connect with `ATEM_IP=127.0.0.1 npm run dev`. Flip Program/Preview via the HTTP
  control, or drive state from ATEM Software Control pointed at `127.0.0.1`.
- `RUN_ATEM_INTEGRATION=1 npm test` runs the opt-in integration test that exercises
  the real `atem-connection` handshake + tally state against the Node simulator.

## Conventions

- The Electron main process uses CommonJS `require()` (not ESM imports). Keep it
  that way unless migrating the whole file.
- Pure, testable logic lives in `src/main/tally.ts` and the ATEM connection
  lifecycle in `src/main/atem.ts` (`AtemTallyClient`); `main.ts` stays thin and
  delegates so it can be unit tested without Electron/ATEM.
- `AtemTallyClient` accepts an injectable ATEM instance for testing.
- Unit tests live next to the code as `*.test.ts` and use vitest. Integration
  tests are `*.integration.test.ts` and skipped unless `RUN_ATEM_INTEGRATION=1`.
- The web tally client reads `?showLabel=true` to render an ON-AIR / PREVIEW /
  OFFLINE label.
