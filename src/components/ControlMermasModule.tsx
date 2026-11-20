import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { WasteRecord, InventoryItem } from '../types';
import { useAuth } from '../context/AuthContext';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe, getDocsOfflineSafe } from '../utils/offlineFirestore';
import { DeleteAuthModal } from './DeleteAuthModal';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  Scale,
  CheckCircle2,
  AlertOctagon,
  User,
  Plus,
  Search,
  Save,
  Trash2,
  X,
} from 'lucide-react';

export const ControlMermasModule: React.FC = () => {
  const { userProfile } = useAuth();
  const { activeBranch } = useBranch();
  const [rawWasteRecords, setRawWasteRecords] = useState<WasteRecord[]>([]);
  const [rawInventoryList, setRawInventoryList] = useState<InventoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'pending' | 'processed'>('todos');

  // Inline editing state for pending rows: recordId -> { finalWeight, responsible, wasteReason }
  const [rowInputs, setRowInputs] = useState<
    Record<string, { finalWeight: string; responsible: string; wasteReason: string }>
  >({});
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Security deletion state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<WasteRecord | null>(null);

  // Modal for new manual waste record - UX: empty by default
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newProductId, setNewProductId] = useState('');
  const [newInitialWeight, setNewInitialWeight] = useState('');
  const [newFinalWeight, setNewFinalWeight] = useState('');
  const [newResponsible, setNewResponsible] = useState('');
  const [newReason, setNewReason] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [showAllRecords, setShowAllRecords] = useState(false);
  const syncingWasteRef = useRef(false);
  const debouncedSearch = useDebouncedValue(searchQuery, 150);

  // Subscribe to waste_records in Firestore
  useEffect(() => {
    const q = query(collection(db, 'waste_records'), orderBy('date', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: WasteRecord[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as WasteRecord);
        });
        setRawWasteRecords(list);
      },
      (err) => {
        console.error('Error al escuchar waste_records:', err);
        setFeedbackMsg({ type: 'error', text: 'No se pudo sincronizar Control de Mermas.' });
      }
    );

    return () => unsubscribe();
  }, []);

  // Subscribe to inventory items and sync any pending waste from purchases into waste_records safely (O(1) read + batch)
  useEffect(() => {
    const q = query(collection(db, 'inventory'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        const items: InventoryItem[] = [];
        snapshot.forEach((docSnap) => {
          items.push({ id: docSnap.id, ...docSnap.data() } as InventoryItem);
        });
        setRawInventoryList(items);

        // Skip offline cache emissions or concurrent sync passes to avoid duplicate pending waste docs
        if (snapshot.metadata.fromCache || syncingWasteRef.current) return;
        const pendingItems = items.filter(
          (item) => item.hasPendingWaste && (item.pendingWasteQty || 0) > 0
        );
        if (pendingItems.length === 0) return;

        syncingWasteRef.current = true;
        try {
          const recordsSnap = await getDocsOfflineSafe(collection(db, 'waste_records'));
          const existingPendingItemIds = new Set<string>();
          recordsSnap.forEach((d) => {
            const data = d.data();
            if (data.status === 'pending' && data.itemId) {
              existingPendingItemIds.add(data.itemId);
            }
          });

          const missing = pendingItems.filter((item) => !existingPendingItemIds.has(item.id));
          if (missing.length > 0) {
            const batch = writeBatch(db);
            const todayStr = new Date().toISOString().split('T')[0];
            const nowStr = new Date().toISOString();
            const respName = userProfile?.name || 'Jefe de Cocina';

            for (const item of missing) {
              const gross = item.pendingWasteQty || 1;
              const newRef = doc(collection(db, 'waste_records'));
              batch.set(newRef, {
                date: todayStr,
                itemId: item.id,
                productName: item.name,
                unit: item.unit,
                initialWeight: gross,
                finalWeight: 0,
                wasteAmount: gross,
                wastePercentage: 100,
                usableQuantity: 0,
                responsible: respName,
                wasteReason: 'Limpieza y desposte de compra',
                status: 'pending',
                branch: item.branch || 'Matriz',
                createdAt: nowStr,
              });
            }
            await commitOfflineSafe(batch.commit(), 'sync_pending_waste');
          }
        } catch (err) {
          console.warn('Sync mermas pendientes notice:', err);
        } finally {
          syncingWasteRef.current = false;
        }
      },
      (err) => console.error('Error al escuchar inventario:', err)
    );

    return () => unsubscribe();
  }, [userProfile?.name]);

  const wasteRecords = useMemo(
    () => rawWasteRecords.filter((rec) => belongsToBranch((rec as any).branch, activeBranch)),
    [rawWasteRecords, activeBranch]
  );

  const inventoryList = useMemo(
    () => rawInventoryList.filter((item) => belongsToBranch(item.branch, activeBranch)),
    [rawInventoryList, activeBranch]
  );

  const handleInputChange = (
    recordId: string,
    field: 'finalWeight' | 'responsible' | 'wasteReason',
    value: string
  ) => {
    setRowInputs((prev) => ({
      ...prev,
      [recordId]: {
        finalWeight: prev[recordId]?.finalWeight ?? '',
        responsible: prev[recordId]?.responsible ?? (userProfile?.name || 'Jefe de Cocina'),
        wasteReason: prev[recordId]?.wasteReason ?? 'Desposte y limpieza',
        [field]: value,
      },
    }));
  };

  // Protected delete record trigger
  const handleRequestDelete = (record: WasteRecord) => {
    setRecordToDelete(record);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!recordToDelete) return;
    try {
      await commitOfflineSafe(deleteDoc(doc(db, 'waste_records', recordToDelete.id)), 'delete_waste_record');
      setFeedbackMsg({
        type: 'success',
        text: `Registro de merma de "${recordToDelete.productName}" eliminado con éxito.`,
      });
      setRecordToDelete(null);
    } catch (err: any) {
      console.error('Error al eliminar registro de merma:', err);
      setFeedbackMsg({
        type: 'error',
        text: err.message || 'Error al eliminar el registro.',
      });
    }
  };

  const handleCompleteRow = async (record: WasteRecord) => {
    const input = rowInputs[record.id] || {
      finalWeight: String(record.finalWeight || ''),
      responsible: record.responsible || '',
      wasteReason: record.wasteReason || '',
    };

    const finalW = parseFloat(input.finalWeight);
    if (isNaN(finalW) || finalW <= 0) {
      setFeedbackMsg({
        type: 'error',
        text: 'Por favor ingresa un Peso Final válido mayor a 0.',
      });
      return;
    }

    if (finalW > record.initialWeight) {
      setFeedbackMsg({
        type: 'error',
        text: `El Peso Final (${finalW}) no puede ser mayor que el Peso Inicial (${record.initialWeight} ${record.unit}).`,
      });
      return;
    }

    setIsProcessing(record.id);
    setFeedbackMsg(null);

    try {
      const now = new Date().toISOString();
      const initialW = record.initialWeight;
      const wasteW = Math.max(0, initialW - finalW);
      const wastePct = initialW > 0 ? (wasteW / initialW) * 100 : 0;
      const usableQ = finalW;
      const resp = input.responsible.trim() || userProfile?.name || 'Jefe de Cocina';
      const reason = input.wasteReason.trim() || 'Desposte de materia prima';

      const invItem = inventoryList.find((i) => i.id === record.itemId);
      const recordBranch = (record as any).branch || invItem?.branch || activeBranch;
      const currentStockBefore = invItem ? invItem.currentStock || 0 : 0;
      const currentCost = invItem ? invItem.cost || 0 : 0;

      const batchCost = initialW * currentCost;
      const adjustedUnitCost = finalW > 0 ? batchCost / finalW : currentCost;
      const newStock = currentStockBefore + finalW;

      // 1. Automatic Kardex Entry: "Entrada" with Peso Final
      const kardexRef = doc(collection(db, 'kardex'));
      await commitOfflineSafe(
        setDoc(kardexRef, {
          itemId: record.itemId,
          itemName: record.productName,
          movementType: 'Entrada',
          quantity: finalW,
          unit: record.unit,
          unitCost: adjustedUnitCost,
          totalCost: finalW * adjustedUnitCost,
          balanceStock: newStock,
          reference: `Control de Mermas (Peso Inicial: ${initialW} -> Final: ${finalW} ${record.unit}) - ${reason}`,
          branch: recordBranch,
          createdAt: now,
        }),
        'waste_kardex_entry'
      );

      // 1b. Kardex record for Waste (Salida Merma)
      if (wasteW > 0) {
        const wasteKardexRef = doc(collection(db, 'kardex'));
        await commitOfflineSafe(
          setDoc(wasteKardexRef, {
            itemId: record.itemId,
            itemName: record.productName,
            movementType: 'Salida',
            quantity: wasteW,
            unit: record.unit,
            unitCost: currentCost,
            totalCost: wasteW * currentCost,
            balanceStock: newStock,
            reference: `Merma Desposte (${wastePct.toFixed(1)}%) - ${reason} - Resp: ${resp}`,
            branch: recordBranch,
            createdAt: now,
          }),
          'waste_kardex_exit'
        );
      }

      // 2. Update inventory item
      if (invItem) {
        const costPerBase =
          record.unit === 'kg' || record.unit === 'lt'
            ? adjustedUnitCost / 1000
            : adjustedUnitCost;

        await commitOfflineSafe(
          updateDoc(doc(db, 'inventory', invItem.id), {
            currentStock: newStock,
            cost: adjustedUnitCost,
            costPerBaseUnit: costPerBase,
            hasPendingWaste: false,
            pendingWasteQty: 0,
            updatedAt: now,
          }),
          'waste_update_inventory'
        );
      }

      // 3. Update the waste record: RED (pending) -> GREEN (processed)
      await commitOfflineSafe(
        updateDoc(doc(db, 'waste_records', record.id), {
          finalWeight: finalW,
          wasteAmount: wasteW,
          wastePercentage: wastePct,
          usableQuantity: usableQ,
          responsible: resp,
          wasteReason: reason,
          status: 'processed',
          kardexEntryId: kardexRef.id,
          updatedAt: now,
        }),
        'waste_update_record'
      );

      // 4. Sync linked Purchase Invoice item status: ROJO (pending) -> VERDE (processed)
      try {
        if (record.invoiceId) {
          const invRef = doc(db, 'purchases', record.invoiceId);
          const invSnap = await getDoc(invRef);
          if (invSnap.exists()) {
            const invData = invSnap.data() as any;
            const updatedItems = (invData.items || []).map((it: any) =>
              it.itemId === record.itemId && it.hasWaste
                ? { ...it, wasteStatus: 'processed' }
                : it
            );
            const allProcessed = updatedItems
              .filter((it: any) => it.hasWaste)
              .every((it: any) => it.wasteStatus === 'processed');
            await commitOfflineSafe(
              updateDoc(invRef, {
                items: updatedItems,
                wasteStatus: allProcessed ? 'processed' : 'pending',
                updatedAt: now,
              }),
              'waste_sync_purchase'
            );
          }
        } else {
          // Fallback: find any purchase invoice with a pending waste item matching this itemId
          const purchasesSnap = await getDocsOfflineSafe(collection(db, 'purchases'));
          for (const pDoc of purchasesSnap.docs) {
            const pData = pDoc.data() as any;
            if (!belongsToBranch(pData.branch, recordBranch)) continue;
            const hasMatchingPending = (pData.items || []).some(
              (it: any) => it.itemId === record.itemId && it.hasWaste && it.wasteStatus !== 'processed'
            );
            if (hasMatchingPending) {
              const updatedItems = (pData.items || []).map((it: any) =>
                it.itemId === record.itemId && it.hasWaste
                  ? { ...it, wasteStatus: 'processed' }
                  : it
              );
              const allProcessed = updatedItems
                .filter((it: any) => it.hasWaste)
                .every((it: any) => it.wasteStatus === 'processed');
              await commitOfflineSafe(
                updateDoc(doc(db, 'purchases', pDoc.id), {
                  items: updatedItems,
                  wasteStatus: allProcessed ? 'processed' : 'pending',
                  updatedAt: now,
                }),
                'waste_sync_purchase_fallback'
              );
            }
          }
        }
      } catch (purchaseSyncErr) {
        console.warn('Nota al sincronizar estado verde en Factura de Compra:', purchaseSyncErr);
      }

      setFeedbackMsg({
        type: 'success',
        text: `¡Merma procesada con éxito! Se registraron ${finalW} ${record.unit} en el Kardex y cambió a verde (procesado) en Control de Mermas y Facturas de Compra.`,
      });
    } catch (err: any) {
      console.error('Error al procesar fila de mermas:', err);
      setFeedbackMsg({
        type: 'error',
        text: err.message || 'Error al actualizar el registro de mermas.',
      });
    } finally {
      setIsProcessing(null);
    }
  };

  const handleCreateManualRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const item = inventoryList.find((i) => i.id === newProductId);
    if (!item) {
      setModalError('Debes seleccionar un producto del inventario.');
      return;
    }

    const initW = parseFloat(newInitialWeight);
    const finW = parseFloat(newFinalWeight);

    if (isNaN(initW) || initW <= 0) {
      setModalError('El peso inicial debe ser mayor a 0.');
      return;
    }

    const hasFin = !isNaN(finW) && finW > 0;
    if (hasFin && finW > initW) {
      setModalError('El peso final no puede ser mayor que el peso inicial.');
      return;
    }

    if (!newResponsible.trim()) {
      setModalError('Ingresa el nombre de la persona responsable.');
      return;
    }

    const finalVal = hasFin ? finW : 0;
    const wasteW = hasFin ? Math.max(0, initW - finalVal) : 0;
    const wastePct = hasFin && initW > 0 ? (wasteW / initW) * 100 : 0;
    const status = hasFin ? 'processed' : 'pending';

    setIsSavingManual(true);
    try {
      const now = new Date().toISOString();
      const itemBranch = item.branch || activeBranch;
      const newRec = {
        date: new Date().toISOString().split('T')[0],
        itemId: item.id,
        productName: item.name,
        unit: item.unit,
        initialWeight: initW,
        finalWeight: finalVal,
        wasteAmount: wasteW,
        wastePercentage: wastePct,
        usableQuantity: finalVal,
        responsible: newResponsible.trim() || userProfile?.name || 'Jefe de Cocina',
        wasteReason: newReason.trim() || 'Desposte de materia prima',
        status,
        branch: itemBranch,
        createdAt: now,
      };

      const wasteDocRef = doc(collection(db, 'waste_records'));
      await commitOfflineSafe(setDoc(wasteDocRef, newRec), 'create_manual_waste_record');

      if (hasFin) {
        const newStock = (item.currentStock || 0) + finalVal;
        const kardexRef = doc(collection(db, 'kardex'));
        await commitOfflineSafe(
          setDoc(kardexRef, {
            itemId: item.id,
            itemName: item.name,
            movementType: 'Entrada',
            quantity: finalVal,
            unit: item.unit,
            unitCost: item.cost || 0,
            totalCost: finalVal * (item.cost || 0),
            balanceStock: newStock,
            reference: `Control de Mermas (Peso Inicial: ${initW} -> Final: ${finalVal} ${item.unit})`,
            branch: itemBranch,
            createdAt: now,
          }),
          'create_manual_waste_kardex'
        );

        await commitOfflineSafe(
          updateDoc(doc(db, 'inventory', item.id), {
            currentStock: newStock,
            updatedAt: now,
          }),
          'create_manual_waste_inv'
        );
      }

      setIsNewModalOpen(false);
      setNewInitialWeight('');
      setNewFinalWeight('');
      setNewResponsible('');
      setNewReason('');
      setModalError(null);
      setFeedbackMsg({
        type: 'success',
        text: `Registro de merma para "${item.name}" guardado correctamente.`,
      });
    } catch (err: any) {
      console.error('Error al crear registro de mermas:', err);
      setModalError(err?.message || 'No se pudo guardar el registro en Firestore.');
    } finally {
      setIsSavingManual(false);
    }
  };

  const { pendingCount, processedCount } = useMemo(() => {
    let pend = 0;
    let proc = 0;
    for (const r of wasteRecords) {
      if (r.status === 'pending') pend++;
      else if (r.status === 'processed') proc++;
    }
    return { pendingCount: pend, processedCount: proc };
  }, [wasteRecords]);

  const filteredRecords = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return wasteRecords.filter((rec) => {
      if (statusFilter !== 'todos' && rec.status !== statusFilter) return false;
      if (!q) return true;
      return (
        rec.productName.toLowerCase().includes(q) ||
        (rec.responsible || '').toLowerCase().includes(q) ||
        (rec.wasteReason || '').toLowerCase().includes(q)
      );
    });
  }, [wasteRecords, debouncedSearch, statusFilter]);

  const visibleRecords = useMemo(
    () => (showAllRecords ? filteredRecords : filteredRecords.slice(0, 50)),
    [filteredRecords, showAllRecords]
  );

  return (
    <div className="space-y-6 text-gray-900">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
            <Scale className="w-6 h-6 text-[#E89E2D]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Control de Mermas</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/20">
                Módulo 6
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Registro de desposte, rendimiento útil y envío automático del Peso Final al Kardex
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (inventoryList.length > 0 && !newProductId) {
              setNewProductId(inventoryList[0].id);
            }
            setModalError(null);
            setIsNewModalOpen(true);
          }}
          className="px-4 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-2 transition-all shadow-sm active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#E89E2D]" />
          + Registrar Merma
        </button>
      </div>

      {/* Feedback banner */}
      {feedbackMsg && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-center justify-between shadow-xs ${
            feedbackMsg.type === 'success'
              ? 'bg-[#EAF5F0] border-[#4A5D23]/30 text-[#4A5D23]'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertOctagon className="w-4 h-4 text-rose-600" />
            )}
            <span className="font-semibold">{feedbackMsg.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-gray-700 hover:text-gray-900 font-bold cursor-pointer ml-3"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por producto, responsable o motivo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl pl-10 pr-4 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter('todos')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              statusFilter === 'todos'
                ? 'bg-[#4A5D23] text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            Todos ({wasteRecords.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              statusFilter === 'pending'
                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                : 'bg-white text-gray-600 hover:text-rose-700 border border-gray-200'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            Pendientes ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('processed')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              statusFilter === 'processed'
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                : 'bg-white text-gray-600 hover:text-emerald-700 border border-gray-200'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Procesados ({processedCount})
          </button>
        </div>
      </div>

      {/* Main Table with exact columns */}
      {filteredRecords.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-3xl border border-gray-200">
          <Scale className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-gray-900">No hay registros de control de mermas</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            Las facturas de compra con opción "¿Tiene Merma?" aparecerán automáticamente aquí en rojo como pendientes.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider border-b border-gray-200 font-bold text-[11px]">
                <tr>
                  <th className="p-3.5 whitespace-nowrap">Fecha</th>
                  <th className="p-3.5 whitespace-nowrap">Producto</th>
                  <th className="p-3.5 text-center whitespace-nowrap">Unidad</th>
                  <th className="p-3.5 text-right whitespace-nowrap">Peso Inicial</th>
                  <th className="p-3.5 text-right whitespace-nowrap">Peso Final</th>
                  <th className="p-3.5 text-right whitespace-nowrap">Merma</th>
                  <th className="p-3.5 text-right whitespace-nowrap">Merma %</th>
                  <th className="p-3.5 text-right whitespace-nowrap">Cantidad Útil</th>
                  <th className="p-3.5 whitespace-nowrap">Responsable</th>
                  <th className="p-3.5 whitespace-nowrap">Motivo de Merma</th>
                  <th className="p-3.5 text-center whitespace-nowrap">Estado / Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {visibleRecords.map((record) => {
                  const isPending = record.status === 'pending';
                  const rowInput = rowInputs[record.id] || {
                    finalWeight: isPending ? '' : String(record.finalWeight || ''),
                    responsible: record.responsible || userProfile?.name || 'Jefe de Cocina',
                    wasteReason: record.wasteReason || 'Limpieza y desposte',
                  };

                  const currentFinalWeight = isPending
                    ? parseFloat(rowInput.finalWeight) || 0
                    : record.finalWeight;

                  const calculatedMerma = isPending
                    ? currentFinalWeight > 0
                      ? Math.max(0, record.initialWeight - currentFinalWeight)
                      : 0
                    : record.wasteAmount;

                  const calculatedMermaPct = isPending
                    ? currentFinalWeight > 0 && record.initialWeight > 0
                      ? (calculatedMerma / record.initialWeight) * 100
                      : 0
                    : record.wastePercentage;

                  const calculatedUsable = isPending
                    ? currentFinalWeight
                    : record.usableQuantity;

                  return (
                    <tr
                      key={record.id}
                      className={`transition-colors ${
                        isPending
                          ? 'bg-rose-50/50 hover:bg-rose-50 border-l-4 border-l-rose-500'
                          : 'hover:bg-gray-50 border-l-4 border-l-emerald-500'
                      }`}
                    >
                      {/* 1. Fecha */}
                      <td className="p-3.5 font-mono text-gray-700 whitespace-nowrap">
                        {record.date}
                      </td>

                      {/* 2. Producto */}
                      <td className="p-3.5 font-bold text-gray-900 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {isPending ? (
                            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 animate-ping" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                          )}
                          <span>{record.productName}</span>
                        </div>
                      </td>

                      {/* 3. Unidad - Fix: ONLY Grs., Ml., Unds. */}
                      <td className="p-3.5 text-center font-mono font-bold text-gray-600">
                        {record.unit === 'kg' ? 'Grs.' : record.unit === 'lt' ? 'Ml.' : record.unit === 'unidad' ? 'Unds.' : (record.unit || 'Grs.')}
                      </td>

                      {/* 4. Peso Inicial */}
                      <td className="p-3.5 text-right font-mono font-bold text-gray-900">
                        {record.initialWeight.toFixed(2)}
                      </td>

                      {/* 5. Peso Final */}
                      <td className="p-3.5 text-right font-mono">
                        {isPending ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={record.initialWeight}
                            placeholder="0.00"
                            value={rowInput.finalWeight}
                            onChange={(e) =>
                              handleInputChange(record.id, 'finalWeight', e.target.value)
                            }
                            className="w-24 bg-white border border-rose-300 focus:border-[#4A5D23] rounded-lg px-2 py-1 text-right text-xs font-mono font-bold text-gray-900 focus:outline-none"
                          />
                        ) : (
                          <span className="font-black text-emerald-700">
                            {record.finalWeight.toFixed(2)}
                          </span>
                        )}
                      </td>

                      {/* 6. Merma */}
                      <td className="p-3.5 text-right font-mono font-bold text-rose-600">
                        {calculatedMerma > 0 ? calculatedMerma.toFixed(2) : '-'}
                      </td>

                      {/* 7. Merma % */}
                      <td className="p-3.5 text-right font-mono font-bold text-rose-600">
                        {calculatedMermaPct > 0 ? `${calculatedMermaPct.toFixed(1)}%` : '-'}
                      </td>

                      {/* 8. Cantidad Útil */}
                      <td className="p-3.5 text-right font-mono font-black text-emerald-700">
                        {calculatedUsable > 0 ? calculatedUsable.toFixed(2) : '-'}
                      </td>

                      {/* 9. Responsable */}
                      <td className="p-3.5">
                        {isPending ? (
                          <input
                            type="text"
                            value={rowInput.responsible}
                            onChange={(e) =>
                              handleInputChange(record.id, 'responsible', e.target.value)
                            }
                            placeholder="Nombre cocinero"
                            className="w-28 bg-white border border-gray-300 rounded-lg px-2 py-1 text-xs text-gray-900 focus:outline-none"
                          />
                        ) : (
                          <span className="text-gray-700 flex items-center gap-1">
                            <User className="w-3 h-3 text-[#4A5D23]" />
                            {record.responsible}
                          </span>
                        )}
                      </td>

                      {/* 10. Motivo de Merma */}
                      <td className="p-3.5">
                        {isPending ? (
                          <input
                            type="text"
                            value={rowInput.wasteReason}
                            onChange={(e) =>
                              handleInputChange(record.id, 'wasteReason', e.target.value)
                            }
                            placeholder="Ej. Desposte y grasa"
                            className="w-36 bg-white border border-gray-300 rounded-lg px-2 py-1 text-xs text-gray-900 focus:outline-none"
                          />
                        ) : (
                          <span className="text-gray-600 truncate max-w-xs block">
                            {record.wasteReason}
                          </span>
                        )}
                      </td>

                      {/* 11. Estado / Acción + Protected Delete */}
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {isPending ? (
                            <button
                              type="button"
                              disabled={
                                isProcessing === record.id ||
                                !rowInput.finalWeight ||
                                parseFloat(rowInput.finalWeight) <= 0
                              }
                              onClick={() => handleCompleteRow(record)}
                              className="px-3 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-bold text-[11px] transition-all shadow-xs active:scale-95 disabled:opacity-40 cursor-pointer flex items-center gap-1"
                              title="Guardar y enviar automáticamente a Kardex"
                            >
                              <Save className="w-3.5 h-3.5 text-[#E89E2D]" />
                              {isProcessing === record.id ? 'Guardando...' : 'Completar y Kardex'}
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300 text-[10px] font-black uppercase tracking-wider">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Procesado
                            </span>
                          )}

                          {/* Delete protected by Admin/Owner Password */}
                          <button
                            type="button"
                            onClick={() => handleRequestDelete(record)}
                            className="p-1.5 rounded-xl bg-gray-100 hover:bg-rose-50 text-gray-500 hover:text-rose-600 border border-gray-200 transition-colors cursor-pointer"
                            title="Eliminar registro (Requiere clave)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredRecords.length > 50 && (
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs">
              <span className="text-gray-500">
                Mostrando {visibleRecords.length} de {filteredRecords.length} registros
              </span>
              <button
                type="button"
                onClick={() => setShowAllRecords((prev) => !prev)}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-gray-100 border border-gray-300 text-[#4A5D23] font-bold cursor-pointer"
              >
                {showAllRecords ? 'Mostrar últimos 50' : `Ver todos (${filteredRecords.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Manual Waste Modal - EXACT MATCH FOR SCREENSHOT 4 */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto text-gray-900">
          <div className="w-full max-w-lg bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 relative max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3.5 border-b border-gray-200 mb-4 shrink-0">
              <h3 className="text-lg font-black text-gray-900">Registrar merma</h3>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateManualRecord} noValidate className="flex-1 overflow-y-auto space-y-3.5 pr-1">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Producto <span className="text-rose-500">*</span>
                </label>
                <select
                  value={newProductId}
                  onChange={(e) => setNewProductId(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23] shadow-2xs"
                  required
                >
                  <option value="">Seleccionar producto de inventario...</option>
                  {inventoryList.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Fecha <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    defaultValue={new Date().toISOString().split('T')[0]}
                    className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23] shadow-2xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Unidad <span className="text-rose-500">*</span>
                  </label>
                  <select
                    defaultValue="Grs."
                    className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23] shadow-2xs"
                  >
                    <option value="Grs.">Grs.</option>
                    <option value="Ml.">Ml.</option>
                    <option value="Unds.">Unds.</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Peso inicial <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={newInitialWeight}
                    onChange={(e) => setNewInitialWeight(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23] shadow-2xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Peso final <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    value={newFinalWeight}
                    onChange={(e) => setNewFinalWeight(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23] shadow-2xs"
                  />
                </div>
              </div>

              {/* Auto-calculated Summary Card (Screenshot 4) */}
              {(() => {
                const initW = parseFloat(newInitialWeight) || 0;
                const finW = parseFloat(newFinalWeight) || 0;
                const merma = Math.max(0, initW - finW);
                const mermaPct = initW > 0 ? (merma / initW) * 100 : 0;
                const usableQty = finW;
                const usablePct = initW > 0 ? (usableQty / initW) * 100 : 0;

                return (
                  <div className="p-3.5 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-2 text-gray-700">
                      <div className="flex justify-between">
                        <span>Merma:</span>
                        <strong className="font-mono text-rose-600">{merma.toFixed(2)}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Merma %:</span>
                        <strong className="font-mono text-rose-600">{mermaPct.toFixed(1)}%</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Cantidad útil:</span>
                        <strong className="font-mono text-[#4A5D23]">{usableQty.toFixed(2)}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Producto útil %:</span>
                        <strong className="font-mono text-[#4A5D23]">{usablePct.toFixed(1)}%</strong>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Responsable <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Nombre de la persona responsable"
                  value={newResponsible}
                  onChange={(e) => setNewResponsible(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23] shadow-2xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Motivo de merma
                </label>
                <textarea
                  rows={2}
                  placeholder="Ej. Limpieza de hueso, recorte de grasa, descarte..."
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23] shadow-2xs resize-none"
                />
              </div>

              <div className="pt-3 border-t border-gray-200 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingManual}
                  className="px-5 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {isSavingManual ? 'Guardando...' : 'Registrar y Enviar a Kardex'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Security Protected Delete Modal */}
      <DeleteAuthModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setRecordToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Eliminar Registro de Control de Mermas"
        itemDescription={
          recordToDelete ? `el registro de merma de "${recordToDelete.productName}"` : 'este registro'
        }
      />
    </div>
  );
};
