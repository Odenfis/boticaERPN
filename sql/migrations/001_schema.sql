-- Botica ERP - Fase 1
-- Migración 001: Esquema relacional completo en Microsoft SQL Server (T-SQL)
-- Todas las cantidades monetarias se almacenan en céntimos (BIGINT, PEN S/).
-- Las fechas operativas se manejan en zona horaria America/Lima.

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.SchemaMigrations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SchemaMigrations (
        MigrationId NVARCHAR(100) NOT NULL PRIMARY KEY,
        AppliedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SchemaMigrations_AppliedAt DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'dbo.Sucursales', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Sucursales (
        SucursalId NVARCHAR(36) NOT NULL PRIMARY KEY,
        Codigo NVARCHAR(20) NOT NULL UNIQUE,
        Nombre NVARCHAR(120) NOT NULL,
        Direccion NVARCHAR(200) NOT NULL,
        Ruc NVARCHAR(11) NOT NULL,
        Telefono NVARCHAR(30) NULL,
        Activo BIT NOT NULL CONSTRAINT DF_Sucursales_Activo DEFAULT 1,
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_Sucursales_CreadoEn DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'dbo.Cajas', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Cajas (
        CajaId NVARCHAR(36) NOT NULL PRIMARY KEY,
        SucursalId NVARCHAR(36) NOT NULL CONSTRAINT FK_Cajas_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        Codigo NVARCHAR(20) NOT NULL,
        Nombre NVARCHAR(80) NOT NULL,
        Activo BIT NOT NULL CONSTRAINT DF_Cajas_Activo DEFAULT 1,
        CONSTRAINT UQ_Cajas_Sucursal_Codigo UNIQUE (SucursalId, Codigo)
    );
END
GO

IF OBJECT_ID(N'dbo.Usuarios', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Usuarios (
        UsuarioId NVARCHAR(36) NOT NULL PRIMARY KEY,
        Username NVARCHAR(60) NOT NULL UNIQUE,
        NombreCompleto NVARCHAR(140) NOT NULL,
        Cargo NVARCHAR(80) NOT NULL,
        PasswordHash NVARCHAR(255) NOT NULL,
        Activo BIT NOT NULL CONSTRAINT DF_Usuarios_Activo DEFAULT 1,
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_Usuarios_CreadoEn DEFAULT SYSUTCDATETIME(),
        ActualizadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_Usuarios_ActualizadoEn DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'dbo.Roles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Roles (
        RolId NVARCHAR(36) NOT NULL PRIMARY KEY,
        Codigo NVARCHAR(40) NOT NULL UNIQUE,
        Nombre NVARCHAR(80) NOT NULL,
        Descripcion NVARCHAR(240) NULL
    );
END
GO

IF OBJECT_ID(N'dbo.Permisos', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Permisos (
        PermisoId NVARCHAR(36) NOT NULL PRIMARY KEY,
        Codigo NVARCHAR(80) NOT NULL UNIQUE,
        Modulo NVARCHAR(50) NOT NULL,
        Descripcion NVARCHAR(200) NOT NULL
    );
END
GO

IF OBJECT_ID(N'dbo.UsuarioRol', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UsuarioRol (
        UsuarioId NVARCHAR(36) NOT NULL CONSTRAINT FK_UsuarioRol_Usuarios REFERENCES dbo.Usuarios(UsuarioId),
        RolId NVARCHAR(36) NOT NULL CONSTRAINT FK_UsuarioRol_Roles REFERENCES dbo.Roles(RolId),
        AsignadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_UsuarioRol_AsignadoEn DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_UsuarioRol PRIMARY KEY (UsuarioId, RolId)
    );
END
GO

IF OBJECT_ID(N'dbo.RolPermiso', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RolPermiso (
        RolId NVARCHAR(36) NOT NULL CONSTRAINT FK_RolPermiso_Roles REFERENCES dbo.Roles(RolId),
        PermisoId NVARCHAR(36) NOT NULL CONSTRAINT FK_RolPermiso_Permisos REFERENCES dbo.Permisos(PermisoId),
        CONSTRAINT PK_RolPermiso PRIMARY KEY (RolId, PermisoId)
    );
END
GO

IF OBJECT_ID(N'dbo.UsuarioSucursal', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UsuarioSucursal (
        UsuarioId NVARCHAR(36) NOT NULL CONSTRAINT FK_UsuarioSucursal_Usuarios REFERENCES dbo.Usuarios(UsuarioId),
        SucursalId NVARCHAR(36) NOT NULL CONSTRAINT FK_UsuarioSucursal_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        Activo BIT NOT NULL CONSTRAINT DF_UsuarioSucursal_Activo DEFAULT 1,
        AsignadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_UsuarioSucursal_AsignadoEn DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_UsuarioSucursal PRIMARY KEY (UsuarioId, SucursalId)
    );
END
GO

IF OBJECT_ID(N'dbo.Sesiones', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Sesiones (
        SesionId NVARCHAR(36) NOT NULL PRIMARY KEY,
        UsuarioId NVARCHAR(36) NOT NULL CONSTRAINT FK_Sesiones_Usuarios REFERENCES dbo.Usuarios(UsuarioId),
        SucursalId NVARCHAR(36) NOT NULL CONSTRAINT FK_Sesiones_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        TokenHash NVARCHAR(128) NOT NULL UNIQUE,
        ExpiraEn DATETIME2(3) NOT NULL,
        Revocada BIT NOT NULL CONSTRAINT DF_Sesiones_Revocada DEFAULT 0,
        RevocadaEn DATETIME2(3) NULL,
        MotivoRevocacion NVARCHAR(150) NULL,
        IpOrigen NVARCHAR(64) NULL,
        UserAgent NVARCHAR(250) NULL,
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_Sesiones_CreadoEn DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_Sesiones_Usuario_Activas ON dbo.Sesiones(UsuarioId, Revocada, ExpiraEn);
END
GO

IF OBJECT_ID(N'dbo.ConfiguracionParametros', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ConfiguracionParametros (
        SucursalId NVARCHAR(36) NOT NULL PRIMARY KEY CONSTRAINT FK_ConfigParam_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        IgvPorcentaje DECIMAL(5,2) NOT NULL CONSTRAINT DF_ConfigParam_Igv DEFAULT 18.00,
        VentanaAlertaDias INT NOT NULL CONSTRAINT DF_ConfigParam_AlertaDias DEFAULT 30,
        MetaMensualCentimos BIGINT NULL,
        PorcentajeComision DECIMAL(5,2) NULL,
        ActualizadoPor NVARCHAR(36) NULL,
        ActualizadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_ConfigParam_ActualizadoEn DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'dbo.Proveedores', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Proveedores (
        ProveedorId NVARCHAR(36) NOT NULL PRIMARY KEY,
        Ruc NVARCHAR(11) NOT NULL UNIQUE,
        RazonSocial NVARCHAR(160) NOT NULL,
        ContactoNombre NVARCHAR(120) NOT NULL,
        Telefono NVARCHAR(40) NULL,
        Email NVARCHAR(120) NULL,
        Direccion NVARCHAR(200) NULL,
        Activo BIT NOT NULL CONSTRAINT DF_Proveedores_Activo DEFAULT 1,
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_Proveedores_CreadoEn DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'dbo.Productos', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Productos (
        ProductoId NVARCHAR(36) NOT NULL PRIMARY KEY,
        Sku NVARCHAR(40) NOT NULL UNIQUE,
        CodigoBarras NVARCHAR(64) NULL,
        Nombre NVARCHAR(180) NOT NULL,
        PrincipioActivo NVARCHAR(180) NOT NULL,
        Concentracion NVARCHAR(80) NOT NULL,
        Presentacion NVARCHAR(120) NOT NULL,
        Laboratorio NVARCHAR(120) NOT NULL,
        Categoria NVARCHAR(80) NOT NULL,
        RegistroSanitario NVARCHAR(60) NULL,
        CondicionVenta NVARCHAR(20) NOT NULL CONSTRAINT CK_Productos_CondicionVenta CHECK (CondicionVenta IN ('OTC', 'RECETA')),
        RequiereReceta BIT NOT NULL CONSTRAINT DF_Productos_RequiereReceta DEFAULT 0,
        UnidadInventario NVARCHAR(40) NOT NULL CONSTRAINT DF_Productos_Unidad DEFAULT 'Unidad',
        StockMinimo INT NOT NULL CONSTRAINT DF_Productos_StockMinimo DEFAULT 10 CHECK (StockMinimo >= 0),
        PrecioVentaCentimos BIGINT NOT NULL CHECK (PrecioVentaCentimos >= 0),
        GravadoIgv BIT NOT NULL CONSTRAINT DF_Productos_GravadoIgv DEFAULT 1,
        IgvPorcentaje DECIMAL(5,2) NOT NULL CONSTRAINT DF_Productos_IgvPorcentaje DEFAULT 18.00,
        UbicacionPasillo NVARCHAR(60) NULL,
        UbicacionEstante NVARCHAR(60) NULL,
        TemperaturaAlmacen NVARCHAR(60) NULL,
        Activo BIT NOT NULL CONSTRAINT DF_Productos_Activo DEFAULT 1,
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_Productos_CreadoEn DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_Productos_Busqueda ON dbo.Productos(Nombre, PrincipioActivo, Categoria, Laboratorio);
    CREATE INDEX IX_Productos_CodigoBarras ON dbo.Productos(CodigoBarras) WHERE CodigoBarras IS NOT NULL;
END
GO

IF OBJECT_ID(N'dbo.Lotes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Lotes (
        LoteId NVARCHAR(36) NOT NULL PRIMARY KEY,
        ProductoId NVARCHAR(36) NOT NULL CONSTRAINT FK_Lotes_Productos REFERENCES dbo.Productos(ProductoId),
        SucursalId NVARCHAR(36) NOT NULL CONSTRAINT FK_Lotes_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        NumeroLote NVARCHAR(60) NOT NULL,
        FechaVencimiento DATE NOT NULL,
        CostoAdquisicionCentimos BIGINT NOT NULL CHECK (CostoAdquisicionCentimos >= 0),
        CantidadFisica INT NOT NULL CHECK (CantidadFisica >= 0),
        CantidadDisponible INT NOT NULL CHECK (CantidadDisponible >= 0),
        EstadoAptitud NVARCHAR(20) NOT NULL CONSTRAINT DF_Lotes_EstadoAptitud DEFAULT 'APTO'
            CONSTRAINT CK_Lotes_EstadoAptitud CHECK (EstadoAptitud IN ('APTO', 'BLOQUEADO', 'CUARENTENA', 'VENCIDO')),
        Observacion NVARCHAR(240) NULL,
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_Lotes_CreadoEn DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_Lotes_Producto_Sucursal_Numero UNIQUE (ProductoId, SucursalId, NumeroLote)
    );
    CREATE INDEX IX_Lotes_FEFO ON dbo.Lotes(ProductoId, SucursalId, EstadoAptitud, FechaVencimiento)
        INCLUDE (CantidadDisponible, CantidadFisica, CostoAdquisicionCentimos);
END
GO

IF OBJECT_ID(N'dbo.OrdenesCompra', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OrdenesCompra (
        OrdenId NVARCHAR(36) NOT NULL PRIMARY KEY,
        NumeroOrden NVARCHAR(30) NOT NULL UNIQUE,
        SucursalId NVARCHAR(36) NOT NULL CONSTRAINT FK_OrdenesCompra_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        ProveedorId NVARCHAR(36) NOT NULL CONSTRAINT FK_OrdenesCompra_Proveedores REFERENCES dbo.Proveedores(ProveedorId),
        Estado NVARCHAR(20) NOT NULL CONSTRAINT CK_OrdenesCompra_Estado CHECK (Estado IN ('PENDIENTE', 'ENVIADO', 'RECIBIDO', 'COMPLETADO', 'CANCELADO')),
        Urgencia NVARCHAR(20) NOT NULL CONSTRAINT DF_OrdenesCompra_Urgencia DEFAULT 'NORMAL'
            CONSTRAINT CK_OrdenesCompra_Urgencia CHECK (Urgencia IN ('NORMAL', 'CRITICA')),
        FechaEstimadaEntrega DATE NULL,
        SubtotalEstimadoCentimos BIGINT NOT NULL DEFAULT 0,
        Observaciones NVARCHAR(300) NULL,
        CreadoPor NVARCHAR(36) NOT NULL CONSTRAINT FK_OrdenesCompra_Usuarios REFERENCES dbo.Usuarios(UsuarioId),
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_OrdenesCompra_CreadoEn DEFAULT SYSUTCDATETIME(),
        ActualizadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_OrdenesCompra_ActualizadoEn DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'dbo.OrdenCompraDetalle', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OrdenCompraDetalle (
        OrdenDetalleId NVARCHAR(36) NOT NULL PRIMARY KEY,
        OrdenId NVARCHAR(36) NOT NULL CONSTRAINT FK_OrdenDetalle_Orden REFERENCES dbo.OrdenesCompra(OrdenId),
        ProductoId NVARCHAR(36) NOT NULL CONSTRAINT FK_OrdenDetalle_Producto REFERENCES dbo.Productos(ProductoId),
        CantidadSolicitada INT NOT NULL CHECK (CantidadSolicitada > 0),
        CantidadRecibida INT NOT NULL CONSTRAINT DF_OrdenDetalle_Recibida DEFAULT 0 CHECK (CantidadRecibida >= 0),
        CostoUnitarioCentimos BIGINT NOT NULL CHECK (CostoUnitarioCentimos >= 0)
    );
END
GO

IF OBJECT_ID(N'dbo.Recepciones', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Recepciones (
        RecepcionId NVARCHAR(36) NOT NULL PRIMARY KEY,
        OrdenId NVARCHAR(36) NULL CONSTRAINT FK_Recepciones_Ordenes REFERENCES dbo.OrdenesCompra(OrdenId),
        SucursalId NVARCHAR(36) NOT NULL CONSTRAINT FK_Recepciones_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        ProveedorId NVARCHAR(36) NOT NULL CONSTRAINT FK_Recepciones_Proveedores REFERENCES dbo.Proveedores(ProveedorId),
        DocumentoReferencia NVARCHAR(60) NOT NULL,
        IdempotencyKey NVARCHAR(100) NOT NULL UNIQUE,
        RecibidoPor NVARCHAR(36) NOT NULL CONSTRAINT FK_Recepciones_Usuarios REFERENCES dbo.Usuarios(UsuarioId),
        Observaciones NVARCHAR(300) NULL,
        RecibidoEn DATETIME2(3) NOT NULL CONSTRAINT DF_Recepciones_RecibidoEn DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'dbo.RecepcionDetalle', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RecepcionDetalle (
        RecepcionDetalleId NVARCHAR(36) NOT NULL PRIMARY KEY,
        RecepcionId NVARCHAR(36) NOT NULL CONSTRAINT FK_RecepcionDet_Recepcion REFERENCES dbo.Recepciones(RecepcionId),
        OrdenDetalleId NVARCHAR(36) NULL CONSTRAINT FK_RecepcionDet_OrdenDet REFERENCES dbo.OrdenCompraDetalle(OrdenDetalleId),
        ProductoId NVARCHAR(36) NOT NULL CONSTRAINT FK_RecepcionDet_Producto REFERENCES dbo.Productos(ProductoId),
        LoteId NVARCHAR(36) NOT NULL CONSTRAINT FK_RecepcionDet_Lote REFERENCES dbo.Lotes(LoteId),
        NumeroLote NVARCHAR(60) NOT NULL,
        FechaVencimiento DATE NOT NULL,
        CantidadRecibida INT NOT NULL CHECK (CantidadRecibida > 0),
        CostoUnitarioCentimos BIGINT NOT NULL CHECK (CostoUnitarioCentimos >= 0)
    );
END
GO

IF OBJECT_ID(N'dbo.Clientes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Clientes (
        ClienteId NVARCHAR(36) NOT NULL PRIMARY KEY,
        TipoDocumento NVARCHAR(15) NOT NULL CONSTRAINT CK_Clientes_TipoDoc CHECK (TipoDocumento IN ('DNI', 'RUC', 'CE', 'SIN_DOC')),
        NumeroDocumento NVARCHAR(20) NOT NULL UNIQUE,
        NombreRazonSocial NVARCHAR(180) NOT NULL,
        Telefono NVARCHAR(40) NULL,
        Direccion NVARCHAR(200) NULL,
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_Clientes_CreadoEn DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'dbo.TurnosCaja', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TurnosCaja (
        TurnoId NVARCHAR(36) NOT NULL PRIMARY KEY,
        CodigoTurno NVARCHAR(30) NOT NULL UNIQUE,
        SucursalId NVARCHAR(36) NOT NULL CONSTRAINT FK_TurnosCaja_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        CajaId NVARCHAR(36) NOT NULL CONSTRAINT FK_TurnosCaja_Cajas REFERENCES dbo.Cajas(CajaId),
        UsuarioAperturaId NVARCHAR(36) NOT NULL CONSTRAINT FK_TurnosCaja_UApertura REFERENCES dbo.Usuarios(UsuarioId),
        UsuarioCierreId NVARCHAR(36) NULL CONSTRAINT FK_TurnosCaja_UCierre REFERENCES dbo.Usuarios(UsuarioId),
        FechaApertura DATETIME2(3) NOT NULL CONSTRAINT DF_TurnosCaja_Apertura DEFAULT SYSUTCDATETIME(),
        FechaCierre DATETIME2(3) NULL,
        Estado NVARCHAR(20) NOT NULL CONSTRAINT CK_TurnosCaja_Estado CHECK (Estado IN ('ABIERTO', 'CERRADO')),
        FondoInicialCentimos BIGINT NOT NULL CHECK (FondoInicialCentimos >= 0),
        EfectivoTeoricoCentimos BIGINT NULL,
        EfectivoContadoCentimos BIGINT NULL,
        DiferenciaCentimos BIGINT NULL,
        MotivoDescuadre NVARCHAR(500) NULL,
        TotalBrutoCentimos BIGINT NULL,
        TotalIgvCentimos BIGINT NULL,
        TotalAnulacionesCentimos BIGINT NULL,
        ReporteZJson NVARCHAR(MAX) NULL,
        IdempotencyCierreKey NVARCHAR(100) NULL
    );
    CREATE UNIQUE INDEX UX_TurnosCaja_UnicoAbierto ON dbo.TurnosCaja(CajaId) WHERE Estado = 'ABIERTO';
    CREATE UNIQUE INDEX UX_TurnosCaja_IdempotencyCierre ON dbo.TurnosCaja(IdempotencyCierreKey) WHERE IdempotencyCierreKey IS NOT NULL;
END
GO

IF OBJECT_ID(N'dbo.MovimientosCaja', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MovimientosCaja (
        MovimientoCajaId NVARCHAR(36) NOT NULL PRIMARY KEY,
        TurnoId NVARCHAR(36) NOT NULL CONSTRAINT FK_MovCaja_Turnos REFERENCES dbo.TurnosCaja(TurnoId),
        SucursalId NVARCHAR(36) NOT NULL CONSTRAINT FK_MovCaja_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        Tipo NVARCHAR(30) NOT NULL CONSTRAINT CK_MovCaja_Tipo CHECK (Tipo IN ('INGRESO', 'RETIRO', 'DEVOLUCION_EFECTIVO')),
        MontoCentimos BIGINT NOT NULL CHECK (MontoCentimos > 0),
        Motivo NVARCHAR(240) NOT NULL,
        Referencia NVARCHAR(80) NULL,
        UsuarioId NVARCHAR(36) NOT NULL CONSTRAINT FK_MovCaja_Usuarios REFERENCES dbo.Usuarios(UsuarioId),
        IdempotencyKey NVARCHAR(100) NULL,
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_MovCaja_CreadoEn DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_MovCaja_Idempotency ON dbo.MovimientosCaja(IdempotencyKey) WHERE IdempotencyKey IS NOT NULL;
END
GO

IF OBJECT_ID(N'dbo.ValidacionesReceta', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ValidacionesReceta (
        ValidacionId NVARCHAR(36) NOT NULL PRIMARY KEY,
        SucursalId NVARCHAR(36) NOT NULL CONSTRAINT FK_ValReceta_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        RecetaReferencia NVARCHAR(100) NOT NULL,
        PacienteNombre NVARCHAR(140) NULL,
        MedicoNombre NVARCHAR(140) NULL,
        Observaciones NVARCHAR(300) NULL,
        ValidadoPor NVARCHAR(36) NOT NULL CONSTRAINT FK_ValReceta_Usuarios REFERENCES dbo.Usuarios(UsuarioId),
        ValidadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_ValReceta_ValidadoEn DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_ValReceta_Ref ON dbo.ValidacionesReceta(SucursalId, RecetaReferencia);
END
GO

IF OBJECT_ID(N'dbo.Ventas', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Ventas (
        VentaId NVARCHAR(36) NOT NULL PRIMARY KEY,
        NumeroTicket NVARCHAR(30) NOT NULL UNIQUE,
        SucursalId NVARCHAR(36) NOT NULL CONSTRAINT FK_Ventas_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        CajaId NVARCHAR(36) NOT NULL CONSTRAINT FK_Ventas_Cajas REFERENCES dbo.Cajas(CajaId),
        TurnoId NVARCHAR(36) NOT NULL CONSTRAINT FK_Ventas_Turnos REFERENCES dbo.TurnosCaja(TurnoId),
        VendedorId NVARCHAR(36) NOT NULL CONSTRAINT FK_Ventas_Vendedor REFERENCES dbo.Usuarios(UsuarioId),
        ClienteId NVARCHAR(36) NULL CONSTRAINT FK_Ventas_Clientes REFERENCES dbo.Clientes(ClienteId),
        Estado NVARCHAR(20) NOT NULL CONSTRAINT CK_Ventas_Estado CHECK (Estado IN ('COMPLETADA', 'ANULADA')),
        SubtotalBrutoCentimos BIGINT NOT NULL,
        DescuentoTotalCentimos BIGINT NOT NULL,
        BaseImponibleCentimos BIGINT NOT NULL,
        IgvCentimos BIGINT NOT NULL,
        TotalCentimos BIGINT NOT NULL,
        RecetaReferencia NVARCHAR(100) NULL,
        ValidacionRecetaId NVARCHAR(36) NULL CONSTRAINT FK_Ventas_ValReceta REFERENCES dbo.ValidacionesReceta(ValidacionId),
        MotivoAnulacion NVARCHAR(300) NULL,
        AnuladoPor NVARCHAR(36) NULL CONSTRAINT FK_Ventas_AnuladoPor REFERENCES dbo.Usuarios(UsuarioId),
        AnuladoEn DATETIME2(3) NULL,
        TurnoCompensacionId NVARCHAR(36) NULL CONSTRAINT FK_Ventas_TurnoComp REFERENCES dbo.TurnosCaja(TurnoId),
        IdempotencyKey NVARCHAR(100) NOT NULL UNIQUE,
        IdempotencyAnulacionKey NVARCHAR(100) NULL,
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_Ventas_CreadoEn DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_Ventas_IdempAnulacion ON dbo.Ventas(IdempotencyAnulacionKey) WHERE IdempotencyAnulacionKey IS NOT NULL;
    CREATE INDEX IX_Ventas_Fecha ON dbo.Ventas(SucursalId, CreadoEn DESC);
END
GO

IF OBJECT_ID(N'dbo.VentaDetalle', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.VentaDetalle (
        VentaDetalleId NVARCHAR(36) NOT NULL PRIMARY KEY,
        VentaId NVARCHAR(36) NOT NULL CONSTRAINT FK_VentaDet_Venta REFERENCES dbo.Ventas(VentaId),
        ProductoId NVARCHAR(36) NOT NULL CONSTRAINT FK_VentaDet_Producto REFERENCES dbo.Productos(ProductoId),
        Cantidad INT NOT NULL CHECK (Cantidad > 0),
        PrecioUnitarioCentimos BIGINT NOT NULL,
        DescuentoPorcentaje DECIMAL(5,2) NOT NULL DEFAULT 0,
        DescuentoCentimos BIGINT NOT NULL DEFAULT 0,
        GravadoIgv BIT NOT NULL,
        IgvPorcentaje DECIMAL(5,2) NOT NULL,
        BaseImponibleCentimos BIGINT NOT NULL,
        IgvCentimos BIGINT NOT NULL,
        SubtotalCentimos BIGINT NOT NULL
    );
END
GO

IF OBJECT_ID(N'dbo.VentaDetalleLotes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.VentaDetalleLotes (
        VentaDetalleLoteId NVARCHAR(36) NOT NULL PRIMARY KEY,
        VentaDetalleId NVARCHAR(36) NOT NULL CONSTRAINT FK_VentaDetLotes_Det REFERENCES dbo.VentaDetalle(VentaDetalleId),
        LoteId NVARCHAR(36) NOT NULL CONSTRAINT FK_VentaDetLotes_Lote REFERENCES dbo.Lotes(LoteId),
        Cantidad INT NOT NULL CHECK (Cantidad > 0),
        CostoUnitarioCentimos BIGINT NOT NULL
    );
END
GO

IF OBJECT_ID(N'dbo.PagosVenta', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PagosVenta (
        PagoId NVARCHAR(36) NOT NULL PRIMARY KEY,
        VentaId NVARCHAR(36) NOT NULL CONSTRAINT FK_PagosVenta_Venta REFERENCES dbo.Ventas(VentaId),
        MedioPago NVARCHAR(30) NOT NULL CONSTRAINT CK_PagosVenta_Medio CHECK (MedioPago IN ('EFECTIVO', 'VISA', 'MASTERCARD', 'TRANSFERENCIA_YAPE')),
        MontoCentimos BIGINT NOT NULL CHECK (MontoCentimos >= 0),
        EfectivoRecibidoCentimos BIGINT NULL,
        VueltoCentimos BIGINT NULL,
        ReferenciaOperacion NVARCHAR(80) NULL
    );
END
GO

IF OBJECT_ID(N'dbo.MovimientosStock', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MovimientosStock (
        MovimientoId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SucursalId NVARCHAR(36) NOT NULL CONSTRAINT FK_MovStock_Sucursales REFERENCES dbo.Sucursales(SucursalId),
        ProductoId NVARCHAR(36) NOT NULL CONSTRAINT FK_MovStock_Productos REFERENCES dbo.Productos(ProductoId),
        LoteId NVARCHAR(36) NOT NULL CONSTRAINT FK_MovStock_Lotes REFERENCES dbo.Lotes(LoteId),
        Tipo NVARCHAR(30) NOT NULL CONSTRAINT CK_MovStock_Tipo CHECK (Tipo IN ('COMPRA', 'VENTA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'ANULACION_ENTRADA')),
        DocumentoRef NVARCHAR(80) NOT NULL,
        CantidadEntrada INT NOT NULL DEFAULT 0 CHECK (CantidadEntrada >= 0),
        CantidadSalida INT NOT NULL DEFAULT 0 CHECK (CantidadSalida >= 0),
        SaldoProductoResultante INT NOT NULL CHECK (SaldoProductoResultante >= 0),
        CostoUnitarioCentimos BIGINT NOT NULL DEFAULT 0,
        Motivo NVARCHAR(240) NULL,
        ResponsableId NVARCHAR(36) NOT NULL CONSTRAINT FK_MovStock_Usuarios REFERENCES dbo.Usuarios(UsuarioId),
        ResponsableUsername NVARCHAR(60) NOT NULL,
        ReferenciaVentaId NVARCHAR(36) NULL CONSTRAINT FK_MovStock_Ventas REFERENCES dbo.Ventas(VentaId),
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_MovStock_CreadoEn DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_MovStock_Kardex ON dbo.MovimientosStock(SucursalId, ProductoId, CreadoEn, MovimientoId);
END
GO

IF OBJECT_ID(N'dbo.ClavesIdempotencia', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ClavesIdempotencia (
        IdempotencyKey NVARCHAR(100) NOT NULL PRIMARY KEY,
        Operacion NVARCHAR(50) NOT NULL,
        EntidadId NVARCHAR(36) NOT NULL,
        RespuestaJson NVARCHAR(MAX) NOT NULL,
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_ClavesIdemp_CreadoEn DEFAULT SYSUTCDATETIME()
    );
END
GO

IF OBJECT_ID(N'dbo.Auditoria', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Auditoria (
        AuditoriaId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SucursalId NVARCHAR(36) NULL,
        UsuarioId NVARCHAR(36) NULL,
        Accion NVARCHAR(80) NOT NULL,
        Entidad NVARCHAR(60) NOT NULL,
        EntidadId NVARCHAR(60) NOT NULL,
        DetalleJson NVARCHAR(MAX) NULL,
        IpOrigen NVARCHAR(64) NULL,
        CreadoEn DATETIME2(3) NOT NULL CONSTRAINT DF_Auditoria_CreadoEn DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_Auditoria_Fecha ON dbo.Auditoria(CreadoEn DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.SchemaMigrations WHERE MigrationId = N'001_schema')
BEGIN
    INSERT INTO dbo.SchemaMigrations (MigrationId) VALUES (N'001_schema');
END
GO
