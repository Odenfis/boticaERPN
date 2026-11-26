import crypto from 'node:crypto';
import express from 'express';
import { getSqlPool, sql, withTransaction } from '../db/mssqlClient';
import {
  computeKardexRunningBalances,
  DomainRuleError,
  getLimaTodayIso,
} from '../domain/erpRules';
import { requireAuth, requirePermission } from '../middleware/auth';
import { generateKardexPdfBuffer } from '../services/exportService';

export const inventoryRouter = express.Router();
inventoryRouter.use(requireAuth);

function formatDateYmd(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const str = String(val);
  return str.slice(0, 10);
}

function formatLimaDateTime(val: unknown): string {
  const d = val instanceof Date ? val : new Date(String(val));
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

inventoryRouter.get(
  '/productos',
  requirePermission('inventario.ver', 'pos.operar', 'compras.ver'),
  async (req, res) => {
    try {
      const pool = await getSqlPool();
      const sucursalId = req.auth!.sucursalId;
      const todayIso = getLimaTodayIso();

      const q = String(req.query.q || '').trim().toLowerCase();
      const categoria = String(req.query.categoria || '').trim();
      const laboratorio = String(req.query.laboratorio || '').trim();
      const vencimiento = String(req.query.vencimiento || '').trim(); // '30' | '60' | 'vencidos'
      const stockCritico = String(req.query.stockCritico || '') === 'true';
      const condicion = String(req.query.condicion || '').trim().toUpperCase(); // 'OTC' | 'RECETA'
      const sort = String(req.query.sort || 'nombre_asc');
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 50)));

      const paramRes = await pool
        .request()
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .query('SELECT VentanaAlertaDias FROM dbo.ConfiguracionParametros WHERE SucursalId = @SucursalId');
      const ventanaDias = Number(paramRes.recordset[0]?.VentanaAlertaDias || 30);

      const prodRes = await pool
        .request()
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .query(`
          SELECT
            p.ProductoId, p.Sku, p.CodigoBarras, p.Nombre, p.PrincipioActivo,
            p.Concentracion, p.Presentacion, p.Laboratorio, p.Categoria,
            p.RegistroSanitario, p.CondicionVenta, p.RequiereReceta, p.UnidadInventario,
            p.StockMinimo, p.PrecioVentaCentimos, p.GravadoIgv, p.IgvPorcentaje,
            p.UbicacionPasillo, p.UbicacionEstante, p.TemperaturaAlmacen, p.Activo,
            l.LoteId, l.NumeroLote, l.FechaVencimiento, l.CostoAdquisicionCentimos,
            l.CantidadFisica, l.CantidadDisponible, l.EstadoAptitud
          FROM dbo.Productos p
          LEFT JOIN dbo.Lotes l ON l.ProductoId = p.ProductoId AND l.SucursalId = @SucursalId
          WHERE p.Activo = 1
        `);

      const byProd = new Map<string, any>();
      const categoriasSet = new Set<string>();
      const laboratoriosSet = new Set<string>();

      const addDaysIso = (baseIso: string, days: number) => {
        const dt = new Date(`${baseIso}T00:00:00Z`);
        dt.setUTCDate(dt.getUTCDate() + days);
        return dt.toISOString().slice(0, 10);
      };
      const limitAlertIso = addDaysIso(todayIso, ventanaDias);
      const limit30Iso = addDaysIso(todayIso, 30);
      const limit60Iso = addDaysIso(todayIso, 60);

      for (const row of prodRes.recordset) {
        categoriasSet.add(row.Categoria);
        laboratoriosSet.add(row.Laboratorio);
        if (!byProd.has(row.ProductoId)) {
          byProd.set(row.ProductoId, {
            productoId: row.ProductoId,
            sku: row.Sku,
            codigoBarras: row.CodigoBarras,
            nombre: row.Nombre,
            principioActivo: row.PrincipioActivo,
            concentracion: row.Concentracion,
            presentacion: row.Presentacion,
            laboratorio: row.Laboratorio,
            categoria: row.Categoria,
            registroSanitario: row.RegistroSanitario,
            condicionVenta: row.CondicionVenta,
            requiereReceta: Boolean(row.RequiereReceta),
            unidadInventario: row.UnidadInventario,
            stockMinimo: Number(row.StockMinimo),
            precioVentaCentimos: Number(row.PrecioVentaCentimos),
            gravadoIgv: Boolean(row.GravadoIgv),
            igvPorcentaje: Number(row.IgvPorcentaje),
            ubicacionPasillo: row.UbicacionPasillo,
            ubicacionEstante: row.UbicacionEstante,
            temperaturaAlmacen: row.TemperaturaAlmacen,
            activo: Boolean(row.Activo),
            stockFisico: 0,
            stockDisponible: 0,
            proximoVencimiento: null as string | null,
            valorInventarioCentimos: 0,
            costoSum: 0,
            lotes: [] as Array<{
              fechaVencimiento: string;
              cantidadFisica: number;
              cantidadDisponible: number;
              estadoAptitud: string;
            }>,
          });
        }
        if (row.LoteId) {
          const item = byProd.get(row.ProductoId);
          const fv = formatDateYmd(row.FechaVencimiento)!;
          const cf = Number(row.CantidadFisica);
          const cd = Number(row.CantidadDisponible);
          const cost = Number(row.CostoAdquisicionCentimos);
          const isApt = row.EstadoAptitud === 'APTO' && fv >= todayIso;
          item.stockFisico += cf;
          if (isApt) {
            item.stockDisponible += cd;
            if (!item.proximoVencimiento || fv < item.proximoVencimiento) {
              item.proximoVencimiento = fv;
            }
          } else if (!item.proximoVencimiento && cf > 0) {
            item.proximoVencimiento = fv;
          }
          item.valorInventarioCentimos += cf * cost;
          item.lotes.push({
            fechaVencimiento: fv,
            cantidadFisica: cf,
            cantidadDisponible: cd,
            estadoAptitud: row.EstadoAptitud,
          });
        }
      }

      const allItems = Array.from(byProd.values()).map((it) => {
        const tieneLotesVencidos = it.lotes.some(
          (l: any) => l.cantidadFisica > 0 && (l.estadoAptitud === 'VENCIDO' || l.fechaVencimiento < todayIso)
        );
        const tieneLotesPorVencer = it.lotes.some(
          (l: any) =>
            l.cantidadFisica > 0 &&
            l.estadoAptitud === 'APTO' &&
            l.fechaVencimiento >= todayIso &&
            l.fechaVencimiento <= limitAlertIso
        );
        const costoPromedioCentimos =
          it.stockFisico > 0 ? Math.round(it.valorInventarioCentimos / it.stockFisico) : 0;
        const { lotes: _l, costoSum: _c, ...rest } = it;
        return {
          ...rest,
          costoPromedioCentimos,
          tieneLotesVencidos,
          tieneLotesPorVencer,
          _lotes: it.lotes,
        };
      });

      const kpis = {
        totalSkus: allItems.length,
        stockCriticoCount: allItems.filter((p) => p.stockDisponible <= p.stockMinimo).length,
        porVencer30Count: allItems.filter((p) =>
          p._lotes.some(
            (l: any) =>
              l.cantidadFisica > 0 &&
              l.fechaVencimiento >= todayIso &&
              l.fechaVencimiento <= limit30Iso
          )
        ).length,
        vencidosCount: allItems.filter((p) => p.tieneLotesVencidos).length,
        valorTotalCentimos: allItems.reduce((acc, p) => acc + p.valorInventarioCentimos, 0),
      };

      let filtered = allItems.filter((p) => {
        if (q) {
          const hay =
            p.nombre.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            p.principioActivo.toLowerCase().includes(q) ||
            (p.codigoBarras || '').toLowerCase().includes(q);
          if (!hay) return false;
        }
        if (categoria && categoria !== 'TODAS' && p.categoria !== categoria) return false;
        if (laboratorio && laboratorio !== 'TODOS' && p.laboratorio !== laboratorio) return false;
        if (condicion === 'OTC' && p.requiereReceta) return false;
        if (condicion === 'RECETA' && !p.requiereReceta) return false;
        if (stockCritico && p.stockDisponible > p.stockMinimo) return false;
        if (vencimiento === '30') {
          const match = p._lotes.some(
            (l: any) => l.cantidadFisica > 0 && l.fechaVencimiento >= todayIso && l.fechaVencimiento <= limit30Iso
          );
          if (!match) return false;
        } else if (vencimiento === '60') {
          const match = p._lotes.some(
            (l: any) => l.cantidadFisica > 0 && l.fechaVencimiento >= todayIso && l.fechaVencimiento <= limit60Iso
          );
          if (!match) return false;
        } else if (vencimiento === 'vencidos') {
          if (!p.tieneLotesVencidos) return false;
        }
        return true;
      });

      filtered.sort((a, b) => {
        switch (sort) {
          case 'stock_asc':
            return a.stockDisponible - b.stockDisponible;
          case 'stock_desc':
            return b.stockDisponible - a.stockDisponible;
          case 'vencimiento_asc':
            return (a.proximoVencimiento || '9999-12-31').localeCompare(
              b.proximoVencimiento || '9999-12-31'
            );
          case 'precio_desc':
            return b.precioVentaCentimos - a.precioVentaCentimos;
          default:
            return a.nombre.localeCompare(b.nombre, 'es');
        }
      });

      const total = filtered.length;
      const offset = (page - 1) * pageSize;
      const paginated = filtered.slice(offset, offset + pageSize).map(({ _lotes, ...rest }) => rest);

      return res.json({
        items: paginated,
        total,
        page,
        pageSize,
        kpis,
        filtros: {
          categorias: Array.from(categoriasSet).sort(),
          laboratorios: Array.from(laboratoriosSet).sort(),
        },
      });
    } catch (err) {
      console.error('Error listando productos:', err);
      return res.status(500).json({ error: 'Error consultando el inventario.' });
    }
  }
);

inventoryRouter.post('/productos', requirePermission('inventario.editar'), async (req, res) => {
  try {
    const body = req.body || {};
    const sku = String(body.sku || '').trim().toUpperCase();
    const nombre = String(body.nombre || '').trim();
    const principioActivo = String(body.principioActivo || '').trim();
    const concentracion = String(body.concentracion || '').trim();
    const presentacion = String(body.presentacion || '').trim();
    const laboratorio = String(body.laboratorio || '').trim();
    const categoria = String(body.categoria || '').trim();
    const condicionVenta = body.condicionVenta === 'RECETA' ? 'RECETA' : 'OTC';
    const requiereReceta = condicionVenta === 'RECETA';
    const stockMinimo = Math.max(0, Math.trunc(Number(body.stockMinimo ?? 10)));
    const precioVentaCentimos = Math.round(Number(body.precioVentaCentimos ?? 0));
    const gravadoIgv = body.gravadoIgv !== false;
    const igvPorcentaje = gravadoIgv ? Number(body.igvPorcentaje ?? 18) : 0;

    if (!sku || !nombre || !principioActivo || !presentacion || !laboratorio || !categoria) {
      return res.status(400).json({ error: 'Complete todos los campos obligatorios del producto.' });
    }
    if (!Number.isInteger(precioVentaCentimos) || precioVentaCentimos <= 0) {
      return res.status(400).json({ error: 'El precio de venta debe ser mayor a cero.' });
    }

    const pool = await getSqlPool();
    const dup = await pool
      .request()
      .input('Sku', sql.NVarChar(40), sku)
      .query('SELECT ProductoId FROM dbo.Productos WHERE Sku = @Sku');
    if (dup.recordset.length > 0) {
      return res.status(409).json({ error: `Ya existe un producto con el SKU ${sku}.` });
    }

    const productoId = crypto.randomUUID();
    await pool
      .request()
      .input('ProductoId', sql.NVarChar(36), productoId)
      .input('Sku', sql.NVarChar(40), sku)
      .input('CodigoBarras', sql.NVarChar(64), body.codigoBarras ? String(body.codigoBarras).trim() : null)
      .input('Nombre', sql.NVarChar(180), nombre)
      .input('PrincipioActivo', sql.NVarChar(180), principioActivo)
      .input('Concentracion', sql.NVarChar(80), concentracion || 'Estándar')
      .input('Presentacion', sql.NVarChar(120), presentacion)
      .input('Laboratorio', sql.NVarChar(120), laboratorio)
      .input('Categoria', sql.NVarChar(80), categoria)
      .input('RegistroSanitario', sql.NVarChar(60), body.registroSanitario ? String(body.registroSanitario).trim() : null)
      .input('CondicionVenta', sql.NVarChar(20), condicionVenta)
      .input('RequiereReceta', sql.Bit, requiereReceta ? 1 : 0)
      .input('UnidadInventario', sql.NVarChar(40), String(body.unidadInventario || 'Unidad').trim())
      .input('StockMinimo', sql.Int, stockMinimo)
      .input('PrecioVentaCentimos', sql.BigInt, precioVentaCentimos)
      .input('GravadoIgv', sql.Bit, gravadoIgv ? 1 : 0)
      .input('IgvPorcentaje', sql.Decimal(5, 2), igvPorcentaje)
      .input('UbicacionPasillo', sql.NVarChar(60), body.ubicacionPasillo ? String(body.ubicacionPasillo).trim() : null)
      .input('UbicacionEstante', sql.NVarChar(60), body.ubicacionEstante ? String(body.ubicacionEstante).trim() : null)
      .input('TemperaturaAlmacen', sql.NVarChar(60), body.temperaturaAlmacen ? String(body.temperaturaAlmacen).trim() : null)
      .query(`
        INSERT INTO dbo.Productos (
          ProductoId, Sku, CodigoBarras, Nombre, PrincipioActivo, Concentracion, Presentacion,
          Laboratorio, Categoria, RegistroSanitario, CondicionVenta, RequiereReceta,
          UnidadInventario, StockMinimo, PrecioVentaCentimos, GravadoIgv, IgvPorcentaje,
          UbicacionPasillo, UbicacionEstante, TemperaturaAlmacen
        ) VALUES (
          @ProductoId, @Sku, @CodigoBarras, @Nombre, @PrincipioActivo, @Concentracion, @Presentacion,
          @Laboratorio, @Categoria, @RegistroSanitario, @CondicionVenta, @RequiereReceta,
          @UnidadInventario, @StockMinimo, @PrecioVentaCentimos, @GravadoIgv, @IgvPorcentaje,
          @UbicacionPasillo, @UbicacionEstante, @TemperaturaAlmacen
        )
      `);

    return res.status(201).json({ productoId, sku });
  } catch (err) {
    console.error('Error creando producto:', err);
    return res.status(500).json({ error: 'No se pudo registrar el producto.' });
  }
});

inventoryRouter.put('/productos/:id', requirePermission('inventario.editar'), async (req, res) => {
  try {
    const productoId = String(req.params.id);
    const body = req.body || {};
    const condicionVenta = body.condicionVenta === 'RECETA' ? 'RECETA' : 'OTC';
    const requiereReceta = condicionVenta === 'RECETA';
    const stockMinimo = Math.max(0, Math.trunc(Number(body.stockMinimo ?? 10)));
    const precioVentaCentimos = Math.round(Number(body.precioVentaCentimos ?? 0));
    const gravadoIgv = body.gravadoIgv !== false;
    const igvPorcentaje = gravadoIgv ? Number(body.igvPorcentaje ?? 18) : 0;

    const pool = await getSqlPool();
    const upd = await pool
      .request()
      .input('ProductoId', sql.NVarChar(36), productoId)
      .input('CodigoBarras', sql.NVarChar(64), body.codigoBarras ? String(body.codigoBarras).trim() : null)
      .input('Nombre', sql.NVarChar(180), String(body.nombre || '').trim())
      .input('PrincipioActivo', sql.NVarChar(180), String(body.principioActivo || '').trim())
      .input('Concentracion', sql.NVarChar(80), String(body.concentracion || '').trim())
      .input('Presentacion', sql.NVarChar(120), String(body.presentacion || '').trim())
      .input('Laboratorio', sql.NVarChar(120), String(body.laboratorio || '').trim())
      .input('Categoria', sql.NVarChar(80), String(body.categoria || '').trim())
      .input('RegistroSanitario', sql.NVarChar(60), body.registroSanitario ? String(body.registroSanitario).trim() : null)
      .input('CondicionVenta', sql.NVarChar(20), condicionVenta)
      .input('RequiereReceta', sql.Bit, requiereReceta ? 1 : 0)
      .input('StockMinimo', sql.Int, stockMinimo)
      .input('PrecioVentaCentimos', sql.BigInt, precioVentaCentimos)
      .input('GravadoIgv', sql.Bit, gravadoIgv ? 1 : 0)
      .input('IgvPorcentaje', sql.Decimal(5, 2), igvPorcentaje)
      .input('UbicacionPasillo', sql.NVarChar(60), body.ubicacionPasillo ? String(body.ubicacionPasillo).trim() : null)
      .input('UbicacionEstante', sql.NVarChar(60), body.ubicacionEstante ? String(body.ubicacionEstante).trim() : null)
      .input('TemperaturaAlmacen', sql.NVarChar(60), body.temperaturaAlmacen ? String(body.temperaturaAlmacen).trim() : null)
      .query(`
        UPDATE dbo.Productos
        SET CodigoBarras = @CodigoBarras,
            Nombre = @Nombre,
            PrincipioActivo = @PrincipioActivo,
            Concentracion = @Concentracion,
            Presentacion = @Presentacion,
            Laboratorio = @Laboratorio,
            Categoria = @Categoria,
            RegistroSanitario = @RegistroSanitario,
            CondicionVenta = @CondicionVenta,
            RequiereReceta = @RequiereReceta,
            StockMinimo = @StockMinimo,
            PrecioVentaCentimos = @PrecioVentaCentimos,
            GravadoIgv = @GravadoIgv,
            IgvPorcentaje = @IgvPorcentaje,
            UbicacionPasillo = @UbicacionPasillo,
            UbicacionEstante = @UbicacionEstante,
            TemperaturaAlmacen = @TemperaturaAlmacen
        WHERE ProductoId = @ProductoId
      `);

    if (upd.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error actualizando producto:', err);
    return res.status(500).json({ error: 'No se pudo actualizar el producto.' });
  }
});

inventoryRouter.get(
  '/productos/:id/lotes',
  requirePermission('inventario.ver', 'kardex.ver'),
  async (req, res) => {
    try {
      const pool = await getSqlPool();
      const lotesRes = await pool
        .request()
        .input('ProductoId', sql.NVarChar(36), String(req.params.id))
        .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
        .query(`
          SELECT LoteId, ProductoId, SucursalId, NumeroLote, FechaVencimiento,
                 CostoAdquisicionCentimos, CantidadFisica, CantidadDisponible,
                 EstadoAptitud, Observacion, CreadoEn
          FROM dbo.Lotes
          WHERE ProductoId = @ProductoId AND SucursalId = @SucursalId
          ORDER BY FechaVencimiento ASC
        `);

      return res.json({
        lotes: lotesRes.recordset.map((l: any) => ({
          loteId: l.LoteId,
          productoId: l.ProductoId,
          sucursalId: l.SucursalId,
          numeroLote: l.NumeroLote,
          fechaVencimiento: formatDateYmd(l.FechaVencimiento),
          costoAdquisicionCentimos: Number(l.CostoAdquisicionCentimos),
          cantidadFisica: Number(l.CantidadFisica),
          cantidadDisponible: Number(l.CantidadDisponible),
          estadoAptitud: l.EstadoAptitud,
          observacion: l.Observacion,
          creadoEn: l.CreadoEn,
        })),
      });
    } catch (err) {
      console.error('Error consultando lotes:', err);
      return res.status(500).json({ error: 'Error consultando lotes del producto.' });
    }
  }
);

inventoryRouter.post('/inventario/ajuste', requirePermission('inventario.ajustar'), async (req, res) => {
  try {
    const body = req.body || {};
    const productoId = String(body.productoId || '').trim();
    const loteId = String(body.loteId || '').trim();
    const deltaCantidad = Math.trunc(Number(body.deltaCantidad || 0));
    const nuevoEstadoAptitud = body.nuevoEstadoAptitud
      ? String(body.nuevoEstadoAptitud).trim()
      : null;
    const motivo = String(body.motivo || '').trim();

    if (!productoId || !loteId || !motivo) {
      return res.status(400).json({ error: 'Producto, lote y motivo del ajuste son obligatorios.' });
    }
    if (deltaCantidad === 0 && !nuevoEstadoAptitud) {
      return res.status(400).json({ error: 'Indique una variación de cantidad o un cambio de aptitud.' });
    }

    const sucursalId = req.auth!.sucursalId;
    const todayIso = getLimaTodayIso();

    const result = await withTransaction(async (tx) => {
      const loteRes = await tx
        .request()
        .input('LoteId', sql.NVarChar(36), loteId)
        .input('ProductoId', sql.NVarChar(36), productoId)
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .query(`
          SELECT LoteId, NumeroLote, FechaVencimiento, CostoAdquisicionCentimos,
                 CantidadFisica, CantidadDisponible, EstadoAptitud
          FROM dbo.Lotes WITH (UPDLOCK, HOLDLOCK)
          WHERE LoteId = @LoteId AND ProductoId = @ProductoId AND SucursalId = @SucursalId
        `);

      if (loteRes.recordset.length === 0) {
        throw new DomainRuleError('LOT_NOT_FOUND', 'Lote no encontrado en esta sucursal.', 404);
      }

      const lote = loteRes.recordset[0];
      const nuevaFisica = Number(lote.CantidadFisica) + deltaCantidad;
      if (nuevaFisica < 0) {
        throw new DomainRuleError(
          'NEGATIVE_STOCK',
          'El ajuste no puede dejar el stock físico del lote en negativo.'
        );
      }

      const estadoFinal = (nuevoEstadoAptitud || lote.EstadoAptitud) as
        | 'APTO'
        | 'BLOQUEADO'
        | 'CUARENTENA'
        | 'VENCIDO';
      const fv = formatDateYmd(lote.FechaVencimiento)!;
      const esVendible = estadoFinal === 'APTO' && fv >= todayIso;
      const nuevaDisponible = esVendible ? nuevaFisica : 0;

      await tx
        .request()
        .input('LoteId', sql.NVarChar(36), loteId)
        .input('CantidadFisica', sql.Int, nuevaFisica)
        .input('CantidadDisponible', sql.Int, nuevaDisponible)
        .input('EstadoAptitud', sql.NVarChar(20), estadoFinal)
        .input('Observacion', sql.NVarChar(240), motivo.slice(0, 240))
        .query(`
          UPDATE dbo.Lotes
          SET CantidadFisica = @CantidadFisica,
              CantidadDisponible = @CantidadDisponible,
              EstadoAptitud = @EstadoAptitud,
              Observacion = @Observacion
          WHERE LoteId = @LoteId
        `);

      const totalStockRes = await tx
        .request()
        .input('ProductoId', sql.NVarChar(36), productoId)
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .query(`
          SELECT ISNULL(SUM(CantidadFisica), 0) AS TotalFisico
          FROM dbo.Lotes
          WHERE ProductoId = @ProductoId AND SucursalId = @SucursalId
        `);
      const saldoResultante = Number(totalStockRes.recordset[0].TotalFisico);

      const docRef = `AJU-${Date.now().toString().slice(-6)}`;
      const tipoMov = deltaCantidad >= 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';

      await tx
        .request()
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .input('ProductoId', sql.NVarChar(36), productoId)
        .input('LoteId', sql.NVarChar(36), loteId)
        .input('Tipo', sql.NVarChar(30), tipoMov)
        .input('DocumentoRef', sql.NVarChar(80), docRef)
        .input('CantidadEntrada', sql.Int, deltaCantidad > 0 ? deltaCantidad : 0)
        .input('CantidadSalida', sql.Int, deltaCantidad < 0 ? Math.abs(deltaCantidad) : 0)
        .input('SaldoProductoResultante', sql.Int, saldoResultante)
        .input('CostoUnitarioCentimos', sql.BigInt, Number(lote.CostoAdquisicionCentimos))
        .input('Motivo', sql.NVarChar(240), motivo)
        .input('ResponsableId', sql.NVarChar(36), req.auth!.usuarioId)
        .input('ResponsableUsername', sql.NVarChar(60), req.auth!.username)
        .query(`
          INSERT INTO dbo.MovimientosStock (
            SucursalId, ProductoId, LoteId, Tipo, DocumentoRef, CantidadEntrada, CantidadSalida,
            SaldoProductoResultante, CostoUnitarioCentimos, Motivo, ResponsableId, ResponsableUsername
          ) VALUES (
            @SucursalId, @ProductoId, @LoteId, @Tipo, @DocumentoRef, @CantidadEntrada, @CantidadSalida,
            @SaldoProductoResultante, @CostoUnitarioCentimos, @Motivo, @ResponsableId, @ResponsableUsername
          )
        `);

      await tx
        .request()
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .input('UsuarioId', sql.NVarChar(36), req.auth!.usuarioId)
        .input('EntidadId', sql.NVarChar(60), loteId)
        .input(
          'DetalleJson',
          sql.NVarChar(sql.MAX),
          JSON.stringify({ productoId, loteId, deltaCantidad, estadoFinal, motivo })
        )
        .query(`
          INSERT INTO dbo.Auditoria (SucursalId, UsuarioId, Accion, Entidad, EntidadId, DetalleJson)
          VALUES (@SucursalId, @UsuarioId, N'AJUSTE_INVENTARIO', N'Lote', @EntidadId, @DetalleJson)
        `);

      return { docRef, nuevaFisica, nuevaDisponible, estadoFinal, saldoResultante };
    });

    return res.json(result);
  } catch (err) {
    if (err instanceof DomainRuleError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('Error en ajuste de inventario:', err);
    return res.status(500).json({ error: 'Error ejecutando el ajuste de inventario.' });
  }
});

// Proveedores
inventoryRouter.get('/proveedores', requirePermission('compras.ver'), async (req, res) => {
  try {
    const pool = await getSqlPool();
    const provRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
      .query(`
        SELECT
          p.ProveedorId, p.Ruc, p.RazonSocial, p.ContactoNombre, p.Telefono, p.Email, p.Direccion, p.Activo,
          MAX(r.RecibidoEn) AS UltimaCompraFecha,
          COUNT(DISTINCT oc.OrdenId) AS OrdenesCount
        FROM dbo.Proveedores p
        LEFT JOIN dbo.Recepciones r ON r.ProveedorId = p.ProveedorId AND r.SucursalId = @SucursalId
        LEFT JOIN dbo.OrdenesCompra oc ON oc.ProveedorId = p.ProveedorId AND oc.SucursalId = @SucursalId
        WHERE p.Activo = 1
        GROUP BY p.ProveedorId, p.Ruc, p.RazonSocial, p.ContactoNombre, p.Telefono, p.Email, p.Direccion, p.Activo
        ORDER BY p.RazonSocial ASC
      `);

    return res.json({
      proveedores: provRes.recordset.map((r: any) => ({
        proveedorId: r.ProveedorId,
        ruc: r.Ruc,
        razonSocial: r.RazonSocial,
        contactoNombre: r.ContactoNombre,
        telefono: r.Telefono,
        email: r.Email,
        direccion: r.Direccion,
        activo: Boolean(r.Activo),
        ultimaCompraFecha: r.UltimaCompraFecha,
        ordenesCount: Number(r.OrdenesCount),
      })),
    });
  } catch (err) {
    console.error('Error listando proveedores:', err);
    return res.status(500).json({ error: 'Error consultando proveedores.' });
  }
});

inventoryRouter.post('/proveedores', requirePermission('compras.crear'), async (req, res) => {
  try {
    const body = req.body || {};
    const ruc = String(body.ruc || '').trim();
    const razonSocial = String(body.razonSocial || '').trim();
    const contactoNombre = String(body.contactoNombre || '').trim();

    if (!/^\d{11}$/.test(ruc)) {
      return res.status(400).json({ error: 'El RUC del proveedor debe tener exactamente 11 dígitos numéricos.' });
    }
    if (!razonSocial || !contactoNombre) {
      return res.status(400).json({ error: 'Razón social y nombre de contacto son obligatorios.' });
    }

    const pool = await getSqlPool();
    const dup = await pool
      .request()
      .input('Ruc', sql.NVarChar(11), ruc)
      .query('SELECT ProveedorId FROM dbo.Proveedores WHERE Ruc = @Ruc');
    if (dup.recordset.length > 0) {
      return res.status(409).json({ error: `Ya existe un proveedor registrado con RUC ${ruc}.` });
    }

    const proveedorId = crypto.randomUUID();
    await pool
      .request()
      .input('ProveedorId', sql.NVarChar(36), proveedorId)
      .input('Ruc', sql.NVarChar(11), ruc)
      .input('RazonSocial', sql.NVarChar(160), razonSocial)
      .input('ContactoNombre', sql.NVarChar(120), contactoNombre)
      .input('Telefono', sql.NVarChar(40), body.telefono ? String(body.telefono).trim() : null)
      .input('Email', sql.NVarChar(120), body.email ? String(body.email).trim() : null)
      .input('Direccion', sql.NVarChar(200), body.direccion ? String(body.direccion).trim() : null)
      .query(`
        INSERT INTO dbo.Proveedores (ProveedorId, Ruc, RazonSocial, ContactoNombre, Telefono, Email, Direccion)
        VALUES (@ProveedorId, @Ruc, @RazonSocial, @ContactoNombre, @Telefono, @Email, @Direccion)
      `);

    return res.status(201).json({ proveedorId, ruc, razonSocial });
  } catch (err) {
    console.error('Error creando proveedor:', err);
    return res.status(500).json({ error: 'No se pudo registrar el proveedor.' });
  }
});

// Órdenes de Compra
inventoryRouter.get('/compras/ordenes', requirePermission('compras.ver'), async (req, res) => {
  try {
    const pool = await getSqlPool();
    const sucursalId = req.auth!.sucursalId;

    const ordenesRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .query(`
        SELECT oc.OrdenId, oc.NumeroOrden, oc.ProveedorId, p.RazonSocial AS ProveedorNombre, p.Ruc AS ProveedorRuc,
               oc.Estado, oc.Urgencia, oc.FechaEstimadaEntrega, oc.SubtotalEstimadoCentimos, oc.Observaciones, oc.CreadoEn
        FROM dbo.OrdenesCompra oc
        INNER JOIN dbo.Proveedores p ON p.ProveedorId = oc.ProveedorId
        WHERE oc.SucursalId = @SucursalId
        ORDER BY oc.CreadoEn DESC
      `);

    const detRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .query(`
        SELECT d.OrdenDetalleId, d.OrdenId, d.ProductoId, pr.Sku, pr.Nombre AS ProductoNombre, pr.Presentacion,
               d.CantidadSolicitada, d.CantidadRecibida, d.CostoUnitarioCentimos
        FROM dbo.OrdenCompraDetalle d
        INNER JOIN dbo.OrdenesCompra oc ON oc.OrdenId = d.OrdenId
        INNER JOIN dbo.Productos pr ON pr.ProductoId = d.ProductoId
        WHERE oc.SucursalId = @SucursalId
      `);

    const itemsByOrden = new Map<string, any[]>();
    for (const d of detRes.recordset) {
      if (!itemsByOrden.has(d.OrdenId)) itemsByOrden.set(d.OrdenId, []);
      itemsByOrden.get(d.OrdenId)!.push({
        ordenDetalleId: d.OrdenDetalleId,
        productoId: d.ProductoId,
        sku: d.Sku,
        productoNombre: d.ProductoNombre,
        presentacion: d.Presentacion,
        cantidadSolicitada: Number(d.CantidadSolicitada),
        cantidadRecibida: Number(d.CantidadRecibida),
        costoUnitarioCentimos: Number(d.CostoUnitarioCentimos),
      });
    }

    const ordenes = ordenesRes.recordset.map((o: any) => {
      const items = itemsByOrden.get(o.OrdenId) || [];
      return {
        ordenId: o.OrdenId,
        numeroOrden: o.NumeroOrden,
        proveedorId: o.ProveedorId,
        proveedorNombre: o.ProveedorNombre,
        proveedorRuc: o.ProveedorRuc,
        estado: o.Estado,
        urgencia: o.Urgencia,
        fechaEstimadaEntrega: formatDateYmd(o.FechaEstimadaEntrega),
        subtotalEstimadoCentimos: Number(o.SubtotalEstimadoCentimos),
        observaciones: o.Observaciones,
        creadoEn: o.CreadoEn,
        totalUnidadesSolicitadas: items.reduce((a, i) => a + i.cantidadSolicitada, 0),
        totalUnidadesRecibidas: items.reduce((a, i) => a + i.cantidadRecibida, 0),
        items,
      };
    });

    const resumen = {
      pendientes: ordenes.filter((o) => o.estado === 'PENDIENTE').length,
      enviados: ordenes.filter((o) => o.estado === 'ENVIADO').length,
      recibidosParciales: ordenes.filter((o) => o.estado === 'RECIBIDO').length,
      completados: ordenes.filter((o) => o.estado === 'COMPLETADO').length,
      puntajeProveedorEstado: 'Sin datos',
      ahorroEstimadoEstado: 'Sin datos',
    };

    return res.json({ ordenes, resumen });
  } catch (err) {
    console.error('Error listando órdenes:', err);
    return res.status(500).json({ error: 'Error consultando órdenes de compra.' });
  }
});

inventoryRouter.post('/compras/ordenes', requirePermission('compras.crear'), async (req, res) => {
  try {
    const body = req.body || {};
    const proveedorId = String(body.proveedorId || '').trim();
    const urgencia = body.urgencia === 'CRITICA' ? 'CRITICA' : 'NORMAL';
    const items = Array.isArray(body.items) ? body.items : [];
    const observaciones = body.observaciones ? String(body.observaciones).trim() : null;
    const fechaEstimadaEntrega = body.fechaEstimadaEntrega
      ? String(body.fechaEstimadaEntrega).slice(0, 10)
      : null;

    if (!proveedorId || items.length === 0) {
      return res.status(400).json({ error: 'Seleccione un proveedor y agregue al menos un producto.' });
    }

    for (const item of items) {
      if (!item.productoId || !Number.isInteger(Number(item.cantidad)) || Number(item.cantidad) <= 0) {
        return res.status(400).json({ error: 'Cada línea debe tener producto y cantidad entera mayor a cero.' });
      }
      if (!Number.isInteger(Number(item.costoUnitarioCentimos)) || Number(item.costoUnitarioCentimos) < 0) {
        return res.status(400).json({ error: 'El costo unitario en céntimos es inválido.' });
      }
    }

    const subtotalEstimadoCentimos = items.reduce(
      (acc: number, it: any) => acc + Number(it.cantidad) * Number(it.costoUnitarioCentimos),
      0
    );

    const ordenId = crypto.randomUUID();
    const numeroOrden = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;

    await withTransaction(async (tx) => {
      await tx
        .request()
        .input('OrdenId', sql.NVarChar(36), ordenId)
        .input('NumeroOrden', sql.NVarChar(30), numeroOrden)
        .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
        .input('ProveedorId', sql.NVarChar(36), proveedorId)
        .input('Estado', sql.NVarChar(20), 'PENDIENTE')
        .input('Urgencia', sql.NVarChar(20), urgencia)
        .input('FechaEstimadaEntrega', sql.Date, fechaEstimadaEntrega)
        .input('SubtotalEstimadoCentimos', sql.BigInt, subtotalEstimadoCentimos)
        .input('Observaciones', sql.NVarChar(300), observaciones)
        .input('CreadoPor', sql.NVarChar(36), req.auth!.usuarioId)
        .query(`
          INSERT INTO dbo.OrdenesCompra (
            OrdenId, NumeroOrden, SucursalId, ProveedorId, Estado, Urgencia,
            FechaEstimadaEntrega, SubtotalEstimadoCentimos, Observaciones, CreadoPor
          ) VALUES (
            @OrdenId, @NumeroOrden, @SucursalId, @ProveedorId, @Estado, @Urgencia,
            @FechaEstimadaEntrega, @SubtotalEstimadoCentimos, @Observaciones, @CreadoPor
          )
        `);

      for (const item of items) {
        await tx
          .request()
          .input('OrdenDetalleId', sql.NVarChar(36), crypto.randomUUID())
          .input('OrdenId', sql.NVarChar(36), ordenId)
          .input('ProductoId', sql.NVarChar(36), String(item.productoId))
          .input('CantidadSolicitada', sql.Int, Number(item.cantidad))
          .input('CostoUnitarioCentimos', sql.BigInt, Number(item.costoUnitarioCentimos))
          .query(`
            INSERT INTO dbo.OrdenCompraDetalle (OrdenDetalleId, OrdenId, ProductoId, CantidadSolicitada, CantidadRecibida, CostoUnitarioCentimos)
            VALUES (@OrdenDetalleId, @OrdenId, @ProductoId, @CantidadSolicitada, 0, @CostoUnitarioCentimos)
          `);
      }
    });

    return res.status(201).json({ ordenId, numeroOrden });
  } catch (err) {
    console.error('Error creando orden de compra:', err);
    return res.status(500).json({ error: 'No se pudo crear la orden de compra.' });
  }
});

inventoryRouter.patch(
  '/compras/ordenes/:id/estado',
  requirePermission('compras.crear'),
  async (req, res) => {
    try {
      const ordenId = String(req.params.id);
      const nuevoEstado = String(req.body?.estado || '').toUpperCase();
      if (!['ENVIADO', 'CANCELADO'].includes(nuevoEstado)) {
        return res.status(400).json({
          error: 'Transición inválida. Para pasar a RECIBIDO o COMPLETADO registre una recepción.',
        });
      }

      const pool = await getSqlPool();
      const upd = await pool
        .request()
        .input('OrdenId', sql.NVarChar(36), ordenId)
        .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
        .input('Estado', sql.NVarChar(20), nuevoEstado)
        .query(`
          UPDATE dbo.OrdenesCompra
          SET Estado = @Estado, ActualizadoEn = SYSUTCDATETIME()
          WHERE OrdenId = @OrdenId AND SucursalId = @SucursalId AND Estado IN ('PENDIENTE', 'ENVIADO')
        `);

      if (upd.rowsAffected[0] === 0) {
        return res.status(409).json({ error: 'La orden no existe o no admite cambio de estado.' });
      }
      return res.json({ ok: true, estado: nuevoEstado });
    } catch (err) {
      console.error('Error actualizando estado de orden:', err);
      return res.status(500).json({ error: 'Error actualizando el estado de la orden.' });
    }
  }
);

// Recepción por lote (idempotente, incrementa stock real y registra Kardex)
inventoryRouter.post(
  '/compras/recepciones',
  requirePermission('compras.recibir'),
  async (req, res) => {
    try {
      const body = req.body || {};
      const ordenId = body.ordenId ? String(body.ordenId).trim() : null;
      const proveedorId = String(body.proveedorId || '').trim();
      const documentoReferencia = String(body.documentoReferencia || '').trim();
      const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID()).trim();
      const observaciones = body.observaciones ? String(body.observaciones).trim() : null;
      const items = Array.isArray(body.items) ? body.items : [];

      if (!documentoReferencia || items.length === 0) {
        return res.status(400).json({
          error: 'Documento de referencia y al menos un ítem de recepción son obligatorios.',
        });
      }

      const todayIso = getLimaTodayIso();
      for (const it of items) {
        if (!it.productoId || !it.numeroLote || !it.fechaVencimiento) {
          return res.status(400).json({
            error: 'Cada línea recibida requiere producto, número de lote y fecha de vencimiento.',
          });
        }
        if (!Number.isInteger(Number(it.cantidadRecibida)) || Number(it.cantidadRecibida) <= 0) {
          return res.status(400).json({ error: 'La cantidad recibida debe ser mayor a cero.' });
        }
        if (!Number.isInteger(Number(it.costoUnitarioCentimos)) || Number(it.costoUnitarioCentimos) < 0) {
          return res.status(400).json({ error: 'El costo unitario debe estar en céntimos válidos.' });
        }
      }

      const sucursalId = req.auth!.sucursalId;

      const result = await withTransaction(async (tx) => {
        const idempRes = await tx
          .request()
          .input('IdempotencyKey', sql.NVarChar(100), idempotencyKey)
          .query(
            'SELECT RespuestaJson FROM dbo.ClavesIdempotencia WITH (UPDLOCK, HOLDLOCK) WHERE IdempotencyKey = @IdempotencyKey'
          );

        if (idempRes.recordset.length > 0) {
          return JSON.parse(idempRes.recordset[0].RespuestaJson);
        }

        let resolvedProveedorId = proveedorId;
        if (ordenId) {
          const ordRes = await tx
            .request()
            .input('OrdenId', sql.NVarChar(36), ordenId)
            .input('SucursalId', sql.NVarChar(36), sucursalId)
            .query(
              'SELECT OrdenId, ProveedorId, Estado FROM dbo.OrdenesCompra WITH (UPDLOCK, HOLDLOCK) WHERE OrdenId = @OrdenId AND SucursalId = @SucursalId'
            );
          if (ordRes.recordset.length === 0) {
            throw new DomainRuleError('ORDER_NOT_FOUND', 'Orden de compra no encontrada.', 404);
          }
          if (ordRes.recordset[0].Estado === 'CANCELADO') {
            throw new DomainRuleError('ORDER_CANCELLED', 'No se puede recibir una orden cancelada.');
          }
          resolvedProveedorId = ordRes.recordset[0].ProveedorId;
        }

        if (!resolvedProveedorId) {
          throw new DomainRuleError('SUPPLIER_REQUIRED', 'Debe indicar el proveedor de la recepción.');
        }

        const recepcionId = crypto.randomUUID();
        await tx
          .request()
          .input('RecepcionId', sql.NVarChar(36), recepcionId)
          .input('OrdenId', sql.NVarChar(36), ordenId)
          .input('SucursalId', sql.NVarChar(36), sucursalId)
          .input('ProveedorId', sql.NVarChar(36), resolvedProveedorId)
          .input('DocumentoReferencia', sql.NVarChar(60), documentoReferencia)
          .input('IdempotencyKey', sql.NVarChar(100), idempotencyKey)
          .input('RecibidoPor', sql.NVarChar(36), req.auth!.usuarioId)
          .input('Observaciones', sql.NVarChar(300), observaciones)
          .query(`
            INSERT INTO dbo.Recepciones (
              RecepcionId, OrdenId, SucursalId, ProveedorId, DocumentoReferencia,
              IdempotencyKey, RecibidoPor, Observaciones
            ) VALUES (
              @RecepcionId, @OrdenId, @SucursalId, @ProveedorId, @DocumentoReferencia,
              @IdempotencyKey, @RecibidoPor, @Observaciones
            )
          `);

        const lotesAfectados: any[] = [];

        for (const it of items) {
          const productoId = String(it.productoId);
          const numeroLote = String(it.numeroLote).trim().toUpperCase();
          const fechaVencimiento = String(it.fechaVencimiento).slice(0, 10);
          const cantidadRecibida = Number(it.cantidadRecibida);
          const costoUnitarioCentimos = Number(it.costoUnitarioCentimos);
          const ordenDetalleId = it.ordenDetalleId ? String(it.ordenDetalleId) : null;

          const lotRes = await tx
            .request()
            .input('ProductoId', sql.NVarChar(36), productoId)
            .input('SucursalId', sql.NVarChar(36), sucursalId)
            .input('NumeroLote', sql.NVarChar(60), numeroLote)
            .query(`
              SELECT LoteId, CantidadFisica, CantidadDisponible, EstadoAptitud, FechaVencimiento
              FROM dbo.Lotes WITH (UPDLOCK, HOLDLOCK)
              WHERE ProductoId = @ProductoId AND SucursalId = @SucursalId AND NumeroLote = @NumeroLote
            `);

          let loteId: string;
          const isExpired = fechaVencimiento < todayIso;

          if (lotRes.recordset.length > 0) {
            const ex = lotRes.recordset[0];
            loteId = ex.LoteId;
            const addDisp = ex.EstadoAptitud === 'APTO' && !isExpired ? cantidadRecibida : 0;
            await tx
              .request()
              .input('LoteId', sql.NVarChar(36), loteId)
              .input('AddFis', sql.Int, cantidadRecibida)
              .input('AddDisp', sql.Int, addDisp)
              .input('Costo', sql.BigInt, costoUnitarioCentimos)
              .query(`
                UPDATE dbo.Lotes
                SET CantidadFisica = CantidadFisica + @AddFis,
                    CantidadDisponible = CantidadDisponible + @AddDisp,
                    CostoAdquisicionCentimos = @Costo
                WHERE LoteId = @LoteId
              `);
          } else {
            loteId = crypto.randomUUID();
            const estadoAptitud = isExpired ? 'VENCIDO' : 'APTO';
            const cantDisp = isExpired ? 0 : cantidadRecibida;
            await tx
              .request()
              .input('LoteId', sql.NVarChar(36), loteId)
              .input('ProductoId', sql.NVarChar(36), productoId)
              .input('SucursalId', sql.NVarChar(36), sucursalId)
              .input('NumeroLote', sql.NVarChar(60), numeroLote)
              .input('FechaVencimiento', sql.Date, fechaVencimiento)
              .input('Costo', sql.BigInt, costoUnitarioCentimos)
              .input('CantidadFisica', sql.Int, cantidadRecibida)
              .input('CantidadDisponible', sql.Int, cantDisp)
              .input('EstadoAptitud', sql.NVarChar(20), estadoAptitud)
              .query(`
                INSERT INTO dbo.Lotes (
                  LoteId, ProductoId, SucursalId, NumeroLote, FechaVencimiento,
                  CostoAdquisicionCentimos, CantidadFisica, CantidadDisponible, EstadoAptitud
                ) VALUES (
                  @LoteId, @ProductoId, @SucursalId, @NumeroLote, @FechaVencimiento,
                  @Costo, @CantidadFisica, @CantidadDisponible, @EstadoAptitud
                )
              `);
          }

          await tx
            .request()
            .input('RecepcionDetalleId', sql.NVarChar(36), crypto.randomUUID())
            .input('RecepcionId', sql.NVarChar(36), recepcionId)
            .input('OrdenDetalleId', sql.NVarChar(36), ordenDetalleId)
            .input('ProductoId', sql.NVarChar(36), productoId)
            .input('LoteId', sql.NVarChar(36), loteId)
            .input('NumeroLote', sql.NVarChar(60), numeroLote)
            .input('FechaVencimiento', sql.Date, fechaVencimiento)
            .input('CantidadRecibida', sql.Int, cantidadRecibida)
            .input('CostoUnitarioCentimos', sql.BigInt, costoUnitarioCentimos)
            .query(`
              INSERT INTO dbo.RecepcionDetalle (
                RecepcionDetalleId, RecepcionId, OrdenDetalleId, ProductoId, LoteId,
                NumeroLote, FechaVencimiento, CantidadRecibida, CostoUnitarioCentimos
              ) VALUES (
                @RecepcionDetalleId, @RecepcionId, @OrdenDetalleId, @ProductoId, @LoteId,
                @NumeroLote, @FechaVencimiento, @CantidadRecibida, @CostoUnitarioCentimos
              )
            `);

          if (ordenId) {
            if (ordenDetalleId) {
              await tx
                .request()
                .input('OrdenDetalleId', sql.NVarChar(36), ordenDetalleId)
                .input('Qty', sql.Int, cantidadRecibida)
                .query(`
                  UPDATE dbo.OrdenCompraDetalle
                  SET CantidadRecibida = CantidadRecibida + @Qty
                  WHERE OrdenDetalleId = @OrdenDetalleId
                `);
            } else {
              await tx
                .request()
                .input('OrdenId', sql.NVarChar(36), ordenId)
                .input('ProductoId', sql.NVarChar(36), productoId)
                .input('Qty', sql.Int, cantidadRecibida)
                .query(`
                  UPDATE dbo.OrdenCompraDetalle
                  SET CantidadRecibida = CantidadRecibida + @Qty
                  WHERE OrdenId = @OrdenId AND ProductoId = @ProductoId
                `);
            }
          }

          const totalRes = await tx
            .request()
            .input('ProductoId', sql.NVarChar(36), productoId)
            .input('SucursalId', sql.NVarChar(36), sucursalId)
            .query(`
              SELECT ISNULL(SUM(CantidadFisica), 0) AS TotalFisico
              FROM dbo.Lotes
              WHERE ProductoId = @ProductoId AND SucursalId = @SucursalId
            `);
          const saldoResultante = Number(totalRes.recordset[0].TotalFisico);

          await tx
            .request()
            .input('SucursalId', sql.NVarChar(36), sucursalId)
            .input('ProductoId', sql.NVarChar(36), productoId)
            .input('LoteId', sql.NVarChar(36), loteId)
            .input('DocumentoRef', sql.NVarChar(80), documentoReferencia)
            .input('CantidadEntrada', sql.Int, cantidadRecibida)
            .input('SaldoProductoResultante', sql.Int, saldoResultante)
            .input('CostoUnitarioCentimos', sql.BigInt, costoUnitarioCentimos)
            .input('Motivo', sql.NVarChar(240), ordenId ? `Recepción orden ${ordenId}` : 'Ingreso directo a almacén')
            .input('ResponsableId', sql.NVarChar(36), req.auth!.usuarioId)
            .input('ResponsableUsername', sql.NVarChar(60), req.auth!.username)
            .query(`
              INSERT INTO dbo.MovimientosStock (
                SucursalId, ProductoId, LoteId, Tipo, DocumentoRef, CantidadEntrada, CantidadSalida,
                SaldoProductoResultante, CostoUnitarioCentimos, Motivo, ResponsableId, ResponsableUsername
              ) VALUES (
                @SucursalId, @ProductoId, @LoteId, N'COMPRA', @DocumentoRef, @CantidadEntrada, 0,
                @SaldoProductoResultante, @CostoUnitarioCentimos, @Motivo, @ResponsableId, @ResponsableUsername
              )
            `);

          lotesAfectados.push({ productoId, loteId, numeroLote, cantidadRecibida, saldoResultante });
        }

        let ordenEstadoFinal: string | null = null;
        if (ordenId) {
          const checkOrderRes = await tx
            .request()
            .input('OrdenId', sql.NVarChar(36), ordenId)
            .query(`
              SELECT
                SUM(CASE WHEN CantidadRecibida >= CantidadSolicitada THEN 0 ELSE 1 END) AS Pendientes
              FROM dbo.OrdenCompraDetalle
              WHERE OrdenId = @OrdenId
            `);
          const pendientes = Number(checkOrderRes.recordset[0]?.Pendientes || 0);
          ordenEstadoFinal = pendientes === 0 ? 'COMPLETADO' : 'RECIBIDO';
          await tx
            .request()
            .input('OrdenId', sql.NVarChar(36), ordenId)
            .input('Estado', sql.NVarChar(20), ordenEstadoFinal)
            .query(`
              UPDATE dbo.OrdenesCompra
              SET Estado = @Estado, ActualizadoEn = SYSUTCDATETIME()
              WHERE OrdenId = @OrdenId
            `);
        }

        const responsePayload = {
          recepcionId,
          documentoReferencia,
          ordenEstadoFinal,
          lotesAfectados,
        };

        await tx
          .request()
          .input('IdempotencyKey', sql.NVarChar(100), idempotencyKey)
          .input('Operacion', sql.NVarChar(50), 'RECEPCION')
          .input('EntidadId', sql.NVarChar(36), recepcionId)
          .input('RespuestaJson', sql.NVarChar(sql.MAX), JSON.stringify(responsePayload))
          .query(`
            INSERT INTO dbo.ClavesIdempotencia (IdempotencyKey, Operacion, EntidadId, RespuestaJson)
            VALUES (@IdempotencyKey, @Operacion, @EntidadId, @RespuestaJson)
          `);

        return responsePayload;
      });

      return res.status(201).json(result);
    } catch (err) {
      if (err instanceof DomainRuleError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      console.error('Error registrando recepción:', err);
      return res.status(500).json({ error: 'Error registrando la recepción de mercadería.' });
    }
  }
);

async function buildKardexData(
  sucursalId: string,
  productoId: string,
  fechaDesde?: string,
  fechaHasta?: string,
  tipoFiltro?: string
) {
  const pool = await getSqlPool();
  const prodRes = await pool
    .request()
    .input('ProductoId', sql.NVarChar(36), productoId)
    .input('SucursalId', sql.NVarChar(36), sucursalId)
    .query(`
      SELECT TOP 1
        p.*,
        ISNULL((SELECT SUM(l.CantidadFisica) FROM dbo.Lotes l WHERE l.ProductoId = p.ProductoId AND l.SucursalId = @SucursalId), 0) AS StockFisico,
        ISNULL((SELECT SUM(l.CantidadDisponible) FROM dbo.Lotes l WHERE l.ProductoId = p.ProductoId AND l.SucursalId = @SucursalId AND l.EstadoAptitud = 'APTO'), 0) AS StockDisponible
      FROM dbo.Productos p
      WHERE p.ProductoId = @ProductoId
    `);

  if (prodRes.recordset.length === 0) {
    throw new DomainRuleError('PRODUCT_NOT_FOUND', 'Producto no encontrado.', 404);
  }
  const p = prodRes.recordset[0];

  const movRes = await pool
    .request()
    .input('ProductoId', sql.NVarChar(36), productoId)
    .input('SucursalId', sql.NVarChar(36), sucursalId)
    .query(`
      SELECT m.MovimientoId, m.Tipo, m.DocumentoRef, l.NumeroLote, m.LoteId,
             m.CantidadEntrada, m.CantidadSalida, m.CostoUnitarioCentimos,
             m.Motivo, m.ResponsableUsername, m.CreadoEn
      FROM dbo.MovimientosStock m
      INNER JOIN dbo.Lotes l ON l.LoteId = m.LoteId
      WHERE m.ProductoId = @ProductoId AND m.SucursalId = @SucursalId
      ORDER BY m.CreadoEn ASC, m.MovimientoId ASC
    `);

  const allMovs = movRes.recordset.map((m: any) => ({
    movimientoId: Number(m.MovimientoId),
    tipo: m.Tipo as string,
    documentoRef: m.DocumentoRef as string,
    numeroLote: m.NumeroLote as string,
    loteId: m.LoteId as string,
    cantidadEntrada: Number(m.CantidadEntrada),
    cantidadSalida: Number(m.CantidadSalida),
    costoUnitarioCentimos: Number(m.CostoUnitarioCentimos),
    motivo: m.Motivo as string | null,
    responsableUsername: m.ResponsableUsername as string,
    creadoEn: new Date(m.CreadoEn).toISOString(),
    fechaLima: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(m.CreadoEn)),
    fechaHora: formatLimaDateTime(m.CreadoEn),
  }));

  // Saldo de arrastre exacto previo al filtro fechaDesde
  let saldoArrastre = 0;
  const inRangeAsc = allMovs.filter((m) => {
    if (fechaDesde && m.fechaLima < fechaDesde) {
      saldoArrastre += m.cantidadEntrada - m.cantidadSalida;
      return false;
    }
    if (fechaHasta && m.fechaLima > fechaHasta) {
      return false;
    }
    return true;
  });

  const withSaldo = computeKardexRunningBalances(inRangeAsc, saldoArrastre);
  const filteredByType =
    tipoFiltro && tipoFiltro !== 'TODOS'
      ? withSaldo.filter((m) => m.tipo === tipoFiltro)
      : withSaldo;

  // Rotación mensual (últimos 5 meses)
  const rotacionMap = new Map<string, number>();
  for (const m of allMovs) {
    if (m.tipo === 'VENTA') {
      const ym = m.fechaLima.slice(0, 7);
      rotacionMap.set(ym, (rotacionMap.get(ym) || 0) + m.cantidadSalida);
    }
  }
  const rotacionMensual = Array.from(rotacionMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-5)
    .map(([mes, unidades]) => ({ mes, unidades }));

  const promedioMensual =
    rotacionMensual.length > 0
      ? Number(
          (
            rotacionMensual.reduce((a, b) => a + b.unidades, 0) / rotacionMensual.length
          ).toFixed(1)
        )
      : 0;

  return {
    producto: {
      productoId: p.ProductoId,
      sku: p.Sku,
      nombre: p.Nombre,
      principioActivo: p.PrincipioActivo,
      concentracion: p.Concentracion,
      presentacion: p.Presentacion,
      laboratorio: p.Laboratorio,
      registroSanitario: p.RegistroSanitario,
      condicionVenta: p.CondicionVenta,
      ubicacionPasillo: p.UbicacionPasillo,
      ubicacionEstante: p.UbicacionEstante,
      temperaturaAlmacen: p.TemperaturaAlmacen,
      stockFisico: Number(p.StockFisico),
      stockDisponible: Number(p.StockDisponible),
    },
    saldoArrastre,
    movimientos: [...filteredByType].reverse(), // Más recientes primero en UI
    movimientosAsc: filteredByType,
    rotacionMensual,
    promedioMensual,
  };
}

inventoryRouter.get('/kardex/:productoId', requirePermission('kardex.ver'), async (req, res) => {
  try {
    const data = await buildKardexData(
      req.auth!.sucursalId,
      String(req.params.productoId),
      req.query.fechaDesde ? String(req.query.fechaDesde) : undefined,
      req.query.fechaHasta ? String(req.query.fechaHasta) : undefined,
      req.query.tipo ? String(req.query.tipo) : undefined
    );
    return res.json(data);
  } catch (err) {
    if (err instanceof DomainRuleError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error consultando Kardex:', err);
    return res.status(500).json({ error: 'Error consultando el Kardex del producto.' });
  }
});

inventoryRouter.get('/kardex/:productoId/pdf', requirePermission('kardex.ver'), async (req, res) => {
  try {
    const fechaDesde = req.query.fechaDesde ? String(req.query.fechaDesde) : undefined;
    const fechaHasta = req.query.fechaHasta ? String(req.query.fechaHasta) : undefined;
    const tipo = req.query.tipo ? String(req.query.tipo) : undefined;
    const data = await buildKardexData(
      req.auth!.sucursalId,
      String(req.params.productoId),
      fechaDesde,
      fechaHasta,
      tipo
    );

    const rangoTexto =
      fechaDesde || fechaHasta
        ? `${fechaDesde || 'Inicio'} al ${fechaHasta || 'Hoy'}`
        : 'Histórico completo';

    const pdfBuffer = await generateKardexPdfBuffer({
      producto: {
        sku: data.producto.sku,
        nombre: data.producto.nombre,
        principioActivo: data.producto.principioActivo,
        concentracion: data.producto.concentracion,
        presentacion: data.producto.presentacion,
        laboratorio: data.producto.laboratorio,
        registroSanitario: data.producto.registroSanitario,
        condicionVenta: data.producto.condicionVenta,
        stockActual: data.producto.stockFisico,
      },
      sucursalNombre: req.auth!.sucursalNombre,
      rangoTexto,
      saldoArrastre: data.saldoArrastre,
      movimientos: data.movimientosAsc,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="kardex_${data.producto.sku}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (err) {
    if (err instanceof DomainRuleError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error exportando Kardex PDF:', err);
    return res.status(500).json({ error: 'Error generando PDF de Kardex.' });
  }
});
