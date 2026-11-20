import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ShieldAlert,
  Lock,
  X,
  AlertCircle,
  FileText,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  onAuthorized: (reason: string, authorizedByEmail: string) => void;
}

export const AdminAuthModal: React.FC<Props> = ({
  isOpen,
  onClose,
  title = 'Autorización Requerida',
  description = 'Esta comanda ya fue enviada a cocina. Para modificarla o anularla se requiere autorización del Propietario.',
  onAuthorized,
}) => {
  const { ownerProfile, userProfile, verifyOwnerPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanReason = reason.trim();
    if (!cleanReason) {
      setErrorMsg('Debe especificar el Motivo de anulación o modificación.');
      return;
    }

    if (!password.trim()) {
      setErrorMsg('Por favor ingrese la contraseña del Propietario.');
      return;
    }

    setIsVerifying(true);
    try {
      const isValidOwner = await verifyOwnerPassword(password.trim());
      if (!isValidOwner) {
        setErrorMsg('Contraseña incorrecta. Solo la clave del Propietario puede autorizar esta acción.');
        setIsVerifying(false);
        return;
      }

      const authorizerLabel =
        ownerProfile?.name || userProfile?.name || ownerProfile?.email || 'Propietario';
      onAuthorized(cleanReason, authorizerLabel);
      setPassword('');
      setReason('');
      onClose();
    } catch {
      setErrorMsg('No se pudo verificar la clave del Propietario. Intente de nuevo.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#111827]/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto text-white">
      <div className="w-full max-w-md bg-[#1F2937] border-2 border-[#E89E2D] rounded-3xl shadow-2xl p-6 sm:p-7 relative">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-[#374151] mb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#E89E2D]/15 border border-[#E89E2D]/40 flex items-center justify-center text-[#E89E2D] shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">{title}</h3>
              <p className="text-xs text-[#B5F2D1]">Bloqueo de seguridad de cocina</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-[#111827] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-gray-300 mb-4 bg-[#111827] p-3 rounded-xl border border-[#374151]">
          {description}
        </p>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>{errorMsg}</div>
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-4">
          {/* Motivo de anulación (Required) */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#B5F2D1] mb-1.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-[#E89E2D]" />
              Motivo de Anulación / Modificación <span className="text-[#E89E2D]">*</span>
            </label>
            <textarea
              required
              rows={2}
              placeholder="Ej. El comensal canceló el plato, mesa cambió de orden, error de digitación..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-[#111827] border border-[#374151] focus:border-[#E89E2D] rounded-xl p-3 text-xs text-white placeholder-gray-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Owner Password */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#B5F2D1] mb-1.5 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#E89E2D]" />
              Contraseña del Propietario <span className="text-[#E89E2D]">*</span>
            </label>
            <input
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#111827] border border-[#374151] focus:border-[#E89E2D] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none transition-colors"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#374151]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-[#111827] hover:bg-gray-800 text-gray-300 text-xs font-semibold cursor-pointer border border-[#374151]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isVerifying}
              className="px-5 py-2.5 rounded-xl bg-[#E89E2D] hover:bg-[#d88f20] text-slate-950 text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
            >
              {isVerifying ? 'Verificando...' : 'Autorizar Desbloqueo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
