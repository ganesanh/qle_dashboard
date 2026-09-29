# QLE Dashboard Project Knowledge Base

This file is the central, durable guidance for agents and contributors working in this repository. Keep it current when project-wide behavior or operating rules change.

## Product Purpose

QLE Dashboard imports formatted and unformatted QLE workbooks, lets users review and edit workbook content, validates required data, and exports formatted workbooks and engineering handoff artifacts.

## Source Map

- `frontend/src/App.tsx`: primary dashboard workflow and workbook editor.
- `frontend/src/components/app/`: extracted UI sections and modals.
- `backend/src/qleWorkbook.ts`: workbook parsing, serialization, formatting, and export.
- `backend/src/index.ts`: API routes and production server.
- `shared/types.ts`: shared workbook model.
- `shared/validation.ts`: workbook validation behavior.
- `storage/`: runtime-generated files only; do not commit generated contents.

## Category Validation Rules

The category editor displays validation rules as a fixed rule name and an editable value.

- `documentsQty` is a fixed rule name; its value, such as `1`, must remain editable.
- `mandatoryDocuments` is a fixed rule name; its value, such as `[]`, must remain editable.
- Editing a rule value must update the corresponding `QleValidationItem`, synchronize `category.validation`, appear in review changes, and be written to the exported workbook.
- Do not treat these category rule values as switches that enable or disable the dashboard's global validation checks.
- Do not unlock fixed rule names unless the user explicitly requests that separate behavior.

## Change Guardrails

- Map a requested UI change to the exact screen, component, and data field before editing.
- Keep changes within the explicitly approved scope. Do not redesign adjacent sections or alter unrelated validation behavior.
- Preserve existing workbook parsing and formatting compatibility unless the request specifically changes it.
- Never commit credentials, OAuth secrets, API keys, access tokens, `.env` files, or customer workbook contents.
- Do not commit generated files from `storage/`, `outputs/`, build output, or temporary review artifacts.
- Preserve user changes already present in the worktree. Do not revert unrelated work.
- Run `npm run typecheck` and `npm run build` before committing application changes.
- Review the final diff for unintended files and behaviors before committing.
- Commit, push, merge, or deploy only when the user explicitly authorizes that action.
- Railway production deployments must come from the intended GitHub branch and must be checked after a push when deployment was requested.

## Delivery Workflow

1. Inspect the relevant code and current Git state.
2. State the proposed scope when the request requires human approval.
3. Implement only the approved changes.
4. Run focused verification plus the required typecheck and build.
5. Review the final diff and repository status.
6. Commit and push only with explicit user approval.
7. Report the commit and deployment status accurately; do not claim a queued deployment succeeded.
