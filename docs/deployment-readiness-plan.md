# Deployment Readiness Plan

## Current State

This project is currently a mixed local-development workspace:

- Vite React client in `frontend/`
- Express API in `backend/`
- Shared types/validation in `shared/`
- Local formatter script in `qle-formatter.js`
- Generated/demo assets mixed into the repo root

What works today:

- `npm install`
- `npm run dev`
- `npm run build` for the client

What is not deployment-ready yet:

- the production server still runs via `tsx backend/src/index.ts`
- the server does not appear to serve the built client from `dist/`
- repo contains large generated artifacts and sample files alongside app code
- several backend flows depend on hard-coded local machine paths
- there is no explicit production build for the server
- there is no deployment packaging, container, CI, or health-check story yet

## Target Layout

Recommended production-oriented layout:

```text
qle_document_flow/
  frontend/
    index.html
    src/
  backend/
    src/
  shared/
  scripts/
    qle-formatter.js
  docs/
    deployment-readiness-plan.md
    runbooks/
  config/
    env/
      example.env
  sample-documents/
    ...
  storage/
    .gitkeep
  dist/
    client/
    server/
  package.json
  Dockerfile
  .dockerignore
  .gitignore
```

Notes:

- Move `qle-formatter.js` into `scripts/` so runtime code and tooling are clearly separated.
- Keep `sample-documents/`, `generated-bundles/`, exported logs, and slide/demo assets outside the deployable app path.
- Treat `storage/` as runtime scratch space for uploads/bundles in local or single-node deploys.

## Recommended Runtime Split

Use one deployable Node service first, not multiple services.

Service responsibilities:

- serve the built React app
- expose `/api/*`
- run workbook import/export/diff logic
- run formatter jobs
- optionally disable local-only developer flows in production

Later, if needed, split these into:

- `web`: React static assets
- `api`: Express endpoints
- `worker`: long-running bundle / preview / Jira / formatting jobs

## Layout Changes By Priority

### 1. Separate deployable code from local artifacts

Keep in repo but out of deployment packaging:

- `generated-bundles/`
- `playwright-report/`
- `ppt_review_assets/`
- `*.pptx`
- `*.html` demo exports in repo root
- temporary Excel outputs such as `*_formatted.xlsx`

Action:

- move non-app assets into `docs/demo-assets/` or `artifacts/`
- expand `.gitignore`
- make deployment packaging exclude those paths

### 2. Make server buildable for production

Current issue:

- `start:server` uses `tsx`, which is fine for development but not ideal as the production runtime contract

Target:

- compile server TypeScript to `dist/server`
- build client to `dist/client`
- run production with plain `node`

Suggested scripts:

```json
{
  "scripts": {
    "dev": "concurrently \"npm:dev:server\" \"npm:dev:client\"",
    "dev:client": "vite",
    "dev:server": "tsx watch backend/src/index.ts",
    "build:client": "vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "build": "npm run build:client && npm run build:server",
    "start": "node dist/server/index.js"
  }
}
```

### 3. Serve the client from Express in production

Current issue:

- Vite dev proxy is the only client-server integration path visible right now

Target:

- Express serves static client assets in production
- non-API routes fall back to `dist/client/index.html`

Result:

- one URL
- easier containerization
- easier ingress/load balancer config

### 4. Remove local-machine assumptions from the API

High-risk hard-coded values currently exist for:

- local repo path
- local skill path
- preview worktree assumptions
- `cursor-agent`-driven developer workflow

Target:

- move machine-specific values to env vars
- feature-flag local-only routes
- disable or hide developer-preview flows in production

Suggested envs:

- `APP_ENV`
- `PORT`
- `NODE_ENV`
- `STORAGE_DIR`
- `BUNDLES_DIR`
- `ENABLE_DEVELOPER_FLOW`
- `DEVELOPER_REPO_PATH`
- `DEVELOPER_SKILL_PATH`
- `CURSOR_AGENT_BIN`

### 5. Define runtime storage boundaries

Current issue:

- generated output is written into repo-relative folders

Target:

- all writable runtime output goes to a configurable storage directory

Recommended directories:

- `storage/uploads`
- `storage/bundles`
- `storage/logs`
- `storage/tmp`

Why:

- works better in containers
- avoids polluting the app source tree
- makes cleanup and retention easier

### 6. Normalize config and secrets

Keep `.env.example`, but make it production-safe:

- no real internal hostnames or personal emails by default
- use placeholders only

Separate config classes:

- required in all envs: `PORT`, `NODE_ENV`
- optional local integration: DB and Jira
- local-only engineering automation: Cursor/dev-flow settings

### 7. Add deployment packaging

Minimum package set:

- `Dockerfile`
- `.dockerignore`
- startup command
- health endpoint

Recommended first deployment shape:

- one container
- one mounted or ephemeral writable storage path
- env vars provided by deployment platform

### 8. Add operational basics

Before calling it deployment-ready, add:

- `GET /api/health`
- structured request logging
- startup validation for required env vars
- size limits and upload error handling
- graceful handling when DB or Jira config is absent

### 9. Gate long-running and privileged flows

These flows look environment-specific and should not be assumed safe in production:

- repo worktree creation
- local preview startup
- PR creation helpers
- Cursor CLI integration

Recommendation:

- keep them behind `ENABLE_DEVELOPER_FLOW=true`
- hide related UI when disabled
- return `404` or `403` from the API when off

### 10. Add CI checks

Minimum CI for deployment confidence:

- install dependencies
- typecheck
- production build
- smoke test server startup

Good next step:

- API smoke tests for workbook import/export

## Suggested Folder Ownership

Use this as the long-term layout contract:

- `frontend/`: UI only
- `backend/`: HTTP API, job orchestration, integrations
- `shared/`: schemas, types, pure validation logic
- `scripts`: local CLI utilities and migration helpers
- `docs`: runbooks, architecture, deployment notes
- `storage`: runtime-generated files only, never source
- `sample-documents`: fixtures and demo inputs only

## Two-Phase Rollout

### Phase 1: Make current app deployable

- build server and client separately
- serve static assets from Express
- move formatter script under `scripts/`
- introduce storage env vars
- add health endpoint
- gate developer-only flows
- add Docker support

### Phase 2: Make it production-safe

- add CI pipeline
- add request logging and error normalization
- add artifact retention/cleanup
- move long-running jobs off request-response path if needed
- tighten secrets/config handling

## Immediate Next Tasks

Recommended implementation order:

1. Add a real production server build and `npm start`.
2. Update Express to serve the built client.
3. Replace hard-coded local paths with env-based config.
4. Move generated runtime output under a configurable `storage/` root.
5. Add Dockerfile, `.dockerignore`, and `/api/health`.
6. Hide or disable developer-only routes in production.

## Definition Of Deployment Ready

This repo is deployment-ready when:

- one command creates a full production build
- one command starts the app in production mode
- the app serves both UI and API from a stable runtime layout
- secrets are externalized
- writable paths are configurable and outside source code
- local-only engineering workflows are disabled unless explicitly enabled
- deployment artifacts exclude demo/generated noise
- CI verifies the build on every change
