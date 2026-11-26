import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, Lock, ShieldCheck, User } from 'lucide-react';
import type { SqlHealthStatus } from '../types/erp';

interface LoginViewProps {
  sqlHealth: SqlHealthStatus | null;
  onRetryHealth: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
}

export function LoginView({ sqlHealth, onRetryHealth, onLogin }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Ingrese usuario y contraseña.');
      return;
    }
    setLoading(true);
    try {
      await onLogin(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6FBF3] flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 bg-white border border-[#BECABE] rounded-xl overflow-hidden shadow-sm">
        {/* Panel institucional izquierdo */}
        <div className="lg:col-span-5 bg-[#006A3B] text-white p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-white/15 rounded-lg flex items-center justify-center font-black text-xl">
                +
              </div>
              <div>
                <h1 className="text-xl font-extrabold tracking-tight">Botica ERP</h1>
                <p className="text-xs text-emerald-100 tracking-wide">Gestión Farmacéutica · Fase 1</p>
              </div>
            </div>
            <h2 className="text-2xl font-bold leading-snug mb-3">
              Control operativo de botica en tiempo real
            </h2>
            <p className="text-sm text-emerald-100 leading-relaxed">
              Dispensación FEFO por lote, validación interna de recetas, Kardex auditable, arqueo de caja con reporte Z y persistencia transaccional en Microsoft SQL Server.
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-white/20 space-y-2 text-xs text-emerald-50">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Sesiones persistentes y control de acceso por rol</span>
            </div>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 shrink-0" />
              <span>Motor único: Microsoft SQL Server (PEN S/ · America/Lima)</span>
            </div>
          </div>
        </div>

        {/* Formulario de acceso derecho */}
        <div className="lg:col-span-7 p-8 flex flex-col justify-center">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-[#181D19]">Iniciar sesión</h2>
            <p className="text-sm text-[#6F7A70] mt-1">
              Ingrese sus credenciales del ERP para acceder a la sucursal asignada.
            </p>
          </div>

          {/* Estado de conectividad Microsoft SQL Server */}
          {sqlHealth && !sqlHealth.connected && (
            <div
              role="alert"
              className="mb-5 p-4 rounded-lg bg-[#FFF8EB] border border-amber-300 text-amber-950 text-xs space-y-2"
            >
              <div className="flex items-center justify-between gap-2 font-bold">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  Microsoft SQL Server no conectado en este entorno
                </span>
                <button
                  type="button"
                  onClick={onRetryHealth}
                  className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded font-semibold"
                >
                  Reintentar
                </button>
              </div>
              <p className="leading-relaxed text-amber-900">{sqlHealth.message}</p>
              <div className="bg-white/80 border border-amber-200 rounded p-2.5 font-data-mono text-[11px] text-slate-700 space-y-1">
                <div>1. Configure MSSQL_SERVER, MSSQL_PORT, MSSQL_DATABASE, MSSQL_USER y MSSQL_PASSWORD.</div>
                <div>2. Ejecute: npm run db:migrate</div>
                <div>3. Cree el administrador: npm run db:create-admin</div>
                <div>4. Opcional datos demo: npm run db:seed</div>
              </div>
            </div>
          )}

          {sqlHealth?.connected && (
            <div className="mb-5 px-3.5 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#006A3B] shrink-0" />
              <span>
                Conectado a Microsoft SQL Server ({sqlHealth.server} / {sqlHealth.database})
              </span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-lg bg-[#FFDAD6] border border-[#BA1A1A]/30 text-[#93000A] text-sm font-medium"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="block text-xs font-semibold text-[#3F4941] mb-1.5">
                Nombre de usuario
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[#6F7A70] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ej. admin, farmaceutico, cajero1"
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-[#BECABE] rounded-md text-sm text-[#181D19] focus:border-[#006A3B]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-semibold text-[#3F4941] mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#6F7A70] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-[#BECABE] rounded-md text-sm text-[#181D19] focus:border-[#006A3B]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-[#006A3B] hover:bg-[#00522D] disabled:opacity-60 text-white font-bold text-sm rounded-lg transition-colors"
            >
              {loading ? 'Verificando acceso...' : 'Ingresar al ERP'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
