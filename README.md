# QLE Dashboard

A workbook-driven dashboard for QLE document intake, editing, review, and engineering handoff.

## About

Internal tool for maintaining QLE upload documents and related implementation bundles.

**Author:** Haripriyaa Ganesan (haripriyaa.ganesan@vimo.com)  
**Maintainer:** Haripriyaa Ganesan

The app supports both formatted and unformatted workbook flows. Product or operations users can format source workbooks, review highlighted changes, edit events, enums, categories, documents, and validation rules, then export an updated workbook or generate Jira-ready implementation details.

## Stack

- Vite + React 18 + TypeScript
- Express + Node.js
- ExcelJS for workbook parsing and export
- Zod for API validation
- PostgreSQL integration for PM event-name checks

## Getting started

Use Node `22.x` or `20.x`.

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

Default local ports:

- client: `http://localhost:5173`
- server: `http://localhost:8787`

The Vite client proxies `/api` requests to the Express server.

## Project layout

This repo is a single app with shared frontend, backend, and workbook logic:

- `frontend/` — React dashboard UI
- `backend/` — Express API, workbook import/export, Jira and DB integration
- `shared/` — shared types, validation, and filename helpers
- `scripts/` — formatter entrypoints and runtime utilities
- `config/env/` — environment templates
- `storage/` — runtime-generated uploads, formatted workbooks, logs, and bundles
- `docs/` — deployment and orchestration notes

```text
backend/
  src/
    db.ts                 # DB connectivity + PM lookup queries
    formatterTool.ts      # workbook formatting helpers
    index.ts              # Express server + API routes
    qleWorkbook.ts        # workbook import/export + diff logic
    runtimeConfig.ts      # env-driven runtime configuration
frontend/
  src/
    App.tsx               # main PM dashboard workflow
    main.tsx
    styles.css
    components/app/       # extracted modal, section, and icon components
shared/
  fileNames.ts            # workbook naming conventions
  types.ts                # shared workbook/domain types
  validation.ts           # workbook validation rules
config/
  env/.env.example        # safe environment template
scripts/
  qle-formatter.js
storage/
  uploads/
  formatted/
  bundles/
  logs/
```

## Workbook flow

The dashboard supports two intake paths:

1. `Formatted workbook`
   Upload the styled workbook and edit it directly in the app.
2. `Unformatted workbook`
   Upload the source workbook, let the app format it, download the formatted copy, and continue editing from the same dashboard workflow.

From there the app can:

- validate required workbook fields
- preserve and display highlighted workbook changes
- review change summaries before Jira creation
- export the latest formatted workbook
- generate implementation bundles for engineering handoff

## Main scripts

```bash
npm run dev           # start Vite client + Express server
npm run dev:client    # start client only
npm run dev:server    # start server only
npm run typecheck     # run client + server TypeScript checks
npm run build         # build client and server output
npm start             # run the built server from dist/
```

## Environment setup

Copy the example file before local setup:

```bash
cp config/env/.env.example .env
```

Common runtime settings include:

- `PORT`
- `STORAGE_DIR`
- `BUNDLES_DIR`
- `FORMATTED_OUTPUT_DIR`
- `ENABLE_DEVELOPER_FLOW`

DB settings for PM event lookup:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SCHEMA`
- `DB_SSL`

Jira settings:

- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_PROJECT_KEY`

## Main endpoints

- `POST /api/import-workbook`
- `POST /api/format-unformatted-workbook`
- `POST /api/export-workbook`
- `POST /api/diff`
- `POST /api/bundles`
- `POST /api/jira/draft`
- `POST /api/jira/create`
- `GET /api/db/config`
- `POST /api/db/config`

## Output and storage

Runtime-generated files are written under `storage/` by default:

- `storage/uploads/` — imported workbook files
- `storage/formatted/` — exported and formatted workbook output
- `storage/bundles/` — engineering handoff bundles
- `storage/logs/` — runtime and developer-flow logs

Bundle output typically includes:

- formatted workbook
- `qle-update.json`
- `diff-summary.md`
- `jira-payload.json`
- `agent-handoff.json`

## Developer flow

The dashboard includes a developer-oriented handoff flow for packaging workbook changes into implementation bundles and reviewable artifacts.

`Developer Flow` is disabled by default for safer deployments. Enable it only in environments where the local repo path, required skill path, and CLI tooling are intentionally configured.

Relevant settings:

- `ENABLE_DEVELOPER_FLOW`
- `DEVELOPER_REPO_PATH`
- `DEVELOPER_SKILL_PATH`

## Production build

```bash
npm run build
npm start
```

Build output:

- client assets: `dist/client`
- server build: `dist/server`

The Node server serves both the frontend app and `/api/*`.

## Docker

Typical container flow:

```bash
docker build -t qle-dashboard .
docker run -p 8787:8787 --env-file .env qle-dashboard
```
