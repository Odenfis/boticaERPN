-- Botica ERP - Fase 1
-- Script de referencia para cuenta SQL Server con privilegios mínimos de aplicación.
-- Ejecutar como DBA / sysadmin antes de desplegar en producción.

-- 1. Crear login a nivel de servidor (reemplazar <STRONG_PASSWORD> al ejecutar)
-- CREATE LOGIN botica_app WITH PASSWORD = N'<STRONG_PASSWORD>', CHECK_POLICY = ON;
-- GO

-- 2. Crear usuario en la base de datos BoticaERP y asignar rol de aplicación
-- USE BoticaERP;
-- CREATE USER botica_app FOR LOGIN botica_app;
-- GO

IF DATABASE_PRINCIPAL_ID(N'rol_botica_app') IS NULL
BEGIN
    CREATE ROLE rol_botica_app;
END
GO

-- Solo operaciones DML sobre el esquema operativo (sin DDL, sin db_owner, sin DROP/ALTER)
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo TO rol_botica_app;
-- Quitar denegaciones de versiones anteriores. CONTROL incluye los permisos DML.
REVOKE ALTER ON SCHEMA::dbo FROM rol_botica_app;
REVOKE CONTROL ON SCHEMA::dbo FROM rol_botica_app;
GO

-- Asignar usuario al rol mínimo:
-- EXEC sp_addrolemember N'rol_botica_app', N'botica_app';
-- GO
