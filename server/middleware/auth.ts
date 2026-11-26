import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  getSqlPool,
  sql,
  SqlServerConnectionError,
  SqlServerNotConfiguredError,
} from '../db/mssqlClient';

export const SESSION_COOKIE_NAME = 'botica_session';
const SESSION_TTL_HOURS = 12;

export interface AuthenticatedContext {
  sesionId: string;
  usuarioId: string;
  username: string;
  nombreCompleto: string;
  cargo: string;
  sucursalId: string;
  sucursalNombre: string;
  sucursalRuc: string;
  cajaId: string;
  cajaNombre: string;
  roles: string[];
  permisos: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedContext;
      authViaCookie?: boolean;
    }
  }
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function isHttpsRequest(req: Request): boolean {
  const xfProto = req.headers['x-forwarded-proto'];
  if (typeof xfProto === 'string' && xfProto.toLowerCase().includes('https')) {
    return true;
  }
  return req.secure;
}

export function setSessionCookie(req: Request, res: Response, rawToken: string) {
  const maxAgeSeconds = SESSION_TTL_HOURS * 60 * 60;
  const secure = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response) {
  const secure = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function getSessionExpirationDate(): Date {
  return new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
}

export function verifyCsrfForMutations(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  // Only enforce CSRF check when browser cookie auth is present
  if (!req.cookies?.[SESSION_COOKIE_NAME]) {
    return next();
  }

  const xRequestedWith = req.headers['x-requested-with'];
  if (xRequestedWith === 'BoticaERP') {
    return next();
  }

  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  if (origin && host) {
    try {
      const parsed = new URL(origin);
      if (parsed.host === host) {
        return next();
      }
    } catch {
      // fall through to 403
    }
  }

  return res.status(403).json({
    error: 'Solicitud bloqueada por validación de origen CSRF.',
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
    const authHeader = req.headers.authorization;
    const bearerToken =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

    const rawToken = bearerToken || cookieToken;
    req.authViaCookie = Boolean(cookieToken && !bearerToken);

    if (!rawToken) {
      return res.status(401).json({ error: 'Sesión no iniciada o expirada.' });
    }

    const tokenHash = hashSessionToken(rawToken);
    const pool = await getSqlPool();

    const sessionRes = await pool
      .request()
      .input('TokenHash', sql.NVarChar(128), tokenHash)
      .query(`
        SELECT TOP 1
          s.SesionId,
          s.UsuarioId,
          s.SucursalId,
          s.ExpiraEn,
          s.Revocada,
          u.Username,
          u.NombreCompleto,
          u.Cargo,
          u.Activo AS UsuarioActivo,
          suc.Nombre AS SucursalNombre,
          suc.Ruc AS SucursalRuc,
          suc.Activo AS SucursalActivo,
          us.Activo AS AccesoSucursalActivo
        FROM dbo.Sesiones s
        INNER JOIN dbo.Usuarios u ON u.UsuarioId = s.UsuarioId
        INNER JOIN dbo.Sucursales suc ON suc.SucursalId = s.SucursalId
        LEFT JOIN dbo.UsuarioSucursal us ON us.UsuarioId = s.UsuarioId AND us.SucursalId = s.SucursalId
        WHERE s.TokenHash = @TokenHash
      `);

    if (sessionRes.recordset.length === 0) {
      return res.status(401).json({ error: 'Sesión inválida.' });
    }

    const row = sessionRes.recordset[0];
    if (row.Revocada || new Date(row.ExpiraEn).getTime() <= Date.now()) {
      return res.status(401).json({ error: 'La sesión ha expirado o fue revocada.' });
    }
    if (!row.UsuarioActivo) {
      return res.status(401).json({ error: 'Cuenta de usuario desactivada.' });
    }
    if (!row.SucursalActivo || !row.AccesoSucursalActivo) {
      return res.status(403).json({ error: 'El usuario no tiene acceso activo a esta sucursal.' });
    }

    const rolesRes = await pool
      .request()
      .input('UsuarioId', sql.NVarChar(36), row.UsuarioId)
      .query(`
        SELECT DISTINCT r.Codigo
        FROM dbo.UsuarioRol ur
        INNER JOIN dbo.Roles r ON r.RolId = ur.RolId
        WHERE ur.UsuarioId = @UsuarioId
      `);

    const permRes = await pool
      .request()
      .input('UsuarioId', sql.NVarChar(36), row.UsuarioId)
      .query(`
        SELECT DISTINCT p.Codigo
        FROM dbo.UsuarioRol ur
        INNER JOIN dbo.RolPermiso rp ON rp.RolId = ur.RolId
        INNER JOIN dbo.Permisos p ON p.PermisoId = rp.PermisoId
        WHERE ur.UsuarioId = @UsuarioId
      `);

    const cajaRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), row.SucursalId)
      .query(`
        SELECT TOP 1 CajaId, Nombre
        FROM dbo.Cajas
        WHERE SucursalId = @SucursalId AND Activo = 1
        ORDER BY Codigo ASC
      `);

    const caja = cajaRes.recordset[0] || { CajaId: 'CAJ-001', Nombre: 'Caja Principal 01' };

    req.auth = {
      sesionId: row.SesionId,
      usuarioId: row.UsuarioId,
      username: row.Username,
      nombreCompleto: row.NombreCompleto,
      cargo: row.Cargo,
      sucursalId: row.SucursalId,
      sucursalNombre: row.SucursalNombre,
      sucursalRuc: row.SucursalRuc,
      cajaId: caja.CajaId,
      cajaNombre: caja.Nombre,
      roles: rolesRes.recordset.map((r: { Codigo: string }) => r.Codigo),
      permisos: permRes.recordset.map((p: { Codigo: string }) => p.Codigo),
    };

    return next();
  } catch (err) {
    if (err instanceof SqlServerNotConfiguredError || err instanceof SqlServerConnectionError) {
      return res.status(503).json({ error: err.message, code: 'SQL_SERVER_UNAVAILABLE' });
    }
    console.error('Error en requireAuth:', err);
    return res.status(500).json({ error: 'Error interno al validar la sesión.' });
  }
}

export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'No autenticado.' });
    }
    const hasAny = requiredPermissions.some((perm) => req.auth!.permisos.includes(perm));
    if (!hasAny) {
      return res.status(403).json({
        error: `Acceso denegado. Se requiere permiso: ${requiredPermissions.join(' o ')}.`,
        code: 'FORBIDDEN_PERMISSION',
      });
    }
    return next();
  };
}
