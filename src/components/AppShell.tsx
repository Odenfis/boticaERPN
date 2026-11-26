import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  Boxes,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Wallet,
  X,
} from 'lucide-react';
import type { AppTab, AuthUser, OpenShiftSummary } from '../types/erp';

interface AppShellProps {
  user: AuthUser;
  openShift: OpenShiftSummary | null;
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onNewSaleF2: () => void;
  onLogout: () => void;
  globalSearch: string;
  onGlobalSearchChange: (value: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  alertCount: number;
  onOpenTopAction: (action: 'ventas' | 'recetas' | 'alertas' | 'caja') => void;
  children: React.ReactNode;
}

export function AppShell({
  user,
  openShift,
  activeTab,
  onSelectTab,
  onNewSaleF2,
  onLogout,
  globalSearch,
  onGlobalSearchChange,
  searchInputRef,
  alertCount,
  onOpenTopAction,
  children,
}: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const hasPerm = (perm: string) => user.permisos.includes(perm);
  const hasAnyPerm = (perms: string[]) => perms.some((p) => hasPerm(p));

  const navItems: Array<{
    id: AppTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
  }> = [
    { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard, visible: true },
    { id: 'pos', label: 'POS', icon: ShoppingBag, visible: hasPerm('pos.operar') },
    {
      id: 'inventario',
      label: 'Inventario',
      icon: Boxes,
      visible: hasPerm('inventario.ver'),
    },
    { id: 'compras', label: 'Compras', icon: ShoppingCart, visible: hasPerm('compras.ver') },
    { id: 'kardex', label: 'Kardex', icon: History, visible: hasPerm('kardex.ver') },
    { id: 'caja', label: 'Caja', icon: Wallet, visible: hasPerm('caja.operar') },
    { id: 'reportes', label: 'Reportes', icon: BarChart3, visible: hasPerm('reportes.ver') },
  ];

  const canConfigure = hasAnyPerm(['config.usuarios', 'config.parametros']);
  const canSell = hasPerm('pos.operar');

  const searchPlaceholder =
    activeTab === 'compras'
      ? 'Buscar órdenes, proveedores o SKUs...'
      : activeTab === 'reportes'
        ? 'Filtrar reportes o transacciones...'
        : 'Buscar por nombre, SKU, código de barras o principio activo...';

  const initials = user.nombreCompleto
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('');

  const handleNavClick = (tab: AppTab) => {
    onSelectTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#F6FBF3] text-[#181D19] flex">
      {/* Backdrop móvil */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-slate-200 z-50 flex flex-col transition-transform duration-150 no-print ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        aria-label="Navegación principal"
      >
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#006A3B] rounded-lg flex items-center justify-center text-white font-black text-lg">
              +
            </div>
            <div>
              <span className="block text-base font-extrabold tracking-tight text-[#006A3B] leading-none">
                Botica ERP
              </span>
              <span className="block text-[11px] text-[#6F7A70] mt-1 font-medium">
                {user.sucursalNombre}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1.5 rounded text-slate-500 hover:bg-slate-100"
            aria-label="Cerrar menú lateral"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto space-y-0.5 px-2">
          {navItems
            .filter((i) => i.visible)
            .map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-emerald-50 text-[#006A3B] font-semibold'
                      : 'text-[#3F4941] hover:bg-slate-50'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </nav>

        <div className="p-4 border-t border-slate-100 space-y-3 bg-slate-50/60">
          {canSell && (
            <button
              type="button"
              onClick={() => {
                onNewSaleF2();
                setMobileMenuOpen(false);
              }}
              className="w-full py-2.5 px-4 bg-[#006A3B] hover:bg-[#00522D] text-white font-bold text-xs rounded-lg flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Nueva venta (F2)</span>
            </button>
          )}

          <div className="space-y-1 pt-1">
            {canConfigure && (
              <button
                type="button"
                onClick={() => handleNavClick('configuracion')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  activeTab === 'configuracion'
                    ? 'bg-emerald-50 text-[#006A3B] font-semibold'
                    : 'text-[#3F4941] hover:bg-slate-100'
                }`}
              >
                <Settings className="w-4 h-4 shrink-0" />
                <span>Configuración</span>
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-[#BA1A1A] hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main wrapper */}
      <div className="flex-1 lg:ml-64 flex flex-col min-w-0">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 h-14 bg-white border-b border-slate-200 z-30 px-4 lg:px-6 flex items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 shrink-0"
              aria-label="Abrir menú de navegación"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="relative flex-1 max-w-md min-w-0">
              <Search className="w-4 h-4 text-[#6F7A70] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="search"
                value={globalSearch}
                onChange={(e) => onGlobalSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label="Búsqueda contextual"
                className="w-full pl-9 pr-10 py-1.5 bg-[#F0F5EE] border border-[#BECABE]/60 rounded-md text-sm text-[#181D19] focus:bg-white focus:border-[#006A3B]"
              />
              {activeTab === 'pos' && (
                <span className="hidden sm:inline-block absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#6F7A70] bg-white border border-slate-200 rounded px-1.5 py-0.5">
                  F1
                </span>
              )}
            </div>

            <nav className="hidden md:flex items-center gap-5 shrink-0 ml-2" aria-label="Accesos rápidos">
              {canSell && (
                <button
                  type="button"
                  onClick={() => onOpenTopAction('ventas')}
                  className={`text-xs font-semibold pb-0.5 border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === 'pos'
                      ? 'border-[#006A3B] text-[#006A3B]'
                      : 'border-transparent text-[#3F4941] hover:text-[#181D19]'
                  }`}
                >
                  Ventas
                </button>
              )}
              {(hasPerm('recetas.validar') || canSell) && (
                <button
                  type="button"
                  onClick={() => onOpenTopAction('recetas')}
                  className="text-xs font-semibold pb-0.5 border-b-2 border-transparent text-[#3F4941] hover:text-[#005DB7] transition-colors whitespace-nowrap"
                >
                  Recetas
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenTopAction('alertas')}
                className="text-xs font-semibold pb-0.5 border-b-2 border-transparent text-[#3F4941] hover:text-[#BA1A1A] transition-colors flex items-center gap-1 whitespace-nowrap"
              >
                <span>Alertas</span>
                {alertCount > 0 && (
                  <span className="text-[11px] font-bold text-[#BA1A1A]">({alertCount})</span>
                )}
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex flex-col items-end text-right leading-tight">
              <span className="text-[11px] font-bold text-[#006A3B]">
                {openShift ? `Turno: ${openShift.codigoTurno}` : 'Sin turno abierto'}
              </span>
              <span className="text-[11px] text-[#6F7A70]">
                {openShift ? 'Caja Abierta' : 'Caja Cerrada'} · {user.cajaNombre}
              </span>
            </div>

            {hasPerm('caja.operar') && (
              <button
                type="button"
                onClick={() => onOpenTopAction('caja')}
                className={`px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-colors ${
                  openShift
                    ? 'bg-emerald-50 text-[#006A3B] border border-[#006A3B]/30 hover:bg-emerald-100'
                    : 'bg-[#006A3B] text-white hover:bg-[#00522D]'
                }`}
              >
                {openShift ? 'Ver Caja' : 'Abrir Caja'}
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenTopAction('alertas')}
              className="p-1.5 rounded-md text-[#3F4941] hover:bg-slate-100 relative"
              aria-label={`Ver alertas (${alertCount})`}
            >
              <Bell className="w-4 h-4" />
              {alertCount > 0 && (
                <span className="sr-only">{alertCount} alertas pendientes</span>
              )}
            </button>

            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <div className="hidden xl:block text-right leading-tight">
                <span className="block text-xs font-bold text-[#181D19] truncate max-w-[140px]">
                  {user.nombreCompleto}
                </span>
                <span className="block text-[11px] text-[#6F7A70]">{user.cargo}</span>
              </div>
              {!avatarFailed ? (
                <img
                  src="/src/assets/images/pharmacist_avatar_1795557186151.jpg"
                  alt={user.nombreCompleto}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-emerald-100 text-[#006A3B] font-bold text-xs flex items-center justify-center border border-emerald-200 shrink-0">
                  {initials}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Content Canvas */}
        <main className="flex-1 p-4 lg:p-6 min-w-0">{children}</main>
      </div>
    </div>
  );
}
