import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  generateKardexPdfBuffer,
  generateReportsExcelBuffer,
  generateReportsPdfBuffer,
} from './exportService';

test('generateKardexPdfBuffer produces valid PDF binary buffer', async () => {
  const buf = await generateKardexPdfBuffer({
    producto: {
      sku: 'SKU-11029',
      nombre: 'Amoxicilina + Ácido Clavulánico',
      principioActivo: 'Amoxicilina / Ácido Clavulánico',
      concentracion: '875mg / 125mg',
      presentacion: 'Caja x 14 Tabletas',
      laboratorio: 'GSK',
      registroSanitario: 'EN-04322-S2',
      condicionVenta: 'RECETA',
      stockActual: 60,
    },
    sucursalNombre: 'Botica Central Lima',
    rangoTexto: '2026-11-01 al 2026-11-24',
    saldoArrastre: 50,
    movimientos: [
      {
        fechaHora: '24/11/2026 10:00',
        tipo: 'COMPRA',
        documentoRef: 'GUI-001',
        numeroLote: 'L-8842',
        cantidadEntrada: 16,
        cantidadSalida: 0,
        saldoCalculado: 66,
        responsableUsername: 'admin',
      },
      {
        fechaHora: '24/11/2026 12:30',
        tipo: 'VENTA',
        documentoRef: 'TK-0001',
        numeroLote: 'L-8842',
        cantidadEntrada: 0,
        cantidadSalida: 6,
        saldoCalculado: 60,
        responsableUsername: 'cajero1',
      },
    ],
  });

  assert.ok(buf.length > 500);
  assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');
});

test('generateReportsPdfBuffer and generateReportsExcelBuffer produce valid readable files', async () => {
  const payload = {
    sucursalNombre: 'Botica Central Lima',
    fechaDesde: '2026-11-01',
    fechaHasta: '2026-11-24',
    filtrosTexto: 'Todos los vendedores | Todos los medios',
    resumen: {
      ventasBrutasCentimos: 120000,
      descuentosCentimos: 5000,
      anulacionesCentimos: 15000,
      ventasNetasCentimos: 100000,
      igvNetoCentimos: 15254,
      totalTransacciones: 12,
    },
    porMedioPago: [
      { medioPago: 'EFECTIVO', transacciones: 8, totalCentimos: 65000 },
      { medioPago: 'VISA', transacciones: 4, totalCentimos: 35000 },
    ],
    topProductos: [
      {
        sku: 'SKU-40293',
        nombre: 'Paracetamol 500mg',
        categoria: 'Analgésicos',
        unidadesVendidas: 40,
        totalCentimos: 50000,
      },
    ],
    porVendedor: [
      {
        nombreCompleto: 'Ana Contreras',
        cargo: 'Farmacéutica',
        transacciones: 12,
        ticketPromedioCentimos: 8333,
        totalCentimos: 100000,
        comisionCentimos: 3000,
      },
    ],
  };

  const pdfBuf = await generateReportsPdfBuffer(payload);
  assert.equal(pdfBuf.subarray(0, 5).toString('ascii'), '%PDF-');

  const xlsxBuf = await generateReportsExcelBuffer(payload);
  assert.equal(xlsxBuf.subarray(0, 2).toString('ascii'), 'PK');

  const parsedWb = new ExcelJS.Workbook();
  await parsedWb.xlsx.load(xlsxBuf as unknown as ArrayBuffer);
  const resumen = parsedWb.getWorksheet('Resumen');
  assert.ok(resumen);
  assert.equal(resumen.getCell('B8').value, 1000); // 100000 centimos = S/ 1000.00
});
