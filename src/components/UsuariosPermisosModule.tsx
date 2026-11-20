import { useBranch } from '../context/BranchContext';
import React, { useState, useEffect, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  doc,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth, deduplicateUserProfiles } from '../context/AuthContext';
import { UserProfile, UserRole } from '../types';
import { CreateStaffModal, AVAILABLE_AREAS, ROLE_DEFAULT_AREAS } from './CreateStaffModal';
import { DeleteAuthModal } from './DeleteAuthModal';
import {
  Users,
  UserPlus,
  Shield,
  ChefHat,
  UtensilsCrossed,
  Coffee,
  DollarSign,
  Flame,
  Trash2,
  Lock,
  Search,
  CheckCircle2,
  SlidersHorizontal,
  X,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';

const ROLE_META: Record<
  UserRole,
  { badge: string; icon: any; color: string; titleEs: string; descEs: string }
> = {
  Owner: {
    badge: 'bg-[#E89E2D]/15 text-[#E89E2D] border-[#E89E2D]/40',
    icon: Flame,
    color: 'text-[#E89E2D]',
    titleEs: 'Propietario',
    descEs: 'Control total único de finanzas, licencias, borrado y configuración.',
  },
  Admin: {
    badge: 'bg-[#EAF5F0] text-[#4A5D23] border-[#4A5D23]/30',
    icon: Shield,
    color: 'text-[#4A5D23]',
    titleEs: 'Administrador',
    descEs: 'Gestión de personal, inventario y terminales.',
  },
  Cashier: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: DollarSign,
    color: 'text-emerald-600',
    titleEs: 'Cajero',
    descEs: 'Cobro de órdenes, apertura y cierre de caja y arqueos.',
  },
  'Kitchen Manager': {
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: ChefHat,
    color: 'text-amber-600',
    titleEs: 'Jefe de Cocina',
    descEs: 'Tiempos de preparación, comanderas y despacho de platos.',
  },
  'Kitchen Assistant': {
    badge: 'bg-[#EAF5F0] text-[#4A5D23] border-[#4A5D23]/20',
    icon: UtensilsCrossed,
    color: 'text-[#4A5D23]',
    titleEs: 'Asistente de Cocina',
    descEs: 'Mise en place y soporte en líneas calientes y frías.',
  },
  'Service Staff': {
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    icon: Coffee,
    color: 'text-blue-600',
    titleEs: 'Mesero / Personal de Servicio',
    descEs: 'Toma de pedidos en mesas y atención al comensal.',
  },
};

export const UsuariosPermisosModule: React.FC = () => {
  const { verifyOwnerPassword, currentUser } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Security deletion
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);

  // View / Edit Permissions Modal state
  const [editTarget, setEditTarget] = useState<UserProfile | null>(null);
  const [editAreas, setEditAreas] = useState<string[]>([]);
  const [editBranches, setEditBranches] = useState<string[]>(['Matriz']);
  const [ownerAuthPassword, setOwnerAuthPassword] = useState('');
  const [showOwnerAuthPassword, setShowOwnerAuthPassword] = useState(false);
  const [permissionModalError, setPermissionModalError] = useState<string | null>(null);
  const { availableBranches } = useBranch();
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: UserProfile[] = [];
        snap.forEach((d) => list.push({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }));
        const { uniqueProfiles } = deduplicateUserProfiles(list, currentUser?.uid);
        setUsers(uniqueProfiles);
      },
      (err) => console.warn('Usuarios listener notice:', err)
    );


    return () => unsub();
  }, [currentUser?.uid]);

  const showBanner = (type: 'success' | 'error', text: string) => {
    setFeedbackMsg({ type, text });
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setFeedbackMsg(null), 4000);
  };

  const handleOpenEditPermissions = (u: UserProfile) => {
    setEditTarget(u);
    setPermissionModalError(null);
    setOwnerAuthPassword('');
    setShowOwnerAuthPassword(false);

    if (u.role === 'Owner') {
      setEditAreas([...AVAILABLE_AREAS, 'Configuración']);
      setEditBranches([...availableBranches]);
      return;
    }

    setEditAreas(
      Array.isArray(u.authorizedAreas)
        ? [...u.authorizedAreas]
        : [...(ROLE_DEFAULT_AREAS[u.role] || [])]
    );
    setEditBranches(
      Array.isArray(u.authorizedBranches) && u.authorizedBranches.length > 0
        ? [...u.authorizedBranches]
        : ['Matriz']
    );
  };

  const handleSavePermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || editTarget.role === 'Owner') return;

    setPermissionModalError(null);

    if (editAreas.length === 0) {
      setPermissionModalError('Selecciona al menos un área autorizada para este usuario.');
      return;
    }

    const cleanOwnerPass = ownerAuthPassword.trim();
    if (!cleanOwnerPass) {
      setPermissionModalError('Ingresa la contraseña del Propietario para autorizar los permisos.');
      return;
    }

    setIsSavingPermissions(true);
    try {
      const isValidOwner = await verifyOwnerPassword(cleanOwnerPass);
      if (!isValidOwner) {
        setPermissionModalError('Contraseña del Propietario incorrecta. No se guardaron los permisos.');
        setIsSavingPermissions(false);
        return;
      }

      const updatedBranches = editBranches.length > 0 ? editBranches : ['Matriz'];
      await updateDoc(doc(db, 'users', editTarget.uid), {
        authorizedAreas: editAreas,
        authorizedBranches: updatedBranches,
        canDeleteWithPersonalPassword: false,
        updatedAt: new Date().toISOString(),
      });
      setEditTarget(null);
      setOwnerAuthPassword('');
      showBanner('success', `Permisos de ${editTarget.name} actualizados con autorización del Propietario.`);
    } catch (err) {
      console.error('Error al actualizar permisos:', err);
      setPermissionModalError('Error al guardar permisos en Firestore.');
    } finally {
      setIsSavingPermissions(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, u: UserProfile) => {
    e.stopPropagation();
    if (u.role === 'Owner') {
      showBanner('error', 'La cuenta Propietario es única y no puede ser eliminada.');
      return;
    }
    setDeleteTarget(u);
  };

  const confirmDeleteUser = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'users', deleteTarget.uid));
      await deleteDoc(doc(db, 'login_profiles', deleteTarget.uid)).catch(() => {});
      try {
        const cachedRaw = localStorage.getItem('gastrolab_cached_users');
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw) as UserProfile[];
          localStorage.setItem(
            'gastrolab_cached_users',
            JSON.stringify(parsed.filter((u) => u.uid !== deleteTarget.uid))
          );
        }
      } catch {
        // Ignore
      }
      showBanner('success', `Usuario ${deleteTarget.name} eliminado correctamente.`);
      setDeleteTarget(null);
    } catch (err) {
      console.error('Error al eliminar usuario:', err);
      showBanner('error', 'Error al eliminar usuario.');
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    const fullName = `${u.name} ${u.lastName || ''}`.toLowerCase();
    return (
      fullName.includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 flex items-center justify-center text-[#4A5D23]">
            <Users className="w-6 h-6 text-[#4A5D23]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Usuarios y Permisos</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30">
                1 Propietario Único
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Haz clic sobre cualquier tarjeta para ver sus permisos asignados. Otorgar nuevos permisos requiere clave del Propietario.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <UserPlus className="w-4 h-4 text-[#E89E2D]" />
          Crear Usuario
        </button>
      </div>

      {feedbackMsg && (
        <div
          className={`p-3.5 rounded-2xl border text-xs flex items-center gap-2.5 font-bold ${
            feedbackMsg.type === 'success'
              ? 'bg-[#EAF5F0] border-[#4A5D23]/30 text-[#4A5D23]'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          {feedbackMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-[#4A5D23] shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* Search Bar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm flex items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar usuario o rol..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
          />
        </div>

        <span className="text-xs text-gray-500 font-medium">
          {filteredUsers.length} Usuarios activos
        </span>
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredUsers.map((u) => {
          const role = u.role || 'Service Staff';
          const meta = ROLE_META[role] || ROLE_META['Service Staff'];
          const Icon = meta.icon;
          const assignedAreas =
            role === 'Owner'
              ? [...AVAILABLE_AREAS, 'Configuración']
              : Array.isArray(u.authorizedAreas)
              ? u.authorizedAreas
              : ROLE_DEFAULT_AREAS[role] || [];

          return (
            <div
              key={u.uid}
              onClick={() => handleOpenEditPermissions(u)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleOpenEditPermissions(u);
                }
              }}
              className="p-5 rounded-3xl bg-white border border-gray-200 shadow-sm flex flex-col justify-between hover:border-[#4A5D23]/60 hover:shadow-md transition-all cursor-pointer group"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-gray-100 group-hover:bg-[#EAF5F0] flex items-center justify-center transition-colors">
                      <Icon className={`w-5 h-5 ${meta.color}`} />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-gray-900">
                        {u.name} {u.lastName || ''}
                      </h4>
                      <p className="text-xs text-[#4A5D23] font-semibold truncate max-w-[170px]">
                        {role === 'Owner'
                          ? 'Acceso total (todos los módulos)'
                          : `${assignedAreas.length} módulos asignados`}
                      </p>
                    </div>
                  </div>

                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${meta.badge}`}>
                    {meta.titleEs}
                  </span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
                <span className="text-[10px] text-gray-400 font-mono">
                  UID: {u.uid.substring(0, 8)}...
                </span>

                {role === 'Owner' ? (
                  <div className="flex items-center gap-1.5">
                    <span className="px-2.5 py-1 rounded-xl bg-amber-50 text-[#D97706] border border-amber-200 text-[10px] font-bold">
                      Ver accesos
                    </span>
                    <span
                      className="p-1.5 rounded-xl bg-gray-100 text-gray-400 cursor-not-allowed"
                      title="Cuenta Propietario única protegida"
                    >
                      <Lock className="w-3.5 h-3.5" />
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditPermissions(u);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                      title="Ver y editar permisos (requiere clave del Propietario)"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      Permisos
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteClick(e, u)}
                      className="p-1.5 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer"
                      title={`Eliminar usuario ${u.name} (requiere clave del Propietario)`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Staff Modal */}
      <CreateStaffModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      {/* View / Edit Staff Permissions Modal */}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto text-gray-900"
          onClick={() => setEditTarget(null)}
        >
          <div
            className="w-full max-w-lg bg-white border border-gray-200 rounded-3xl shadow-2xl p-5 sm:p-6 max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between pb-3 border-b border-gray-200 shrink-0">
              <div>
                <h3 className="text-lg font-black text-gray-900">
                  {editTarget.role === 'Owner' ? 'Permisos del Propietario Único' : 'Permisos Asignados'}
                </h3>
                <p className="text-xs font-semibold text-gray-500 mt-0.5">
                  {editTarget.name} {editTarget.lastName || ''} · {ROLE_META[editTarget.role]?.titleEs || editTarget.role}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editTarget.role === 'Owner' ? (
              <div className="flex-1 overflow-y-auto space-y-4 pt-4 pr-1">
                <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 text-xs text-amber-900 font-semibold leading-relaxed">
                  El Propietario único tiene control total sobre los {AVAILABLE_AREAS.length + 1} módulos, incluyendo Configuración, borrado/encerado del sistema y autorización de permisos.
                </div>

                <div className="border border-gray-200 rounded-2xl p-4 space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-800">
                    Módulos con acceso total ({editAreas.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {editAreas.map((area) => (
                      <div key={area} className="flex items-center gap-2 p-1.5 rounded-xl bg-[#EAF5F0]/60 text-xs font-semibold text-[#4A5D23]">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{area}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setEditTarget(null)}
                    className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold cursor-pointer"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSavePermissions} className="flex-1 overflow-y-auto space-y-4 pt-4 pr-1">
                {permissionModalError && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{permissionModalError}</span>
                  </div>
                )}

                <div className="border border-gray-200 rounded-2xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-800">
                      Áreas autorizadas ({editAreas.length}/{AVAILABLE_AREAS.length})
                    </h4>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {AVAILABLE_AREAS.map((area) => {
                      const checked = editAreas.includes(area);
                      return (
                        <label
                          key={area}
                          className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setEditAreas((prev) =>
                                prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
                              )
                            }
                            className="w-4 h-4 rounded text-[#4A5D23] border-gray-300 cursor-pointer shrink-0"
                          />
                          <span className="text-xs font-semibold text-gray-800 leading-tight">{area}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="border border-gray-200 rounded-2xl p-4 space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-800">Locales autorizados</h4>
                  <div className="flex flex-wrap gap-3">
                    {availableBranches.map((branch) => (
                      <label key={branch} className="flex items-center gap-2 p-1 rounded-xl cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editBranches.includes(branch)}
                          onChange={() =>
                            setEditBranches((prev) =>
                              prev.includes(branch) ? prev.filter((b) => b !== branch) : [...prev, branch]
                            )
                          }
                          className="w-4 h-4 rounded text-[#4A5D23] border-gray-300 cursor-pointer"
                        />
                        <span className="text-xs font-semibold text-gray-800">{branch}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Owner Password Authorization Box */}
                <div className="border border-amber-200 bg-amber-50/50 rounded-2xl p-4 space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-[#D97706]" />
                    Clave del Propietario para autorizar cambios *
                  </label>
                  <div className="relative">
                    <input
                      type={showOwnerAuthPassword ? 'text' : 'password'}
                      required
                      value={ownerAuthPassword}
                      onChange={(e) => setOwnerAuthPassword(e.target.value)}
                      placeholder="Ingresa la contraseña del Propietario..."
                      className="w-full bg-white border border-amber-300 focus:border-[#4A5D23] rounded-xl pl-3.5 pr-10 py-2.5 text-xs font-mono text-gray-900 placeholder-gray-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      data-skip-enter="true"
                      onClick={() => setShowOwnerAuthPassword((p) => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
                    >
                      {showOwnerAuthPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    Por seguridad, solo el Propietario puede conceder o modificar permisos y únicamente él tiene facultad de borrado.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setEditTarget(null)}
                    className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingPermissions}
                    className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4 text-[#E89E2D]" />
                    {isSavingPermissions ? 'Verificando...' : 'Autorizar y Guardar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Delete Security Authorization Modal */}
      <DeleteAuthModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteUser}
        title="Eliminar Cuenta de Usuario"
        itemDescription={`el usuario "${deleteTarget?.name} ${deleteTarget?.lastName || ''}" (${deleteTarget?.role ? (ROLE_META[deleteTarget.role]?.titleEs || deleteTarget.role) : 'Personal'})`}
      />
    </div>
  );
};
