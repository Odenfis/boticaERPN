-- Botica ERP - Fase 1
-- Migración 002: Sucursal única inicial, Caja inicial, Roles, Permisos y Parámetros

SET NOCOUNT ON;
GO

-- Sucursal inicial única
IF NOT EXISTS (SELECT 1 FROM dbo.Sucursales WHERE SucursalId = N'SUC-001')
BEGIN
    INSERT INTO dbo.Sucursales (SucursalId, Codigo, Nombre, Direccion, Ruc, Telefono, Activo)
    VALUES (N'SUC-001', N'SUC-CENTRAL', N'Botica Central Lima', N'Av. Arequipa 1420, Lince, Lima', N'20601234567', N'01-471-8890', 1);
END
GO

-- Caja inicial única
IF NOT EXISTS (SELECT 1 FROM dbo.Cajas WHERE CajaId = N'CAJ-001')
BEGIN
    INSERT INTO dbo.Cajas (CajaId, SucursalId, Codigo, Nombre, Activo)
    VALUES (N'CAJ-001', N'SUC-001', N'CAJA-01', N'Caja Principal 01', 1);
END
GO

-- Parámetros iniciales de sucursal
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionParametros WHERE SucursalId = N'SUC-001')
BEGIN
    INSERT INTO dbo.ConfiguracionParametros (SucursalId, IgvPorcentaje, VentanaAlertaDias, MetaMensualCentimos, PorcentajeComision)
    VALUES (N'SUC-001', 18.00, 30, 8500000, 3.00);
END
GO

-- Roles iniciales
MERGE dbo.Roles AS target
USING (VALUES
    (N'ROL-ADMIN', N'ADMINISTRADOR', N'Administrador', N'Control total del sistema, usuarios, permisos y parámetros'),
    (N'ROL-FARM',  N'FARMACEUTICO',  N'Farmacéutico',  N'Validación de recetas médicas, dispensación, inventario y Kardex'),
    (N'ROL-CAJ',   N'CAJERO',        N'Cajero',        N'Operación de Punto de Venta (POS) y apertura/cierre de su turno'),
    (N'ROL-ALM',   N'ALMACEN',       N'Almacén',       N'Gestión de compras, recepción por lote, inventario y Kardex')
) AS src (RolId, Codigo, Nombre, Descripcion)
ON target.RolId = src.RolId
WHEN MATCHED THEN UPDATE SET Nombre = src.Nombre, Descripcion = src.Descripcion
WHEN NOT MATCHED THEN INSERT (RolId, Codigo, Nombre, Descripcion) VALUES (src.RolId, src.Codigo, src.Nombre, src.Descripcion);
GO

-- Permisos explícitos
MERGE dbo.Permisos AS target
USING (VALUES
    (N'PRM-POS-OP',     N'pos.operar',         N'POS',           N'Operar punto de venta y cobrar ventas'),
    (N'PRM-POS-DESC',   N'pos.descuento',      N'POS',           N'Aplicar descuentos autorizados en POS'),
    (N'PRM-POS-ANUL',   N'pos.anular',         N'POS',           N'Anular ventas registradas con motivo'),
    (N'PRM-REC-VAL',    N'recetas.validar',    N'Recetas',       N'Validar recetas médicas antes del cobro'),
    (N'PRM-INV-VER',    N'inventario.ver',     N'Inventario',    N'Consultar catálogo de productos y lotes'),
    (N'PRM-INV-EDIT',   N'inventario.editar',  N'Inventario',    N'Crear y editar productos del catálogo'),
    (N'PRM-INV-AJUST',  N'inventario.ajustar', N'Inventario',    N'Ejecutar ajustes manuales de stock y estado de lote'),
    (N'PRM-COM-VER',    N'compras.ver',        N'Compras',       N'Ver órdenes de compra y proveedores'),
    (N'PRM-COM-CREAR',  N'compras.crear',      N'Compras',       N'Crear órdenes de compra y gestionar proveedores'),
    (N'PRM-COM-REC',    N'compras.recibir',    N'Compras',       N'Registrar recepciones por lote en almacén'),
    (N'PRM-KAR-VER',    N'kardex.ver',         N'Kardex',        N'Consultar y exportar Kardex por producto'),
    (N'PRM-CAJ-OP',     N'caja.operar',        N'Caja',          N'Abrir turno y registrar ingresos o retiros de caja'),
    (N'PRM-CAJ-CERR',   N'caja.cerrar',        N'Caja',          N'Cerrar turno de caja y emitir reporte Z'),
    (N'PRM-REP-VER',    N'reportes.ver',       N'Reportes',      N'Consultar panel de reportes e indicadores'),
    (N'PRM-REP-EXP',    N'reportes.exportar',  N'Reportes',      N'Exportar reportes reales en PDF y Excel'),
    (N'PRM-CFG-USR',    N'config.usuarios',    N'Configuración', N'Administrar usuarios, roles, permisos y accesos por sucursal'),
    (N'PRM-CFG-PARAM',  N'config.parametros',  N'Configuración', N'Configurar metas mensuales, alertas e impuestos')
) AS src (PermisoId, Codigo, Modulo, Descripcion)
ON target.PermisoId = src.PermisoId
WHEN MATCHED THEN UPDATE SET Modulo = src.Modulo, Descripcion = src.Descripcion
WHEN NOT MATCHED THEN INSERT (PermisoId, Codigo, Modulo, Descripcion) VALUES (src.PermisoId, src.Codigo, src.Modulo, src.Descripcion);
GO

-- Asignación inicial de permisos por rol
MERGE dbo.RolPermiso AS target
USING (
    -- Administrador: todos los permisos
    SELECT N'ROL-ADMIN' AS RolId, PermisoId FROM dbo.Permisos
    UNION ALL
    -- Farmacéutico
    SELECT N'ROL-FARM', PermisoId FROM dbo.Permisos WHERE Codigo IN (
        N'pos.operar', N'pos.descuento', N'pos.anular', N'recetas.validar',
        N'inventario.ver', N'inventario.editar', N'inventario.ajustar',
        N'compras.ver', N'kardex.ver', N'caja.operar', N'caja.cerrar',
        N'reportes.ver', N'reportes.exportar'
    )
    UNION ALL
    -- Cajero
    SELECT N'ROL-CAJ', PermisoId FROM dbo.Permisos WHERE Codigo IN (
        N'pos.operar', N'inventario.ver', N'caja.operar', N'caja.cerrar'
    )
    UNION ALL
    -- Almacén
    SELECT N'ROL-ALM', PermisoId FROM dbo.Permisos WHERE Codigo IN (
        N'inventario.ver', N'inventario.editar', N'inventario.ajustar',
        N'compras.ver', N'compras.crear', N'compras.recibir', N'kardex.ver'
    )
) AS src
ON target.RolId = src.RolId AND target.PermisoId = src.PermisoId
WHEN NOT MATCHED THEN INSERT (RolId, PermisoId) VALUES (src.RolId, src.PermisoId);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.SchemaMigrations WHERE MigrationId = N'002_seed_rbac')
BEGIN
    INSERT INTO dbo.SchemaMigrations (MigrationId) VALUES (N'002_seed_rbac');
END
GO
