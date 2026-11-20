import React from 'react';
import { X, Sparkles, Award } from 'lucide-react';

interface AboutUsModalProps {
  isOpen: boolean;
  onClose: () => void;
  logoUrl?: string;
}

export const AboutUsModal: React.FC<AboutUsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const officialLogo = '/assets/gastrolab_fhd.jpg';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl bg-[#FFFFFF] border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-2xl text-[#1F2937] overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button "X" in top right */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-2xl bg-[#F8F9FA] text-gray-500 hover:text-gray-900 border border-gray-200 hover:bg-gray-100 transition-colors cursor-pointer z-10"
          title="Cerrar ventana"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Centered Official FHD GASTROLAB Logo & Title */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="p-2.5 rounded-2xl bg-white border border-gray-200 shadow-xs mb-3 flex items-center justify-center">
            <img
              src={officialLogo}
              alt="GASTROLAB by Iván Muñoz"
              className="h-20 w-auto object-contain rounded-xl"
            />
          </div>

          <h3 className="text-2xl font-black text-[#1F2937] tracking-tight flex items-center gap-2">
            About Us
            <Sparkles className="w-5 h-5 text-[#D97706]" />
          </h3>
        </div>

        {/* Exact Text Block as Requested in Point 13 */}
        <div className="bg-[#F8F9FA] border border-gray-200 rounded-2xl p-6 text-sm text-[#1F2937] space-y-4 leading-relaxed text-justify sm:text-left">
          <p className="font-extrabold text-[#4A5D23] text-base italic border-l-4 border-[#4A5D23] pl-3">
            Diseñado con visión, estructurado con precisión.
          </p>

          <p>
            Gastrolab no es solo una herramienta tecnológica; es el reflejo del esfuerzo, la dedicación y el compromiso con quienes sueñan en grande y buscan la excelencia en cada detalle de su negocio.
          </p>

          <p>
            Creado para simplificar y potenciar la gestión de todo tipo de establecimientos, GASTROLAB integra en un solo lugar el control absoluto de tus ingresos, gastos e inventarios. Su propósito es claro: facilitar el manejo integral de toda la estructura de tu local, transformando la complejidad operativa en una experiencia fluida, elegante y bajo control.
          </p>

          <p className="font-semibold text-[#1F2937]">
            Pensado especialmente para emprendedores y visionarios que no dejan nada al azar y necesitan el control total de cada engranaje de su negocio.
          </p>
        </div>

        {/* Footer info badge */}
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-gray-200 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-[#D97706]" />
            <span className="font-mono text-[#4A5D23] font-bold">GASTROLAB by Iván Muñoz</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer text-center shadow-xs"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
