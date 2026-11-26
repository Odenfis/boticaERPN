import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import {
  checkSqlServerStatus,
  getSqlPool,
  sql,
  SqlServerConnectionError,
  SqlServerNotConfiguredError,
} from '../db/mssqlClient';
import {
  clearSessionCookie,
  generateSessionToken,
  getSessionExpirationDate,
  hashSessionToken,
  requireAuth,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from '../middleware/auth';

export const authRouter = express.Router();

authRouter.get('/health', async (_req, res) => {
  const status = await checkSqlServerStatus();
  res.status(status.connected ? 200 : 200).json(status);
});

authRouter.post('/auth/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const sucursalId = String(req.body?.sucursalId || 'SUC-001').trim();

    if (!username || !password) {
      return res.status(400).json({ error: 'Ingrese usuario y contraseña.' });
    }

    const pool = await getSqlPool();
    const userRes = await pool
      .request()
      .input('Username', sql.NVarChar(60), username)
      .query(`
        SELECT TOP 1 UsuarioId, Username, NombreCompleto, Cargo, PasswordHash, Activo
        FROM dbo.Usuarios
        WHERE Username = @Username
      `);

    if (userRes.recordset.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const user = userRes.recordset[0];
    if (!user.Activo) {
      return res.status(403).json({ error: 'Su cuenta de usuario se encuentra desactivada.' });
    }

    const passwordValid = await bcrypt.compare(password, user.PasswordHash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const branchRes = await pool
      .request()
      .input('UsuarioId', sql.NVarChar(36), user.UsuarioId)
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .query(`
        SELECT TOP 1 s.SucursalId, s.Nombre, s.Ruc
        FROM dbo.UsuarioSucursal us
        INNER JOIN dbo.Sucursales s ON s.SucursalId = us.SucursalId
        WHERE us.UsuarioId = @UsuarioId AND us.SucursalId = @SucursalId AND us.Activo = 1 AND s.Activo = 1
      `);

    if (branchRes.recordset.length === 0) {
      return res.status(403).json({ error: 'No tiene acceso habilitado a la sucursal seleccionada.' });
    }

    const branch = branchRes.recordset[0];
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const sesionId = crypto.randomUUID();
    const expiraEn = getSessionExpirationDate();

    await pool
      .request()
      .input('SesionId', sql.NVarChar(36), sesionId)
      .input('UsuarioId', sql.NVarChar(36), user.UsuarioId)
      .input('SucursalId', sql.NVarChar(36), branch.SucursalId)
      .input('TokenHash', sql.NVarChar(128), tokenHash)
      .input('ExpiraEn', sql.DateTime2(3), expiraEn)
      .input('IpOrigen', sql.NVarChar(64), req.ip || null)
      .input('UserAgent', sql.NVarChar(250), String(req.headers['user-agent'] || '').slice(0, 250))
      .query(`
        INSERT INTO dbo.Sesiones (SesionId, UsuarioId, SucursalId, TokenHash, ExpiraEn, IpOrigen, UserAgent)
        VALUES (@SesionId, @UsuarioId, @SucursalId, @TokenHash, @ExpiraEn, @IpOrigen, @UserAgent)
      `);

    await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), branch.SucursalId)
      .input('UsuarioId', sql.NVarChar(36), user.UsuarioId)
      .input('EntidadId', sql.NVarChar(60), sesionId)
      .input('IpOrigen', sql.NVarChar(64), req.ip || null)
      .query(`
        INSERT INTO dbo.Auditoria (SucursalId, UsuarioId, Accion, Entidad, EntidadId, IpOrigen)
        VALUES (@SucursalId, @UsuarioId, N'LOGIN_EXITOSO', N'Sesion', @EntidadId, @IpOrigen)
      `);

    const rolesRes = await pool
      .request()
      .input('UsuarioId', sql.NVarChar(36), user.UsuarioId)
      .query(`
        SELECT DISTINCT r.Codigo
        FROM dbo.UsuarioRol ur
        INNER JOIN dbo.Roles r ON r.RolId = ur.RolId
        WHERE ur.UsuarioId = @UsuarioId
      `);

    const permRes = await pool
      .request()
      .input('UsuarioId', sql.NVarChar(36), user.UsuarioId)
      .query(`
        SELECT DISTINCT p.Codigo
        FROM dbo.UsuarioRol ur
        INNER JOIN dbo.RolPermiso rp ON rp.RolId = ur.RolId
        INNER JOIN dbo.Permisos p ON p.PermisoId = rp.PermisoId
        WHERE ur.UsuarioId = @UsuarioId
      `);

    const cajaRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), branch.SucursalId)
      .query(`
        SELECT TOP 1 CajaId, Nombre FROM dbo.Cajas WHERE SucursalId = @SucursalId AND Activo = 1 ORDER BY Codigo ASC
      `);
    const caja = cajaRes.recordset[0] || { CajaId: 'CAJ-001', Nombre: 'Caja Principal 01' };

    setSessionCookie(req, res, rawToken);

    return res.json({
      user: {
        usuarioId: user.UsuarioId,
        username: user.Username,
        nombreCompleto: user.NombreCompleto,
        cargo: user.Cargo,
        sucursalId: branch.SucursalId,
        sucursalNombre: branch.Nombre,
        sucursalRuc: branch.Ruc,
        cajaId: caja.CajaId,
        cajaNombre: caja.Nombre,
        roles: rolesRes.recordset.map((r: { Codigo: string }) => r.Codigo),
        permisos: permRes.recordset.map((p: { Codigo: string }) => p.Codigo),
      },
      // Devuelto solo para clientes API/CLI sin cookies si fuera necesario; el navegador usa cookie HttpOnly
      sessionToken: rawToken,
    });
  } catch (err) {
    if (err instanceof SqlServerNotConfiguredError || err instanceof SqlServerConnectionError) {
      return res.status(503).json({ error: err.message, code: 'SQL_SERVER_UNAVAILABLE' });
    }
    console.error('Error en login:', err);
    return res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

authRouter.post('/auth/logout', async (req, res) => {
  try {
    const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
    const authHeader = req.headers.authorization;
    const bearerToken =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;
    const rawToken = bearerToken || cookieToken;

    if (rawToken) {
      try {
        const pool = await getSqlPool();
        await pool
          .request()
          .input('TokenHash', sql.NVarChar(128), hashSessionToken(rawToken))
          .query(`
            UPDATE dbo.Sesiones
            SET Revocada = 1, RevocadaEn = SYSUTCDATETIME(), MotivoRevocacion = N'Cierre de sesión de usuario'
            WHERE TokenHash = @TokenHash
          `);
      } catch {
        // Always clear cookie even if DB connection fails
      }
    }

    clearSessionCookie(req, res);
    return res.json({ ok: true });
  } catch (err) {
    clearSessionCookie(req, res);
    return res.status(500).json({ error: 'Error cerrando sesión.' });
  }
});

authRouter.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const pool = await getSqlPool();
    const shiftRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
      .input('CajaId', sql.NVarChar(36), req.auth!.cajaId)
      .query(`
        SELECT TOP 1 t.TurnoId, t.CodigoTurno, t.Estado, t.FechaApertura, t.FondoInicialCentimos, u.NombreCompleto AS UsuarioAperturaNombre
        FROM dbo.TurnosCaja t
        INNER JOIN dbo.Usuarios u ON u.UsuarioId = t.UsuarioAperturaId
        WHERE t.SucursalId = @SucursalId AND t.CajaId = @CajaId AND t.Estado = 'ABIERTO'
        ORDER BY t.FechaApertura DESC
      `);

    const openShift = shiftRes.recordset[0]
      ? {
          turnoId: shiftRes.recordset[0].TurnoId,
          codigoTurno: shiftRes.recordset[0].CodigoTurno,
          estado: shiftRes.recordset[0].Estado,
          fechaApertura: shiftRes.recordset[0].FechaApertura,
          fondoInicialCentimos: Number(shiftRes.recordset[0].FondoInicialCentimos),
          usuarioAperturaNombre: shiftRes.recordset[0].UsuarioAperturaNombre,
        }
      : null;

    return res.json({
      user: req.auth,
      openShift,
    });
  } catch (err) {
    console.error('Error en /auth/me:', err);
    return res.status(500).json({ error: 'Error consultando sesión actual.' });
  }
});
