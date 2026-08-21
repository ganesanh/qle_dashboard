import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import type {
  IntegrationConnectionStatus,
  IntegrationStatusResponse,
  OAuthProvider,
} from '../../shared/types.js';

type OAuthState = {
  provider: OAuthProvider;
  sessionId: string;
  expiresAt: number;
};

type StoredConnection = {
  provider: OAuthProvider;
  connectedAt: string;
  accountLabel?: string;
  scopes: string[];
  token: string;
};

type TokenStore = {
  sessions: Record<string, Partial<Record<OAuthProvider, StoredConnection>>>;
};

type ProviderConfig = {
  provider: OAuthProvider;
  label: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  missingConfig: string[];
};

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  scopes?: string;
  token_type?: string;
};

const cookieName = 'qle_sid';
const stateTtlMs = 10 * 60 * 1000;
const oauthStates = new Map<string, OAuthState>();

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function resolveAppBaseUrl(req: Request): string {
  const configured = readEnv('APP_BASE_URL') || readEnv('PUBLIC_APP_URL');
  if (configured) return configured.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto']?.toString().split(',')[0]?.trim() || req.protocol;
  const host = req.headers['x-forwarded-host']?.toString().split(',')[0]?.trim() || req.get('host');
  return `${proto}://${host}`;
}

function providerConfigs(req: Request): Record<OAuthProvider, ProviderConfig> {
  const baseUrl = resolveAppBaseUrl(req);
  const atlassianRedirectUri =
    readEnv('ATLASSIAN_REDIRECT_URI') || `${baseUrl}/api/oauth/atlassian/callback`;
  const bitbucketRedirectUri =
    readEnv('BITBUCKET_REDIRECT_URI') || `${baseUrl}/api/oauth/bitbucket/callback`;
  const atlassianClientId = readEnv('ATLASSIAN_CLIENT_ID');
  const atlassianClientSecret = readEnv('ATLASSIAN_CLIENT_SECRET');
  const bitbucketClientId = readEnv('BITBUCKET_CLIENT_ID');
  const bitbucketClientSecret = readEnv('BITBUCKET_CLIENT_SECRET');

  return {
    atlassian: {
      provider: 'atlassian',
      label: 'Jira & Confluence',
      clientId: atlassianClientId,
      clientSecret: atlassianClientSecret,
      redirectUri: atlassianRedirectUri,
      scopes: [
        'offline_access',
        'read:me',
        'read:jira-work',
        'write:jira-work',
        'read:confluence-content.all',
        'write:confluence-content',
      ],
      missingConfig: [
        atlassianClientId ? '' : 'ATLASSIAN_CLIENT_ID',
        atlassianClientSecret ? '' : 'ATLASSIAN_CLIENT_SECRET',
      ].filter(Boolean),
    },
    bitbucket: {
      provider: 'bitbucket',
      label: 'Bitbucket',
      clientId: bitbucketClientId,
      clientSecret: bitbucketClientSecret,
      redirectUri: bitbucketRedirectUri,
      scopes: ['repository', 'pullrequest', 'account'],
      missingConfig: [
        bitbucketClientId ? '' : 'BITBUCKET_CLIENT_ID',
        bitbucketClientSecret ? '' : 'BITBUCKET_CLIENT_SECRET',
      ].filter(Boolean),
    },
  };
}

function getSessionSecret(): string {
  return readEnv('SESSION_SECRET') || readEnv('OAUTH_SESSION_SECRET');
}

function signSession(sessionId: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(sessionId).digest('base64url');
}

function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...rest] = part.split('=');
        return [decodeURIComponent(key), decodeURIComponent(rest.join('='))];
      }),
  );
}

function readSessionId(req: Request): string | null {
  const value = parseCookies(req.headers.cookie)[cookieName];
  if (!value) return null;
  const [sessionId, signature] = value.split('.');
  if (!sessionId || !signature || !getSessionSecret()) return null;
  const expected = signSession(sessionId);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return null;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer) ? sessionId : null;
}

export function getOrCreateOAuthSession(req: Request, res: Response): string {
  const existing = readSessionId(req);
  if (existing) return existing;
  const sessionId = crypto.randomUUID();
  const signed = `${sessionId}.${signSession(sessionId)}`;
  res.cookie(cookieName, signed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: '/',
  });
  return sessionId;
}

function encryptionSecret(): string {
  return readEnv('OAUTH_TOKEN_ENCRYPTION_KEY');
}

function encryptionReady(): boolean {
  return Boolean(encryptionSecret());
}

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(encryptionSecret()).digest();
}

function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

function tokenStorePath(storageDir: string): string {
  return path.join(storageDir, 'oauth-connections.enc.json');
}

async function readStore(storageDir: string): Promise<TokenStore> {
  try {
    const raw = await fs.readFile(tokenStorePath(storageDir), 'utf8');
    return JSON.parse(raw) as TokenStore;
  } catch {
    return { sessions: {} };
  }
}

async function writeStore(storageDir: string, store: TokenStore) {
  await fs.mkdir(storageDir, { recursive: true });
  await fs.writeFile(tokenStorePath(storageDir), JSON.stringify(store, null, 2));
}

function connectionStatus(
  config: ProviderConfig,
  connection: StoredConnection | undefined,
): IntegrationConnectionStatus {
  const missingConfig = [...config.missingConfig];
  if (!getSessionSecret()) missingConfig.push('SESSION_SECRET');
  if (!encryptionReady()) missingConfig.push('OAUTH_TOKEN_ENCRYPTION_KEY');
  return {
    provider: config.provider,
    label: config.label,
    configured: missingConfig.length === 0,
    connected: Boolean(connection),
    connectedAt: connection?.connectedAt,
    accountLabel: connection?.accountLabel,
    scopes: connection?.scopes ?? config.scopes,
    missingConfig,
  };
}

export async function getIntegrationStatus(
  req: Request,
  res: Response,
  storageDir: string,
): Promise<IntegrationStatusResponse> {
  const sessionId = getOrCreateOAuthSession(req, res);
  const store = await readStore(storageDir);
  const sessionConnections = store.sessions[sessionId] ?? {};
  const configs = providerConfigs(req);
  return {
    sessionReady: Boolean(getSessionSecret()),
    encryptionReady: encryptionReady(),
    providers: [
      connectionStatus(configs.atlassian, sessionConnections.atlassian),
      connectionStatus(configs.bitbucket, sessionConnections.bitbucket),
    ],
  };
}

export function buildOAuthAuthorizeUrl(req: Request, res: Response, provider: OAuthProvider): string {
  const sessionId = getOrCreateOAuthSession(req, res);
  const config = providerConfigs(req)[provider];
  if (config.missingConfig.length > 0 || !getSessionSecret()) {
    throw new Error(`OAuth provider ${provider} is not configured.`);
  }
  const state = crypto.randomBytes(24).toString('base64url');
  oauthStates.set(state, {
    provider,
    sessionId,
    expiresAt: Date.now() + stateTtlMs,
  });

  if (provider === 'atlassian') {
    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: config.clientId,
      scope: config.scopes.join(' '),
      redirect_uri: config.redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
    });
    return `https://auth.atlassian.com/authorize?${params.toString()}`;
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    state,
  });
  return `https://bitbucket.org/site/oauth2/authorize?${params.toString()}`;
}

async function exchangeAtlassianCode(config: ProviderConfig, code: string): Promise<OAuthTokenResponse> {
  const response = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!response.ok) {
    throw new Error(`Atlassian OAuth token exchange failed with HTTP ${response.status}.`);
  }
  return response.json() as Promise<OAuthTokenResponse>;
}

async function exchangeBitbucketCode(config: ProviderConfig, code: string): Promise<OAuthTokenResponse> {
  const response = await fetch('https://bitbucket.org/site/oauth2/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!response.ok) {
    throw new Error(`Bitbucket OAuth token exchange failed with HTTP ${response.status}.`);
  }
  return response.json() as Promise<OAuthTokenResponse>;
}

async function fetchAccountLabel(provider: OAuthProvider, accessToken: string): Promise<string | undefined> {
  const url =
    provider === 'atlassian'
      ? 'https://api.atlassian.com/me'
      : 'https://api.bitbucket.org/2.0/user';
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) return undefined;
  const payload = (await response.json()) as {
    name?: string;
    displayName?: string;
    display_name?: string;
    email?: string;
    nickname?: string;
  };
  return payload.name ?? payload.displayName ?? payload.display_name ?? payload.email ?? payload.nickname;
}

export async function completeOAuthCallback(
  req: Request,
  res: Response,
  storageDir: string,
  provider: OAuthProvider,
) {
  if (!encryptionReady()) {
    throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY must be configured before storing OAuth tokens.');
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!code || !state) {
    throw new Error('OAuth callback is missing code or state.');
  }
  const stateRecord = oauthStates.get(state);
  oauthStates.delete(state);
  if (!stateRecord || stateRecord.provider !== provider || stateRecord.expiresAt < Date.now()) {
    throw new Error('OAuth state is invalid or expired.');
  }

  const config = providerConfigs(req)[provider];
  const token =
    provider === 'atlassian'
      ? await exchangeAtlassianCode(config, code)
      : await exchangeBitbucketCode(config, code);
  const accountLabel = token.access_token
    ? await fetchAccountLabel(provider, token.access_token).catch(() => undefined)
    : undefined;

  const scopes = (token.scope ?? token.scopes ?? config.scopes.join(' ')).split(/\s+/).filter(Boolean);
  const store = await readStore(storageDir);
  store.sessions[stateRecord.sessionId] = {
    ...(store.sessions[stateRecord.sessionId] ?? {}),
    [provider]: {
      provider,
      connectedAt: new Date().toISOString(),
      accountLabel,
      scopes,
      token: encryptJson(token),
    },
  };
  await writeStore(storageDir, store);
}

export async function disconnectIntegration(
  req: Request,
  res: Response,
  storageDir: string,
  provider: OAuthProvider,
) {
  const sessionId = getOrCreateOAuthSession(req, res);
  const store = await readStore(storageDir);
  if (store.sessions[sessionId]) {
    delete store.sessions[sessionId][provider];
    await writeStore(storageDir, store);
  }
}

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === 'atlassian' || value === 'bitbucket';
}
