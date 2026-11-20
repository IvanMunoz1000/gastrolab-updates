import React, { useState, useEffect } from 'react';
import { doc, updateDoc, setDoc, collection } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { InventoryItem, InventoryUnit } from '../types';
import {
  X,
  Package,
  Scale,
  AlertTriangle,
  CheckCircle2,
  Calculator,
  Calendar,
} from 'lucide-react';

interface Props {
  item: InventoryItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const EditInventoryItemModal: React.FC<Props> = ({
  item,
  isOpen,
  onClose,
  onSaved,
}) => {
  const { activeBranch } = useBranch();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<InventoryUnit>('Grs.');
  const [currentStock, setCurrentStock] = useState('');
  const [minStock, setMinStock] = useState('');
  const [cost, setCost] = useState('');
  const [category, setCategory] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [hasWaste, setHasWaste] = useState(false);
  const [showExpiryPicker, setShowExpiryPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setName(item.name || '');
      const rawUnit = item.unit as string;
      const normalizedUnit: InventoryUnit =
        rawUnit === 'kg' ? 'Grs.' : rawUnit === 'lt' ? 'Ml.' : rawUnit === 'unidad' ? 'Unds.' : (item.unit || 'Grs.');
      setUnit(normalizedUnit);
      setCurrentStock(item.currentStock != null ? String(item.currentStock) : '');
      setMinStock(item.minStock != null ? String(item.minStock) : '');

      const derivedTotalCost =
        item.totalCost != null
          ? item.totalCost
          : item.currentStock > 0
          ? Number(((item.costPerBaseUnit ?? item.cost ?? 0) * item.currentStock).toFixed(4))
          : item.costPerBaseUnit ?? item.cost ?? 0;

      setCost(derivedTotalCost ? String(derivedTotalCost) : '');
      setCategory(item.category || '');
      setExpiryDate(item.expiryDate || '');
      setShowExpiryPicker(!!item.expiryDate);
      setHasWaste(!!item.hasPendingWaste);
    } else {
      setName('');
      setUnit('Grs.');
      setCurrentStock('');
      setMinStock('');
      setCost('');
      setCategory('');
      setExpiryDate('');
      setShowExpiryPicker(false);
      setHasWaste(false);
    }
    setErrorMsg(null);
  }, [item, isOpen]);

  if (!isOpen) return null;

  const parsedStock = parseFloat(currentStock);
  const parsedTotalCost = parseFloat(cost);
  const exactUnitCost =
    !isNaN(parsedTotalCost) && !isNaN(parsedStock) && parsedStock > 0
      ? parsedTotalCost / parsedStock
      : !isNaN(parsedTotalCost)
      ? parsedTotalCost
      : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanName = name.trim();
    if (!cleanName) {
      setErrorMsg('El Nombre del Insumo es obligatorio.');
      return;
    }

    const parsedMin = parseFloat(minStock);

    if (isNaN(parsedStock) || parsedStock < 0 || isNaN(parsedMin) || parsedMin < 0 || isNaN(parsedTotalCost) || parsedTotalCost < 0) {
      setErrorMsg('Por favor ingresa valores numéricos válidos.');
      return;
    }

    const cleanUnitCost = parsedStock > 0 ? parsedTotalCost / parsedStock : parsedTotalCost;

    setIsSubmitting(true);
    try {
      const itemData = {
        name: cleanName,
        unit,
        currentStock: Math.max(0, parsedStock),
        minStock: Math.max(0, parsedMin),
        totalCost: Math.max(0, parsedTotalCost),
        cost: Math.max(0, cleanUnitCost),
        costPerBaseUnit: Math.max(0, cleanUnitCost),
        expiryDate: expiryDate || '',
        category: category.trim(),
        hasPendingWaste: hasWaste,
        pendingWasteQty: hasWaste ? (item?.pendingWasteQty || 0) : 0,
        branch: item?.branch || activeBranch,
        updatedAt: new Date().toISOString(),
      };

      if (item) {
        await commitOfflineSafe(updateDoc(doc(db, 'inventory', item.id), itemData), 'update_inventory_item');
      } else {
        const newRef = doc(collection(db, 'inventory'));
        await commitOfflineSafe(
          setDoc(newRef, {
            ...itemData,
            createdAt: new Date().toISOString(),
          }),
          'create_inventory_item'
        );
      }

      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      console.error('Error al guardar insumo:', err);
      setErrorMsg(err.message || 'No se pudo guardar el insumo en Firestore.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
      <div className="w-full max-w-lg bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 relative">
        <div className="flex items-center justify-between pb-4 border-b border-gray-200 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {item ? 'Editar Insumo / Existencia' : 'Nuevo Insumo en Inventario'}
              </h3>
            </div>
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
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                Nombre del Insumo <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Ej. Lomo Fino de Res"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                Categoría
              </label>
              <input
                type="text"
                placeholder="Ej. Carnes, Abarrotes, Lácteos"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                Unidad Oficial <span className="text-rose-500">*</span>
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as InventoryUnit)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs font-bold text-gray-900 focus:outline-none cursor-pointer"
              >
                <option value="Grs.">Grs. (Gramos)</option>
                <option value="Ml.">Ml. (Mililitros)</option>
                <option value="Unds.">Unds. (Unidades)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                Stock Actual <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="Ej. 1000"
                value={currentStock}
                onChange={(e) => setCurrentStock(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs font-mono text-gray-900 placeholder-gray-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                Stock Mínimo <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="Ej. 200"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs font-mono text-gray-900 placeholder-gray-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                COSTO TOTAL DEL PRODUCTO <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-mono text-xs">
                  $
                </span>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  required
                  placeholder="Ej. 3.00"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl pl-8 pr-4 py-2 text-xs font-mono text-gray-900 placeholder-gray-400 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-[#D97706]" />
                Fecha de Caducidad
              </label>
              {showExpiryPicker || expiryDate ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="flex-1 bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setExpiryDate('');
                      setShowExpiryPicker(false);
                    }}
                    className="px-2.5 py-2 rounded-xl bg-gray-100 hover:bg-rose-50 text-gray-600 hover:text-rose-600 border border-gray-200 text-xs font-bold cursor-pointer"
                    title="Quitar fecha de caducidad"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowExpiryPicker(true)}
                  className="w-full py-2 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-[#D97706]/50 text-amber-900 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5 text-[#D97706]" />
                  Fecha de Caducidad
                </button>
              )}
            </div>
          </div>

          {/* Automatic calculation card */}
          <div className="p-3.5 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-[#4A5D23]">
              <Calculator className="w-4 h-4" />
              <span className="font-semibold">Costo exacto por {unit}:</span>
            </div>
            <div className="font-mono font-black text-sm text-[#D97706]">
              ${exactUnitCost.toFixed(4)} / {unit}
            </div>
          </div>

          {/* Opción: Tiene Merma / No tiene merma */}
          <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200">
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">
              Control de Merma del Insumo
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setHasWaste(false)}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  !hasWaste
                    ? 'bg-[#4A5D23] text-white shadow-xs'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                No tiene merma
              </button>
              <button
                type="button"
                onClick={() => setHasWaste(true)}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  hasWaste
                    ? 'bg-[#D97706] text-white shadow-xs'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Scale className="w-3.5 h-3.5" />
                Tiene Merma
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-1.5">
              {hasWaste
                ? 'El insumo pasará por el módulo de Control de Mermas al recibir compras.'
                : 'El insumo ingresa al 100% de peso útil directamente al stock.'}
            </p>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-xs font-semibold cursor-pointer border border-gray-200"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Guardando...' : item ? 'Actualizar Insumo' : 'Crear Insumo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
