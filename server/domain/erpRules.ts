export type PaymentMethod = 'EFECTIVO' | 'VISA' | 'MASTERCARD' | 'TRANSFERENCIA_YAPE';

export interface LotCandidate {
  loteId: string;
  numeroLote: string;
  fechaVencimiento: string; // YYYY-MM-DD
  cantidadFisica: number;
  cantidadDisponible: number;
  estadoAptitud: 'APTO' | 'BLOQUEADO' | 'CUARENTENA' | 'VENCIDO';
  costoAdquisicionCentimos: number;
}

export interface LotAllocation {
  loteId: string;
  numeroLote: string;
  fechaVencimiento: string;
  cantidad: number;
  costoUnitarioCentimos: number;
}

export interface LineCalcInput {
  cantidad: number;
  precioUnitarioCentimos: number;
  descuentoPorcentaje: number;
  gravadoIgv: boolean;
  igvPorcentaje: number;
}

export interface LineCalcResult {
  brutoCentimos: number;
  descuentoCentimos: number;
  subtotalCentimos: number;
  baseImponibleCentimos: number;
  igvCentimos: number;
}

export interface PaymentInput {
  medioPago: PaymentMethod;
  montoCentimos: number;
  efectivoRecibidoCentimos?: number | null;
  referenciaOperacion?: string | null;
}

export interface PaymentResult extends PaymentInput {
  vueltoCentimos: number;
}

export class DomainRuleError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'DomainRuleError';
    this.code = code;
    this.status = status;
  }
}

export function getLimaTodayIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function formatPen(centimos: number): string {
  const soles = centimos / 100;
  return `S/ ${soles.toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function computeLineAmounts(input: LineCalcInput): LineCalcResult {
  if (!Number.isInteger(input.cantidad) || input.cantidad <= 0) {
    throw new DomainRuleError('INVALID_QTY', 'La cantidad de venta debe ser un entero positivo.');
  }
  if (!Number.isInteger(input.precioUnitarioCentimos) || input.precioUnitarioCentimos < 0) {
    throw new DomainRuleError('INVALID_PRICE', 'El precio unitario en céntimos es inválido.');
  }
  if (input.descuentoPorcentaje < 0 || input.descuentoPorcentaje > 100) {
    throw new DomainRuleError('INVALID_DISCOUNT', 'El descuento debe estar entre 0% y 100%.');
  }

  const brutoCentimos = input.cantidad * input.precioUnitarioCentimos;
  const descuentoCentimos = Math.round((brutoCentimos * input.descuentoPorcentaje) / 100);
  const subtotalCentimos = brutoCentimos - descuentoCentimos;

  if (!input.gravadoIgv || input.igvPorcentaje <= 0) {
    return {
      brutoCentimos,
      descuentoCentimos,
      subtotalCentimos,
      baseImponibleCentimos: subtotalCentimos,
      igvCentimos: 0,
    };
  }

  // En POS peruano el precio mostrado es precio final al consumidor; desglose exacto en céntimos
  const divisor = 1 + input.igvPorcentaje / 100;
  const baseImponibleCentimos = Math.round(subtotalCentimos / divisor);
  const igvCentimos = subtotalCentimos - baseImponibleCentimos;

  return {
    brutoCentimos,
    descuentoCentimos,
    subtotalCentimos,
    baseImponibleCentimos,
    igvCentimos,
  };
}

export function reconcileSalePayments(
  totalCentimos: number,
  payments: PaymentInput[]
): PaymentResult[] {
  if (payments.length === 0) {
    throw new DomainRuleError('PAYMENT_REQUIRED', 'Debe registrar al menos un medio de pago.');
  }

  let sumPaid = 0;
  const results: PaymentResult[] = [];

  for (const p of payments) {
    if (!Number.isInteger(p.montoCentimos) || p.montoCentimos < 0) {
      throw new DomainRuleError('INVALID_PAYMENT_AMOUNT', 'El monto del pago es inválido.');
    }
    sumPaid += p.montoCentimos;

    if (p.medioPago === 'EFECTIVO') {
      const received = p.efectivoRecibidoCentimos ?? p.montoCentimos;
      if (!Number.isInteger(received) || received < p.montoCentimos) {
        throw new DomainRuleError(
          'INSUFFICIENT_CASH_RECEIVED',
          'El efectivo recibido es menor al monto a cobrar en efectivo.'
        );
      }
      results.push({
        ...p,
        efectivoRecibidoCentimos: received,
        vueltoCentimos: received - p.montoCentimos,
      });
    } else {
      // Vuelto solo aplica a efectivo
      results.push({
        ...p,
        efectivoRecibidoCentimos: null,
        vueltoCentimos: 0,
      });
    }
  }

  if (sumPaid !== totalCentimos) {
    throw new DomainRuleError(
      'PAYMENT_MISMATCH',
      `La suma de los pagos (${formatPen(sumPaid)}) no coincide con el total de la venta (${formatPen(totalCentimos)}).`
    );
  }

  return results;
}

export function allocateLotsFefo(
  lots: LotCandidate[],
  requestedQty: number,
  todayIso: string = getLimaTodayIso()
): LotAllocation[] {
  if (!Number.isInteger(requestedQty) || requestedQty <= 0) {
    throw new DomainRuleError('INVALID_QTY', 'La cantidad solicitada debe ser mayor a cero.');
  }

  const eligible = lots
    .filter(
      (lot) =>
        lot.estadoAptitud === 'APTO' &&
        lot.cantidadDisponible > 0 &&
        lot.fechaVencimiento >= todayIso
    )
    .sort((a, b) => {
      if (a.fechaVencimiento !== b.fechaVencimiento) {
        return a.fechaVencimiento.localeCompare(b.fechaVencimiento);
      }
      return a.loteId.localeCompare(b.loteId);
    });

  const totalAvailable = eligible.reduce((acc, l) => acc + l.cantidadDisponible, 0);
  if (totalAvailable < requestedQty) {
    const expiredOrBlockedQty = lots
      .filter(
        (lot) =>
          lot.cantidadFisica > 0 &&
          (lot.estadoAptitud !== 'APTO' || lot.fechaVencimiento < todayIso)
      )
      .reduce((acc, l) => acc + l.cantidadFisica, 0);

    if (expiredOrBlockedQty > 0 && totalAvailable === 0) {
      throw new DomainRuleError(
        'EXPIRED_OR_BLOCKED_LOTS',
        'No hay lotes aptos y vigentes disponibles para vender (existen unidades vencidas o bloqueadas).'
      );
    }
    throw new DomainRuleError(
      'INSUFFICIENT_STOCK',
      `Stock disponible insuficiente: se requieren ${requestedQty} unidades y solo hay ${totalAvailable} aptas y vigentes.`
    );
  }

  let remaining = requestedQty;
  const allocations: LotAllocation[] = [];

  for (const lot of eligible) {
    if (remaining <= 0) break;
    const take = Math.min(lot.cantidadDisponible, remaining);
    if (take > 0) {
      allocations.push({
        loteId: lot.loteId,
        numeroLote: lot.numeroLote,
        fechaVencimiento: lot.fechaVencimiento,
        cantidad: take,
        costoUnitarioCentimos: lot.costoAdquisicionCentimos,
      });
      remaining -= take;
    }
  }

  return allocations;
}

export function validatePrescriptionGate(params: {
  hasPrescriptionItems: boolean;
  recetaReferencia?: string | null;
  validationRecord?: {
    validacionId: string;
    validadoPor: string;
    validadoEn: string;
    recetaReferencia: string;
  } | null;
}) {
  if (!params.hasPrescriptionItems) {
    return;
  }
  const ref = params.recetaReferencia?.trim();
  if (!ref) {
    throw new DomainRuleError(
      'PRESCRIPTION_REF_REQUIRED',
      'Los productos con receta médica requieren ingresar la referencia de receta.'
    );
  }
  if (!params.validationRecord || params.validationRecord.recetaReferencia !== ref) {
    throw new DomainRuleError(
      'PRESCRIPTION_NOT_VALIDATED',
      'La receta médica debe ser validada internamente por un farmacéutico autorizado antes de confirmar el cobro.',
      403
    );
  }
}

export function computeCashReconciliation(params: {
  fondoInicialCentimos: number;
  pagosEfectivoCentimos: number;
  ingresosEfectivoCentimos: number;
  retirosEfectivoCentimos: number;
  devolucionesEfectivoCentimos: number;
  efectivoContadoCentimos: number;
  motivoDescuadre?: string | null;
}) {
  if (!Number.isInteger(params.efectivoContadoCentimos) || params.efectivoContadoCentimos < 0) {
    throw new DomainRuleError('INVALID_COUNTED_CASH', 'El efectivo contado debe ser mayor o igual a cero.');
  }

  const efectivoTeoricoCentimos =
    params.fondoInicialCentimos +
    params.pagosEfectivoCentimos +
    params.ingresosEfectivoCentimos -
    params.retirosEfectivoCentimos -
    params.devolucionesEfectivoCentimos;

  const diferenciaCentimos = params.efectivoContadoCentimos - efectivoTeoricoCentimos;

  if (diferenciaCentimos !== 0 && !params.motivoDescuadre?.trim()) {
    throw new DomainRuleError(
      'DISCREPANCY_REASON_REQUIRED',
      'Existe diferencia entre el efectivo teórico y el contado. Debe ingresar el motivo del descuadre.'
    );
  }

  return {
    efectivoTeoricoCentimos,
    diferenciaCentimos,
  };
}

export function computeKardexRunningBalances<
  T extends { cantidadEntrada: number; cantidadSalida: number }
>(movementsAsc: T[], openingBalance = 0): Array<T & { saldoCalculado: number }> {
  let running = openingBalance;
  return movementsAsc.map((mov) => {
    running = running + mov.cantidadEntrada - mov.cantidadSalida;
    return {
      ...mov,
      saldoCalculado: running,
    };
  });
}
