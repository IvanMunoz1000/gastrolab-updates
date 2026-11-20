import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { InventoryItem } from '../types';
import { formatStockNumber } from '../utils/formatters';
import {
  X,
  ArrowDownRight,
  ArrowUpRight,
  AlertCircle,
  Check,
  Package,
} from 'lucide-react';

interface ManualKardexMovementModalProps {
  isOpen: boolean;
  initialType?: 'Entrada' | 'Salida';
  preselectedItemId?: string;
  items?: InventoryItem[];
  defaultResponsible?: string;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

export const ManualKardexMovementModal: React.FC<ManualKardexMovementModalProps> = ({
  isOpen,
  initialType = 'Entrada',
  preselectedItemId = '',
  items: externalItems,
  defaultResponsible = '',
  onClose,
  onSuccess,
}) => {
  const { activeBranch } = useBranch();
  const [internalItems, setInternalItems] = useState<InventoryItem[]>([]);
  const [movementType, setMovementType] = useState<'Entrada' | 'Salida'>(initialType);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reference, setReference] = useState('');
  const [responsible, setResponsible] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (externalItems && externalItems.length > 0) return;
    const q = query(collection(db, 'inventory'), orderBy('name', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: InventoryItem[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as InventoryItem));
        setInternalItems(list);
      },
      (err) => {
        console.warn('ManualKardexMovementModal inventory listener notice:', err);
      }
    );
    return () => unsub();
  }, [externalItems]);

  const inventoryList = useMemo(
    () =>
      externalItems && externalItems.length > 0
        ? externalItems.filter((i) => belongsToBranch(i.branch, activeBranch))
        : internalItems.filter((i) => belongsToBranch(i.branch, activeBranch)),
    [externalItems, internalItems, activeBranch]
  );

  useEffect(() => {
    if (isOpen) {
      setMovementType(initialType);
      setSelectedItemId(preselectedItemId || '');
      setQuantity('');
      setUnitCost('');
      setReference('');
      setResponsible('');
      setErrorMsg(null);
    }
  }, [isOpen, initialType, preselectedItemId]);

  const selectedItem = useMemo(
    () => inventoryList.find((i) => i.id === selectedItemId) || null,
    [inventoryList, selectedItemId]
  );

  if (!isOpen) return null;

  const displayUnit = (u?: string) => {
    if (!u) return 'Grs.';
    const low = u.toLowerCase();
    if (low === 'kg' || low === 'grs.' || low === 'g') return 'Grs.';
    if (low === 'lt' || low === 'ml.' || low === 'ml') return 'Ml.';
    return 'Unds.';
  };

  const parsedQty = parseFloat(quantity);
  const hasValidQty = !isNaN(parsedQty) && parsedQty > 0;
  const currentStock = Number(selectedItem?.currentStock) || 0;
  const currentUnitCost = Number(selectedItem?.costPerBaseUnit ?? selectedItem?.cost ?? 0);
  const parsedCustomCost = parseFloat(unitCost);
  const effectiveUnitCost =
    unitCost.trim() !== '' && !isNaN(parsedCustomCost) && parsedCustomCost >= 0
      ? parsedCustomCost
      : currentUnitCost;

  const projectedStock = selectedItem
    ? movementType === 'Entrada'
      ? Number((currentStock + (hasValidQty ? parsedQty : 0)).toFixed(4))
      : Number((currentStock - (hasValidQty ? parsedQty : 0)).toFixed(4))
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg(null);

    if (!selectedItem) {
      setErrorMsg('Selecciona un producto o insumo del inventario.');
      return;
    }

    if (isNaN(parsedQty) || parsedQty <= 0) {
      setErrorMsg('Ingresa una cantidad válida mayor a 0.');
      return;
    }

    const cleanRef = reference.trim();
    if (!cleanRef) {
      setErrorMsg('Ingresa el motivo o referencia del movimiento.');
      return;
    }

    if (unitCost.trim() !== '' && (isNaN(parsedCustomCost) || parsedCustomCost < 0)) {
      setErrorMsg('El costo unitario debe ser un número válido mayor o igual a 0.');
      return;
    }

    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const respName = responsible.trim() || defaultResponsible.trim() || 'Registro Manual';

      const computeAndApplyMovement = (invData: InventoryItem) => {
        const latestStock = Number(invData.currentStock) || 0;
        const latestUnitCost = Number(invData.costPerBaseUnit ?? invData.cost ?? 0);

        if (movementType === 'Salida' && parsedQty > latestStock + 1e-6) {
          throw new Error(
            `No puedes dar salida a ${formatStockNumber(parsedQty)} ${displayUnit(
              invData.unit
            )} porque el stock actual es ${formatStockNumber(latestStock)} ${displayUnit(invData.unit)}.`
          );
        }

        const usedCost =
          unitCost.trim() !== '' && !isNaN(parsedCustomCost) && parsedCustomCost >= 0
            ? parsedCustomCost
            : latestUnitCost;

        const newBalance =
          movementType === 'Entrada'
            ? Number((latestStock + parsedQty).toFixed(4))
            : Math.max(0, Number((latestStock - parsedQty).toFixed(4)));

        let nextUnitCost = latestUnitCost;
        if (
          movementType === 'Entrada' &&
          unitCost.trim() !== '' &&
          !isNaN(parsedCustomCost) &&
          parsedCustomCost > 0 &&
          newBalance > 0
        ) {
          const prevVal = Math.max(0, latestStock) * latestUnitCost;
          const incomingVal = parsedQty * parsedCustomCost;
          nextUnitCost = Number(((prevVal + incomingVal) / newBalance).toFixed(6));
        }

        const nextTotalCost = Number((newBalance * nextUnitCost).toFixed(2));
        return { usedCost, newBalance, nextUnitCost, nextTotalCost };
      };

      const applyOfflineBatch = async () => {
        const computed = computeAndApplyMovement(selectedItem);
        const batch = writeBatch(db);
        const invRef = doc(db, 'inventory', selectedItem.id);
        batch.update(invRef, {
          currentStock: computed.newBalance,
          cost: computed.nextUnitCost,
          costPerBaseUnit: computed.nextUnitCost,
          totalCost: computed.nextTotalCost,
          updatedAt: now,
        });

        const kardexRef = doc(collection(db, 'kardex'));
        batch.set(kardexRef, {
          itemId: selectedItem.id,
          itemName: selectedItem.name,
          movementType,
          quantity: parsedQty,
          unit: selectedItem.unit,
          unitCost: Number(computed.usedCost.toFixed(4)),
          totalCost: Number((parsedQty * computed.usedCost).toFixed(2)),
          balanceStock: computed.newBalance,
          reference: `${cleanRef}${respName ? ` (Resp.: ${respName})` : ''}`,
          reason: cleanRef,
          responsible: respName,
          branch: selectedItem.branch || activeBranch,
          createdAt: now,
        });

        await commitOfflineSafe(batch.commit(), 'manual_kardex_offline');
        return { newBalance: computed.newBalance, unit: selectedItem.unit, name: selectedItem.name };
      };

      let resultBalance: { newBalance: number; unit: any; name: string };
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        resultBalance = await applyOfflineBatch();
      } else {
        try {
          resultBalance = await runTransaction(db, async (transaction) => {
            const invRef = doc(db, 'inventory', selectedItem.id);
            const invSnap = await transaction.get(invRef);
            if (!invSnap.exists()) {
              throw new Error('El producto ya no existe en el inventario.');
            }

            const invData = invSnap.data() as InventoryItem;
            const computed = computeAndApplyMovement(invData);

            transaction.update(invRef, {
              currentStock: computed.newBalance,
              cost: computed.nextUnitCost,
              costPerBaseUnit: computed.nextUnitCost,
              totalCost: computed.nextTotalCost,
              updatedAt: now,
            });

            const kardexRef = doc(collection(db, 'kardex'));
            transaction.set(kardexRef, {
              itemId: selectedItem.id,
              itemName: invData.name || selectedItem.name,
              movementType,
              quantity: parsedQty,
              unit: invData.unit || selectedItem.unit,
              unitCost: Number(computed.usedCost.toFixed(4)),
              totalCost: Number((parsedQty * computed.usedCost).toFixed(2)),
              balanceStock: computed.newBalance,
              reference: `${cleanRef}${respName ? ` (Resp.: ${respName})` : ''}`,
              reason: cleanRef,
              responsible: respName,
              branch: invData.branch || activeBranch,
              createdAt: now,
            });

            return {
              newBalance: computed.newBalance,
              unit: invData.unit || selectedItem.unit,
              name: invData.name || selectedItem.name,
            };
          });
        } catch (txErr: any) {
          if (txErr?.code === 'unavailable' || txErr?.code === 'failed-precondition') {
            resultBalance = await applyOfflineBatch();
          } else {
            throw txErr;
          }
        }
      }

      const sign = movementType === 'Entrada' ? '+' : '-';
      const successMsg = `${
        movementType === 'Entrada' ? 'Entrada' : 'Salida'
      } registrada en Kardex: ${sign}${formatStockNumber(parsedQty)} ${displayUnit(
        resultBalance.unit
      )} de "${resultBalance.name}". Stock actual: ${formatStockNumber(
        resultBalance.newBalance
      )} ${displayUnit(resultBalance.unit)}.`;

      onSuccess?.(successMsg);
      onClose();
    } catch (err: any) {
      console.error('Error al registrar movimiento manual en Kardex:', err);
      setErrorMsg(err?.message || 'No se pudo guardar el movimiento en Kardex.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
      <div className="w-full max-w-lg bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 relative">
        <div className="flex items-center justify-between pb-4 border-b border-gray-200 mb-5">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
                movementType === 'Entrada'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-rose-50 border-rose-200 text-rose-600'
              }`}
            >
              {movementType === 'Entrada' ? (
                <ArrowDownRight className="w-5 h-5" />
              ) : (
                <ArrowUpRight className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                Registrar {movementType === 'Entrada' ? 'Nueva Entrada' : 'Nueva Salida'} en Kardex
              </h3>
              <p className="text-xs text-gray-500">
                Actualiza automáticamente el Stock Actual del Inventario general
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
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4 text-xs">
          {/* Tipo de Movimiento */}
          <div>
            <label className="block font-bold uppercase tracking-wider text-gray-700 mb-1.5">
              Tipo de Movimiento *
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMovementType('Entrada');
                  setErrorMsg(null);
                }}
                className={`py-2.5 px-3 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  movementType === 'Entrada'
                    ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                    : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <ArrowDownRight className="w-4 h-4" />
                Nueva Entrada (+ Stock)
              </button>
              <button
                type="button"
                onClick={() => {
                  setMovementType('Salida');
                  setErrorMsg(null);
                }}
                className={`py-2.5 px-3 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  movementType === 'Salida'
                    ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                    : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <ArrowUpRight className="w-4 h-4" />
                Nueva Salida (- Stock)
              </button>
            </div>
          </div>

          {/* Producto */}
          <div>
            <label className="block font-bold uppercase tracking-wider text-gray-700 mb-1.5">
              Producto / Insumo en Inventario *
            </label>
            <div className="relative">
              <select
                value={selectedItemId}
                onChange={(e) => {
                  setSelectedItemId(e.target.value);
                  setErrorMsg(null);
                }}
                required
                className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3 py-2.5 text-xs font-bold text-gray-900 focus:outline-none"
              >
                <option value="">-- Selecciona un insumo o producto --</option>
                {inventoryList.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — Stock actual: {formatStockNumber(item.currentStock)} {displayUnit(item.unit)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Cantidad y Costo Unitario */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                Cantidad {selectedItem ? `(${displayUnit(selectedItem.unit)})` : ''} *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="Ej. 10 o 1.5"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-gray-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                Costo Unit. ($) <span className="text-gray-400 font-normal">(Opc.)</span>
              </label>
              <input
                type="number"
                step="0.0001"
                min="0"
                placeholder={selectedItem ? `Actual: ${currentUnitCost.toFixed(4)}` : 'Ej. 0.50'}
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-gray-900 focus:outline-none"
              />
            </div>
          </div>

          {/* Live Stock Projection Card */}
          {selectedItem && (
            <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 grid grid-cols-3 gap-2 items-center">
              <div>
                <span className="text-[10px] font-bold uppercase text-gray-500 block">Stock Actual</span>
                <span className="font-mono font-bold text-gray-900 text-sm">
                  {formatStockNumber(currentStock)} {displayUnit(selectedItem.unit)}
                </span>
              </div>
              <div className="text-center">
                <span className="text-[10px] font-bold uppercase text-gray-500 block">Movimiento</span>
                <span
                  className={`font-mono font-black text-sm ${
                    movementType === 'Entrada' ? 'text-emerald-700' : 'text-rose-600'
                  }`}
                >
                  {movementType === 'Entrada' ? '+' : '-'}
                  {hasValidQty ? formatStockNumber(parsedQty) : '0'} {displayUnit(selectedItem.unit)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold uppercase text-gray-500 block">Nuevo Stock</span>
                <span
                  className={`font-mono font-black text-sm ${
                    projectedStock < 0 ? 'text-rose-600' : 'text-emerald-700'
                  }`}
                >
                  {formatStockNumber(Math.max(0, projectedStock))} {displayUnit(selectedItem.unit)}
                </span>
              </div>
              <div className="col-span-3 pt-2 mt-1 border-t border-gray-200 flex items-center justify-between text-[11px] text-gray-600">
                <span>Valor estimado del movimiento:</span>
                <span className="font-mono font-black text-[#4A5D23]">
                  ${((hasValidQty ? parsedQty : 0) * effectiveUnitCost).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Motivo / Referencia */}
          <div>
            <label className="block font-bold uppercase tracking-wider text-gray-700 mb-1.5">
              Motivo / Referencia *
            </label>
            <input
              type="text"
              required
              placeholder={
                movementType === 'Entrada'
                  ? 'Ej. Reposición de bodega, compra menor, devolución...'
                  : 'Ej. Consumo interno, cortesía, preparación especial...'
              }
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3.5 py-2.5 text-xs text-gray-900 focus:outline-none"
            />
          </div>

          {/* Responsable */}
          <div>
            <label className="block font-bold uppercase tracking-wider text-gray-700 mb-1.5">
              Responsable <span className="text-gray-400 font-normal">(Opcional)</span>
            </label>
            <input
              type="text"
              placeholder={defaultResponsible ? `Ej. ${defaultResponsible}` : 'Nombre de quien registra...'}
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3.5 py-2.5 text-xs text-gray-900 focus:outline-none"
            />
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-5 py-2.5 rounded-xl text-white text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-xs flex items-center gap-1.5 ${
                movementType === 'Entrada'
                  ? 'bg-[#4A5D23] hover:bg-[#3d4d1d]'
                  : 'bg-rose-600 hover:bg-rose-700'
              }`}
            >
              {movementType === 'Entrada' ? (
                <Check className="w-4 h-4 text-[#E89E2D]" />
              ) : (
                <Package className="w-4 h-4" />
              )}
              {isSubmitting
                ? 'Guardando...'
                : movementType === 'Entrada'
                ? 'Registrar Entrada y Sumar Stock'
                : 'Registrar Salida y Restar Stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
