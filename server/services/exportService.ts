import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { formatPen } from '../domain/erpRules';

export interface KardexExportPayload {
  producto: {
    sku: string;
    nombre: string;
    principioActivo: string;
    concentracion: string;
    presentacion: string;
    laboratorio: string;
    registroSanitario?: string | null;
    condicionVenta: string;
    stockActual: number;
  };
  sucursalNombre: string;
  rangoTexto: string;
  saldoArrastre: number;
  movimientos: Array<{
    fechaHora: string;
    tipo: string;
    documentoRef: string;
    numeroLote: string;
    cantidadEntrada: number;
    cantidadSalida: number;
    saldoCalculado: number;
    responsableUsername: string;
    motivo?: string | null;
  }>;
}

export interface ReportsExportPayload {
  sucursalNombre: string;
  fechaDesde: string;
  fechaHasta: string;
  filtrosTexto: string;
  resumen: {
    ventasBrutasCentimos: number;
    descuentosCentimos: number;
    anulacionesCentimos: number;
    ventasNetasCentimos: number;
    igvNetoCentimos: number;
    totalTransacciones: number;
  };
  porMedioPago: Array<{
    medioPago: string;
    transacciones: number;
    totalCentimos: number;
  }>;
  topProductos: Array<{
    sku: string;
    nombre: string;
    categoria: string;
    unidadesVendidas: number;
    totalCentimos: number;
  }>;
  porVendedor: Array<{
    nombreCompleto: string;
    cargo: string;
    transacciones: number;
    ticketPromedioCentimos: number;
    totalCentimos: number;
    comisionCentimos: number | null;
  }>;
}

export function generateKardexPdfBuffer(payload: KardexExportPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).fillColor('#006A3B').text('Botica ERP — Kardex de Producto', { align: 'left' });
    doc
      .fontSize(9)
      .fillColor('#3F4941')
      .text(`${payload.sucursalNombre} | Periodo: ${payload.rangoTexto}`);
    doc.moveDown(0.75);

    doc.fontSize(11).fillColor('#181D19').text(`${payload.producto.nombre} (${payload.producto.sku})`);
    doc
      .fontSize(9)
      .fillColor('#3F4941')
      .text(
        `Concentración: ${payload.producto.concentracion} | Presentación: ${payload.producto.presentacion} | Lab: ${payload.producto.laboratorio}`
      )
      .text(
        `Reg. Sanitario: ${payload.producto.registroSanitario || 'N/A'} | Condición: ${payload.producto.condicionVenta} | Stock Actual: ${payload.producto.stockActual} und`
      );
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#005DB7').text(`Saldo de arrastre inicial del periodo: ${payload.saldoArrastre} und`);
    doc.moveDown(0.75);

    // Table header
    const startX = 36;
    const cols = [
      { label: 'Fecha/Hora', w: 90 },
      { label: 'Tipo', w: 72 },
      { label: 'Documento', w: 82 },
      { label: 'Lote', w: 68 },
      { label: 'Ent.', w: 38, align: 'right' as const },
      { label: 'Sal.', w: 38, align: 'right' as const },
      { label: 'Saldo', w: 45, align: 'right' as const },
      { label: 'Resp.', w: 85 },
    ];

    let y = doc.y;
    doc.rect(startX, y, 520, 18).fill('#EBEFE8');
    doc.fillColor('#181D19').fontSize(8);
    let x = startX + 4;
    for (const c of cols) {
      doc.text(c.label, x, y + 5, { width: c.w - 4, align: c.align ?? 'left' });
      x += c.w;
    }
    y += 22;

    if (payload.movimientos.length === 0) {
      doc.fontSize(9).fillColor('#6F7A70').text('Sin movimientos en el periodo seleccionado.', startX, y);
    } else {
      for (const m of payload.movimientos) {
        if (y > 760) {
          doc.addPage();
          y = 40;
        }
        x = startX + 4;
        const rowVals = [
          m.fechaHora,
          m.tipo,
          m.documentoRef,
          m.numeroLote,
          m.cantidadEntrada > 0 ? String(m.cantidadEntrada) : '-',
          m.cantidadSalida > 0 ? String(m.cantidadSalida) : '-',
          String(m.saldoCalculado),
          m.responsableUsername,
        ];
        doc.fillColor('#181D19').fontSize(8);
        cols.forEach((c, idx) => {
          doc.text(rowVals[idx], x, y, { width: c.w - 4, align: c.align ?? 'left' });
          x += c.w;
        });
        y += 16;
        doc.moveTo(startX, y - 2).lineTo(startX + 520, y - 2).strokeColor('#E5E9E2').lineWidth(0.5).stroke();
      }
    }

    doc.end();
  });
}

export function generateReportsPdfBuffer(payload: ReportsExportPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).fillColor('#006A3B').text('Botica ERP — Reporte de Ventas y Desempeño');
    doc
      .fontSize(9)
      .fillColor('#3F4941')
      .text(`${payload.sucursalNombre} | Periodo: ${payload.fechaDesde} al ${payload.fechaHasta}`)
      .text(`Filtros: ${payload.filtrosTexto}`);
    doc.moveDown(0.75);

    doc.fontSize(11).fillColor('#181D19').text('Resumen Ejecutivo (PEN S/)');
    doc
      .fontSize(9)
      .text(`Ventas Brutas (completadas + anuladas): ${formatPen(payload.resumen.ventasBrutasCentimos)}`)
      .text(`Descuentos otorgados: ${formatPen(payload.resumen.descuentosCentimos)}`)
      .text(`Anulaciones del periodo: ${formatPen(payload.resumen.anulacionesCentimos)}`)
      .text(`Ventas Netas: ${formatPen(payload.resumen.ventasNetasCentimos)}`)
      .text(`IGV Neto desglosado: ${formatPen(payload.resumen.igvNetoCentimos)}`)
      .text(`Transacciones Netas: ${payload.resumen.totalTransacciones}`);
    doc.moveDown(0.75);

    doc.fontSize(11).fillColor('#005DB7').text('Medios de Pago (Ventas Netas)');
    doc.fontSize(9).fillColor('#181D19');
    if (payload.porMedioPago.length === 0) {
      doc.text('Sin transacciones en el periodo.');
    } else {
      for (const mp of payload.porMedioPago) {
        doc.text(`• ${mp.medioPago}: ${mp.transacciones} trans. — ${formatPen(mp.totalCentimos)}`);
      }
    }
    doc.moveDown(0.75);

    doc.fontSize(11).fillColor('#005DB7').text('Ranking de Productos');
    doc.fontSize(9).fillColor('#181D19');
    if (payload.topProductos.length === 0) {
      doc.text('Sin productos vendidos en el periodo.');
    } else {
      for (const p of payload.topProductos) {
        doc.text(
          `• ${p.sku} ${p.nombre} (${p.categoria}): ${p.unidadesVendidas} und — ${formatPen(p.totalCentimos)}`
        );
      }
    }
    doc.moveDown(0.75);

    doc.fontSize(11).fillColor('#005DB7').text('Ventas por Vendedor');
    doc.fontSize(9).fillColor('#181D19');
    if (payload.porVendedor.length === 0) {
      doc.text('Sin ventas por vendedor en el periodo.');
    } else {
      for (const v of payload.porVendedor) {
        const comText =
          v.comisionCentimos !== null ? ` | Comisión: ${formatPen(v.comisionCentimos)}` : '';
        doc.text(
          `• ${v.nombreCompleto} (${v.cargo}): ${v.transacciones} trans. | Ticket Prom.: ${formatPen(v.ticketPromedioCentimos)} | Total: ${formatPen(v.totalCentimos)}${comText}`
        );
      }
    }

    doc.end();
  });
}

export async function generateReportsExcelBuffer(payload: ReportsExportPayload): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Botica ERP';
  wb.created = new Date();

  const resumenWs = wb.addWorksheet('Resumen');
  resumenWs.columns = [
    { header: 'Concepto', key: 'concepto', width: 38 },
    { header: 'Valor', key: 'valor', width: 24 },
  ];
  resumenWs.addRows([
    { concepto: 'Sucursal', valor: payload.sucursalNombre },
    { concepto: 'Periodo', valor: `${payload.fechaDesde} al ${payload.fechaHasta}` },
    { concepto: 'Filtros', valor: payload.filtrosTexto },
    { concepto: 'Ventas Brutas (S/)', valor: payload.resumen.ventasBrutasCentimos / 100 },
    { concepto: 'Descuentos (S/)', valor: payload.resumen.descuentosCentimos / 100 },
    { concepto: 'Anulaciones (S/)', valor: payload.resumen.anulacionesCentimos / 100 },
    { concepto: 'Ventas Netas (S/)', valor: payload.resumen.ventasNetasCentimos / 100 },
    { concepto: 'IGV Neto (S/)', valor: payload.resumen.igvNetoCentimos / 100 },
    { concepto: 'Transacciones Netas', valor: payload.resumen.totalTransacciones },
  ]);
  resumenWs.getRow(1).font = { bold: true };
  for (let r = 5; r <= 9; r++) {
    resumenWs.getCell(`B${r}`).numFmt = '"S/" #,##0.00';
  }

  const mpWs = wb.addWorksheet('Medios de Pago');
  mpWs.columns = [
    { header: 'Medio de Pago', key: 'medioPago', width: 26 },
    { header: 'Transacciones', key: 'transacciones', width: 16 },
    { header: 'Total (S/)', key: 'total', width: 18 },
  ];
  mpWs.getRow(1).font = { bold: true };
  for (const mp of payload.porMedioPago) {
    mpWs.addRow({
      medioPago: mp.medioPago,
      transacciones: mp.transacciones,
      total: mp.totalCentimos / 100,
    });
  }
  mpWs.getColumn('total').numFmt = '"S/" #,##0.00';

  const prodWs = wb.addWorksheet('Top Productos');
  prodWs.columns = [
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Producto', key: 'nombre', width: 34 },
    { header: 'Categoría', key: 'categoria', width: 20 },
    { header: 'Unidades Vendidas', key: 'unidades', width: 18 },
    { header: 'Total (S/)', key: 'total', width: 18 },
  ];
  prodWs.getRow(1).font = { bold: true };
  for (const p of payload.topProductos) {
    prodWs.addRow({
      sku: p.sku,
      nombre: p.nombre,
      categoria: p.categoria,
      unidades: p.unidadesVendidas,
      total: p.totalCentimos / 100,
    });
  }
  prodWs.getColumn('total').numFmt = '"S/" #,##0.00';

  const vendWs = wb.addWorksheet('Vendedores');
  vendWs.columns = [
    { header: 'Vendedor', key: 'nombre', width: 30 },
    { header: 'Cargo', key: 'cargo', width: 22 },
    { header: 'Transacciones', key: 'transacciones', width: 16 },
    { header: 'Ticket Promedio (S/)', key: 'ticketPromedio', width: 20 },
    { header: 'Total Ventas (S/)', key: 'total', width: 18 },
    { header: 'Comisión (S/)', key: 'comision', width: 16 },
  ];
  vendWs.getRow(1).font = { bold: true };
  for (const v of payload.porVendedor) {
    vendWs.addRow({
      nombre: v.nombreCompleto,
      cargo: v.cargo,
      transacciones: v.transacciones,
      ticketPromedio: v.ticketPromedioCentimos / 100,
      total: v.totalCentimos / 100,
      comision: v.comisionCentimos !== null ? v.comisionCentimos / 100 : null,
    });
  }
  vendWs.getColumn('ticketPromedio').numFmt = '"S/" #,##0.00';
  vendWs.getColumn('total').numFmt = '"S/" #,##0.00';
  vendWs.getColumn('comision').numFmt = '"S/" #,##0.00';

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
