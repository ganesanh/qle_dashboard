# QLE Dashboard MVP

React + TypeScript dashboard for:

- opening a formatted QLE workbook for editing
- formatting an unformatted QLE workbook first, then downloading it for review
- editing events, enum rows, categories, documents, and validation rules
- exporting an updated formatted workbook
- generating a diff and implementation bundle
- drafting or creating a Jira ticket

## Workbook Flow

The dashboard supports two entry paths:

- `Formatted workbook`: upload the styled workbook and edit it directly in the dashboard
- `Unformatted workbook`: upload the source workbook, let the dashboard format it, download the formatted copy, review it, and then open the formatted version in the editor

This keeps the editing surface consistent while still supporting raw workbook intake.

## Run

```bash
PATH=/usr/local/bin:$PATH npm install
PATH=/usr/local/bin:$PATH npm run dev
```

The Vite client runs on `http://localhost:5173` and proxies `/api` to the Express API on `http://localhost:8787`.

## Production Build

```bash
npm run build
npm start
```

Production runtime expectations:

- client assets build to `dist/client`
- server code builds to `dist/server`
- runtime-generated files go under `storage/` by default
- the Node server serves both the React app and `/api/*`

## Source Layout

- `frontend/`: Vite React app
- `backend/`: Express API and server runtime
- `shared/`: common types and validation used by both

## Deployment Layout

Deployment-oriented folders now included in the repo:

- `config/env/.env.example`: deployment-safe environment template
- `scripts/`: runtime and utility entrypoints
- `storage/`: runtime-generated output root
- `docs/deployment-readiness-plan.md`: deployment rollout plan

Copy the example env when setting up a new environment:

```bash
cp config/env/.env.example .env
```

## Developer Dashboard Prerequisite

`Developer Dashboard` now runs the implementation step through Cursor CLI. Install and authenticate `cursor-agent` before using that flow:

```bash
curl -fsS https://cursor.com/install | bash
cursor-agent
```

## Main Endpoints

- `POST /api/import-workbook`
- `POST /api/diff`
- `POST /api/export-workbook`
- `POST /api/bundles`
- `POST /api/jira/draft`
- `POST /api/jira/create`

## Jira Config

Set these env vars before using `POST /api/jira/create`:

- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_PROJECT_KEY`

## DB Config

Set these env vars before using the read-only DB event-name check:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SCHEMA`
- `DB_SSL`

You can start from `config/env/.env.example`.

For local development, copy `config/env/.env.example` to `.env`, fill in the real values, and keep `.env` out of git:

```bash
cp config/env/.env.example .env
```

Common runtime settings:

```bash
export NODE_ENV="development"
export APP_ENV="local"
export PORT="8787"
export STORAGE_DIR="./storage"
export BUNDLES_DIR="./storage/bundles"
export FORMATTED_OUTPUT_DIR="./storage/formatted"
export ENABLE_DEVELOPER_FLOW="false"

export DB_HOST="your_database_host"
export DB_PORT="5432"
export DB_NAME="your_database_name"
export DB_USER="your_database_user"
export DB_PASSWORD="your_database_password"
export DB_SCHEMA="public"
export DB_SSL="false"

export JIRA_BASE_URL="https://your-jira.example.com"
export JIRA_EMAIL="team@example.com"
export JIRA_API_TOKEN="your_jira_api_token"
export JIRA_PROJECT_KEY="PROJECT"
```

## Bundle Output

Bundles are written to `storage/bundles/<bundle-id>/` by default and include:

- `qle-update.json`
- `diff-summary.md`
- `jira-payload.json`
- generated formatted workbook
- `agent-handoff.json`

See the orchestration design in `docs/agent-orchestration.md`.

## Ready For Engineering

Use the `Ready for Engineering` action in the dashboard when you already have a Jira key and want a coordinator-ready handoff package.

It creates a Jira-linked bundle with:

- formatted workbook
- `qle-update.json`
- `diff-summary.md`
- `jira-payload.json`
- `agent-handoff.json`
- `READY_FOR_ENGINEERING.md`

## Docker

This repo now includes a production `Dockerfile` and `.dockerignore`.

Typical container flow:

```bash
docker build -t qle-dashboard .
docker run -p 8787:8787 --env-file .env qle-dashboard
```

## Developer Flow In Production

`Developer Flow` is disabled by default for deployment safety. Enable it only in environments where the local repo path, skill path, and Cursor CLI are intentionally available:

```bash
export ENABLE_DEVELOPER_FLOW="true"
export DEVELOPER_REPO_PATH="/absolute/path/to/repo"
export DEVELOPER_SKILL_PATH="/absolute/path/to/SKILL.md"
```
