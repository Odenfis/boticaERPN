export type AppTab =
  | 'dashboard'
  | 'pos'
  | 'inventario'
  | 'compras'
  | 'kardex'
  | 'caja'
  | 'reportes'
  | 'configuracion';

export interface SqlHealthStatus {
  engine: 'Microsoft SQL Server';
  configured: boolean;
  connected: boolean;
  server?: string;
  database?: string;
  message: string;
}

export interface AuthUser {
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

export interface OpenShiftSummary {
  turnoId: string;
  codigoTurno: string;
  estado: 'ABIERTO' | 'CERRADO';
  fechaApertura: string;
  fondoInicialCentimos: number;
  usuarioAperturaNombre: string;
}

export interface ProductRow {
  productoId: string;
  sku: string;
  codigoBarras: string | null;
  nombre: string;
  principioActivo: string;
  concentracion: string;
  presentacion: string;
  laboratorio: string;
  categoria: string;
  registroSanitario: string | null;
  condicionVenta: 'OTC' | 'RECETA';
  requiereReceta: boolean;
  unidadInventario: string;
  stockMinimo: number;
  precioVentaCentimos: number;
  gravadoIgv: boolean;
  igvPorcentaje: number;
  ubicacionPasillo: string | null;
  ubicacionEstante: string | null;
  temperaturaAlmacen: string | null;
  activo: boolean;
  stockFisico: number;
  stockDisponible: number;
  proximoVencimiento: string | null;
  costoPromedioCentimos: number;
  valorInventarioCentimos: number;
  tieneLotesVencidos: boolean;
  tieneLotesPorVencer: boolean;
}

export interface LotRow {
  loteId: string;
  productoId: string;
  sucursalId: string;
  numeroLote: string;
  fechaVencimiento: string;
  costoAdquisicionCentimos: number;
  cantidadFisica: number;
  cantidadDisponible: number;
  estadoAptitud: 'APTO' | 'BLOQUEADO' | 'CUARENTENA' | 'VENCIDO';
  observacion: string | null;
  creadoEn: string;
}

export interface SupplierRow {
  proveedorId: string;
  ruc: string;
  razonSocial: string;
  contactoNombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  activo: boolean;
  ultimaCompraFecha: string | null;
  ordenesCount: number;
}

export interface PurchaseOrderItem {
  ordenDetalleId: string;
  productoId: string;
  sku: string;
  productoNombre: string;
  presentacion: string;
  cantidadSolicitada: number;
  cantidadRecibida: number;
  costoUnitarioCentimos: number;
}

export interface PurchaseOrderRow {
  ordenId: string;
  numeroOrden: string;
  proveedorId: string;
  proveedorNombre: string;
  proveedorRuc: string;
  estado: 'PENDIENTE' | 'ENVIADO' | 'RECIBIDO' | 'COMPLETADO' | 'CANCELADO';
  urgencia: 'NORMAL' | 'CRITICA';
  fechaEstimadaEntrega: string | null;
  subtotalEstimadoCentimos: number;
  observaciones: string | null;
  creadoEn: string;
  totalUnidadesSolicitadas: number;
  totalUnidadesRecibidas: number;
  items: PurchaseOrderItem[];
}

export interface ClientRow {
  clienteId: string;
  tipoDocumento: 'DNI' | 'RUC' | 'CE' | 'SIN_DOC';
  numeroDocumento: string;
  nombreRazonSocial: string;
  telefono: string | null;
  direccion: string | null;
}

export interface SaleHistoryRow {
  ventaId: string;
  numeroTicket: string;
  estado: 'COMPLETADA' | 'ANULADA';
  creadoEn: string;
  vendedorNombre: string;
  clienteNombre: string | null;
  clienteDocumento: string | null;
  subtotalBrutoCentimos: number;
  descuentoTotalCentimos: number;
  baseImponibleCentimos: number;
  igvCentimos: number;
  totalCentimos: number;
  recetaReferencia: string | null;
  validadoPorNombre: string | null;
  validadoEn: string | null;
  motivoAnulacion: string | null;
  anuladoEn: string | null;
  mediosPago: Array<{
    medioPago: 'EFECTIVO' | 'VISA' | 'MASTERCARD' | 'TRANSFERENCIA_YAPE';
    montoCentimos: number;
    efectivoRecibidoCentimos: number | null;
    vueltoCentimos: number | null;
    referenciaOperacion: string | null;
  }>;
  items: Array<{
    ventaDetalleId: string;
    productoId: string;
    sku: string;
    productoNombre: string;
    cantidad: number;
    precioUnitarioCentimos: number;
    descuentoPorcentaje: number;
    subtotalCentimos: number;
    lotes: Array<{
      loteId: string;
      numeroLote: string;
      cantidad: number;
    }>;
  }>;
}

export interface DashboardData {
  kpis: {
    ventasHoyCentimos: number;
    ventasAyerCentimos: number;
    porVencerCount: number;
    stockBajoCount: number;
    pedidosPendientesCount: number;
    ventanaAlertaDias: number;
  };
  metaMensual: {
    configurada: boolean;
    metaCentimos: number | null;
    acumuladoMesCentimos: number;
    diasRestantesMes: number;
  };
  alertas: Array<{
    id: string;
    severidad: 'error' | 'warning' | 'info';
    titulo: string;
    detalle: string;
    destinoTab: AppTab;
    filtro?: string;
  }>;
  ultimosMovimientos: Array<{
    movimientoId: number;
    productoId: string;
    sku: string;
    productoNombre: string;
    categoria: string;
    stockActual: number;
    stockMinimo: number;
    proximoVencimiento: string | null;
    estadoStock: 'OPTIMO' | 'BAJO' | 'CRITICO';
  }>;
  actividadReciente: Array<{
    id: string;
    tipo: 'VENTA' | 'COMPRA' | 'AJUSTE' | 'ANULACION';
    titulo: string;
    subtitulo: string;
    fechaHora: string;
  }>;
}

export interface CashBoxData {
  turnoActual: {
    turnoId: string;
    codigoTurno: string;
    estado: 'ABIERTO' | 'CERRADO';
    fechaApertura: string;
    fechaCierre: string | null;
    usuarioAperturaNombre: string;
    usuarioCierreNombre: string | null;
    fondoInicialCentimos: number;
    efectivoTeoricoCentimos: number;
    efectivoContadoCentimos: number | null;
    diferenciaCentimos: number | null;
    motivoDescuadre: string | null;
    resumenMedios: {
      EFECTIVO: { totalCentimos: number; transacciones: number };
      VISA: { totalCentimos: number; transacciones: number };
      MASTERCARD: { totalCentimos: number; transacciones: number };
      TRANSFERENCIA_YAPE: { totalCentimos: number; transacciones: number };
    };
    ingresosEfectivoCentimos: number;
    retirosEfectivoCentimos: number;
    devolucionesEfectivoCentimos: number;
    totalBrutoCentimos: number;
    totalDescuentosCentimos: number;
    totalIgvCentimos: number;
    totalAnulacionesCentimos: number;
    totalNetoCentimos: number;
  } | null;
  ultimasTransacciones: Array<{
    ventaId: string;
    numeroTicket: string;
    hora: string;
    medioPago: string;
    montoCentimos: number;
    estado: 'COMPLETADA' | 'ANULADA';
  }>;
  movimientosCaja: Array<{
    movimientoCajaId: string;
    tipo: 'INGRESO' | 'RETIRO' | 'DEVOLUCION_EFECTIVO';
    montoCentimos: number;
    motivo: string;
    referencia: string | null;
    usuarioNombre: string;
    creadoEn: string;
  }>;
  turnosCerrados: Array<{
    turnoId: string;
    codigoTurno: string;
    fechaApertura: string;
    fechaCierre: string;
    usuarioCierreNombre: string;
    fondoInicialCentimos: number;
    efectivoTeoricoCentimos: number;
    efectivoContadoCentimos: number;
    diferenciaCentimos: number;
    totalNetoCentimos: number;
  }>;
}

export interface ReportsData {
  resumen: {
    ventasBrutasCentimos: number;
    descuentosCentimos: number;
    anulacionesCentimos: number;
    ventasNetasCentimos: number;
    igvNetoCentimos: number;
    totalTransacciones: number;
  };
  definicion: {
    bruto: string;
    neto: string;
  };
  metasYComisiones: {
    metaConfigurada: boolean;
    metaMensualCentimos: number | null;
    comisionConfigurada: boolean;
    porcentajeComision: number | null;
  };
  serieTemporal: Array<{
    etiqueta: string;
    ventasNetasCentimos: number;
    ventasBrutasCentimos: number;
    proyeccionCentimos: number | null;
  }>;
  porMedioPago: Array<{
    medioPago: string;
    transacciones: number;
    totalCentimos: number;
  }>;
  topProductos: Array<{
    productoId: string;
    sku: string;
    nombre: string;
    categoria: string;
    unidadesVendidas: number;
    totalCentimos: number;
  }>;
  porVendedor: Array<{
    usuarioId: string;
    nombreCompleto: string;
    cargo: string;
    transacciones: number;
    ticketPromedioCentimos: number;
    totalCentimos: number;
    comisionCentimos: number | null;
    estadoMeta: string;
  }>;
  vendedoresCatalogo: Array<{ usuarioId: string; nombreCompleto: string }>;
}
