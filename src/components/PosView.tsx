import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Banknote,
  CheckCircle2,
  CreditCard,
  FileText,
  History,
  Minus,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatLimaDateTime, formatPen } from '../lib/format';
import type {
  AuthUser,
  ClientRow,
  OpenShiftSummary,
  ProductRow,
  SaleHistoryRow,
} from '../types/erp';

interface PosViewProps {
  user: AuthUser;
  openShift: OpenShiftSummary | null;
  globalSearch: string;
  onGlobalSearchChange: (val: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  initialSubTab?: 'pos' | 'historial' | 'recetas';
  onSaleCompleted: () => void;
  onOpenCashScreen: () => void;
}

interface CartItem {
  producto: ProductRow;
  cantidad: number;
  descuentoPorcentaje: number;
}

type PaymentMethod = 'EFECTIVO' | 'VISA' | 'MASTERCARD' | 'TRANSFERENCIA_YAPE';

export function PosView({
  user,
  openShift,
  globalSearch,
  onGlobalSearchChange,
  searchInputRef,
  initialSubTab = 'pos',
  onSaleCompleted,
  onOpenCashScreen,
}: PosViewProps) {
  const [subTab, setSubTab] = useState<'pos' | 'historial' | 'recetas'>(initialSubTab);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [condicionFilter, setCondicionFilter] = useState<'TODO' | 'OTC' | 'RECETA'>('TODO');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<ClientRow[]>([]);
  const [newClientForm, setNewClientForm] = useState({
    tipoDocumento: 'DNI' as 'DNI' | 'RUC' | 'CE',
    numeroDocumento: '',
    nombreRazonSocial: '',
  });

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('EFECTIVO');
  const [cashReceivedStr, setCashReceivedStr] = useState('');
  const [operationRef, setOperationRef] = useState('');
  const [recetaRef, setRecetaRef] = useState('');
  const [validacionReceta, setValidacionReceta] = useState<{
    validacionId: string;
    recetaReferencia: string;
    validadoPorNombre: string;
    validadoEn: string;
  } | null>(null);

  const [rxModalOpen, setRxModalOpen] = useState(false);
  const [rxForm, setRxForm] = useState({ pacienteNombre: '', medicoNombre: '', observaciones: '' });

  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountTargetIdx, setDiscountTargetIdx] = useState<number>(0);
  const [discountValueStr, setDiscountValueStr] = useState('0');

  const [submittingSale, setSubmittingSale] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [currentIdempotencyKey, setCurrentIdempotencyKey] = useState<string>(() =>
    crypto.randomUUID()
  );
  const [ticketData, setTicketData] = useState<any | null>(null);

  // Historial de ventas y anulación
  const [salesHistory, setSalesHistory] = useState<SaleHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [voidTarget, setVoidTarget] = useState<SaleHistoryRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidReturnStock, setVoidReturnStock] = useState(true);
  const [voidError, setVoidError] = useState<string | null>(null);

  const cashInputRef = useRef<HTMLInputElement | null>(null);

  const canDiscount = user.permisos.includes('pos.descuento');
  const canValidateRx = user.permisos.includes('recetas.validar');
  const canVoid = user.permisos.includes('pos.anular');

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const loadProducts = async () => {
    setLoadingProducts(true);
    try {
      const res = await apiFetch<{ items: ProductRow[] }>('/api/productos?pageSize=200');
      setProducts(res.items);
    } catch {
      // handled gracefully
    } finally {
      setLoadingProducts(false);
    }
  };

  const loadSalesHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await apiFetch<{ ventas: SaleHistoryRow[] }>('/api/pos/ventas');
      setSalesHistory(res.ventas);
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    if (subTab === 'historial') {
      loadSalesHistory();
    }
  }, [subTab]);

  const addToCart = (prod: ProductRow) => {
    setSaleError(null);
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.producto.productoId === prod.productoId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], cantidad: copy[idx].cantidad + 1 };
        return copy;
      }
      return [...prev, { producto: prod, cantidad: 1, descuentoPorcentaje: 0 }];
    });
  };

  // Soporte lector USB tipo teclado / Enter sobre búsqueda exacta por SKU o código de barras
  useEffect(() => {
    const q = globalSearch.trim();
    if (!q || subTab !== 'pos') return;
    const exactBarcode = products.find(
      (p) => p.codigoBarras && p.codigoBarras.toLowerCase() === q.toLowerCase()
    );
    if (exactBarcode && q.length >= 8) {
      addToCart(exactBarcode);
      onGlobalSearchChange('');
    }
  }, [globalSearch, products, subTab]);

  const filteredProducts = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (condicionFilter === 'OTC' && p.requiereReceta) return false;
      if (condicionFilter === 'RECETA' && !p.requiereReceta) return false;
      if (!q) return true;
      return (
        p.nombre.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.principioActivo.toLowerCase().includes(q) ||
        (p.codigoBarras || '').toLowerCase().includes(q)
      );
    });
  }, [products, condicionFilter, globalSearch]);

  // Cálculos en céntimos PEN
  const totals = useMemo(() => {
    let brutoCentimos = 0;
    let descuentoCentimos = 0;
    let baseImponibleCentimos = 0;
    let igvCentimos = 0;
    let totalCentimos = 0;

    for (const item of cart) {
      const b = item.cantidad * item.producto.precioVentaCentimos;
      const d = Math.round((b * item.descuentoPorcentaje) / 100);
      const sub = b - d;
      let base = sub;
      let igv = 0;
      if (item.producto.gravadoIgv && item.producto.igvPorcentaje > 0) {
        base = Math.round(sub / (1 + item.producto.igvPorcentaje / 100));
        igv = sub - base;
      }
      brutoCentimos += b;
      descuentoCentimos += d;
      baseImponibleCentimos += base;
      igvCentimos += igv;
      totalCentimos += sub;
    }

    const cashReceivedCentimos =
      paymentMethod === 'EFECTIVO'
        ? cashReceivedStr.trim() === ''
          ? totalCentimos
          : Math.round(Number(cashReceivedStr) * 100)
        : 0;

    const vueltoCentimos =
      paymentMethod === 'EFECTIVO' && cashReceivedCentimos >= totalCentimos
        ? cashReceivedCentimos - totalCentimos
        : 0;

    return {
      brutoCentimos,
      descuentoCentimos,
      baseImponibleCentimos,
      igvCentimos,
      totalCentimos,
      cashReceivedCentimos,
      vueltoCentimos,
    };
  }, [cart, paymentMethod, cashReceivedStr]);

  const requiresRx = cart.some((c) => c.producto.requiereReceta);

  const resetSale = () => {
    setCart([]);
    setSelectedClient(null);
    setCashReceivedStr('');
    setOperationRef('');
    setRecetaRef('');
    setValidacionReceta(null);
    setSaleError(null);
    setCurrentIdempotencyKey(crypto.randomUUID());
  };

  // Verificar si ya existe validación para la referencia ingresada
  const checkRxValidation = async (ref: string) => {
    const clean = ref.trim();
    if (!clean) {
      setValidacionReceta(null);
      return;
    }
    try {
      const res = await apiFetch<{ validaciones: any[] }>(
        `/api/recetas/validaciones?recetaReferencia=${encodeURIComponent(clean)}`
      );
      if (res.validaciones.length > 0) {
        const v = res.validaciones[0];
        setValidacionReceta({
          validacionId: v.validacionId,
          recetaReferencia: v.recetaReferencia,
          validadoPorNombre: v.validadoPorNombre,
          validadoEn: v.validadoEn,
        });
      } else {
        setValidacionReceta(null);
      }
    } catch {
      setValidacionReceta(null);
    }
  };

  const handleValidatePrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaleError(null);
    if (!recetaRef.trim()) return;
    try {
      const res = await apiFetch<any>('/api/recetas/validar', {
        method: 'POST',
        body: JSON.stringify({
          recetaReferencia: recetaRef.trim(),
          pacienteNombre: rxForm.pacienteNombre,
          medicoNombre: rxForm.medicoNombre,
          observaciones: rxForm.observaciones,
        }),
      });
      setValidacionReceta({
        validacionId: res.validacionId,
        recetaReferencia: res.recetaReferencia,
        validadoPorNombre: res.validadoPorNombre,
        validadoEn: res.validadoEn,
      });
      setRxModalOpen(false);
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : 'No se pudo validar la receta.');
    }
  };

  const handleSubmitSale = async () => {
    if (submittingSale) return;
    setSaleError(null);

    if (!openShift) {
      setSaleError('Caja cerrada: debe abrir un turno de caja antes de cobrar.');
      return;
    }
    if (cart.length === 0) {
      setSaleError('Agregue al menos un producto al carrito.');
      return;
    }

    setSubmittingSale(true);
    try {
      const payload = {
        idempotencyKey: currentIdempotencyKey,
        clienteId: selectedClient?.clienteId || null,
        recetaReferencia: requiresRx ? recetaRef.trim() || null : null,
        items: cart.map((c) => ({
          productoId: c.producto.productoId,
          cantidad: c.cantidad,
          descuentoPorcentaje: c.descuentoPorcentaje,
        })),
        pagos: [
          {
            medioPago: paymentMethod,
            montoCentimos: totals.totalCentimos,
            efectivoRecibidoCentimos:
              paymentMethod === 'EFECTIVO' ? totals.cashReceivedCentimos : null,
            referenciaOperacion: paymentMethod !== 'EFECTIVO' ? operationRef.trim() || null : null,
          },
        ],
      };

      const ticket = await apiFetch('/api/pos/ventas', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setTicketData(ticket);
      resetSale();
      await loadProducts();
      onSaleCompleted();
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : 'Error al procesar el cobro.');
    } finally {
      setSubmittingSale(false);
    }
  };

  // Atajos de teclado POS: F1, F2, F4, F8, F10, Ctrl+E
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F2') {
        e.preventDefault();
        setSubTab('pos');
        resetSale();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setClientModalOpen(true);
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0 && canDiscount) {
          setDiscountTargetIdx(0);
          setDiscountValueStr(String(cart[0].descuentoPorcentaje));
          setDiscountModalOpen(true);
        }
      } else if (e.key === 'F10') {
        e.preventDefault();
        if (subTab === 'pos' && cart.length > 0) {
          handleSubmitSale();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setPaymentMethod('EFECTIVO');
        setTimeout(() => cashInputRef.current?.focus(), 20);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const searchClients = async (q: string) => {
    setClientQuery(q);
    try {
      const res = await apiFetch<{ clientes: ClientRow[] }>(
        `/api/clientes?q=${encodeURIComponent(q)}`
      );
      setClientResults(res.clientes);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (clientModalOpen) {
      searchClients('');
    }
  }, [clientModalOpen]);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await apiFetch<ClientRow>('/api/clientes', {
        method: 'POST',
        body: JSON.stringify(newClientForm),
      });
      setSelectedClient(created);
      setClientModalOpen(false);
      setNewClientForm({ tipoDocumento: 'DNI', numeroDocumento: '', nombreRazonSocial: '' });
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : 'No se pudo registrar el cliente.');
    }
  };

  const handleVoidSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget) return;
    setVoidError(null);
    try {
      await apiFetch(`/api/pos/ventas/${voidTarget.ventaId}/anular`, {
        method: 'POST',
        body: JSON.stringify({
          motivo: voidReason,
          devolverMercaderia: voidReturnStock,
          idempotencyKey: `anul-${voidTarget.ventaId}-${Date.now()}`,
        }),
      });
      setVoidTarget(null);
      setVoidReason('');
      await loadSalesHistory();
      await loadProducts();
      onSaleCompleted();
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : 'No se pudo anular la venta.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Sub-navegación POS / Historial */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 bg-white border border-[#BECABE] rounded-lg p-1">
          <button
            type="button"
            onClick={() => setSubTab('pos')}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
              subTab === 'pos' ? 'bg-[#006A3B] text-white' : 'text-[#3F4941] hover:bg-slate-100'
            }`}
          >
            Caja registradora (POS)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('historial')}
            className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 transition-colors ${
              subTab === 'historial'
                ? 'bg-[#006A3B] text-white'
                : 'text-[#3F4941] hover:bg-slate-100'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Historial y anulaciones</span>
          </button>
        </div>

        {!openShift && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#FFDAD6] border border-[#BA1A1A]/30 text-[#93000A] text-xs font-semibold">
            <span>Caja cerrada: no se pueden confirmar cobros hasta abrir turno.</span>
            {user.permisos.includes('caja.operar') && (
              <button
                type="button"
                onClick={onOpenCashScreen}
                className="px-2.5 py-1 bg-[#BA1A1A] text-white rounded font-bold"
              >
                Ir a Caja
              </button>
            )}
          </div>
        )}
      </div>

      {subTab === 'historial' ? (
        <div className="bg-white border border-[#BECABE] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-[#F0F5EE] flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#181D19]">Historial de ventas</h2>
            <button
              type="button"
              onClick={loadSalesHistory}
              className="text-xs font-semibold text-[#006A3B] hover:underline"
            >
              Actualizar
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                <tr>
                  <th className="px-3 py-2">Ticket</th>
                  <th className="px-3 py-2">Fecha y hora</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Vendedor</th>
                  <th className="px-3 py-2">Medios de pago</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-center">Estado</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {historyLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      Cargando ventas...
                    </td>
                  </tr>
                ) : salesHistory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      No hay ventas registradas todavía.
                    </td>
                  </tr>
                ) : (
                  salesHistory.map((v) => (
                    <tr key={v.ventaId} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-data-mono font-bold text-[#006A3B]">
                        {v.numeroTicket}
                      </td>
                      <td className="px-3 py-3 text-xs font-data-mono text-[#3F4941]">
                        {formatLimaDateTime(v.creadoEn)}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {v.clienteNombre ? (
                          <div>
                            <div className="font-semibold text-[#181D19]">{v.clienteNombre}</div>
                            <div className="text-[#6F7A70]">{v.clienteDocumento}</div>
                          </div>
                        ) : (
                          <span className="text-[#6F7A70]">Cliente general</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-[#3F4941]">{v.vendedorNombre}</td>
                      <td className="px-3 py-3 text-xs">
                        {v.mediosPago.map((m) => m.medioPago).join(', ')}
                      </td>
                      <td className="px-3 py-3 text-right font-data-mono tabular-nums font-bold">
                        {formatPen(v.totalCentimos)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                            v.estado === 'COMPLETADA'
                              ? 'bg-emerald-50 text-[#006A3B] border border-emerald-200'
                              : 'bg-[#FFDAD6] text-[#93000A] border border-red-200'
                          }`}
                        >
                          {v.estado}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            setTicketData({
                              ...v,
                              tipoComprobante:
                                'TICKET INTERNO DE VENTA (NO VÁLIDO PARA CRÉDITO FISCAL SUNAT)',
                              fechaHora: v.creadoEn,
                              sucursalNombre: user.sucursalNombre,
                              sucursalRuc: user.sucursalRuc,
                              pagos: v.mediosPago,
                              items: v.items.map((it) => ({
                                ...it,
                                nombre: it.productoNombre,
                              })),
                            })
                          }
                          className="px-2 py-1 border border-slate-200 rounded text-xs font-semibold text-[#3F4941] hover:bg-slate-100"
                        >
                          Ticket
                        </button>
                        {v.estado === 'COMPLETADA' && canVoid && (
                          <button
                            type="button"
                            onClick={() => {
                              setVoidTarget(v);
                              setVoidError(null);
                            }}
                            className="px-2 py-1 border border-red-200 rounded text-xs font-semibold text-[#BA1A1A] hover:bg-red-50"
                          >
                            Anular
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* 3-Zone POS Workspace */
        <div className="grid grid-cols-12 gap-4 items-start">
          {/* ZONA 1: Catálogo */}
          <section className="col-span-12 lg:col-span-3 bg-white border border-[#BECABE] rounded-xl p-4 flex flex-col max-h-[calc(100vh-10.5rem)]">
            <h2 className="text-sm font-bold text-[#181D19] mb-3">Catálogo de productos</h2>

            <div className="flex gap-1.5 mb-3">
              {(['TODO', 'OTC', 'RECETA'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setCondicionFilter(tab)}
                  className={`flex-1 py-1.5 px-2 rounded-md text-xs font-bold transition-colors ${
                    condicionFilter === tab
                      ? 'bg-emerald-100 text-[#006A3B]'
                      : 'bg-slate-100 text-[#3F4941] hover:bg-slate-200'
                  }`}
                >
                  {tab === 'TODO' ? 'Todo' : tab === 'OTC' ? 'OTC' : 'Receta'}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
              {loadingProducts ? (
                <div className="text-xs text-slate-500 py-8 text-center">Cargando catálogo...</div>
              ) : filteredProducts.length === 0 ? (
                <div className="text-xs text-slate-500 py-8 text-center">
                  No se encontraron productos con ese criterio.
                </div>
              ) : (
                filteredProducts.map((p) => {
                  const sinStock = p.stockDisponible <= 0;
                  return (
                    <button
                      key={p.productoId}
                      type="button"
                      onClick={() => addToCart(p)}
                      className="w-full text-left p-3 border border-slate-200 rounded-lg hover:border-[#006A3B] hover:bg-emerald-50/40 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-data-mono text-[11px] text-[#6F7A70]">{p.sku}</span>
                        {p.requiereReceta ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-[#005DB7]">
                            Receta médica
                          </span>
                        ) : p.stockDisponible <= p.stockMinimo ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">
                            Stock bajo
                          </span>
                        ) : null}
                      </div>
                      <div className="text-sm font-bold text-[#181D19] leading-snug">{p.nombre}</div>
                      <div className="text-xs text-[#6F7A70] mb-2">
                        {p.presentacion} · {p.principioActivo}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-base font-extrabold font-data-mono tabular-nums text-[#006A3B]">
                          {formatPen(p.precioVentaCentimos)}
                        </span>
                        <span
                          className={`text-xs font-semibold font-data-mono ${
                            sinStock ? 'text-[#BA1A1A]' : 'text-[#3F4941]'
                          }`}
                        >
                          Disp: {p.stockDisponible}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* ZONA 2: Carrito editable */}
          <section className="col-span-12 lg:col-span-6 flex flex-col gap-3">
            <div className="bg-white border border-[#BECABE] rounded-xl overflow-hidden flex flex-col min-h-[430px]">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-[#181D19]">Carrito de venta</h2>
                  <span className="text-xs font-bold bg-[#006A3B] text-white px-2 py-0.5 rounded">
                    {cart.reduce((a, b) => a + b.cantidad, 0)} und
                  </span>
                </div>
                <button
                  type="button"
                  onClick={resetSale}
                  disabled={cart.length === 0}
                  className="text-xs font-semibold text-[#BA1A1A] hover:underline disabled:opacity-40 flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Limpiar carrito</span>
                </button>
              </div>

              <div className="flex-1 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                    <tr>
                      <th className="px-3 py-2">Código</th>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2 text-center">Cantidad</th>
                      <th className="px-3 py-2 text-right">Unit.</th>
                      <th className="px-3 py-2 text-right">Desc. %</th>
                      <th className="px-3 py-2 text-right">Subtotal</th>
                      <th className="px-2 py-2" aria-label="Quitar" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {cart.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-16 text-center text-[#6F7A70]">
                          Seleccione productos del catálogo o escanee un código de barras para iniciar la venta.
                        </td>
                      </tr>
                    ) : (
                      cart.map((item, idx) => {
                        const bruto = item.cantidad * item.producto.precioVentaCentimos;
                        const desc = Math.round((bruto * item.descuentoPorcentaje) / 100);
                        const sub = bruto - desc;
                        return (
                          <tr key={item.producto.productoId} className="hover:bg-slate-50">
                            <td className="px-3 py-3 font-data-mono text-xs text-[#6F7A70]">
                              {item.producto.sku}
                            </td>
                            <td className="px-3 py-3">
                              <div className="font-semibold text-[#181D19] flex items-center gap-1.5">
                                <span>{item.producto.nombre}</span>
                                {item.producto.requiereReceta && (
                                  <FileText
                                    className="w-3.5 h-3.5 text-[#005DB7]"
                                    aria-label="Requiere receta médica"
                                  />
                                )}
                              </div>
                              <div className="text-xs text-[#6F7A70]">
                                {item.producto.presentacion} · Disp: {item.producto.stockDisponible}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  aria-label={`Disminuir cantidad de ${item.producto.nombre}`}
                                  onClick={() =>
                                    setCart((prev) =>
                                      prev
                                        .map((c, i) =>
                                          i === idx ? { ...c, cantidad: c.cantidad - 1 } : c
                                        )
                                        .filter((c) => c.cantidad > 0)
                                    )
                                  }
                                  className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  aria-label={`Cantidad de ${item.producto.nombre}`}
                                  value={item.cantidad}
                                  onChange={(e) => {
                                    const val = Math.max(1, Math.trunc(Number(e.target.value) || 1));
                                    setCart((prev) =>
                                      prev.map((c, i) =>
                                        i === idx ? { ...c, cantidad: val } : c
                                      )
                                    );
                                  }}
                                  className="w-12 text-center font-data-mono font-bold border border-slate-200 rounded py-1 text-sm"
                                />
                                <button
                                  type="button"
                                  aria-label={`Aumentar cantidad de ${item.producto.nombre}`}
                                  onClick={() =>
                                    setCart((prev) =>
                                      prev.map((c, i) =>
                                        i === idx ? { ...c, cantidad: c.cantidad + 1 } : c
                                      )
                                    )
                                  }
                                  className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right font-data-mono tabular-nums">
                              {formatPen(item.producto.precioVentaCentimos)}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <button
                                type="button"
                                disabled={!canDiscount}
                                title={
                                  !canDiscount
                                    ? 'Sin permiso para aplicar descuentos'
                                    : 'Aplicar descuento autorizado'
                                }
                                onClick={() => {
                                  setDiscountTargetIdx(idx);
                                  setDiscountValueStr(String(item.descuentoPorcentaje));
                                  setDiscountModalOpen(true);
                                }}
                                className="font-data-mono text-xs font-bold text-[#006A3B] hover:underline disabled:opacity-50"
                              >
                                {item.descuentoPorcentaje.toFixed(2)}%
                              </button>
                            </td>
                            <td className="px-3 py-3 text-right font-data-mono tabular-nums font-bold text-[#181D19]">
                              {formatPen(sub)}
                            </td>
                            <td className="px-2 py-3 text-center">
                              <button
                                type="button"
                                aria-label={`Quitar ${item.producto.nombre}`}
                                onClick={() =>
                                  setCart((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="p-1 text-slate-400 hover:text-[#BA1A1A]"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Barra visible de atajos */}
              <div className="p-2.5 bg-[#181D19] text-white flex flex-wrap items-center gap-3 text-[11px]">
                <button
                  type="button"
                  onClick={resetSale}
                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 flex items-center gap-1.5"
                >
                  <kbd className="font-bold">F2</kbd>
                  <span>Nueva venta</span>
                </button>
                <button
                  type="button"
                  onClick={() => setClientModalOpen(true)}
                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 flex items-center gap-1.5"
                >
                  <kbd className="font-bold">F4</kbd>
                  <span>Buscar cliente</span>
                </button>
                <button
                  type="button"
                  disabled={!canDiscount || cart.length === 0}
                  title={!canDiscount ? 'Requiere permiso pos.descuento' : undefined}
                  onClick={() => {
                    if (cart.length > 0) {
                      setDiscountTargetIdx(0);
                      setDiscountValueStr(String(cart[0].descuentoPorcentaje));
                      setDiscountModalOpen(true);
                    }
                  }}
                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-40 flex items-center gap-1.5"
                >
                  <kbd className="font-bold">F8</kbd>
                  <span>Descuento</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMethod('EFECTIVO');
                    setTimeout(() => cashInputRef.current?.focus(), 20);
                  }}
                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 flex items-center gap-1.5"
                >
                  <kbd className="font-bold">Ctrl+E</kbd>
                  <span>Efectivo</span>
                </button>
                <button
                  type="button"
                  onClick={handleSubmitSale}
                  disabled={cart.length === 0 || submittingSale}
                  className="ml-auto px-2.5 py-1 rounded bg-[#006A3B] hover:bg-[#268451] disabled:bg-emerald-900/70 disabled:text-emerald-100/70 font-bold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <kbd>F10</kbd>
                  <span>Cobrar</span>
                </button>
              </div>
            </div>

            {/* Bloque de Receta Médica */}
            <div
              className={`border-2 border-dashed rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 ${
                requiresRx
                  ? validacionReceta
                    ? 'bg-emerald-50 border-[#006A3B]'
                    : 'bg-blue-50/70 border-[#005DB7]'
                  : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex-1 min-w-[220px]">
                <label
                  htmlFor="pos-rx-ref"
                  className="block text-[11px] font-bold uppercase tracking-wider text-[#005DB7] mb-1"
                >
                  Referencia de Receta Médica {requiresRx ? '(Obligatoria)' : '(Opcional)'}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="pos-rx-ref"
                    type="text"
                    value={recetaRef}
                    onChange={(e) => {
                      setRecetaRef(e.target.value);
                      checkRxValidation(e.target.value);
                    }}
                    placeholder="Ej. RX-2026-0041"
                    className="w-full px-3 py-1.5 bg-white border border-[#BECABE] rounded text-sm font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => checkRxValidation(recetaRef)}
                    className="px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold hover:bg-slate-50 whitespace-nowrap"
                  >
                    Verificar
                  </button>
                </div>
                {validacionReceta && (
                  <p className="text-xs text-[#006A3B] font-semibold mt-1.5 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      Validada por {validacionReceta.validadoPorNombre} (
                      {formatLimaDateTime(validacionReceta.validadoEn)})
                    </span>
                  </p>
                )}
                {requiresRx && !validacionReceta && (
                  <p className="text-xs text-[#005DB7] font-medium mt-1">
                    Exige validación interna por un farmacéutico antes de confirmar el cobro.
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={!canValidateRx || !recetaRef.trim()}
                title={
                  !canValidateRx
                    ? 'Solo un usuario con permiso recetas.validar (Farmacéutico) puede validar recetas'
                    : !recetaRef.trim()
                      ? 'Ingrese primero el código o referencia de receta'
                      : undefined
                }
                onClick={() => setRxModalOpen(true)}
                className="px-4 py-2 bg-[#005DB7] hover:bg-[#00468C] disabled:opacity-45 text-white text-xs font-bold rounded-lg flex items-center gap-2 whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Validar receta</span>
              </button>
            </div>
          </section>

          {/* ZONA 3: Cliente, Resumen y Cobro */}
          <section className="col-span-12 lg:col-span-3 space-y-3">
            {/* Datos del Cliente */}
            <div className="bg-white border border-[#BECABE] rounded-xl p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-[#3F4941] whitespace-nowrap">
                  Cliente (DNI/RUC)
                </h3>
                <button
                  type="button"
                  onClick={() => setClientModalOpen(true)}
                  className="text-[11px] font-bold text-[#006A3B] hover:underline whitespace-nowrap shrink-0"
                >
                  {selectedClient ? 'Cambiar' : 'Buscar / Nuevo (F4)'}
                </button>
              </div>
              {selectedClient ? (
                <div className="p-2.5 bg-[#F0F5EE] rounded-md">
                  <div className="text-[11px] font-data-mono text-[#6F7A70]">
                    {selectedClient.tipoDocumento}: {selectedClient.numeroDocumento}
                  </div>
                  <div className="text-sm font-bold text-[#181D19]">
                    {selectedClient.nombreRazonSocial}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[#6F7A70]">
                  Público general (sin documento asignado)
                </div>
              )}
            </div>

            {/* Resumen y Cobro */}
            <div className="bg-white border border-[#BECABE] rounded-xl p-4 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#3F4941]">
                Resumen de venta
              </h3>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-[#3F4941]">
                  <span>Valor bruto</span>
                  <span className="font-data-mono tabular-nums">
                    {formatPen(totals.brutoCentimos)}
                  </span>
                </div>
                <div className="flex justify-between text-[#006A3B]">
                  <span>Descuentos</span>
                  <span className="font-data-mono tabular-nums">
                    - {formatPen(totals.descuentoCentimos)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-[#6F7A70]">
                  <span>Op. Gravada / Base</span>
                  <span className="font-data-mono tabular-nums">
                    {formatPen(totals.baseImponibleCentimos)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-[#6F7A70]">
                  <span>IGV (18% incluido)</span>
                  <span className="font-data-mono tabular-nums">
                    {formatPen(totals.igvCentimos)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200">
                  <div className="text-[11px] font-bold uppercase text-[#6F7A70]">
                    Total a pagar
                  </div>
                  <div className="text-3xl font-extrabold font-data-mono tabular-nums text-[#181D19]">
                    {formatPen(totals.totalCentimos)}
                  </div>
                </div>
              </div>

              {/* Medios de pago */}
              <div>
                <span className="block text-[11px] font-bold uppercase text-[#6F7A70] mb-2">
                  Medio de pago
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'EFECTIVO', label: 'Efectivo', icon: Banknote },
                      { id: 'VISA', label: 'Visa', icon: CreditCard },
                      { id: 'MASTERCARD', label: 'Mastercard', icon: CreditCard },
                      { id: 'TRANSFERENCIA_YAPE', label: 'Transf./Yape', icon: Smartphone },
                    ] as const
                  ).map((m) => {
                    const Icon = m.icon;
                    const active = paymentMethod === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPaymentMethod(m.id)}
                        className={`p-2.5 rounded-lg border-2 flex flex-col items-center gap-1 text-xs font-bold transition-colors ${
                          active
                            ? 'border-[#006A3B] bg-emerald-50 text-[#006A3B]'
                            : 'border-slate-200 text-[#3F4941] hover:border-slate-300'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {paymentMethod === 'EFECTIVO' ? (
                <div className="space-y-2">
                  <div className="p-2.5 bg-[#F0F5EE] rounded-lg border border-[#BECABE]">
                    <div className="flex justify-between text-[11px] font-bold text-[#3F4941] mb-1">
                      <label htmlFor="pos-cash-received">Efectivo recibido (S/)</label>
                      <span className="text-[#6F7A70]">Ctrl+E</span>
                    </div>
                    <input
                      ref={cashInputRef}
                      id="pos-cash-received"
                      type="number"
                      step="0.10"
                      min="0"
                      value={cashReceivedStr}
                      onChange={(e) => setCashReceivedStr(e.target.value)}
                      placeholder={(totals.totalCentimos / 100).toFixed(2)}
                      className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-lg font-extrabold font-data-mono tabular-nums text-[#181D19]"
                    />
                  </div>
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex justify-between items-center">
                    <span className="text-xs font-bold text-[#006A3B]">Vuelto</span>
                    <span className="text-lg font-extrabold font-data-mono tabular-nums text-[#006A3B]">
                      {formatPen(totals.vueltoCentimos)}
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="pos-op-ref"
                    className="block text-[11px] font-bold text-[#3F4941] mb-1"
                  >
                    Referencia / Nro. operación (opcional)
                  </label>
                  <input
                    id="pos-op-ref"
                    type="text"
                    value={operationRef}
                    onChange={(e) => setOperationRef(e.target.value)}
                    placeholder="Ej. OP-992104"
                    className="w-full px-3 py-2 border border-[#BECABE] rounded-md text-sm"
                  />
                </div>
              )}

              {saleError && (
                <div
                  role="alert"
                  className="p-2.5 rounded-md bg-[#FFDAD6] border border-[#BA1A1A]/30 text-[#93000A] text-xs font-semibold"
                >
                  {saleError}
                </div>
              )}

              <button
                type="button"
                disabled={cart.length === 0 || submittingSale || !openShift}
                title={!openShift ? 'Abra un turno de caja para cobrar' : undefined}
                onClick={handleSubmitSale}
                className="w-full py-3.5 px-4 bg-[#006A3B] hover:bg-[#00522D] disabled:opacity-50 text-white font-extrabold text-base rounded-xl transition-colors"
              >
                {submittingSale ? 'Procesando cobro...' : 'COBRAR (F10)'}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Modal Buscar / Crear Cliente */}
      {clientModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Seleccionar o registrar cliente"
            className="bg-white rounded-xl border border-[#BECABE] w-full max-w-lg p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#181D19]">Cliente para ticket interno</h3>
              <button
                type="button"
                onClick={() => setClientModalOpen(false)}
                className="p-1 text-slate-500 hover:bg-slate-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={clientQuery}
                onChange={(e) => searchClients(e.target.value)}
                placeholder="Buscar por DNI, RUC o nombre..."
                className="w-full pl-9 pr-3 py-2 border border-[#BECABE] rounded-md text-sm"
              />
            </div>

            <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
              <button
                type="button"
                onClick={() => {
                  setSelectedClient(null);
                  setClientModalOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-xs font-semibold text-[#6F7A70] hover:bg-slate-50"
              >
                Usar Público General (sin cliente)
              </button>
              {clientResults.map((c) => (
                <button
                  key={c.clienteId}
                  type="button"
                  onClick={() => {
                    setSelectedClient(c);
                    setClientModalOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-emerald-50 flex items-center justify-between text-xs"
                >
                  <span className="font-bold text-[#181D19]">{c.nombreRazonSocial}</span>
                  <span className="font-data-mono text-[#6F7A70]">
                    {c.tipoDocumento}: {c.numeroDocumento}
                  </span>
                </button>
              ))}
            </div>

            <form onSubmit={handleCreateClient} className="pt-3 border-t border-slate-200 space-y-3">
              <div className="text-xs font-bold text-[#3F4941] flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-[#006A3B]" />
                <span>Registrar nuevo cliente</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={newClientForm.tipoDocumento}
                  onChange={(e) =>
                    setNewClientForm({ ...newClientForm, tipoDocumento: e.target.value as any })
                  }
                  className="border border-[#BECABE] rounded px-2 py-1.5 text-xs"
                >
                  <option value="DNI">DNI</option>
                  <option value="RUC">RUC</option>
                  <option value="CE">CE</option>
                </select>
                <input
                  type="text"
                  required
                  placeholder="Número doc."
                  value={newClientForm.numeroDocumento}
                  onChange={(e) =>
                    setNewClientForm({ ...newClientForm, numeroDocumento: e.target.value })
                  }
                  className="col-span-2 border border-[#BECABE] rounded px-2.5 py-1.5 text-xs"
                />
              </div>
              <input
                type="text"
                required
                placeholder="Nombre completo o Razón Social"
                value={newClientForm.nombreRazonSocial}
                onChange={(e) =>
                  setNewClientForm({ ...newClientForm, nombreRazonSocial: e.target.value })
                }
                className="w-full border border-[#BECABE] rounded px-2.5 py-1.5 text-xs"
              />
              <button
                type="submit"
                className="w-full py-2 bg-[#006A3B] text-white rounded-md text-xs font-bold"
              >
                Guardar y seleccionar
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal Descuento Autorizado (F8) */}
      {discountModalOpen && cart[discountTargetIdx] && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Aplicar descuento autorizado"
            className="bg-white rounded-xl border border-[#BECABE] w-full max-w-sm p-5 space-y-4 shadow-xl"
          >
            <h3 className="text-base font-bold text-[#181D19]">Aplicar descuento (F8)</h3>
            <div>
              <label className="block text-xs font-semibold text-[#3F4941] mb-1">Producto</label>
              <select
                value={discountTargetIdx}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setDiscountTargetIdx(idx);
                  setDiscountValueStr(String(cart[idx]?.descuentoPorcentaje ?? 0));
                }}
                className="w-full border border-[#BECABE] rounded px-3 py-2 text-sm"
              >
                {cart.map((c, idx) => (
                  <option key={c.producto.productoId} value={idx}>
                    {c.producto.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F4941] mb-1">
                Porcentaje de descuento (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={discountValueStr}
                onChange={(e) => setDiscountValueStr(e.target.value)}
                className="w-full border border-[#BECABE] rounded px-3 py-2 text-sm font-data-mono"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDiscountModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const pct = Math.min(100, Math.max(0, Number(discountValueStr) || 0));
                  setCart((prev) =>
                    prev.map((c, i) =>
                      i === discountTargetIdx ? { ...c, descuentoPorcentaje: pct } : c
                    )
                  );
                  setDiscountModalOpen(false);
                }}
                className="px-4 py-2 bg-[#006A3B] text-white rounded text-xs font-bold"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Validación Interna de Receta */}
      {rxModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleValidatePrescription}
            role="dialog"
            aria-modal="true"
            aria-label="Validación interna de receta médica"
            className="bg-white rounded-xl border border-[#BECABE] w-full max-w-md p-5 space-y-4 shadow-xl"
          >
            <h3 className="text-base font-bold text-[#005DB7]">
              Validación farmacéutica de receta
            </h3>
            <div className="p-2.5 bg-blue-50 rounded text-xs text-[#003670]">
              Referencia: <strong className="font-data-mono">{recetaRef}</strong> · Validador:{' '}
              <strong>{user.nombreCompleto}</strong>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F4941] mb-1">
                Nombre del paciente (opcional)
              </label>
              <input
                type="text"
                value={rxForm.pacienteNombre}
                onChange={(e) => setRxForm({ ...rxForm, pacienteNombre: e.target.value })}
                className="w-full border border-[#BECABE] rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F4941] mb-1">
                Médico / CMP (opcional)
              </label>
              <input
                type="text"
                value={rxForm.medicoNombre}
                onChange={(e) => setRxForm({ ...rxForm, medicoNombre: e.target.value })}
                className="w-full border border-[#BECABE] rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3F4941] mb-1">
                Observaciones de dispensación
              </label>
              <textarea
                rows={2}
                value={rxForm.observaciones}
                onChange={(e) => setRxForm({ ...rxForm, observaciones: e.target.value })}
                className="w-full border border-[#BECABE] rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setRxModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#005DB7] text-white rounded text-xs font-bold"
              >
                Confirmar validación
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Anular Venta */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleVoidSale}
            role="dialog"
            aria-modal="true"
            aria-label="Anular venta"
            className="bg-white rounded-xl border border-[#BECABE] w-full max-w-md p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center gap-2 text-[#BA1A1A]">
              <Ban className="w-5 h-5" />
              <h3 className="text-base font-bold">
                Anular venta {voidTarget.numeroTicket}
              </h3>
            </div>
            <p className="text-xs text-[#3F4941]">
              Total: <strong>{formatPen(voidTarget.totalCentimos)}</strong>. Esta acción generará
              movimientos compensatorios en Kardex y Caja sin eliminar el registro original.
            </p>
            <div>
              <label className="block text-xs font-semibold text-[#3F4941] mb-1">
                Motivo de anulación (obligatorio)
              </label>
              <textarea
                required
                rows={2}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Ej. Error en dosificación o devolución inmediata del cliente"
                className="w-full border border-[#BECABE] rounded px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-[#181D19]">
              <input
                type="checkbox"
                checked={voidReturnStock}
                onChange={(e) => setVoidReturnStock(e.target.checked)}
              />
              <span>Retornar mercadería a los lotes originales (si siguen aptos)</span>
            </label>
            {voidError && (
              <div className="p-2.5 rounded bg-[#FFDAD6] text-[#93000A] text-xs font-semibold">
                {voidError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="px-4 py-2 border border-slate-300 rounded text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#BA1A1A] text-white rounded text-xs font-bold"
              >
                Confirmar anulación
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Ticket Interno Imprimible */}
      {ticketData && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Ticket interno de venta"
            className="bg-white rounded-xl border border-[#BECABE] w-full max-w-md p-6 space-y-4 shadow-xl"
          >
            <div className="text-center border-b border-dashed border-slate-300 pb-3">
              <div className="text-base font-extrabold text-[#181D19]">
                {ticketData.sucursalNombre}
              </div>
              <div className="text-xs text-[#6F7A70]">RUC: {ticketData.sucursalRuc}</div>
              <div className="text-[11px] font-bold text-[#005DB7] mt-1">
                {ticketData.tipoComprobante}
              </div>
              <div className="text-sm font-data-mono font-bold mt-2">
                {ticketData.numeroTicket}
              </div>
              <div className="text-xs text-[#6F7A70]">
                {formatLimaDateTime(ticketData.fechaHora)} · Cajero: {ticketData.vendedorNombre}
              </div>
            </div>

            <div className="space-y-2 text-xs">
              {ticketData.items?.map((it: any, idx: number) => (
                <div key={idx} className="border-b border-slate-100 pb-1.5">
                  <div className="flex justify-between font-semibold">
                    <span>
                      {it.cantidad}x {it.nombre}
                    </span>
                    <span className="font-data-mono">{formatPen(it.subtotalCentimos)}</span>
                  </div>
                  {it.lotes && it.lotes.length > 0 && (
                    <div className="text-[10px] text-[#6F7A70]">
                      Lotes FEFO:{' '}
                      {it.lotes.map((l: any) => `${l.numeroLote} (${l.cantidad})`).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-1 text-xs border-t border-dashed border-slate-300 pt-3">
              <div className="flex justify-between">
                <span>Op. Gravada / Base:</span>
                <span className="font-data-mono">{formatPen(ticketData.baseImponibleCentimos)}</span>
              </div>
              <div className="flex justify-between">
                <span>IGV (18%):</span>
                <span className="font-data-mono">{formatPen(ticketData.igvCentimos)}</span>
              </div>
              <div className="flex justify-between text-sm font-extrabold pt-1">
                <span>TOTAL PAGADO:</span>
                <span className="font-data-mono">{formatPen(ticketData.totalCentimos)}</span>
              </div>
              {ticketData.pagos?.map((p: any, i: number) => (
                <div key={i} className="flex justify-between text-[#3F4941]">
                  <span>Medio ({p.medioPago}):</span>
                  <span className="font-data-mono">
                    {formatPen(p.montoCentimos)}
                    {p.medioPago === 'EFECTIVO' && p.vueltoCentimos > 0
                      ? ` (Vuelto: ${formatPen(p.vueltoCentimos)})`
                      : ''}
                  </span>
                </div>
              ))}
              {ticketData.recetaReferencia && (
                <div className="text-[11px] text-[#005DB7] pt-1">
                  Receta: {ticketData.recetaReferencia} · Validado por:{' '}
                  {ticketData.validadoPorNombre || 'Farmacéutico'}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end no-print pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 bg-[#005DB7] text-white rounded-md text-xs font-bold flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir ticket</span>
              </button>
              <button
                type="button"
                onClick={() => setTicketData(null)}
                className="px-4 py-2 bg-[#006A3B] text-white rounded-md text-xs font-bold"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
