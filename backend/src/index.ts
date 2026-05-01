import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  diffToMarkdown,
  diffWorkbooks,
  exportWorkbook,
  importWorkbook,
} from './qleWorkbook.js';
import {
  checkEventsAgainstDb,
  getDbConfigResponse,
  searchDbEventOptions,
  setRuntimeDbConfig,
  validateDbConnection,
} from './db.js';
import { runFormatterTool } from './formatterTool.js';
import {
  appEnv,
  appRootDir,
  bundlesDir,
  clientDistDir,
  clientIndexPath,
  cursorAgentBin,
  cursorRunTimeoutMs,
  developerFlowEnabled,
  developerRepoPath,
  developerSkillPath,
  developerSpaRelativePath,
  ensureRuntimeDirectories,
  formattedOutputDir,
  hasBuiltClient,
  isProduction,
  port,
} from './runtimeConfig.js';
import { buildVersionedFormattedName } from '../../shared/fileNames.js';
import { validateWorkbookModel } from '../../shared/validation.js';
import type {
  AgentHandoff,
  DbConfig,
  DbConfigResponse,
  DeveloperFlowApproveResult,
  DeveloperFlowCreatePrResult,
  DeveloperFlowExecutionStep,
  DeveloperFlowRunResult,
  DeveloperFlowStatus,
  DeveloperStageResult,
  JiraCreateResult,
  JiraDraft,
  QleWorkbookModel,
  ReadyForEngineeringResult,
} from '../../shared/types.js';

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
const developerFlowRuns = new Map<string, DeveloperFlowStatus>();
const developerFlowRunStage = new Map<string, DeveloperStageResult>();
let activePreviewProcess:
  | {
      pid: number;
      runId: string;
      url: string;
    }
  | null = null;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        type: 'http_request',
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      }),
    );
  });
  next();
});

function assertDeveloperFlowConfigured() {
  if (!developerFlowEnabled) {
    throw new Error('Developer Flow is disabled in this environment.');
  }
  if (!developerRepoPath) {
    throw new Error('Developer Flow is enabled but DEVELOPER_REPO_PATH is not configured.');
  }
  if (!developerSkillPath) {
    throw new Error('Developer Flow is enabled but DEVELOPER_SKILL_PATH is not configured.');
  }
}

function requireDeveloperFlowEnabled(res: express.Response) {
  if (!developerFlowEnabled) {
    res.status(404).json({ error: 'Developer Flow is disabled in this environment.' });
    return false;
  }

  if (!developerRepoPath || !developerSkillPath) {
    res.status(503).json({
      error:
        'Developer Flow is enabled, but DEVELOPER_REPO_PATH and DEVELOPER_SKILL_PATH must both be configured.',
    });
    return false;
  }

  return true;
}

function createDeveloperFlowSteps(): DeveloperFlowExecutionStep[] {
  return [
    {
      key: 'requestIntake',
      label: 'Request intake',
      state: 'Ready',
      detail: 'Jira key and workbook are ready.',
    },
    {
      key: 'jiraAndWorkbook',
      label: 'Read Jira and fetch workbook',
      state: 'Queued',
      detail: 'Preparing Jira context and workbook source.',
    },
    {
      key: 'createBranch',
      label: 'Create branch',
      state: 'Idle',
      detail: 'Waiting to prepare an isolated worktree for implementation.',
    },
    {
      key: 'skillRun',
      label: 'Run skill and review changes',
      state: 'Idle',
      detail: 'Waiting to create the working branch and run the formatted QLE skill with Cursor CLI.',
    },
    {
      key: 'previewServer',
      label: 'Start preview server',
      state: 'Idle',
      detail: 'Waiting for code changes before starting visual review.',
    },
    {
      key: 'approvalAndPush',
      label: 'Approval and push',
      state: 'Idle',
      detail: 'Approve only after the generated changes are verified.',
    },
    {
      key: 'createPr',
      label: 'Create PR',
      state: 'Idle',
      detail: 'Generate UI review and PR summary, then open the PR form.',
    },
  ];
}

function createDeveloperFlowStatus(args: {
  runId: string;
  jiraKey: string;
  branchName: string;
}): DeveloperFlowStatus {
  return {
    runId: args.runId,
    jiraKey: args.jiraKey,
    branchName: args.branchName,
    branchBrowseUrl: undefined,
    overallState: 'running',
    steps: createDeveloperFlowSteps(),
    changedFiles: [],
    changeRequestSummary: '',
    diffSummary: '',
    detailedDiff: '',
    previewUrl: '',
    lastUpdatedAt: new Date().toISOString(),
  };
}

function updateDeveloperFlowRun(
  runId: string,
  updater: (current: DeveloperFlowStatus) => DeveloperFlowStatus,
) {
  const current = developerFlowRuns.get(runId);
  if (!current) return;
  const next = updater(current);
  next.lastUpdatedAt = new Date().toISOString();
  developerFlowRuns.set(runId, next);
}

function setDeveloperFlowStep(
  runId: string,
  key: DeveloperFlowExecutionStep['key'],
  state: DeveloperFlowExecutionStep['state'],
  detail: string,
) {
  updateDeveloperFlowRun(runId, (current) => ({
    ...current,
    steps: current.steps.map((step) => (step.key === key ? { ...step, state, detail } : step)),
  }));
}

function setDeveloperFlowFailure(runId: string, message: string) {
  updateDeveloperFlowRun(runId, (current) => ({
    ...current,
    overallState: 'failed',
    error: message,
    steps: current.steps.map((step) => {
      if (step.key === 'approvalAndPush' && step.state === 'Idle') {
        return { ...step, state: 'Failed', detail: message };
      }
      if (step.state === 'Running' || step.state === 'Queued' || step.state === 'Prepared') {
        return { ...step, state: 'Failed', detail: message };
      }
      return step;
    }),
  }));
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdoutLogPath?: string;
    stderrLogPath?: string;
    timeoutMs?: number;
  } = {},
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const stdoutStream = options.stdoutLogPath
      ? createWriteStream(options.stdoutLogPath, { flags: 'a' })
      : null;
    const stderrStream = options.stderrLogPath
      ? createWriteStream(options.stderrLogPath, { flags: 'a' })
      : null;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          const message = `Command timed out after ${Math.round(options.timeoutMs! / 1000)}s: ${command} ${args.join(' ')}`;
          stderr += `${stderr ? '\n' : ''}${message}\n`;
          stderrStream?.write(`${message}\n`);
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }, options.timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      stdoutStream?.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      stderrStream?.write(chunk);
    });
    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      stdoutStream?.end();
      stderrStream?.end();
      reject(error);
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      stdoutStream?.end();
      stderrStream?.end();
      resolve({ code: timedOut ? 124 : code ?? 1, stdout, stderr });
    });
  });
}

async function appendDeveloperLog(filePath: string, message: string) {
  const timestamp = new Date().toISOString();
  await fs.appendFile(filePath, `[${timestamp}] ${message}\n`);
}

async function cleanupDeveloperWorktrees(branchName: string, nextWorktreePath: string) {
  const worktreeList = await runCommand(
    'git',
    ['-C', developerRepoPath, 'worktree', 'list', '--porcelain'],
    { cwd: developerRepoPath },
  );
  if (worktreeList.code !== 0) {
    throw new Error(worktreeList.stderr || 'Failed to inspect git worktrees.');
  }

  const branchRef = `refs/heads/${branchName}`;
  const lines = worktreeList.stdout.split('\n');
  let currentPath: string | null = null;
  let currentBranch: string | null = null;
  const removals: string[] = [];

  const flush = () => {
    if (
      currentPath &&
      currentBranch === branchRef &&
      currentPath !== developerRepoPath
    ) {
      removals.push(currentPath);
    }
    currentPath = null;
    currentBranch = null;
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      currentPath = line.slice('worktree '.length).trim();
      continue;
    }
    if (line.startsWith('branch ')) {
      currentBranch = line.slice('branch '.length).trim();
    }
  }
  flush();

  if (!removals.includes(nextWorktreePath)) {
    removals.push(nextWorktreePath);
  }

  for (const removalPath of removals) {
    await fs.rm(removalPath, { recursive: true, force: true });
    const removeResult = await runCommand(
      'git',
      ['-C', developerRepoPath, 'worktree', 'remove', '--force', removalPath],
      { cwd: developerRepoPath },
    );
    if (removeResult.code !== 0 && !removeResult.stderr.includes('is not a working tree')) {
      throw new Error(removeResult.stderr || `Failed to remove stale worktree ${removalPath}.`);
    }
  }

  const pruneResult = await runCommand(
    'git',
    ['-C', developerRepoPath, 'worktree', 'prune'],
    { cwd: developerRepoPath },
  );
  if (pruneResult.code !== 0) {
    throw new Error(pruneResult.stderr || 'Failed to prune stale git worktrees.');
  }
}

async function resolveDeveloperBaseRef(): Promise<string> {
  const candidates = ['refs/remotes/origin/master', 'refs/heads/master', 'HEAD'];

  for (const candidate of candidates) {
    if (candidate === 'HEAD') {
      return candidate;
    }

    const result = await runCommand('git', ['-C', developerRepoPath, 'show-ref', '--verify', candidate], {
      cwd: developerRepoPath,
    });
    if (result.code === 0) {
      return candidate;
    }
  }

  return 'HEAD';
}

function buildStateI18nRule(previewStateCode: string | null) {
  const normalized = (previewStateCode ?? '').toUpperCase();
  if (normalized === 'MN' || normalized === 'MNFS') {
    return 'I18n rule: for MN and MN_FS, update only ghix-web/src/main/webapp/resources/spa/src/i18n/mn/messages_en_fs.json and ghix-web/src/main/webapp/resources/spa/src/i18n/mn/messages_es_fs.json. Do not modify messages_en.json or messages_es.json for MN/MN_FS.';
  }

  if (normalized) {
    return `I18n rule: for ${normalized}, use ghix-web/src/main/webapp/resources/spa/src/i18n/<state>/messages_en.json and messages_es.json.`;
  }

  return 'I18n rule: for MN and MN_FS, use messages_en_fs.json and messages_es_fs.json; for other states, use messages_en.json and messages_es.json.';
}

function getDeveloperSpaPath(repoPath: string) {
  return path.join(repoPath, developerSpaRelativePath);
}

async function ensurePreviewDependencies(worktreePath: string) {
  const sourceSpaNodeModules = path.join(getDeveloperSpaPath(developerRepoPath), 'node_modules');
  const targetSpaNodeModules = path.join(getDeveloperSpaPath(worktreePath), 'node_modules');
  const sourceSpaBuild = path.join(getDeveloperSpaPath(developerRepoPath), 'build');
  const targetSpaBuild = path.join(getDeveloperSpaPath(worktreePath), 'build');

  try {
    await fs.access(targetSpaNodeModules);
  } catch {
    // Continue and wire the shared dependency folder in.
  }

  try {
    await fs.access(sourceSpaNodeModules);
  } catch {
    throw new Error(
      `SPA dependencies are missing at ${sourceSpaNodeModules}. Install them in the main repo before starting preview.`,
    );
  }

  try {
    await fs.access(targetSpaNodeModules);
  } catch {
    await fs.symlink(sourceSpaNodeModules, targetSpaNodeModules, 'dir');
  }

  try {
    await fs.access(targetSpaBuild);
  } catch {
    try {
      await fs.access(sourceSpaBuild);
    } catch {
      throw new Error(
        `SPA build artifacts are missing at ${sourceSpaBuild}. Build the main repo SPA before starting preview.`,
      );
    }

    await fs.symlink(sourceSpaBuild, targetSpaBuild, 'dir');
  }
}

async function stopActivePreviewProcess() {
  if (!activePreviewProcess) return;

  try {
    process.kill(-activePreviewProcess.pid, 'SIGTERM');
  } catch {
    try {
      process.kill(activePreviewProcess.pid, 'SIGTERM');
    } catch {
      // Ignore: the process may already be gone.
    }
  }

  activePreviewProcess = null;
}

async function clearPreviewPort(port: number) {
  const result = await runCommand('lsof', ['-ti', `:${port}`], { cwd: appRootDir });
  if (result.code !== 0 && result.code !== 1) {
    return;
  }

  const pids = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      // Ignore: the process may already be gone.
    }
  }

  if (pids.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function waitForPreview(url: string, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok || response.status < 500) {
        return;
      }
    } catch {
      // Server is still warming up.
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`Preview server did not become available at ${url} within ${timeoutMs / 1000}s.`);
}

async function warmDeveloperPreview(previewBaseUrl: string, previewUrl: string, previewStateCode: string | null) {
  const warmupTargets = [previewUrl];

  if (previewStateCode) {
    warmupTargets.push(`${previewBaseUrl}/mocks/documentsVerification/qle${previewStateCode}.json`);
  }

  await Promise.all(
    warmupTargets.map(async (target) => {
      try {
        await fetch(target, { method: 'GET' });
      } catch {
        // Best-effort warmup only. The actual preview can still succeed without this.
      }
    }),
  );
}

async function startDeveloperPreview(runId: string, stage: DeveloperStageResult) {
  const previewPort = 8888;
  const previewBaseUrl = `http://127.0.0.1:${previewPort}`;
  const previewUrl = `${previewBaseUrl}/mp/documents`;
  const spaPath = getDeveloperSpaPath(stage.worktreePath);
  const previewArgs = [
    'run',
    'start-frontend',
    '--',
    '--host',
    '127.0.0.1',
    '--strictPort',
    '--port',
    String(previewPort),
    '--open',
    'false',
  ];

  await ensurePreviewDependencies(stage.worktreePath);
  await stopActivePreviewProcess();
  await clearPreviewPort(previewPort);
  await fs.writeFile(stage.previewOutputLog, '');
  await fs.writeFile(stage.previewErrorLog, '');

  const outputStream = createWriteStream(stage.previewOutputLog, { flags: 'a' });
  const errorStream = createWriteStream(stage.previewErrorLog, { flags: 'a' });
  const child = spawn('npm', previewArgs, {
    cwd: spaPath,
    env: {
      ...process.env,
      BROWSER: 'none',
      PATH: process.env.PATH ?? '',
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(outputStream);
  child.stderr.pipe(errorStream);
  child.unref();
  activePreviewProcess = { pid: child.pid ?? 0, runId, url: previewUrl };

  await waitForPreview(previewUrl);
  await warmDeveloperPreview(previewBaseUrl, previewUrl, stage.previewStateCode);
  return previewUrl;
}

async function saveWorkbookToDesktopFormatted(fileName: string, buffer: Buffer) {
  const targetDir = formattedOutputDir;
  const safeFileName = path.basename(fileName).replace(/[^\w.\- ]+/g, '_');
  const targetPath = path.join(targetDir, safeFileName || 'formatted.xlsx');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}

function normalizeRemoteToHttps(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('git@bitbucket.org:')) {
    return `https://bitbucket.org/${trimmed
      .slice('git@bitbucket.org:'.length)
      .replace(/\.git$/, '')}`;
  }
  if (trimmed.startsWith('https://bitbucket.org/')) {
    return trimmed.replace(/\.git$/, '');
  }
  return null;
}

function extractBitbucketRepoSlug(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('git@bitbucket.org:')) {
    return trimmed.slice('git@bitbucket.org:'.length).replace(/\.git$/, '');
  }
  if (trimmed.startsWith('https://bitbucket.org/')) {
    return trimmed.slice('https://bitbucket.org/'.length).replace(/\.git$/, '');
  }
  return null;
}

function buildDeveloperPrTitle(jiraKey: string) {
  return `${jiraKey}: update QLE upload document flow`;
}

function buildDeveloperPrDescription(args: {
  prSummaryText?: string;
  uiCodeReviewSummary?: string;
}) {
  const sections: string[] = [];

  if (args.prSummaryText?.trim()) {
    sections.push(args.prSummaryText.trim());
  }

  if (args.uiCodeReviewSummary?.trim()) {
    sections.push(['## UI Code Review', '', args.uiCodeReviewSummary.trim()].join('\n'));
  }

  return sections.join('\n\n').trim();
}

async function buildDeveloperPrCreateUrl(
  branchName: string,
  options?: { title?: string; description?: string },
) {
  const remoteResult = await runCommand(
    'git',
    ['-C', developerRepoPath, 'remote', 'get-url', 'origin'],
    { cwd: developerRepoPath },
  );
  if (remoteResult.code !== 0) {
    return null;
  }

  const remoteUrl = normalizeRemoteToHttps(remoteResult.stdout.trim());
  if (!remoteUrl) {
    return null;
  }
  const repoSlug = extractBitbucketRepoSlug(remoteResult.stdout.trim());
  if (!repoSlug) {
    return null;
  }

  const baseBranchResult = await runCommand(
    'git',
    ['-C', developerRepoPath, 'symbolic-ref', 'refs/remotes/origin/HEAD'],
    { cwd: developerRepoPath },
  );
  const baseBranch = baseBranchResult.code === 0
    ? baseBranchResult.stdout.trim().split('/').pop() || 'master'
    : 'master';
  const params = new URLSearchParams({
    source: branchName,
    dest: `${repoSlug}::${baseBranch}`,
    event_source: 'branch_detail',
  });

  if (options?.title?.trim()) {
    params.set('title', options.title.trim());
  }
  if (options?.description?.trim()) {
    params.set('description', options.description.trim());
  }

  return `${remoteUrl}/pull-requests/new?${params.toString()}`;
}

async function buildDeveloperBranchBrowseUrl(branchName: string) {
  const remoteResult = await runCommand(
    'git',
    ['-C', developerRepoPath, 'remote', 'get-url', 'origin'],
    { cwd: developerRepoPath },
  );
  if (remoteResult.code !== 0) {
    return null;
  }

  const remoteUrl = normalizeRemoteToHttps(remoteResult.stdout.trim());
  if (!remoteUrl) {
    return null;
  }

  return `${remoteUrl}/branch/${encodeURIComponent(branchName)}`;
}

async function runDeveloperPostPushSkill(args: {
  worktreePath: string;
  skillPath: string;
  outputLog: string;
  errorLog: string;
  prompt: string;
}) {
  let result;
  try {
    result = await runCommand(
      cursorAgentBin,
      ['--trust', '-p', '--force', '--output-format', 'text', args.prompt],
      {
        cwd: args.worktreePath,
        stdoutLogPath: args.outputLog,
        stderrLogPath: args.errorLog,
        timeoutMs: cursorRunTimeoutMs,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cursor CLI failed to start.';
    await fs.writeFile(args.outputLog, '');
    await fs.writeFile(args.errorLog, message);
    return { ok: false, summary: '', error: message };
  }

  await fs.writeFile(args.outputLog, result.stdout);
  await fs.writeFile(args.errorLog, result.stderr);

  const summary = result.stdout.trim();
  if (result.code !== 0) {
    return {
      ok: false,
      summary,
      error: result.stderr.trim() || 'Cursor CLI run failed.',
    };
  }

  return { ok: true, summary, error: '' };
}

function eventHasWorkbookChanges(event: QleWorkbookModel['events'][number]) {
  return (
    Boolean(event.isNew) ||
    Boolean(event.isRemoved) ||
    event.enumRows.some((row) => Boolean(row.isNew)) ||
    event.categories.some(
      (category) =>
        Boolean(category.isNew) ||
        Boolean(category.isRemoved) ||
        category.documents.some((document) => Boolean(document.isNew) || Boolean(document.isRemoved)),
    )
  );
}

function buildDeveloperPreviewMock(model: QleWorkbookModel) {
  const changedEventRows = model.events.flatMap((event) => {
    if (!eventHasWorkbookChanges(event)) {
      return [];
    }

    const changedRows = event.enumRows.filter((row) => Boolean(row.isNew) || Boolean(event.isNew));
    const rowsToShow =
      changedRows.length > 0 ? changedRows : event.enumRows.length > 0 ? [event.enumRows[0]] : [];

    return rowsToShow.map((row) => ({
      event,
      row,
    }));
  });

  const previewRows =
    changedEventRows.length > 0
      ? changedEventRows
      : model.events.flatMap((event) =>
          event.enumRows.slice(0, 1).map((row) => ({
            event,
            row,
          })),
        );

  return {
    success: true,
    message: null,
    payload: {
      caseNumber: '100072500',
      applicants: previewRows.map(({ event, row }, index) => ({
        applicantGuid: `preview-applicant-${event.eventNumber}-${index + 1}`,
        sepEventId: 1000 + event.eventNumber,
        applicantEventId: 10000 + event.eventNumber * 10 + index,
        name: {
          firstName: `Event ${event.eventNumber}`,
          lastName: 'Preview',
          middleName: null,
          suffix: null,
        },
        event: row.enum,
        shouldResubmit: false,
        documents: [],
      })),
    },
  };
}

async function writeDeveloperPreviewMock(stage: DeveloperStageResult) {
  if (!stage.previewStateCode) {
    return;
  }

  const model = await importWorkbook(
    stage.workbookName,
    await fs.readFile(stage.workbookPath),
  );
  const mockPayload = buildDeveloperPreviewMock(model);
  const mockFile = path.join(
    getDeveloperSpaPath(stage.worktreePath),
    'mocks',
    'documentsVerification',
    `qle${stage.previewStateCode}.json`,
  );

  await fs.mkdir(path.dirname(mockFile), { recursive: true });
  await fs.writeFile(mockFile, `${JSON.stringify(mockPayload, null, 4)}\n`);
}

const workbookSchema: z.ZodType<QleWorkbookModel> = z.lazy(() =>
  z.object({
    id: z.string(),
    fileName: z.string(),
    sourceSheet: z.string(),
    importedAt: z.string(),
    events: z.array(
      z.object({
        id: z.string(),
        eventNumber: z.number(),
        instructionsEn: z.string(),
        instructionsEs: z.string(),
        isNew: z.boolean().optional(),
        manualIsNew: z.boolean().nullable().optional(),
        isRemoved: z.boolean().optional(),
        enumRows: z.array(
          z.object({
            id: z.string(),
            enum: z.string(),
            en: z.string(),
            es: z.string(),
            isNew: z.boolean().optional(),
            manualIsNew: z.boolean().nullable().optional(),
            isRemoved: z.boolean().optional(),
          }),
        ),
        categories: z.array(
          z.object({
            id: z.string(),
            enum: z.string(),
            en: z.string(),
            es: z.string(),
            validation: z.string(),
            isNew: z.boolean().optional(),
            manualIsNew: z.boolean().nullable().optional(),
            isRemoved: z.boolean().optional(),
            documents: z.array(
              z.object({
                id: z.string(),
                enum: z.string(),
                en: z.string(),
                es: z.string(),
                sort: z.number().nullable().optional(),
                isNew: z.boolean().optional(),
                manualIsNew: z.boolean().nullable().optional(),
                isRemoved: z.boolean().optional(),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
);

function buildJiraDraft(model: QleWorkbookModel, diffMarkdown: string): JiraDraft {
  const markedNewLines = buildMarkedNewLines(model);
  return {
    summary: `QLE update: ${model.fileName}`,
    description: [
      'Generated from the QLE dashboard.',
      '',
      `Source workbook: ${model.fileName}`,
      `Source sheet: ${model.sourceSheet}`,
      '',
      diffMarkdown,
      ...(markedNewLines.length
        ? ['', '## Workbook rows marked as new', '', ...markedNewLines]
        : []),
    ].join('\n'),
    attachmentName: buildVersionedFormattedName(model.fileName, 1),
  };
}

function buildMarkedNewLines(model: QleWorkbookModel): string[] {
  const lines: string[] = [];

  model.events.forEach((event) => {
    if (event.isNew) {
      lines.push(`- [new event] Event ${event.eventNumber}`);
    }
    if (event.isRemoved) {
      lines.push(`- [removed event] Event ${event.eventNumber}`);
    }

    event.enumRows.forEach((row) => {
      if (row.isNew) {
        lines.push(`- [new enum] Event ${event.eventNumber} > ${row.enum}`);
      }
      if (row.isRemoved) {
        lines.push(`- [removed enum] Event ${event.eventNumber} > ${row.enum}`);
      }
    });

    event.categories.forEach((category) => {
      if (category.isNew) {
        lines.push(`- [new category] Event ${event.eventNumber} > ${category.enum}`);
      }
      if (category.isRemoved) {
        lines.push(`- [removed category] Event ${event.eventNumber} > ${category.enum}`);
      }

      category.documents.forEach((document) => {
        if (document.isNew) {
          lines.push(
            `- [new document] Event ${event.eventNumber} > ${category.enum} > ${document.enum}`,
          );
        }
        if (document.isRemoved) {
          lines.push(
            `- [removed document] Event ${event.eventNumber} > ${category.enum} > ${document.enum}`,
          );
        }
      });
    });
  });

  return lines;
}

function buildAgentHandoff(
  bundleId: string,
  bundleDir: string,
  model: QleWorkbookModel,
  workbookName: string,
  versionNumber: number,
  jiraKey?: string,
): AgentHandoff {
  const recommendedSkill =
    developerSkillPath || 'Set DEVELOPER_SKILL_PATH to the formatted QLE skill.';

  return {
    schemaVersion: '1.0',
    bundleId,
    bundleDir,
    sourceWorkbook: model.fileName,
    workbookFile: workbookName,
    sourceSheet: model.sourceSheet,
    versionNumber,
    recommendedSkill,
    coordinatorPrompt:
      'Read the bundle artifacts, confirm the Jira/workbook context, run the QLE formatted Excel implementation skill, then hand off to review and git/PR agents.',
    trigger: {
      mode: jiraKey ? 'after_jira' : 'manual',
      jiraKey,
      bundleId,
    },
    artifacts: {
      workbook: workbookName,
      updateJson: 'qle-update.json',
      diffSummary: 'diff-summary.md',
      jiraPayload: 'jira-payload.json',
    },
    subagents: [
      {
        id: 'qle-implementation',
        name: 'QLE Implementation Agent',
        role: 'implementation',
        objective:
          'Apply the approved QLE workbook changes to the target codebase using the formatted Excel skill.',
        inputs: ['qle-update.json', workbookName, 'jira-payload.json'],
        outputs: ['repo changes', 'implementation notes'],
      },
      {
        id: 'qle-review',
        name: 'QLE Review Agent',
        role: 'review',
        objective:
          'Review the implementation for missing config, i18n, mock, and regression issues.',
        inputs: ['repo changes', 'diff-summary.md'],
        outputs: ['review findings', 'verification notes'],
      },
      {
        id: 'qle-git-pr',
        name: 'QLE Git and PR Agent',
        role: 'git',
        objective:
          'Prepare commit, push the branch, and produce the PR summary after approval.',
        inputs: ['repo changes', 'review findings'],
        outputs: ['commit metadata', 'PR summary'],
      },
    ],
  };
}

function buildLaunchPrompt(bundleDir: string) {
  return [
    `Use ${path.join(bundleDir, 'agent-handoff.json')} as the coordinator contract.`,
    'Load the referenced workbook, qle-update.json, diff-summary.md, and jira-payload.json.',
    'Run the QLE formatted Excel implementation workflow, then hand off to review and git/PR steps.',
  ].join(' ');
}

async function createDeveloperStagePackage(args: {
  jiraKey: string;
  workbookName: string;
  workbookBuffer: Buffer;
}): Promise<DeveloperStageResult> {
  const workbookStateCode = extractWorkbookStateCode(args.workbookName);
  const workbookState = workbookStateCode?.toLowerCase();
  const jiraStateCode = await inferJiraStateCode(args.jiraKey);
  const previewStateCode = jiraStateCode ?? workbookStateCode ?? null;
  const branchName = workbookState
    ? `${args.jiraKey.toLowerCase()}-qle-update-${workbookState}`
    : `${args.jiraKey.toLowerCase()}-qle-update`;
  const bundleId = `developer-${args.jiraKey.toLowerCase()}-${Date.now()}`;
  const bundleDir = path.join(bundlesDir, bundleId);
  await fs.mkdir(bundleDir, { recursive: true });

  const workbookName = path.basename(args.workbookName);
  const workbookPath = path.join(bundleDir, workbookName);
  const worktreePath = path.join(bundleDir, 'repo-worktree');
  const handoffFile = path.join(bundleDir, 'developer-handoff.json');
  const launchGuide = path.join(bundleDir, 'DEVELOPER_FLOW.md');
  const cursorOutputLog = path.join(bundleDir, 'cursor-output.log');
  const cursorErrorLog = path.join(bundleDir, 'cursor-error.log');
  const previewOutputLog = path.join(bundleDir, 'preview-output.log');
  const previewErrorLog = path.join(bundleDir, 'preview-error.log');
  const uiCodeReviewOutputLog = path.join(bundleDir, 'ui-code-review-output.log');
  const uiCodeReviewErrorLog = path.join(bundleDir, 'ui-code-review-error.log');
  const prSummaryOutputLog = path.join(bundleDir, 'pr-summary-output.log');
  const prSummaryErrorLog = path.join(bundleDir, 'pr-summary-error.log');
  const skillPath = developerSkillPath || 'Set DEVELOPER_SKILL_PATH to the formatted QLE skill.';
  const i18nRule = buildStateI18nRule(previewStateCode);

  await fs.writeFile(workbookPath, args.workbookBuffer);
  await fs.writeFile(cursorOutputLog, '');
  await fs.writeFile(cursorErrorLog, '');
  await fs.writeFile(previewOutputLog, '');
  await fs.writeFile(previewErrorLog, '');
  await fs.writeFile(uiCodeReviewOutputLog, '');
  await fs.writeFile(uiCodeReviewErrorLog, '');
  await fs.writeFile(prSummaryOutputLog, '');
  await fs.writeFile(prSummaryErrorLog, '');
  await fs.writeFile(
    handoffFile,
    JSON.stringify(
      {
        schemaVersion: '1.0',
        jiraKey: args.jiraKey,
        previewStateCode,
        branchName,
        workbookName,
        workbookPath,
        worktreePath,
        cursorOutputLog,
        cursorErrorLog,
        previewOutputLog,
        previewErrorLog,
        uiCodeReviewOutputLog,
        uiCodeReviewErrorLog,
        prSummaryOutputLog,
        prSummaryErrorLog,
        skillPath,
        expectedFlow: [
          'Read Jira and workbook context',
          'Create branch',
          'Run formatted QLE skill',
          'Open changes for user verification',
          'Commit and push after approval',
        ],
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    launchGuide,
    [
      '# Developer Flow',
      '',
      `Jira: ${args.jiraKey}`,
      `Preview state: ${previewStateCode ?? 'unknown'}`,
      `Branch: ${branchName}`,
      `Worktree: ${worktreePath}`,
      `Workbook: ${workbookPath}`,
      `Cursor output log: ${cursorOutputLog}`,
      `Cursor error log: ${cursorErrorLog}`,
      `Preview output log: ${previewOutputLog}`,
      `Preview error log: ${previewErrorLog}`,
      `UI code review output log: ${uiCodeReviewOutputLog}`,
      `UI code review error log: ${uiCodeReviewErrorLog}`,
      `PR summary output log: ${prSummaryOutputLog}`,
      `PR summary error log: ${prSummaryErrorLog}`,
      `Skill: ${skillPath}`,
      i18nRule,
      '',
      'Next step:',
      '1. Open the Jira.',
      '2. Use the workbook in this bundle.',
      '3. Run the formatted QLE skill.',
      '4. Review generated changes before commit and push.',
    ].join('\n'),
  );

  return {
    bundleId,
    bundleDir,
    jiraKey: args.jiraKey,
    workbookName,
    workbookPath,
    previewStateCode,
    branchName,
    worktreePath,
    handoffFile,
    launchGuide,
    cursorOutputLog,
    cursorErrorLog,
    previewOutputLog,
    previewErrorLog,
    uiCodeReviewOutputLog,
    uiCodeReviewErrorLog,
    prSummaryOutputLog,
    prSummaryErrorLog,
  };
}

async function executeDeveloperFlow(runId: string, stage: DeveloperStageResult) {
  try {
    assertDeveloperFlowConfigured();
    await appendDeveloperLog(stage.cursorOutputLog, `Developer Flow run ${runId} started for ${stage.jiraKey}.`);
    setDeveloperFlowStep(
      runId,
      'jiraAndWorkbook',
      'Running',
      'Checking Cursor CLI access, confirming Jira context, and deciding which workbook source to use.',
    );
    await appendDeveloperLog(stage.cursorOutputLog, 'Checking Cursor CLI availability.');

    let auth;
    try {
      auth = await runCommand(cursorAgentBin, ['--trust', '-p', 'Reply with exactly: Cursor CLI ready.'], {
        cwd: appRootDir,
        stdoutLogPath: stage.cursorOutputLog,
        stderrLogPath: stage.cursorErrorLog,
      });
    } catch (error) {
      throw new Error(
        `Cursor CLI is unavailable. Install it with \`curl -fsS https://cursor.com/install | bash\`, then rerun Developer Dashboard. ${
          error instanceof Error ? error.message : ''
        }`.trim(),
      );
    }

    if (auth.code !== 0) {
      throw new Error(
        auth.stderr ||
          auth.stdout ||
          'Cursor CLI is not ready. Open Cursor, sign in, confirm `cursor-agent` works in your terminal, then rerun Developer Dashboard.',
      );
    }

    setDeveloperFlowStep(
      runId,
      'jiraAndWorkbook',
      'Prepared',
      `Jira ${stage.jiraKey} is confirmed, workbook source is ${path.basename(stage.workbookPath)}, and the request is ready for worktree setup.`,
    );
    setDeveloperFlowStep(
      runId,
      'jiraAndWorkbook',
      'Completed',
      `Jira ${stage.jiraKey} is confirmed and workbook source ${path.basename(stage.workbookPath)} is ready.`,
    );
    setDeveloperFlowStep(
      runId,
      'createBranch',
      'Running',
      'Creating the isolated branch/worktree for implementation.',
    );

    setDeveloperFlowStep(
      runId,
      'createBranch',
      'Running',
      `Preparing isolated worktree for ${stage.branchName} so your main repo stays untouched.`,
    );
    await appendDeveloperLog(stage.cursorOutputLog, `Preparing isolated worktree ${stage.worktreePath}.`);
    await cleanupDeveloperWorktrees(stage.branchName, stage.worktreePath);
    const branchCheck = await runCommand(
      'git',
      ['-C', developerRepoPath, 'rev-parse', '--verify', stage.branchName],
      { cwd: developerRepoPath },
    );
    const baseRef = await resolveDeveloperBaseRef();
    const worktreeArgs =
      branchCheck.code === 0
        ? ['-C', developerRepoPath, 'worktree', 'add', stage.worktreePath, stage.branchName]
        : ['-C', developerRepoPath, 'worktree', 'add', '-b', stage.branchName, stage.worktreePath, baseRef];
    const worktreeCreate = await runCommand('git', worktreeArgs, { cwd: developerRepoPath });
    if (worktreeCreate.code !== 0) {
      throw new Error(
        worktreeCreate.stderr ||
          `Failed to create worktree ${stage.worktreePath} for ${stage.branchName}.`,
      );
    }
    setDeveloperFlowStep(
      runId,
      'createBranch',
      'Completed',
      `Branch ${stage.branchName} is ready in ${stage.worktreePath}${branchCheck.code === 0 ? '.' : ` from ${baseRef}.`}`,
    );
    await appendDeveloperLog(stage.cursorOutputLog, `Branch ${stage.branchName} is ready.`);
    await writeDeveloperPreviewMock(stage);
    await appendDeveloperLog(stage.previewOutputLog, `Preview mock prepared for ${stage.previewStateCode ?? 'unknown state'}.`);
    setDeveloperFlowStep(
      runId,
      'skillRun',
      'Running',
      'Running the formatted QLE skill with Cursor CLI and collecting reviewable changes.',
    );
    await appendDeveloperLog(stage.cursorOutputLog, 'Starting Cursor implementation run.');
    const i18nRule = buildStateI18nRule(stage.previewStateCode);

    const prompt = [
      `You are implementing Jira ${stage.jiraKey} in the repository ${stage.worktreePath}.`,
      `Read and follow the skill instructions in ${developerSkillPath}.`,
      `Use the workbook at ${stage.workbookPath} as the implementation source of truth for the requested changes.`,
      `Use Jira ${stage.jiraKey} only as ticket context and branch/commit reference for this run.`,
      i18nRule,
      'Implement only the Jira/workbook-requested deltas.',
      'Do not make opportunistic cleanup edits, wording tweaks, spacing fixes, copy corrections, or unrelated i18n changes.',
      'Do not modify unrelated nearby keys just because they appear in the same bundle or config section.',
      'If you notice an unrelated bug or stale translation, leave it untouched and mention it separately instead of editing it.',
      'Make the required code changes in the repo, but do not commit or push.',
      'After making changes, inspect the git diff and summarize what changed.',
      'Return a concise plain-text summary.',
    ].join(' ');

    let cursorRun;
    try {
      cursorRun = await runCommand(
        cursorAgentBin,
        ['--trust', '-p', '--force', '--output-format', 'text', prompt],
        {
          cwd: stage.worktreePath,
          stdoutLogPath: stage.cursorOutputLog,
          stderrLogPath: stage.cursorErrorLog,
          timeoutMs: cursorRunTimeoutMs,
        },
      );
    } catch (error) {
      throw new Error(
        `Cursor CLI failed to start. Confirm \`cursor-agent\` is installed and authenticated before rerunning Developer Dashboard. ${
          error instanceof Error ? error.message : ''
        }`.trim(),
      );
    }

    await appendDeveloperLog(stage.cursorOutputLog, `Cursor implementation run exited with code ${cursorRun.code}.`);

    const cursorSummary = cursorRun.stdout.trim();

    if (cursorRun.code !== 0) {
      throw new Error(
        cursorRun.stderr || cursorSummary || 'Cursor CLI run failed.',
      );
    }

    const changedFilesResult = await runCommand(
      'git',
      ['-C', stage.worktreePath, 'diff', '--name-only'],
      { cwd: stage.worktreePath },
    );
    const diffSummaryResult = await runCommand(
      'git',
      ['-C', stage.worktreePath, 'diff', '--stat'],
      { cwd: stage.worktreePath },
    );
    const detailedDiffResult = await runCommand(
      'git',
      ['-C', stage.worktreePath, 'diff', '--unified=3'],
      { cwd: stage.worktreePath },
    );

    const changedFiles = changedFilesResult.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    setDeveloperFlowStep(
      runId,
      'previewServer',
      'Running',
      'Starting the isolated preview server so visual review can happen in the generated worktree.',
    );
    const previewUrl = await startDeveloperPreview(runId, stage);

    updateDeveloperFlowRun(runId, (current) => ({
      ...current,
      overallState: 'awaiting_approval',
      changedFiles,
      changeRequestSummary: cursorSummary,
      diffSummary: diffSummaryResult.stdout.trim() || cursorSummary,
      detailedDiff: detailedDiffResult.stdout.trim(),
      previewUrl,
      steps: current.steps.map((step) => {
        if (step.key === 'skillRun') {
          return {
            ...step,
            state: 'Ready for review',
            detail:
              changedFiles.length > 0
                ? `Review ${changedFiles.length} changed file(s) before approval.`
                : 'Cursor CLI completed, but no changed files were detected.',
          };
        }
        if (step.key === 'previewServer') {
          return {
            ...step,
            state: 'Completed',
            detail: `Preview is ready at ${previewUrl}${stage.previewStateCode ? ` for ${stage.previewStateCode}` : ''}. Use it to visually verify the worktree changes.`,
          };
        }
        if (step.key === 'approvalAndPush') {
          return {
            ...step,
            state: 'Awaiting approval',
            detail: 'Review the changed files, diff summary, and preview, then approve to commit and push.',
          };
        }
        return step;
      }),
    }));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Developer Flow run failed unexpectedly.';
    await appendDeveloperLog(stage.cursorErrorLog, message);
    setDeveloperFlowFailure(runId, message);
  }
}

async function createBundlePackage(args: {
  original: QleWorkbookModel;
  edited: QleWorkbookModel;
  versionNumber: number;
  jiraKey?: string;
}): Promise<{
  bundleId: string;
  bundleDir: string;
  workbookName: string;
  diff: ReturnType<typeof diffWorkbooks>;
  jiraDraft: JiraDraft;
  handoffFile: string;
  launchGuide: string;
  launchPrompt: string;
}> {
  const diff = diffWorkbooks(args.original, args.edited);
  const workbookName = buildVersionedFormattedName(args.edited.fileName, args.versionNumber);
  const bundleId = workbookName
    .replace(/\.xlsx$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .toLowerCase();
  const bundleDir = path.join(bundlesDir, bundleId);
  await fs.mkdir(bundleDir, { recursive: true });

  const workbookBuffer = await exportWorkbook(args.edited);
  const diffMarkdown = diffToMarkdown(diff);
  const jiraDraft = buildJiraDraft(args.edited, diffMarkdown);
  const agentHandoff = buildAgentHandoff(
    bundleId,
    bundleDir,
    args.edited,
    workbookName,
    args.versionNumber,
    args.jiraKey,
  );
  const launchPrompt = buildLaunchPrompt(bundleDir);
  const launchGuide = path.join(bundleDir, 'LAUNCH_ENGINEERING_WORKFLOW.md');

  await Promise.all([
    fs.writeFile(path.join(bundleDir, 'qle-update.json'), JSON.stringify(args.edited, null, 2)),
    fs.writeFile(path.join(bundleDir, 'diff-summary.md'), diffMarkdown),
    fs.writeFile(path.join(bundleDir, 'jira-payload.json'), JSON.stringify(jiraDraft, null, 2)),
    fs.writeFile(path.join(bundleDir, 'agent-handoff.json'), JSON.stringify(agentHandoff, null, 2)),
    fs.writeFile(
      path.join(bundleDir, 'READY_FOR_ENGINEERING.md'),
      [
        '# Ready for Engineering',
        '',
        `Jira: ${args.jiraKey ?? 'Not provided'}`,
        `Bundle: ${bundleId}`,
        `Workbook: ${workbookName}`,
        '',
        'Use `agent-handoff.json` as the coordinator contract.',
      ].join('\n'),
    ),
    fs.writeFile(
      launchGuide,
      [
        '# Launch Engineering Workflow',
        '',
        'Use the following prompt with your coordinator agent or Cursor session:',
        '',
        '```text',
        launchPrompt,
        '```',
        '',
        `Bundle directory: ${bundleDir}`,
        `Handoff file: ${path.join(bundleDir, 'agent-handoff.json')}`,
      ].join('\n'),
    ),
    fs.writeFile(path.join(bundleDir, workbookName), workbookBuffer),
  ]);

  return {
    bundleId,
    bundleDir,
    workbookName,
    diff,
    jiraDraft,
    handoffFile: path.join(bundleDir, 'agent-handoff.json'),
    launchGuide,
    launchPrompt,
  };
}

function assertValidModel(model: QleWorkbookModel) {
  const issues = validateWorkbookModel(model);
  if (issues.length > 0) {
    throw new Error(`Workbook validation failed: ${issues[0]?.message}`);
  }
}

function toAdfDocument(text: string) {
  const lines = text.split('\n');
  return {
    version: 1,
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

function parseLabels(labels: string | undefined): string[] {
  return (labels ?? '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);
}

const stateCodeToName = {
  AL: 'ALABAMA',
  AK: 'ALASKA',
  AZ: 'ARIZONA',
  AR: 'ARKANSAS',
  CA: 'CALIFORNIA',
  CO: 'COLORADO',
  CT: 'CONNECTICUT',
  DE: 'DELAWARE',
  FL: 'FLORIDA',
  GA: 'GEORGIA',
  HI: 'HAWAII',
  ID: 'IDAHO',
  IL: 'ILLINOIS',
  IN: 'INDIANA',
  IA: 'IOWA',
  KS: 'KANSAS',
  KY: 'KENTUCKY',
  LA: 'LOUISIANA',
  ME: 'MAINE',
  MD: 'MARYLAND',
  MA: 'MASSACHUSETTS',
  MI: 'MICHIGAN',
  MN: 'MINNESOTA',
  MS: 'MISSISSIPPI',
  MO: 'MISSOURI',
  MT: 'MONTANA',
  NE: 'NEBRASKA',
  NV: 'NEVADA',
  NH: 'NEW HAMPSHIRE',
  NJ: 'NEW JERSEY',
  NM: 'NEW MEXICO',
  NY: 'NEW YORK',
  NC: 'NORTH CAROLINA',
  ND: 'NORTH DAKOTA',
  OH: 'OHIO',
  OK: 'OKLAHOMA',
  OR: 'OREGON',
  PA: 'PENNSYLVANIA',
  RI: 'RHODE ISLAND',
  SC: 'SOUTH CAROLINA',
  SD: 'SOUTH DAKOTA',
  TN: 'TENNESSEE',
  TX: 'TEXAS',
  UT: 'UTAH',
  VT: 'VERMONT',
  VA: 'VIRGINIA',
  WA: 'WASHINGTON',
  WV: 'WEST VIRGINIA',
  WI: 'WISCONSIN',
  WY: 'WYOMING',
  DC: 'DISTRICT OF COLUMBIA',
} as const;

type StateCode = keyof typeof stateCodeToName;

const stateCodes = Object.keys(stateCodeToName) as StateCode[];
const stateNameEntries = Object.entries(stateCodeToName) as Array<[StateCode, string]>;

function normalizeStateText(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function extractWorkbookStateCode(workbookName: string): StateCode | null {
  const normalized = normalizeStateText(path.basename(workbookName).replace(/\.[^.]+$/, ''));
  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (stateCodes.includes(token as StateCode)) {
      return token as StateCode;
    }
  }
  return null;
}

function extractStateCodesFromText(value: string): StateCode[] {
  const normalized = normalizeStateText(value);
  if (!normalized) return [];

  const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
  const matches = new Set<StateCode>();

  for (const code of stateCodes) {
    if (tokens.has(code)) {
      matches.add(code);
    }
  }

  for (const [code, name] of stateNameEntries) {
    const pattern = new RegExp(`(?:^| )${name}(?: |$)`);
    if (pattern.test(normalized)) {
      matches.add(code);
    }
  }

  return [...matches];
}

function extractTextFromJiraDescription(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextFromJiraDescription(item));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof record.text === 'string') {
      parts.push(record.text);
    }
    for (const nested of Object.values(record)) {
      parts.push(...extractTextFromJiraDescription(nested));
    }
    return parts;
  }
  return [];
}

async function inferJiraStateCode(jiraKey: string): Promise<StateCode | null> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const authHeaders = getJiraAuthHeaders();

  if (!baseUrl || authHeaders.length === 0) {
    return null;
  }

  let issue;
  try {
    issue = await jiraRequestJsonWithFallbacks<{
      fields?: {
        summary?: string;
        labels?: string[];
        components?: Array<{ name?: string }>;
        fixVersions?: Array<{ name?: string }>;
        description?: unknown;
      };
    }>(
      [
        `${baseUrl}/rest/api/3/issue/${encodeURIComponent(jiraKey)}?fields=summary,labels,components,fixVersions,description`,
        `${baseUrl}/rest/api/2/issue/${encodeURIComponent(jiraKey)}?fields=summary,labels,components,fixVersions,description`,
        `${baseUrl}/rest/api/latest/issue/${encodeURIComponent(jiraKey)}?fields=summary,labels,components,fixVersions,description`,
      ],
      authHeaders,
    );
  } catch {
    return null;
  }

  const summaryMatches = extractStateCodesFromText(issue.fields?.summary ?? '');
  if (summaryMatches.length === 1) {
    return summaryMatches[0];
  }

  const metadataValues = [
    issue.fields?.summary ?? '',
    ...(issue.fields?.labels ?? []),
    ...(issue.fields?.components?.map((component) => component.name ?? '') ?? []),
    ...(issue.fields?.fixVersions?.map((version) => version.name ?? '') ?? []),
    ...extractTextFromJiraDescription(issue.fields?.description),
  ];

  const metadataMatches = new Set<StateCode>();
  for (const value of metadataValues) {
    for (const code of extractStateCodesFromText(value)) {
      metadataMatches.add(code);
    }
  }

  return metadataMatches.size === 1 ? [...metadataMatches][0] : null;
}

async function assertDeveloperFlowStateAlignment(jiraKey: string, workbookName: string) {
  const workbookState = extractWorkbookStateCode(workbookName);
  if (!workbookState) {
    return;
  }

  const jiraState = await inferJiraStateCode(jiraKey);
  if (!jiraState || jiraState === workbookState) {
    return;
  }

  throw new Error(
    `Workbook ${path.basename(workbookName)} appears to be for ${workbookState}, but Jira ${jiraKey} appears to be for ${jiraState}. Upload the matching workbook or use the correct Jira issue.`,
  );
}

function getJiraAuthHeaders(): string[] {
  const email = process.env.JIRA_EMAIL?.trim();
  const apiToken = process.env.JIRA_API_TOKEN?.trim();
  const pat = process.env.JIRA_PAT?.trim() || process.env.JIRA_TOKEN?.trim();
  const headers: string[] = [];

  if (pat) {
    headers.push(`Bearer ${pat}`);
  }

  if (apiToken) {
    headers.push(`Bearer ${apiToken}`);
  }

  if (email && apiToken) {
    headers.push(`Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`);
  }

  return [...new Set(headers)];
}

async function jiraRequestJson<T>(url: string, authHeader: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatJiraErrorMessage(response.status, text, url));
  }
  return response.json() as Promise<T>;
}

function formatJiraErrorMessage(status: number, body: string, url: string): string {
  const trimmed = body.trim();
  const lower = trimmed.toLowerCase();
  if (status === 401 || lower.includes('<title>unauthorized') || lower.includes('unauthorized (401)')) {
    return 'Jira authentication failed (401 Unauthorized). Check JIRA_PAT or JIRA_API_TOKEN, and confirm the auth style matches your Jira server.';
  }
  if (status === 403 || lower.includes('<title>forbidden') || lower.includes('forbidden (403)')) {
    return 'Jira access was denied (403 Forbidden). Check Jira permissions for the configured account.';
  }
  if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || lower.includes('<head>')) {
    return `Jira request failed with HTTP ${status}. Jira returned an HTML error page instead of JSON.`;
  }
  return trimmed || `Jira request failed for ${url}.`;
}

function parseJiraJsonResponse<T>(body: string, url: string): T {
  const trimmed = body.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || lower.includes('<head>')) {
    throw new Error(`Jira returned an HTML page instead of JSON for ${url}. This usually means the token is not accepted for REST API access or Jira redirected to a login/SSO page.`);
  }
  return JSON.parse(trimmed) as T;
}

async function jiraRequestJsonWithFallbacks<T>(urls: string[], authHeaders: string[]): Promise<T> {
  let lastError: Error | null = null;
  for (const authHeader of authHeaders) {
    for (const url of urls) {
      try {
        return await jiraRequestJson<T>(url, authHeader);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }
  throw lastError ?? new Error('Jira request failed.');
}

async function buildJiraCreateUrl(args: {
  baseUrl: string;
  authHeader?: string;
  projectKey: string;
  issueType: string;
  summary: string;
  description: string;
  componentName?: string;
  fixVersionName?: string;
}): Promise<string> {
  const fallbackUrl = `${args.baseUrl}/secure/CreateIssue!default.jspa`;
  if (!args.authHeader) {
    return fallbackUrl;
  }

  try {
    const project = await jiraRequestJsonWithFallbacks<{
      id?: string;
      components?: Array<{ id?: string; name?: string }>;
      versions?: Array<{ id?: string; name?: string }>;
      issueTypes?: Array<{ id?: string; name?: string }>;
    }>(
      [
        `${args.baseUrl}/rest/api/3/project/${encodeURIComponent(args.projectKey)}`,
        `${args.baseUrl}/rest/api/2/project/${encodeURIComponent(args.projectKey)}`,
        `${args.baseUrl}/rest/api/latest/project/${encodeURIComponent(args.projectKey)}`,
      ],
      [args.authHeader],
    );

    const createMeta = await jiraRequestJsonWithFallbacks<{
      projects?: Array<{
        issuetypes?: Array<{ id?: string; name?: string }>;
      }>;
    }>(
      [
        `${args.baseUrl}/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(args.projectKey)}&expand=projects.issuetypes`,
        `${args.baseUrl}/rest/api/2/issue/createmeta?projectKeys=${encodeURIComponent(args.projectKey)}&expand=projects.issuetypes`,
        `${args.baseUrl}/rest/api/latest/issue/createmeta?projectKeys=${encodeURIComponent(args.projectKey)}&expand=projects.issuetypes`,
      ],
      [args.authHeader],
    );

    const params = new URLSearchParams();
    if (project.id) params.set('pid', project.id);

    const issueTypes = createMeta.projects?.[0]?.issuetypes ?? project.issueTypes ?? [];
    const issueType = issueTypes.find(
      (item) => item.name?.toLowerCase() === args.issueType.toLowerCase(),
    );
    if (issueType?.id) params.set('issuetype', issueType.id);

    const component = project.components?.find(
      (item) => item.name?.toLowerCase() === (args.componentName ?? '').toLowerCase(),
    );
    if (component?.id) params.set('components', component.id);

    const fixVersion = project.versions?.find(
      (item) => item.name?.toLowerCase() === (args.fixVersionName ?? '').toLowerCase(),
    );
    if (fixVersion?.id) {
      params.set('fixVersions', fixVersion.id);
      params.set('versions', fixVersion.id);
    }

    params.set('summary', args.summary);
    params.set('description', args.description);

    if (!params.get('pid') || !params.get('issuetype')) {
      return fallbackUrl;
    }

    return `${args.baseUrl}/secure/CreateIssueDetails!init.jspa?${params.toString()}`;
  } catch {
    return fallbackUrl;
  }
}


async function attachWorkbookToJira(
  issueKey: string,
  model: QleWorkbookModel,
  baseUrl: string,
  authHeaders: string[],
  versionNumber = 1,
) {
  const workbookBuffer = await exportWorkbook(model);
  const attachmentName = buildVersionedFormattedName(model.fileName, versionNumber);
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(workbookBuffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    attachmentName,
  );

  let lastError: Error | null = null;
  for (const authHeader of authHeaders) {
    const response = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/attachments`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
      body: form,
    });

    if (response.ok) {
      return;
    }

    const text = await response.text();
    lastError = new Error(
      formatJiraErrorMessage(
        response.status,
        text,
        `${baseUrl}/rest/api/3/issue/${issueKey}/attachments`,
      ),
    );
  }

  throw lastError ?? new Error(`Failed to attach workbook to Jira ${issueKey}.`);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, env: appEnv, developerFlowEnabled });
});

app.get('/api/app-config', (_req, res) => {
  res.json({
    env: appEnv,
    isProduction,
    developerFlowEnabled,
  });
});

app.get('/api/jira/config', (_req, res) => {
  res.json({
    baseUrl: process.env.JIRA_BASE_URL ?? '',
    projectKey: process.env.JIRA_PROJECT_KEY ?? '',
  });
});

const dbConfigSchema = z.object({
  host: z.string().trim(),
  port: z.coerce.number().int().positive(),
  database: z.string().trim(),
  user: z.string().trim(),
  password: z.string(),
  schema: z.string().trim().default('public'),
  ssl: z.boolean().default(false),
});

app.get('/api/db/config', (_req, res) => {
  const payload: DbConfigResponse = getDbConfigResponse();
  res.json(payload);
});

app.post('/api/db/config', async (req, res, next) => {
  try {
    const body = z
      .object({
        config: dbConfigSchema,
      })
      .parse(req.body);

    const config: DbConfig = {
      ...body.config,
      schema: body.config.schema || 'public',
    };
    await validateDbConnection(config);
    setRuntimeDbConfig(config);
    res.json(getDbConfigResponse());
  } catch (error) {
    next(error);
  }
});

app.post('/api/import-workbook', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Missing file upload.' });
      return;
    }
    const model = await importWorkbook(req.file.originalname, req.file.buffer);
    res.json(model);
  } catch (error) {
    next(error);
  }
});

app.post('/api/format-unformatted-workbook', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Missing file upload.' });
      return;
    }
    const formatted = await runFormatterTool({
      fileName: req.file.originalname,
      inputBuffer: req.file.buffer,
      rootDir: appRootDir,
    });
    const model = await importWorkbook(formatted.fileName, formatted.outputBuffer);
    const savedPath = await saveWorkbookToDesktopFormatted(
      formatted.fileName,
      formatted.outputBuffer,
    );

    res.json({
      fileName: formatted.fileName,
      savedPath,
      workbookBase64: formatted.outputBuffer.toString('base64'),
      model,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/developer-flow/stage', upload.single('file'), async (req, res, next) => {
  try {
    if (!requireDeveloperFlowEnabled(res)) return;
    const jiraKey = typeof req.body.jiraKey === 'string' ? req.body.jiraKey.trim().toUpperCase() : '';
    if (!jiraKey) {
      res.status(400).json({ error: 'Missing Jira key.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Upload a workbook for Developer Flow.' });
      return;
    }

    await assertDeveloperFlowStateAlignment(jiraKey, req.file.originalname);

    const payload = await createDeveloperStagePackage({
      jiraKey,
      workbookName: req.file.originalname,
      workbookBuffer: req.file.buffer,
    });

    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post('/api/developer-flow/run', upload.single('file'), async (req, res, next) => {
  try {
    if (!requireDeveloperFlowEnabled(res)) return;
    const jiraKey = typeof req.body.jiraKey === 'string' ? req.body.jiraKey.trim().toUpperCase() : '';
    if (!jiraKey) {
      res.status(400).json({ error: 'Missing Jira key.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Upload a workbook for Developer Flow.' });
      return;
    }

    await assertDeveloperFlowStateAlignment(jiraKey, req.file.originalname);

    const stage = await createDeveloperStagePackage({
      jiraKey,
      workbookName: req.file.originalname,
      workbookBuffer: req.file.buffer,
    });
    const runId = crypto.randomUUID();
    const status = createDeveloperFlowStatus({
      runId,
      jiraKey: stage.jiraKey,
      branchName: stage.branchName,
    });
    developerFlowRuns.set(runId, status);
    developerFlowRunStage.set(runId, stage);
    void executeDeveloperFlow(runId, stage);

    const result: DeveloperFlowRunResult = { runId, stage };
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/developer-flow/status/:runId', async (req, res, next) => {
  try {
    if (!requireDeveloperFlowEnabled(res)) return;
    const payload = developerFlowRuns.get(req.params.runId);
    if (!payload) {
      res.status(404).json({ error: 'Developer Flow run not found.' });
      return;
    }
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post('/api/developer-flow/approve', async (req, res, next) => {
  try {
    if (!requireDeveloperFlowEnabled(res)) return;
    const body = z.object({ runId: z.string().uuid() }).parse(req.body);
    const run = developerFlowRuns.get(body.runId);
    const stage = developerFlowRunStage.get(body.runId);
    if (!run) {
      res.status(404).json({ error: 'Developer Flow run not found.' });
      return;
    }
    if (!stage) {
      res.status(404).json({ error: 'Developer Flow stage data not found.' });
      return;
    }

    if (run.overallState === 'completed') {
      const current = developerFlowRuns.get(body.runId) ?? run;
      const result: DeveloperFlowApproveResult = {
        runId: body.runId,
        branchName: current.branchName,
        branchBrowseUrl: current.branchBrowseUrl,
        commitSha: undefined,
        pushed: true,
        prTitle: current.prTitle,
        prCreateUrl: current.prCreateUrl,
        uiCodeReviewSummary: current.uiCodeReviewSummary,
        prSummaryText: current.prSummaryText,
      };
      res.json(result);
      return;
    }

    if (run.overallState !== 'awaiting_approval' && run.overallState !== 'failed') {
      res.status(400).json({ error: 'Developer Flow is not ready for approval yet.' });
      return;
    }

    setDeveloperFlowStep(
      body.runId,
      'approvalAndPush',
      'Running',
      'Committing and pushing the approved implementation branch.',
    );
    updateDeveloperFlowRun(body.runId, (current) => ({
      ...current,
      overallState: 'running',
      error: undefined,
    }));

    const addResult = await runCommand('git', ['-C', stage.worktreePath, 'add', '-A'], {
      cwd: stage.worktreePath,
    });
    if (addResult.code !== 0) {
      throw new Error(addResult.stderr || 'Failed to stage git changes.');
    }

    const statusResult = await runCommand(
      'git',
      ['-C', stage.worktreePath, 'status', '--porcelain'],
      { cwd: stage.worktreePath },
    );
    if (statusResult.code !== 0) {
      throw new Error(statusResult.stderr || 'Failed to inspect git status before commit.');
    }

    const commitMessage = `${run.jiraKey}: update QLE upload document flow`;
    if (statusResult.stdout.trim()) {
      const commitResult = await runCommand(
        'git',
        ['-C', stage.worktreePath, 'commit', '--no-verify', '-m', commitMessage],
        { cwd: stage.worktreePath },
      );
      if (commitResult.code !== 0) {
        throw new Error(commitResult.stderr || 'Failed to create git commit.');
      }
    }

    const shaResult = await runCommand('git', ['-C', stage.worktreePath, 'rev-parse', 'HEAD'], {
      cwd: stage.worktreePath,
    });
    const pushResult = await runCommand(
      'git',
      ['-C', stage.worktreePath, 'push', '-u', 'origin', run.branchName],
      { cwd: stage.worktreePath },
    );
    if (pushResult.code !== 0) {
      throw new Error(pushResult.stderr || 'Failed to push git branch.');
    }

    const prTitle = buildDeveloperPrTitle(run.jiraKey);
    const branchBrowseUrl = await buildDeveloperBranchBrowseUrl(run.branchName);

    updateDeveloperFlowRun(body.runId, (current) => ({
      ...current,
      overallState: 'completed',
      branchBrowseUrl: branchBrowseUrl ?? undefined,
      prTitle,
      prCreateUrl: undefined,
      uiCodeReviewSummary: current.uiCodeReviewSummary,
      prSummaryText: current.prSummaryText,
      error: undefined,
      steps: current.steps.map((step) => {
        if (step.key === 'approvalAndPush') {
          return {
            ...step,
            state: 'Completed',
            detail: `Committed and pushed ${current.branchName}. You can create the PR next.`,
          };
        }
        if (step.key === 'createPr') {
          return {
            ...step,
            state: 'Ready',
            detail: 'Run UI code review and PR summary, then open the PR create page.',
          };
        }
        return step;
      }),
    }));

      const result: DeveloperFlowApproveResult = {
      runId: body.runId,
      branchName: run.branchName,
      branchBrowseUrl: branchBrowseUrl ?? undefined,
      commitSha: shaResult.stdout.trim(),
      pushed: true,
      prTitle,
    };
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Approval failed.';
    if (req.body && typeof req.body.runId === 'string') {
      setDeveloperFlowFailure(req.body.runId, message);
    }
    next(error);
  }
});

app.post('/api/developer-flow/create-pr', async (req, res, next) => {
  try {
    if (!requireDeveloperFlowEnabled(res)) return;
    const body = z.object({ runId: z.string().uuid() }).parse(req.body);
    const run = developerFlowRuns.get(body.runId);
    const stage = developerFlowRunStage.get(body.runId);
    if (!run) {
      res.status(404).json({ error: 'Developer Flow run not found.' });
      return;
    }
    if (!stage) {
      res.status(404).json({ error: 'Developer Flow stage data not found.' });
      return;
    }
    if (run.overallState !== 'completed' && run.overallState !== 'failed') {
      res.status(400).json({ error: 'Approve and push before creating the PR.' });
      return;
    }

    const prTitle = run.prTitle || buildDeveloperPrTitle(run.jiraKey);
    setDeveloperFlowStep(
      body.runId,
      'createPr',
      'Running',
      'Running ui-code-review and pr-summary, then preparing the Create PR page.',
    );
    updateDeveloperFlowRun(body.runId, (current) => ({
      ...current,
      overallState: 'running',
      prTitle,
      error: undefined,
    }));

    const worktreeUiCodeReviewSkillPath = path.join(
      stage.worktreePath,
      '.claude',
      'skills',
      'ui-code-review',
      'SKILL.md',
    );
    const worktreePrSummarySkillPath = path.join(
      stage.worktreePath,
      '.claude',
      'skills',
      'pr-summary',
      'SKILL.md',
    );
    const postPushWarnings: string[] = [];

    const uiCodeReviewPrompt = [
      `You are running the UI code review workflow in ${stage.worktreePath}.`,
      `Read and follow the skill instructions at ${worktreeUiCodeReviewSkillPath}.`,
      'Do not ask questions.',
      'Use Branch Review mode with base branch master and IDE output mode.',
      'Review the branch diff against origin/master and return concise findings or explicitly state that no findings were discovered.',
    ].join(' ');
    let uiCodeReviewSummary: string | undefined;
    try {
      const uiCodeReview = await runDeveloperPostPushSkill({
        worktreePath: stage.worktreePath,
        skillPath: worktreeUiCodeReviewSkillPath,
        outputLog: stage.uiCodeReviewOutputLog,
        errorLog: stage.uiCodeReviewErrorLog,
        prompt: uiCodeReviewPrompt,
      });
      uiCodeReviewSummary = uiCodeReview.summary || undefined;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'UI code review summary could not be generated.';
      postPushWarnings.push(`UI code review: ${message}`);
      uiCodeReviewSummary = `Unable to generate UI code review automatically. ${message}`;
    }

    const prSummaryPrompt = [
      `You are generating a pull request summary in ${stage.worktreePath}.`,
      `Read and follow the skill instructions at ${worktreePrSummarySkillPath}.`,
      'Do not ask questions.',
      'Use base branch master.',
      'Infer the change type from the diff, mark committed date as Not applicable, mark testing as No when it is not evidenced in the branch, and mark AI code review as Yes.',
      'Return only the final PR summary in markdown.',
    ].join(' ');
    let prSummaryText: string | undefined;
    try {
      const prSummary = await runDeveloperPostPushSkill({
        worktreePath: stage.worktreePath,
        skillPath: worktreePrSummarySkillPath,
        outputLog: stage.prSummaryOutputLog,
        errorLog: stage.prSummaryErrorLog,
        prompt: prSummaryPrompt,
      });
      prSummaryText = prSummary.summary || undefined;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'PR summary could not be generated.';
      postPushWarnings.push(`PR summary: ${message}`);
      prSummaryText = `Unable to generate PR summary automatically. ${message}`;
    }

    const prCreateUrl = await buildDeveloperPrCreateUrl(run.branchName);
    if (!prCreateUrl) {
      throw new Error('Failed to prepare the PR create URL.');
    }

    updateDeveloperFlowRun(body.runId, (current) => ({
      ...current,
      overallState: 'completed',
      prTitle,
      prCreateUrl,
      uiCodeReviewSummary,
      prSummaryText,
      error: postPushWarnings.length > 0 ? postPushWarnings.join(' ') : undefined,
      steps: current.steps.map((step) => {
        if (step.key === 'createPr') {
          return {
            ...step,
            state: 'Completed',
            detail:
              'UI code review and PR summary are ready. Open the Create PR page and copy any text you need.' +
              (postPushWarnings.length > 0 ? ` Warnings: ${postPushWarnings.join(' ')}` : ''),
          };
        }
        return step;
      }),
    }));

    const result: DeveloperFlowCreatePrResult = {
      runId: body.runId,
      branchName: run.branchName,
      prTitle,
      prCreateUrl,
      uiCodeReviewSummary,
      prSummaryText,
    };
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Create PR failed.';
    if (req.body && typeof req.body.runId === 'string') {
      setDeveloperFlowFailure(req.body.runId, message);
    }
    next(error);
  }
});

app.post('/api/diff', async (req, res, next) => {
  try {
    const body = z
      .object({
        original: workbookSchema,
        edited: workbookSchema,
      })
      .parse(req.body);
    res.json(diffWorkbooks(body.original, body.edited));
  } catch (error) {
    next(error);
  }
});

app.post('/api/validate-workbook', async (req, res, next) => {
  try {
    const model = workbookSchema.parse(req.body.model);
    const issues = validateWorkbookModel(model);
    res.json({ valid: issues.length === 0, issues });
  } catch (error) {
    next(error);
  }
});

app.post('/api/db/check-events', async (req, res, next) => {
  try {
    const model = workbookSchema.parse(req.body.model);
    res.json(await checkEventsAgainstDb(model));
  } catch (error) {
    next(error);
  }
});

app.get('/api/db/event-options', async (req, res, next) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(await searchDbEventOptions(query));
  } catch (error) {
    next(error);
  }
});

app.post('/api/export-workbook', async (req, res, next) => {
  try {
    const body = z
      .object({
        model: workbookSchema,
        versionNumber: z.number().int().positive().optional(),
      })
      .parse(req.body);
    const model = body.model;
    assertValidModel(model);
    const buffer = await exportWorkbook(model);
    const fileName = buildVersionedFormattedName(model.fileName, body.versionNumber ?? 1);
    const savedPath = await saveWorkbookToDesktopFormatted(fileName, buffer);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('X-Saved-Path', savedPath);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

app.post('/api/bundles', async (req, res, next) => {
  try {
    const body = z
      .object({
        original: workbookSchema,
        edited: workbookSchema,
        title: z.string().optional(),
        versionNumber: z.number().int().positive().optional(),
      })
      .parse(req.body);
    assertValidModel(body.edited);
    const payload = await createBundlePackage({
      original: body.original,
      edited: body.edited,
      versionNumber: body.versionNumber ?? 1,
    });

    res.json({
      bundleId: payload.bundleId,
      bundleDir: payload.bundleDir,
      workbookName: payload.workbookName,
      diff: payload.diff,
      jiraDraft: payload.jiraDraft,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/ready-for-engineering', async (req, res, next) => {
  try {
    const body = z
      .object({
        original: workbookSchema,
        edited: workbookSchema,
        jiraKey: z.string().min(1),
        versionNumber: z.number().int().positive().optional(),
      })
      .parse(req.body);
    assertValidModel(body.edited);
    const payload = await createBundlePackage({
      original: body.original,
      edited: body.edited,
      versionNumber: body.versionNumber ?? 1,
      jiraKey: body.jiraKey,
    });

    const result: ReadyForEngineeringResult = {
      bundleId: payload.bundleId,
      bundleDir: payload.bundleDir,
      workbookName: payload.workbookName,
      handoffFile: payload.handoffFile,
      jiraKey: body.jiraKey,
      launchGuide: payload.launchGuide,
      launchPrompt: payload.launchPrompt,
    };
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/jira/draft', async (req, res, next) => {
  try {
    const body = z
      .object({
        original: workbookSchema,
        edited: workbookSchema,
      })
      .parse(req.body);
    assertValidModel(body.edited);
    const diff = diffWorkbooks(body.original, body.edited);
    res.json(buildJiraDraft(body.edited, diffToMarkdown(diff)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/jira/create', async (req, res, next) => {
  try {
    const body = z
      .object({
        summary: z.string(),
        description: z.string(),
        issueType: z.string().default('Task'),
        assigneeAccountId: z.string().optional(),
        fixVersionName: z.string().optional(),
        labels: z.string().optional(),
        componentName: z.string().optional(),
      })
      .parse(req.body);

    const baseUrl = process.env.JIRA_BASE_URL;
    const authHeaders = getJiraAuthHeaders();
    const projectKey = process.env.JIRA_PROJECT_KEY;

    if (!baseUrl || authHeaders.length === 0 || !projectKey) {
      res.status(400).json({
        error:
          'Missing Jira configuration. Set JIRA_BASE_URL, JIRA_PROJECT_KEY, and either JIRA_PAT/JIRA_TOKEN or JIRA_EMAIL with JIRA_API_TOKEN.',
      });
      return;
    }

    const issuePayload = JSON.stringify({
      fields: {
        project: { key: projectKey },
        summary: body.summary,
        description: toAdfDocument(body.description),
        issuetype: { name: body.issueType || 'Task' },
        labels: parseLabels(body.labels),
        ...(body.assigneeAccountId ? { assignee: { accountId: body.assigneeAccountId } } : {}),
        ...(body.fixVersionName ? { fixVersions: [{ name: body.fixVersionName }] } : {}),
        ...(body.componentName ? { components: [{ name: body.componentName }] } : {}),
      },
    });

    let response: Response | null = null;
    let lastError = '';
    for (const authHeader of authHeaders) {
      response = await fetch(`${baseUrl}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: issuePayload,
      });

      if (response.ok) {
        break;
      }

      const text = await response.text();
      lastError = formatJiraErrorMessage(response.status, text, `${baseUrl}/rest/api/3/issue`);
      response = null;
    }

    if (!response) {
      res.status(502).json({ error: lastError || 'Failed to create Jira issue.' });
      return;
    }

    const responseText = await response.text();
    const jiraResponse = parseJiraJsonResponse<{ key: string; self?: string }>(
      responseText,
      `${baseUrl}/rest/api/3/issue`,
    );
    const payload: JiraCreateResult = {
      key: jiraResponse.key,
      self: jiraResponse.self,
      browseUrl: `${baseUrl}/browse/${jiraResponse.key}`,
    };
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post('/api/jira/create-link', async (req, res, next) => {
  try {
    const body = z
      .object({
        summary: z.string().min(1),
        description: z.string().min(1),
        issueType: z.string().default('Task'),
        componentName: z.string().optional(),
        fixVersionName: z.string().optional(),
      })
      .parse(req.body);

    const baseUrl = process.env.JIRA_BASE_URL;
    const projectKey = process.env.JIRA_PROJECT_KEY;
    const authHeaders = getJiraAuthHeaders();

    if (!baseUrl || !projectKey) {
      res.status(400).json({
        error: 'Missing Jira configuration. Set JIRA_BASE_URL and JIRA_PROJECT_KEY.',
      });
      return;
    }

    const authHeader = authHeaders[0];

    const url = await buildJiraCreateUrl({
      baseUrl,
      authHeader,
      projectKey,
      issueType: body.issueType,
      summary: body.summary,
      description: body.description,
      componentName: body.componentName,
      fixVersionName: body.fixVersionName,
    });

    res.json({ url });
  } catch (error) {
    next(error);
  }
});

app.post('/api/jira/attach-workbook', async (req, res, next) => {
  try {
    const body = z
      .object({
        issueKey: z.string(),
        model: workbookSchema,
        versionNumber: z.number().int().positive().optional(),
      })
      .parse(req.body);
    assertValidModel(body.model);

    const baseUrl = process.env.JIRA_BASE_URL;
    const authHeaders = getJiraAuthHeaders();

    if (!baseUrl || authHeaders.length === 0) {
      res.status(400).json({
        error: 'Missing Jira configuration. Set JIRA_BASE_URL and either JIRA_PAT/JIRA_TOKEN or JIRA_EMAIL with JIRA_API_TOKEN.',
      });
      return;
    }

    await attachWorkbookToJira(
      body.issueKey,
      body.model,
      baseUrl,
      authHeaders,
      body.versionNumber ?? 1,
    );

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

if (hasBuiltClient()) {
  app.use(express.static(clientDistDir));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(clientIndexPath);
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unknown server error';
  res.status(500).json({ error: message });
});

async function startServer() {
  await ensureRuntimeDirectories();

  if (isProduction && !hasBuiltClient()) {
    console.warn(
      `Built client assets were not found at ${clientDistDir}. Run "npm run build" before starting the production server.`,
    );
  }

  app.listen(port, () => {
    console.log(`QLE server listening on http://localhost:${port} (${appEnv})`);
  });
}

void startServer().catch((error) => {
  console.error('Failed to start QLE server.', error);
  process.exit(1);
});
