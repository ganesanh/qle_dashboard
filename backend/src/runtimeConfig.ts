import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveAppRootDir() {
  const explicitRoot = process.env.APP_ROOT_DIR?.trim();
  const candidates = [
    explicitRoot ? path.resolve(explicitRoot) : null,
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..'),
    process.cwd(),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  }

  return process.cwd();
}

function resolvePathFromEnv(envValue: string | undefined, fallback: string) {
  const value = envValue?.trim();
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(appRootDir, value);
}

function toBoolean(value: string | undefined, fallback = false) {
  if (!value) return fallback;
  return value.trim().toLowerCase() === 'true';
}

export const appRootDir = resolveAppRootDir();
export const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
export const appEnv = process.env.APP_ENV?.trim() || nodeEnv;
export const isProduction = nodeEnv === 'production';
export const port = Number(process.env.PORT ?? 8787);

export const storageDir = resolvePathFromEnv(process.env.STORAGE_DIR, path.join(appRootDir, 'storage'));
export const bundlesDir = resolvePathFromEnv(
  process.env.BUNDLES_DIR,
  path.join(storageDir, 'bundles'),
);
export const formattedOutputDir = resolvePathFromEnv(
  process.env.FORMATTED_OUTPUT_DIR,
  path.join(storageDir, 'formatted'),
);
export const logsDir = path.join(storageDir, 'logs');
export const uploadsDir = path.join(storageDir, 'uploads');
export const tmpDir = path.join(storageDir, 'tmp');

export const clientDistDir = path.join(appRootDir, 'dist', 'client');
export const clientIndexPath = path.join(clientDistDir, 'index.html');

export const developerFlowEnabled = toBoolean(process.env.ENABLE_DEVELOPER_FLOW, false);
export const developerRepoPath = process.env.DEVELOPER_REPO_PATH?.trim() || '';
export const developerSpaRelativePath =
  process.env.DEVELOPER_SPA_RELATIVE_PATH?.trim() ||
  path.join('ghix-web', 'src', 'main', 'webapp', 'resources', 'spa');
export const developerSkillPath = process.env.DEVELOPER_SKILL_PATH?.trim() || '';
export const cursorAgentBin = process.env.CURSOR_AGENT_BIN?.trim() || 'cursor-agent';
export const cursorRunTimeoutMs = Number(process.env.CURSOR_RUN_TIMEOUT_MS ?? 20 * 60 * 1000);

export async function ensureRuntimeDirectories() {
  await Promise.all([
    fs.mkdir(storageDir, { recursive: true }),
    fs.mkdir(bundlesDir, { recursive: true }),
    fs.mkdir(formattedOutputDir, { recursive: true }),
    fs.mkdir(logsDir, { recursive: true }),
    fs.mkdir(uploadsDir, { recursive: true }),
    fs.mkdir(tmpDir, { recursive: true }),
  ]);
}

export function hasBuiltClient() {
  return existsSync(clientIndexPath);
}
