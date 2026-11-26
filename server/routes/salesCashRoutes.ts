import crypto from 'node:crypto';
import express from 'express';
import { getSqlPool, sql, withTransaction } from '../db/mssqlClient';
import {
  allocateLotsFefo,
  computeCashReconciliation,
  computeLineAmounts,
  DomainRuleError,
  getLimaTodayIso,
  reconcileSalePayments,
  validatePrescriptionGate,
  type PaymentInput,
} from '../domain/erpRules';
import { requireAuth, requirePermission } from '../middleware/auth';

export const salesCashRouter = express.Router();
salesCashRouter.use(requireAuth);

function formatDateYmd(val: unknown): string {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

// Clientes
salesCashRouter.get('/clientes', requirePermission('pos.operar'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const pool = await getSqlPool();
    const result = await pool
      .request()
      .input('Q', sql.NVarChar(100), `%${q}%`)
      .query(`
        SELECT TOP 30 ClienteId, TipoDocumento, NumeroDocumento, NombreRazonSocial, Telefono, Direccion
        FROM dbo.Clientes
        WHERE (@Q = N'%%' OR NumeroDocumento LIKE @Q OR NombreRazonSocial LIKE @Q)
        ORDER BY NombreRazonSocial ASC
      `);
    return res.json({
      clientes: result.recordset.map((c: any) => ({
        clienteId: c.ClienteId,
        tipoDocumento: c.TipoDocumento,
        numeroDocumento: c.NumeroDocumento,
        nombreRazonSocial: c.NombreRazonSocial,
        telefono: c.Telefono,
        direccion: c.Direccion,
      })),
    });
  } catch (err) {
    console.error('Error buscando clientes:', err);
    return res.status(500).json({ error: 'Error consultando clientes.' });
  }
});

salesCashRouter.post('/clientes', requirePermission('pos.operar'), async (req, res) => {
  try {
    const body = req.body || {};
    const tipoDocumento = ['DNI', 'RUC', 'CE', 'SIN_DOC'].includes(body.tipoDocumento)
      ? body.tipoDocumento
      : 'DNI';
    const numeroDocumento = String(body.numeroDocumento || '').trim();
    const nombreRazonSocial = String(body.nombreRazonSocial || '').trim();

    if (!numeroDocumento || !nombreRazonSocial) {
      return res.status(400).json({ error: 'Número de documento y nombre/razón social son obligatorios.' });
    }
    if (tipoDocumento === 'DNI' && !/^\d{8}$/.test(numeroDocumento)) {
      return res.status(400).json({ error: 'El DNI debe tener 8 dígitos numéricos.' });
    }
    if (tipoDocumento === 'RUC' && !/^\d{11}$/.test(numeroDocumento)) {
      return res.status(400).json({ error: 'El RUC debe tener 11 dígitos numéricos.' });
    }

    const pool = await getSqlPool();
    const existing = await pool
      .request()
      .input('Doc', sql.NVarChar(20), numeroDocumento)
      .query('SELECT ClienteId, TipoDocumento, NumeroDocumento, NombreRazonSocial FROM dbo.Clientes WHERE NumeroDocumento = @Doc');
    if (existing.recordset.length > 0) {
      const c = existing.recordset[0];
      return res.json({
        clienteId: c.ClienteId,
        tipoDocumento: c.TipoDocumento,
        numeroDocumento: c.NumeroDocumento,
        nombreRazonSocial: c.NombreRazonSocial,
      });
    }

    const clienteId = crypto.randomUUID();
    await pool
      .request()
      .input('ClienteId', sql.NVarChar(36), clienteId)
      .input('TipoDocumento', sql.NVarChar(15), tipoDocumento)
      .input('NumeroDocumento', sql.NVarChar(20), numeroDocumento)
      .input('NombreRazonSocial', sql.NVarChar(180), nombreRazonSocial)
      .input('Telefono', sql.NVarChar(40), body.telefono ? String(body.telefono).trim() : null)
      .input('Direccion', sql.NVarChar(200), body.direccion ? String(body.direccion).trim() : null)
      .query(`
        INSERT INTO dbo.Clientes (ClienteId, TipoDocumento, NumeroDocumento, NombreRazonSocial, Telefono, Direccion)
        VALUES (@ClienteId, @TipoDocumento, @NumeroDocumento, @NombreRazonSocial, @Telefono, @Direccion)
      `);

    return res.status(201).json({
      clienteId,
      tipoDocumento,
      numeroDocumento,
      nombreRazonSocial,
    });
  } catch (err) {
    console.error('Error registrando cliente:', err);
    return res.status(500).json({ error: 'No se pudo registrar el cliente.' });
  }
});

// Validación interna de receta por Farmacéutico
salesCashRouter.get('/recetas/validaciones', requirePermission('pos.operar', 'recetas.validar'), async (req, res) => {
  try {
    const ref = String(req.query.recetaReferencia || '').trim();
    const pool = await getSqlPool();
    const result = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
      .input('Ref', sql.NVarChar(100), ref)
      .query(`
        SELECT TOP 20 v.ValidacionId, v.RecetaReferencia, v.PacienteNombre, v.MedicoNombre,
               v.Observaciones, v.ValidadoEn, u.NombreCompleto AS ValidadoPorNombre, u.Username AS ValidadoPorUsername
        FROM dbo.ValidacionesReceta v
        INNER JOIN dbo.Usuarios u ON u.UsuarioId = v.ValidadoPor
        WHERE v.SucursalId = @SucursalId AND (@Ref = N'' OR v.RecetaReferencia = @Ref)
        ORDER BY v.ValidadoEn DESC
      `);

    return res.json({
      validaciones: result.recordset.map((v: any) => ({
        validacionId: v.ValidacionId,
        recetaReferencia: v.RecetaReferencia,
        pacienteNombre: v.PacienteNombre,
        medicoNombre: v.MedicoNombre,
        observaciones: v.Observaciones,
        validadoEn: v.ValidadoEn,
        validadoPorNombre: v.ValidadoPorNombre,
        validadoPorUsername: v.ValidadoPorUsername,
      })),
    });
  } catch (err) {
    console.error('Error consultando validaciones de receta:', err);
    return res.status(500).json({ error: 'Error consultando validaciones de receta.' });
  }
});

salesCashRouter.post('/recetas/validar', requirePermission('recetas.validar'), async (req, res) => {
  try {
    const body = req.body || {};
    const recetaReferencia = String(body.recetaReferencia || '').trim();
    if (!recetaReferencia) {
      return res.status(400).json({ error: 'La referencia de la receta médica es obligatoria.' });
    }

    const validacionId = crypto.randomUUID();
    const pool = await getSqlPool();
    await pool
      .request()
      .input('ValidacionId', sql.NVarChar(36), validacionId)
      .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
      .input('RecetaReferencia', sql.NVarChar(100), recetaReferencia)
      .input('PacienteNombre', sql.NVarChar(140), body.pacienteNombre ? String(body.pacienteNombre).trim() : null)
      .input('MedicoNombre', sql.NVarChar(140), body.medicoNombre ? String(body.medicoNombre).trim() : null)
      .input('Observaciones', sql.NVarChar(300), body.observaciones ? String(body.observaciones).trim() : null)
      .input('ValidadoPor', sql.NVarChar(36), req.auth!.usuarioId)
      .query(`
        INSERT INTO dbo.ValidacionesReceta (
          ValidacionId, SucursalId, RecetaReferencia, PacienteNombre, MedicoNombre, Observaciones, ValidadoPor
        ) VALUES (
          @ValidacionId, @SucursalId, @RecetaReferencia, @PacienteNombre, @MedicoNombre, @Observaciones, @ValidadoPor
        )
      `);

    await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
      .input('UsuarioId', sql.NVarChar(36), req.auth!.usuarioId)
      .input('EntidadId', sql.NVarChar(60), validacionId)
      .input('DetalleJson', sql.NVarChar(sql.MAX), JSON.stringify({ recetaReferencia }))
      .query(`
        INSERT INTO dbo.Auditoria (SucursalId, UsuarioId, Accion, Entidad, EntidadId, DetalleJson)
        VALUES (@SucursalId, @UsuarioId, N'RECETA_VALIDADA', N'ValidacionReceta', @EntidadId, @DetalleJson)
      `);

    return res.status(201).json({
      validacionId,
      recetaReferencia,
      validadoPor: req.auth!.usuarioId,
      validadoPorNombre: req.auth!.nombreCompleto,
      validadoEn: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error validando receta:', err);
    return res.status(500).json({ error: 'No se pudo registrar la validación de receta.' });
  }
});

// Historial de ventas POS
salesCashRouter.get('/pos/ventas', requirePermission('pos.operar'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const pool = await getSqlPool();
    const sucursalId = req.auth!.sucursalId;

    const ventasRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .input('Q', sql.NVarChar(80), `%${q}%`)
      .query(`
        SELECT TOP 50
          v.VentaId, v.NumeroTicket, v.Estado, v.CreadoEn, v.SubtotalBrutoCentimos, v.DescuentoTotalCentimos,
          v.BaseImponibleCentimos, v.IgvCentimos, v.TotalCentimos, v.RecetaReferencia,
          v.MotivoAnulacion, v.AnuladoEn,
          uv.NombreCompleto AS VendedorNombre,
          c.NombreRazonSocial AS ClienteNombre, c.NumeroDocumento AS ClienteDocumento,
          vr.ValidadoEn, uval.NombreCompleto AS ValidadoPorNombre
        FROM dbo.Ventas v
        INNER JOIN dbo.Usuarios uv ON uv.UsuarioId = v.VendedorId
        LEFT JOIN dbo.Clientes c ON c.ClienteId = v.ClienteId
        LEFT JOIN dbo.ValidacionesReceta vr ON vr.ValidacionId = v.ValidacionRecetaId
        LEFT JOIN dbo.Usuarios uval ON uval.UsuarioId = vr.ValidadoPor
        WHERE v.SucursalId = @SucursalId
          AND (@Q = N'%%' OR v.NumeroTicket LIKE @Q OR ISNULL(c.NumeroDocumento, N'') LIKE @Q OR ISNULL(c.NombreRazonSocial, N'') LIKE @Q)
        ORDER BY v.CreadoEn DESC
      `);

    const ventaIds = ventasRes.recordset.map((v: any) => v.VentaId);
    if (ventaIds.length === 0) {
      return res.json({ ventas: [] });
    }

    const pagosRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .query(`
        SELECT p.VentaId, p.MedioPago, p.MontoCentimos, p.EfectivoRecibidoCentimos, p.VueltoCentimos, p.ReferenciaOperacion
        FROM dbo.PagosVenta p
        INNER JOIN dbo.Ventas v ON v.VentaId = p.VentaId
        WHERE v.SucursalId = @SucursalId
      `);

    const detRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .query(`
        SELECT d.VentaDetalleId, d.VentaId, d.ProductoId, pr.Sku, pr.Nombre AS ProductoNombre,
               d.Cantidad, d.PrecioUnitarioCentimos, d.DescuentoPorcentaje, d.SubtotalCentimos,
               vdl.LoteId, l.NumeroLote, vdl.Cantidad AS LoteCantidad
        FROM dbo.VentaDetalle d
        INNER JOIN dbo.Ventas v ON v.VentaId = d.VentaId
        INNER JOIN dbo.Productos pr ON pr.ProductoId = d.ProductoId
        LEFT JOIN dbo.VentaDetalleLotes vdl ON vdl.VentaDetalleId = d.VentaDetalleId
        LEFT JOIN dbo.Lotes l ON l.LoteId = vdl.LoteId
        WHERE v.SucursalId = @SucursalId
      `);

    const pagosMap = new Map<string, any[]>();
    for (const p of pagosRes.recordset) {
      if (!pagosMap.has(p.VentaId)) pagosMap.set(p.VentaId, []);
      pagosMap.get(p.VentaId)!.push({
        medioPago: p.MedioPago,
        montoCentimos: Number(p.MontoCentimos),
        efectivoRecibidoCentimos: p.EfectivoRecibidoCentimos !== null ? Number(p.EfectivoRecibidoCentimos) : null,
        vueltoCentimos: p.VueltoCentimos !== null ? Number(p.VueltoCentimos) : null,
        referenciaOperacion: p.ReferenciaOperacion,
      });
    }

    const detMap = new Map<string, Map<string, any>>();
    for (const d of detRes.recordset) {
      if (!detMap.has(d.VentaId)) detMap.set(d.VentaId, new Map());
      const vDetMap = detMap.get(d.VentaId)!;
      if (!vDetMap.has(d.VentaDetalleId)) {
        vDetMap.set(d.VentaDetalleId, {
          ventaDetalleId: d.VentaDetalleId,
          productoId: d.ProductoId,
          sku: d.Sku,
          productoNombre: d.ProductoNombre,
          cantidad: Number(d.Cantidad),
          precioUnitarioCentimos: Number(d.PrecioUnitarioCentimos),
          descuentoPorcentaje: Number(d.DescuentoPorcentaje),
          subtotalCentimos: Number(d.SubtotalCentimos),
          lotes: [],
        });
      }
      if (d.LoteId) {
        vDetMap.get(d.VentaDetalleId)!.lotes.push({
          loteId: d.LoteId,
          numeroLote: d.NumeroLote,
          cantidad: Number(d.LoteCantidad),
        });
      }
    }

    const ventas = ventasRes.recordset.map((v: any) => ({
      ventaId: v.VentaId,
      numeroTicket: v.NumeroTicket,
      estado: v.Estado,
      creadoEn: v.CreadoEn,
      vendedorNombre: v.VendedorNombre,
      clienteNombre: v.ClienteNombre,
      clienteDocumento: v.ClienteDocumento,
      subtotalBrutoCentimos: Number(v.SubtotalBrutoCentimos),
      descuentoTotalCentimos: Number(v.DescuentoTotalCentimos),
      baseImponibleCentimos: Number(v.BaseImponibleCentimos),
      igvCentimos: Number(v.IgvCentimos),
      totalCentimos: Number(v.TotalCentimos),
      recetaReferencia: v.RecetaReferencia,
      validadoPorNombre: v.ValidadoPorNombre,
      validadoEn: v.ValidadoEn,
      motivoAnulacion: v.MotivoAnulacion,
      anuladoEn: v.AnuladoEn,
      mediosPago: pagosMap.get(v.VentaId) || [],
      items: detMap.has(v.VentaId) ? Array.from(detMap.get(v.VentaId)!.values()) : [],
    }));

    return res.json({ ventas });
  } catch (err) {
    console.error('Error listando ventas:', err);
    return res.status(500).json({ error: 'Error consultando el historial de ventas.' });
  }
});

// Registrar Venta POS (FEFO + Idempotencia + Bloqueo de turno + Transacción única)
salesCashRouter.post('/pos/ventas', requirePermission('pos.operar'), async (req, res) => {
  try {
    const body = req.body || {};
    const itemsInput = Array.isArray(body.items) ? body.items : [];
    const pagosInput: PaymentInput[] = Array.isArray(body.pagos) ? body.pagos : [];
    const clienteId = body.clienteId ? String(body.clienteId).trim() : null;
    const recetaReferencia = body.recetaReferencia ? String(body.recetaReferencia).trim() : null;
    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID()).trim();

    if (itemsInput.length === 0) {
      return res.status(400).json({ error: 'El carrito de venta está vacío.' });
    }

    // Verificar permiso de descuento si alguna línea tiene descuento > 0
    const hasDiscount = itemsInput.some((i: any) => Number(i.descuentoPorcentaje || 0) > 0);
    if (hasDiscount && !req.auth!.permisos.includes('pos.descuento')) {
      return res.status(403).json({
        error: 'No cuenta con permiso autorizado (pos.descuento) para aplicar descuentos.',
        code: 'FORBIDDEN_DISCOUNT',
      });
    }

    const sucursalId = req.auth!.sucursalId;
    const cajaId = req.auth!.cajaId;
    const todayIso = getLimaTodayIso();

    const result = await withTransaction(async (tx) => {
      // 1. Idempotencia
      const idempRes = await tx
        .request()
        .input('IdempotencyKey', sql.NVarChar(100), idempotencyKey)
        .query(
          'SELECT RespuestaJson FROM dbo.ClavesIdempotencia WITH (UPDLOCK, HOLDLOCK) WHERE IdempotencyKey = @IdempotencyKey'
        );
      if (idempRes.recordset.length > 0) {
        return JSON.parse(idempRes.recordset[0].RespuestaJson);
      }

      // 2. Verificar turno de caja abierto con bloqueo para evitar cierre concurrente
      const shiftRes = await tx
        .request()
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .input('CajaId', sql.NVarChar(36), cajaId)
        .query(`
          SELECT TOP 1 TurnoId, CodigoTurno
          FROM dbo.TurnosCaja WITH (UPDLOCK, HOLDLOCK)
          WHERE SucursalId = @SucursalId AND CajaId = @CajaId AND Estado = 'ABIERTO'
        `);

      if (shiftRes.recordset.length === 0) {
        throw new DomainRuleError(
          'CASH_REGISTER_CLOSED',
          'La caja está cerrada. Debe abrir un turno de caja antes de registrar cobros.',
          409
        );
      }
      const turnoId = shiftRes.recordset[0].TurnoId;

      // Consolidar cantidades por ProductoId en caso haya duplicados en carrito
      const aggregatedItems: Array<{
        productoId: string;
        cantidad: number;
        descuentoPorcentaje: number;
      }> = [];
      for (const raw of itemsInput) {
        const productoId = String(raw.productoId || '').trim();
        const cantidad = Math.trunc(Number(raw.cantidad || 0));
        const descuentoPorcentaje = Number(raw.descuentoPorcentaje || 0);
        if (!productoId || cantidad <= 0) {
          throw new DomainRuleError('INVALID_LINE', 'Producto y cantidad positiva son obligatorios.');
        }
        const existing = aggregatedItems.find(
          (x) => x.productoId === productoId && x.descuentoPorcentaje === descuentoPorcentaje
        );
        if (existing) {
          existing.cantidad += cantidad;
        } else {
          aggregatedItems.push({ productoId, cantidad, descuentoPorcentaje });
        }
      }

      let hasPrescriptionItems = false;
      let subtotalBrutoCentimos = 0;
      let descuentoTotalCentimos = 0;
      let baseImponibleCentimos = 0;
      let igvCentimos = 0;
      let totalCentimos = 0;

      const preparedLines: Array<{
        ventaDetalleId: string;
        productoId: string;
        sku: string;
        nombre: string;
        cantidad: number;
        precioUnitarioCentimos: number;
        descuentoPorcentaje: number;
        descuentoCentimos: number;
        gravadoIgv: boolean;
        igvPorcentaje: number;
        baseImponibleCentimos: number;
        igvCentimos: number;
        subtotalCentimos: number;
        allocations: ReturnType<typeof allocateLotsFefo>;
      }> = [];

      // 3. Revalidar productos, precios y asignar lotes FEFO con bloqueo exclusivo
      for (const line of aggregatedItems) {
        const prodRes = await tx
          .request()
          .input('ProductoId', sql.NVarChar(36), line.productoId)
          .query(`
            SELECT TOP 1 ProductoId, Sku, Nombre, RequiereReceta, PrecioVentaCentimos, GravadoIgv, IgvPorcentaje, Activo
            FROM dbo.Productos
            WHERE ProductoId = @ProductoId
          `);

        if (prodRes.recordset.length === 0 || !prodRes.recordset[0].Activo) {
          throw new DomainRuleError('PRODUCT_UNAVAILABLE', 'Uno de los productos no existe o está inactivo.', 404);
        }
        const prod = prodRes.recordset[0];
        if (prod.RequiereReceta) {
          hasPrescriptionItems = true;
        }

        const calc = computeLineAmounts({
          cantidad: line.cantidad,
          precioUnitarioCentimos: Number(prod.PrecioVentaCentimos),
          descuentoPorcentaje: line.descuentoPorcentaje,
          gravadoIgv: Boolean(prod.GravadoIgv),
          igvPorcentaje: Number(prod.IgvPorcentaje),
        });

        // Bloqueo de lotes del producto en sucursal
        const lotsRes = await tx
          .request()
          .input('ProductoId', sql.NVarChar(36), line.productoId)
          .input('SucursalId', sql.NVarChar(36), sucursalId)
          .query(`
            SELECT LoteId, NumeroLote, FechaVencimiento, CantidadFisica, CantidadDisponible,
                   EstadoAptitud, CostoAdquisicionCentimos
            FROM dbo.Lotes WITH (UPDLOCK, HOLDLOCK)
            WHERE ProductoId = @ProductoId AND SucursalId = @SucursalId
            ORDER BY FechaVencimiento ASC
          `);

        const lotCandidates = lotsRes.recordset.map((l: any) => ({
          loteId: l.LoteId,
          numeroLote: l.NumeroLote,
          fechaVencimiento: formatDateYmd(l.FechaVencimiento),
          cantidadFisica: Number(l.CantidadFisica),
          cantidadDisponible: Number(l.CantidadDisponible),
          estadoAptitud: l.EstadoAptitud,
          costoAdquisicionCentimos: Number(l.CostoAdquisicionCentimos),
        }));

        const allocations = allocateLotsFefo(lotCandidates, line.cantidad, todayIso);

        subtotalBrutoCentimos += calc.brutoCentimos;
        descuentoTotalCentimos += calc.descuentoCentimos;
        baseImponibleCentimos += calc.baseImponibleCentimos;
        igvCentimos += calc.igvCentimos;
        totalCentimos += calc.subtotalCentimos;

        preparedLines.push({
          ventaDetalleId: crypto.randomUUID(),
          productoId: prod.ProductoId,
          sku: prod.Sku,
          nombre: prod.Nombre,
          cantidad: line.cantidad,
          precioUnitarioCentimos: Number(prod.PrecioVentaCentimos),
          descuentoPorcentaje: line.descuentoPorcentaje,
          descuentoCentimos: calc.descuentoCentimos,
          gravadoIgv: Boolean(prod.GravadoIgv),
          igvPorcentaje: Number(prod.IgvPorcentaje),
          baseImponibleCentimos: calc.baseImponibleCentimos,
          igvCentimos: calc.igvCentimos,
          subtotalCentimos: calc.subtotalCentimos,
          allocations,
        });
      }

      // 4. Validar receta médica si corresponde
      let validacionReceta: {
        validacionId: string;
        validadoPor: string;
        validadoEn: string;
        recetaReferencia: string;
        validadoPorNombre?: string;
      } | null = null;

      if (hasPrescriptionItems) {
        if (recetaReferencia) {
          const valRes = await tx
            .request()
            .input('SucursalId', sql.NVarChar(36), sucursalId)
            .input('Ref', sql.NVarChar(100), recetaReferencia)
            .query(`
              SELECT TOP 1 v.ValidacionId, v.RecetaReferencia, v.ValidadoPor, v.ValidadoEn, u.NombreCompleto
              FROM dbo.ValidacionesReceta v
              INNER JOIN dbo.Usuarios u ON u.UsuarioId = v.ValidadoPor
              WHERE v.SucursalId = @SucursalId AND v.RecetaReferencia = @Ref
              ORDER BY v.ValidadoEn DESC
            `);
          if (valRes.recordset.length > 0) {
            const vr = valRes.recordset[0];
            validacionReceta = {
              validacionId: vr.ValidacionId,
              validadoPor: vr.ValidadoPor,
              validadoEn: new Date(vr.ValidadoEn).toISOString(),
              recetaReferencia: vr.RecetaReferencia,
              validadoPorNombre: vr.NombreCompleto,
            };
          }
        }
        validatePrescriptionGate({
          hasPrescriptionItems: true,
          recetaReferencia,
          validationRecord: validacionReceta,
        });
      }

      // 5. Reconciliar medios de pago
      const reconciledPayments = reconcileSalePayments(totalCentimos, pagosInput);

      // 6. Insertar cabecera de venta
      const ventaId = crypto.randomUUID();
      const numeroTicket = `TK-${new Date().getFullYear().toString().slice(-2)}${String(Date.now()).slice(-6)}`;

      await tx
        .request()
        .input('VentaId', sql.NVarChar(36), ventaId)
        .input('NumeroTicket', sql.NVarChar(30), numeroTicket)
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .input('CajaId', sql.NVarChar(36), cajaId)
        .input('TurnoId', sql.NVarChar(36), turnoId)
        .input('VendedorId', sql.NVarChar(36), req.auth!.usuarioId)
        .input('ClienteId', sql.NVarChar(36), clienteId)
        .input('SubtotalBrutoCentimos', sql.BigInt, subtotalBrutoCentimos)
        .input('DescuentoTotalCentimos', sql.BigInt, descuentoTotalCentimos)
        .input('BaseImponibleCentimos', sql.BigInt, baseImponibleCentimos)
        .input('IgvCentimos', sql.BigInt, igvCentimos)
        .input('TotalCentimos', sql.BigInt, totalCentimos)
        .input('RecetaReferencia', sql.NVarChar(100), recetaReferencia)
        .input('ValidacionRecetaId', sql.NVarChar(36), validacionReceta?.validacionId || null)
        .input('IdempotencyKey', sql.NVarChar(100), idempotencyKey)
        .query(`
          INSERT INTO dbo.Ventas (
            VentaId, NumeroTicket, SucursalId, CajaId, TurnoId, VendedorId, ClienteId,
            Estado, SubtotalBrutoCentimos, DescuentoTotalCentimos, BaseImponibleCentimos,
            IgvCentimos, TotalCentimos, RecetaReferencia, ValidacionRecetaId, IdempotencyKey
          ) VALUES (
            @VentaId, @NumeroTicket, @SucursalId, @CajaId, @TurnoId, @VendedorId, @ClienteId,
            N'COMPLETADA', @SubtotalBrutoCentimos, @DescuentoTotalCentimos, @BaseImponibleCentimos,
            @IgvCentimos, @TotalCentimos, @RecetaReferencia, @ValidacionRecetaId, @IdempotencyKey
          )
        `);

      // 7. Insertar detalle, descontar lotes FEFO y registrar Kardex
      for (const line of preparedLines) {
        await tx
          .request()
          .input('VentaDetalleId', sql.NVarChar(36), line.ventaDetalleId)
          .input('VentaId', sql.NVarChar(36), ventaId)
          .input('ProductoId', sql.NVarChar(36), line.productoId)
          .input('Cantidad', sql.Int, line.cantidad)
          .input('PrecioUnitarioCentimos', sql.BigInt, line.precioUnitarioCentimos)
          .input('DescuentoPorcentaje', sql.Decimal(5, 2), line.descuentoPorcentaje)
          .input('DescuentoCentimos', sql.BigInt, line.descuentoCentimos)
          .input('GravadoIgv', sql.Bit, line.gravadoIgv ? 1 : 0)
          .input('IgvPorcentaje', sql.Decimal(5, 2), line.igvPorcentaje)
          .input('BaseImponibleCentimos', sql.BigInt, line.baseImponibleCentimos)
          .input('IgvCentimos', sql.BigInt, line.igvCentimos)
          .input('SubtotalCentimos', sql.BigInt, line.subtotalCentimos)
          .query(`
            INSERT INTO dbo.VentaDetalle (
              VentaDetalleId, VentaId, ProductoId, Cantidad, PrecioUnitarioCentimos,
              DescuentoPorcentaje, DescuentoCentimos, GravadoIgv, IgvPorcentaje,
              BaseImponibleCentimos, IgvCentimos, SubtotalCentimos
            ) VALUES (
              @VentaDetalleId, @VentaId, @ProductoId, @Cantidad, @PrecioUnitarioCentimos,
              @DescuentoPorcentaje, @DescuentoCentimos, @GravadoIgv, @IgvPorcentaje,
              @BaseImponibleCentimos, @IgvCentimos, @SubtotalCentimos
            )
          `);

        for (const alloc of line.allocations) {
          const updLot = await tx
            .request()
            .input('LoteId', sql.NVarChar(36), alloc.loteId)
            .input('Qty', sql.Int, alloc.cantidad)
            .query(`
              UPDATE dbo.Lotes
              SET CantidadFisica = CantidadFisica - @Qty,
                  CantidadDisponible = CantidadDisponible - @Qty
              WHERE LoteId = @LoteId AND CantidadFisica >= @Qty AND CantidadDisponible >= @Qty
            `);

          if (updLot.rowsAffected[0] === 0) {
            throw new DomainRuleError(
              'CONCURRENT_STOCK_CONFLICT',
              `Conflicto de concurrencia al descontar lote ${alloc.numeroLote}. Reintente.`,
              409
            );
          }

          await tx
            .request()
            .input('VentaDetalleLoteId', sql.NVarChar(36), crypto.randomUUID())
            .input('VentaDetalleId', sql.NVarChar(36), line.ventaDetalleId)
            .input('LoteId', sql.NVarChar(36), alloc.loteId)
            .input('Cantidad', sql.Int, alloc.cantidad)
            .input('CostoUnitarioCentimos', sql.BigInt, alloc.costoUnitarioCentimos)
            .query(`
              INSERT INTO dbo.VentaDetalleLotes (VentaDetalleLoteId, VentaDetalleId, LoteId, Cantidad, CostoUnitarioCentimos)
              VALUES (@VentaDetalleLoteId, @VentaDetalleId, @LoteId, @Cantidad, @CostoUnitarioCentimos)
            `);

          const saldoRes = await tx
            .request()
            .input('ProductoId', sql.NVarChar(36), line.productoId)
            .input('SucursalId', sql.NVarChar(36), sucursalId)
            .query(`
              SELECT ISNULL(SUM(CantidadFisica), 0) AS TotalFisico
              FROM dbo.Lotes
              WHERE ProductoId = @ProductoId AND SucursalId = @SucursalId
            `);
          const saldoResultante = Number(saldoRes.recordset[0].TotalFisico);

          await tx
            .request()
            .input('SucursalId', sql.NVarChar(36), sucursalId)
            .input('ProductoId', sql.NVarChar(36), line.productoId)
            .input('LoteId', sql.NVarChar(36), alloc.loteId)
            .input('DocumentoRef', sql.NVarChar(80), numeroTicket)
            .input('CantidadSalida', sql.Int, alloc.cantidad)
            .input('SaldoProductoResultante', sql.Int, saldoResultante)
            .input('CostoUnitarioCentimos', sql.BigInt, alloc.costoUnitarioCentimos)
            .input('ResponsableId', sql.NVarChar(36), req.auth!.usuarioId)
            .input('ResponsableUsername', sql.NVarChar(60), req.auth!.username)
            .input('ReferenciaVentaId', sql.NVarChar(36), ventaId)
            .query(`
              INSERT INTO dbo.MovimientosStock (
                SucursalId, ProductoId, LoteId, Tipo, DocumentoRef, CantidadEntrada, CantidadSalida,
                SaldoProductoResultante, CostoUnitarioCentimos, Motivo, ResponsableId, ResponsableUsername, ReferenciaVentaId
              ) VALUES (
                @SucursalId, @ProductoId, @LoteId, N'VENTA', @DocumentoRef, 0, @CantidadSalida,
                @SaldoProductoResultante, @CostoUnitarioCentimos, N'Venta POS FEFO', @ResponsableId, @ResponsableUsername, @ReferenciaVentaId
              )
            `);
        }
      }

      // 8. Registrar pagos
      for (const p of reconciledPayments) {
        await tx
          .request()
          .input('PagoId', sql.NVarChar(36), crypto.randomUUID())
          .input('VentaId', sql.NVarChar(36), ventaId)
          .input('MedioPago', sql.NVarChar(30), p.medioPago)
          .input('MontoCentimos', sql.BigInt, p.montoCentimos)
          .input('EfectivoRecibidoCentimos', sql.BigInt, p.efectivoRecibidoCentimos ?? null)
          .input('VueltoCentimos', sql.BigInt, p.vueltoCentimos)
          .input('ReferenciaOperacion', sql.NVarChar(80), p.referenciaOperacion || null)
          .query(`
            INSERT INTO dbo.PagosVenta (PagoId, VentaId, MedioPago, MontoCentimos, EfectivoRecibidoCentimos, VueltoCentimos, ReferenciaOperacion)
            VALUES (@PagoId, @VentaId, @MedioPago, @MontoCentimos, @EfectivoRecibidoCentimos, @VueltoCentimos, @ReferenciaOperacion)
          `);
      }

      const ticketPayload = {
        ventaId,
        numeroTicket,
        tipoComprobante: 'TICKET INTERNO DE VENTA (NO VÁLIDO PARA CRÉDITO FISCAL SUNAT)',
        fechaHora: new Date().toISOString(),
        sucursalNombre: req.auth!.sucursalNombre,
        sucursalRuc: req.auth!.sucursalRuc,
        vendedorNombre: req.auth!.nombreCompleto,
        subtotalBrutoCentimos,
        descuentoTotalCentimos,
        baseImponibleCentimos,
        igvCentimos,
        totalCentimos,
        recetaReferencia,
        validadoPorNombre: validacionReceta?.validadoPorNombre || null,
        validadoEn: validacionReceta?.validadoEn || null,
        pagos: reconciledPayments,
        items: preparedLines.map((l) => ({
          productoId: l.productoId,
          sku: l.sku,
          nombre: l.nombre,
          cantidad: l.cantidad,
          precioUnitarioCentimos: l.precioUnitarioCentimos,
          descuentoPorcentaje: l.descuentoPorcentaje,
          subtotalCentimos: l.subtotalCentimos,
          lotes: l.allocations.map((a) => ({
            numeroLote: a.numeroLote,
            cantidad: a.cantidad,
            fechaVencimiento: a.fechaVencimiento,
          })),
        })),
      };

      await tx
        .request()
        .input('IdempotencyKey', sql.NVarChar(100), idempotencyKey)
        .input('Operacion', sql.NVarChar(50), 'VENTA_POS')
        .input('EntidadId', sql.NVarChar(36), ventaId)
        .input('RespuestaJson', sql.NVarChar(sql.MAX), JSON.stringify(ticketPayload))
        .query(`
          INSERT INTO dbo.ClavesIdempotencia (IdempotencyKey, Operacion, EntidadId, RespuestaJson)
          VALUES (@IdempotencyKey, @Operacion, @EntidadId, @RespuestaJson)
        `);

      await tx
        .request()
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .input('UsuarioId', sql.NVarChar(36), req.auth!.usuarioId)
        .input('EntidadId', sql.NVarChar(60), ventaId)
        .input('DetalleJson', sql.NVarChar(sql.MAX), JSON.stringify({ numeroTicket, totalCentimos }))
        .query(`
          INSERT INTO dbo.Auditoria (SucursalId, UsuarioId, Accion, Entidad, EntidadId, DetalleJson)
          VALUES (@SucursalId, @UsuarioId, N'VENTA_REGISTRADA', N'Venta', @EntidadId, @DetalleJson)
        `);

      return ticketPayload;
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof DomainRuleError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('Error registrando venta POS:', err);
    return res.status(500).json({ error: 'Error procesando el cobro de la venta.' });
  }
});

// Anulación autorizada de venta
salesCashRouter.post('/pos/ventas/:id/anular', requirePermission('pos.anular'), async (req, res) => {
  try {
    const ventaId = String(req.params.id);
    const motivo = String(req.body?.motivo || '').trim();
    const devolverMercaderia = req.body?.devolverMercaderia !== false;
    const idempotencyKey = String(req.body?.idempotencyKey || `anul-${ventaId}`).trim();

    if (!motivo) {
      return res.status(400).json({ error: 'Debe ingresar el motivo de la anulación.' });
    }

    const sucursalId = req.auth!.sucursalId;
    const cajaId = req.auth!.cajaId;
    const todayIso = getLimaTodayIso();

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

      const ventaRes = await tx
        .request()
        .input('VentaId', sql.NVarChar(36), ventaId)
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .query(`
          SELECT v.VentaId, v.NumeroTicket, v.TurnoId, v.Estado, v.TotalCentimos, t.Estado AS TurnoEstado
          FROM dbo.Ventas v WITH (UPDLOCK, HOLDLOCK)
          INNER JOIN dbo.TurnosCaja t ON t.TurnoId = v.TurnoId
          WHERE v.VentaId = @VentaId AND v.SucursalId = @SucursalId
        `);

      if (ventaRes.recordset.length === 0) {
        throw new DomainRuleError('SALE_NOT_FOUND', 'Venta no encontrada.', 404);
      }
      const venta = ventaRes.recordset[0];
      if (venta.Estado === 'ANULADA') {
        throw new DomainRuleError('ALREADY_VOIDED', 'La venta ya fue anulada previamente.', 409);
      }

      // Verificar pagos en efectivo para compensación
      const pagosRes = await tx
        .request()
        .input('VentaId', sql.NVarChar(36), ventaId)
        .query('SELECT MedioPago, MontoCentimos FROM dbo.PagosVenta WHERE VentaId = @VentaId');

      const cashPaid = pagosRes.recordset
        .filter((p: any) => p.MedioPago === 'EFECTIVO')
        .reduce((acc: number, p: any) => acc + Number(p.MontoCentimos), 0);

      let turnoCompensacionId = venta.TurnoId;
      if (cashPaid > 0 && venta.TurnoEstado === 'CERRADO') {
        // Turno original cerrado: no mutar su reporte Z; buscar turno abierto para compensar efectivo
        const openTurnoRes = await tx
          .request()
          .input('SucursalId', sql.NVarChar(36), sucursalId)
          .input('CajaId', sql.NVarChar(36), cajaId)
          .query(`
            SELECT TOP 1 TurnoId
            FROM dbo.TurnosCaja WITH (UPDLOCK, HOLDLOCK)
            WHERE SucursalId = @SucursalId AND CajaId = @CajaId AND Estado = 'ABIERTO'
          `);
        if (openTurnoRes.recordset.length === 0) {
          throw new DomainRuleError(
            'OPEN_SHIFT_REQUIRED_FOR_REFUND',
            'El turno original ya está cerrado. Abra un turno de caja actual para registrar la devolución en efectivo sin alterar el reporte Z anterior.',
            409
          );
        }
        turnoCompensacionId = openTurnoRes.recordset[0].TurnoId;
      }

      await tx
        .request()
        .input('VentaId', sql.NVarChar(36), ventaId)
        .input('Motivo', sql.NVarChar(300), motivo)
        .input('AnuladoPor', sql.NVarChar(36), req.auth!.usuarioId)
        .input('TurnoCompensacionId', sql.NVarChar(36), turnoCompensacionId)
        .input('IdempAnul', sql.NVarChar(100), idempotencyKey)
        .query(`
          UPDATE dbo.Ventas
          SET Estado = N'ANULADA',
              MotivoAnulacion = @Motivo,
              AnuladoPor = @AnuladoPor,
              AnuladoEn = SYSUTCDATETIME(),
              TurnoCompensacionId = @TurnoCompensacionId,
              IdempotencyAnulacionKey = @IdempAnul
          WHERE VentaId = @VentaId
        `);

      if (cashPaid > 0) {
        await tx
          .request()
          .input('MovimientoCajaId', sql.NVarChar(36), crypto.randomUUID())
          .input('TurnoId', sql.NVarChar(36), turnoCompensacionId)
          .input('SucursalId', sql.NVarChar(36), sucursalId)
          .input('MontoCentimos', sql.BigInt, cashPaid)
          .input('Motivo', sql.NVarChar(240), `Devolución por anulación ${venta.NumeroTicket}: ${motivo}`.slice(0, 240))
          .input('Referencia', sql.NVarChar(80), venta.NumeroTicket)
          .input('UsuarioId', sql.NVarChar(36), req.auth!.usuarioId)
          .input('Idemp', sql.NVarChar(100), `dev-${idempotencyKey}`)
          .query(`
            INSERT INTO dbo.MovimientosCaja (MovimientoCajaId, TurnoId, SucursalId, Tipo, MontoCentimos, Motivo, Referencia, UsuarioId, IdempotencyKey)
            VALUES (@MovimientoCajaId, @TurnoId, @SucursalId, N'DEVOLUCION_EFECTIVO', @MontoCentimos, @Motivo, @Referencia, @UsuarioId, @Idemp)
          `);
      }

      if (devolverMercaderia) {
        const detLotesRes = await tx
          .request()
          .input('VentaId', sql.NVarChar(36), ventaId)
          .query(`
            SELECT vd.ProductoId, vdl.LoteId, vdl.Cantidad, vdl.CostoUnitarioCentimos,
                   l.EstadoAptitud, l.FechaVencimiento
            FROM dbo.VentaDetalle vd
            INNER JOIN dbo.VentaDetalleLotes vdl ON vdl.VentaDetalleId = vd.VentaDetalleId
            INNER JOIN dbo.Lotes l WITH (UPDLOCK, HOLDLOCK) ON l.LoteId = vdl.LoteId
            WHERE vd.VentaId = @VentaId
          `);

        for (const dl of detLotesRes.recordset) {
          const fv = formatDateYmd(dl.FechaVencimiento);
          const aptoParaVenta = dl.EstadoAptitud === 'APTO' && fv >= todayIso;
          const addDisp = aptoParaVenta ? Number(dl.Cantidad) : 0;

          await tx
            .request()
            .input('LoteId', sql.NVarChar(36), dl.LoteId)
            .input('AddFis', sql.Int, Number(dl.Cantidad))
            .input('AddDisp', sql.Int, addDisp)
            .query(`
              UPDATE dbo.Lotes
              SET CantidadFisica = CantidadFisica + @AddFis,
                  CantidadDisponible = CantidadDisponible + @AddDisp
              WHERE LoteId = @LoteId
            `);

          const saldoRes = await tx
            .request()
            .input('ProductoId', sql.NVarChar(36), dl.ProductoId)
            .input('SucursalId', sql.NVarChar(36), sucursalId)
            .query(`
              SELECT ISNULL(SUM(CantidadFisica), 0) AS TotalFisico
              FROM dbo.Lotes
              WHERE ProductoId = @ProductoId AND SucursalId = @SucursalId
            `);
          const saldoResultante = Number(saldoRes.recordset[0].TotalFisico);

          await tx
            .request()
            .input('SucursalId', sql.NVarChar(36), sucursalId)
            .input('ProductoId', sql.NVarChar(36), dl.ProductoId)
            .input('LoteId', sql.NVarChar(36), dl.LoteId)
            .input('DocumentoRef', sql.NVarChar(80), `ANUL-${venta.NumeroTicket}`)
            .input('CantidadEntrada', sql.Int, Number(dl.Cantidad))
            .input('SaldoProductoResultante', sql.Int, saldoResultante)
            .input('CostoUnitarioCentimos', sql.BigInt, Number(dl.CostoUnitarioCentimos))
            .input('Motivo', sql.NVarChar(240), `Anulación ${venta.NumeroTicket}: ${motivo}`.slice(0, 240))
            .input('ResponsableId', sql.NVarChar(36), req.auth!.usuarioId)
            .input('ResponsableUsername', sql.NVarChar(60), req.auth!.username)
            .input('ReferenciaVentaId', sql.NVarChar(36), ventaId)
            .query(`
              INSERT INTO dbo.MovimientosStock (
                SucursalId, ProductoId, LoteId, Tipo, DocumentoRef, CantidadEntrada, CantidadSalida,
                SaldoProductoResultante, CostoUnitarioCentimos, Motivo, ResponsableId, ResponsableUsername, ReferenciaVentaId
              ) VALUES (
                @SucursalId, @ProductoId, @LoteId, N'ANULACION_ENTRADA', @DocumentoRef, @CantidadEntrada, 0,
                @SaldoProductoResultante, @CostoUnitarioCentimos, @Motivo, @ResponsableId, @ResponsableUsername, @ReferenciaVentaId
              )
            `);
        }
      }

      const payload = {
        ok: true,
        ventaId,
        numeroTicket: venta.NumeroTicket,
        estado: 'ANULADA',
        turnoCompensacionId,
        devolverMercaderia,
      };

      await tx
        .request()
        .input('IdempotencyKey', sql.NVarChar(100), idempotencyKey)
        .input('Operacion', sql.NVarChar(50), 'ANULACION_VENTA')
        .input('EntidadId', sql.NVarChar(36), ventaId)
        .input('RespuestaJson', sql.NVarChar(sql.MAX), JSON.stringify(payload))
        .query(`
          INSERT INTO dbo.ClavesIdempotencia (IdempotencyKey, Operacion, EntidadId, RespuestaJson)
          VALUES (@IdempotencyKey, @Operacion, @EntidadId, @RespuestaJson)
        `);

      await tx
        .request()
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .input('UsuarioId', sql.NVarChar(36), req.auth!.usuarioId)
        .input('EntidadId', sql.NVarChar(60), ventaId)
        .input('DetalleJson', sql.NVarChar(sql.MAX), JSON.stringify({ numeroTicket: venta.NumeroTicket, motivo, devolverMercaderia }))
        .query(`
          INSERT INTO dbo.Auditoria (SucursalId, UsuarioId, Accion, Entidad, EntidadId, DetalleJson)
          VALUES (@SucursalId, @UsuarioId, N'VENTA_ANULADA', N'Venta', @EntidadId, @DetalleJson)
        `);

      return payload;
    });

    return res.json(result);
  } catch (err) {
    if (err instanceof DomainRuleError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('Error anulando venta:', err);
    return res.status(500).json({ error: 'Error al anular la venta.' });
  }
});

// Caja y cierre
async function computeShiftMetrics(executor: sql.Request | any, turnoId: string, fondoInicialCentimos: number) {
  const pagosRes = await executor
    .input('TurnoId', sql.NVarChar(36), turnoId)
    .query(`
      SELECT p.MedioPago, COUNT(DISTINCT v.VentaId) AS Transacciones, ISNULL(SUM(p.MontoCentimos), 0) AS TotalCentimos
      FROM dbo.PagosVenta p
      INNER JOIN dbo.Ventas v ON v.VentaId = p.VentaId
      WHERE v.TurnoId = @TurnoId AND v.Estado = N'COMPLETADA'
      GROUP BY p.MedioPago
    `);

  const resumenMedios = {
    EFECTIVO: { totalCentimos: 0, transacciones: 0 },
    VISA: { totalCentimos: 0, transacciones: 0 },
    MASTERCARD: { totalCentimos: 0, transacciones: 0 },
    TRANSFERENCIA_YAPE: { totalCentimos: 0, transacciones: 0 },
  };

  for (const row of pagosRes.recordset) {
    const key = row.MedioPago as keyof typeof resumenMedios;
    if (resumenMedios[key]) {
      resumenMedios[key] = {
        totalCentimos: Number(row.TotalCentimos),
        transacciones: Number(row.Transacciones),
      };
    }
  }

  // Ventas totales del turno (incluyendo anulaciones del turno original)
  const ventasTotalsRes = await executor
    .input('TurnoIdV', sql.NVarChar(36), turnoId)
    .query(`
      SELECT
        ISNULL(SUM(SubtotalBrutoCentimos), 0) AS TotalBruto,
        ISNULL(SUM(DescuentoTotalCentimos), 0) AS TotalDescuentos,
        ISNULL(SUM(CASE WHEN Estado = N'COMPLETADA' THEN IgvCentimos ELSE 0 END), 0) AS TotalIgvNeto,
        ISNULL(SUM(CASE WHEN Estado = N'ANULADA' THEN TotalCentimos ELSE 0 END), 0) AS TotalAnulaciones,
        ISNULL(SUM(CASE WHEN Estado = N'COMPLETADA' THEN TotalCentimos ELSE 0 END), 0) AS TotalNeto
      FROM dbo.Ventas
      WHERE TurnoId = @TurnoIdV
    `);

  const vt = ventasTotalsRes.recordset[0] || {};

  // Incluir cobros en efectivo ingresados originalmente en este turno; si se anula en turno posterior, el egreso va al turno abierto actual.
  const cashOriginalAllRes = await executor
    .input('TurnoIdAll', sql.NVarChar(36), turnoId)
    .query(`
      SELECT ISNULL(SUM(p.MontoCentimos), 0) AS EfectivoCobradoTurno
      FROM dbo.PagosVenta p
      INNER JOIN dbo.Ventas v ON v.VentaId = p.VentaId
      WHERE v.TurnoId = @TurnoIdAll AND p.MedioPago = N'EFECTIVO'
    `);
  const efectivoCobradoTurno = Number(cashOriginalAllRes.recordset[0]?.EfectivoCobradoTurno || 0);

  const movCajaRes = await executor
    .input('TurnoIdMC', sql.NVarChar(36), turnoId)
    .query(`
      SELECT
        ISNULL(SUM(CASE WHEN Tipo = N'INGRESO' THEN MontoCentimos ELSE 0 END), 0) AS Ingresos,
        ISNULL(SUM(CASE WHEN Tipo = N'RETIRO' THEN MontoCentimos ELSE 0 END), 0) AS Retiros,
        ISNULL(SUM(CASE WHEN Tipo = N'DEVOLUCION_EFECTIVO' THEN MontoCentimos ELSE 0 END), 0) AS Devoluciones
      FROM dbo.MovimientosCaja
      WHERE TurnoId = @TurnoIdMC
    `);
  const mc = movCajaRes.recordset[0] || {};
  const ingresosEfectivoCentimos = Number(mc.Ingresos || 0);
  const retirosEfectivoCentimos = Number(mc.Retiros || 0);
  const devolucionesEfectivoCentimos = Number(mc.Devoluciones || 0);

  const efectivoTeoricoCentimos =
    fondoInicialCentimos +
    efectivoCobradoTurno +
    ingresosEfectivoCentimos -
    retirosEfectivoCentimos -
    devolucionesEfectivoCentimos;

  return {
    resumenMedios,
    ingresosEfectivoCentimos,
    retirosEfectivoCentimos,
    devolucionesEfectivoCentimos,
    efectivoTeoricoCentimos,
    totalBrutoCentimos: Number(vt.TotalBruto || 0),
    totalDescuentosCentimos: Number(vt.TotalDescuentos || 0),
    totalIgvCentimos: Number(vt.TotalIgvNeto || 0),
    totalAnulacionesCentimos: Number(vt.TotalAnulaciones || 0),
    totalNetoCentimos: Number(vt.TotalNeto || 0),
  };
}

salesCashRouter.get('/caja/actual', requirePermission('caja.operar'), async (req, res) => {
  try {
    const pool = await getSqlPool();
    const sucursalId = req.auth!.sucursalId;
    const cajaId = req.auth!.cajaId;

    const turnoRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .input('CajaId', sql.NVarChar(36), cajaId)
      .query(`
        SELECT TOP 1 t.*, ua.NombreCompleto AS UsuarioAperturaNombre, uc.NombreCompleto AS UsuarioCierreNombre
        FROM dbo.TurnosCaja t
        INNER JOIN dbo.Usuarios ua ON ua.UsuarioId = t.UsuarioAperturaId
        LEFT JOIN dbo.Usuarios uc ON uc.UsuarioId = t.UsuarioCierreId
        WHERE t.SucursalId = @SucursalId AND t.CajaId = @CajaId
        ORDER BY CASE WHEN t.Estado = N'ABIERTO' THEN 0 ELSE 1 END, t.FechaApertura DESC
      `);

    const turno = turnoRes.recordset[0];
    let turnoActual: any = null;
    let ultimasTransacciones: any[] = [];
    let movimientosCaja: any[] = [];

    if (turno) {
      if (turno.Estado === 'CERRADO' && turno.ReporteZJson) {
        const snapshot = JSON.parse(turno.ReporteZJson);
        turnoActual = {
          ...snapshot,
          estado: 'CERRADO',
        };
      } else {
        const metrics = await computeShiftMetrics(
          pool.request(),
          turno.TurnoId,
          Number(turno.FondoInicialCentimos)
        );
        turnoActual = {
          turnoId: turno.TurnoId,
          codigoTurno: turno.CodigoTurno,
          estado: turno.Estado,
          fechaApertura: turno.FechaApertura,
          fechaCierre: turno.FechaCierre,
          usuarioAperturaNombre: turno.UsuarioAperturaNombre,
          usuarioCierreNombre: turno.UsuarioCierreNombre,
          fondoInicialCentimos: Number(turno.FondoInicialCentimos),
          efectivoContadoCentimos:
            turno.EfectivoContadoCentimos !== null ? Number(turno.EfectivoContadoCentimos) : null,
          diferenciaCentimos:
            turno.DiferenciaCentimos !== null ? Number(turno.DiferenciaCentimos) : null,
          motivoDescuadre: turno.MotivoDescuadre,
          ...metrics,
        };
      }

      const txRes = await pool
        .request()
        .input('TurnoId', sql.NVarChar(36), turno.TurnoId)
        .query(`
          SELECT TOP 10 v.VentaId, v.NumeroTicket, v.CreadoEn, v.TotalCentimos, v.Estado,
                 (SELECT TOP 1 p.MedioPago FROM dbo.PagosVenta p WHERE p.VentaId = v.VentaId) AS MedioPago
          FROM dbo.Ventas v
          WHERE v.TurnoId = @TurnoId
          ORDER BY v.CreadoEn DESC
        `);

      ultimasTransacciones = txRes.recordset.map((x: any) => ({
        ventaId: x.VentaId,
        numeroTicket: x.NumeroTicket,
        hora: new Intl.DateTimeFormat('es-PE', {
          timeZone: 'America/Lima',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(x.CreadoEn)),
        medioPago: x.MedioPago || 'EFECTIVO',
        montoCentimos: Number(x.TotalCentimos),
        estado: x.Estado,
      }));

      const mcRes = await pool
        .request()
        .input('TurnoId', sql.NVarChar(36), turno.TurnoId)
        .query(`
          SELECT m.MovimientoCajaId, m.Tipo, m.MontoCentimos, m.Motivo, m.Referencia, m.CreadoEn, u.NombreCompleto AS UsuarioNombre
          FROM dbo.MovimientosCaja m
          INNER JOIN dbo.Usuarios u ON u.UsuarioId = m.UsuarioId
          WHERE m.TurnoId = @TurnoId
          ORDER BY m.CreadoEn DESC
        `);

      movimientosCaja = mcRes.recordset.map((m: any) => ({
        movimientoCajaId: m.MovimientoCajaId,
        tipo: m.Tipo,
        montoCentimos: Number(m.MontoCentimos),
        motivo: m.Motivo,
        referencia: m.Referencia,
        usuarioNombre: m.UsuarioNombre,
        creadoEn: m.CreadoEn,
      }));
    }

    const cerradosRes = await pool
      .request()
      .input('SucursalId', sql.NVarChar(36), sucursalId)
      .input('CajaId', sql.NVarChar(36), cajaId)
      .query(`
        SELECT TOP 15 t.TurnoId, t.CodigoTurno, t.FechaApertura, t.FechaCierre,
               t.FondoInicialCentimos, t.EfectivoTeoricoCentimos, t.EfectivoContadoCentimos,
               t.DiferenciaCentimos, t.TotalBrutoCentimos, t.TotalAnulacionesCentimos,
               u.NombreCompleto AS UsuarioCierreNombre
        FROM dbo.TurnosCaja t
        LEFT JOIN dbo.Usuarios u ON u.UsuarioId = t.UsuarioCierreId
        WHERE t.SucursalId = @SucursalId AND t.CajaId = @CajaId AND t.Estado = N'CERRADO'
        ORDER BY t.FechaCierre DESC
      `);

    const turnosCerrados = cerradosRes.recordset.map((tc: any) => ({
      turnoId: tc.TurnoId,
      codigoTurno: tc.CodigoTurno,
      fechaApertura: tc.FechaApertura,
      fechaCierre: tc.FechaCierre,
      usuarioCierreNombre: tc.UsuarioCierreNombre || '-',
      fondoInicialCentimos: Number(tc.FondoInicialCentimos),
      efectivoTeoricoCentimos: Number(tc.EfectivoTeoricoCentimos || 0),
      efectivoContadoCentimos: Number(tc.EfectivoContadoCentimos || 0),
      diferenciaCentimos: Number(tc.DiferenciaCentimos || 0),
      totalNetoCentimos: Number(tc.TotalBrutoCentimos || 0) - Number(tc.TotalAnulacionesCentimos || 0),
    }));

    return res.json({
      turnoActual,
      ultimasTransacciones,
      movimientosCaja,
      turnosCerrados,
    });
  } catch (err) {
    console.error('Error consultando caja actual:', err);
    return res.status(500).json({ error: 'Error consultando información de caja.' });
  }
});

salesCashRouter.post('/caja/abrir', requirePermission('caja.operar'), async (req, res) => {
  try {
    const fondoInicialCentimos = Math.round(Number(req.body?.fondoInicialCentimos ?? 0));
    if (!Number.isInteger(fondoInicialCentimos) || fondoInicialCentimos < 0) {
      return res.status(400).json({ error: 'El fondo inicial debe ser mayor o igual a cero.' });
    }

    const sucursalId = req.auth!.sucursalId;
    const cajaId = req.auth!.cajaId;
    const turnoId = crypto.randomUUID();
    const codigoTurno = `SHIFT-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;

    await withTransaction(async (tx) => {
      const openCheck = await tx
        .request()
        .input('CajaId', sql.NVarChar(36), cajaId)
        .query(`
          SELECT TOP 1 TurnoId FROM dbo.TurnosCaja WITH (UPDLOCK, HOLDLOCK)
          WHERE CajaId = @CajaId AND Estado = N'ABIERTO'
        `);
      if (openCheck.recordset.length > 0) {
        throw new DomainRuleError('SHIFT_ALREADY_OPEN', 'Ya existe un turno de caja abierto.', 409);
      }

      await tx
        .request()
        .input('TurnoId', sql.NVarChar(36), turnoId)
        .input('CodigoTurno', sql.NVarChar(30), codigoTurno)
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .input('CajaId', sql.NVarChar(36), cajaId)
        .input('UsuarioAperturaId', sql.NVarChar(36), req.auth!.usuarioId)
        .input('FondoInicialCentimos', sql.BigInt, fondoInicialCentimos)
        .query(`
          INSERT INTO dbo.TurnosCaja (TurnoId, CodigoTurno, SucursalId, CajaId, UsuarioAperturaId, Estado, FondoInicialCentimos)
          VALUES (@TurnoId, @CodigoTurno, @SucursalId, @CajaId, @UsuarioAperturaId, N'ABIERTO', @FondoInicialCentimos)
        `);
    });

    return res.status(201).json({ turnoId, codigoTurno, fondoInicialCentimos });
  } catch (err) {
    if (err instanceof DomainRuleError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('Error abriendo caja:', err);
    return res.status(500).json({ error: 'No se pudo abrir el turno de caja.' });
  }
});

salesCashRouter.post('/caja/movimientos', requirePermission('caja.operar'), async (req, res) => {
  try {
    const body = req.body || {};
    const tipo = body.tipo === 'RETIRO' ? 'RETIRO' : body.tipo === 'INGRESO' ? 'INGRESO' : null;
    const montoCentimos = Math.round(Number(body.montoCentimos ?? 0));
    const motivo = String(body.motivo || '').trim();
    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID()).trim();

    if (!tipo || !Number.isInteger(montoCentimos) || montoCentimos <= 0 || !motivo) {
      return res.status(400).json({ error: 'Indique tipo (INGRESO/RETIRO), monto mayor a cero y motivo.' });
    }

    const result = await withTransaction(async (tx) => {
      const idemp = await tx
        .request()
        .input('Key', sql.NVarChar(100), idempotencyKey)
        .query('SELECT MovimientoCajaId FROM dbo.MovimientosCaja WHERE IdempotencyKey = @Key');
      if (idemp.recordset.length > 0) {
        return { movimientoCajaId: idemp.recordset[0].MovimientoCajaId };
      }

      const openCheck = await tx
        .request()
        .input('CajaId', sql.NVarChar(36), req.auth!.cajaId)
        .query(`
          SELECT TOP 1 TurnoId FROM dbo.TurnosCaja WITH (UPDLOCK, HOLDLOCK)
          WHERE CajaId = @CajaId AND Estado = N'ABIERTO'
        `);
      if (openCheck.recordset.length === 0) {
        throw new DomainRuleError('NO_OPEN_SHIFT', 'No hay turno de caja abierto.', 409);
      }

      const movimientoCajaId = crypto.randomUUID();
      await tx
        .request()
        .input('MovimientoCajaId', sql.NVarChar(36), movimientoCajaId)
        .input('TurnoId', sql.NVarChar(36), openCheck.recordset[0].TurnoId)
        .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
        .input('Tipo', sql.NVarChar(30), tipo)
        .input('MontoCentimos', sql.BigInt, montoCentimos)
        .input('Motivo', sql.NVarChar(240), motivo)
        .input('UsuarioId', sql.NVarChar(36), req.auth!.usuarioId)
        .input('Idemp', sql.NVarChar(100), idempotencyKey)
        .query(`
          INSERT INTO dbo.MovimientosCaja (MovimientoCajaId, TurnoId, SucursalId, Tipo, MontoCentimos, Motivo, UsuarioId, IdempotencyKey)
          VALUES (@MovimientoCajaId, @TurnoId, @SucursalId, @Tipo, @MontoCentimos, @Motivo, @UsuarioId, @Idemp)
        `);

      return { movimientoCajaId };
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof DomainRuleError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error en movimiento de caja:', err);
    return res.status(500).json({ error: 'No se pudo registrar el movimiento de caja.' });
  }
});

salesCashRouter.post('/caja/cerrar', requirePermission('caja.cerrar'), async (req, res) => {
  try {
    const body = req.body || {};
    const efectivoContadoCentimos = Math.round(Number(body.efectivoContadoCentimos ?? -1));
    const motivoDescuadre = body.motivoDescuadre ? String(body.motivoDescuadre).trim() : null;
    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID()).trim();

    const sucursalId = req.auth!.sucursalId;
    const cajaId = req.auth!.cajaId;

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

      const turnoRes = await tx
        .request()
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .input('CajaId', sql.NVarChar(36), cajaId)
        .query(`
          SELECT TOP 1 t.*, ua.NombreCompleto AS UsuarioAperturaNombre
          FROM dbo.TurnosCaja t WITH (UPDLOCK, HOLDLOCK)
          INNER JOIN dbo.Usuarios ua ON ua.UsuarioId = t.UsuarioAperturaId
          WHERE t.SucursalId = @SucursalId AND t.CajaId = @CajaId AND t.Estado = N'ABIERTO'
        `);

      if (turnoRes.recordset.length === 0) {
        throw new DomainRuleError('NO_OPEN_SHIFT', 'No hay un turno de caja abierto para cerrar.', 409);
      }

      const turno = turnoRes.recordset[0];
      const fondoInicialCentimos = Number(turno.FondoInicialCentimos);
      const metrics = await computeShiftMetrics(tx.request(), turno.TurnoId, fondoInicialCentimos);

      const pagosEfectivoCobrado =
        metrics.efectivoTeoricoCentimos -
        fondoInicialCentimos -
        metrics.ingresosEfectivoCentimos +
        metrics.retirosEfectivoCentimos +
        metrics.devolucionesEfectivoCentimos;

      const rec = computeCashReconciliation({
        fondoInicialCentimos,
        pagosEfectivoCentimos: pagosEfectivoCobrado,
        ingresosEfectivoCentimos: metrics.ingresosEfectivoCentimos,
        retirosEfectivoCentimos: metrics.retirosEfectivoCentimos,
        devolucionesEfectivoCentimos: metrics.devolucionesEfectivoCentimos,
        efectivoContadoCentimos,
        motivoDescuadre,
      });

      const fechaCierre = new Date().toISOString();
      const reporteZ = {
        turnoId: turno.TurnoId,
        codigoTurno: turno.CodigoTurno,
        sucursalNombre: req.auth!.sucursalNombre,
        sucursalRuc: req.auth!.sucursalRuc,
        cajaNombre: req.auth!.cajaNombre,
        fechaApertura: turno.FechaApertura,
        fechaCierre,
        usuarioAperturaNombre: turno.UsuarioAperturaNombre,
        usuarioCierreNombre: req.auth!.nombreCompleto,
        fondoInicialCentimos,
        efectivoTeoricoCentimos: rec.efectivoTeoricoCentimos,
        efectivoContadoCentimos,
        diferenciaCentimos: rec.diferenciaCentimos,
        motivoDescuadre,
        resumenMedios: metrics.resumenMedios,
        ingresosEfectivoCentimos: metrics.ingresosEfectivoCentimos,
        retirosEfectivoCentimos: metrics.retirosEfectivoCentimos,
        devolucionesEfectivoCentimos: metrics.devolucionesEfectivoCentimos,
        totalBrutoCentimos: metrics.totalBrutoCentimos,
        totalDescuentosCentimos: metrics.totalDescuentosCentimos,
        totalIgvCentimos: metrics.totalIgvCentimos,
        totalAnulacionesCentimos: metrics.totalAnulacionesCentimos,
        totalNetoCentimos: metrics.totalNetoCentimos,
      };

      await tx
        .request()
        .input('TurnoId', sql.NVarChar(36), turno.TurnoId)
        .input('UsuarioCierreId', sql.NVarChar(36), req.auth!.usuarioId)
        .input('EfectivoTeorico', sql.BigInt, rec.efectivoTeoricoCentimos)
        .input('EfectivoContado', sql.BigInt, efectivoContadoCentimos)
        .input('Diferencia', sql.BigInt, rec.diferenciaCentimos)
        .input('MotivoDescuadre', sql.NVarChar(500), motivoDescuadre)
        .input('TotalBruto', sql.BigInt, metrics.totalBrutoCentimos)
        .input('TotalIgv', sql.BigInt, metrics.totalIgvCentimos)
        .input('TotalAnulaciones', sql.BigInt, metrics.totalAnulacionesCentimos)
        .input('ReporteZJson', sql.NVarChar(sql.MAX), JSON.stringify(reporteZ))
        .input('Idemp', sql.NVarChar(100), idempotencyKey)
        .query(`
          UPDATE dbo.TurnosCaja
          SET Estado = N'CERRADO',
              UsuarioCierreId = @UsuarioCierreId,
              FechaCierre = SYSUTCDATETIME(),
              EfectivoTeoricoCentimos = @EfectivoTeorico,
              EfectivoContadoCentimos = @EfectivoContado,
              DiferenciaCentimos = @Diferencia,
              MotivoDescuadre = @MotivoDescuadre,
              TotalBrutoCentimos = @TotalBruto,
              TotalIgvCentimos = @TotalIgv,
              TotalAnulacionesCentimos = @TotalAnulaciones,
              ReporteZJson = @ReporteZJson,
              IdempotencyCierreKey = @Idemp
          WHERE TurnoId = @TurnoId AND Estado = N'ABIERTO'
        `);

      await tx
        .request()
        .input('IdempotencyKey', sql.NVarChar(100), idempotencyKey)
        .input('Operacion', sql.NVarChar(50), 'CIERRE_CAJA')
        .input('EntidadId', sql.NVarChar(36), turno.TurnoId)
        .input('RespuestaJson', sql.NVarChar(sql.MAX), JSON.stringify(reporteZ))
        .query(`
          INSERT INTO dbo.ClavesIdempotencia (IdempotencyKey, Operacion, EntidadId, RespuestaJson)
          VALUES (@IdempotencyKey, @Operacion, @EntidadId, @RespuestaJson)
        `);

      await tx
        .request()
        .input('SucursalId', sql.NVarChar(36), sucursalId)
        .input('UsuarioId', sql.NVarChar(36), req.auth!.usuarioId)
        .input('EntidadId', sql.NVarChar(60), turno.TurnoId)
        .input('DetalleJson', sql.NVarChar(sql.MAX), JSON.stringify({ codigoTurno: turno.CodigoTurno, diferenciaCentimos: rec.diferenciaCentimos }))
        .query(`
          INSERT INTO dbo.Auditoria (SucursalId, UsuarioId, Accion, Entidad, EntidadId, DetalleJson)
          VALUES (@SucursalId, @UsuarioId, N'CAJA_CERRADA_REPORTE_Z', N'TurnoCaja', @EntidadId, @DetalleJson)
        `);

      return reporteZ;
    });

    return res.json(result);
  } catch (err) {
    if (err instanceof DomainRuleError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('Error cerrando caja:', err);
    return res.status(500).json({ error: 'Error cerrando el turno de caja.' });
  }
});

salesCashRouter.get('/caja/turnos/:id/reporte-z', requirePermission('caja.operar'), async (req, res) => {
  try {
    const turnoId = String(req.params.id);
    const pool = await getSqlPool();
    const tRes = await pool
      .request()
      .input('TurnoId', sql.NVarChar(36), turnoId)
      .input('SucursalId', sql.NVarChar(36), req.auth!.sucursalId)
      .query(`
        SELECT TOP 1 t.*, ua.NombreCompleto AS UsuarioAperturaNombre, uc.NombreCompleto AS UsuarioCierreNombre
        FROM dbo.TurnosCaja t
        INNER JOIN dbo.Usuarios ua ON ua.UsuarioId = t.UsuarioAperturaId
        LEFT JOIN dbo.Usuarios uc ON uc.UsuarioId = t.UsuarioCierreId
        WHERE t.TurnoId = @TurnoId AND t.SucursalId = @SucursalId
      `);
    if (tRes.recordset.length === 0) {
      return res.status(404).json({ error: 'Turno de caja no encontrado.' });
    }
    const turno = tRes.recordset[0];
    if (turno.Estado === 'CERRADO' && turno.ReporteZJson) {
      return res.json(JSON.parse(turno.ReporteZJson));
    }

    const metrics = await computeShiftMetrics(
      pool.request(),
      turno.TurnoId,
      Number(turno.FondoInicialCentimos)
    );
    return res.json({
      turnoId: turno.TurnoId,
      codigoTurno: turno.CodigoTurno,
      esParcial: true,
      sucursalNombre: req.auth!.sucursalNombre,
      sucursalRuc: req.auth!.sucursalRuc,
      cajaNombre: req.auth!.cajaNombre,
      fechaApertura: turno.FechaApertura,
      fechaCierre: null,
      usuarioAperturaNombre: turno.UsuarioAperturaNombre,
      usuarioCierreNombre: null,
      fondoInicialCentimos: Number(turno.FondoInicialCentimos),
      efectivoContadoCentimos: null,
      diferenciaCentimos: null,
      motivoDescuadre: null,
      ...metrics,
    });
  } catch (err) {
    console.error('Error consultando reporte Z:', err);
    return res.status(500).json({ error: 'Error consultando el reporte de caja.' });
  }
});
