import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BarChart2,
  CheckCircle2,
  FileDown,
  MapPin,
  Printer,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { apiDownloadFile, apiFetch } from '../lib/api';
import type { AuthUser, LotRow, ProductRow } from '../types/erp';

interface KardexViewProps {
  user: AuthUser;
  selectedProductId: string | null;
  onSelectProductId: (id: string) => void;
  onBackToInventory: () => void;
}

interface KardexResponse {
  producto: {
    productoId: string;
    sku: string;
    nombre: string;
    principioActivo: string;
    concentracion: string;
    presentacion: string;
    laboratorio: string;
    registroSanitario: string | null;
    condicionVenta: 'OTC' | 'RECETA';
    ubicacionPasillo: string | null;
    ubicacionEstante: string | null;
    temperaturaAlmacen: string | null;
    stockFisico: number;
    stockDisponible: number;
  };
  saldoArrastre: number;
  movimientos: Array<{
    movimientoId: number;
    tipo: string;
    documentoRef: string;
    numeroLote: string;
    loteId: string;
    cantidadEntrada: number;
    cantidadSalida: number;
    saldoResultante: number;
    costoUnitarioCentimos: number;
    motivo: string | null;
    responsableUsername: string;
    fechaHora: string;
  }>;
  rotacionMensual: Array<{ mes: string; unidades: number }>;
  promedioMensual: number;
}

export function KardexView({
  user,
  selectedProductId,
  onSelectProductId,
  onBackToInventory,
}: KardexViewProps) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [kardex, setKardex] = useState<KardexResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('TODOS');

  // Ajuste autorizado modal
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [adjustLotId, setAdjustLotId] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('0');
  const [adjustMotivo, setAdjustMotivo] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustSaving, setAdjustSaving] = useState(false);

  const canAdjust = user.permisos.includes('inventario.ajustar');

  useEffect(() => {
    apiFetch<{ items: ProductRow[] }>('/api/productos?pageSize=200')
      .then((res) => {
        setProducts(res.items);
        if (!selectedProductId && res.items.length > 0) {
          onSelectProductId(res.items[0].productoId);
        }
      })
      .catch(() => {});
  }, []);

  const loadKardex = async (prodId: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (fechaDesde) qs.set('fechaDesde', fechaDesde);
      if (fechaHasta) qs.set('fechaHasta', fechaHasta);
      if (tipoFiltro !== 'TODOS') qs.set('tipo', tipoFiltro);
      const res = await apiFetch<KardexResponse>(
        `/api/kardex/${prodId}${qs.toString() ? `?${qs.toString()}` : ''}`
      );
      setKardex(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el Kardex.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProductId) {
      loadKardex(selectedProductId);
    } else {
      setLoading(false);
    }
  }, [selectedProductId, fechaDesde, fechaHasta, tipoFiltro]);

  const handleExportPdf = async () => {
    if (!selectedProductId || !kardex) return;
    try {
      const qs = new URLSearchParams();
      if (fechaDesde) qs.set('fechaDesde', fechaDesde);
      if (fechaHasta) qs.set('fechaHasta', fechaHasta);
      if (tipoFiltro !== 'TODOS') qs.set('tipo', tipoFiltro);
      await apiDownloadFile(
        `/api/kardex/${selectedProductId}/pdf${qs.toString() ? `?${qs.toString()}` : ''}`,
        `kardex_${kardex.producto.sku}.pdf`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error descargando PDF.');
    }
  };

  const openAdjustModal = async () => {
    if (!selectedProductId) return;
    setAdjustError(null);
    setAdjustDelta('0');
    setAdjustMotivo('');
    setAdjustOpen(true);
    try {
      const res = await apiFetch<{ lotes: LotRow[] }>(`/api/productos/${selectedProductId}/lotes`);
      setLots(res.lotes);
      if (res.lotes.length > 0) setAdjustLotId(res.lotes[0].loteId);
    } catch {
      setLots([]);
    }
  };

  const submitAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId || !adjustLotId) return;
    setAdjustError(null);
    const delta = Math.trunc(Number(adjustDelta || 0));
    if (delta === 0 || !adjustMotivo.trim()) {
      setAdjustError('Ingrese una variación distinta de cero y el motivo del ajuste.');
      return;
    }
    setAdjustSaving(true);
    try {
      await apiFetch('/api/inventario/ajuste', {
        method: 'POST',
        body: JSON.stringify({
          productoId: selectedProductId,
          loteId: adjustLotId,
          deltaCantidad: delta,
          motivo: adjustMotivo.trim(),
        }),
      });
      setAdjustOpen(false);
      setFeedback('Ajuste registrado en Kardex.');
      await loadKardex(selectedProductId);
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'Error aplicando ajuste.');
    } finally {
      setAdjustSaving(false);
    }
  };

  const maxRot = Math.max(1, ...(kardex?.rotacionMensual.map((r) => r.unidades) || [1]));

  return (
    <div className="space-y-4">
      {/* Encabezado y Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#6F7A70] mb-1">
            <button
              type="button"
              onClick={onBackToInventory}
              className="hover:text-[#006A3B] font-semibold inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Inventario</span>
            </button>
            <span>/</span>
            <span className="text-[#006A3B] font-semibold">Kardex de Producto</span>
          </div>
          <h1 className="text-xl font-bold text-[#181D19]">Kardex Valorizado y Físico por Lote</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Seleccionar producto"
            value={selectedProductId || ''}
            onChange={(e) => onSelectProductId(e.target.value)}
            className="px-3 py-2 border border-[#BECABE] rounded-lg text-xs bg-white font-semibold max-w-xs"
          >
            {products.map((p) => (
              <option key={p.productoId} value={p.productoId}>
                {p.sku} — {p.nombre}
              </option>
            ))}
          </select>

          {canAdjust && selectedProductId && (
            <button
              type="button"
              onClick={openAdjustModal}
              className="px-3 py-2 border border-[#BECABE] bg-white hover:bg-slate-50 text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
            >
              <SlidersHorizontal className="w-4 h-4 text-[#005DB7]" />
              <span>Ajustar stock</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-2 border border-[#BECABE] bg-white hover:bg-slate-50 text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            <span>Imprimir</span>
          </button>
          <button
            type="button"
            disabled={!kardex}
            onClick={handleExportPdf}
            className="px-3.5 py-2 bg-[#006A3B] hover:bg-[#00522D] disabled:opacity-50 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
          >
            <FileDown className="w-4 h-4" />
            <span>Exportar PDF</span>
          </button>
        </div>
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
        <div className="p-4 bg-[#FFDAD6] text-[#93000A] text-xs font-semibold rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-10 bg-white border border-[#BECABE] rounded-xl text-center text-xs text-[#6F7A70]">
          Cargando ficha técnica y movimientos de Kardex...
        </div>
      ) : !kardex ? (
        <div className="p-10 bg-white border border-[#BECABE] rounded-xl text-center text-xs text-[#6F7A70]">
          Seleccione un producto desde el selector o desde Inventario para consultar su Kardex.
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-5">
          {/* Columna izquierda: Ficha Técnica, Stock, Rotación, Ubicación */}
          <div className="col-span-12 lg:col-span-4 space-y-4">
            <section className="bg-white border border-[#BECABE] rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <span className="text-[11px] font-data-mono font-bold text-[#006A3B]">
                    SKU {kardex.producto.sku}
                  </span>
                  <h2 className="text-base font-bold text-[#181D19] mt-0.5">
                    {kardex.producto.nombre}
                  </h2>
                  <p className="text-xs text-[#6F7A70]">{kardex.producto.principioActivo}</p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                    kardex.producto.condicionVenta === 'RECETA'
                      ? 'bg-blue-50 text-[#005DB7]'
                      : 'bg-emerald-50 text-[#006A3B]'
                  }`}
                >
                  {kardex.producto.condicionVenta === 'RECETA' ? 'Con Receta' : 'Venta Libre OTC'}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-y-2.5 gap-x-3 text-xs">
                <div>
                  <dt className="text-[#6F7A70]">Presentación</dt>
                  <dd className="font-semibold text-[#181D19]">{kardex.producto.presentacion}</dd>
                </div>
                <div>
                  <dt className="text-[#6F7A70]">Concentración</dt>
                  <dd className="font-semibold text-[#181D19]">{kardex.producto.concentracion}</dd>
                </div>
                <div>
                  <dt className="text-[#6F7A70]">Laboratorio</dt>
                  <dd className="font-semibold text-[#181D19]">{kardex.producto.laboratorio}</dd>
                </div>
                <div>
                  <dt className="text-[#6F7A70]">Reg. Sanitario</dt>
                  <dd className="font-data-mono font-semibold text-[#181D19]">
                    {kardex.producto.registroSanitario || 'No registrado'}
                  </dd>
                </div>
              </dl>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                <div className="p-2.5 bg-[#F6FBF3] border border-emerald-200 rounded-lg">
                  <div className="text-[10px] font-bold text-[#6F7A70] uppercase">
                    Stock Físico
                  </div>
                  <div className="text-lg font-extrabold font-data-mono text-[#181D19]">
                    {kardex.producto.stockFisico} und
                  </div>
                </div>
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="text-[10px] font-bold text-[#006A3B] uppercase">
                    Disponible Venta
                  </div>
                  <div className="text-lg font-extrabold font-data-mono text-[#006A3B]">
                    {kardex.producto.stockDisponible} und
                  </div>
                </div>
              </div>
            </section>

            {/* Rotación Mensual */}
            <section className="bg-white border border-[#BECABE] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#181D19] uppercase flex items-center gap-1.5">
                  <BarChart2 className="w-4 h-4 text-[#006A3B]" />
                  <span>Rotación mensual (salidas)</span>
                </h3>
                <span className="text-xs font-bold font-data-mono text-[#006A3B]">
                  Prom: {kardex.promedioMensual} u/mes
                </span>
              </div>
              {kardex.rotacionMensual.length === 0 ? (
                <p className="text-xs text-[#6F7A70] py-4 text-center">
                  Sin salidas por venta registradas en los últimos meses.
                </p>
              ) : (
                <div className="flex items-end gap-2 h-28 pt-2">
                  {kardex.rotacionMensual.map((r) => {
                    const pct = Math.max(12, Math.round((r.unidades / maxRot) * 100));
                    return (
                      <div key={r.mes} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-[10px] font-data-mono font-bold text-[#181D19]">
                          {r.unidades}
                        </span>
                        <div className="w-full bg-slate-100 rounded-t h-16 flex items-end">
                          <div
                            className="w-full bg-[#006A3B] rounded-t"
                            style={{ height: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-data-mono text-[#6F7A70]">
                          {r.mes.slice(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Ubicación y Almacenamiento */}
            <section className="bg-white border border-[#BECABE] rounded-xl p-4 space-y-2 text-xs">
              <h3 className="text-xs font-bold text-[#181D19] uppercase flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-[#005DB7]" />
                <span>Ubicación y almacenamiento</span>
              </h3>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <span className="text-[#6F7A70]">Pasillo / Estante:</span>
                  <div className="font-semibold text-[#181D19]">
                    {kardex.producto.ubicacionPasillo || '-'} /{' '}
                    {kardex.producto.ubicacionEstante || '-'}
                  </div>
                </div>
                <div>
                  <span className="text-[#6F7A70]">Almacenamiento:</span>
                  <div className="font-semibold text-[#181D19]">
                    {kardex.producto.temperaturaAlmacen || 'No especificado'}
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Columna derecha: Historial de movimientos */}
          <div className="col-span-12 lg:col-span-8 space-y-4">
            <div className="bg-white border border-[#BECABE] rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 no-print">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="font-semibold text-[#3F4941]">Desde:</label>
                <input
                  type="date"
                  value={fechaDesde}
                  onChange={(e) => setFechaDesde(e.target.value)}
                  className="px-2.5 py-1.5 border border-[#BECABE] rounded font-data-mono"
                />
                <label className="font-semibold text-[#3F4941]">Hasta:</label>
                <input
                  type="date"
                  value={fechaHasta}
                  onChange={(e) => setFechaHasta(e.target.value)}
                  className="px-2.5 py-1.5 border border-[#BECABE] rounded font-data-mono"
                />
                <select
                  aria-label="Filtrar por tipo de movimiento"
                  value={tipoFiltro}
                  onChange={(e) => setTipoFiltro(e.target.value)}
                  className="px-2.5 py-1.5 border border-[#BECABE] rounded bg-white"
                >
                  <option value="TODOS">Todos los tipos</option>
                  <option value="COMPRA">Compra / Recepción</option>
                  <option value="VENTA">Venta POS</option>
                  <option value="AJUSTE_ENTRADA">Ajuste Entrada</option>
                  <option value="AJUSTE_SALIDA">Ajuste Salida</option>
                  <option value="ANULACION_ENTRADA">Devolución por Anulación</option>
                </select>
              </div>
              <div className="px-3 py-1.5 bg-[#F0F5EE] border border-[#BECABE] rounded text-xs">
                <span className="text-[#6F7A70]">Saldo de arrastre previo: </span>
                <span className="font-bold font-data-mono text-[#006A3B]">
                  {kardex.saldoArrastre} und
                </span>
              </div>
            </div>

            <div className="bg-white border border-[#BECABE] rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-[560px] custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase z-10">
                    <tr>
                      <th className="px-3 py-2.5">Fecha y Hora</th>
                      <th className="px-3 py-2.5">Tipo</th>
                      <th className="px-3 py-2.5">Documento</th>
                      <th className="px-3 py-2.5">Lote</th>
                      <th className="px-3 py-2.5 text-right">Entrada</th>
                      <th className="px-3 py-2.5 text-right">Salida</th>
                      <th className="px-3 py-2.5 text-right">Saldo</th>
                      <th className="px-3 py-2.5">Responsable</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {kardex.movimientos.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-[#6F7A70]">
                          Sin movimientos en el rango seleccionado.
                        </td>
                      </tr>
                    ) : (
                      kardex.movimientos.map((m) => (
                        <tr key={m.movimientoId} className="hover:bg-slate-50">
                          <td className="px-3 py-2.5 font-data-mono whitespace-nowrap">
                            {m.fechaHora}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                m.cantidadEntrada > 0
                                  ? 'bg-emerald-50 text-[#006A3B]'
                                  : 'bg-blue-50 text-[#005DB7]'
                              }`}
                            >
                              {m.tipo}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-data-mono font-semibold">
                            {m.documentoRef}
                          </td>
                          <td className="px-3 py-2.5 font-data-mono">{m.numeroLote}</td>
                          <td className="px-3 py-2.5 text-right font-data-mono tabular-nums font-bold text-[#006A3B]">
                            {m.cantidadEntrada > 0 ? `+${m.cantidadEntrada}` : '-'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-data-mono tabular-nums font-bold text-[#973F4C]">
                            {m.cantidadSalida > 0 ? `-${m.cantidadSalida}` : '-'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-data-mono tabular-nums font-extrabold text-[#181D19]">
                            {m.saldoResultante}
                          </td>
                          <td className="px-3 py-2.5 text-[#3F4941]">{m.responsableUsername}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ajuste desde Kardex */}
      {adjustOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-label="Ajuste autorizado de stock"
        >
          <div className="bg-white rounded-xl border border-[#BECABE] max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-[#181D19]">Ajuste autorizado en Kardex</h2>
              <button type="button" onClick={() => setAdjustOpen(false)} aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            {adjustError && (
              <div className="p-2.5 bg-[#FFDAD6] text-[#93000A] text-xs font-semibold rounded">
                {adjustError}
              </div>
            )}
            <form onSubmit={submitAdjust} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Lote *</label>
                <select
                  value={adjustLotId}
                  onChange={(e) => setAdjustLotId(e.target.value)}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md bg-white font-data-mono"
                >
                  {lots.map((l) => (
                    <option key={l.loteId} value={l.loteId}>
                      {l.numeroLote} (Físico: {l.cantidadFisica} / Estado: {l.estadoAptitud})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Variación (+/-) *</label>
                <input
                  type="number"
                  required
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(e.target.value)}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Motivo obligatorio *</label>
                <input
                  type="text"
                  required
                  value={adjustMotivo}
                  onChange={(e) => setAdjustMotivo(e.target.value)}
                  placeholder="Ej. Corrección por inventario físico"
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustOpen(false)}
                  className="px-4 py-2 border border-[#BECABE] rounded-md font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={adjustSaving}
                  className="px-4 py-2 bg-[#006A3B] text-white rounded-md font-bold"
                >
                  {adjustSaving ? 'Guardando...' : 'Confirmar ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
