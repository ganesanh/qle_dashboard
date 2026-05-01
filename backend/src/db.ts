import { Pool } from 'pg';
import type {
  DbConfig,
  DbEventCheckResult,
  DbConfigResponse,
  DbEventLookup,
  DbEventOption,
  MissingDbEvent,
  QleWorkbookModel,
} from '../../shared/types.js';
import { collectEventEnums } from '../../shared/validation.js';

let pool: Pool | null = null;
let activePoolKey = '';
let runtimeConfig: DbConfig | null = null;

function buildEnvConfig(): DbConfig | null {
  const host = (process.env.DB_HOST ?? process.env.PGHOST ?? '').trim();
  const port = Number(process.env.DB_PORT ?? process.env.PGPORT ?? 5444);
  const database = (process.env.DB_NAME ?? process.env.PGDATABASE ?? '').trim();
  const user = (process.env.DB_USER ?? process.env.PGUSER ?? '').trim();
  const password = process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? '';
  const schema = (process.env.DB_SCHEMA ?? 'public').trim() || 'public';
  const sslMode = (process.env.DB_SSL ?? 'false').toLowerCase();

  if (!host || !database || !user || !password) {
    return null;
  }

  return {
    host,
    port,
    database,
    user,
    password,
    schema,
    ssl: sslMode === 'true',
  };
}

function getConfig(): DbConfig | null {
  return runtimeConfig ?? buildEnvConfig();
}

function resetPool() {
  if (pool) {
    void pool.end().catch(() => {});
  }
  pool = null;
  activePoolKey = '';
}

function getPool(config: DbConfig) {
  const nextKey = JSON.stringify({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    schema: config.schema,
    ssl: config.ssl,
  });

  if (!pool || activePoolKey !== nextKey) {
    resetPool();
    pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
    activePoolKey = nextKey;
  }
  return pool;
}

export function getDbConfigResponse(): DbConfigResponse {
  const config = getConfig();
  return {
    configured: Boolean(config),
    config: config ?? {
      host: '',
      port: 5444,
      database: '',
      user: '',
      password: '',
      schema: 'public',
      ssl: false,
    },
  };
}

export function setRuntimeDbConfig(config: DbConfig | null) {
  runtimeConfig = config;
  resetPool();
}

export async function validateDbConnection(config: DbConfig): Promise<void> {
  const probePool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  try {
    const client = await probePool.connect();
    try {
      await client.query(`select 1 from ${config.schema}.sep_enrollment_events limit 1`);
    } finally {
      client.release();
    }
  } finally {
    await probePool.end().catch(() => {});
  }
}

export async function checkEventsAgainstDb(model: QleWorkbookModel): Promise<DbEventCheckResult> {
  const config = getConfig();
  if (!config) {
    return {
      configured: false,
      found: [],
      missing: [],
      errors: ['Database lookup is not configured. Set DB host, port, name, user, password, and schema in PM Dashboard settings.'],
    };
  }

  const eventRows = collectEventEnums(model).filter((row) => row.enum);
  if (eventRows.length === 0) {
    return {
      configured: true,
      found: [],
      missing: [],
      errors: [],
    };
  }

  const eventNames = [...new Set(eventRows.map((row) => row.enum))];
  const client = await getPool(config).connect();

  try {
    const query = `
      select distinct on (event_name, event_label)
        event_name,
        event_label,
        id
      from ${config.schema}.sep_enrollment_events
      where event_name = any($1::text[])
      order by event_name, event_label, id desc
    `;

    const result = await client.query(query, [eventNames]);
    const found = result.rows.map((row) => ({
      eventName: String(row.event_name),
      eventLabel: String(row.event_label),
      id: row.id,
    })) satisfies DbEventLookup[];

    const foundSet = new Set(found.map((row) => row.eventName));
    const missing = eventRows
      .filter((row) => !foundSet.has(row.enum))
      .map((row) => ({
        eventNumber: row.eventNumber,
        eventName: row.enum,
        englishLabel: row.en,
      })) satisfies MissingDbEvent[];

    return {
      configured: true,
      found,
      missing,
      errors: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database lookup failed.';
    return {
      configured: true,
      found: [],
      missing: [],
      errors: [message],
    };
  } finally {
    client.release();
  }
}

export async function searchDbEventOptions(queryText: string): Promise<{
  configured: boolean;
  options: DbEventOption[];
  errors: string[];
}> {
  const config = getConfig();
  if (!config) {
    return {
      configured: false,
      options: [],
      errors: ['Database lookup is not configured.'],
    };
  }

  const client = await getPool(config).connect();
  try {
    const query = `
      select distinct on (event_name)
        event_name,
        event_label
      from ${config.schema}.sep_enrollment_events
      where $1::text = ''
         or event_name ilike $2
         or event_label ilike $2
      order by event_name, id desc
      limit 25
    `;

    const search = queryText.trim();
    const result = await client.query(query, [search, `%${search}%`]);
    const options = result.rows.map((row) => ({
      eventName: String(row.event_name),
      eventLabel: String(row.event_label),
    })) satisfies DbEventOption[];

    return {
      configured: true,
      options,
      errors: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database autocomplete failed.';
    return {
      configured: true,
      options: [],
      errors: [message],
    };
  } finally {
    client.release();
  }
}
