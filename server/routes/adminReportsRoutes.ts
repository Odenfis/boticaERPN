import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { getSqlPool, sql, withTransaction } from '../db/mssqlClient';
import { DomainRuleError, getLimaTodayIso } from '../domain/erpRules';
import { requireAuth, requirePermission } from '../middleware/auth';
import {
  generateReportsExcelBuffer,
  generateReportsPdfBuffer,
} from '../services/exportService';

export const adminReportsRouter = express.Router();
adminReportsRouter.use(requireAuth);

function getLimaYearMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}

function toLimaDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// 1. Dashboard Principal
adminReportsRouter.get('/dashboard', async (req, res) => {
  try {
    const pool = await getSqlPool();
    const sucursalId = req.auth!.sucursalId;
    const todayIso = getLimaTodayIso();
    const dtYesterday = new Date(`${todayIso}T00:00:00Z`);
    dtYesterday.setUTCDate(dtYesterday.getUTCDate() - 1);
    const yesterdayIso = dtYesterday.toISOString().slice(0, 10);
    const currentYm = getLimaYearMonth();

    const paramRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .query('SELECT VentanaAlertaDias, MetaMensualCentimos FROM dbo.ConfiguracionParametros WHERE SucursalId = @SucursalId');
    const ventanaDias = Number(paramRes.recordset[0]?.VentanaAlertaDias || 30);
    const metaMensualCentimos =
      paramRes.recordset[0]?.MetaMensualCentimos !== null &&
      paramRes.recordset[0]?.MetaMensualCentimos !== undefined
        ? Number(paramRes.recordset[0].MetaMensualCentimos)
        : null;

    const ventasRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .query(`
        SELECT TotalCentimos, CreadoEn
        FROM dbo.Ventas
        WHERE SucursalId = @SucursalId AND Estado = N'COMPLETADA'
          AND CreadoEn >= DATEADD(DAY, -35, SYSUTCDATETIME())
      `);

    let ventasHoyCentimos = 0;
    let ventasAyerCentimos = 0;
    let acumuladoMesCentimos = 0;
    for (const v of ventasRes.recordset) {
      const dateKey = toLimaDateKey(new Date(v.CreadoEn));
      const amt = Number(v.TotalCentimos);
      if (dateKey === todayIso) ventasHoyCentimos += amt;
      if (dateKey === yesterdayIso) ventasAyerCentimos += amt;
      if (dateKey.slice(0, 7) === currentYm) acumuladoMesCentimos += amt;
    }

    const limitDt = new Date(`${todayIso}T00:00:00Z`);
    limitDt.setUTCDate(limitDt.getUTCDate() + ventanaDias);
    const limitAlertIso = limitDt.toISOString().slice(0, 10);

    const invRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .query(`
        SELECT p.ProductoId, p.Sku, p.Nombre, p.Categoria, p.StockMinimo,
               l.LoteId, l.NumeroLote, l.FechaVencimiento, l.CantidadFisica, l.CantidadDisponible, l.EstadoAptitud
        FROM dbo.Productos p
        LEFT JOIN dbo.Lotes l ON l.ProductoId = p.ProductoId AND l.SucursalId = @SucursalId
        WHERE p.Activo = 1
      `);

    const prodMap = new Map<string, any>();
    let expiredLotsCount = 0;
    let expiringLotsCount = 0;

    for (const r of invRes.recordset) {
      if (!prodMap.has(r.ProductoId)) {
        prodMap.set(r.ProductoId, {
          productoId: r.ProductoId,
          sku: r.Sku,
          nombre: r.Nombre,
          categoria: r.Categoria,
          stockMinimo: Number(r.StockMinimo),
          stockDisponible: 0,
          proximoVencimiento: null as string | null,
        });
      }
      if (r.LoteId && Number(r.CantidadFisica) > 0) {
        const fv =
          r.FechaVencimiento instanceof Date
            ? r.FechaVencimiento.toISOString().slice(0, 10)
            : String(r.FechaVencimiento).slice(0, 10);
        if (r.EstadoAptitud === 'VENCIDO' || fv < todayIso) {
          expiredLotsCount++;
        } else if (r.EstadoAptitud === 'APTO') {
          const item = prodMap.get(r.ProductoId);
          item.stockDisponible += Number(r.CantidadDisponible);
          if (!item.proximoVencimiento || fv < item.proximoVencimiento) {
            item.proximoVencimiento = fv;
          }
          if (fv <= limitAlertIso) {
            expiringLotsCount++;
          }
        }
      }
    }

    const lowStockProducts = Array.from(prodMap.values()).filter(
      (p) => p.stockDisponible <= p.stockMinimo
    );

    const ordRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .query(`
        SELECT COUNT(*) AS Pendientes
        FROM dbo.OrdenesCompra
        WHERE SucursalId = @SucursalId AND Estado IN (N'PENDIENTE', N'ENVIADO')
      `);
    const pedidosPendientesCount = Number(ordRes.recordset[0]?.Pendientes || 0);

    const movRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .query(`
        SELECT TOP 8 m.MovimientoId, m.ProductoId, p.Sku, p.Nombre AS ProductoNombre, p.Categoria, p.StockMinimo
        FROM dbo.MovimientosStock m
        INNER JOIN dbo.Productos p ON p.ProductoId = m.ProductoId
        WHERE m.SucursalId = @SucursalId
        ORDER BY m.MovimientoId DESC
      `);

    const ultimosMovimientos = movRes.recordset.map((m: any) => {
      const pInfo = prodMap.get(m.ProductoId);
      const stockActual = pInfo ? pInfo.stockDisponible : 0;
      const stockMinimo = Number(m.StockMinimo);
      const estadoStock =
        stockActual === 0 ? 'CRITICO' : stockActual <= stockMinimo ? 'BAJO' : 'OPTIMO';
      return {
        movimientoId: Number(m.MovimientoId),
        productoId: m.ProductoId,
        sku: m.Sku,
        productoNombre: m.ProductoNombre,
        categoria: m.Categoria,
        stockActual,
        stockMinimo,
        proximoVencimiento: pInfo?.proximoVencimiento || null,
        estadoStock,
      };
    });

    const alertas: any[] = [];
    if (expiredLotsCount > 0) {
      alertas.push({
        id: 'alerta-vencidos',
        severidad: 'error',
        titulo: `${expiredLotsCount} lote(s) vencido(s)`,
        detalle: 'Retirar de estantería y bloquear en inventario.',
        destinoTab: 'inventario',
        filtro: 'vencidos',
      });
    }
    if (expiringLotsCount > 0) {
      alertas.push({
        id: 'alerta-por-vencer',
        severidad: 'warning',
        titulo: `${expiringLotsCount} lote(s) por vencer (<= ${ventanaDias} días)`,
        detalle: 'Priorizar rotación FEFO en dispensación.',
        destinoTab: 'inventario',
        filtro: '30',
      });
    }
    if (lowStockProducts.length > 0) {
      alertas.push({
        id: 'alerta-stock-bajo',
        severidad: 'info',
        titulo: `${lowStockProducts.length} producto(s) con stock bajo o agotado`,
        detalle: `Ejemplo: ${lowStockProducts
          .slice(0, 2)
          .map((p) => p.nombre)
          .join(', ')}.`,
        destinoTab: 'inventario',
        filtro: 'stockCritico',
      });
    }
    if (pedidosPendientesCount > 0) {
      alertas.push({
        id: 'alerta-pedidos',
        severidad: 'info',
        titulo: `${pedidosPendientesCount} orden(es) de compra en curso`,
        detalle: 'Pendientes de envío o recepción en almacén.',
        destinoTab: 'compras',
      });
    }

    const actRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .query(`
        SELECT TOP 8 a.AuditoriaId, a.Accion, a.Entidad, a.DetalleJson, a.CreadoEn, u.NombreCompleto
        FROM dbo.Auditoria a
        LEFT JOIN dbo.Usuarios u ON u.UsuarioId = a.UsuarioId
        WHERE a.SucursalId = @SucursalId
        ORDER BY a.AuditoriaId DESC
      `);

    const actividadReciente = actRes.recordset.map((a: any) => {
      let tipo: 'VENTA' | 'COMPRA' | 'AJUSTE' | 'ANULACION' = 'AJUSTE';
      if (a.Accion.includes('VENTA_ANULADA')) tipo = 'ANULACION';
      else if (a.Accion.includes('VENTA')) tipo = 'VENTA';
      else if (a.Accion.includes('RECEPCION')) tipo = 'COMPRA';
      return {
        id: String(a.AuditoriaId),
        tipo,
        titulo: a.Accion.replace(/_/g, ' '),
        subtitulo: `${a.NombreCompleto || 'Sistema'} · ${new Intl.DateTimeFormat('es-PE', {
          timeZone: 'America/Lima',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(a.CreadoEn))}`,
        fechaHora: a.CreadoEn,
      };
    });

    const [y, m] = currentYm.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const todayDay = Number(todayIso.slice(8, 10));
    const diasRestantesMes = Math.max(0, lastDay - todayDay);

    return res.json({
      kpis: {
        ventasHoyCentimos,
        ventasAyerCentimos,
        porVencerCount: expiringLotsCount,
        stockBajoCount: lowStockProducts.length,
        pedidosPendientesCount,
        ventanaAlertaDias: ventanaDias,
      },
      metaMensual: {
        configurada: metaMensualCentimos !== null && metaMensualCentimos > 0,
        metaCentimos: metaMensualCentimos,
        acumuladoMesCentimos,
        diasRestantesMes,
      },
      alertas,
      ultimosMovimientos,
      actividadReciente,
    });
  } catch (err) {
    console.error('Error en dashboard:', err);
    return res.status(500).json({ error: 'Error cargando indicadores del tablero.' });
  }
});

// 7. Reportes del Sistema
async function buildReportsData(params: {
  sucursalId: string;
  fechaDesde: string;
  fechaHasta: string;
  agrupacion: 'diario' | 'semanal' | 'mensual';
  vendedorId?: string;
  medioPago?: string;
}) {
  const pool = await getSqlPool();
  const { sucursalId, fechaDesde, fechaHasta, agrupacion, vendedorId, medioPago } = params;

  const paramRes = await pool
    .request()
    .input('SucursalId', sql.NVarChar(36), sucursalId)
    .query('SELECT MetaMensualCentimos, PorcentajeComision FROM dbo.ConfiguracionParametros WHERE SucursalId = @SucursalId');

  const metaMensualCentimos =
    paramRes.recordset[0]?.MetaMensualCentimos !== null &&
    paramRes.recordset[0]?.MetaMensualCentimos !== undefined
      ? Number(paramRes.recordset[0].MetaMensualCentimos)
      : null;
  const porcentajeComision =
    paramRes.recordset[0]?.PorcentajeComision !== null &&
    paramRes.recordset[0]?.PorcentajeComision !== undefined
      ? Number(paramRes.recordset[0].PorcentajeComision)
      : null;

  const ventasRes = await pool
    .request()
    .input('SucursalId', sql.NVarChar(36), sucursalId)
    .query(`
      SELECT v.VentaId, v.Estado, v.VendedorId, u.NombreCompleto AS VendedorNombre, u.Cargo AS VendedorCargo,
             v.SubtotalBrutoCentimos, v.DescuentoTotalCentimos, v.IgvCentimos, v.TotalCentimos, v.CreadoEn
      FROM dbo.Ventas v
      INNER JOIN dbo.Usuarios u ON u.UsuarioId = v.VendedorId
      WHERE v.SucursalId = @SucursalId
      ORDER BY v.CreadoEn ASC
    `);

  const pagosRes = await pool
    .request()
    .input('SucursalId', sql.NVarChar(36), sucursalId)
    .query(`
      SELECT p.VentaId, p.MedioPago, p.MontoCentimos
      FROM dbo.PagosVenta p
      INNER JOIN dbo.Ventas v ON v.VentaId = p.VentaId
      WHERE v.SucursalId = @SucursalId
    `);

  const detRes = await pool
    .request()
    .input('SucursalId', sql.NVarChar(36), sucursalId)
    .query(`
      SELECT d.VentaId, d.ProductoId, pr.Sku, pr.Nombre, pr.Categoria, d.Cantidad, d.SubtotalCentimos
      FROM dbo.VentaDetalle d
      INNER JOIN dbo.Ventas v ON v.VentaId = d.VentaId
      INNER JOIN dbo.Productos pr ON pr.ProductoId = d.ProductoId
      WHERE v.SucursalId = @SucursalId
    `);

  const vendedoresRes = await pool
    .request()
    .input('SucursalId', sql.NVarChar(36), sucursalId)
    .query(`
      SELECT DISTINCT u.UsuarioId, u.NombreCompleto
      FROM dbo.Usuarios u
      INNER JOIN dbo.UsuarioSucursal us ON us.UsuarioId = u.UsuarioId
      WHERE us.SucursalId = @SucursalId
      ORDER BY u.NombreCompleto ASC
    `);

  const pagosByVenta = new Map<string, Array<{ medioPago: string; montoCentimos: number }>>();
  for (const p of pagosRes.recordset) {
    if (!pagosByVenta.has(p.VentaId)) pagosByVenta.set(p.VentaId, []);
    pagosByVenta.get(p.VentaId)!.push({
      medioPago: p.MedioPago,
      montoCentimos: Number(p.MontoCentimos),
    });
  }

  const detByVenta = new Map<string, any[]>();
  for (const d of detRes.recordset) {
    if (!detByVenta.has(d.VentaId)) detByVenta.set(d.VentaId, []);
    detByVenta.get(d.VentaId)!.push({
      productoId: d.ProductoId,
      sku: d.Sku,
      nombre: d.Nombre,
      categoria: d.Categoria,
      cantidad: Number(d.Cantidad),
      subtotalCentimos: Number(d.SubtotalCentimos),
    });
  }

  // Filtrar ventas por periodo Lima, vendedor y medio de pago
  const filteredVentas = ventasRes.recordset.filter((v: any) => {
    const limaDate = toLimaDateKey(new Date(v.CreadoEn));
    if (fechaDesde && limaDate < fechaDesde) return false;
    if (fechaHasta && limaDate > fechaHasta) return false;
    if (vendedorId && vendedorId !== 'TODOS' && v.VendedorId !== vendedorId) return false;
    if (medioPago && medioPago !== 'TODOS') {
      const vp = pagosByVenta.get(v.VentaId) || [];
      if (!vp.some((p) => p.medioPago === medioPago)) return false;
    }
    return true;
  });

  // Definición consistente:
  // Bruto = suma de SubtotalBrutoCentimos de todas las ventas emitidas en el periodo
  // Neto = ventas COMPLETADAS (después de descuentos y excluyendo anuladas)
  let ventasBrutasCentimos = 0;
  let descuentosCentimos = 0;
  let anulacionesCentimos = 0;
  let ventasNetasCentimos = 0;
  let igvNetoCentimos = 0;
  let totalTransacciones = 0;

  const serieMap = new Map<string, { ventasNetasCentimos: number; ventasBrutasCentimos: number }>();
  const mpMap = new Map<string, { transacciones: number; totalCentimos: number }>();
  const prodMap = new Map<
    string,
    { productoId: string; sku: string; nombre: string; categoria: string; unidadesVendidas: number; totalCentimos: number }
  >();
  const vendMap = new Map<
    string,
    { usuarioId: string; nombreCompleto: string; cargo: string; transacciones: number; totalCentimos: number }
  >();

  for (const v of filteredVentas) {
    const limaDate = toLimaDateKey(new Date(v.CreadoEn));
    let bucketKey = limaDate;
    if (agrupacion === 'mensual') {
      bucketKey = limaDate.slice(0, 7);
    } else if (agrupacion === 'semanal') {
      const dt = new Date(`${limaDate}T00:00:00Z`);
      const day = dt.getUTCDay() || 7;
      dt.setUTCDate(dt.getUTCDate() - day + 1);
      bucketKey = `Sem ${dt.toISOString().slice(5, 10)}`;
    }

    if (!serieMap.has(bucketKey)) {
      serieMap.set(bucketKey, { ventasNetasCentimos: 0, ventasBrutasCentimos: 0 });
    }

    const bruto = Number(v.SubtotalBrutoCentimos);
    const desc = Number(v.DescuentoTotalCentimos);
    const total = Number(v.TotalCentimos);
    const igv = Number(v.IgvCentimos);

    ventasBrutasCentimos += bruto;
    descuentosCentimos += desc;
    serieMap.get(bucketKey)!.ventasBrutasCentimos += bruto;

    if (v.Estado === 'ANULADA') {
      anulacionesCentimos += total;
    } else {
      ventasNetasCentimos += total;
      igvNetoCentimos += igv;
      totalTransacciones += 1;
      serieMap.get(bucketKey)!.ventasNetasCentimos += total;

      for (const p of pagosByVenta.get(v.VentaId) || []) {
        if (medioPago && medioPago !== 'TODOS' && p.medioPago !== medioPago) continue;
        if (!mpMap.has(p.medioPago)) {
          mpMap.set(p.medioPago, { transacciones: 0, totalCentimos: 0 });
        }
        const mItem = mpMap.get(p.medioPago)!;
        mItem.transacciones += 1;
        mItem.totalCentimos += p.montoCentimos;
      }

      for (const d of detByVenta.get(v.VentaId) || []) {
        if (!prodMap.has(d.productoId)) {
          prodMap.set(d.productoId, {
            productoId: d.productoId,
            sku: d.sku,
            nombre: d.nombre,
            categoria: d.categoria,
            unidadesVendidas: 0,
            totalCentimos: 0,
          });
        }
        const pr = prodMap.get(d.productoId)!;
        pr.unidadesVendidas += d.cantidad;
        pr.totalCentimos += d.subtotalCentimos;
      }

      if (!vendMap.has(v.VendedorId)) {
        vendMap.set(v.VendedorId, {
          usuarioId: v.VendedorId,
          nombreCompleto: v.VendedorNombre,
          cargo: v.VendedorCargo,
          transacciones: 0,
          totalCentimos: 0,
        });
      }
      const ve = vendMap.get(v.VendedorId)!;
      ve.transacciones += 1;
      ve.totalCentimos += total;
    }
  }

  const proyeccionPorBucket =
    metaMensualCentimos && metaMensualCentimos > 0 && agrupacion === 'mensual'
      ? metaMensualCentimos
      : null;

  const serieTemporal = Array.from(serieMap.entries()).map(([etiqueta, vals]) => ({
    etiqueta,
    ventasNetasCentimos: vals.ventasNetasCentimos,
    ventasBrutasCentimos: vals.ventasBrutasCentimos,
    proyeccionCentimos: proyeccionPorBucket,
  }));

  const porMedioPago = Array.from(mpMap.entries()).map(([mp, vals]) => ({
    medioPago: mp,
    transacciones: vals.transacciones,
    totalCentimos: vals.totalCentimos,
  }));

  const topProductos = Array.from(prodMap.values())
    .sort((a, b) => b.totalCentimos - a.totalCentimos)
    .slice(0, 10);

  const porVendedor = Array.from(vendMap.values())
    .sort((a, b) => b.totalCentimos - a.totalCentimos)
    .map((v) => {
      const ticketPromedioCentimos =
        v.transacciones > 0 ? Math.round(v.totalCentimos / v.transacciones) : 0;
      const comisionCentimos =
        porcentajeComision !== null
          ? Math.round((v.totalCentimos * porcentajeComision) / 100)
          : null;
      let estadoMeta = 'Sin meta';
      if (metaMensualCentimos && metaMensualCentimos > 0) {
        estadoMeta =
          v.totalCentimos >= metaMensualCentimos
            ? 'Meta Lograda'
            : v.totalCentimos >= metaMensualCentimos * 0.5
              ? 'En Progreso'
              : 'Bajo Meta';
      }
      return {
        ...v,
        ticketPromedioCentimos,
        comisionCentimos,
        estadoMeta,
      };
    });

  return {
    resumen: {
      ventasBrutasCentimos,
      descuentosCentimos,
      anulacionesCentimos,
      ventasNetasCentimos,
      igvNetoCentimos,
      totalTransacciones,
    },
    definicion: {
      bruto: 'Suma del valor bruto antes de descuentos de todas las ventas emitidas en el periodo.',
      neto: 'Total cobrado en ventas completadas (descontando promociones y excluyendo ventas anuladas).',
    },
    metasYComisiones: {
      metaConfigurada: metaMensualCentimos !== null && metaMensualCentimos > 0,
      metaMensualCentimos,
      comisionConfigurada: porcentajeComision !== null && porcentajeComision >= 0,
      porcentajeComision,
    },
    serieTemporal,
    porMedioPago,
    topProductos,
    porVendedor,
    vendedoresCatalogo: vendedoresRes.recordset.map((v: any) => ({
      usuarioId: v.UsuarioId,
      nombreCompleto: v.NombreCompleto,
    })),
  };
}

adminReportsRouter.get('/reportes', requirePermission('reportes.ver'), async (req, res) => {
  try {
    const todayIso = getLimaTodayIso();
    const defaultStart = `${todayIso.slice(0, 7)}-01`;
    const fechaDesde = String(req.query.fechaDesde || defaultStart).slice(0, 10);
    const fechaHasta = String(req.query.fechaHasta || todayIso).slice(0, 10);
    const agrupacion = ['diario', 'semanal', 'mensual'].includes(String(req.query.agrupacion))
      ? (String(req.query.agrupacion) as 'diario' | 'semanal' | 'mensual')
      : 'diario';
    const vendedorId = req.query.vendedorId ? String(req.query.vendedorId) : undefined;
    const medioPago = req.query.medioPago ? String(req.query.medioPago) : undefined;

    const data = await buildReportsData({
      sucursalId: req.auth!.sucursalId,
      fechaDesde,
      fechaHasta,
      agrupacion,
      vendedorId,
      medioPago,
    });
    return res.json(data);
  } catch (err) {
    console.error('Error en reportes:', err);
    return res.status(500).json({ error: 'Error generando el panel de reportes.' });
  }
});

adminReportsRouter.get(
  '/reportes/export/pdf',
  requirePermission('reportes.exportar'),
  async (req, res) => {
    try {
      const todayIso = getLimaTodayIso();
      const fechaDesde = String(req.query.fechaDesde || `${todayIso.slice(0, 7)}-01`).slice(0, 10);
      const fechaHasta = String(req.query.fechaHasta || todayIso).slice(0, 10);
      const agrupacion = ['diario', 'semanal', 'mensual'].includes(String(req.query.agrupacion))
        ? (String(req.query.agrupacion) as 'diario' | 'semanal' | 'mensual')
        : 'diario';
      const vendedorId = req.query.vendedorId ? String(req.query.vendedorId) : 'TODOS';
      const medioPago = req.query.medioPago ? String(req.query.medioPago) : 'TODOS';

      const data = await buildReportsData({
        sucursalId: req.auth!.sucursalId,
        fechaDesde,
        fechaHasta,
        agrupacion,
        vendedorId,
        medioPago,
      });

      const pdfBuffer = await generateReportsPdfBuffer({
        sucursalNombre: req.auth!.sucursalNombre,
        fechaDesde,
        fechaHasta,
        filtrosTexto: `Vendedor: ${vendedorId} | Medio: ${medioPago} | Vista: ${agrupacion}`,
        resumen: data.resumen,
        porMedioPago: data.porMedioPago,
        topProductos: data.topProductos,
        porVendedor: data.porVendedor,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="reporte_botica_${fechaDesde}_${fechaHasta}.pdf"`
      );
      return res.send(pdfBuffer);
    } catch (err) {
      console.error('Error exportando reporte PDF:', err);
      return res.status(500).json({ error: 'Error generando el archivo PDF.' });
    }
  }
);

adminReportsRouter.get(
  '/reportes/export/excel',
  requirePermission('reportes.exportar'),
  async (req, res) => {
    try {
      const todayIso = getLimaTodayIso();
      const fechaDesde = String(req.query.fechaDesde || `${todayIso.slice(0, 7)}-01`).slice(0, 10);
      const fechaHasta = String(req.query.fechaHasta || todayIso).slice(0, 10);
      const agrupacion = ['diario', 'semanal', 'mensual'].includes(String(req.query.agrupacion))
        ? (String(req.query.agrupacion) as 'diario' | 'semanal' | 'mensual')
        : 'diario';
      const vendedorId = req.query.vendedorId ? String(req.query.vendedorId) : 'TODOS';
      const medioPago = req.query.medioPago ? String(req.query.medioPago) : 'TODOS';

      const data = await buildReportsData({
        sucursalId: req.auth!.sucursalId,
        fechaDesde,
        fechaHasta,
        agrupacion,
        vendedorId,
        medioPago,
      });

      const xlsxBuffer = await generateReportsExcelBuffer({
        sucursalNombre: req.auth!.sucursalNombre,
        fechaDesde,
        fechaHasta,
        filtrosTexto: `Vendedor: ${vendedorId} | Medio: ${medioPago} | Vista: ${agrupacion}`,
        resumen: data.resumen,
        porMedioPago: data.porMedioPago,
        topProductos: data.topProductos,
        porVendedor: data.porVendedor,
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="reporte_botica_${fechaDesde}_${fechaHasta}.xlsx"`
      );
      return res.send(xlsxBuffer);
    } catch (err) {
      console.error('Error exportando reporte Excel:', err);
      return res.status(500).json({ error: 'Error generando el archivo Excel.' });
    }
  }
);

// Configuración: Usuarios, Roles, Permisos, Sucursal y Parámetros
adminReportsRouter.get(
  '/configuracion',
  requirePermission('config.usuarios', 'config.parametros'),
  async (req, res) => {
    try {
      const pool = await getSqlPool();
      const sucursalId = req.auth!.sucursalId;

      const usersRes = await pool.request().query(`
        SELECT UsuarioId, Username, NombreCompleto, Cargo, Activo, CreadoEn
        FROM dbo.Usuarios
        ORDER BY CreadoEn ASC
      `);
      const userRolesRes = await pool.request().query('SELECT UsuarioId, RolId FROM dbo.UsuarioRol');
      const userSucRes = await pool.request().query('SELECT UsuarioId, SucursalId, Activo FROM dbo.UsuarioSucursal');

      const rolesRes = await pool.request().query('SELECT RolId, Codigo, Nombre, Descripcion FROM dbo.Roles ORDER BY Nombre');
      const permsRes = await pool.request().query('SELECT PermisoId, Codigo, Modulo, Descripcion FROM dbo.Permisos ORDER BY Modulo, Codigo');
      const rolPermRes = await pool.request().query('SELECT RolId, PermisoId FROM dbo.RolPermiso');
      const sucRes = await pool.request().query('SELECT SucursalId, Codigo, Nombre, Ruc, Direccion, Activo FROM dbo.Sucursales');
      const paramRes = await pool
        .request()
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .query('SELECT * FROM dbo.ConfiguracionParametros WHERE SucursalId = @SucursalId');

      const auditRes = await pool
        .request()
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .query(`
          SELECT TOP 25 a.AuditoriaId, a.Accion, a.Entidad, a.EntidadId, a.DetalleJson, a.CreadoEn, u.Username
          FROM dbo.Auditoria a
          LEFT JOIN dbo.Usuarios u ON u.UsuarioId = a.UsuarioId
          WHERE a.SucursalId = @SucursalId
          ORDER BY a.AuditoriaId DESC
        `);

      const usuarios = usersRes.recordset.map((u: any) => ({
        usuarioId: u.UsuarioId,
        username: u.Username,
        nombreCompleto: u.NombreCompleto,
        cargo: u.Cargo,
        activo: Boolean(u.Activo),
        creadoEn: u.CreadoEn,
        rolIds: userRolesRes.recordset.filter((r: any) => r.UsuarioId === u.UsuarioId).map((r: any) => r.RolId),
        sucursalIds: userSucRes.recordset
          .filter((s: any) => s.UsuarioId === u.UsuarioId && s.Activo)
          .map((s: any) => s.SucursalId),
      }));

      const roles = rolesRes.recordset.map((r: any) => ({
        rolId: r.RolId,
        codigo: r.Codigo,
        nombre: r.Nombre,
        descripcion: r.Descripcion,
        permisoIds: rolPermRes.recordset.filter((rp: any) => rp.RolId === r.RolId).map((rp: any) => rp.PermisoId),
      }));

      const pRow = paramRes.recordset[0];

      return res.json({
        usuarios,
        roles,
        permisos: permsRes.recordset.map((p: any) => ({
          permisoId: p.PermisoId,
          codigo: p.Codigo,
          modulo: p.Modulo,
          descripcion: p.Descripcion,
        })),
        sucursales: sucRes.recordset.map((s: any) => ({
          sucursalId: s.SucursalId,
          codigo: s.Codigo,
          nombre: s.Nombre,
          ruc: s.Ruc,
          direccion: s.Direccion,
          activo: Boolean(s.Activo),
        })),
        parametros: pRow
          ? {
              igvPorcentaje: Number(pRow.IgvPorcentaje),
              ventanaAlertaDias: Number(pRow.VentanaAlertaDias),
              metaMensualCentimos:
                pRow.MetaMensualCentimos !== null ? Number(pRow.MetaMensualCentimos) : null,
              porcentajeComision:
                pRow.PorcentajeComision !== null ? Number(pRow.PorcentajeComision) : null,
            }
          : null,
        auditoria: auditRes.recordset.map((a: any) => ({
          auditoriaId: Number(a.AuditoriaId),
          accion: a.Accion,
          entidad: a.Entidad,
          entidadId: a.EntidadId,
          detalleJson: a.DetalleJson,
          creadoEn: a.CreadoEn,
          username: a.Username || 'Sistema',
        })),
      });
    } catch (err) {
      console.error('Error cargando configuración:', err);
      return res.status(500).json({ error: 'Error consultando configuración.' });
    }
  }
);

adminReportsRouter.post(
  '/configuracion/usuarios',
  requirePermission('config.usuarios'),
  async (req, res) => {
    try {
      const body = req.body || {};
      const username = String(body.username || '').trim();
      const nombreCompleto = String(body.nombreCompleto || '').trim();
      const cargo = String(body.cargo || '').trim() || 'Operador';
      const password = String(body.password || '');
      const rolIds: string[] = Array.isArray(body.rolIds) ? body.rolIds : [];
      const sucursalIds: string[] = Array.isArray(body.sucursalIds)
        ? body.sucursalIds
        : [req.auth!.sucursalId];

      if (!username || !nombreCompleto || password.length < 8 || rolIds.length === 0) {
        return res.status(400).json({
          error: 'Usuario, nombre completo, contraseña (mín. 8 caracteres) y al menos un rol son obligatorios.',
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const usuarioId = crypto.randomUUID();

      await withTransaction(async (tx) => {
        const dup = await tx
          .request()
          .input('Username', sql.NVarChar(60), username)
          .query('SELECT UsuarioId FROM dbo.Usuarios WHERE Username = @Username');
        if (dup.recordset.length > 0) {
          throw new DomainRuleError('DUPLICATE_USERNAME', `El usuario "${username}" ya existe.`, 409);
        }

        await tx
          .request()
          .input('UsuarioId', sql.NVarChar(36), usuarioId)
          .input('Username', sql.NVarChar(60), username)
          .input('NombreCompleto', sql.NVarChar(140), nombreCompleto)
          .input('Cargo', sql.NVarChar(80), cargo)
          .input('PasswordHash', sql.NVarChar(255), passwordHash)
          .query(`
            INSERT INTO dbo.Usuarios (UsuarioId, Username, NombreCompleto, Cargo, PasswordHash, Activo)
            VALUES (@UsuarioId, @Username, @NombreCompleto, @Cargo, @PasswordHash, 1)
          `);

        for (const rId of rolIds) {
          await tx
            .request()
            .input('UsuarioId', sql.NVarChar(36), usuarioId)
            .input('RolId', sql.NVarChar(36), String(rId))
            .query('INSERT INTO dbo.UsuarioRol (UsuarioId, RolId) VALUES (@UsuarioId, @RolId)');
        }

        for (const sId of sucursalIds) {
          await tx
            .request()
            .input('UsuarioId', sql.NVarChar(36), usuarioId)
            .input('SucursalId', sql.NVarChar(36), String(sId))
            .query('INSERT INTO dbo.UsuarioSucursal (UsuarioId, SucursalId, Activo) VALUES (@UsuarioId, @SucursalId, 1)');
        }

        await tx
          .request()
          .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
          .input('UsuarioId', sql.NVarChar(36), req.auth!.usuarioId)
          .input('EntidadId', sql.NVarChar(60), usuarioId)
          .input('DetalleJson', sql.NVarChar(sql.MAX), JSON.stringify({ username, rolIds, sucursalIds }))
          .query(`
            INSERT INTO dbo.Auditoria (SucursalId, UsuarioId, Accion, Entidad, EntidadId, DetalleJson)
            VALUES (@SucursalId, @UsuarioId, N'USUARIO_CREADO', N'Usuario', @EntidadId, @DetalleJson)
          `);
      });

      return res.status(201).json({ usuarioId, username });
    } catch (err) {
      if (err instanceof DomainRuleError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error('Error creando usuario:', err);
      return res.status(500).json({ error: 'No se pudo crear el usuario.' });
    }
  }
);

adminReportsRouter.patch(
  '/configuracion/usuarios/:id',
  requirePermission('config.usuarios'),
  async (req, res) => {
    try {
      const targetUserId = String(req.params.id);
      const body = req.body || {};

      await withTransaction(async (tx) => {
        if (typeof body.activo === 'boolean') {
          if (targetUserId === req.auth!.usuarioId && !body.activo) {
            throw new DomainRuleError('SELF_DEACTIVATE', 'No puede desactivar su propia cuenta activa.');
          }
          await tx
            .request()
            .input('UsuarioId', sql.NVarChar(36), targetUserId)
            .input('Activo', sql.Bit, body.activo ? 1 : 0)
            .query('UPDATE dbo.Usuarios SET Activo = @Activo, ActualizadoEn = SYSUTCDATETIME() WHERE UsuarioId = @UsuarioId');

          if (!body.activo) {
            // Revocar sesiones activas inmediatamente
            await tx
              .request()
              .input('UsuarioId', sql.NVarChar(36), targetUserId)
              .query(`
                UPDATE dbo.Sesiones
                SET Revocada = 1, RevocadaEn = SYSUTCDATETIME(), MotivoRevocacion = N'Cuenta desactivada por administrador'
                WHERE UsuarioId = @UsuarioId AND Revocada = 0
              `);
          }
        }

        if (Array.isArray(body.rolIds)) {
          await tx
            .request()
            .input('UsuarioId', sql.NVarChar(36), targetUserId)
            .query('DELETE FROM dbo.UsuarioRol WHERE UsuarioId = @UsuarioId');
          for (const rId of body.rolIds) {
            await tx
              .request()
              .input('UsuarioId', sql.NVarChar(36), targetUserId)
              .input('RolId', sql.NVarChar(36), String(rId))
              .query('INSERT INTO dbo.UsuarioRol (UsuarioId, RolId) VALUES (@UsuarioId, @RolId)');
          }
        }

        if (Array.isArray(body.sucursalIds)) {
          await tx
            .request()
            .input('UsuarioId', sql.NVarChar(36), targetUserId)
            .query('DELETE FROM dbo.UsuarioSucursal WHERE UsuarioId = @UsuarioId');
          for (const sId of body.sucursalIds) {
            await tx
              .request()
              .input('UsuarioId', sql.NVarChar(36), targetUserId)
              .input('SucursalId', sql.NVarChar(36), String(sId))
              .query('INSERT INTO dbo.UsuarioSucursal (UsuarioId, SucursalId, Activo) VALUES (@UsuarioId, @SucursalId, 1)');
          }
        }

        await tx
          .request()
          .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
          .input('UsuarioId', sql.NVarChar(36), req.auth!.usuarioId)
          .input('EntidadId', sql.NVarChar(60), targetUserId)
          .input('DetalleJson', sql.NVarChar(sql.MAX), JSON.stringify(body))
          .query(`
            INSERT INTO dbo.Auditoria (SucursalId, UsuarioId, Accion, Entidad, EntidadId, DetalleJson)
            VALUES (@SucursalId, @UsuarioId, N'USUARIO_ACTUALIZADO', N'Usuario', @EntidadId, @DetalleJson)
          `);
      });

      return res.json({ ok: true });
    } catch (err) {
      if (err instanceof DomainRuleError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error('Error actualizando usuario:', err);
      return res.status(500).json({ error: 'No se pudo actualizar el usuario.' });
    }
  }
);

adminReportsRouter.put(
  '/configuracion/roles/:rolId/permisos',
  requirePermission('config.usuarios'),
  async (req, res) => {
    try {
      const rolId = String(req.params.rolId);
      const permisoIds: string[] = Array.isArray(req.body?.permisoIds) ? req.body.permisoIds : [];

      await withTransaction(async (tx) => {
        await tx
          .request()
          .input('RolId', sql.NVarChar(36), rolId)
          .query('DELETE FROM dbo.RolPermiso WHERE RolId = @RolId');

        for (const pId of permisoIds) {
          await tx
            .request()
            .input('RolId', sql.NVarChar(36), rolId)
            .input('PermisoId', sql.NVarChar(36), String(pId))
            .query('INSERT INTO dbo.RolPermiso (RolId, PermisoId) VALUES (@RolId, @PermisoId)');
        }

        await tx
          .request()
          .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
          .input('UsuarioId', sql.NVarChar(36), req.auth!.usuarioId)
          .input('EntidadId', sql.NVarChar(60), rolId)
          .input('DetalleJson', sql.NVarChar(sql.MAX), JSON.stringify({ rolId, permisoIds }))
          .query(`
            INSERT INTO dbo.Auditoria (SucursalId, UsuarioId, Accion, Entidad, EntidadId, DetalleJson)
            VALUES (@SucursalId, @UsuarioId, N'ROL_PERMISOS_ACTUALIZADOS', N'Rol', @EntidadId, @DetalleJson)
          `);
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('Error actualizando permisos de rol:', err);
      return res.status(500).json({ error: 'No se pudieron actualizar los permisos del rol.' });
    }
  }
);

adminReportsRouter.put(
  '/configuracion/parametros',
  requirePermission('config.parametros'),
  async (req, res) => {
    try {
      const body = req.body || {};
      const igvPorcentaje = Number(body.igvPorcentaje ?? 18);
      const ventanaAlertaDias = Math.max(1, Math.trunc(Number(body.ventanaAlertaDias ?? 30)));
      const metaMensualCentimos =
        body.metaMensualCentimos !== null && body.metaMensualCentimos !== undefined
          ? Math.max(0, Math.round(Number(body.metaMensualCentimos)))
          : null;
      const porcentajeComision =
        body.porcentajeComision !== null && body.porcentajeComision !== undefined
          ? Math.max(0, Number(body.porcentajeComision))
          : null;

      const pool = await getSqlPool();
      await pool
        .request()
        .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
        .input('Igv', sql.Decimal(5, 2), igvPorcentaje)
        .input('Ventana', sql.Int, ventanaAlertaDias)
        .input('Meta', sql.BigInt, metaMensualCentimos)
        .input('Comision', sql.Decimal(5, 2), porcentajeComision)
        .input('ActualizadoPor', sql.NVarChar(36), req.auth!.usuarioId)
        .query(`
          UPDATE dbo.ConfiguracionParametros
          SET IgvPorcentaje = @Igv,
              VentanaAlertaDias = @Ventana,
              MetaMensualCentimos = @Meta,
              PorcentajeComision = @Comision,
              ActualizadoPor = @ActualizadoPor,
              ActualizadoEn = SYSUTCDATETIME()
          WHERE SucursalId = @SucursalId
        `);

      await pool
        .request()
        .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
        .input('UsuarioId', sql.NVarChar(36), req.auth!.usuarioId)
        .input('EntidadId', sql.NVarChar(60), req.auth!.sucursalId)
        .input('DetalleJson', sql.NVarChar(sql.MAX), JSON.stringify(body))
        .query(`
          INSERT INTO dbo.Auditoria (SucursalId, UsuarioId, Accion, Entidad, EntidadId, DetalleJson)
          VALUES (@SucursalId, @UsuarioId, N'PARAMETROS_ACTUALIZADOS', N'Configuracion', @EntidadId, @DetalleJson)
        `);

      return res.json({ ok: true });
    } catch (err) {
      console.error('Error actualizando parámetros:', err);
      return res.status(500).json({ error: 'No se pudieron guardar los parámetros.' });
    }
  }
);
