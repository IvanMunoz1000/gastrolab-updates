import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  KeyRound,
  ShieldAlert,
  Smartphone,
  Laptop,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

export const LicenseBlockScreen: React.FC = () => {
  const {
    activateLicenseCode,
    activate12CharLicense,
    resetTrial,
    currentDevice,
    logout,
  } = useAuth();

  const [inputCode, setInputCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const cleaned = inputCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (cleaned.length !== 8 && cleaned.length !== 12) {
      setFeedback({
        type: 'error',
        message: 'El código de licencia debe contener 12 caracteres (anual) u 8 caracteres.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      let res;
      if (cleaned.length === 12) {
        res = await activate12CharLicense(cleaned);
      } else {
        res = await activateLicenseCode(cleaned);
      }

      if (res.success) {
        setFeedback({
          type: 'success',
          message: res.message || '¡Licencia activada con éxito! Acceso al POS desbloqueado sin perder datos.',
        });
        setInputCode('');
      } else {
        setFeedback({
          type: 'error',
          message: res.message || 'Código de licencia inválido o ya utilizado.',
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Error de comunicación con Firestore.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickFill = () => {
    setInputCode('GL2026MASTER');
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#1F2937]/90 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto text-[#1F2937]">
      <div className="w-full max-w-xl bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-8 relative">
        {/* Header with GASTROLAB logo */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="p-2 rounded-2xl bg-white border border-gray-100 mb-3 shadow-md">
            <img
              src="/assets/gastrolab_fhd.jpg"
              alt="GASTROLAB by Iván Muñoz"
              className="h-24 w-24 object-contain rounded-xl"
            />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-300 text-[#D97706] text-xs font-bold uppercase tracking-widest mb-2">
            <ShieldAlert className="w-3.5 h-3.5 text-[#D97706]" />
            Período de Licencia Expirado
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-[#1F2937] tracking-tight">
            GASTRO<span className="text-[#4A5D23]">LAB</span> by Iván Muñoz
          </h2>
          <p className="text-xs text-[#4B5563] mt-2 max-w-md">
            Tu período de evaluación o vigencia ha concluido. Ingresa un código de licencia de 12 caracteres para desbloquear las operaciones inmediatamente sin perder información.
          </p>
        </div>

        {/* Feedback alert */}
        {feedback && (
          <div
            className={`mb-5 p-4 rounded-2xl border flex items-start gap-3 text-xs font-semibold ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-rose-50 border-rose-300 text-rose-700'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 font-medium">{feedback.message}</div>
          </div>
        )}

        {/* Activation Code Form */}
        <form onSubmit={handleActivate} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] mb-2">
              Ingresa el Código de Licencia (12 caracteres)
            </label>
            <div className="relative">
              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                maxLength={12}
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="Ej. GASTRO2026XX"
                className="w-full bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-2xl pl-12 pr-4 py-3.5 text-center font-mono text-xl tracking-[0.2em] text-[#1F2937] font-bold placeholder-gray-400 focus:outline-none transition-colors uppercase"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-[#4B5563] mt-2">
              <span>{inputCode.length}/12 caracteres ingresados</span>
              <button
                type="button"
                onClick={handleQuickFill}
                className="text-[#4A5D23] hover:underline font-semibold flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                Pegar Código Demo de 12 caracteres
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || (inputCode.length !== 8 && inputCode.length !== 12)}
            className="w-full bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-bold py-3.5 rounded-2xl transition-all shadow-md active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed text-xs uppercase tracking-wider cursor-pointer"
          >
            {isSubmitting ? 'Verificando licencia...' : 'Renovar Licencia y Desbloquear'}
          </button>
        </form>

        {/* Device Policy Info (1 PC + 3 Mobile) */}
        <div className="mt-6 p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200">
          <div className="text-xs font-bold uppercase tracking-wider text-[#4B5563] mb-3 flex items-center justify-between">
            <span>Política de Terminales por Licencia</span>
            <span className="text-[#4A5D23] font-mono font-bold">Máx 4 Dispositivos</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-white border border-gray-200 flex items-center gap-2.5 shadow-xs">
              <Laptop className="w-4 h-4 text-[#4A5D23] shrink-0" />
              <div>
                <div className="font-bold text-[#1F2937]">1 PC / Central</div>
                <div className="text-[11px] text-gray-500">Terminal Principal</div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white border border-gray-200 flex items-center gap-2.5 shadow-xs">
              <Smartphone className="w-4 h-4 text-[#6B8E23] shrink-0" />
              <div>
                <div className="font-bold text-[#1F2937]">3 Terminales</div>
                <div className="text-[11px] text-gray-500">Móviles / Cocina</div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-[11px] text-[#4B5563] flex items-center justify-between border-t border-gray-200 pt-2.5">
            <span>Dispositivo Actual: <strong className="text-[#1F2937]">{currentDevice.deviceName}</strong></span>
            <span className="px-2 py-0.5 rounded-full bg-gray-200 text-[#1F2937] font-mono text-[10px] font-bold">{currentDevice.deviceType}</span>
          </div>
        </div>

        {/* Footer controls */}
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="text-[11px] text-[#4B5563]">
            Contacto licencias: <strong className="text-[#4A5D23]">gastrolab.ec@gmail.com</strong>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => resetTrial()}
              className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 bg-[#F8F9FA] hover:bg-gray-100 text-[#4B5563] flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Restablecer prueba a 15 días"
            >
              <RotateCcw className="w-3 h-3 text-[#D97706]" />
              Reiniciar Prueba (15 Días)
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="text-xs px-3 py-1.5 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 font-bold transition-colors cursor-pointer"
            >
              Cerrar Sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
