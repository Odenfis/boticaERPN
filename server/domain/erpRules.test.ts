import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateLotsFefo,
  computeCashReconciliation,
  computeKardexRunningBalances,
  computeLineAmounts,
  DomainRuleError,
  reconcileSalePayments,
  validatePrescriptionGate,
} from './erpRules';

test('FEFO allocation consumes earliest expiring lot first and splits across lots', () => {
  const lots = [
    {
      loteId: 'L2',
      numeroLote: 'LOT-B',
      fechaVencimiento: '2027-06-01',
      cantidadFisica: 10,
      cantidadDisponible: 10,
      estadoAptitud: 'APTO' as const,
      costoAdquisicionCentimos: 1200,
    },
    {
      loteId: 'L1',
      numeroLote: 'LOT-A',
      fechaVencimiento: '2026-12-15',
      cantidadFisica: 6,
      cantidadDisponible: 6,
      estadoAptitud: 'APTO' as const,
      costoAdquisicionCentimos: 1100,
    },
  ];

  const allocations = allocateLotsFefo(lots, 8, '2026-11-24');
  assert.equal(allocations.length, 2);
  assert.deepEqual(allocations[0], {
    loteId: 'L1',
    numeroLote: 'LOT-A',
    fechaVencimiento: '2026-12-15',
    cantidad: 6,
    costoUnitarioCentimos: 1100,
  });
  assert.deepEqual(allocations[1], {
    loteId: 'L2',
    numeroLote: 'LOT-B',
    fechaVencimiento: '2027-06-01',
    cantidad: 2,
    costoUnitarioCentimos: 1200,
  });
});

test('FEFO blocks expired lots and rejects insufficient stock without negative balance', () => {
  const lots = [
    {
      loteId: 'L-EXP',
      numeroLote: 'LOT-EXP',
      fechaVencimiento: '2026-11-01',
      cantidadFisica: 10,
      cantidadDisponible: 10,
      estadoAptitud: 'APTO' as const, // even if status flag lags, date check blocks it
      costoAdquisicionCentimos: 1000,
    },
  ];

  assert.throws(
    () => allocateLotsFefo(lots, 1, '2026-11-24'),
    (err: unknown) => err instanceof DomainRuleError && err.code === 'EXPIRED_OR_BLOCKED_LOTS'
  );

  const partialLots = [
    {
      loteId: 'L-OK',
      numeroLote: 'LOT-OK',
      fechaVencimiento: '2027-01-01',
      cantidadFisica: 4,
      cantidadDisponible: 4,
      estadoAptitud: 'APTO' as const,
      costoAdquisicionCentimos: 1000,
    },
  ];

  assert.throws(
    () => allocateLotsFefo(partialLots, 5, '2026-11-24'),
    (err: unknown) => err instanceof DomainRuleError && err.code === 'INSUFFICIENT_STOCK'
  );
});

test('PEN centimos and 18% IGV breakdown reconcile exactly with payments and cash change', () => {
  const line = computeLineAmounts({
    cantidad: 3,
    precioUnitarioCentimos: 1250, // S/ 12.50 final
    descuentoPorcentaje: 10,
    gravadoIgv: true,
    igvPorcentaje: 18,
  });

  // 3 * 1250 = 3750, 10% = 375, subtotal = 3375
  assert.equal(line.brutoCentimos, 3750);
  assert.equal(line.descuentoCentimos, 375);
  assert.equal(line.subtotalCentimos, 3375);
  assert.equal(line.baseImponibleCentimos + line.igvCentimos, line.subtotalCentimos);

  const payments = reconcileSalePayments(3375, [
    { medioPago: 'EFECTIVO', montoCentimos: 3375, efectivoRecibidoCentimos: 5000 },
  ]);
  assert.equal(payments[0].vueltoCentimos, 1625);

  const cardPayments = reconcileSalePayments(3375, [
    { medioPago: 'VISA', montoCentimos: 3375, efectivoRecibidoCentimos: 5000 },
  ]);
  assert.equal(cardPayments[0].vueltoCentimos, 0);
});

test('Prescription gate blocks unvalidated Rx sales and allows validated Rx', () => {
  assert.throws(
    () =>
      validatePrescriptionGate({
        hasPrescriptionItems: true,
        recetaReferencia: 'RX-100',
        validationRecord: null,
      }),
    (err: unknown) => err instanceof DomainRuleError && err.code === 'PRESCRIPTION_NOT_VALIDATED'
  );

  assert.doesNotThrow(() =>
    validatePrescriptionGate({
      hasPrescriptionItems: true,
      recetaReferencia: 'RX-100',
      validationRecord: {
        validacionId: 'VAL-1',
        validadoPor: 'USR-FARM',
        validadoEn: '2026-11-24T12:00:00Z',
        recetaReferencia: 'RX-100',
      },
    })
  );
});

test('Cash reconciliation calculates theoretical cash, difference, and enforces reason on discrepancy', () => {
  const exact = computeCashReconciliation({
    fondoInicialCentimos: 20000,
    pagosEfectivoCentimos: 15000,
    ingresosEfectivoCentimos: 5000,
    retirosEfectivoCentimos: 3000,
    devolucionesEfectivoCentimos: 2000,
    efectivoContadoCentimos: 35000,
  });
  assert.equal(exact.efectivoTeoricoCentimos, 35000);
  assert.equal(exact.diferenciaCentimos, 0);

  assert.throws(
    () =>
      computeCashReconciliation({
        fondoInicialCentimos: 20000,
        pagosEfectivoCentimos: 15000,
        ingresosEfectivoCentimos: 0,
        retirosEfectivoCentimos: 0,
        devolucionesEfectivoCentimos: 0,
        efectivoContadoCentimos: 34500,
        motivoDescuadre: '',
      }),
    (err: unknown) => err instanceof DomainRuleError && err.code === 'DISCREPANCY_REASON_REQUIRED'
  );
});

test('Kardex running balances preserve opening balance across date filters', () => {
  const rows = computeKardexRunningBalances(
    [
      { cantidadEntrada: 10, cantidadSalida: 0 },
      { cantidadEntrada: 0, cantidadSalida: 6 },
      { cantidadEntrada: 0, cantidadSalida: 2 },
    ],
    4 // opening carry-over balance before filter start
  );
  assert.deepEqual(
    rows.map((r) => r.saldoCalculado),
    [14, 8, 6]
  );
});
