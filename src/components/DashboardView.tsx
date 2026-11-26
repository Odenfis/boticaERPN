import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Lock,
  PackagePlus,
  ShoppingBasket,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatLimaDate, formatPen } from '../lib/format';
import type { AppTab, AuthUser, DashboardData } from '../types/erp';

interface DashboardViewProps {
  user: AuthUser;
  onNavigate: (tab: AppTab, opts?: { filter?: string; openReception?: boolean; productId?: string }) => void;
  onNewSaleF2: () => void;
}

export function DashboardView({ user, onNavigate, onNewSaleF2 }: DashboardViewProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DashboardData>('/api/dashboard');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando tablero.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white border border-red-200 rounded-lg p-6 text-center space-y-3">
        <p className="text-sm font-semibold text-[#BA1A1A]">{error || 'Sin datos disponibles'}</p>
        <button
          type="button"
          onClick={loadDashboard}
          className="px-4 py-2 bg-[#006A3B] text-white text-xs font-bold rounded-md"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const diffAyer = data.kpis.ventasHoyCentimos - data.kpis.ventasAyerCentimos;
  const pctVsAyer =
    data.kpis.ventasAyerCentimos > 0
      ? Math.round((diffAyer / data.kpis.ventasAyerCentimos) * 100)
      : null;

  const canSell = user.permisos.includes('pos.operar');
  const canReceive = user.permisos.includes('compras.recibir');
  const canCloseCash = user.permisos.includes('caja.operar');

  const metaPct =
    data.metaMensual.configurada && data.metaMensual.metaCentimos
      ? Math.min(
          100,
          Math.round(
            (data.metaMensual.acumuladoMesCentimos / data.metaMensual.metaCentimos) * 100
          )
        )
      : 0;

  return (
    <div className="grid grid-cols-12 gap-5">
      {/* Columna izquierda: Métricas, Accesos rápidos y Últimos movimientos */}
      <div className="col-span-12 xl:col-span-8 space-y-5">
        {/* 4 Tarjetas KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white border border-[#BECABE] rounded-lg p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-[#6F7A70] mb-1.5">
              <span>Ventas hoy</span>
              <Banknote className="w-4 h-4 text-[#006A3B]" />
            </div>
            <div className="text-xl font-bold font-data-mono tabular-nums text-[#181D19]">
              {formatPen(data.kpis.ventasHoyCentimos)}
            </div>
            <div className="mt-1 text-[11px] font-medium flex items-center gap-1 text-[#3F4941]">
              {pctVsAyer !== null ? (
                <>
                  {pctVsAyer >= 0 ? (
                    <TrendingUp className="w-3.5 h-3.5 text-[#006A3B]" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 text-[#BA1A1A]" />
                  )}
                  <span>
                    {pctVsAyer >= 0 ? `+${pctVsAyer}%` : `${pctVsAyer}%`} vs ayer
                  </span>
                </>
              ) : (
                <span>Sin ventas ayer</span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('inventario', { filter: '30' })}
            className="text-left bg-white border border-[#BECABE] hover:border-[#973F4C] rounded-lg p-4 transition-colors"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-[#6F7A70] mb-1.5">
              <span>Por vencer</span>
              <CalendarClock className="w-4 h-4 text-[#973F4C]" />
            </div>
            <div className="text-xl font-bold font-data-mono tabular-nums text-[#973F4C]">
              {data.kpis.porVencerCount}
            </div>
            <div className="mt-1 text-[11px] font-medium text-[#973F4C]">
              Próximos {data.kpis.ventanaAlertaDias} días
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('inventario', { filter: 'stockCritico' })}
            className="text-left bg-white border border-[#BECABE] hover:border-[#005DB7] rounded-lg p-4 transition-colors"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-[#6F7A70] mb-1.5">
              <span>Stock bajo</span>
              <AlertTriangle className="w-4 h-4 text-[#005DB7]" />
            </div>
            <div className="text-xl font-bold font-data-mono tabular-nums text-[#181D19]">
              {data.kpis.stockBajoCount}
            </div>
            <div className="mt-1 text-[11px] font-medium text-[#005DB7]">
              Requiere reposición
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('compras')}
            className="text-left bg-white border border-[#BECABE] hover:border-[#006A3B] rounded-lg p-4 transition-colors"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-[#6F7A70] mb-1.5">
              <span>Pedidos pendientes</span>
              <ClipboardList className="w-4 h-4 text-[#6F7A70]" />
            </div>
            <div className="text-xl font-bold font-data-mono tabular-nums text-[#181D19]">
              {String(data.kpis.pedidosPendientesCount).padStart(2, '0')}
            </div>
            <div className="mt-1 text-[11px] font-medium text-[#6F7A70]">
              Pendientes o en tránsito
            </div>
          </button>
        </div>

        {/* 3 Accesos Rápidos */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            disabled={!canSell}
            title={!canSell ? 'Sin permiso para operar POS' : undefined}
            onClick={onNewSaleF2}
            className="bg-[#006A3B] hover:bg-[#00522D] disabled:opacity-50 text-white rounded-xl p-5 flex flex-col items-center justify-center gap-2.5 transition-colors"
          >
            <ShoppingBasket className="w-7 h-7" />
            <span className="text-xs font-bold uppercase tracking-wider">Nueva venta (F2)</span>
          </button>

          <button
            type="button"
            disabled={!canReceive}
            title={!canReceive ? 'Sin permiso para recibir mercadería' : undefined}
            onClick={() => onNavigate('compras', { openReception: true })}
            className="bg-[#005DB7] hover:bg-[#00468C] disabled:opacity-50 text-white rounded-xl p-5 flex flex-col items-center justify-center gap-2.5 transition-colors"
          >
            <PackagePlus className="w-7 h-7" />
            <span className="text-xs font-bold uppercase tracking-wider">Ingreso a almacén</span>
          </button>

          <button
            type="button"
            disabled={!canCloseCash}
            title={!canCloseCash ? 'Sin permiso para operar caja' : undefined}
            onClick={() => onNavigate('caja')}
            className="bg-[#DFE4DD] hover:bg-[#D7DBD4] disabled:opacity-50 text-[#181D19] border border-[#BECABE] rounded-xl p-5 flex flex-col items-center justify-center gap-2.5 transition-colors"
          >
            <Lock className="w-7 h-7 text-[#3F4941]" />
            <span className="text-xs font-bold uppercase tracking-wider">Cierre de caja</span>
          </button>
        </div>

        {/* Tabla Últimos Movimientos */}
        <section className="bg-white border border-[#BECABE] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-[#F0F5EE] flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#181D19]">Últimos movimientos de inventario</h2>
            <button
              type="button"
              onClick={() => onNavigate('inventario')}
              className="text-xs font-semibold text-[#006A3B] hover:underline flex items-center gap-1"
            >
              <span>Ver todo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                <tr>
                  <th className="px-3 py-2">Código SKU</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">Categoría</th>
                  <th className="px-3 py-2 text-right">Stock Disp.</th>
                  <th className="px-3 py-2 text-right">Vencimiento</th>
                  <th className="px-3 py-2 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {data.ultimosMovimientos.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                      No hay movimientos de inventario registrados todavía.
                    </td>
                  </tr>
                ) : (
                  data.ultimosMovimientos.map((mov) => (
                    <tr
                      key={mov.movimientoId}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => onNavigate('kardex', { productId: mov.productoId })}
                    >
                      <td className="px-3 py-2.5 font-data-mono text-xs text-[#3F4941]">
                        {mov.sku}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-[#181D19]">
                        {mov.productoNombre}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[#3F4941]">{mov.categoria}</td>
                      <td className="px-3 py-2.5 text-right font-data-mono tabular-nums font-semibold">
                        {mov.stockActual} und
                      </td>
                      <td className="px-3 py-2.5 text-right font-data-mono text-xs text-[#3F4941]">
                        {mov.proximoVencimiento ? formatLimaDate(mov.proximoVencimiento) : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                            mov.estadoStock === 'OPTIMO'
                              ? 'bg-emerald-50 text-[#006A3B] border border-emerald-200'
                              : mov.estadoStock === 'BAJO'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : 'bg-[#FFDAD6] text-[#93000A] border border-red-200'
                          }`}
                        >
                          {mov.estadoStock === 'OPTIMO'
                            ? 'Óptimo'
                            : mov.estadoStock === 'BAJO'
                              ? 'Bajo'
                              : 'Crítico'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Columna derecha: Centro de alertas, Meta mensual, Actividad reciente */}
      <div className="col-span-12 xl:col-span-4 space-y-5">
        {/* Centro de Alertas */}
        <section className="bg-white border border-[#BECABE] rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-[#973F4C] text-white flex items-center justify-between">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Centro de alertas</span>
            </h2>
            <span className="text-xs font-bold">{data.alertas.length} activas</span>
          </div>
          <div className="p-4 space-y-2.5">
            {data.alertas.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#3F4941] bg-[#F0F5EE] rounded-md flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#006A3B]" />
                <span>Sin alertas críticas en este momento.</span>
              </div>
            ) : (
              data.alertas.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onNavigate(a.destinoTab, { filter: a.filtro })}
                  className={`w-full text-left p-3 rounded-md border transition-colors ${
                    a.severidad === 'error'
                      ? 'bg-[#FFDAD6]/45 border-[#BA1A1A]/30 hover:bg-[#FFDAD6]/70'
                      : a.severidad === 'warning'
                        ? 'bg-amber-50 border-amber-200 hover:bg-amber-100/70'
                        : 'bg-blue-50 border-blue-200 hover:bg-blue-100/70'
                  }`}
                >
                  <div
                    className={`text-xs font-bold ${
                      a.severidad === 'error'
                        ? 'text-[#93000A]'
                        : a.severidad === 'warning'
                          ? 'text-amber-900'
                          : 'text-[#003670]'
                    }`}
                  >
                    {a.titulo}
                  </div>
                  <div className="text-xs text-[#3F4941] mt-0.5">{a.detalle}</div>
                </button>
              ))
            )}
          </div>
        </section>

        {/* Meta Mensual (solo cuando está configurada) */}
        <section className="bg-white border border-[#BECABE] rounded-lg p-4">
          <h2 className="text-xs font-bold text-[#6F7A70] uppercase tracking-wide mb-2">
            Meta de ventas mensual
          </h2>
          {data.metaMensual.configurada && data.metaMensual.metaCentimos ? (
            <>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-2xl font-extrabold font-data-mono tabular-nums text-[#006A3B]">
                  {formatPen(data.metaMensual.acumuladoMesCentimos)}
                </span>
                <span className="text-xs text-[#6F7A70] font-data-mono">
                  / {formatPen(data.metaMensual.metaCentimos)} ({metaPct}%)
                </span>
              </div>
              <div className="w-full h-2.5 bg-[#EBEDE8] rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-[#006A3B] rounded-full transition-all"
                  style={{ width: `${metaPct}%` }}
                />
              </div>
              <p className="text-xs text-[#3F4941]">
                Quedan {data.metaMensual.diasRestantesMes} días para el cierre de mes.
              </p>
            </>
          ) : (
            <div className="text-xs text-[#6F7A70] py-2">
              Meta mensual no configurada en Parámetros.
            </div>
          )}
        </section>

        {/* Actividad Reciente */}
        <section className="bg-white border border-[#BECABE] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-bold text-[#181D19]">Actividad reciente</h2>
          </div>
          <div className="p-4 space-y-3 max-h-72 overflow-y-auto custom-scrollbar">
            {data.actividadReciente.length === 0 ? (
              <p className="text-xs text-[#6F7A70] text-center py-4">
                Sin eventos registrados en auditoría.
              </p>
            ) : (
              data.actividadReciente.map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 text-xs">
                  <span
                    className={`px-2 py-0.5 rounded font-bold shrink-0 ${
                      ev.tipo === 'VENTA'
                        ? 'bg-emerald-50 text-[#006A3B]'
                        : ev.tipo === 'COMPRA'
                          ? 'bg-blue-50 text-[#005DB7]'
                          : ev.tipo === 'ANULACION'
                            ? 'bg-[#FFDAD6] text-[#93000A]'
                            : 'bg-slate-100 text-[#3F4941]'
                    }`}
                  >
                    {ev.tipo}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-[#181D19] truncate">{ev.titulo}</div>
                    <div className="text-[#6F7A70]">{ev.subtitulo}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
