import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from './components/AppShell';
import { CajaView } from './components/CajaView';
import { ComprasView } from './components/ComprasView';
import { ConfiguracionView } from './components/ConfiguracionView';
import { DashboardView } from './components/DashboardView';
import { InventarioView } from './components/InventarioView';
import { KardexView } from './components/KardexView';
import { LoginView } from './components/LoginView';
import { PosView } from './components/PosView';
import { ReportesView } from './components/ReportesView';
import { apiFetch } from './lib/api';
import type {
  AppTab,
  AuthUser,
  DashboardData,
  OpenShiftSummary,
  SqlHealthStatus,
} from './types/erp';

export default function App() {
  const [sqlHealth, setSqlHealth] = useState<SqlHealthStatus | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [openShift, setOpenShift] = useState<OpenShiftSummary | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [globalSearch, setGlobalSearch] = useState('');
  const [alertCount, setAlertCount] = useState(0);

  // Estado contextual entre pantallas
  const [posSubTab, setPosSubTab] = useState<'pos' | 'historial' | 'recetas'>('pos');
  const [inventoryFilter, setInventoryFilter] = useState<string | undefined>(undefined);
  const [comprasOpenReception, setComprasOpenReception] = useState(false);
  const [kardexProductId, setKardexProductId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const h = await apiFetch<SqlHealthStatus>('/api/health');
      setSqlHealth(h);
      return h;
    } catch {
      const fallback: SqlHealthStatus = {
        engine: 'Microsoft SQL Server',
        configured: false,
        connected: false,
        message: 'No se pudo consultar el estado del servidor.',
      };
      setSqlHealth(fallback);
      return fallback;
    }
  }, []);

  const refreshSessionAndAlerts = useCallback(async () => {
    try {
      const me = await apiFetch<{ user: AuthUser; openShift: OpenShiftSummary | null }>(
        '/api/auth/me'
      );
      setUser(me.user);
      setOpenShift(me.openShift);
      try {
        const dash = await apiFetch<DashboardData>('/api/dashboard');
        setAlertCount(dash.alertas.length);
      } catch {
        // ignore alert count failure
      }
      return true;
    } catch {
      setUser(null);
      setOpenShift(null);
      return false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const h = await loadHealth();
      if (h.connected) {
        await refreshSessionAndAlerts();
      }
      if (active) setBootstrapping(false);
    })();
    return () => {
      active = false;
    };
  }, [loadHealth, refreshSessionAndAlerts]);

  const handleLogin = async (username: string, password: string) => {
    const res = await apiFetch<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setUser(res.user);
    setActiveTab('dashboard');
    await refreshSessionAndAlerts();
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setUser(null);
    setOpenShift(null);
    setActiveTab('dashboard');
  };

  const handleNewSaleF2 = useCallback(() => {
    if (!user?.permisos.includes('pos.operar')) return;
    setPosSubTab('pos');
    setActiveTab('pos');
    setGlobalSearch('');
  }, [user]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!user) return;
      if (e.key === 'F2') {
        e.preventDefault();
        handleNewSaleF2();
      } else if (e.key === 'F1') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user, handleNewSaleF2]);

  const handleNavigateFromDashboard = (
    tab: AppTab,
    opts?: { filter?: string; openReception?: boolean; productId?: string }
  ) => {
    setGlobalSearch('');
    if (tab === 'inventario') {
      setInventoryFilter(opts?.filter);
    }
    if (tab === 'compras') {
      setComprasOpenReception(Boolean(opts?.openReception));
    }
    if (tab === 'kardex' && opts?.productId) {
      setKardexProductId(opts.productId);
    }
    setActiveTab(tab);
  };

  const handleTopAction = (action: 'ventas' | 'recetas' | 'alertas' | 'caja') => {
    if (action === 'ventas') {
      setPosSubTab('historial');
      setActiveTab('pos');
    } else if (action === 'recetas') {
      setPosSubTab('recetas');
      setActiveTab('pos');
    } else if (action === 'alertas') {
      setInventoryFilter('30');
      setActiveTab('inventario');
    } else if (action === 'caja') {
      setActiveTab('caja');
    }
  };

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-[#F6FBF3] flex items-center justify-center p-6">
        <div className="bg-white border border-[#BECABE] rounded-xl px-6 py-4 text-sm font-semibold text-[#3F4941]">
          Verificando sesión y conexión con Microsoft SQL Server...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        sqlHealth={sqlHealth}
        onRetryHealth={loadHealth}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <AppShell
      user={user}
      openShift={openShift}
      activeTab={activeTab}
      onSelectTab={(tab) => {
        setGlobalSearch('');
        if (tab === 'pos') setPosSubTab('pos');
        if (tab !== 'inventario') setInventoryFilter(undefined);
        if (tab !== 'compras') setComprasOpenReception(false);
        setActiveTab(tab);
      }}
      onNewSaleF2={handleNewSaleF2}
      onLogout={handleLogout}
      globalSearch={globalSearch}
      onGlobalSearchChange={setGlobalSearch}
      searchInputRef={searchInputRef}
      alertCount={alertCount}
      onOpenTopAction={handleTopAction}
    >
      {activeTab === 'dashboard' && (
        <DashboardView
          user={user}
          onNavigate={handleNavigateFromDashboard}
          onNewSaleF2={handleNewSaleF2}
        />
      )}

      {activeTab === 'pos' && (
        <PosView
          user={user}
          openShift={openShift}
          globalSearch={globalSearch}
          onGlobalSearchChange={setGlobalSearch}
          searchInputRef={searchInputRef}
          initialSubTab={posSubTab}
          onSaleCompleted={refreshSessionAndAlerts}
          onOpenCashScreen={() => setActiveTab('caja')}
        />
      )}

      {activeTab === 'inventario' && (
        <InventarioView
          user={user}
          globalSearch={globalSearch}
          initialFilter={inventoryFilter}
          onOpenKardex={(prodId) => {
            setKardexProductId(prodId);
            setActiveTab('kardex');
          }}
        />
      )}

      {activeTab === 'compras' && (
        <ComprasView
          user={user}
          globalSearch={globalSearch}
          initialOpenReception={comprasOpenReception}
        />
      )}

      {activeTab === 'kardex' && (
        <KardexView
          user={user}
          selectedProductId={kardexProductId}
          onSelectProductId={setKardexProductId}
          onBackToInventory={() => setActiveTab('inventario')}
        />
      )}

      {activeTab === 'caja' && (
        <CajaView
          user={user}
          onShiftChanged={refreshSessionAndAlerts}
        />
      )}

      {activeTab === 'reportes' && (
        <ReportesView
          user={user}
          globalSearch={globalSearch}
        />
      )}

      {activeTab === 'configuracion' && (
        <ConfiguracionView
          user={user}
          onConfigUpdated={refreshSessionAndAlerts}
        />
      )}
    </AppShell>
  );
}
