import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  PackageCheck,
  Plus,
  Send,
  ShoppingCart,
  Trash2,
  Truck,
  UserPlus,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatLimaDate, formatPen, solesToCentimos } from '../lib/format';
import type { AuthUser, ProductRow, PurchaseOrderRow, SupplierRow } from '../types/erp';

interface ComprasViewProps {
  user: AuthUser;
  globalSearch: string;
  initialOpenReception?: boolean;
}

interface OrdersResponse {
  ordenes: PurchaseOrderRow[];
  resumen: {
    pendientes: number;
    enviados: number;
    recibidosParciales: number;
    completados: number;
    puntajeProveedorEstado: string;
    ahorroEstimadoEstado: string;
  };
}

interface DraftLine {
  producto: ProductRow;
  cantidad: number;
  costoUnitarioCentimos: number;
}

interface ReceptionLine {
  ordenDetalleId?: string;
  productoId: string;
  sku: string;
  productoNombre: string;
  pendiente: number;
  cantidadRecibida: number;
  numeroLote: string;
  fechaVencimiento: string;
  costoUnitarioSoles: string;
}

export function ComprasView({
  user,
  globalSearch,
  initialOpenReception = false,
}: ComprasViewProps) {
  const [ordersData, setOrdersData] = useState<OrdersResponse | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Requerimiento / Orden directa
  const [selectedProveedorId, setSelectedProveedorId] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qtyStr, setQtyStr] = useState('20');
  const [costStr, setCostStr] = useState('12.50');
  const [urgencia, setUrgencia] = useState<'NORMAL' | 'CRITICA'>('NORMAL');
  const [fechaEstimada, setFechaEstimada] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [creatingOrder, setCreatingOrder] = useState(false);

  // Filtros tabla órdenes
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'URGENTES' | 'COMPLETADOS'>('TODOS');

  // Modales
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [supForm, setSupForm] = useState({
    ruc: '',
    razonSocial: '',
    contactoNombre: '',
    telefono: '',
    email: '',
    direccion: '',
  });
  const [supError, setSupError] = useState<string | null>(null);

  const [detailOrder, setDetailOrder] = useState<PurchaseOrderRow | null>(null);
  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrderRow | null>(null);
  const [directReceptionOpen, setDirectReceptionOpen] = useState(false);
  const [recDocRef, setRecDocRef] = useState('');
  const [recObs, setRecObs] = useState('');
  const [recLines, setRecLines] = useState<ReceptionLine[]>([]);
  const [recSaving, setRecSaving] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);

  const canCreate = user.permisos.includes('compras.crear');
  const canReceive = user.permisos.includes('compras.recibir');

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ordRes, supRes, prodRes] = await Promise.all([
        apiFetch<OrdersResponse>('/api/compras/ordenes'),
        apiFetch<{ proveedores: SupplierRow[] }>('/api/proveedores'),
        apiFetch<{ items: ProductRow[] }>('/api/productos?pageSize=200'),
      ]);
      setOrdersData(ordRes);
      setSuppliers(supRes.proveedores);
      setProducts(prodRes.items);
      if (!selectedProveedorId && supRes.proveedores.length > 0) {
        setSelectedProveedorId(supRes.proveedores[0].proveedorId);
      }
      if (initialOpenReception && ordRes.ordenes.length > 0) {
        const receivable = ordRes.ordenes.find(
          (o) => o.estado === 'PENDIENTE' || o.estado === 'ENVIADO' || o.estado === 'RECIBIDO'
        );
        if (receivable && canReceive) {
          openReceiveOrder(receivable);
        } else if (canReceive) {
          openDirectReception(supRes.proveedores, prodRes.items);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando módulo de compras.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const criticalProducts = useMemo(
    () => products.filter((p) => p.stockDisponible <= p.stockMinimo),
    [products]
  );

  const matchingProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products
      .filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.principioActivo.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [products, productQuery]);

  const addLineToDraft = () => {
    const prod = products.find((p) => p.productoId === selectedProductId) || matchingProducts[0];
    if (!prod) return;
    const qty = Math.max(1, Math.trunc(Number(qtyStr || 0)));
    const costCent = Math.max(0, solesToCentimos(costStr));
    setDraftLines((prev) => {
      const idx = prev.findIndex((l) => l.producto.productoId === prod.productoId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], cantidad: copy[idx].cantidad + qty, costoUnitarioCentimos: costCent };
        return copy;
      }
      return [...prev, { producto: prod, cantidad: qty, costoUnitarioCentimos: costCent }];
    });
    setProductQuery('');
  };

  const generateCriticalDraft = () => {
    if (criticalProducts.length === 0) {
      setFeedback('No hay productos en stock crítico para sugerir reposición.');
      return;
    }
    setUrgencia('CRITICA');
    setObservaciones('Borrador generado desde sugerencias de stock crítico');
    setDraftLines(
      criticalProducts.map((p) => ({
        producto: p,
        cantidad: Math.max(10, p.stockMinimo * 2 - p.stockDisponible),
        costoUnitarioCentimos:
          p.costoPromedioCentimos > 0
            ? p.costoPromedioCentimos
            : Math.round(p.precioVentaCentimos * 0.65),
      }))
    );
  };

  const draftTotalCentimos = draftLines.reduce(
    (acc, l) => acc + l.cantidad * l.costoUnitarioCentimos,
    0
  );

  const submitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProveedorId || draftLines.length === 0) {
      setError('Seleccione un proveedor y añada al menos un producto al borrador.');
      return;
    }
    setCreatingOrder(true);
    setError(null);
    try {
      const res = await apiFetch<{ ordenId: string; numeroOrden: string }>('/api/compras/ordenes', {
        method: 'POST',
        body: JSON.stringify({
          proveedorId: selectedProveedorId,
          urgencia,
          fechaEstimadaEntrega: fechaEstimada || null,
          observaciones: observaciones.trim() || null,
          items: draftLines.map((l) => ({
            productoId: l.producto.productoId,
            cantidad: l.cantidad,
            costoUnitarioCentimos: l.costoUnitarioCentimos,
          })),
        }),
      });
      setDraftLines([]);
      setObservaciones('');
      setFeedback(
        `Orden ${res.numeroOrden} creada en estado Pendiente. El stock se incrementará al confirmar la recepción.`
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la orden.');
    } finally {
      setCreatingOrder(false);
    }
  };

  const markOrderSent = async (ordenId: string) => {
    try {
      await apiFetch(`/api/compras/ordenes/${ordenId}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: 'ENVIADO' }),
      });
      setFeedback('Orden marcada como Enviada al proveedor (compromiso sin ingreso de stock aún).');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el estado.');
    }
  };

  const openReceiveOrder = (ord: PurchaseOrderRow) => {
    setReceiveOrder(ord);
    setDirectReceptionOpen(false);
    setRecDocRef('');
    setRecObs('');
    setRecError(null);
    setRecLines(
      ord.items
        .map((it) => {
          const pend = Math.max(0, it.cantidadSolicitada - it.cantidadRecibida);
          return {
            ordenDetalleId: it.ordenDetalleId,
            productoId: it.productoId,
            sku: it.sku,
            productoNombre: it.productoNombre,
            pendiente: pend,
            cantidadRecibida: pend,
            numeroLote: '',
            fechaVencimiento: '',
            costoUnitarioSoles: (it.costoUnitarioCentimos / 100).toFixed(2),
          };
        })
        .filter((l) => l.pendiente > 0)
    );
  };

  const openDirectReception = (supList = suppliers, prodList = products) => {
    setReceiveOrder(null);
    setDirectReceptionOpen(true);
    setRecDocRef('');
    setRecObs('Recepción directa en almacén');
    setRecError(null);
    if (!selectedProveedorId && supList.length > 0) {
      setSelectedProveedorId(supList[0].proveedorId);
    }
    const firstProd = prodList[0];
    setRecLines(
      firstProd
        ? [
            {
              productoId: firstProd.productoId,
              sku: firstProd.sku,
              productoNombre: firstProd.nombre,
              pendiente: 0,
              cantidadRecibida: 10,
              numeroLote: '',
              fechaVencimiento: '',
              costoUnitarioSoles: (firstProd.costoPromedioCentimos / 100 || 10).toFixed(2),
            },
          ]
        : []
    );
  };

  const submitReception = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecError(null);
    const validLines = recLines.filter((l) => l.cantidadRecibida > 0);
    if (!recDocRef.trim() || validLines.length === 0) {
      setRecError('Ingrese el documento de referencia y al menos una línea con cantidad > 0.');
      return;
    }
    for (const l of validLines) {
      if (!l.numeroLote.trim() || !l.fechaVencimiento) {
        setRecError(`Complete número de lote y vencimiento para ${l.productoNombre}.`);
        return;
      }
    }
    setRecSaving(true);
    try {
      await apiFetch('/api/compras/recepciones', {
        method: 'POST',
        body: JSON.stringify({
          ordenId: receiveOrder?.ordenId || null,
          proveedorId: receiveOrder?.proveedorId || selectedProveedorId,
          documentoReferencia: recDocRef.trim(),
          observaciones: recObs.trim() || null,
          idempotencyKey: crypto.randomUUID(),
          items: validLines.map((l) => ({
            ordenDetalleId: l.ordenDetalleId || null,
            productoId: l.productoId,
            numeroLote: l.numeroLote.trim().toUpperCase(),
            fechaVencimiento: l.fechaVencimiento,
            cantidadRecibida: Number(l.cantidadRecibida),
            costoUnitarioCentimos: solesToCentimos(l.costoUnitarioSoles),
          })),
        }),
      });
      setReceiveOrder(null);
      setDirectReceptionOpen(false);
      setFeedback(`Recepción ${recDocRef} confirmada. Stock por lote y Kardex actualizados.`);
      await loadAll();
    } catch (err) {
      setRecError(err instanceof Error ? err.message : 'No se pudo confirmar la recepción.');
    } finally {
      setRecSaving(false);
    }
  };

  const createSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setSupError(null);
    try {
      const res = await apiFetch<{ proveedorId: string; razonSocial: string }>('/api/proveedores', {
        method: 'POST',
        body: JSON.stringify(supForm),
      });
      setSupplierModalOpen(false);
      setSupForm({ ruc: '', razonSocial: '', contactoNombre: '', telefono: '', email: '', direccion: '' });
      setFeedback(`Proveedor ${res.razonSocial} registrado.`);
      await loadAll();
      setSelectedProveedorId(res.proveedorId);
    } catch (err) {
      setSupError(err instanceof Error ? err.message : 'No se pudo registrar el proveedor.');
    }
  };

  const filteredOrders = useMemo(() => {
    if (!ordersData) return [];
    const q = globalSearch.trim().toLowerCase();
    return ordersData.ordenes.filter((o) => {
      if (statusFilter === 'URGENTES' && o.urgencia !== 'CRITICA') return false;
      if (statusFilter === 'COMPLETADOS' && o.estado !== 'COMPLETADO') return false;
      if (q) {
        const hay =
          o.numeroOrden.toLowerCase().includes(q) ||
          o.proveedorNombre.toLowerCase().includes(q) ||
          o.proveedorRuc.includes(q);
        if (!hay) return false;
      }
      return true;
    });
  }, [ordersData, statusFilter, globalSearch]);

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#181D19]">Gestión de Compras y Proveedores</h1>
          <div className="text-xs text-[#6F7A70] mt-0.5">
            Módulo Administrativo / <span className="text-[#006A3B] font-semibold">Órdenes de Abastecimiento</span>
          </div>
        </div>
        {canReceive && (
          <button
            type="button"
            onClick={() => openDirectReception()}
            className="px-4 py-2 bg-[#006A3B] hover:bg-[#00522D] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 whitespace-nowrap"
          >
            <PackageCheck className="w-4 h-4" />
            <span>Recepción directa</span>
          </button>
        )}
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold text-[#006A3B] flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {feedback}
          </span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Cerrar">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-[#FFDAD6] border border-[#BA1A1A]/30 rounded-lg text-xs font-semibold text-[#93000A]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-12 gap-5">
        {/* Columna izquierda: Formulario de Requerimiento y Proveedores */}
        <div className="col-span-12 xl:col-span-4 space-y-5">
          <section className="bg-white border border-[#BECABE] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h2 className="text-sm font-bold text-[#181D19] flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-[#006A3B]" />
                <span>Formulario de requerimiento</span>
              </h2>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-[#6F7A70] uppercase mb-1">
                  Seleccionar proveedor
                </label>
                <select
                  value={selectedProveedorId}
                  onChange={(e) => setSelectedProveedorId(e.target.value)}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md bg-white font-semibold"
                >
                  <option value="">Seleccione proveedor...</option>
                  {suppliers.map((s) => (
                    <option key={s.proveedorId} value={s.proveedorId}>
                      {s.razonSocial} (RUC {s.ruc})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#6F7A70] uppercase mb-1">
                  Producto (buscar o elegir)
                </label>
                <input
                  type="text"
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Escriba nombre, SKU o principio activo..."
                  className="w-full px-3 py-1.5 border border-[#BECABE] rounded-md mb-1.5"
                />
                <select
                  aria-label="Producto seleccionado"
                  value={selectedProductId || matchingProducts[0]?.productoId || ''}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md bg-white"
                >
                  {matchingProducts.map((p) => (
                    <option key={p.productoId} value={p.productoId}>
                      {p.sku} — {p.nombre} (Disp: {p.stockDisponible})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-[#6F7A70] uppercase mb-1">
                    Cantidad
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={qtyStr}
                    onChange={(e) => setQtyStr(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-[#BECABE] rounded-md font-data-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#6F7A70] uppercase mb-1">
                    Costo S/
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={costStr}
                    onChange={(e) => setCostStr(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-[#BECABE] rounded-md font-data-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#6F7A70] uppercase mb-1">
                    Urgencia
                  </label>
                  <select
                    value={urgencia}
                    onChange={(e) => setUrgencia(e.target.value as 'NORMAL' | 'CRITICA')}
                    className="w-full px-2 py-1.5 border border-[#BECABE] rounded-md bg-white"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="CRITICA">Crítica</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                disabled={!canCreate || products.length === 0}
                onClick={addLineToDraft}
                className="w-full py-2 bg-[#005DB7] hover:bg-[#00468C] disabled:opacity-50 text-white font-bold rounded-lg flex items-center justify-center gap-1.5"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Añadir al borrador de orden</span>
              </button>

              {draftLines.length > 0 && (
                <form onSubmit={submitOrder} className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="text-[11px] font-bold text-[#6F7A70] uppercase">
                    Líneas en borrador ({draftLines.length})
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                    {draftLines.map((l) => (
                      <div
                        key={l.producto.productoId}
                        className="p-2 bg-[#F6FBF3] border border-emerald-200 rounded flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{l.producto.nombre}</div>
                          <div className="text-[11px] text-[#6F7A70] font-data-mono">
                            {l.cantidad} und × {formatPen(l.costoUnitarioCentimos)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftLines((prev) =>
                              prev.filter((x) => x.producto.productoId !== l.producto.productoId)
                            )
                          }
                          aria-label="Quitar línea"
                          className="text-[#BA1A1A] p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded flex items-center justify-between">
                    <span className="font-semibold text-[#006A3B]">Costo estimado total</span>
                    <span className="font-bold font-data-mono text-sm text-[#006A3B]">
                      {formatPen(draftTotalCentimos)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      aria-label="Fecha estimada de entrega"
                      value={fechaEstimada}
                      onChange={(e) => setFechaEstimada(e.target.value)}
                      className="px-2 py-1.5 border border-[#BECABE] rounded font-data-mono"
                    />
                    <input
                      type="text"
                      placeholder="Observación"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                      className="px-2 py-1.5 border border-[#BECABE] rounded"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={creatingOrder}
                    className="w-full py-2.5 bg-[#006A3B] hover:bg-[#00522D] text-white font-bold rounded-lg"
                  >
                    {creatingOrder ? 'Creando orden...' : 'Crear orden de compra'}
                  </button>
                </form>
              )}
            </div>
          </section>

          {/* Panel de Proveedores */}
          <section className="bg-white border border-[#BECABE] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#181D19]">Proveedores</h2>
              {canCreate && (
                <button
                  type="button"
                  onClick={() => {
                    setSupError(null);
                    setSupplierModalOpen(true);
                  }}
                  className="text-xs font-bold text-[#006A3B] hover:underline flex items-center gap-1"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Nuevo</span>
                </button>
              )}
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
              {suppliers.length === 0 ? (
                <p className="text-xs text-[#6F7A70] text-center py-3">
                  Sin proveedores registrados.
                </p>
              ) : (
                suppliers.map((s) => (
                  <div
                    key={s.proveedorId}
                    className="p-2.5 border border-slate-200 rounded-lg flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-[#181D19] truncate">{s.razonSocial}</div>
                      <div className="text-[11px] text-[#6F7A70] font-data-mono">
                        RUC: {s.ruc} · {s.contactoNombre}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-[#006A3B] font-data-mono">
                        {s.ordenesCount} órd.
                      </div>
                      <div className="text-[10px] text-[#6F7A70]">Puntaje: Sin datos</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Columna derecha: KPIs, Órdenes recientes, Stock crítico y Estados */}
        <div className="col-span-12 xl:col-span-8 space-y-5">
          {/* 3 Tarjetas de Estado */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white border border-[#BECABE] rounded-xl p-4">
              <div className="text-[11px] font-bold text-[#6F7A70] uppercase">Pendientes</div>
              <div className="text-2xl font-extrabold font-data-mono tabular-nums text-[#181D19] mt-1">
                {String(ordersData?.resumen.pendientes ?? 0).padStart(2, '0')}
              </div>
            </div>
            <div className="bg-white border border-[#BECABE] rounded-xl p-4">
              <div className="text-[11px] font-bold text-[#6F7A70] uppercase">
                Enviados / Rec. parcial
              </div>
              <div className="text-2xl font-extrabold font-data-mono tabular-nums text-[#005DB7] mt-1">
                {String(
                  (ordersData?.resumen.enviados ?? 0) + (ordersData?.resumen.recibidosParciales ?? 0)
                ).padStart(2, '0')}
              </div>
            </div>
            <div className="bg-white border border-[#BECABE] rounded-xl p-4">
              <div className="text-[11px] font-bold text-[#6F7A70] uppercase">Completados</div>
              <div className="text-2xl font-extrabold font-data-mono tabular-nums text-[#006A3B] mt-1">
                {String(ordersData?.resumen.completados ?? 0).padStart(2, '0')}
              </div>
            </div>
          </div>

          {/* Tabla Órdenes Recientes */}
          <section className="bg-white border border-[#BECABE] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#181D19]">Órdenes recientes</h2>
                <p className="text-[11px] text-[#6F7A70]">
                  Las órdenes pendientes o enviadas son compromisos; el stock aumenta solo al confirmar la recepción.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                {(['TODOS', 'URGENTES', 'COMPLETADOS'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setStatusFilter(f)}
                    className={`px-2.5 py-1 rounded border font-semibold ${
                      statusFilter === f
                        ? 'bg-emerald-50 border-[#006A3B] text-[#006A3B]'
                        : 'bg-white border-slate-200 text-[#3F4941]'
                    }`}
                  >
                    {f === 'TODOS' ? 'Todos' : f === 'URGENTES' ? 'Urgentes' : 'Completados'}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                  <tr>
                    <th className="px-3 py-2.5">ID Orden</th>
                    <th className="px-3 py-2.5">Proveedor</th>
                    <th className="px-3 py-2.5">Fecha</th>
                    <th className="px-3 py-2.5 text-right">Avance Rec.</th>
                    <th className="px-3 py-2.5 text-right">Monto Est.</th>
                    <th className="px-3 py-2.5 text-center">Estado</th>
                    <th className="px-3 py-2.5 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-[#6F7A70]">
                        Cargando órdenes de compra...
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-[#6F7A70]">
                        No hay órdenes que coincidan con el filtro.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((o) => (
                      <tr key={o.ordenId} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-data-mono font-bold text-[#006A3B] whitespace-nowrap">
                          <div>{o.numeroOrden}</div>
                          {o.urgencia === 'CRITICA' && (
                            <span className="text-[10px] font-bold text-[#BA1A1A]">URGENTE</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-[#181D19]">{o.proveedorNombre}</div>
                          <div className="text-[11px] text-[#6F7A70] font-data-mono">
                            RUC: {o.proveedorRuc}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-data-mono text-[#3F4941] whitespace-nowrap">
                          {formatLimaDate(o.creadoEn)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-data-mono tabular-nums whitespace-nowrap">
                          {o.totalUnidadesRecibidas} / {o.totalUnidadesSolicitadas} und
                        </td>
                        <td className="px-3 py-2.5 text-right font-data-mono tabular-nums font-bold whitespace-nowrap">
                          {formatPen(o.subtotalEstimadoCentimos)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                              o.estado === 'COMPLETADO'
                                ? 'bg-emerald-50 text-[#006A3B]'
                                : o.estado === 'RECIBIDO'
                                  ? 'bg-teal-50 text-teal-800'
                                  : o.estado === 'ENVIADO'
                                    ? 'bg-blue-50 text-[#005DB7]'
                                    : o.estado === 'CANCELADO'
                                      ? 'bg-[#FFDAD6] text-[#93000A]'
                                      : 'bg-amber-50 text-amber-800'
                            }`}
                          >
                            {o.estado}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => setDetailOrder(o)}
                              title="Ver detalle de orden"
                              className="p-1.5 rounded border border-slate-200 hover:bg-slate-100"
                              aria-label={`Ver detalle ${o.numeroOrden}`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {canCreate && o.estado === 'PENDIENTE' && (
                              <button
                                type="button"
                                onClick={() => markOrderSent(o.ordenId)}
                                title="Marcar como Enviado"
                                className="p-1.5 rounded border border-blue-200 text-[#005DB7] hover:bg-blue-50"
                                aria-label={`Enviar orden ${o.numeroOrden}`}
                              >
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canReceive &&
                              ['PENDIENTE', 'ENVIADO', 'RECIBIDO'].includes(o.estado) && (
                                <button
                                  type="button"
                                  onClick={() => openReceiveOrder(o)}
                                  title="Recibir mercadería por lote"
                                  className="px-2 py-1 rounded bg-[#006A3B] text-white font-bold inline-flex items-center gap-1"
                                >
                                  <Truck className="w-3.5 h-3.5" />
                                  <span>Recibir</span>
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Tarjetas inferiores: Stock Crítico + Indicadores sin datos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#006A3B] text-white rounded-xl p-5 flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-100">
                  Stock crítico detectado
                </div>
                <div className="text-2xl font-extrabold font-data-mono mt-1">
                  {criticalProducts.length} ítems
                </div>
                <p className="text-xs text-emerald-100 mt-1">
                  Productos iguales o debajo de su stock mínimo configurado.
                </p>
              </div>
              {canCreate && (
                <button
                  type="button"
                  onClick={generateCriticalDraft}
                  className="px-3.5 py-2 bg-white/15 hover:bg-white/25 border border-white/30 rounded-lg text-xs font-bold whitespace-nowrap"
                >
                  Generar borrador auto
                </button>
              )}
            </div>

            <div className="bg-white border border-[#BECABE] rounded-xl p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#181D19]">
                  Ahorro estimado del mes y puntaje de proveedor
                </span>
                <AlertTriangle className="w-4 h-4 text-[#6F7A70]" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 bg-slate-50 rounded border border-slate-200">
                  <div className="text-[#6F7A70]">Ahorro estimado</div>
                  <div className="font-bold text-[#181D19] mt-0.5">
                    {ordersData?.resumen.ahorroEstimadoEstado || 'Sin datos'}
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded border border-slate-200">
                  <div className="text-[#6F7A70]">Puntaje proveedor</div>
                  <div className="font-bold text-[#181D19] mt-0.5">
                    {ordersData?.resumen.puntajeProveedorEstado || 'Sin datos'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Nuevo Proveedor */}
      {supplierModalOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Nuevo proveedor"
        >
          <div className="bg-white rounded-xl border border-[#BECABE] max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-[#181D19]">Registrar proveedor</h2>
              <button type="button" onClick={() => setSupplierModalOpen(false)} aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            {supError && (
              <div className="p-2.5 bg-[#FFDAD6] text-[#93000A] text-xs font-semibold rounded">
                {supError}
              </div>
            )}
            <form onSubmit={createSupplier} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">RUC (11 dígitos) *</label>
                <input
                  type="text"
                  required
                  maxLength={11}
                  value={supForm.ruc}
                  onChange={(e) => setSupForm({ ...supForm, ruc: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Razón social *</label>
                <input
                  type="text"
                  required
                  value={supForm.razonSocial}
                  onChange={(e) => setSupForm({ ...supForm, razonSocial: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Nombre de contacto *</label>
                <input
                  type="text"
                  required
                  value={supForm.contactoNombre}
                  onChange={(e) => setSupForm({ ...supForm, contactoNombre: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold mb-1">Teléfono</label>
                  <input
                    type="text"
                    value={supForm.telefono}
                    onChange={(e) => setSupForm({ ...supForm, telefono: e.target.value })}
                    className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Email</label>
                  <input
                    type="email"
                    value={supForm.email}
                    onChange={(e) => setSupForm({ ...supForm, email: e.target.value })}
                    className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSupplierModalOpen(false)}
                  className="px-4 py-2 border border-[#BECABE] rounded-md font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#006A3B] text-white rounded-md font-bold"
                >
                  Guardar proveedor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Detalle de Orden */}
      {detailOrder && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Detalle de orden"
        >
          <div className="bg-white rounded-xl border border-[#BECABE] max-w-2xl w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-[#181D19]">
                  Orden {detailOrder.numeroOrden}
                </h2>
                <p className="text-xs text-[#6F7A70]">
                  {detailOrder.proveedorNombre} (RUC {detailOrder.proveedorRuc}) · Estado:{' '}
                  {detailOrder.estado}
                </p>
              </div>
              <button type="button" onClick={() => setDetailOrder(null)} aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Solicitado</th>
                  <th className="px-3 py-2 text-right">Recibido</th>
                  <th className="px-3 py-2 text-right">Costo Unit.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detailOrder.items.map((it) => (
                  <tr key={it.ordenDetalleId}>
                    <td className="px-3 py-2 font-data-mono">{it.sku}</td>
                    <td className="px-3 py-2 font-semibold">{it.productoNombre}</td>
                    <td className="px-3 py-2 text-right font-data-mono">{it.cantidadSolicitada}</td>
                    <td className="px-3 py-2 text-right font-data-mono font-bold text-[#006A3B]">
                      {it.cantidadRecibida}
                    </td>
                    <td className="px-3 py-2 text-right font-data-mono">
                      {formatPen(it.costoUnitarioCentimos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Recepción por Lote */}
      {(receiveOrder || directReceptionOpen) && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Recepción de mercadería por lote"
        >
          <div className="bg-white rounded-xl border border-[#BECABE] max-w-3xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-[#181D19]">
                  {receiveOrder
                    ? `Recepción de orden ${receiveOrder.numeroOrden}`
                    : 'Recepción directa en almacén'}
                </h2>
                <p className="text-xs text-[#6F7A70]">
                  Registre lote, fecha de vencimiento y costo real para actualizar inventario y Kardex.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReceiveOrder(null);
                  setDirectReceptionOpen(false);
                }}
                aria-label="Cerrar"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {recError && (
              <div className="p-2.5 bg-[#FFDAD6] text-[#93000A] text-xs font-semibold rounded">
                {recError}
              </div>
            )}

            <form onSubmit={submitReception} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">
                    Documento de referencia (Guía / Factura) *
                  </label>
                  <input
                    type="text"
                    required
                    value={recDocRef}
                    onChange={(e) => setRecDocRef(e.target.value)}
                    placeholder="Ej. F001-002391"
                    className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                  />
                </div>
                {directReceptionOpen ? (
                  <div>
                    <label className="block font-semibold mb-1">Proveedor *</label>
                    <select
                      value={selectedProveedorId}
                      onChange={(e) => setSelectedProveedorId(e.target.value)}
                      className="w-full px-3 py-2 border border-[#BECABE] rounded-md bg-white"
                    >
                      {suppliers.map((s) => (
                        <option key={s.proveedorId} value={s.proveedorId}>
                          {s.razonSocial}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block font-semibold mb-1">Observaciones</label>
                    <input
                      type="text"
                      value={recObs}
                      onChange={(e) => setRecObs(e.target.value)}
                      placeholder="Ej. Bultos completos y sellados"
                      className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {recLines.map((line, idx) => (
                  <div
                    key={`${line.productoId}-${idx}`}
                    className="p-3 bg-[#F6FBF3] border border-[#BECABE] rounded-lg grid grid-cols-1 sm:grid-cols-12 gap-2 items-end"
                  >
                    <div className="sm:col-span-4">
                      <label className="block font-semibold mb-1">Producto</label>
                      {directReceptionOpen ? (
                        <select
                          value={line.productoId}
                          onChange={(e) => {
                            const p = products.find((pr) => pr.productoId === e.target.value);
                            if (!p) return;
                            const next = [...recLines];
                            next[idx] = {
                              ...next[idx],
                              productoId: p.productoId,
                              sku: p.sku,
                              productoNombre: p.nombre,
                            };
                            setRecLines(next);
                          }}
                          className="w-full px-2 py-1.5 border border-[#BECABE] rounded bg-white"
                        >
                          {products.map((p) => (
                            <option key={p.productoId} value={p.productoId}>
                              {p.sku} — {p.nombre}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="font-bold text-[#181D19]">
                          {line.productoNombre}{' '}
                          <span className="text-[#6F7A70] font-normal">
                            (Pend: {line.pendiente})
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold mb-1">Cant. rec.</label>
                      <input
                        type="number"
                        min={0}
                        value={line.cantidadRecibida}
                        onChange={(e) => {
                          const next = [...recLines];
                          next[idx] = {
                            ...next[idx],
                            cantidadRecibida: Math.max(0, Math.trunc(Number(e.target.value || 0))),
                          };
                          setRecLines(next);
                        }}
                        className="w-full px-2 py-1.5 border border-[#BECABE] rounded bg-white font-data-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold mb-1">N° Lote *</label>
                      <input
                        type="text"
                        required={line.cantidadRecibida > 0}
                        value={line.numeroLote}
                        onChange={(e) => {
                          const next = [...recLines];
                          next[idx] = { ...next[idx], numeroLote: e.target.value };
                          setRecLines(next);
                        }}
                        className="w-full px-2 py-1.5 border border-[#BECABE] rounded bg-white font-data-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold mb-1">Vencimiento *</label>
                      <input
                        type="date"
                        required={line.cantidadRecibida > 0}
                        value={line.fechaVencimiento}
                        onChange={(e) => {
                          const next = [...recLines];
                          next[idx] = { ...next[idx], fechaVencimiento: e.target.value };
                          setRecLines(next);
                        }}
                        className="w-full px-2 py-1.5 border border-[#BECABE] rounded bg-white font-data-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold mb-1">Costo S/</label>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={line.costoUnitarioSoles}
                        onChange={(e) => {
                          const next = [...recLines];
                          next[idx] = { ...next[idx], costoUnitarioSoles: e.target.value };
                          setRecLines(next);
                        }}
                        className="w-full px-2 py-1.5 border border-[#BECABE] rounded bg-white font-data-mono"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setReceiveOrder(null);
                    setDirectReceptionOpen(false);
                  }}
                  className="px-4 py-2 border border-[#BECABE] rounded-md font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={recSaving}
                  className="px-4 py-2 bg-[#006A3B] hover:bg-[#00522D] text-white rounded-md font-bold"
                >
                  {recSaving ? 'Confirmando...' : 'Confirmar recepción por lote'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
