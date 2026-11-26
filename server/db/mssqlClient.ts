import sql from 'mssql';

export class SqlServerNotConfiguredError extends Error {
  constructor(message = 'Microsoft SQL Server no está configurado en las variables de entorno.') {
    super(message);
    this.name = 'SqlServerNotConfiguredError';
  }
}

export class SqlServerConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlServerConnectionError';
  }
}

export interface SqlServerStatus {
  engine: 'Microsoft SQL Server';
  configured: boolean;
  connected: boolean;
  server?: string;
  database?: string;
  message: string;
}

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function isSqlServerConfigured(): boolean {
  return Boolean(
    process.env.MSSQL_SERVER?.trim() &&
      process.env.MSSQL_DATABASE?.trim() &&
      process.env.MSSQL_USER?.trim() &&
      process.env.MSSQL_PASSWORD !== undefined &&
      process.env.MSSQL_PASSWORD !== ''
  );
}

export function getSqlConfig(): sql.config {
  if (!isSqlServerConfigured()) {
    throw new SqlServerNotConfiguredError(
      'Faltan variables de entorno requeridas: MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER y MSSQL_PASSWORD.'
    );
  }

  return {
    server: process.env.MSSQL_SERVER!.trim(),
    port: Number(process.env.MSSQL_PORT || '1433'),
    database: process.env.MSSQL_DATABASE!.trim(),
    user: process.env.MSSQL_USER!.trim(),
    password: process.env.MSSQL_PASSWORD!,
    pool: {
      max: 15,
      min: 1,
      idleTimeoutMillis: 30000,
    },
    options: {
      encrypt: (process.env.MSSQL_ENCRYPT ?? 'true').toLowerCase() === 'true',
      trustServerCertificate:
        (process.env.MSSQL_TRUST_SERVER_CERTIFICATE ?? 'false').toLowerCase() === 'true',
      enableArithAbort: true,
    },
    connectionTimeout: Number(process.env.MSSQL_CONNECTION_TIMEOUT || '10000'),
    requestTimeout: Number(process.env.MSSQL_REQUEST_TIMEOUT || '30000'),
  };
}

export async function getSqlPool(): Promise<sql.ConnectionPool> {
  if (!isSqlServerConfigured()) {
    throw new SqlServerNotConfiguredError();
  }

  if (poolPromise) {
    try {
      const existing = await poolPromise;
      if (existing.connected) {
        return existing;
      }
    } catch {
      poolPromise = null;
    }
  }

  const config = getSqlConfig();
  poolPromise = new sql.ConnectionPool(config)
    .connect()
    .catch((err: unknown) => {
      poolPromise = null;
      const detail = err instanceof Error ? err.message : String(err);
      throw new SqlServerConnectionError(
        `No se pudo conectar a Microsoft SQL Server (${config.server}:${config.port}/${config.database}): ${detail}`
      );
    });

  return poolPromise;
}

export async function checkSqlServerStatus(): Promise<SqlServerStatus> {
  if (!isSqlServerConfigured()) {
    return {
      engine: 'Microsoft SQL Server',
      configured: false,
      connected: false,
      message:
        'Instancia de Microsoft SQL Server no configurada. Defina MSSQL_SERVER, MSSQL_PORT, MSSQL_DATABASE, MSSQL_USER y MSSQL_PASSWORD en el entorno del backend.',
    };
  }

  try {
    const pool = await getSqlPool();
    await pool.request().query('SELECT 1 AS ok');
    return {
      engine: 'Microsoft SQL Server',
      configured: true,
      connected: true,
      server: process.env.MSSQL_SERVER,
      database: process.env.MSSQL_DATABASE,
      message: 'Conectado a Microsoft SQL Server.',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      engine: 'Microsoft SQL Server',
      configured: true,
      connected: false,
      server: process.env.MSSQL_SERVER,
      database: process.env.MSSQL_DATABASE,
      message: msg,
    };
  }
}

export async function withTransaction<T>(
  fn: (tx: sql.Transaction) => Promise<T>,
  isolationLevel: sql.IIsolationLevel = sql.ISOLATION_LEVEL.SERIALIZABLE
): Promise<T> {
  const pool = await getSqlPool();
  const tx = new sql.Transaction(pool);
  await tx.begin(isolationLevel);
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // Ignore rollback errors if connection already closed
    }
    throw error;
  }
}

export { sql };
