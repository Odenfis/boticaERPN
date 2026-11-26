import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  KeyRound,
  Plus,
  Save,
  Shield,
  Sliders,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatLimaDateTime, solesToCentimos } from '../lib/format';
import type { AuthUser } from '../types/erp';

interface ConfiguracionViewProps {
  user: AuthUser;
  onConfigUpdated: () => void;
}

interface ConfigPayload {
  usuarios: Array<{
    usuarioId: string;
    username: string;
    nombreCompleto: string;
    cargo: string;
    activo: boolean;
    creadoEn: string;
    rolIds: string[];
    sucursalIds: string[];
  }>;
  roles: Array<{
    rolId: string;
    codigo: string;
    nombre: string;
    descripcion: string;
    permisoIds: string[];
  }>;
  permisos: Array<{
    permisoId: string;
    codigo: string;
    modulo: string;
    descripcion: string;
  }>;
  sucursales: Array<{
    sucursalId: string;
    codigo: string;
    nombre: string;
    ruc: string;
    direccion: string;
    activo: boolean;
  }>;
  parametros: {
    igvPorcentaje: number;
    ventanaAlertaDias: number;
    metaMensualCentimos: number | null;
    porcentajeComision: number | null;
  } | null;
  auditoria: Array<{
    auditoriaId: number;
    accion: string;
    entidad: string;
    entidadId: string | null;
    detalleJson: string | null;
    creadoEn: string;
    username: string;
  }>;
}

export function ConfiguracionView({ user, onConfigUpdated }: ConfiguracionViewProps) {
  const [data, setData] = useState<ConfigPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [section, setSection] = useState<'usuarios' | 'roles' | 'parametros' | 'auditoria'>('usuarios');

  // Nuevo usuario
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    username: '',
    nombreCompleto: '',
    cargo: '',
    password: '',
    rolIds: [] as string[],
    sucursalIds: [user.sucursalId],
  });
  const [userError, setUserError] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState(false);

  // Editar roles/sucursales de usuario
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserRoles, setEditUserRoles] = useState<string[]>([]);
  const [editUserSucs, setEditUserSucs] = useState<string[]>([]);

  // Parámetros
  const [paramForm, setParamForm] = useState({
    igvPorcentaje: '18',
    ventanaAlertaDias: '30',
    metaMensualSoles: '',
    porcentajeComision: '',
  });
  const [savingParams, setSavingParams] = useState(false);

  const canUsers = user.permisos.includes('config.usuarios');
  const canParams = user.permisos.includes('config.parametros');

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ConfigPayload>('/api/configuracion');
      setData(res);
      if (res.parametros) {
        setParamForm({
          igvPorcentaje: String(res.parametros.igvPorcentaje),
          ventanaAlertaDias: String(res.parametros.ventanaAlertaDias),
          metaMensualSoles:
            res.parametros.metaMensualCentimos !== null
              ? (res.parametros.metaMensualCentimos / 100).toFixed(2)
              : '',
          porcentajeComision:
            res.parametros.porcentajeComision !== null
              ? String(res.parametros.porcentajeComision)
              : '',
        });
      }
      if (res.roles.length > 0 && newUserForm.rolIds.length === 0) {
        setNewUserForm((prev) => ({ ...prev, rolIds: [res.roles[0].rolId] }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando configuración.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserError(null);
    if (newUserForm.password.length < 8) {
      setUserError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (newUserForm.rolIds.length === 0) {
      setUserError('Asigne al menos un rol.');
      return;
    }
    setSavingUser(true);
    try {
      await apiFetch('/api/configuracion/usuarios', {
        method: 'POST',
        body: JSON.stringify(newUserForm),
      });
      setUserModalOpen(false);
      setNewUserForm({
        username: '',
        nombreCompleto: '',
        cargo: '',
        password: '',
        rolIds: data?.roles[0] ? [data.roles[0].rolId] : [],
        sucursalIds: [user.sucursalId],
      });
      setFeedback('Usuario creado con contraseña cifrada en SQL Server.');
      await loadConfig();
    } catch (err) {
      setUserError(err instanceof Error ? err.message : 'No se pudo crear el usuario.');
    } finally {
      setSavingUser(false);
    }
  };

  const toggleUserActive = async (usuarioId: string, activo: boolean) => {
    setError(null);
    try {
      await apiFetch(`/api/configuracion/usuarios/${usuarioId}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo }),
      });
      setFeedback(
        activo
          ? 'Usuario activado.'
          : 'Usuario desactivado y sus sesiones activas han sido revocadas de inmediato.'
      );
      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado del usuario.');
    }
  };

  const saveUserAccess = async (usuarioId: string) => {
    try {
      await apiFetch(`/api/configuracion/usuarios/${usuarioId}`, {
        method: 'PATCH',
        body: JSON.stringify({ rolIds: editUserRoles, sucursalIds: editUserSucs }),
      });
      setEditingUserId(null);
      setFeedback('Roles y acceso a sucursales actualizados.');
      await loadConfig();
      onConfigUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los cambios.');
    }
  };

  const toggleRolePermission = async (rolId: string, currentPermIds: string[], permId: string) => {
    const next = currentPermIds.includes(permId)
      ? currentPermIds.filter((id) => id !== permId)
      : [...currentPermIds, permId];
    try {
      await apiFetch(`/api/configuracion/roles/${rolId}/permisos`, {
        method: 'PUT',
        body: JSON.stringify({ permisoIds: next }),
      });
      setFeedback('Permisos de rol actualizados (aplicación inmediata).');
      await loadConfig();
      onConfigUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron actualizar los permisos.');
    }
  };

  const saveParameters = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingParams(true);
    setError(null);
    try {
      await apiFetch('/api/configuracion/parametros', {
        method: 'PUT',
        body: JSON.stringify({
          igvPorcentaje: Number(paramForm.igvPorcentaje || 18),
          ventanaAlertaDias: Number(paramForm.ventanaAlertaDias || 30),
          metaMensualCentimos: paramForm.metaMensualSoles.trim()
            ? solesToCentimos(paramForm.metaMensualSoles)
            : null,
          porcentajeComision: paramForm.porcentajeComision.trim()
            ? Number(paramForm.porcentajeComision)
            : null,
        }),
      });
      setFeedback('Parámetros operativos actualizados.');
      await loadConfig();
      onConfigUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando parámetros.');
    } finally {
      setSavingParams(false);
    }
  };

  if (loading) {
    return (
      <div className="p-10 bg-white border border-[#BECABE] rounded-xl text-center text-xs text-[#6F7A70]">
        Cargando configuración y control de acceso...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#181D19]">Configuración y Control de Acceso (RBAC)</h1>
          <p className="text-xs text-[#6F7A70] mt-0.5">
            Gestión de usuarios, roles, permisos, sucursales y parámetros operativos en SQL Server.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          {[
            { id: 'usuarios', label: 'Usuarios', icon: Shield },
            { id: 'roles', label: 'Roles y Permisos', icon: KeyRound },
            { id: 'parametros', label: 'Parámetros y Sucursal', icon: Sliders },
            { id: 'auditoria', label: 'Auditoría', icon: Building2 },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSection(t.id as any)}
                className={`px-3 py-2 rounded-lg font-bold inline-flex items-center gap-1.5 border ${
                  section === t.id
                    ? 'bg-[#006A3B] text-white border-[#006A3B]'
                    : 'bg-white text-[#3F4941] border-[#BECABE] hover:bg-slate-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold text-[#006A3B] flex items-center justify-between">
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
        <div className="p-3 bg-[#FFDAD6] text-[#93000A] text-xs font-semibold rounded-lg">
          {error}
        </div>
      )}

      {/* Usuarios */}
      {section === 'usuarios' && data && (
        <section className="bg-white border border-[#BECABE] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#181D19]">Usuarios del ERP</h2>
            {canUsers && (
              <button
                type="button"
                onClick={() => {
                  setUserError(null);
                  setUserModalOpen(true);
                }}
                className="px-3.5 py-1.5 bg-[#006A3B] text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Nuevo usuario</span>
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                <tr>
                  <th className="px-3 py-2.5">Usuario</th>
                  <th className="px-3 py-2.5">Nombre Completo</th>
                  <th className="px-3 py-2.5">Cargo</th>
                  <th className="px-3 py-2.5">Roles</th>
                  <th className="px-3 py-2.5">Estado</th>
                  {canUsers && <th className="px-3 py-2.5 text-center">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.usuarios.map((u) => {
                  const isEditing = editingUserId === u.usuarioId;
                  return (
                    <tr key={u.usuarioId}>
                      <td className="px-3 py-2.5 font-data-mono font-bold">{u.username}</td>
                      <td className="px-3 py-2.5 font-semibold">{u.nombreCompleto}</td>
                      <td className="px-3 py-2.5">{u.cargo}</td>
                      <td className="px-3 py-2.5">
                        {isEditing ? (
                          <div className="space-y-1">
                            {data.roles.map((r) => (
                              <label key={r.rolId} className="flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={editUserRoles.includes(r.rolId)}
                                  onChange={(e) =>
                                    setEditUserRoles((prev) =>
                                      e.target.checked
                                        ? [...prev, r.rolId]
                                        : prev.filter((id) => id !== r.rolId)
                                    )
                                  }
                                />
                                <span>{r.nombre}</span>
                              </label>
                            ))}
                          </div>
                        ) : (
                          u.rolIds
                            .map((rid) => data.roles.find((r) => r.rolId === rid)?.nombre || rid)
                            .join(', ')
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            u.activo
                              ? 'bg-emerald-50 text-[#006A3B]'
                              : 'bg-[#FFDAD6] text-[#93000A]'
                          }`}
                        >
                          {u.activo ? 'Activo' : 'Desactivado'}
                        </span>
                      </td>
                      {canUsers && (
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => saveUserAccess(u.usuarioId)}
                                  className="px-2 py-1 bg-[#006A3B] text-white rounded font-bold"
                                >
                                  Guardar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingUserId(null)}
                                  className="px-2 py-1 border border-slate-200 rounded"
                                >
                                  Cancelar
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingUserId(u.usuarioId);
                                    setEditUserRoles(u.rolIds);
                                    setEditUserSucs(u.sucursalIds);
                                  }}
                                  className="px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 font-semibold"
                                >
                                  Roles
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleUserActive(u.usuarioId, !u.activo)}
                                  className={`px-2 py-1 rounded font-semibold inline-flex items-center gap-1 ${
                                    u.activo
                                      ? 'border border-red-200 text-[#BA1A1A] hover:bg-red-50'
                                      : 'border border-emerald-200 text-[#006A3B] hover:bg-emerald-50'
                                  }`}
                                >
                                  {u.activo ? (
                                    <>
                                      <UserX className="w-3.5 h-3.5" />
                                      <span>Desactivar</span>
                                    </>
                                  ) : (
                                    <>
                                      <UserCheck className="w-3.5 h-3.5" />
                                      <span>Activar</span>
                                    </>
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Matriz Roles y Permisos */}
      {section === 'roles' && data && (
        <section className="bg-white border border-[#BECABE] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-bold text-[#181D19]">Matriz de permisos por rol</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                <tr>
                  <th className="px-3 py-2.5">Módulo / Permiso</th>
                  {data.roles.map((r) => (
                    <th key={r.rolId} className="px-3 py-2.5 text-center">
                      {r.nombre}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.permisos.map((p) => (
                  <tr key={p.permisoId}>
                    <td className="px-3 py-2">
                      <div className="font-bold text-[#181D19]">{p.codigo}</div>
                      <div className="text-[11px] text-[#6F7A70]">{p.descripcion}</div>
                    </td>
                    {data.roles.map((r) => {
                      const checked = r.permisoIds.includes(p.permisoId);
                      return (
                        <td key={r.rolId} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            disabled={!canUsers}
                            checked={checked}
                            aria-label={`${p.codigo} en ${r.nombre}`}
                            onChange={() => toggleRolePermission(r.rolId, r.permisoIds, p.permisoId)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Parámetros y Sucursal */}
      {section === 'parametros' && data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <section className="bg-white border border-[#BECABE] rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-[#181D19]">Parámetros operativos de botica</h2>
            <form onSubmit={saveParameters} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">IGV vigente (%)</label>
                <input
                  type="number"
                  step="0.01"
                  disabled={!canParams}
                  value={paramForm.igvPorcentaje}
                  onChange={(e) => setParamForm({ ...paramForm, igvPorcentaje: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">
                  Ventana inicial de alerta de vencimiento (días)
                </label>
                <input
                  type="number"
                  min={1}
                  disabled={!canParams}
                  value={paramForm.ventanaAlertaDias}
                  onChange={(e) =>
                    setParamForm({ ...paramForm, ventanaAlertaDias: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">
                  Meta mensual de ventas (S/ — dejar vacío si no se usa)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  disabled={!canParams}
                  value={paramForm.metaMensualSoles}
                  onChange={(e) =>
                    setParamForm({ ...paramForm, metaMensualSoles: e.target.value })
                  }
                  placeholder="Ej. 25000.00"
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">
                  Comisión por ventas (% — dejar vacío si no aplica)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  disabled={!canParams}
                  value={paramForm.porcentajeComision}
                  onChange={(e) =>
                    setParamForm({ ...paramForm, porcentajeComision: e.target.value })
                  }
                  placeholder="Ej. 1.50"
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md font-data-mono"
                />
              </div>
              {canParams && (
                <button
                  type="submit"
                  disabled={savingParams}
                  className="px-4 py-2.5 bg-[#006A3B] text-white font-bold rounded-lg inline-flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingParams ? 'Guardando...' : 'Guardar parámetros'}</span>
                </button>
              )}
            </form>
          </section>

          <section className="bg-white border border-[#BECABE] rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-[#181D19]">Sucursales y punto de caja</h2>
            <div className="space-y-2.5 text-xs">
              {data.sucursales.map((s) => (
                <div key={s.sucursalId} className="p-3 border border-slate-200 rounded-lg">
                  <div className="font-bold text-[#181D19]">
                    {s.nombre} ({s.codigo})
                  </div>
                  <div className="text-[#6F7A70] font-data-mono mt-0.5">
                    ID: {s.sucursalId} · RUC: {s.ruc}
                  </div>
                  <div className="text-[#3F4941] mt-0.5">{s.direccion}</div>
                </div>
              ))}
              <div className="p-3 bg-[#F6FBF3] border border-emerald-200 rounded-lg">
                <div className="font-bold text-[#006A3B]">Caja activa de esta sesión</div>
                <div className="font-data-mono text-[#3F4941] mt-0.5">
                  {user.cajaNombre} (ID: {user.cajaId})
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Auditoría */}
      {section === 'auditoria' && data && (
        <section className="bg-white border border-[#BECABE] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-bold text-[#181D19]">Registro de auditoría (últimos 25 eventos)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-[#6F7A70] uppercase">
                <tr>
                  <th className="px-3 py-2">Fecha/Hora</th>
                  <th className="px-3 py-2">Usuario</th>
                  <th className="px-3 py-2">Acción</th>
                  <th className="px-3 py-2">Entidad</th>
                  <th className="px-3 py-2">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.auditoria.map((a) => (
                  <tr key={a.auditoriaId}>
                    <td className="px-3 py-2 font-data-mono whitespace-nowrap">
                      {formatLimaDateTime(a.creadoEn)}
                    </td>
                    <td className="px-3 py-2 font-semibold">{a.username}</td>
                    <td className="px-3 py-2 font-data-mono font-bold text-[#006A3B]">
                      {a.accion}
                    </td>
                    <td className="px-3 py-2">{a.entidad}</td>
                    <td className="px-3 py-2 font-data-mono text-[11px] text-[#6F7A70] max-w-md truncate">
                      {a.detalleJson || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Modal Nuevo Usuario */}
      {userModalOpen && data && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Crear nuevo usuario"
        >
          <div className="bg-white rounded-xl border border-[#BECABE] max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-[#181D19]">Nuevo usuario del sistema</h2>
              <button type="button" onClick={() => setUserModalOpen(false)} aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            {userError && (
              <div className="p-2.5 bg-[#FFDAD6] text-[#93000A] text-xs font-semibold rounded">
                {userError}
              </div>
            )}
            <form onSubmit={createUser} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Nombre de usuario *</label>
                <input
                  type="text"
                  required
                  value={newUserForm.username}
                  onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Nombre completo *</label>
                <input
                  type="text"
                  required
                  value={newUserForm.nombreCompleto}
                  onChange={(e) =>
                    setNewUserForm({ ...newUserForm, nombreCompleto: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Cargo</label>
                <input
                  type="text"
                  value={newUserForm.cargo}
                  onChange={(e) => setNewUserForm({ ...newUserForm, cargo: e.target.value })}
                  placeholder="Ej. Químico Farmacéutico / Cajero"
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Contraseña inicial (mín. 8 caracteres) *</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  className="w-full px-3 py-2 border border-[#BECABE] rounded-md"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Roles asignados *</label>
                <div className="space-y-1 border border-[#BECABE] rounded-md p-2.5">
                  {data.roles.map((r) => (
                    <label key={r.rolId} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={newUserForm.rolIds.includes(r.rolId)}
                        onChange={(e) =>
                          setNewUserForm((prev) => ({
                            ...prev,
                            rolIds: e.target.checked
                              ? [...prev.rolIds, r.rolId]
                              : prev.rolIds.filter((id) => id !== r.rolId),
                          }))
                        }
                      />
                      <span className="font-semibold">{r.nombre}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setUserModalOpen(false)}
                  className="px-4 py-2 border border-[#BECABE] rounded-md font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="px-4 py-2 bg-[#006A3B] text-white rounded-md font-bold"
                >
                  {savingUser ? 'Creando...' : 'Crear usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
