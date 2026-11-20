import React, { useState, useEffect } from 'react';
import { doc, updateDoc, setDoc, collection, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe, getDocsOfflineSafe } from '../utils/offlineFirestore';
import { InventoryItem } from '../types';
import {
  X,
  Scale,
  AlertOctagon,
  CheckCircle2,
  TrendingDown,
  Calculator,
} from 'lucide-react';

interface Props {
  item: InventoryItem | null;
  isOpen: boolean;
  onClose: () => void;
  onProcessed?: () => void;
}

export const ControlMermasModal: React.FC<Props> = ({
  item,
  isOpen,
  onClose,
  onProcessed,
}) => {
  const { activeBranch } = useBranch();
  const [cleanWeight, setCleanWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCleanWeight('');
      setNotes('');
      setErrorMsg(null);
    }
  }, [isOpen, item?.id]);

  if (!isOpen || !item) return null;

  const grossWeight = item.pendingWasteQty || item.currentStock || 0;
  const parsedClean = parseFloat(cleanWeight) || 0;
  const wasteAmount = Math.max(0, grossWeight - parsedClean);
  const wastePercentage = grossWeight > 0 ? (wasteAmount / grossWeight) * 100 : 0;
  const yieldPercentage = grossWeight > 0 ? (parsedClean / grossWeight) * 100 : 0;

  const totalBatchCost = grossWeight * (item.cost || 0);
  const effectiveUsableUnitCost = parsedClean > 0 ? totalBatchCost / parsedClean : item.cost || 0;

  const handleProcessWaste = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (parsedClean <= 0) {
      setErrorMsg('El peso o rendimiento limpio debe ser mayor a 0.');
      return;
    }

    if (parsedClean > grossWeight) {
      setErrorMsg(`El peso limpio (${parsedClean}) no puede ser mayor que el peso bruto comprado (${grossWeight} ${item.unit}).`);
      return;
    }

    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const currentStockBefore = item.currentStock || 0;
      const newStock = currentStockBefore + parsedClean;

      const currentTotalValue = currentStockBefore * (item.cost || 0);
      const newBatchValue = totalBatchCost;
      const finalCostPerUnit = newStock > 0 ? (currentTotalValue + newBatchValue) / newStock : effectiveUsableUnitCost;
      const finalCostPerBase =
        item.unit === 'kg' || item.unit === 'lt' ? finalCostPerUnit / 1000 : finalCostPerUnit;

      const itemBranch = item.branch || activeBranch;

      // 1. Update inventory
      await commitOfflineSafe(
        updateDoc(doc(db, 'inventory', item.id), {
          currentStock: newStock,
          cost: finalCostPerUnit,
          costPerBaseUnit: finalCostPerBase,
          hasPendingWaste: false,
          pendingWasteQty: 0,
          updatedAt: now,
        }),
        'waste_modal_update_inv'
      );

      // 2. Add Kardex Entry: Net Entry post-waste
      await commitOfflineSafe(
        setDoc(doc(collection(db, 'kardex')), {
          itemId: item.id,
          itemName: item.name,
          movementType: 'Entrada',
          quantity: parsedClean,
          unit: item.unit,
          unitCost: finalCostPerUnit,
          totalCost: parsedClean * finalCostPerUnit,
          balanceStock: newStock,
          reference: `Control de Mermas (Bruto: ${grossWeight} ${item.unit} -> Limpio: ${parsedClean} ${item.unit})`,
          branch: itemBranch,
          createdAt: now,
        }),
        'waste_modal_kardex_entry'
      );

      // 3. Add Kardex Entry: Waste registered
      if (wasteAmount > 0) {
        await commitOfflineSafe(
          setDoc(doc(collection(db, 'kardex')), {
            itemId: item.id,
            itemName: item.name,
            movementType: 'Salida',
            quantity: wasteAmount,
            unit: item.unit,
            unitCost: item.cost || 0,
            totalCost: wasteAmount * (item.cost || 0),
            balanceStock: newStock,
            reference: `Merma registrada (${wastePercentage.toFixed(1)}%) - ${notes}`,
            branch: itemBranch,
            createdAt: now,
          }),
          'waste_modal_kardex_exit'
        );
      }

      // 4. Update any pending purchase invoices
      try {
        const purchasesQ = query(
          collection(db, 'purchases'),
          where('hasWaste', '==', true)
        );
        const purchaseDocs = await getDocsOfflineSafe(purchasesQ);
        for (const pDoc of purchaseDocs.docs) {
          const pData = pDoc.data();
          if (!belongsToBranch(pData.branch, itemBranch)) continue;
          let modified = false;
          const updatedItems = (pData.items || []).map((pItem: any) => {
            if (pItem.itemId === item.id && pItem.wasteStatus === 'pending') {
              modified = true;
              return { ...pItem, wasteStatus: 'processed' };
            }
            return pItem;
          });
          if (modified) {
            await commitOfflineSafe(
              updateDoc(doc(db, 'purchases', pDoc.id), { items: updatedItems }),
              'waste_modal_sync_purchase'
            );
          }
        }
      } catch (err) {
        console.warn('Nota sobre purchases update:', err);
      }

      if (onProcessed) onProcessed();
      onClose();
    } catch (err: any) {
      console.error('Error al procesar merma:', err);
      setErrorMsg(err.message || 'Error al guardar el control de mermas.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
      <div className="w-full max-w-lg bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 relative">
        <div className="flex items-center justify-between pb-4 border-b border-gray-200 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-gray-900">Control de Mermas y Desposte</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-50 text-rose-700 border border-rose-200">
                  Pendiente
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Calcula el rendimiento real y transfiere el stock limpio al Kardex
              </p>
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
            <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Product Details Bar */}
        <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-[#4A5D23]">Insumo a procesar</span>
              <div className="text-base font-bold text-gray-900">{item.name}</div>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-gray-400">Unidad Base</span>
              <div className="text-sm font-mono font-bold text-[#E89E2D] uppercase">{item.unit}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-200 text-xs">
            <div className="p-2.5 rounded-xl bg-white border border-gray-200 shadow-xs">
              <span className="text-gray-500 block text-[10px] uppercase font-bold">Peso Bruto Comprado</span>
              <span className="text-lg font-mono font-black text-rose-600">
                {grossWeight} {item.unit}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-white border border-gray-200 shadow-xs">
              <span className="text-gray-500 block text-[10px] uppercase font-bold">Costo Unitario</span>
              <span className="text-lg font-mono font-black text-[#E89E2D]">
                ${(item.cost || 0).toFixed(2)} / {item.unit}
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleProcessWaste} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5 text-[#E89E2D]" />
              Rendimiento Útil / Peso Limpio Final ({item.unit}) <span className="text-rose-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={grossWeight}
              required
              placeholder="0.00"
              value={cleanWeight}
              onChange={(e) => setCleanWeight(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-gray-900 placeholder-gray-400 focus:outline-none"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Ingresa el peso neto aprovechable para cocina tras retirar merma, muesca o hueso.
            </p>
          </div>

          {/* Automatic Yield and Waste Calculation */}
          <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-600 flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
                Merma calculada (Descarte):
              </span>
              <span className="font-mono font-bold text-rose-600">
                {wasteAmount.toFixed(2)} {item.unit} ({wastePercentage.toFixed(1)}%)
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-600 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Rendimiento útil aprovechable:
              </span>
              <span className="font-mono font-bold text-emerald-700">
                {parsedClean.toFixed(2)} {item.unit} ({yieldPercentage.toFixed(1)}%)
              </span>
            </div>

            <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
              <span className="text-gray-700 font-semibold flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5 text-[#E89E2D]" />
                Nuevo costo real / {item.unit}:
              </span>
              <span className="font-mono font-black text-[#E89E2D] text-sm">
                ${effectiveUsableUnitCost.toFixed(2)} / {item.unit}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
              Notas u Observaciones del Desposte
            </label>
            <input
              type="text"
              placeholder="Ej. Grasa dorsal retirada, merma de hueso normal"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
            />
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
              disabled={isSubmitting || parsedClean <= 0}
              className="px-5 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-300" />
              {isSubmitting ? 'Procesando...' : 'Aplicar Merma y Guardar Kardex'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
