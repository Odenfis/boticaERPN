import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  History,
  Layers,
  PackagePlus,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatLimaDate, formatPen, solesToCentimos, todayLimaIso } from '../lib/format';
import type { AuthUser, LotRow, ProductRow, SupplierRow } from '../types/erp';

interface InventarioViewProps {
  user: AuthUser;
  globalSearch: string;
  initialFilter?: string;
  onOpenKardex: (productId: string) => void;
}

interface ProductsResponse {
  items: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  kpis: {
    totalSkus: number;
    stockCriticoCount: number;
    porVencer30Count: number;
    vencidosCount: number;
    valorTotalCentimos: number;
  };
  filtros: {
    categorias: string[];
    laboratorios: string[];
  };
}

export function InventarioView({
  user,
  globalSearch,
  initialFilter,
  onOpenKardex,
}: InventarioViewProps) {
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [localSearch, setLocalSearch] = useState('');
  const [categoria, setCategoria] = useState('TODAS');
  const [laboratorio, setLaboratorio] = useState('TODOS');
  const [vencimiento, setVencimiento] = useState<string>(''); // '', '30', '60', 'vencidos'
  const [stockCritico, setStockCritico] = useState(false);
  const [sort, setSort] = useState('nombre_asc');
  const [page, setPage] = useState(1);

  // Modales
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [prodForm, setProdForm] = useState({
    sku: '',
    codigoBarras: '',
    nombre: '',
    principioActivo: '',
    concentracion: '',
    presentacion: '',
    laboratorio: '',
    categoria: '',
    registroSanitario: '',
    condicionVenta: 'OTC' as 'OTC' | 'RECETA',
    unidadInventario: 'Unidad',
    stockMinimo: '10',
    precioVentaSoles: '',
    gravadoIgv: true,
    ubicacionPasillo: '',
    ubicacionEstante: '',
    temperaturaAlmacen: 'Ambiente (15°C - 25°C)',
  });
  const [prodSaving, setProdSaving] = useState(false);
  const [prodError, setProdError] = useState<string | null>(null);

  const [lotsModalProduct, setLotsModalProduct] = useState<ProductRow | null>(null);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);

  const [adjustLot, setAdjustLot] = useState<LotRow | null>(null);
  const [adjustDelta, setAdjustDelta] = useState('0');
  const [adjustAptitud, setAdjustAptitud] = useState<LotRow['estadoAptitud']>('APTO');
  const [adjustMotivo, setAdjustMotivo] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // Ingreso directo a almacén
  const [ingressOpen, setIngressOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [ingressForm, setIngressForm] = useState({
    proveedorId: '',
    documentoReferencia: '',
    productoId: '',
    numeroLote: '',
    fechaVencimiento: '',
    cantidadRecibida: '10',
    costoUnitarioSoles: '',
    observaciones: '',
  });
  const [ingressSaving, setIngressSaving] = useState(false);
  const [ingressError, setIngressError] = useState<string | null>(null);

  const canEdit = user.permisos.includes('inventario.editar');
  const canAdjust = user.permisos.includes('inventario.ajustar');
  const canReceive = user.permisos.includes('compras.recibir');
  const canViewKardex = user.permisos.includes('kardex.ver');

  useEffect(() => {
    if (!initialFilter) return;
    if (initialFilter === 'stockCritico') {
      setStockCritico(true);
      setVencimiento('');
    } else if (['30', '60', 'vencidos'].includes(initialFilter)) {
      setVencimiento(initialFilter);
      setStockCritico(false);
    }
    setPage(1);
  }, [initialFilter]);

  const effectiveSearch = (localSearch || globalSearch).trim();

  const loadProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        sort,
      });
      if (effectiveSearch) qs.set('q', effectiveSearch);
      if (categoria !== 'TODAS') qs.set('categoria', categoria);
      if (laboratorio !== 'TODOS') qs.set('laboratorio', laboratorio);
      if (vencimiento) qs.set('vencimiento', vencimiento);
      if (stockCritico) qs.set('stockCritico', 'true');

      const res = await apiFetch<ProductsResponse>(`/api/productos?${qs.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando inventario.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, [effectiveSearch, categoria, laboratorio, vencimiento, stockCritico, sort, page]);

  const openNewProduct = () => {
    setEditingProduct(null);
    setProdError(null);
    setProdForm({
      sku: '',
      codigoBarras: '',
      nombre: '',
      principioActivo: '',
      concentracion: '',
      presentacion: '',
      laboratorio: '',
      categoria: '',
      registroSanitario: '',
      condicionVenta: 'OTC',
      unidadInventario: 'Unidad',
      stockMinimo: '10',
      precioVentaSoles: '',
      gravadoIgv: true,
      ubicacionPasillo: '',
      ubicacionEstante: '',
      temperaturaAlmacen: 'Ambiente (15°C - 25°C)',
    });
    setProductModalOpen(true);
  };

  const openEditProduct = (p: ProductRow) => {
    setEditingProduct(p);
    setProdError(null);
    setProdForm({
      sku: p.sku,
      codigoBarras: p.codigoBarras || '',
      nombre: p.nombre,
      principioActivo: p.principioActivo,
      concentracion: p.concentracion,
      presentacion: p.presentacion,
      laboratorio: p.laboratorio,
      categoria: p.categoria,
      registroSanitario: p.registroSanitario || '',
      condicionVenta: p.condicionVenta,
      unidadInventario: p.unidadInventario,
      stockMinimo: String(p.stockMinimo),
      precioVentaSoles: (p.precioVentaCentimos / 100).toFixed(2),
      gravadoIgv: p.gravadoIgv,
      ubicacionPasillo: p.ubicacionPasillo || '',
      ubicacionEstante: p.ubicacionEstante || '',
      temperaturaAlmacen: p.temperaturaAlmacen || '',
    });
    setProductModalOpen(true);
  };

  const saveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setProdError(null);
    const precioVentaCentimos = solesToCentimos(prodForm.precioVentaSoles);
    if (precioVentaCentimos <= 0) {
      setProdError('Ingrese un precio de venta válido en soles (mayor a 0).');
      return;
    }
    setProdSaving(true);
    try {
      const payload = {
        sku: prodForm.sku,
        codigoBarras: prodForm.codigoBarras || null,
        nombre: prodForm.nombre,
        principioActivo: prodForm.principioActivo,
        concentracion: prodForm.concentracion,
        presentacion: prodForm.presentacion,
        laboratorio: prodForm.laboratorio,
        categoria: prodForm.categoria,
        registroSanitario: prodForm.registroSanitario || null,
        condicionVenta: prodForm.condicionVenta,
        unidadInventario: prodForm.unidadInventario,
        stockMinimo: Number(prodForm.stockMinimo || 0),
        precioVentaCentimos,
        gravadoIgv: prodForm.gravadoIgv,
        igvPorcentaje: prodForm.gravadoIgv ? 18 : 0,
        ubicacionPasillo: prodForm.ubicacionPasillo || null,
        ubicacionEstante: prodForm.ubicacionEstante || null,
        temperaturaAlmacen: prodForm.temperaturaAlmacen || null,
      };
      if (editingProduct) {
        await apiFetch(`/api/productos/${editingProduct.productoId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setFeedback(`Producto ${prodForm.nombre} actualizado.`);
      } else {
        await apiFetch('/api/productos', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setFeedback(`Producto ${prodForm.nombre} registrado.`);
      }
      setProductModalOpen(false);
      await loadProducts();
    } catch (err) {
      setProdError(err instanceof Error ? err.message : 'No se pudo guardar el producto.');
    } finally {
      setProdSaving(false);
    }
  };

  const openLotsModal = async (p: ProductRow) => {
    setLotsModalProduct(p);
    setLotsLoading(true);
    setAdjustLot(null);
    try {
      const res = await apiFetch<{ lotes: LotRow[] }>(`/api/productos/${p.productoId}/lotes`);
      setLots(res.lotes);
    } catch {
      setLots([]);
    } finally {
      setLotsLoading(false);
    }
  };

  const openAdjustForLot = (l: LotRow) => {
    setAdjustLot(l);
    setAdjustDelta('0');
    setAdjustAptitud(l.estadoAptitud);
    setAdjustMotivo('');
    setAdjustError(null);
  };

  const submitAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lotsModalProduct || !adjustLot) return;
    setAdjustError(null);
    if (!adjustMotivo.trim()) {
      setAdjustError('Debe indicar el motivo del ajuste para auditoría.');
      return;
    }
    setAdjustSaving(true);
    try {
      await apiFetch('/api/inventario/ajuste', {
        method: 'POST',
        body: JSON.stringify({
          productoId: lotsModalProduct.productoId,
          loteId: adjustLot.loteId,
          deltaCantidad: Number(adjustDelta || 0),
          nuevoEstadoAptitud: adjustAptitud,
          motivo: adjustMotivo.trim(),
        }),
      });
      setFeedback(`Ajuste registrado en lote ${adjustLot.numeroLote}.`);
      setAdjustLot(null);
      await openLotsModal(lotsModalProduct);
      await loadProducts();
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'No se pudo aplicar el ajuste.');
    } finally {
      setAdjustSaving(false);
    }
  };

  const openIngressModal = async (preselectedProdId?: string) => {
    setIngressError(null);
    setIngressForm({
      proveedorId: '',
      documentoReferencia: '',
      productoId: preselectedProdId || data?.items[0]?.productoId || '',
      numeroLote: '',
      fechaVencimiento: '',
      cantidadRecibida: '10',
      costoUnitarioSoles: '',
      observaciones: '',
    });
    setIngressOpen(true);
    try {
      const res = await apiFetch<{ proveedores: SupplierRow[] }>('/api/proveedores');
      setSuppliers(res.proveedores);
      if (res.proveedores.length > 0) {
        setIngressForm((prev) => ({ ...prev, proveedorId: res.proveedores[0].proveedorId }));
      }
    } catch {
      // keep empty
    }
  };

  const submitIngress = async (e: React.FormEvent) => {
    e.preventDefault();
    setIngressError(null);
    const costoCent = solesToCentimos(ingressForm.costoUnitarioSoles);
    const qty = Number(ingressForm.cantidadRecibida);
    if (!ingressForm.proveedorId || !ingressForm.documentoReferencia.trim() || !ingressForm.productoId) {
      setIngressError('Proveedor, documento de referencia y producto son obligatorios.');
      return;
    }
    if (!ingressForm.numeroLote.trim() || !ingressForm.fechaVencimiento || qty <= 0) {
      setIngressError('Complete lote, fecha de vencimiento y cantidad positiva.');
      return;
    }
    setIngressSaving(true);
    try {
      await apiFetch('/api/compras/recepciones', {
        method: 'POST',
        body: JSON.stringify({
          proveedorId: ingressForm.proveedorId,
          documentoReferencia: ingressForm.documentoReferencia.trim(),
          observaciones: ingressForm.observaciones.trim() || 'Ingreso directo desde Inventario',
          idempotencyKey: crypto.randomUUID(),
          items: [
            {
              productoId: ingressForm.productoId,
              numeroLote: ingressForm.numeroLote.trim().toUpperCase(),
              fechaVencimiento: ingressForm.fechaVencimiento,
              cantidadRecibida: qty,
              costoUnitarioCentimos: costoCent,
            },
          ],
        }),
      });
      setIngressOpen(false);
      setFeedback(`Ingreso de mercadería registrado (${ingressForm.documentoReferencia}).`);
      await loadProducts();
    } catch (err) {
      setIngressError(err instanceof Error ? err.message : 'No se pudo registrar el ingreso.');
    } finally {
      setIngressSaving(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const todayIso = todayLimaIso();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#181D19]">Gestión de Inventario y Lotes</h1>
          <p className="text-xs text-[#6F7A70] mt-0.5">
            Distinción entre existencias físicas totales y stock disponible vendible (lotes aptos y vigentes).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canReceive && (
            <button
              type="button"
              onClick={() => openIngressModal()}
              className="px-3.5 py-2 bg-[#005DB7] hover:bg-[#00468C] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <PackagePlus className="w-4 h-4" />
              <span>Ingreso de mercadería</span>
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={openNewProduct}
              className="px-3.5 py-2 bg-[#006A3B] hover:bg-[#00522D] text-white text-xs font-bold rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo producto</span>
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold text-[#006A3B] flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {feedback}
          </span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Cerrar aviso">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Barra de Filtros */}
      <div className="bg-white border border-[#BECABE] rounded-lg p-3.5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-[#6F7A70] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={localSearch}
            onChange={(e) => {
              setLocalSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Filtrar por nombre, SKU, código o principio activo..."
            className="w-full pl-9 pr-3 py-1.5 bg-[#F0F5EE] border border-[#BECABE] rounded-md text-xs"
          />
        </div>

        <select
          aria-label="Filtrar por categoría"
          value={categoria}
          onChange={(e) => {
            setCategoria(e.target.value);
            setPage(1);
          }}
          className="px-2.5 py-1.5 border border-[#BECABE] rounded-md text-xs bg-white"
        >
          <option value="TODAS">Todas las categorías</option>
          {data?.filtros.categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          aria-label="Filtrar por laboratorio"
          value={laboratorio}
          onChange={(e) => {
            setLaboratorio(e.target.value);
            setPage(1);
          }}
          className="px-2.5 py-1.5 border border-[#BECABE] rounded-md text-xs bg-white"
        >
          <option value="TODOS">Todos los laboratorios</option>
          {data?.filtros.laboratorios.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        <select
          aria-label="Ventana de vencimiento"
          value={vencimiento}
          onChange={(e) => {
            setVencimiento(e.target.value);
            setPage(1);
          }}
          className="px-2.5 py-1.5 border border-[#BECABE] rounded-md text-xs bg-white"
        >
          <option value="">Vencimiento: Todos</option>
          <option value="30">Por vencer (30 días)</option>
          <option value="60">Por vencer (60 días)</option>
          <option value="vencidos">Solo lotes vencidos</option>
        </select>

        <button
          type="button"
          onClick={() => {
            setStockCritico((v) => !v);
            setPage(1);
          }}
          className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-colors whitespace-nowrap ${
            stockCritico
              ? 'bg-[#FFDAD6] border-[#BA1A1A] text-[#93000A]'
              : 'bg-white border-[#BECABE] text-[#3F4941] hover:bg-slate-50'
          }`}
        >
          Solo stock crítico
        </button>

        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="w-3.5 h-3.5 text-[#6F7A70]" />
          <select
            aria-label="Ordenar productos"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="px-2 py-1.5 border border-[#BECABE] rounded-md text-xs bg-white"
          >
            <option value="nombre_asc">Nombre (A-Z)</option>
            <option value="stock_asc">Stock disponible (menor)</option>
            <option value="stock_desc">Stock disponible (mayor)</option>
            <option value="vencimiento_asc">Vencimiento más próximo</option>
            <option value="precio_desc">Precio (mayor)</option>
          </select>
        </div>
      </div>

      {/* Tabla principal */}
      <div className="bg-white border border-[#BECABE] rounded-lg overflow-hidden">
        {error ? (
          <div className="p-6 text-center text-sm text-[#BA1A1A] space-y-2">
            <p>{error}</p>
            <button
              type="button"
              onClick={loadProducts}
              className="px-3 py-1.5 bg-[#006A3B] text-white text-xs font-bold rounded"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[520px] custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase z-10">
                <tr>
                  <th className="px-3 py-2.5">Código</th>
                  <th className="px-3 py-2.5">Producto</th>
                  <th className="px-3 py-2.5">Laboratorio</th>
                  <th className="px-3 py-2.5">Presentación</th>
                  <th className="px-3 py-2.5 text-right">Físico / Disp.</th>
                  <th className="px-3 py-2.5 text-right">Mín.</th>
                  <th className="px-3 py-2.5 text-right">Costo Prom.</th>
                  <th className="px-3 py-2.5 text-right">P. Venta</th>
                  <th className="px-3 py-2.5 text-right">Próx. Venc.</th>
                  <th className="px-3 py-2.5 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-[#6F7A70]">
                      Cargando catálogo de productos y lotes...
                    </td>
                  </tr>
                ) : !data || data.items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-[#6F7A70]">
                      No se encontraron productos con los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  data.items.map((p) => {
                    const isCritical = p.stockDisponible <= p.stockMinimo;
                    return (
                      <tr key={p.productoId} className="hover:bg-slate-50/80">
                        <td className="px-3 py-2.5 font-data-mono font-semibold text-[#3F4941] whitespace-nowrap">
                          {p.sku}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-bold text-[#181D19] flex items-center gap-1.5">
                            <span>{p.nombre}</span>
                            {p.requiereReceta && (
                              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#005DB7] text-[10px] font-bold">
                                Receta
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#6F7A70]">
                            {p.principioActivo} · {p.concentracion}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-[#3F4941]">{p.laboratorio}</td>
                        <td className="px-3 py-2.5 text-[#3F4941]">{p.presentacion}</td>
                        <td className="px-3 py-2.5 text-right font-data-mono tabular-nums whitespace-nowrap">
                          <span className="text-[#6F7A70]">{p.stockFisico}</span>
                          <span className="mx-1 text-slate-300">/</span>
                          <span
                            className={`font-bold ${
                              isCritical ? 'text-[#BA1A1A]' : 'text-[#006A3B]'
                            }`}
                          >
                            {p.stockDisponible}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-data-mono tabular-nums text-[#6F7A70]">
                          {p.stockMinimo}
                        </td>
                        <td className="px-3 py-2.5 text-right font-data-mono tabular-nums text-[#3F4941]">
                          {formatPen(p.costoPromedioCentimos)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-data-mono tabular-nums font-bold text-[#181D19]">
                          {formatPen(p.precioVentaCentimos)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-data-mono tabular-nums whitespace-nowrap">
                          {p.proximoVencimiento ? (
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                                p.tieneLotesVencidos
                                  ? 'bg-[#FFDAD6] text-[#93000A]'
                                  : p.tieneLotesPorVencer
                                    ? 'bg-amber-50 text-amber-800'
                                    : 'text-[#3F4941]'
                              }`}
                            >
                              {formatLimaDate(p.proximoVencimiento)}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => openLotsModal(p)}
                              title="Ver lotes y ajustar stock"
                              className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 text-[#181D19] font-semibold flex items-center gap-1"
                            >
                              <Layers className="w-3.5 h-3.5" />
                              <span>Lotes</span>
                            </button>
                            {canViewKardex && (
                              <button
                                type="button"
                                onClick={() => onOpenKardex(p.productoId)}
                                title="Abrir Kardex del producto"
                                className="p-1.5 rounded border border-slate-200 hover:bg-emerald-50 text-[#006A3B]"
                                aria-label={`Ver Kardex de ${p.nombre}`}
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => openEditProduct(p)}
                                title="Editar producto"
                                className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 text-[#3F4941]"
                                aria-label={`Editar ${p.nombre}`}
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {data && (
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-[#6F7A70]">
            <span>
              Mostrando {data.items.length} de {data.total} productos
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded border border-slate-200 bg-white disabled:opacity-40"
                aria-label="Página anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-semibold text-[#181D19]">
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded border border-slate-200 bg-white disabled:opacity-40"
                aria-label="Página siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4 Tarjetas KPI inferiores */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="bg-white border border-[#BECABE] rounded-lg p-4">
            <div className="text-[11px] font-bold text-[#6F7A70] uppercase">Total SKUs activos</div>
            <div className="text-xl font-bold font-data-mono tabular-nums text-[#181D19] mt-1">
              {data.kpis.totalSkus}
            </div>
          </div>
          <div className="bg-white border border-[#BECABE] rounded-lg p-4">
            <div className="text-[11px] font-bold text-[#6F7A70] uppercase">Stock crítico</div>
            <div className="text-xl font-bold font-data-mono tabular-nums text-[#BA1A1A] mt-1">
              {data.kpis.stockCriticoCount}
            </div>
          </div>
          <div className="bg-white border border-[#BECABE] rounded-lg p-4">
            <div className="text-[11px] font-bold text-[#6F7A70] uppercase">
              Vencimientos (30d / vencidos)
            </div>
            <div className="text-xl font-bold font-data-mono tabular-nums text-[#973F4C] mt-1">
              {data.kpis.porVencer30Count} / {data.kpis.vencidosCount}
            </div>
          </div>
          <div className="bg-white border border-[#BECABE] rounded-lg p-4">
            <div className="text-[11px] font-bold text-[#6F7A70] uppercase">
              Valorización (costo adquisición)
            </div>
            <div className="text-xl font-bold font-data-mono tabular-nums text-[#006A3B] mt-1">
              {formatPen(data.kpis.valorTotalCentimos)}
            </div>
          </div>
        </div>
      )}

      {/* Modal Alta/Edición Producto */}
      {productModalOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={editingProduct ? 'Editar producto' : 'Nuevo producto'}
        >
          <div className="bg-white rounded-xl border border-[#BECABE] max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-[#181D19]">
                {editingProduct ? `Editar ${editingProduct.sku}` : 'Registrar nuevo producto'}
              </h2>
              <button type="button" onClick={() => setProductModalOpen(false)} aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {prodError && (
              <div className="p-3 bg-[#FFDAD6] text-[#93000A] text-xs font-semibold rounded-md">
                {prodError}
              </div>
            )}

            <form onSubmit={saveProduct} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">SKU *</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingProduct)}
                  value={prodForm.sku}
                  onChange={(e) => setProdForm({ ...prodForm, sku: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md disabled:bg-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">Código de barras</label>
                <input
                  type="text"
                  value={prodForm.codigoBarras}
                  onChange={(e) => setProdForm({ ...prodForm, codigoBarras: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-[#3F4941] mb-1">Nombre comercial *</label>
                <input
                  type="text"
                  required
                  value={prodForm.nombre}
                  onChange={(e) => setProdForm({ ...prodForm, nombre: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">Principio activo *</label>
                <input
                  type="text"
                  required
                  value={prodForm.principioActivo}
                  onChange={(e) => setProdForm({ ...prodForm, principioActivo: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">Concentración</label>
                <input
                  type="text"
                  value={prodForm.concentracion}
                  onChange={(e) => setProdForm({ ...prodForm, concentracion: e.target.value })}
                  placeholder="Ej. 500 mg"
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">Presentación *</label>
                <input
                  type="text"
                  required
                  value={prodForm.presentacion}
                  onChange={(e) => setProdForm({ ...prodForm, presentacion: e.target.value })}
                  placeholder="Ej. Caja x 20 tabletas"
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">Laboratorio *</label>
                <input
                  type="text"
                  required
                  value={prodForm.laboratorio}
                  onChange={(e) => setProdForm({ ...prodForm, laboratorio: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">Categoría *</label>
                <input
                  type="text"
                  required
                  value={prodForm.categoria}
                  onChange={(e) => setProdForm({ ...prodForm, categoria: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">Registro sanitario</label>
                <input
                  type="text"
                  value={prodForm.registroSanitario}
                  onChange={(e) => setProdForm({ ...prodForm, registroSanitario: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">Condición de venta</label>
                <select
                  value={prodForm.condicionVenta}
                  onChange={(e) =>
                    setProdForm({ ...prodForm, condicionVenta: e.target.value as 'OTC' | 'RECETA' })
                  }
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md bg-white"
                >
                  <option value="OTC">OTC (Venta libre)</option>
                  <option value="RECETA">Requiere receta médica</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">Stock mínimo</label>
                <input
                  type="number"
                  min={0}
                  value={prodForm.stockMinimo}
                  onChange={(e) => setProdForm({ ...prodForm, stockMinimo: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">
                  Precio venta (S/ incl. IGV) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.10"
                  required
                  value={prodForm.precioVentaSoles}
                  onChange={(e) => setProdForm({ ...prodForm, precioVentaSoles: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#3F4941] mb-1">Ubicación (Pasillo / Estante)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Pasillo"
                    value={prodForm.ubicacionPasillo}
                    onChange={(e) => setProdForm({ ...prodForm, ubicacionPasillo: e.target.value })}
                    className="w-full px-2.5 py-2 border border-[#BECABE] rounded-md"
                  />
                  <input
                    type="text"
                    placeholder="Estante"
                    value={prodForm.ubicacionEstante}
                    onChange={(e) => setProdForm({ ...prodForm, ubicacionEstante: e.target.value })}
                    className="w-full px-2.5 py-2 border border-[#BECABE] rounded-md"
                  />
                </div>
              </div>
              <div className="sm:col-span-2 flex items-center gap-2 pt-1">
                <input
                  id="prod-gravado-igv"
                  type="checkbox"
                  checked={prodForm.gravadoIgv}
                  onChange={(e) => setProdForm({ ...prodForm, gravadoIgv: e.target.checked })}
                />
                <label htmlFor="prod-gravado-igv" className="font-semibold text-[#3F4941]">
                  Producto gravado con IGV (18%)
                </label>
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="px-4 py-2 border border-[#BECABE] rounded-md font-semibold text-[#3F4941]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={prodSaving}
                  className="px-4 py-2 bg-[#006A3B] hover:bg-[#00522D] text-white rounded-md font-bold"
                >
                  {prodSaving ? 'Guardando...' : 'Guardar producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Detalle de Lotes y Ajuste */}
      {lotsModalProduct && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Detalle por lote"
        >
          <div className="bg-white rounded-xl border border-[#BECABE] max-w-3xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-[#181D19]">
                  Lotes de {lotsModalProduct.nombre}
                </h2>
                <p className="text-xs text-[#6F7A70]">
                  SKU: {lotsModalProduct.sku} · Stock Físico: {lotsModalProduct.stockFisico} · Vendible:{' '}
                  {lotsModalProduct.stockDisponible}
                </p>
              </div>
              <button type="button" onClick={() => setLotsModalProduct(null)} aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {lotsLoading ? (
              <div className="py-8 text-center text-xs text-[#6F7A70]">Cargando lotes...</div>
            ) : lots.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#6F7A70]">
                Este producto aún no tiene lotes ingresados en esta sucursal.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                  <tr>
                    <th className="px-3 py-2">Lote</th>
                    <th className="px-3 py-2">Vencimiento</th>
                    <th className="px-3 py-2 text-right">Costo Unit.</th>
                    <th className="px-3 py-2 text-right">Físico</th>
                    <th className="px-3 py-2 text-right">Disponible</th>
                    <th className="px-3 py-2">Aptitud</th>
                    {canAdjust && <th className="px-3 py-2 text-center">Ajustar</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lots.map((l) => {
                    const isExpired = l.fechaVencimiento < todayIso || l.estadoAptitud === 'VENCIDO';
                    return (
                      <tr key={l.loteId}>
                        <td className="px-3 py-2 font-data-mono font-bold">{l.numeroLote}</td>
                        <td className="px-3 py-2 font-data-mono">
                          {formatLimaDate(l.fechaVencimiento)}
                          {isExpired && (
                            <span className="ml-1.5 text-[10px] font-bold text-[#93000A]">
                              (Vencido)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-data-mono">
                          {formatPen(l.costoAdquisicionCentimos)}
                        </td>
                        <td className="px-3 py-2 text-right font-data-mono font-semibold">
                          {l.cantidadFisica}
                        </td>
                        <td className="px-3 py-2 text-right font-data-mono font-bold text-[#006A3B]">
                          {l.cantidadDisponible}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              l.estadoAptitud === 'APTO' && !isExpired
                                ? 'bg-emerald-50 text-[#006A3B]'
                                : l.estadoAptitud === 'CUARENTENA'
                                  ? 'bg-amber-50 text-amber-800'
                                  : 'bg-[#FFDAD6] text-[#93000A]'
                            }`}
                          >
                            {l.estadoAptitud}
                          </span>
                        </td>
                        {canAdjust && (
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => openAdjustForLot(l)}
                              className="px-2 py-1 rounded border border-[#BECABE] hover:bg-slate-50 font-semibold inline-flex items-center gap-1"
                            >
                              <SlidersHorizontal className="w-3 h-3" />
                              <span>Ajuste</span>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {adjustLot && (
              <form
                onSubmit={submitAdjust}
                className="p-4 bg-[#F6FBF3] border border-[#BECABE] rounded-lg space-y-3 text-xs"
              >
                <div className="font-bold text-[#181D19] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#005DB7]" />
                  <span>Ajuste de stock / aptitud — Lote {adjustLot.numeroLote}</span>
                </div>
                {adjustError && (
                  <div className="p-2 bg-[#FFDAD6] text-[#93000A] rounded font-semibold">
                    {adjustError}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">Variación cantidad (+/-)</label>
                    <input
                      type="number"
                      value={adjustDelta}
                      onChange={(e) => setAdjustDelta(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-[#BECABE] rounded bg-white font-data-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Estado aptitud</label>
                    <select
                      value={adjustAptitud}
                      onChange={(e) =>
                        setAdjustAptitud(e.target.value as LotRow['estadoAptitud'])
                      }
                      className="w-full px-2.5 py-1.5 border border-[#BECABE] rounded bg-white"
                    >
                      <option value="APTO">APTO</option>
                      <option value="CUARENTENA">CUARENTENA</option>
                      <option value="BLOQUEADO">BLOQUEADO</option>
                      <option value="VENCIDO">VENCIDO</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Motivo obligatorio *</label>
                    <input
                      type="text"
                      required
                      value={adjustMotivo}
                      onChange={(e) => setAdjustMotivo(e.target.value)}
                      placeholder="Ej. Merma, conteo físico..."
                      className="w-full px-2.5 py-1.5 border border-[#BECABE] rounded bg-white"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustLot(null)}
                    className="px-3 py-1.5 border border-[#BECABE] rounded bg-white font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={adjustSaving}
                    className="px-3 py-1.5 bg-[#006A3B] text-white rounded font-bold"
                  >
                    {adjustSaving ? 'Aplicando...' : 'Confirmar ajuste'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal Ingreso Directo a Almacén */}
      {ingressOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Ingreso directo de mercadería"
        >
          <div className="bg-white rounded-xl border border-[#BECABE] max-w-lg w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-[#181D19]">Ingreso directo de mercadería</h2>
              <button type="button" onClick={() => setIngressOpen(false)} aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            {ingressError && (
              <div className="p-2.5 bg-[#FFDAD6] text-[#93000A] text-xs font-semibold rounded">
                {ingressError}
              </div>
            )}
            <form onSubmit={submitIngress} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Proveedor *</label>
                <select
                  required
                  value={ingressForm.proveedorId}
                  onChange={(e) => setIngressForm({ ...ingressForm, proveedorId: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md bg-white"
                >
                  <option value="">Seleccione proveedor</option>
                  {suppliers.map((s) => (
                    <option key={s.proveedorId} value={s.proveedorId}>
                      {s.razonSocial} (RUC {s.ruc})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Documento de referencia (Guía/Factura) *</label>
                <input
                  type="text"
                  required
                  value={ingressForm.documentoReferencia}
                  onChange={(e) =>
                    setIngressForm({ ...ingressForm, documentoReferencia: e.target.value })
                  }
                  placeholder="Ej. GR-001-00451"
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Producto *</label>
                <select
                  required
                  value={ingressForm.productoId}
                  onChange={(e) => setIngressForm({ ...ingressForm, productoId: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md bg-white"
                >
                  <option value="">Seleccione producto</option>
                  {data?.items.map((p) => (
                    <option key={p.productoId} value={p.productoId}>
                      {p.sku} — {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Número de lote *</label>
                  <input
                    type="text"
                    required
                    value={ingressForm.numeroLote}
                    onChange={(e) =>
                      setIngressForm({ ...ingressForm, numeroLote: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Fecha vencimiento *</label>
                  <input
                    type="date"
                    required
                    value={ingressForm.fechaVencimiento}
                    onChange={(e) =>
                      setIngressForm({ ...ingressForm, fechaVencimiento: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Cantidad recibida *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={ingressForm.cantidadRecibida}
                    onChange={(e) =>
                      setIngressForm({ ...ingressForm, cantidadRecibida: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Costo unitario (S/) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={ingressForm.costoUnitarioSoles}
                    onChange={(e) =>
                      setIngressForm({ ...ingressForm, costoUnitarioSoles: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIngressOpen(false)}
                  className="px-4 py-2 border border-[#BECABE] rounded-md font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={ingressSaving}
                  className="px-4 py-2 bg-[#006A3B] text-white rounded-md font-bold"
                >
                  {ingressSaving ? 'Registrando...' : 'Confirmar ingreso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
