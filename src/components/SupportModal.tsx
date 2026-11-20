import React from 'react';
import { X, MessageSquare, Mail } from 'lucide-react';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  logoUrl?: string;
}

export const SupportModal: React.FC<SupportModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const officialLogo = '/assets/gastrolab_fhd.jpg';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-[#FFFFFF] border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-2xl text-[#1F2937] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button "X" top right */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-2xl bg-[#F8F9FA] text-gray-500 hover:text-gray-900 border border-gray-200 hover:bg-gray-100 transition-colors cursor-pointer z-10"
          title="Cerrar ventana"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Centered Official FHD GASTROLAB Logo */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="p-2.5 rounded-2xl bg-white border border-gray-200 shadow-xs mb-3 flex items-center justify-center">
            <img
              src={officialLogo}
              alt="GASTROLAB by Iván Muñoz"
              className="h-20 w-auto object-contain rounded-xl"
            />
          </div>

          <h3 className="text-xl font-black text-[#1F2937] tracking-tight">
            Soporte Técnico y Actualizaciones
          </h3>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-[#4A5D23]">
              Asistencia Continua Activa
            </span>
          </div>
        </div>

        {/* Exact Text Block as Requested in Point 13 */}
        <div className="bg-[#F8F9FA] border border-gray-200 rounded-2xl p-5 mb-6 text-sm text-[#1F2937] space-y-4 leading-relaxed font-normal">
          <p>
            Tu negocio no se detiene, nosotros tampoco. Con GASTROLAB tienes la tranquilidad de contar con soporte técnico continuo y actualizaciones importantes para que tu sistema siempre esté un paso adelante.
          </p>

          <p className="font-semibold text-[#1F2937]">
            ¿Listo para transformar la gestión de tu local o necesitas asistencia? Estamos a un mensaje de distancia:
          </p>
        </div>

        {/* Action Buttons: Direct WhatsApp & Direct Email */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href="https://wa.me/593958737213?text=Hola%20equipo%20de%20GASTROLAB,%20necesito%20asistencia%20con%20mi%20sistema%20POS"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2.5 px-4 py-3 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95 cursor-pointer text-center"
          >
            <MessageSquare className="w-4 h-4 text-[#D97706]" />
            Abrir WhatsApp
          </a>

          <a
            href="mailto:gastrolab.ec@gmail.com?subject=Soporte%20GASTROLAB%20POS"
            className="flex items-center justify-center gap-2.5 px-4 py-3 rounded-2xl bg-[#F8F9FA] hover:bg-gray-100 border border-gray-200 text-[#1F2937] text-xs font-bold uppercase tracking-wider transition-all shadow-xs active:scale-95 cursor-pointer text-center"
          >
            <Mail className="w-4 h-4 text-[#4A5D23]" />
            Enviar Correo
          </a>
        </div>
      </div>
    </div>
  );
};
