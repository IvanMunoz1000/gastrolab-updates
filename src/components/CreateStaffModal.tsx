import { useBranch } from '../context/BranchContext';
import React, { useState, useEffect, useRef } from 'react';
import { useAuth, mapAuthErrorToSpanish } from '../context/AuthContext';
import { UserRole } from '../types';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  X,
  User,
  Lock,
  Eye,
  EyeOff,
  Shield,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

const ROLES: { role: UserRole; titleEs: string; desc: string }[] = [
  { role: 'Kitchen Manager', titleEs: 'Jefe de Cocina', desc: 'Cocina, recetas, mermas e inventario' },
  { role: 'Admin', titleEs: 'Administrador', desc: 'Gestión general de personal y terminales' },
  { role: 'Cashier', titleEs: 'Cajero', desc: 'Caja, turnos, clientes y facturación' },
  { role: 'Kitchen Assistant', titleEs: 'Asistente de Cocina', desc: 'Línea de producción y despacho' },
  { role: 'Service Staff', titleEs: 'Personal de Servicio', desc: 'Toma de comandas en mesas y reservas' },
];

export const AVAILABLE_AREAS = [
  'Resumen Diario',
  'Mesas y Pedidos',
  'Reservas',
  'Cocina',
  'Carta',
  'Recetas y Subrecetas',
  'Inventario',
  'Menaje y Equipos',
  'Cajas y Turnos',
  'Facturación',
  'Clientes',
  'Proveedores',
  'Facturas de Compras',
  'Kardex - Entradas y Salidas',
  'Control de Mermas',
  'Control de Inventario',
  'Dashboard',
  'Usuarios y Permisos',
];

export const ROLE_DEFAULT_AREAS: Record<UserRole, string[]> = {
  Owner: [...AVAILABLE_AREAS],
  Admin: AVAILABLE_AREAS.filter((a) => a !== 'Dashboard'),
  Cashier: ['Resumen Diario', 'Mesas y Pedidos', 'Reservas', 'Cajas y Turnos', 'Clientes', 'Facturación'],
  'Kitchen Manager': [
    'Cocina',
    'Carta',
    'Inventario',
    'Kardex - Entradas y Salidas',
    'Recetas y Subrecetas',
    'Control de Mermas',
    'Menaje y Equipos',
    'Facturas de Compras',
    'Proveedores',
    'Control de Inventario',
  ],
  'Kitchen Assistant': ['Cocina', 'Recetas y Subrecetas', 'Control de Mermas'],
  'Service Staff': ['Resumen Diario', 'Mesas y Pedidos', 'Reservas', 'Clientes'],
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUserCreated?: () => void;
}

export const CreateStaffModal: React.FC<Props> = ({ isOpen, onClose, onUserCreated }) => {
  const { createStaffUser } = useAuth();

  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('Kitchen Manager');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [authorizedAreas, setAuthorizedAreas] = useState<string[]>(ROLE_DEFAULT_AREAS['Kitchen Manager']);
  const { availableBranches } = useBranch();
  const [authorizedBranches, setAuthorizedBranches] = useState<string[]>(['Matriz']);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setPassword('');
    setShowPassword(false);
    setErrorMsg(null);
    setSuccessMsg(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    setAuthorizedAreas(ROLE_DEFAULT_AREAS[newRole] || []);
  };

  const toggleArea = (area: string) => {
    setAuthorizedAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  };

  const toggleBranch = (branch: string) => {
    setAuthorizedBranches((prev) =>
      prev.includes(branch) ? prev.filter((b) => b !== branch) : [...prev, branch]
    );
  };

  const currentRoleTitle = ROLES.find((r) => r.role === role)?.titleEs || 'Personal';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMsg('Por favor ingresa el nombre del usuario.');
      return;
    }

    if (password.length < 4) {
      setErrorMsg('La clave de acceso debe tener al menos 4 dígitos.');
      return;
    }

    if (authorizedAreas.length === 0) {
      setErrorMsg('Selecciona al menos un área autorizada para este usuario.');
      return;
    }

    setIsSubmitting(true);
    try {
      const cleanSlug = trimmedName.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(100 + Math.random() * 900);
      const generatedEmail = `${cleanSlug}@gastrolab.pos`;

      const result = await createStaffUser(trimmedName, '', generatedEmail, password, role);

      if (result?.uid) {
        await updateDoc(doc(db, 'users', result.uid), {
          authorizedAreas,
          authorizedBranches: authorizedBranches.length > 0 ? authorizedBranches : ['Matriz'],
          canDeleteWithPersonalPassword: false,
        });
      }

      setSuccessMsg(`¡Usuario ${trimmedName} (${currentRoleTitle}) creado exitosamente!`);
      setName('');
      setPassword('');

      if (onUserCreated) onUserCreated();
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setErrorMsg(mapAuthErrorToSpanish(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto text-gray-900">
      <div className="w-full max-w-lg bg-white border border-gray-200 rounded-3xl shadow-2xl p-5 sm:p-7 relative max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-gray-200 shrink-0">
          <div>
            <h3 className="text-xl font-black text-gray-900 tracking-tight">Crear usuario</h3>
            <p className="text-sm font-semibold text-gray-500 mt-0.5">{currentRoleTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="mt-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5 shrink-0">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="font-medium">{errorMsg}</div>
          </div>
        )}

        {successMsg && (
          <div className="mt-3 p-3 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-xs flex items-start gap-2.5 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-[#4A5D23] shrink-0 mt-0.5" />
            <div className="font-bold">{successMsg}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-5 pt-4 pr-1">
          {/* Nombre */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
              Nombre de usuario <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                required
                placeholder="Ej. Roberto Morales"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-2xl pl-10 pr-3.5 py-2.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Rol / Perfil Selector */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-[#E89E2D]" />
              Rol / Perfil Operativo <span className="text-rose-500">*</span>
            </label>
            <select
              value={role}
              onChange={(e) => handleRoleChange(e.target.value as UserRole)}
              className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-2xl px-3.5 py-2.5 text-xs font-semibold text-gray-900 focus:outline-none cursor-pointer"
            >
              {ROLES.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.titleEs} — {r.desc}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Solo puede existir 1 Propietario en el sistema. El personal creado aquí no tiene permisos de borrado.
            </p>
          </div>

          {/* Clave / PIN */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
              Clave de Acceso / PIN <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={4}
                maxLength={20}
                placeholder="Ingresa clave personal (mínimo 4 dígitos)..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#F8F9FA] border border-gray-300 focus:bg-white focus:border-[#4A5D23] rounded-2xl pl-10 pr-10 py-2.5 text-xs font-mono text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors"
              />
              <button
                type="button"
                tabIndex={-1}
                data-skip-enter="true"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Section: Áreas autorizadas */}
          <div className="border border-gray-200 rounded-3xl p-4.5 bg-white space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-gray-900">
                  Áreas autorizadas para este usuario
                </h4>
                <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                  Solo podrá ver e ingresar en los módulos seleccionados. Configuración es exclusiva del Propietario.
                </p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EAF5F0] text-[#4A5D23] shrink-0">
                {authorizedAreas.length}/{AVAILABLE_AREAS.length}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
              {AVAILABLE_AREAS.map((area) => {
                const isChecked = authorizedAreas.includes(area);
                return (
                  <label
                    key={area}
                    className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleArea(area)}
                      className="w-4 h-4 rounded text-[#4A5D23] border-gray-300 focus:ring-[#4A5D23] cursor-pointer shrink-0"
                    />
                    <span className="text-xs font-semibold text-gray-800 leading-tight">{area}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Section: Locales autorizados */}
          <div className="border border-gray-200 rounded-3xl p-4.5 bg-white space-y-2.5">
            <h4 className="text-sm font-bold text-gray-900">Locales autorizados</h4>
            <div className="flex flex-wrap gap-3">
              {availableBranches.map((branch) => (
                <label
                  key={branch}
                  className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={authorizedBranches.includes(branch)}
                    onChange={() => toggleBranch(branch)}
                    className="w-4 h-4 rounded text-[#4A5D23] border-gray-300 focus:ring-[#4A5D23] cursor-pointer"
                  />
                  <span className="text-xs font-semibold text-gray-800">{branch}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-[#E89E2D]" />
              {isSubmitting ? 'Guardando...' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
