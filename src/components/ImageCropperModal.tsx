import React, { useState, useRef, useEffect } from 'react';
import { X, Check, RotateCw, ZoomIn, Move, Crop, RefreshCcw } from 'lucide-react';

interface Props {
  isOpen: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onCropComplete: (croppedDataUrl: string, croppedFile: File) => void;
}

export const ImageCropperModal: React.FC<Props> = ({
  isOpen,
  imageSrc,
  onClose,
  onCropComplete,
}) => {
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!isOpen || !imageSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      setRotation(0);
      drawPreview(img, 1, 0, 0, 0);
    };
    img.src = imageSrc;
  }, [isOpen, imageSrc]);

  const drawPreview = (
    img: HTMLImageElement,
    scale: number,
    dx: number,
    dy: number,
    rot: number
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width; // 400x400 display
    ctx.clearRect(0, 0, size, size);

    // Background checkered/white
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    // Center point
    ctx.translate(size / 2 + dx, size / 2 + dy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(scale, scale);

    // Calculate aspect ratio fit
    const aspect = img.width / img.height;
    let renderW = size;
    let renderH = size;
    if (aspect > 1) {
      renderW = size * aspect;
      renderH = size;
    } else {
      renderW = size;
      renderH = size / aspect;
    }

    ctx.drawImage(img, -renderW / 2, -renderH / 2, renderW, renderH);
    ctx.restore();

    // Draw circular/square boundary guide
    ctx.strokeStyle = '#4A5D23';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);

    // Rule of thirds grid
    ctx.strokeStyle = 'rgba(74, 93, 35, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 3, 0);
    ctx.lineTo(size / 3, size);
    ctx.moveTo((size * 2) / 3, 0);
    ctx.lineTo((size * 2) / 3, size);
    ctx.moveTo(0, size / 3);
    ctx.lineTo(size, size / 3);
    ctx.moveTo(0, (size * 2) / 3);
    ctx.lineTo(size, (size * 2) / 3);
    ctx.stroke();
  };

  useEffect(() => {
    if (imgRef.current) {
      drawPreview(imgRef.current, zoom, offsetX, offsetY, rotation);
    }
  }, [zoom, offsetX, offsetY, rotation]);

  if (!isOpen || !imageSrc) return null;

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offsetX, y: e.clientY - offsetY });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setOffsetX(e.clientX - dragStart.x);
    setOffsetY(e.clientY - dragStart.y);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - offsetX,
        y: e.touches[0].clientY - offsetY,
      });
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDragging || e.touches.length !== 1) return;
    setOffsetX(e.touches[0].clientX - dragStart.x);
    setOffsetY(e.touches[0].clientY - dragStart.y);
  };

  const handleReset = () => {
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
    setRotation(0);
  };

  const handleApplyCrop = () => {
    if (!imgRef.current) return;
    const outputCanvas = document.createElement('canvas');
    const outSize = 500; // Lightweight 500x500 square (<70KB) safe for Firestore & instant rendering
    outputCanvas.width = outSize;
    outputCanvas.height = outSize;
    const ctx = outputCanvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outSize, outSize);

    // Scale offsets to output size
    const factor = outSize / 360;
    ctx.save();
    ctx.translate(outSize / 2 + offsetX * factor, outSize / 2 + offsetY * factor);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(zoom, zoom);

    const aspect = imgRef.current.width / imgRef.current.height;
    let renderW = outSize;
    let renderH = outSize;
    if (aspect > 1) {
      renderW = outSize * aspect;
      renderH = outSize;
    } else {
      renderW = outSize;
      renderH = outSize / aspect;
    }

    ctx.drawImage(imgRef.current, -renderW / 2, -renderH / 2, renderW, renderH);
    ctx.restore();

    const croppedDataUrl = outputCanvas.toDataURL('image/jpeg', 0.8);
    const filename = `dish_${Date.now()}.jpg`;

    const buildFileFromDataUrl = (): File => {
      const parts = croppedDataUrl.split(',');
      const bstr = atob(parts[1] || '');
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], filename, { type: 'image/jpeg' });
    };

    if (typeof outputCanvas.toBlob === 'function') {
      outputCanvas.toBlob(
        (blob) => {
          const croppedFile = blob
            ? new File([blob], filename, { type: 'image/jpeg' })
            : buildFileFromDataUrl();
          onCropComplete(croppedDataUrl, croppedFile);
          onClose();
        },
        'image/jpeg',
        0.8
      );
    } else {
      onCropComplete(croppedDataUrl, buildFileFromDataUrl());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-60 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 text-gray-900 overflow-y-auto">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl shadow-2xl p-5 sm:p-6 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
              <Crop className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#1F2937]">Centrar y Recortar Foto</h3>
              <p className="text-[11px] text-[#4B5563]">Ajusta el encuadre para la Carta</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Canvas viewport */}
        <div className="flex flex-col items-center justify-center bg-[#F8F9FA] rounded-2xl p-3 border border-gray-200 select-none">
          <canvas
            ref={canvasRef}
            width={360}
            height={360}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleMouseUp}
            className="rounded-xl shadow-inner cursor-move touch-none border border-gray-300 max-w-full h-auto"
          />
          <span className="text-[10px] text-[#4B5563] mt-2 flex items-center gap-1 font-semibold">
            <Move className="w-3 h-3 text-[#4A5D23]" />
            Arrastra con el cursor o el dedo para centrar
          </span>
        </div>

        {/* Controls */}
        <div className="mt-4 space-y-3">
          {/* Zoom Control */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-semibold text-[#4B5563]">
              <span className="flex items-center gap-1">
                <ZoomIn className="w-3.5 h-3.5 text-[#4A5D23]" />
                Zoom / Escala
              </span>
              <span className="font-mono text-[11px] font-bold text-gray-700">
                {zoom.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min={0.6}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-full accent-[#4A5D23] cursor-pointer"
            />
          </div>

          {/* Quick rotation & reset buttons */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="px-2.5 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                title="Girar 90 grados"
              >
                <RotateCw className="w-3.5 h-3.5 text-[#4A5D23]" />
                Girar 90°
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="px-2.5 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                title="Restablecer posición inicial"
              >
                <RefreshCcw className="w-3.5 h-3.5 text-gray-500" />
                Centrar
              </button>
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="mt-5 pt-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-[#4B5563] text-xs font-semibold cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleApplyCrop}
            className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer flex items-center gap-1.5"
          >
            <Check className="w-4 h-4 text-[#D97706]" />
            Guardar Foto Recortada
          </button>
        </div>
      </div>
    </div>
  );
};
