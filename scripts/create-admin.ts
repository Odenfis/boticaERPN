import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { getSqlPool, sql, withTransaction } from '../server/db/mssqlClient';

dotenv.config();

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main() {
  let username = parseArg('--username')?.trim();
  let nombre = parseArg('--nombre')?.trim();
  let password = parseArg('--password');

  if (!username || !password || !nombre) {
    const rl = readline.createInterface({ input, output });
    try {
      if (!username) {
        username = (await rl.question('Usuario administrador (ej. admin): ')).trim() || 'admin';
      }
      if (!nombre) {
        nombre =
          (await rl.question('Nombre completo (ej. Dr. Ricardo Pérez): ')).trim() ||
          'Administrador Botica';
      }
      if (!password) {
        password = await rl.question('Contraseña del administrador (mínimo 8 caracteres): ');
      }
    } finally {
      rl.close();
    }
  }

  if (!username || username.length < 3) {
    throw new Error('El nombre de usuario debe tener al menos 3 caracteres.');
  }
  if (!password || password.length < 8) {
    throw new Error('La contraseña debe tener al menos 8 caracteres.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const pool = await getSqlPool();

  const existing = await pool
    .request()
    .input('Username', sql.NVarChar(60), username)
    .query('SELECT UsuarioId FROM dbo.Usuarios WHERE Username = @Username');

  if (existing.recordset.length > 0) {
    throw new Error(`El usuario "${username}" ya existe en dbo.Usuarios.`);
  }

  const usuarioId = crypto.randomUUID();

  await withTransaction(async (tx) => {
    await tx
      .request()
      .input('UsuarioId', sql.NVarChar(36), usuarioId)
      .input('Username', sql.NVarChar(60), username!)
      .input('NombreCompleto', sql.NVarChar(140), nombre!)
      .input('Cargo', sql.NVarChar(80), 'Administrador General')
      .input('PasswordHash', sql.NVarChar(255), passwordHash)
      .query(`
        INSERT INTO dbo.Usuarios (UsuarioId, Username, NombreCompleto, Cargo, PasswordHash, Activo)
        VALUES (@UsuarioId, @Username, @NombreCompleto, @Cargo, @PasswordHash, 1)
      `);

    await tx
      .request()
      .input('UsuarioId', sql.NVarChar(36), usuarioId)
      .input('RolId', sql.NVarChar(36), 'ROL-ADMIN')
      .query('INSERT INTO dbo.UsuarioRol (UsuarioId, RolId) VALUES (@UsuarioId, @RolId)');

    await tx
      .request()
      .input('UsuarioId', sql.NVarChar(36), usuarioId)
      .input('SucursalId', sql.NVarChar(36), 'SUC-001')
      .query(
        'INSERT INTO dbo.UsuarioSucursal (UsuarioId, SucursalId, Activo) VALUES (@UsuarioId, @SucursalId, 1)'
      );

    await tx
      .request()
      .input('SucursalId', sql.NVarChar(36), 'SUC-001')
      .input('UsuarioId', sql.NVarChar(36), usuarioId)
      .input('EntidadId', sql.NVarChar(60), usuarioId)
      .input('DetalleJson', sql.NVarChar(sql.MAX), JSON.stringify({ username, rol: 'ADMINISTRADOR' }))
      .query(`
        INSERT INTO dbo.Auditoria (SucursalId, UsuarioId, Accion, Entidad, EntidadId, DetalleJson)
        VALUES (@SucursalId, @UsuarioId, N'ADMIN_INICIAL_CREADO', N'Usuario', @EntidadId, @DetalleJson)
      `);
  });

  console.log(`Administrador inicial "${username}" creado con acceso a SUC-001.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error creando administrador inicial:', err instanceof Error ? err.message : err);
  process.exit(1);
});
