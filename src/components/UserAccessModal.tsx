import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  X,
  KeyRound,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Building2,
  Calendar,
  LogOut,
  Sparkles,
  Check,
  ArrowRight,
  Clock,
} from 'lucide-react';

interface UserAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantName?: string;
}

export const UserAccessModal: React.FC<UserAccessModalProps> = ({
  isOpen,
  onClose,
  restaurantName = '',
}) => {
  const {
    userProfile,
    ownerProfile,
    systemLicense,
    activate12CharLicense,
    updateCurrentUserPassword,
    isExpiringSoon,
    daysRemaining,
    remainingTrialMs,
    licenseValidUntil,
    logout,
  } = useAuth();

  const [isActivating, setIsActivating] = useState(false);
  const [licenseCode, setLicenseCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password change state
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPass, setIsUpdatingPass] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [localNowMs, setLocalNowMs] = useState(() => Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setLocalNowMs(Date.now());
    const t = setInterval(() => setLocalNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isOpen]);

  if (!isOpen) return null;

  // Mi Acceso ALWAYS shows the Store Owner (Propietario) fixed regardless of active staff user
  const fixedOwner = ownerProfile || (userProfile?.role === 'Owner' ? userProfile : null);
  const ownerName = fixedOwner
    ? `${fixedOwner.name || ''} ${fixedOwner.lastName || ''}`.trim() || 'Propietario'
    : 'Propietario del Local';
  const ownerUsername = fixedOwner?.email
    ? fixedOwner.email.split('@')[0]
    : fixedOwner?.name?.toLowerCase().replace(/\s+/g, '') || 'propietario';

  const isLicensed =
    systemLicense?.status === 'active' ||
    !!systemLicense?.activeLicenseCode ||
    !!systemLicense?.licenseValidUntil;

  // Format live 15-day trial countdown (Xd Xh Xm Xs)
  const liveTrialRemaining = systemLicense?.trialEndsAt
    ? Math.max(0, new Date(systemLicense.trialEndsAt).getTime() - localNowMs)
    : remainingTrialMs;
  const totalSeconds = Math.max(0, Math.floor(liveTrialRemaining / 1000));
  const trialDays = Math.floor(totalSeconds / 86400);
  const trialHours = Math.floor((totalSeconds % 86400) / 3600);
  const trialMins = Math.floor((totalSeconds % 3600) / 60);
  const trialSecs = totalSeconds % 60;
  const trialCountdownStr = `${trialDays}d ${String(trialHours).padStart(2, '0')}h ${String(trialMins).padStart(2, '0')}m ${String(trialSecs).padStart(2, '0')}s`;

  const formatValidUntil = (isoDate?: string | null) => {
    if (!isoDate) return 'Sin fecha';
    try {
      const d = new Date(isoDate);
      return d.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return isoDate;
    }
  };

  const handleActivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    const cleaned = licenseCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length !== 12) {
      setMessage({
        type: 'error',
        text: 'El código de licencia debe contener exactamente 12 caracteres alfanuméricos.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await activate12CharLicense(cleaned);
      if (res.success) {
        setMessage({
          type: 'success',
          text: res.message || '¡Licencia activada con éxito por 1 año (365 días)!',
        });
        setIsActivating(false);
        setLicenseCode('');
      } else {
        setMessage({
          type: 'error',
          text: res.message || 'Código no válido.',
        });
      }
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err.message || 'Error al activar la licencia.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword.trim().length < 4) {
      setPasswordMsg({
        type: 'error',
        text: 'La nueva contraseña debe tener al menos 4 caracteres.',
      });
      return;
    }

    if (newPassword.trim() !== confirmPassword.trim()) {
      setPasswordMsg({
        type: 'error',
        text: 'Las contraseñas no coinciden.',
      });
      return;
    }

    setIsUpdatingPass(true);
    try {
      await updateCurrentUserPassword(newPassword.trim());
      setPasswordMsg({
        type: 'success',
        text: 'Contraseña actualizada exitosamente en el sistema.',
      });
      setNewPassword('');
      setConfirmPassword('');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setShowPasswordChange(false);
        setPasswordMsg(null);
      }, 1500);
    } catch (err: any) {
      setPasswordMsg({
        type: 'error',
        text: err?.message || 'Error al guardar la nueva contraseña.',
      });
    } finally {
      setIsUpdatingPass(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-white rounded-3xl p-6 sm:p-7 shadow-2xl border border-gray-200 text-[#1F2937] overflow-y-auto max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-[#4B5563] hover:text-[#1F2937] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#4A5D23]/10 border border-[#4A5D23]/20 flex items-center justify-center text-[#4A5D23] shrink-0 shadow-xs">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-black text-[#1F2937] leading-tight">
              Mi Acceso
            </h3>
            <p className="text-xs text-[#4B5563] mt-0.5">
              Datos del Propietario y licencia del local
            </p>
          </div>
        </div>

        {/* Fixed Owner Profile Card */}
        <div className="p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200 mb-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[#4A5D23] text-white flex items-center justify-center font-bold text-sm shadow-xs">
                {ownerName
                  .split(' ')
                  .filter(Boolean)
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2) || 'PR'}
              </div>
              <div>
                <h4 className="font-extrabold text-sm text-[#1F2937] leading-tight">
                  {ownerName}
                </h4>
                <p className="text-xs text-[#4B5563] font-mono">@{ownerUsername}</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-[#4A5D23]/15 text-[#4A5D23] border border-[#4A5D23]/30">
              Propietario
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs pt-3 border-t border-gray-200">
            <div>
              <span className="text-gray-400 block text-[10px] uppercase font-bold">Local</span>
              <span className="font-bold text-[#1F2937] flex items-center gap-1 mt-0.5">
                <Building2 className="w-3.5 h-3.5 text-[#6B8E23]" />
                {restaurantName}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-[10px] uppercase font-bold">Versión</span>
              <span className="font-mono font-bold text-[#1F2937] block mt-0.5">v1.5.13 FHD</span>
            </div>
          </div>
        </div>

        {/* License Status Box with live 15-day countdown */}
        <div className="p-4 rounded-2xl border border-gray-200 bg-white mb-5 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#4B5563] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#4A5D23]" />
              Estado de Licencia
            </span>

            {isLicensed ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-300">
                Licencia Activa
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-50 text-[#D97706] border border-amber-300">
                Prueba 15 Días
              </span>
            )}
          </div>

          {isLicensed ? (
            <div className="text-xs text-[#4B5563] space-y-1">
              <div className="flex items-center justify-between py-1 border-b border-gray-100">
                <span>Válida hasta:</span>
                <strong className="text-[#1F2937] font-mono flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-[#6B8E23]" />
                  {formatValidUntil(licenseValidUntil || systemLicense?.licenseValidUntil)}
                </strong>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>Tiempo de vigencia:</span>
                <span className="text-[#4A5D23] font-bold font-mono">
                  {daysRemaining} días restantes
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-2 mt-1">
              <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 flex items-center justify-between text-xs">
                <span className="font-bold text-amber-900 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#D97706]" />
                  Tiempo restante de prueba:
                </span>
                <span className="font-mono font-black text-[#D97706]">
                  {trialCountdownStr}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#4B5563]">
                <span>Finaliza el:</span>
                <strong className="font-mono text-[#1F2937]">
                  {formatValidUntil(licenseValidUntil || systemLicense?.trialEndsAt)} ({daysRemaining} días)
                </strong>
              </div>
              <p className="text-[11px] text-[#4B5563]">
                Ingresa una licencia de 12 caracteres al finalizar los 15 días para activar 1 año completo.
              </p>
            </div>
          )}

          {/* Warning 10 days before expiration */}
          {isExpiringSoon && (
            <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0" />
              <span>
                ¡Atención! Tu {isLicensed ? 'licencia' : 'prueba'} expira en {daysRemaining} días. Activa tu código para evitar interrupciones.
              </span>
            </div>
          )}

          {/* Action Button */}
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
            {!isLicensed ? (
              <button
                type="button"
                onClick={() => setIsActivating(!isActivating)}
                className="w-full py-2.5 px-4 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-white" />
                Ingresar Código de Licencia
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsActivating(!isActivating)}
                className="py-1.5 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-[#4B5563] hover:text-[#1F2937] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#4A5D23]" />
                Renovar Licencia
              </button>
            )}
          </div>

          {isActivating && (
            <form onSubmit={handleActivateSubmit} className="mt-3 p-3 rounded-2xl bg-[#F8F9FA] border border-gray-200 space-y-2.5 animate-in fade-in duration-150">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#1F2937]">
                Código de 12 Caracteres (Vigencia 1 Año):
              </label>
              <div className="relative">
                <input
                  type="text"
                  maxLength={12}
                  value={licenseCode}
                  onChange={(e) => setLicenseCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="Ej. GASTRO2026XX"
                  className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-center font-mono font-bold text-sm tracking-widest text-[#1F2937] uppercase focus:outline-none"
                  autoFocus
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#4B5563]">
                <span>{licenseCode.length}/12 caracteres</span>
              </div>

              {message && (
                <div
                  className={`p-2.5 rounded-xl text-xs font-semibold ${
                    message.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                      : 'bg-rose-50 text-rose-700 border border-rose-300'
                  }`}
                >
                  {message.text}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsActivating(false)}
                  className="flex-1 py-2 rounded-xl bg-gray-200 text-xs font-bold text-[#4B5563] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || licenseCode.length !== 12}
                  className="flex-1 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-40 text-xs font-bold text-white uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  {isSubmitting ? 'Verificando...' : 'Activar 1 Año'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Change Password Collapsible Section */}
        {showPasswordChange && (
          <form onSubmit={handlePasswordSubmit} className="p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200 mb-5 space-y-3 animate-in fade-in duration-150">
            <h5 className="text-xs font-bold uppercase tracking-wider text-[#1F2937] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#4A5D23]" />
              Cambiar Contraseña (Usuario Activo: {userProfile?.name})
            </h5>

            <div>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nueva contraseña..."
                className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-[#1F2937] focus:outline-none"
              />
            </div>
            <div>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirmar nueva contraseña..."
                className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-[#1F2937] focus:outline-none"
              />
            </div>

            {passwordMsg && (
              <div
                className={`p-2 rounded-xl text-xs font-semibold ${
                  passwordMsg.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-rose-50 text-rose-700'
                }`}
              >
                {passwordMsg.text}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPasswordChange(false)}
                className="flex-1 py-2 rounded-xl bg-gray-200 text-xs font-bold text-[#4B5563] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isUpdatingPass}
                className="flex-1 py-2 rounded-xl bg-[#4A5D23] disabled:opacity-50 text-white text-xs font-bold uppercase cursor-pointer"
              >
                {isUpdatingPass ? 'Guardando...' : 'Guardar Clave'}
              </button>
            </div>
          </form>
        )}

        {/* Bottom Options List */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowPasswordChange(!showPasswordChange)}
            className="w-full py-2.5 px-3.5 rounded-xl bg-[#F8F9FA] hover:bg-gray-100 border border-gray-200 text-xs font-bold text-[#1F2937] flex items-center justify-between transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#4A5D23]" />
              Cambiar mi contraseña
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
          </button>

          <button
            type="button"
            onClick={async () => {
              onClose();
              await logout();
            }}
            className="w-full py-2.5 px-3.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-bold text-rose-700 flex items-center justify-center gap-2 transition-colors cursor-pointer mt-3"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión / cambiar usuario
          </button>
        </div>
      </div>
    </div>
  );
};
