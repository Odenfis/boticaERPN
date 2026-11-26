import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CheckCircle2,
  CreditCard,
  Lock,
  Printer,
  Smartphone,
  Unlock,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatLimaDateTime, formatPen, solesToCentimos } from '../lib/format';
import type { AuthUser, CashBoxData } from '../types/erp';

interface CajaViewProps {
  user: AuthUser;
  onShiftChanged: () => void;
}

export function CajaView({ user, onShiftChanged }: CajaViewProps) {
  const [data, setData] = useState<CashBoxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Abrir turno
  const [openingStr, setOpeningStr] = useState('200.00');
  const [openingLoading, setOpeningLoading] = useState(false);

  // Movimiento de caja
  const [movModalOpen, setMovModalOpen] = useState(false);
  const [movTipo, setMovTipo] = useState<'INGRESO' | 'RETIRO'>('INGRESO');
  const [movMontoStr, setMovMontoStr] = useState('');
  const [movMotivo, setMovMotivo] = useState('');
  const [movSaving, setMovSaving] = useState(false);

  // Arqueo y cierre
  const [countedCashStr, setCountedCashStr] = useState('');
  const [motivoDescuadre, setMotivoDescuadre] = useState('');
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [closingShift, setClosingShift] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Reporte Parcial / Z modal
  const [reporteModal, setReporteModal] = useState<any | null>(null);

  const canClose = user.permisos.includes('caja.cerrar');

  const loadCaja = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<CashBoxData>('/api/caja/actual');
      setData(res);
      if (res.turnoActual?.estado === 'ABIERTO') {
        setCountedCashStr((res.turnoActual.efectivoTeoricoCentimos / 100).toFixed(2));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error consultando caja.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCaja();
  }, []);

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOpeningLoading(true);
    try {
      const fondoInicialCentimos = Math.max(0, solesToCentimos(openingStr));
      const res = await apiFetch<{ codigoTurno: string }>('/api/caja/abrir', {
        method: 'POST',
        body: JSON.stringify({ fondoInicialCentimos }),
      });
      setFeedback(`Turno ${res.codigoTurno} abierto con ${formatPen(fondoInicialCentimos)}.`);
      await loadCaja();
      onShiftChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir el turno.');
    } finally {
      setOpeningLoading(false);
    }
  };

  const handleAddCashMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const montoCentimos = solesToCentimos(movMontoStr);
    if (montoCentimos <= 0 || !movMotivo.trim()) {
      setError('Ingrese un monto positivo y el motivo del movimiento.');
      return;
    }
    setMovSaving(true);
    try {
      await apiFetch('/api/caja/movimientos', {
        method: 'POST',
        body: JSON.stringify({
          tipo: movTipo,
          montoCentimos,
          motivo: movMotivo.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setMovModalOpen(false);
      setMovMontoStr('');
      setMovMotivo('');
      setFeedback(`${movTipo === 'INGRESO' ? 'Ingreso' : 'Retiro'} de efectivo registrado.`);
      await loadCaja();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento.');
    } finally {
      setMovSaving(false);
    }
  };

  const handleConfirmClose = async () => {
    if (!turno) return;
    setCloseError(null);
    const contadoCent = solesToCentimos(countedCashStr);
    const diff = contadoCent - turno.efectivoTeoricoCentimos;
    if (diff !== 0 && !motivoDescuadre.trim()) {
      setCloseError('Existe una diferencia en efectivo; ingrese el motivo del descuadre.');
      return;
    }
    setClosingShift(true);
    try {
      const reporteZ = await apiFetch('/api/caja/cerrar', {
        method: 'POST',
        body: JSON.stringify({
          efectivoContadoCentimos: contadoCent,
          motivoDescuadre: motivoDescuadre.trim() || null,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setConfirmCloseOpen(false);
      setMotivoDescuadre('');
      setReporteModal(reporteZ);
      setFeedback(`Turno ${turno.codigoTurno} cerrado. Reporte Z generado.`);
      await loadCaja();
      onShiftChanged();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'No se pudo cerrar el turno.');
    } finally {
      setClosingShift(false);
    }
  };

  const openReportModal = async (turnoId: string) => {
    try {
      const rep = await apiFetch(`/api/caja/turnos/${turnoId}/reporte-z`);
      setReporteModal(rep);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el reporte.');
    }
  };

  if (loading) {
    return (
      <div className="p-10 bg-white border border-[#BECABE] rounded-xl text-center text-xs text-[#6F7A70]">
        Cargando estado de caja y arqueo...
      </div>
    );
  }

  const turno = data?.turnoActual || null;
  const isShiftOpen = turno?.estado === 'ABIERTO';
  const contadoCentimos = solesToCentimos(countedCashStr);
  const diferenciaPreview = turno ? contadoCentimos - turno.efectivoTeoricoCentimos : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-[#181D19]">Caja, Arqueo y Cierre de Turno</h1>
          <p className="text-xs text-[#6F7A70] mt-0.5">
            {user.cajaNombre} · {user.sucursalNombre}
          </p>
        </div>
        {turno && (
          <div className="flex flex-wrap items-center gap-2">
            {isShiftOpen && (
              <button
                type="button"
                onClick={() => setMovModalOpen(true)}
                className="px-3.5 py-2 border border-[#BECABE] bg-white hover:bg-slate-50 text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
              >
                <ArrowUpCircle className="w-4 h-4 text-[#005DB7]" />
                <span>Ingreso / Retiro efectivo</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => openReportModal(turno.turnoId)}
              className="px-3.5 py-2 border border-[#BECABE] bg-white hover:bg-slate-50 text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              <span>{isShiftOpen ? 'Reporte parcial' : 'Ver último Reporte Z'}</span>
            </button>
          </div>
        )}
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold text-[#006A3B] flex items-center justify-between no-print">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {feedback}
          </span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Cerrar">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-[#FFDAD6] border border-[#BA1A1A]/30 rounded-lg text-xs font-semibold text-[#93000A] no-print">
          {error}
        </div>
      )}

      {/* Apertura de Turno si no hay turno abierto */}
      {!isShiftOpen && (
        <section className="bg-white border border-[#BECABE] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4 no-print">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-bold text-[#181D19]">
              <Lock className="w-4 h-4 text-[#BA1A1A]" />
              <span>La caja está cerrada actualmente</span>
            </div>
            <p className="text-xs text-[#6F7A70]">
              El POS permanece bloqueado para nuevos cobros hasta abrir un nuevo turno de caja con fondo inicial.
            </p>
          </div>
          <form onSubmit={handleOpenShift} className="flex flex-wrap items-end gap-3 text-xs">
            <div>
              <label htmlFor="fondo-inicial" className="block font-semibold text-[#3F4941] mb-1">
                Fondo inicial (S/)
              </label>
              <input
                id="fondo-inicial"
                type="number"
                step="0.01"
                min="0"
                required
                value={openingStr}
                onChange={(e) => setOpeningStr(e.target.value)}
                className="w-36 px-3 py-2 border border-[#BECABE] rounded-md font-data-mono font-bold"
              />
            </div>
            <button
              type="submit"
              disabled={openingLoading}
              className="px-5 py-2.5 bg-[#006A3B] hover:bg-[#00522D] text-white font-bold rounded-lg inline-flex items-center gap-1.5"
            >
              <Unlock className="w-4 h-4" />
              <span>{openingLoading ? 'Abriendo...' : 'Abrir turno de caja'}</span>
            </button>
          </form>
        </section>
      )}

      {/* Detalle del turno actual (abierto o último cerrado) */}
      {turno && (
        <div className="grid grid-cols-12 gap-5 no-print">
          {/* Columna izquierda: 4 medios, transacciones y movimientos */}
          <div className="col-span-12 xl:col-span-8 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white border border-[#BECABE] rounded-xl p-4">
                <div className="flex items-center justify-between text-xs font-semibold text-[#6F7A70]">
                  <span>Efectivo</span>
                  <Banknote className="w-4 h-4 text-[#006A3B]" />
                </div>
                <div className="text-lg font-bold font-data-mono tabular-nums text-[#181D19] mt-1">
                  {formatPen(turno.resumenMedios.EFECTIVO.totalCentimos)}
                </div>
                <div className="text-[11px] text-[#6F7A70] mt-0.5">
                  {turno.resumenMedios.EFECTIVO.transacciones} op.
                </div>
              </div>
              <div className="bg-white border border-[#BECABE] rounded-xl p-4">
                <div className="flex items-center justify-between text-xs font-semibold text-[#6F7A70]">
                  <span>Visa</span>
                  <CreditCard className="w-4 h-4 text-[#005DB7]" />
                </div>
                <div className="text-lg font-bold font-data-mono tabular-nums text-[#181D19] mt-1">
                  {formatPen(turno.resumenMedios.VISA.totalCentimos)}
                </div>
                <div className="text-[11px] text-[#6F7A70] mt-0.5">
                  {turno.resumenMedios.VISA.transacciones} op.
                </div>
              </div>
              <div className="bg-white border border-[#BECABE] rounded-xl p-4">
                <div className="flex items-center justify-between text-xs font-semibold text-[#6F7A70]">
                  <span>Mastercard</span>
                  <CreditCard className="w-4 h-4 text-[#3F4941]" />
                </div>
                <div className="text-lg font-bold font-data-mono tabular-nums text-[#181D19] mt-1">
                  {formatPen(turno.resumenMedios.MASTERCARD.totalCentimos)}
                </div>
                <div className="text-[11px] text-[#6F7A70] mt-0.5">
                  {turno.resumenMedios.MASTERCARD.transacciones} op.
                </div>
              </div>
              <div className="bg-white border border-[#BECABE] rounded-xl p-4">
                <div className="flex items-center justify-between text-xs font-semibold text-[#6F7A70]">
                  <span>Transf. / Yape</span>
                  <Smartphone className="w-4 h-4 text-[#006A3B]" />
                </div>
                <div className="text-lg font-bold font-data-mono tabular-nums text-[#181D19] mt-1">
                  {formatPen(turno.resumenMedios.TRANSFERENCIA_YAPE.totalCentimos)}
                </div>
                <div className="text-[11px] text-[#6F7A70] mt-0.5">
                  {turno.resumenMedios.TRANSFERENCIA_YAPE.transacciones} op.
                </div>
              </div>
            </div>

            {/* Últimas transacciones del turno */}
            <section className="bg-white border border-[#BECABE] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#181D19]">
                  Últimas transacciones — {turno.codigoTurno}
                </h2>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    isShiftOpen
                      ? 'bg-emerald-50 text-[#006A3B]'
                      : 'bg-slate-100 text-[#3F4941]'
                  }`}
                >
                  {turno.estado}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                    <tr>
                      <th className="px-3 py-2">Ticket</th>
                      <th className="px-3 py-2">Hora</th>
                      <th className="px-3 py-2">Medio</th>
                      <th className="px-3 py-2 text-right">Monto</th>
                      <th className="px-3 py-2 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data?.ultimasTransacciones.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-[#6F7A70]">
                          Sin ventas registradas en este turno.
                        </td>
                      </tr>
                    ) : (
                      data?.ultimasTransacciones.map((tx) => (
                        <tr key={tx.ventaId}>
                          <td className="px-3 py-2 font-data-mono font-bold">{tx.numeroTicket}</td>
                          <td className="px-3 py-2 font-data-mono">{tx.hora}</td>
                          <td className="px-3 py-2">{tx.medioPago}</td>
                          <td className="px-3 py-2 text-right font-data-mono tabular-nums font-bold">
                            {formatPen(tx.montoCentimos)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                tx.estado === 'COMPLETADA'
                                  ? 'bg-emerald-50 text-[#006A3B]'
                                  : 'bg-[#FFDAD6] text-[#93000A]'
                              }`}
                            >
                              {tx.estado}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Movimientos de caja (Ingresos / Retiros / Devoluciones) */}
            <section className="bg-white border border-[#BECABE] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200">
                <h2 className="text-sm font-bold text-[#181D19]">
                  Movimientos manuales y devoluciones en efectivo
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                    <tr>
                      <th className="px-3 py-2">Fecha/Hora</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2">Motivo</th>
                      <th className="px-3 py-2 text-right">Monto</th>
                      <th className="px-3 py-2">Usuario</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data?.movimientosCaja.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-5 text-center text-[#6F7A70]">
                          Sin ingresos, retiros ni devoluciones registradas.
                        </td>
                      </tr>
                    ) : (
                      data?.movimientosCaja.map((m) => (
                        <tr key={m.movimientoCajaId}>
                          <td className="px-3 py-2 font-data-mono">
                            {formatLimaDateTime(m.creadoEn)}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                m.tipo === 'INGRESO'
                                  ? 'bg-emerald-50 text-[#006A3B]'
                                  : 'bg-[#FFDAD6] text-[#93000A]'
                              }`}
                            >
                              {m.tipo}
                            </span>
                          </td>
                          <td className="px-3 py-2">{m.motivo}</td>
                          <td className="px-3 py-2 text-right font-data-mono font-bold">
                            {m.tipo === 'INGRESO' ? '+' : '-'}
                            {formatPen(m.montoCentimos)}
                          </td>
                          <td className="px-3 py-2">{m.usuarioNombre}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Columna derecha: Conciliación y cierre */}
          <div className="col-span-12 xl:col-span-4 space-y-5">
            <section className="bg-white border border-[#BECABE] rounded-xl p-5 space-y-4">
              <h2 className="text-base font-bold text-[#181D19] border-b border-slate-100 pb-2.5">
                Conciliación de efectivo
              </h2>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#6F7A70]">Fondo inicial</span>
                  <span className="font-data-mono font-semibold">
                    {formatPen(turno.fondoInicialCentimos)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6F7A70]">+ Cobros en efectivo</span>
                  <span className="font-data-mono font-semibold">
                    {formatPen(
                      turno.efectivoTeoricoCentimos -
                        turno.fondoInicialCentimos -
                        turno.ingresosEfectivoCentimos +
                        turno.retirosEfectivoCentimos +
                        turno.devolucionesEfectivoCentimos
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-[#006A3B]">
                  <span>+ Ingresos manuales</span>
                  <span className="font-data-mono font-semibold">
                    {formatPen(turno.ingresosEfectivoCentimos)}
                  </span>
                </div>
                <div className="flex justify-between text-[#973F4C]">
                  <span>- Retiros de caja</span>
                  <span className="font-data-mono font-semibold">
                    -{formatPen(turno.retirosEfectivoCentimos)}
                  </span>
                </div>
                <div className="flex justify-between text-[#BA1A1A]">
                  <span>- Devoluciones en efectivo</span>
                  <span className="font-data-mono font-semibold">
                    -{formatPen(turno.devolucionesEfectivoCentimos)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between items-baseline">
                  <span className="font-bold text-[#181D19]">Efectivo teórico en caja</span>
                  <span className="text-lg font-extrabold font-data-mono text-[#006A3B]">
                    {formatPen(turno.efectivoTeoricoCentimos)}
                  </span>
                </div>
              </div>

              {isShiftOpen ? (
                <div className="space-y-3 pt-2 border-t border-slate-100 text-xs">
                  <div>
                    <label
                      htmlFor="efectivo-contado"
                      className="block font-bold text-[#3F4941] mb-1"
                    >
                      Efectivo real contado (S/)
                    </label>
                    <input
                      id="efectivo-contado"
                      type="number"
                      step="0.01"
                      min="0"
                      value={countedCashStr}
                      onChange={(e) => setCountedCashStr(e.target.value)}
                      className="w-full px-3 py-2.5 border border-[#BECABE] rounded-md font-data-mono text-base font-bold"
                    />
                  </div>

                  <div
                    className={`p-3 rounded-lg border flex items-center justify-between ${
                      diferenciaPreview === 0
                        ? 'bg-emerald-50 border-emerald-200 text-[#006A3B]'
                        : 'bg-[#FFDAD6]/60 border-[#BA1A1A]/30 text-[#93000A]'
                    }`}
                  >
                    <span className="font-bold">Diferencia (Contado - Teórico)</span>
                    <span className="font-data-mono font-extrabold text-sm">
                      {diferenciaPreview >= 0 ? '+' : ''}
                      {formatPen(diferenciaPreview)}
                    </span>
                  </div>

                  {diferenciaPreview !== 0 && (
                    <div>
                      <label className="block font-bold text-[#93000A] mb-1">
                        Motivo de descuadre (obligatorio) *
                      </label>
                      <textarea
                        rows={2}
                        value={motivoDescuadre}
                        onChange={(e) => setMotivoDescuadre(e.target.value)}
                        placeholder="Explique la causa del sobrante o faltante..."
                        className="w-full px-3 py-2 border border-[#BA1A1A]/50 rounded-md"
                      />
                    </div>
                  )}

                  {closeError && (
                    <div className="p-2 bg-[#FFDAD6] text-[#93000A] rounded font-semibold">
                      {closeError}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={!canClose}
                    onClick={() => {
                      setCloseError(null);
                      setConfirmCloseOpen(true);
                    }}
                    className="w-full py-3 bg-[#006A3B] hover:bg-[#00522D] disabled:opacity-50 text-white font-bold rounded-lg text-sm flex items-center justify-center gap-2"
                  >
                    <Lock className="w-4 h-4" />
                    <span>Cerrar turno y emitir Reporte Z</span>
                  </button>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[#6F7A70]">Efectivo contado al cierre:</span>
                    <span className="font-data-mono font-bold">
                      {formatPen(turno.efectivoContadoCentimos || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6F7A70]">Diferencia final:</span>
                    <span className="font-data-mono font-bold">
                      {formatPen(turno.diferenciaCentimos || 0)}
                    </span>
                  </div>
                  {turno.motivoDescuadre && (
                    <div className="text-[11px] text-[#3F4941] pt-1">
                      Motivo: {turno.motivoDescuadre}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* Banda resumen inferior */}
      {turno && (
        <div className="bg-white border border-[#BECABE] rounded-xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs no-print">
          <div>
            <div className="text-[#6F7A70]">Ventas Brutas</div>
            <div className="font-data-mono font-bold text-sm">
              {formatPen(turno.totalBrutoCentimos)}
            </div>
          </div>
          <div>
            <div className="text-[#6F7A70]">Descuentos / Anul.</div>
            <div className="font-data-mono font-bold text-sm text-[#973F4C]">
              {formatPen(turno.totalDescuentosCentimos + turno.totalAnulacionesCentimos)}
            </div>
          </div>
          <div>
            <div className="text-[#6F7A70]">IGV Neto</div>
            <div className="font-data-mono font-bold text-sm">
              {formatPen(turno.totalIgvCentimos)}
            </div>
          </div>
          <div>
            <div className="text-[#6F7A70]">Ventas Netas</div>
            <div className="font-data-mono font-bold text-sm text-[#006A3B]">
              {formatPen(turno.totalNetoCentimos)}
            </div>
          </div>
          <div>
            <div className="text-[#6F7A70]">Apertura</div>
            <div className="font-semibold truncate">{turno.usuarioAperturaNombre}</div>
          </div>
        </div>
      )}

      {/* Historial de turnos cerrados */}
      {data && data.turnosCerrados.length > 0 && (
        <section className="bg-white border border-[#BECABE] rounded-xl overflow-hidden no-print">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-bold text-[#181D19]">Turnos cerrados (Reportes Z inmutables)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                <tr>
                  <th className="px-3 py-2">Turno</th>
                  <th className="px-3 py-2">Cierre</th>
                  <th className="px-3 py-2">Cerrado por</th>
                  <th className="px-3 py-2 text-right">Teórico</th>
                  <th className="px-3 py-2 text-right">Contado</th>
                  <th className="px-3 py-2 text-right">Diferencia</th>
                  <th className="px-3 py-2 text-right">Neto Turno</th>
                  <th className="px-3 py-2 text-center">Reporte Z</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.turnosCerrados.map((tc) => (
                  <tr key={tc.turnoId}>
                    <td className="px-3 py-2 font-data-mono font-bold">{tc.codigoTurno}</td>
                    <td className="px-3 py-2 font-data-mono">{formatLimaDateTime(tc.fechaCierre)}</td>
                    <td className="px-3 py-2">{tc.usuarioCierreNombre}</td>
                    <td className="px-3 py-2 text-right font-data-mono">
                      {formatPen(tc.efectivoTeoricoCentimos)}
                    </td>
                    <td className="px-3 py-2 text-right font-data-mono">
                      {formatPen(tc.efectivoContadoCentimos)}
                    </td>
                    <td className="px-3 py-2 text-right font-data-mono font-bold">
                      {formatPen(tc.diferenciaCentimos)}
                    </td>
                    <td className="px-3 py-2 text-right font-data-mono font-bold text-[#006A3B]">
                      {formatPen(tc.totalNetoCentimos)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => openReportModal(tc.turnoId)}
                        className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 font-semibold"
                      >
                        Ver Z
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Modal Movimiento de Caja */}
      {movModalOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-label="Registrar movimiento de caja"
        >
          <div className="bg-white rounded-xl border border-[#BECABE] max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-[#181D19]">Movimiento de caja en efectivo</h2>
              <button type="button" onClick={() => setMovModalOpen(false)} aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleAddCashMovement} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMovTipo('INGRESO')}
                  className={`py-2 rounded-lg border font-bold flex items-center justify-center gap-1.5 ${
                    movTipo === 'INGRESO'
                      ? 'bg-emerald-50 border-[#006A3B] text-[#006A3B]'
                      : 'border-slate-200'
                  }`}
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  <span>Ingreso</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMovTipo('RETIRO')}
                  className={`py-2 rounded-lg border font-bold flex items-center justify-center gap-1.5 ${
                    movTipo === 'RETIRO'
                      ? 'bg-[#FFDAD6] border-[#BA1A1A] text-[#93000A]'
                      : 'border-slate-200'
                  }`}
                >
                  <ArrowDownCircle className="w-4 h-4" />
                  <span>Retiro</span>
                </button>
              </div>
              <div>
                <label className="block font-semibold mb-1">Monto (S/) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.10"
                  required
                  value={movMontoStr}
                  onChange={(e) => setMovMontoStr(e.target.value)}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Motivo autorizado *</label>
                <input
                  type="text"
                  required
                  value={movMotivo}
                  onChange={(e) => setMovMotivo(e.target.value)}
                  placeholder="Ej. Sencillo adicional / Pago movilidad"
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMovModalOpen(false)}
                  className="px-4 py-2 border border-[#BECABE] rounded-md font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={movSaving}
                  className="px-4 py-2 bg-[#006A3B] text-white rounded-md font-bold"
                >
                  {movSaving ? 'Guardando...' : 'Registrar movimiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmación Cierre de Turno */}
      {confirmCloseOpen && turno && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar cierre de turno"
        >
          <div className="bg-white rounded-xl border border-[#BECABE] max-w-md w-full p-5 space-y-4">
            <div className="flex items-center gap-2 text-base font-bold text-[#181D19]">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <span>¿Confirmar cierre de turno {turno.codigoTurno}?</span>
            </div>
            <p className="text-xs text-[#3F4941] leading-relaxed">
              Al cerrar el turno se emitirá el Reporte Z definitivo y los importes quedarán inmutables. El POS bloqueará nuevos cobros hasta abrir un nuevo turno.
            </p>
            <div className="p-3 bg-[#F6FBF3] border border-[#BECABE] rounded-lg text-xs space-y-1">
              <div className="flex justify-between">
                <span>Efectivo teórico:</span>
                <span className="font-data-mono font-bold">
                  {formatPen(turno.efectivoTeoricoCentimos)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Efectivo contado:</span>
                <span className="font-data-mono font-bold">{formatPen(contadoCentimos)}</span>
              </div>
              <div className="flex justify-between">
                <span>Diferencia:</span>
                <span className="font-data-mono font-bold">{formatPen(diferenciaPreview)}</span>
              </div>
            </div>
            {closeError && (
              <div className="p-2 bg-[#FFDAD6] text-[#93000A] text-xs font-semibold rounded">
                {closeError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCloseOpen(false)}
                className="px-4 py-2 border border-[#BECABE] rounded-md text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={closingShift}
                onClick={handleConfirmClose}
                className="px-4 py-2 bg-[#006A3B] text-white rounded-md text-xs font-bold"
              >
                {closingShift ? 'Cerrando...' : 'Sí, cerrar turno'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Reporte Parcial / Z Imprimible */}
      {reporteModal && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reporte de caja"
        >
          <div className="bg-white rounded-xl border border-[#BECABE] max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 no-print">
              <h2 className="text-sm font-bold text-[#181D19]">
                {reporteModal.esParcial ? 'Reporte Parcial de Caja (X)' : 'Reporte de Cierre (Z)'}
              </h2>
              <button type="button" onClick={() => setReporteModal(null)} aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="font-data-mono text-xs space-y-2 border border-dashed border-slate-300 p-4 rounded">
              <div className="text-center font-bold">
                <div>{reporteModal.sucursalNombre}</div>
                <div>RUC: {reporteModal.sucursalRuc}</div>
                <div className="mt-1">
                  {reporteModal.esParcial ? 'CORTE PARCIAL DE CAJA' : 'REPORTE Z DE CIERRE DE TURNO'}
                </div>
                <div>Turno: {reporteModal.codigoTurno}</div>
              </div>
              <div className="border-t border-dashed border-slate-300 pt-2 space-y-1">
                <div>Apertura: {formatLimaDateTime(reporteModal.fechaApertura)}</div>
                {reporteModal.fechaCierre && (
                  <div>Cierre: {formatLimaDateTime(reporteModal.fechaCierre)}</div>
                )}
                <div>Cajero Apertura: {reporteModal.usuarioAperturaNombre}</div>
                {reporteModal.usuarioCierreNombre && (
                  <div>Cajero Cierre: {reporteModal.usuarioCierreNombre}</div>
                )}
              </div>
              <div className="border-t border-dashed border-slate-300 pt-2 space-y-1">
                <div className="flex justify-between">
                  <span>Efectivo:</span>
                  <span>{formatPen(reporteModal.resumenMedios?.EFECTIVO?.totalCentimos)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Visa:</span>
                  <span>{formatPen(reporteModal.resumenMedios?.VISA?.totalCentimos)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Mastercard:</span>
                  <span>{formatPen(reporteModal.resumenMedios?.MASTERCARD?.totalCentimos)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Transf./Yape:</span>
                  <span>
                    {formatPen(reporteModal.resumenMedios?.TRANSFERENCIA_YAPE?.totalCentimos)}
                  </span>
                </div>
              </div>
              <div className="border-t border-dashed border-slate-300 pt-2 space-y-1">
                <div className="flex justify-between">
                  <span>Fondo Inicial:</span>
                  <span>{formatPen(reporteModal.fondoInicialCentimos)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Efectivo Teórico:</span>
                  <span>{formatPen(reporteModal.efectivoTeoricoCentimos)}</span>
                </div>
                {reporteModal.efectivoContadoCentimos !== null && (
                  <>
                    <div className="flex justify-between">
                      <span>Efectivo Contado:</span>
                      <span>{formatPen(reporteModal.efectivoContadoCentimos)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Diferencia:</span>
                      <span>{formatPen(reporteModal.diferenciaCentimos)}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="border-t border-dashed border-slate-300 pt-2 space-y-1">
                <div className="flex justify-between">
                  <span>Ventas Brutas:</span>
                  <span>{formatPen(reporteModal.totalBrutoCentimos)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Anulaciones:</span>
                  <span>{formatPen(reporteModal.totalAnulacionesCentimos)}</span>
                </div>
                <div className="flex justify-between">
                  <span>IGV Neto:</span>
                  <span>{formatPen(reporteModal.totalIgvCentimos)}</span>
                </div>
                <div className="flex justify-between font-bold text-sm">
                  <span>Total Neto:</span>
                  <span>{formatPen(reporteModal.totalNetoCentimos)}</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 bg-[#006A3B] text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir reporte</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
