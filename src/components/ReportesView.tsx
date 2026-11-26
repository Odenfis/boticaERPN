import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  FileDown,
  FileSpreadsheet,
  Info,
  TrendingUp,
  Users,
} from 'lucide-react';
import { apiDownloadFile, apiFetch } from '../lib/api';
import { firstDayOfMonthLimaIso, formatPen, todayLimaIso } from '../lib/format';
import type { AuthUser, ReportsData } from '../types/erp';

interface ReportesViewProps {
  user: AuthUser;
  globalSearch: string;
}

export function ReportesView({ user, globalSearch }: ReportesViewProps) {
  const [fechaDesde, setFechaDesde] = useState(firstDayOfMonthLimaIso);
  const [fechaHasta, setFechaHasta] = useState(todayLimaIso);
  const [agrupacion, setAgrupacion] = useState<'diario' | 'semanal' | 'mensual'>('diario');
  const [vendedorId, setVendedorId] = useState('TODOS');
  const [medioPago, setMedioPago] = useState('TODOS');

  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);

  const canExport = user.permisos.includes('reportes.exportar');

  const buildQuery = () => {
    const qs = new URLSearchParams({
      fechaDesde,
      fechaHasta,
      agrupacion,
      vendedorId,
      medioPago,
    });
    return qs.toString();
  };

  const loadReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ReportsData>(`/api/reportes?${buildQuery()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando reportes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, [fechaDesde, fechaHasta, agrupacion, vendedorId, medioPago]);

  const handleExport = async (kind: 'pdf' | 'excel') => {
    setExporting(kind);
    setError(null);
    try {
      const url = `/api/reportes/export/${kind}?${buildQuery()}`;
      const ext = kind === 'pdf' ? 'pdf' : 'xlsx';
      await apiDownloadFile(url, `reporte_botica_${fechaDesde}_${fechaHasta}.${ext}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar el reporte.');
    } finally {
      setExporting(null);
    }
  };

  const maxSerie = Math.max(
    1,
    ...(data?.serieTemporal.map((s) => Math.max(s.ventasBrutasCentimos, s.ventasNetasCentimos)) || [1])
  );

  const q = globalSearch.trim().toLowerCase();
  const filteredTopProductos = (data?.topProductos || []).filter(
    (p) => !q || p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
  );
  const filteredVendedores = (data?.porVendedor || []).filter(
    (v) => !q || v.nombreCompleto.toLowerCase().includes(q)
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#181D19]">Reportes de Sistema y Analítica</h1>
          <p className="text-xs text-[#6F7A70] mt-0.5">
            Consolidado de ventas brutas, netas, ranking de productos y desempeño por vendedor.
          </p>
        </div>

        {canExport && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={exporting !== null || !data}
              onClick={() => handleExport('pdf')}
              className="px-3.5 py-2 border border-[#BECABE] bg-white hover:bg-slate-50 disabled:opacity-50 text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
            >
              <FileDown className="w-4 h-4 text-[#973F4C]" />
              <span>{exporting === 'pdf' ? 'Generando PDF...' : 'Exportar PDF'}</span>
            </button>
            <button
              type="button"
              disabled={exporting !== null || !data}
              onClick={() => handleExport('excel')}
              className="px-3.5 py-2 bg-[#006A3B] hover:bg-[#00522D] disabled:opacity-50 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>{exporting === 'excel' ? 'Generando Excel...' : 'Exportar Excel'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-[#BECABE] rounded-xl p-4 flex flex-wrap items-end gap-3 text-xs">
        <div>
          <label className="block font-semibold text-[#3F4941] mb-1">Fecha desde</label>
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            className="px-3 py-1.5 border border-[#BECABE] rounded-md font-data-mono"
          />
        </div>
        <div>
          <label className="block font-semibold text-[#3F4941] mb-1">Fecha hasta</label>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            className="px-3 py-1.5 border border-[#BECABE] rounded-md font-data-mono"
          />
        </div>
        <div>
          <label className="block font-semibold text-[#3F4941] mb-1">Agrupación</label>
          <div className="flex border border-[#BECABE] rounded-md overflow-hidden">
            {(['diario', 'semanal', 'mensual'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setAgrupacion(g)}
                className={`px-3 py-1.5 font-semibold capitalize ${
                  agrupacion === g
                    ? 'bg-[#006A3B] text-white'
                    : 'bg-white text-[#3F4941] hover:bg-slate-50'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block font-semibold text-[#3F4941] mb-1">Vendedor</label>
          <select
            value={vendedorId}
            onChange={(e) => setVendedorId(e.target.value)}
            className="px-3 py-1.5 border border-[#BECABE] rounded-md bg-white"
          >
            <option value="TODOS">Todos los vendedores</option>
            {data?.vendedoresCatalogo.map((v) => (
              <option key={v.usuarioId} value={v.usuarioId}>
                {v.nombreCompleto}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold text-[#3F4941] mb-1">Medio de pago</label>
          <select
            value={medioPago}
            onChange={(e) => setMedioPago(e.target.value)}
            className="px-3 py-1.5 border border-[#BECABE] rounded-md bg-white"
          >
            <option value="TODOS">Todos los medios</option>
            <option value="EFECTIVO">Efectivo</option>
            <option value="VISA">Visa</option>
            <option value="MASTERCARD">Mastercard</option>
            <option value="TRANSFERENCIA_YAPE">Transferencia / Yape</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-[#FFDAD6] text-[#93000A] text-xs font-semibold rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-10 bg-white border border-[#BECABE] rounded-xl text-center text-xs text-[#6F7A70]">
          Calculando indicadores y series del periodo...
        </div>
      ) : data && (
        <>
          {/* KPIs resumen */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-white border border-[#BECABE] rounded-xl p-4">
              <div className="text-[11px] font-bold text-[#6F7A70] uppercase">Ventas Brutas</div>
              <div className="text-lg font-extrabold font-data-mono tabular-nums text-[#181D19] mt-1">
                {formatPen(data.resumen.ventasBrutasCentimos)}
              </div>
            </div>
            <div className="bg-white border border-[#BECABE] rounded-xl p-4">
              <div className="text-[11px] font-bold text-[#6F7A70] uppercase">Descuentos</div>
              <div className="text-lg font-extrabold font-data-mono tabular-nums text-amber-700 mt-1">
                {formatPen(data.resumen.descuentosCentimos)}
              </div>
            </div>
            <div className="bg-white border border-[#BECABE] rounded-xl p-4">
              <div className="text-[11px] font-bold text-[#6F7A70] uppercase">Anulaciones</div>
              <div className="text-lg font-extrabold font-data-mono tabular-nums text-[#BA1A1A] mt-1">
                {formatPen(data.resumen.anulacionesCentimos)}
              </div>
            </div>
            <div className="bg-white border border-[#BECABE] rounded-xl p-4">
              <div className="text-[11px] font-bold text-[#006A3B] uppercase">Ventas Netas</div>
              <div className="text-lg font-extrabold font-data-mono tabular-nums text-[#006A3B] mt-1">
                {formatPen(data.resumen.ventasNetasCentimos)}
              </div>
            </div>
            <div className="bg-white border border-[#BECABE] rounded-xl p-4">
              <div className="text-[11px] font-bold text-[#6F7A70] uppercase">
                IGV Neto / Tickets
              </div>
              <div className="text-lg font-extrabold font-data-mono tabular-nums text-[#181D19] mt-1">
                {formatPen(data.resumen.igvNetoCentimos)}{' '}
                <span className="text-xs font-semibold text-[#6F7A70]">
                  ({data.resumen.totalTransacciones})
                </span>
              </div>
            </div>
          </div>

          {/* Definición transparente Bruto/Neto */}
          <div className="px-4 py-2.5 bg-[#F0F5EE] border border-[#BECABE] rounded-lg text-[11px] text-[#3F4941] flex items-start gap-2">
            <Info className="w-4 h-4 text-[#006A3B] shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Criterio contable: </span>
              Bruto: {data.definicion.bruto} · Neto: {data.definicion.neto}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-5">
            {/* Serie temporal comparativa */}
            <section className="col-span-12 xl:col-span-7 bg-white border border-[#BECABE] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#181D19] flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#006A3B]" />
                  <span>Evolución de ventas ({agrupacion})</span>
                </h2>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 bg-[#006A3B] rounded-sm inline-block" />
                    Netas
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 bg-[#005DB7]/40 rounded-sm inline-block" />
                    Brutas
                  </span>
                </div>
              </div>

              {data.serieTemporal.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#6F7A70]">
                  No hay ventas registradas en el rango seleccionado.
                </div>
              ) : (
                <div className="flex items-end gap-2 h-52 pt-4 overflow-x-auto pb-2">
                  {data.serieTemporal.map((item) => {
                    const netPct = Math.max(
                      6,
                      Math.round((item.ventasNetasCentimos / maxSerie) * 100)
                    );
                    const grossPct = Math.max(
                      6,
                      Math.round((item.ventasBrutasCentimos / maxSerie) * 100)
                    );
                    return (
                      <div
                        key={item.etiqueta}
                        className="flex-1 min-w-[44px] flex flex-col items-center gap-1"
                        title={`${item.etiqueta}: Neto ${formatPen(
                          item.ventasNetasCentimos
                        )} / Bruto ${formatPen(item.ventasBrutasCentimos)}`}
                      >
                        <span className="text-[10px] font-data-mono text-[#3F4941]">
                          {Math.round(item.ventasNetasCentimos / 100)}
                        </span>
                        <div className="w-full h-36 flex items-end justify-center gap-1 bg-slate-50 rounded p-1">
                          <div
                            className="w-2.5 bg-[#005DB7]/40 rounded-t"
                            style={{ height: `${grossPct}%` }}
                          />
                          <div
                            className="w-2.5 bg-[#006A3B] rounded-t"
                            style={{ height: `${netPct}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-data-mono text-[#6F7A70] truncate max-w-full">
                          {item.etiqueta.slice(-5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Ranking Top Productos */}
            <section className="col-span-12 xl:col-span-5 bg-white border border-[#BECABE] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#181D19] flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#005DB7]" />
                  <span>Ranking de productos</span>
                </h2>
              </div>
              <div className="overflow-x-auto max-h-72 custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                    <tr>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2 text-right">Und.</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTopProductos.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-[#6F7A70]">
                          Sin ventas de productos en este periodo.
                        </td>
                      </tr>
                    ) : (
                      filteredTopProductos.map((p) => (
                        <tr key={p.productoId}>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-[#181D19]">{p.nombre}</div>
                            <div className="text-[10px] font-data-mono text-[#6F7A70]">{p.sku}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-data-mono font-semibold">
                            {p.unidadesVendidas}
                          </td>
                          <td className="px-3 py-2 text-right font-data-mono font-bold text-[#006A3B]">
                            {formatPen(p.totalCentimos)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Tabla Ventas por Vendedor */}
          <section className="bg-white border border-[#BECABE] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[#181D19] flex items-center gap-2">
                <Users className="w-4 h-4 text-[#006A3B]" />
                <span>Desempeño por vendedor</span>
              </h2>
              <div className="text-[11px] text-[#6F7A70]">
                {data.metasYComisiones.metaConfigurada
                  ? `Meta mensual: ${formatPen(data.metasYComisiones.metaMensualCentimos)}`
                  : 'Meta mensual no configurada'}{' '}
                ·{' '}
                {data.metasYComisiones.comisionConfigurada
                  ? `Comisión: ${data.metasYComisiones.porcentajeComision}%`
                  : 'Comisión no configurada'}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                  <tr>
                    <th className="px-3 py-2.5">Vendedor</th>
                    <th className="px-3 py-2.5">Cargo</th>
                    <th className="px-3 py-2.5 text-right">Transacciones</th>
                    <th className="px-3 py-2.5 text-right">Ticket Promedio</th>
                    <th className="px-3 py-2.5 text-right">Total Vendido</th>
                    <th className="px-3 py-2.5 text-right">Comisión</th>
                    <th className="px-3 py-2.5 text-center">Estado Meta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredVendedores.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-[#6F7A70]">
                        Sin ventas registradas por vendedores en el periodo.
                      </td>
                    </tr>
                  ) : (
                    filteredVendedores.map((v) => (
                      <tr key={v.usuarioId}>
                        <td className="px-3 py-2.5 font-bold text-[#181D19]">
                          {v.nombreCompleto}
                        </td>
                        <td className="px-3 py-2.5 text-[#3F4941]">{v.cargo}</td>
                        <td className="px-3 py-2.5 text-right font-data-mono tabular-nums">
                          {v.transacciones}
                        </td>
                        <td className="px-3 py-2.5 text-right font-data-mono tabular-nums">
                          {formatPen(v.ticketPromedioCentimos)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-data-mono tabular-nums font-bold text-[#006A3B]">
                          {formatPen(v.totalCentimos)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-data-mono tabular-nums">
                          {v.comisionCentimos !== null ? formatPen(v.comisionCentimos) : 'No configurada'}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-[#3F4941] text-[11px] font-semibold">
                            {v.estadoMeta}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
