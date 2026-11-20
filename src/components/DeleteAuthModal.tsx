import React, { useState } from 'react';
import { ShieldAlert, Lock, X, Check, Eye, EyeOff, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface DeleteAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void | Promise<void>;
  title?: string;
  itemDescription?: string;
  confirmButtonText?: string;
}

export const DeleteAuthModal: React.FC<DeleteAuthModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Autorización del Propietario Requerida',
  itemDescription = 'este elemento',
  confirmButtonText = 'Confirmar Eliminación',
}) => {
  const { verifyOwnerPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedPw = password.trim();
    const trimmedReason = reason.trim();

    if (!trimmedPw) {
      setErrorMsg('Por favor ingresa la clave del Propietario.');
      return;
    }

    if (!trimmedReason) {
      setErrorMsg('Debes ingresar un motivo para autorizar la eliminación.');
      return;
    }

    setIsVerifying(true);
    try {
      const isValidOwner = await verifyOwnerPassword(trimmedPw);
      if (isValidOwner) {
        const currentReason = trimmedReason;
        setPassword('');
        setReason('');
        setErrorMsg(null);
        await onConfirm(currentReason);
        onClose();
      } else {
        setErrorMsg('Clave incorrecta. Solo el Propietario está autorizado para borrar o encerar.');
      }
    } catch {
      setErrorMsg('No se pudo validar la clave del Propietario. Intenta de nuevo.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCancel = () => {
    setPassword('');
    setReason('');
    setErrorMsg(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-md bg-white rounded-3xl p-6 sm:p-7 shadow-2xl border border-gray-200 text-gray-900 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={handleCancel}
          className="absolute top-5 right-5 p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header Icon */}
        <div className="flex items-center gap-3.5 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-[#D97706] shrink-0 shadow-sm">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#1F2937] leading-tight">
              {title}
            </h3>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#D97706] bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              Exclusivo Propietario
            </span>
          </div>
        </div>

        <p className="text-xs text-[#4B5563] mb-5 leading-relaxed">
          Para eliminar <strong className="text-[#1F2937]">{itemDescription}</strong> de forma permanente, debes confirmar con la <strong className="text-[#4A5D23]">Clave del Propietario</strong> e indicar el motivo. Solo el Propietario está autorizado para borrar o encerar.
        </p>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] mb-1.5">
              Clave del Propietario *
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ingresa la clave del Propietario..."
                autoFocus
                className="w-full bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-2xl pl-10 pr-10 py-2.5 text-sm font-mono text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors"
              />
              <button
                type="button"
                tabIndex={-1}
                data-skip-enter="true"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] mb-1.5">
              Motivo de Eliminación *
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-3 text-gray-400">
                <FileText className="w-4 h-4" />
              </div>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Indica el motivo (ej. duplicado, error de digitación, merma descartada)..."
                rows={2}
                className="w-full bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-2xl pl-10 pr-3.5 py-2 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors resize-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 py-2.5 rounded-2xl bg-gray-100 hover:bg-gray-200 text-[#4B5563] text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isVerifying}
              className="flex-1 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4 text-white" />
              {isVerifying ? 'Verificando...' : confirmButtonText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
