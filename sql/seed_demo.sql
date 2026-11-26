-- Botica ERP - Fase 1
-- Carga Demo Ejecutable por Separado (Fechas relativas a GETDATE() para alertas realistas)
-- Requiere haber ejecutado 001_schema.sql, 002_seed_rbac.sql y creado al menos un usuario administrador.

SET NOCOUNT ON;
GO

DECLARE @AdminId NVARCHAR(36);
SELECT TOP 1 @AdminId = UsuarioId FROM dbo.Usuarios WHERE Activo = 1 ORDER BY CreadoEn ASC;
IF @AdminId IS NULL
BEGIN
    RAISERROR(N'Debe crear el administrador inicial (npm run db:create-admin) antes de ejecutar seed_demo.sql.', 16, 1);
    RETURN;
END
GO

DECLARE @AdminId NVARCHAR(36);
DECLARE @AdminUser NVARCHAR(60);
SELECT TOP 1 @AdminId = UsuarioId, @AdminUser = Username FROM dbo.Usuarios WHERE Activo = 1 ORDER BY CreadoEn ASC;

-- Proveedores peruanos
IF NOT EXISTS (SELECT 1 FROM dbo.Proveedores WHERE Ruc = N'20556677889')
    INSERT INTO dbo.Proveedores (ProveedorId, Ruc, RazonSocial, ContactoNombre, Telefono, Email, Direccion)
    VALUES (N'PROV-001', N'20556677889', N'Droguería Alfarma S.A.', N'María Elena Paredes', N'01-445-1900', N'ventas@alfarma.pe', N'Av. Industrial 450, Lima');

IF NOT EXISTS (SELECT 1 FROM dbo.Proveedores WHERE Ruc = N'20448899112')
    INSERT INTO dbo.Proveedores (ProveedorId, Ruc, RazonSocial, ContactoNombre, Telefono, Email, Direccion)
    VALUES (N'PROV-002', N'20448899112', N'Distribuidora Médica Global S.A.C.', N'Jorge Luis Quispe', N'01-326-7740', N'pedidos@medicaglobal.pe', N'Calle Los Talleres 210, Ate');

IF NOT EXISTS (SELECT 1 FROM dbo.Proveedores WHERE Ruc = N'20112233445')
    INSERT INTO dbo.Proveedores (ProveedorId, Ruc, RazonSocial, ContactoNombre, Telefono, Email, Direccion)
    VALUES (N'PROV-003', N'20112233445', N'Laboratorios FarmaPerú S.A.', N'Lucía Mendoza', N'01-224-5100', N'distribucion@farmaperu.pe', N'Av. Nicolás Arriola 880, La Victoria');

-- Clientes demo
IF NOT EXISTS (SELECT 1 FROM dbo.Clientes WHERE NumeroDocumento = N'45902188')
    INSERT INTO dbo.Clientes (ClienteId, TipoDocumento, NumeroDocumento, NombreRazonSocial, Telefono, Direccion)
    VALUES (N'CLI-001', N'DNI', N'45902188', N'JUAN PÉREZ RODRÍGUEZ', N'987654321', N'Jr. Pardo 234, Lince');

IF NOT EXISTS (SELECT 1 FROM dbo.Clientes WHERE NumeroDocumento = N'20512345678')
    INSERT INTO dbo.Clientes (ClienteId, TipoDocumento, NumeroDocumento, NombreRazonSocial, Telefono, Direccion)
    VALUES (N'CLI-002', N'RUC', N'20512345678', N'CLÍNICA SAN GABRIEL S.A.C.', N'01-614-2000', N'Av. La Marina 2955, San Miguel');

-- Productos OTC y con Receta (importes en céntimos PEN)
IF NOT EXISTS (SELECT 1 FROM dbo.Productos WHERE Sku = N'SKU-40293')
    INSERT INTO dbo.Productos (ProductoId, Sku, CodigoBarras, Nombre, PrincipioActivo, Concentracion, Presentacion, Laboratorio, Categoria, RegistroSanitario, CondicionVenta, RequiereReceta, UnidadInventario, StockMinimo, PrecioVentaCentimos, GravadoIgv, IgvPorcentaje, UbicacionPasillo, UbicacionEstante, TemperaturaAlmacen)
    VALUES (N'PROD-001', N'SKU-40293', N'7750100040293', N'Paracetamol 500mg', N'Paracetamol', N'500mg', N'Caja x 20 Tabletas', N'Roemmers', N'Analgésicos', N'EN-02114', N'OTC', 0, N'Caja', 25, 1250, 1, 18.00, N'A - Analgésicos', N'01 / A', N'15°C - 25°C');

IF NOT EXISTS (SELECT 1 FROM dbo.Productos WHERE Sku = N'SKU-11029')
    INSERT INTO dbo.Productos (ProductoId, Sku, CodigoBarras, Nombre, PrincipioActivo, Concentracion, Presentacion, Laboratorio, Categoria, RegistroSanitario, CondicionVenta, RequiereReceta, UnidadInventario, StockMinimo, PrecioVentaCentimos, GravadoIgv, IgvPorcentaje, UbicacionPasillo, UbicacionEstante, TemperaturaAlmacen)
    VALUES (N'PROD-002', N'SKU-11029', N'7750100011029', N'Amoxicilina + Ácido Clavulánico', N'Amoxicilina / Ácido Clavulánico', N'875mg / 125mg', N'Caja x 14 Tabletas', N'GlaxoSmithKline', N'Antibióticos', N'EN-04322-S2', N'RECETA', 1, N'Caja', 20, 2400, 1, 18.00, N'B - Antibióticos', N'04 / C', N'15°C - 25°C');

IF NOT EXISTS (SELECT 1 FROM dbo.Productos WHERE Sku = N'SKU-88273')
    INSERT INTO dbo.Productos (ProductoId, Sku, CodigoBarras, Nombre, PrincipioActivo, Concentracion, Presentacion, Laboratorio, Categoria, RegistroSanitario, CondicionVenta, RequiereReceta, UnidadInventario, StockMinimo, PrecioVentaCentimos, GravadoIgv, IgvPorcentaje, UbicacionPasillo, UbicacionEstante, TemperaturaAlmacen)
    VALUES (N'PROD-003', N'SKU-88273', N'7750100088273', N'Ibuprofeno 400mg', N'Ibuprofeno', N'400mg', N'Caja x 50 Tabletas', N'Genfar', N'Antiinflamatorios', N'EN-01988', N'OTC', 0, N'Caja', 30, 820, 1, 18.00, N'A - Analgésicos', N'02 / B', N'15°C - 25°C');

IF NOT EXISTS (SELECT 1 FROM dbo.Productos WHERE Sku = N'SKU-99021')
    INSERT INTO dbo.Productos (ProductoId, Sku, CodigoBarras, Nombre, PrincipioActivo, Concentracion, Presentacion, Laboratorio, Categoria, RegistroSanitario, CondicionVenta, RequiereReceta, UnidadInventario, StockMinimo, PrecioVentaCentimos, GravadoIgv, IgvPorcentaje, UbicacionPasillo, UbicacionEstante, TemperaturaAlmacen)
    VALUES (N'PROD-004', N'SKU-99021', N'7750100099021', N'Loratadina 10mg', N'Loratadina', N'10mg', N'Caja x 30 Tabletas', N'Pfizer', N'Antialérgicos', N'EN-03341', N'OTC', 0, N'Caja', 15, 1500, 1, 18.00, N'C - Respiratorio', N'01 / B', N'15°C - 25°C');

IF NOT EXISTS (SELECT 1 FROM dbo.Productos WHERE Sku = N'SKU-55440')
    INSERT INTO dbo.Productos (ProductoId, Sku, CodigoBarras, Nombre, PrincipioActivo, Concentracion, Presentacion, Laboratorio, Categoria, RegistroSanitario, CondicionVenta, RequiereReceta, UnidadInventario, StockMinimo, PrecioVentaCentimos, GravadoIgv, IgvPorcentaje, UbicacionPasillo, UbicacionEstante, TemperaturaAlmacen)
    VALUES (N'PROD-005', N'SKU-55440', N'7750100055440', N'Omeprazol 20mg', N'Omeprazol', N'20mg', N'Caja x 30 Cápsulas', N'Bayer', N'Gastro', N'EN-05012', N'OTC', 0, N'Caja', 15, 3200, 1, 18.00, N'D - Gastro', N'03 / A', N'15°C - 25°C');

IF NOT EXISTS (SELECT 1 FROM dbo.Productos WHERE Sku = N'SKU-00923')
    INSERT INTO dbo.Productos (ProductoId, Sku, CodigoBarras, Nombre, PrincipioActivo, Concentracion, Presentacion, Laboratorio, Categoria, RegistroSanitario, CondicionVenta, RequiereReceta, UnidadInventario, StockMinimo, PrecioVentaCentimos, GravadoIgv, IgvPorcentaje, UbicacionPasillo, UbicacionEstante, TemperaturaAlmacen)
    VALUES (N'PROD-006', N'SKU-00923', N'7750100000923', N'Insulina Humana NPH', N'Insulina Humana Isófana', N'100 UI/mL', N'Vial 10 mL', N'Bayer', N'Endocrinología', N'BE-00874', N'RECETA', 1, N'Vial', 5, 8500, 0, 0.00, N'F - Cadena Frío', N'REF-01', N'2°C - 8°C');

IF NOT EXISTS (SELECT 1 FROM dbo.Productos WHERE Sku = N'SKU-71200')
    INSERT INTO dbo.Productos (ProductoId, Sku, CodigoBarras, Nombre, PrincipioActivo, Concentracion, Presentacion, Laboratorio, Categoria, RegistroSanitario, CondicionVenta, RequiereReceta, UnidadInventario, StockMinimo, PrecioVentaCentimos, GravadoIgv, IgvPorcentaje, UbicacionPasillo, UbicacionEstante, TemperaturaAlmacen)
    VALUES (N'PROD-007', N'SKU-71200', N'7750100071200', N'Azitromicina 500mg', N'Azitromicina', N'500mg', N'Caja x 6 Tabletas', N'Laboratorios FarmaPerú', N'Antibióticos', N'EN-06110', N'RECETA', 1, N'Caja', 20, 1950, 1, 18.00, N'B - Antibióticos', N'04 / A', N'15°C - 25°C');

-- Lotes con fechas relativas (vencido, por vencer en <30d, stock bajo y saludable)
DECLARE @Hoy DATE = CAST(SYSDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SA Pacific Standard Time' AS DATE);

IF NOT EXISTS (SELECT 1 FROM dbo.Lotes WHERE LoteId = N'LOT-001')
BEGIN
    -- Paracetamol: stock bajo (14 < min 25)
    INSERT INTO dbo.Lotes (LoteId, ProductoId, SucursalId, NumeroLote, FechaVencimiento, CostoAdquisicionCentimos, CantidadFisica, CantidadDisponible, EstadoAptitud)
    VALUES (N'LOT-001', N'PROD-001', N'SUC-001', N'L-PAR-241', DATEADD(DAY, 180, @Hoy), 650, 14, 14, N'APTO');

    -- Amoxicilina: 2 lotes FEFO (uno vence en 22 días < 30 días, otro en 360 días)
    INSERT INTO dbo.Lotes (LoteId, ProductoId, SucursalId, NumeroLote, FechaVencimiento, CostoAdquisicionCentimos, CantidadFisica, CantidadDisponible, EstadoAptitud)
    VALUES (N'LOT-002', N'PROD-002', N'SUC-001', N'L-8842', DATEADD(DAY, 22, @Hoy), 1250, 18, 18, N'APTO');
    INSERT INTO dbo.Lotes (LoteId, ProductoId, SucursalId, NumeroLote, FechaVencimiento, CostoAdquisicionCentimos, CantidadFisica, CantidadDisponible, EstadoAptitud)
    VALUES (N'LOT-003', N'PROD-002', N'SUC-001', N'L-9015', DATEADD(DAY, 360, @Hoy), 1280, 42, 42, N'APTO');

    -- Ibuprofeno: saludable
    INSERT INTO dbo.Lotes (LoteId, ProductoId, SucursalId, NumeroLote, FechaVencimiento, CostoAdquisicionCentimos, CantidadFisica, CantidadDisponible, EstadoAptitud)
    VALUES (N'LOT-004', N'PROD-003', N'SUC-001', N'L-IBU-104', DATEADD(DAY, 420, @Hoy), 410, 120, 120, N'APTO');

    -- Loratadina: saludable
    INSERT INTO dbo.Lotes (LoteId, ProductoId, SucursalId, NumeroLote, FechaVencimiento, CostoAdquisicionCentimos, CantidadFisica, CantidadDisponible, EstadoAptitud)
    VALUES (N'LOT-005', N'PROD-004', N'SUC-001', N'L-LOR-509', DATEADD(DAY, 300, @Hoy), 780, 55, 55, N'APTO');

    -- Omeprazol: stock bajo (8 < min 15)
    INSERT INTO dbo.Lotes (LoteId, ProductoId, SucursalId, NumeroLote, FechaVencimiento, CostoAdquisicionCentimos, CantidadFisica, CantidadDisponible, EstadoAptitud)
    VALUES (N'LOT-006', N'PROD-005', N'SUC-001', N'L-OME-310', DATEADD(DAY, 210, @Hoy), 1500, 8, 8, N'APTO');

    -- Insulina: lote vencido (no vendible, física 3, disponible 0)
    INSERT INTO dbo.Lotes (LoteId, ProductoId, SucursalId, NumeroLote, FechaVencimiento, CostoAdquisicionCentimos, CantidadFisica, CantidadDisponible, EstadoAptitud, Observacion)
    VALUES (N'LOT-007', N'PROD-006', N'SUC-001', N'L-INS-EXP', DATEADD(DAY, -12, @Hoy), 4500, 3, 0, N'VENCIDO', N'Retirar de estante REF-01');

    -- Azitromicina: por vencer en 18 días
    INSERT INTO dbo.Lotes (LoteId, ProductoId, SucursalId, NumeroLote, FechaVencimiento, CostoAdquisicionCentimos, CantidadFisica, CantidadDisponible, EstadoAptitud)
    VALUES (N'LOT-008', N'PROD-007', N'SUC-001', N'L-AZI-077', DATEADD(DAY, 18, @Hoy), 980, 24, 24, N'APTO');

    -- Movimientos iniciales trazables en Kardex
    INSERT INTO dbo.MovimientosStock (SucursalId, ProductoId, LoteId, Tipo, DocumentoRef, CantidadEntrada, CantidadSalida, SaldoProductoResultante, CostoUnitarioCentimos, Motivo, ResponsableId, ResponsableUsername)
    VALUES
        (N'SUC-001', N'PROD-001', N'LOT-001', N'COMPRA', N'GUI-F020-101', 14, 0, 14, 650, N'Carga inicial demo', @AdminId, @AdminUser),
        (N'SUC-001', N'PROD-002', N'LOT-002', N'COMPRA', N'GUI-F020-102', 18, 0, 18, 1250, N'Carga inicial demo', @AdminId, @AdminUser),
        (N'SUC-001', N'PROD-002', N'LOT-003', N'COMPRA', N'GUI-F020-103', 42, 0, 60, 1280, N'Carga inicial demo', @AdminId, @AdminUser),
        (N'SUC-001', N'PROD-003', N'LOT-004', N'COMPRA', N'GUI-F020-104', 120, 0, 120, 410, N'Carga inicial demo', @AdminId, @AdminUser),
        (N'SUC-001', N'PROD-004', N'LOT-005', N'COMPRA', N'GUI-F020-105', 55, 0, 55, 780, N'Carga inicial demo', @AdminId, @AdminUser),
        (N'SUC-001', N'PROD-005', N'LOT-006', N'COMPRA', N'GUI-F020-106', 8, 0, 8, 1500, N'Carga inicial demo', @AdminId, @AdminUser),
        (N'SUC-001', N'PROD-006', N'LOT-007', N'COMPRA', N'GUI-F020-107', 3, 0, 3, 4500, N'Carga inicial demo', @AdminId, @AdminUser),
        (N'SUC-001', N'PROD-007', N'LOT-008', N'COMPRA', N'GUI-F020-108', 24, 0, 24, 980, N'Carga inicial demo', @AdminId, @AdminUser);
END
GO

-- Orden de compra pendiente / enviada de demostración
DECLARE @AdminId2 NVARCHAR(36);
SELECT TOP 1 @AdminId2 = UsuarioId FROM dbo.Usuarios WHERE Activo = 1 ORDER BY CreadoEn ASC;
DECLARE @Hoy2 DATE = CAST(SYSDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SA Pacific Standard Time' AS DATE);

IF NOT EXISTS (SELECT 1 FROM dbo.OrdenesCompra WHERE NumeroOrden = N'PO-2026-001')
BEGIN
    INSERT INTO dbo.OrdenesCompra (OrdenId, NumeroOrden, SucursalId, ProveedorId, Estado, Urgencia, FechaEstimadaEntrega, SubtotalEstimadoCentimos, Observaciones, CreadoPor)
    VALUES (N'ORD-001', N'PO-2026-001', N'SUC-001', N'PROV-001', N'PENDIENTE', N'CRITICA', DATEADD(DAY, 2, @Hoy2), 45500, N'Reposición urgente de stock crítico', @AdminId2);

    INSERT INTO dbo.OrdenCompraDetalle (OrdenDetalleId, OrdenId, ProductoId, CantidadSolicitada, CantidadRecibida, CostoUnitarioCentimos)
    VALUES
        (N'ORDD-001', N'ORD-001', N'PROD-001', 40, 0, 650),
        (N'ORDD-002', N'ORD-001', N'PROD-005', 13, 0, 1500);
END
GO
