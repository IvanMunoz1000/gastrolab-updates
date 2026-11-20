import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { InventoryItem, KardexEntry } from '../types';
import { EditInventoryItemModal } from './EditInventoryItemModal';
import { ControlMermasModal } from './ControlMermasModal';
import { DeleteAuthModal } from './DeleteAuthModal';
import { ManualKardexMovementModal } from './ManualKardexMovementModal';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatStockNumber } from '../utils/formatters';
import {
  Package,
  Layers,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Scale,
  Plus,
  Edit,
  Trash2,
  Search,
  AlertOctagon,
  Calendar,
  CheckCircle2,
  ArrowUpCircle,
  ArrowDownCircle,
  Sparkles,
  X,
  AlertCircle,
  ClipboardMinus,
  History,
  User,
} from 'lucide-react';

export const InventarioModule: React.FC = () => {
  const { activeBranch } = useBranch();
  const [activeSubTab, setActiveSubTab] = useState<'existencias' | 'kardex' | 'stockMinimo'>('existencias');
  const [rawInventoryItems, setRawInventoryItems] = useState<InventoryItem[]>([]);
  const [rawKardexEntries, setRawKardexEntries] = useState<KardexEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('todos');

  // Modals state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  const [isWasteModalOpen, setIsWasteModalOpen] = useState(false);
  const [wasteProcessingItem, setWasteProcessingItem] = useState<InventoryItem | null>(null);

  // Write-off ("Registrar Bajas") modal state
  const [isWriteOffModalOpen, setIsWriteOffModalOpen] = useState(false);
  const [writeOffItemId, setWriteOffItemId] = useState('');
  const [writeOffQty, setWriteOffQty] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');
  const [writeOffResponsible, setWriteOffResponsible] = useState('');
  const [isSubmittingWriteOff, setIsSubmittingWriteOff] = useState(false);
  const [writeOffError, setWriteOffError] = useState<string | null>(null);
  const [moduleFeedback, setModuleFeedback] = useState<string | null>(null);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [showAllInventory, setShowAllInventory] = useState(false);
  const [showAllKardex, setShowAllKardex] = useState(false);
  const [manualKardexType, setManualKardexType] = useState<'Entrada' | 'Salida' | null>(null);
  const [detailItem, setDetailItem] = useState<InventoryItem | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 150);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  // Security deletion state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'inventory' | 'kardex';
    id: string;
    name: string;
  } | null>(null);

  // Subscribe to inventory collection in real time
  useEffect(() => {
    const q = query(collection(db, 'inventory'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: InventoryItem[] = [];
        snapshot.forEach((docSnap) => {
          items.push({ id: docSnap.id, ...docSnap.data() } as InventoryItem);
        });
        setRawInventoryItems(items);
      },
      (err) => {
        console.error('Error al escuchar inventario:', err);
        setModuleError('No se pudo sincronizar el inventario.');
      }
    );

    return () => unsubscribe();
  }, []);

  // Subscribe to Kardex movements in real time
  useEffect(() => {
    const q = query(collection(db, 'kardex'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const entries: KardexEntry[] = [];
        snapshot.forEach((docSnap) => {
          entries.push({ id: docSnap.id, ...docSnap.data() } as KardexEntry);
        });
        setRawKardexEntries(entries);
      },
      (err) => {
        console.error('Error al escuchar kardex:', err);
        setModuleError('No se pudo sincronizar el Kardex.');
      }
    );

    return () => unsubscribe();
  }, []);

  const inventoryItems = useMemo(
    () => rawInventoryItems.filter((item) => belongsToBranch(item.branch, activeBranch)),
    [rawInventoryItems, activeBranch]
  );

  const kardexEntries = useMemo(
    () => rawKardexEntries.filter((entry) => belongsToBranch(entry.branch, activeBranch)),
    [rawKardexEntries, activeBranch]
  );

  // Request protected deletion
  const handleRequestDelete = (type: 'inventory' | 'kardex', id: string, name: string) => {
    setDeleteTarget({ type, id, name });
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setModuleError(null);
    try {
      if (deleteTarget.type === 'inventory') {
        await commitOfflineSafe(deleteDoc(doc(db, 'inventory', deleteTarget.id)), 'delete_inventory_item');
      } else {
        await commitOfflineSafe(deleteDoc(doc(db, 'kardex', deleteTarget.id)), 'delete_kardex_entry');
      }
      setDeleteTarget(null);
    } catch (err: any) {
      console.error('Error al eliminar:', err);
      setModuleError('No se pudo eliminar el registro: ' + (err?.message || 'Error de base de datos'));
    }
  };

  // Seed sample inventory items with enforced units: Grs., Ml., Unds.
  const handleSeedInventory = async () => {
    const sampleItems: Omit<InventoryItem, 'id'>[] = [
      {
        name: 'Lomo Fino de Res Angus',
        unit: 'Grs.',
        currentStock: 12500,
        minStock: 5000,
        cost: 0.0185,
        costPerBaseUnit: 0.0185,
        hasPendingWaste: false,
        category: 'Carnes',
      },
      {
        name: 'Salmón Fresco Chileno',
        unit: 'Grs.',
        currentStock: 3200,
        minStock: 4000,
        cost: 0.022,
        costPerBaseUnit: 0.022,
        hasPendingWaste: true,
        pendingWasteQty: 6000,
        category: 'Pescados y Mariscos',
      },
      {
        name: 'Crema de Leche Pastelera',
        unit: 'Ml.',
        currentStock: 8000,
        minStock: 6000,
        cost: 0.0045,
        costPerBaseUnit: 0.0045,
        hasPendingWaste: false,
        category: 'Lácteos',
      },
      {
        name: 'Aceite de Oliva Virgen Extra',
        unit: 'Ml.',
        currentStock: 2500,
        minStock: 5000,
        cost: 0.0118,
        costPerBaseUnit: 0.0118,
        hasPendingWaste: false,
        category: 'Abarrotes',
      },
      {
        name: 'Pan Brioche Hamburguesa',
        unit: 'Unds.',
        currentStock: 45,
        minStock: 20,
        cost: 0.45,
        costPerBaseUnit: 0.45,
        hasPendingWaste: false,
        category: 'Panadería',
      },
      {
        name: 'Queso Mozzarella en Barra',
        unit: 'Grs.',
        currentStock: 1800,
        minStock: 3000,
        cost: 0.0072,
        costPerBaseUnit: 0.0072,
        hasPendingWaste: false,
        category: 'Lácteos',
      },
    ];

    try {
      const batch = writeBatch(db);
      for (const item of sampleItems) {
        const newDocRef = doc(collection(db, 'inventory'));
        batch.set(newDocRef, {
          ...item,
          branch: activeBranch,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      await commitOfflineSafe(batch.commit(), 'seed_inventory');
    } catch (err) {
      console.error('Error al inicializar inventario inicial:', err);
    }
  };

  const categories = useMemo(
    () => ['todos', ...Array.from(new Set(inventoryItems.map((i) => i.category || 'General')))],
    [inventoryItems]
  );

  const filteredItems = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return inventoryItems.filter((item) => {
      const matchesCategory = selectedCategory === 'todos' || item.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q);
    });
  }, [inventoryItems, debouncedSearch, selectedCategory]);

  const visibleInventoryItems = useMemo(
    () => (showAllInventory ? filteredItems : filteredItems.slice(0, 50)),
    [filteredItems, showAllInventory]
  );

  const visibleKardexEntries = useMemo(
    () => (showAllKardex ? kardexEntries : kardexEntries.slice(0, 50)),
    [kardexEntries, showAllKardex]
  );

  const lowStockItems = useMemo(
    () => inventoryItems.filter((item) => item.currentStock <= item.minStock),
    [inventoryItems]
  );

  const pendingWasteItems = useMemo(
    () => inventoryItems.filter((item) => item.hasPendingWaste),
    [inventoryItems]
  );

  // Map write-offs ("Salida por Baja") by itemId for instant lookup in Existencias & Detail Modal
  const writeOffsByItemId = useMemo(() => {
    const map = new Map<string, KardexEntry[]>();
    for (const entry of kardexEntries) {
      if (entry.movementType === 'Salida por Baja') {
        const key = entry.itemId || entry.itemName;
        const list = map.get(key) || [];
        list.push(entry);
        map.set(key, list);
      }
    }
    return map;
  }, [kardexEntries]);

  const getItemWriteOffs = (item: InventoryItem): KardexEntry[] => {
    const byId = writeOffsByItemId.get(item.id) || [];
    if (byId.length > 0) return byId;
    return kardexEntries.filter(
      (k) =>
        k.movementType === 'Salida por Baja' &&
        (k.itemId === item.id ||
          (k.itemName || '').trim().toLowerCase() === (item.name || '').trim().toLowerCase())
    );
  };

  const getExpiryInfo = (expiryDate?: string): {
    status: 'expired' | 'soon' | 'ok' | 'none';
    daysLeft: number | null;
    label: string;
  } => {
    if (!expiryDate) return { status: 'none', daysLeft: null, label: 'Sin fecha' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(`${expiryDate}T00:00:00`);
    if (isNaN(exp.getTime())) return { status: 'none', daysLeft: null, label: 'Sin fecha' };
    const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { status: 'expired', daysLeft: diffDays, label: 'Vencido' };
    if (diffDays <= 3) {
      return {
        status: 'soon',
        daysLeft: diffDays,
        label:
          diffDays === 0
            ? 'Vence hoy'
            : diffDays === 1
            ? 'Vence en 1 día'
            : `Vence en ${diffDays} días`,
      };
    }
    return { status: 'ok', daysLeft: diffDays, label: expiryDate };
  };

  const expiringItems = useMemo(
    () =>
      inventoryItems.filter((item) => {
        const info = getExpiryInfo(item.expiryDate);
        return info.status === 'expired' || info.status === 'soon';
      }),
    [inventoryItems]
  );

  const displayUnit = (u?: string) => {
    if (!u) return 'Grs.';
    const low = u.toLowerCase();
    if (low === 'kg' || low === 'grs.' || low === 'g') return 'Grs.';
    if (low === 'lt' || low === 'ml.' || low === 'ml') return 'Ml.';
    return 'Unds.';
  };

  const handleOpenWriteOffModal = (preselectItemId?: string) => {
    setWriteOffItemId(preselectItemId || '');
    setWriteOffQty('');
    setWriteOffReason('');
    setWriteOffResponsible('');
    setWriteOffError(null);
    setIsWriteOffModalOpen(true);
  };

  const handleRegisterWriteOff = async (e: React.FormEvent) => {
    e.preventDefault();
    setWriteOffError(null);

    const selectedItem = inventoryItems.find((i) => i.id === writeOffItemId);
    if (!selectedItem) {
      setWriteOffError('Debes seleccionar un producto del inventario.');
      return;
    }

    const qty = parseFloat(writeOffQty);
    if (isNaN(qty) || qty <= 0) {
      setWriteOffError('Ingresa una cantidad o peso válido mayor a 0.');
      return;
    }

    if (qty > (selectedItem.currentStock || 0)) {
      setWriteOffError(
        `La cantidad a dar de baja (${formatStockNumber(qty)} ${displayUnit(selectedItem.unit)}) supera el stock actual disponible (${formatStockNumber(
          selectedItem.currentStock || 0
        )} ${displayUnit(selectedItem.unit)}).`
      );
      return;
    }

    const trimmedReason = writeOffReason.trim();
    if (!trimmedReason) {
      setWriteOffError('El motivo de la baja es obligatorio.');
      return;
    }

    const trimmedResponsible = writeOffResponsible.trim();
    if (!trimmedResponsible) {
      setWriteOffError('El nombre del responsable es obligatorio.');
      return;
    }

    setIsSubmittingWriteOff(true);
    try {
      const now = new Date().toISOString();
      const newBalance = Math.max(0, Number(((selectedItem.currentStock || 0) - qty).toFixed(4)));
      const unitCost = selectedItem.costPerBaseUnit ?? selectedItem.cost ?? 0;
      const totalCost = Number((qty * unitCost).toFixed(2));

      const batch = writeBatch(db);

      // 1. Subtract quantity from total stock in inventory
      batch.update(doc(db, 'inventory', selectedItem.id), {
        currentStock: newBalance,
        updatedAt: now,
      });

      // 2. Register movement in Kardex as "Salida por Baja"
      const kardexRef = doc(collection(db, 'kardex'));
      batch.set(kardexRef, {
        itemId: selectedItem.id,
        itemName: selectedItem.name,
        movementType: 'Salida por Baja',
        quantity: qty,
        unit: selectedItem.unit,
        unitCost,
        totalCost,
        balanceStock: newBalance,
        reference: `Salida por Baja — Motivo: ${trimmedReason} | Responsable: ${trimmedResponsible}`,
        reason: trimmedReason,
        responsible: trimmedResponsible,
        branch: selectedItem.branch || activeBranch,
        createdAt: now,
      });

      await commitOfflineSafe(batch.commit(), 'inventory_writeoff');

      setModuleFeedback(
        `Baja registrada: -${formatStockNumber(qty)} ${displayUnit(selectedItem.unit)} de "${selectedItem.name}". Stock actualizado a ${formatStockNumber(
          newBalance
        )} ${displayUnit(selectedItem.unit)} y anotado en Kardex como "Salida por Baja".`
      );
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = window.setTimeout(() => {
        setModuleFeedback(null);
        feedbackTimerRef.current = null;
      }, 6000);
      setIsWriteOffModalOpen(false);
    } catch (err: any) {
      console.error('Error al registrar baja de inventario:', err);
      setWriteOffError(err?.message || 'Error al guardar la baja en inventario.');
    } finally {
      setIsSubmittingWriteOff(false);
    }
  };

  return (
    <div className="space-y-6 text-gray-900">
      {/* Top Banner / Navigation Sub-tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-3xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
            <Package className="w-6 h-6 text-[#E89E2D]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Inventario y Stock</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/20">
                Módulo 5
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Control de existencias, caducidad, kardex y supervisión de stock mínimo
            </p>
          </div>
        </div>

        {/* 3 Sub-tabs: Existencias, Kardex, Stock Mínimo */}
        <div className="flex items-center gap-2 bg-gray-100 p-1.5 rounded-2xl border border-gray-200 self-start md:self-auto overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setActiveSubTab('existencias')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeSubTab === 'existencias'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Package className="w-4 h-4 text-[#E89E2D]" />
            Existencias ({inventoryItems.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('kardex')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeSubTab === 'kardex'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Layers className="w-4 h-4 text-[#E89E2D]" />
            Kardex ({kardexEntries.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('stockMinimo')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeSubTab === 'stockMinimo'
                ? 'bg-[#E89E2D] text-slate-950 font-black shadow-xs'
                : 'text-amber-700 hover:text-amber-900'
            }`}
          >
            <AlertTriangle className="w-4 h-4 text-[#E89E2D]" />
            Stock Mínimo ({lowStockItems.length})
          </button>
        </div>
      </div>

      {/* Individual Expiry Alerts (<= 3 days or expired) - Independent card per product */}
      {expiringItems.length > 0 && (
        <div className="space-y-2">
          {expiringItems.map((expItem) => {
            const info = getExpiryInfo(expItem.expiryDate);
            const isExpired = info.status === 'expired';
            return (
              <div
                key={`expiry_alert_${expItem.id}`}
                className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs ${
                  isExpired
                    ? 'bg-rose-50 border-rose-300 text-rose-900'
                    : 'bg-amber-50 border-[#D97706]/60 text-amber-950'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                      isExpired
                        ? 'bg-rose-100 border-rose-300 text-rose-600'
                        : 'bg-amber-100 border-[#D97706]/40 text-[#D97706]'
                    }`}
                  >
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-wider">
                        {isExpired ? 'Producto Vencido' : 'Alerta de Caducidad (≤ 3 días)'}: {expItem.name}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                          isExpired
                            ? 'bg-rose-100 text-rose-800 border-rose-300'
                            : 'bg-amber-100 text-amber-900 border-[#D97706]/50'
                        }`}
                      >
                        {info.label}
                      </span>
                    </div>
                    <p className="text-[11px] opacity-85 mt-0.5">
                      Fecha registrada: <strong className="font-mono">{expItem.expiryDate}</strong> · Stock actual:{' '}
                      <strong className="font-mono">
                        {formatStockNumber(expItem.currentStock)} {displayUnit(expItem.unit)}
                      </strong>
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setEditingItem(expItem);
                    setIsEditModalOpen(true);
                  }}
                  className={`px-3.5 py-2 rounded-xl font-bold text-xs shadow-xs transition-colors self-start sm:self-auto cursor-pointer flex items-center gap-1.5 shrink-0 ${
                    isExpired
                      ? 'bg-rose-600 hover:bg-rose-700 text-white'
                      : 'bg-[#D97706] hover:bg-amber-700 text-white'
                  }`}
                >
                  <Edit className="w-3.5 h-3.5" />
                  Revisar / Actualizar
                </button>
              </div>
            );
          })}
        </div>
      )}

      {moduleError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{moduleError}</span>
          </div>
          <button
            type="button"
            onClick={() => setModuleError(null)}
            className="text-rose-700 hover:underline font-bold cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {moduleFeedback && (
        <div className="p-4 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-xs flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{moduleFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setModuleFeedback(null)}
            className="text-gray-400 hover:text-gray-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Pending Waste Notification Bar */}
      {pendingWasteItems.length > 0 && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-100 border border-rose-300 flex items-center justify-center text-rose-600 shrink-0">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-rose-900">
                {pendingWasteItems.length} Insumo(s) con Control de Merma Pendiente
              </div>
              <p className="text-[11px] text-rose-700">
                Los productos comprados con merma no ingresan al stock activo hasta registrar su rendimiento limpio.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setWasteProcessingItem(pendingWasteItems[0]);
              setIsWasteModalOpen(true);
            }}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition-colors self-start sm:self-auto cursor-pointer flex items-center gap-1.5"
          >
            <Scale className="w-4 h-4" />
            Procesar Merma Ahora
          </button>
        </div>
      )}

      {/* SUB-TAB 1: EXISTENCIAS */}
      {activeSubTab === 'existencias' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 sm:max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar insumo por nombre..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl pl-10 pr-4 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
                />
              </div>

              {categories.length > 2 && (
                <div className="relative">
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-gray-700 focus:outline-none capitalize"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c === 'todos' ? 'Todas las categorías' : c}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {inventoryItems.length === 0 && (
                <button
                  type="button"
                  onClick={handleSeedInventory}
                  className="px-3.5 py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-[#E89E2D]" />
                  Cargar Insumos Demo
                </button>
              )}

              <button
                type="button"
                onClick={() => handleOpenWriteOffModal()}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-2 transition-all shadow-xs active:scale-95 cursor-pointer"
              >
                <ClipboardMinus className="w-4 h-4" />
                Registrar Bajas
              </button>

              <button
                type="button"
                onClick={() => {
                  setEditingItem(null);
                  setIsEditModalOpen(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-2 transition-all shadow-xs active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4 text-[#E89E2D]" />
                + Nuevo Insumo
              </button>
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-gray-200">
              <Package className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <h3 className="text-base font-bold text-gray-900">No se encontraron insumos</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                {inventoryItems.length === 0
                  ? 'Aún no has registrado ningún insumo en el inventario. Pulsa "+ Nuevo Insumo" o "Cargar Insumos Demo".'
                  : 'No hay insumos que coincidan con la búsqueda.'}
              </p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider border-b border-gray-200 font-bold text-[11px]">
                    <tr>
                      <th className="p-4">Nombre del Insumo</th>
                      <th className="p-4">Categoría</th>
                      <th className="p-4">Unidad</th>
                      <th className="p-4 text-right">Stock Actual</th>
                      <th className="p-4 text-right">Valor Total</th>
                      <th className="p-4 text-right">Costo / Unidad</th>
                      <th className="p-4 text-center">Caducidad</th>
                      <th className="p-4 text-center">Estado Merma</th>
                      <th className="p-4 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {visibleInventoryItems.map((item) => {
                      const isLowStock = item.currentStock <= item.minStock;
                      const hasWaste = item.hasPendingWaste;
                      const unitCost = item.costPerBaseUnit ?? item.cost ?? 0;
                      const stockValue = (item.currentStock || 0) * unitCost;
                      const expiryInfo = getExpiryInfo(item.expiryDate);
                      const itemWriteOffs = getItemWriteOffs(item);

                      let rowBg = 'hover:bg-gray-50';
                      if (hasWaste || expiryInfo.status === 'expired') {
                        rowBg = 'bg-rose-50/60 hover:bg-rose-50 border-l-4 border-l-rose-500';
                      } else if (isLowStock || expiryInfo.status === 'soon') {
                        rowBg = 'bg-amber-50/60 hover:bg-amber-50 border-l-4 border-l-amber-500';
                      }

                      return (
                        <tr key={item.id} className={`transition-colors ${rowBg}`}>
                          <td className="p-4 font-bold text-gray-900 flex items-center gap-2">
                            {hasWaste ? (
                              <div className="w-7 h-7 rounded-lg bg-rose-100 border border-rose-300 flex items-center justify-center text-rose-600 shrink-0">
                                <AlertOctagon className="w-4 h-4" />
                              </div>
                            ) : isLowStock ? (
                              <div className="w-7 h-7 rounded-lg bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0">
                                <AlertTriangle className="w-4 h-4" />
                              </div>
                            ) : (
                              <div className="w-7 h-7 rounded-lg bg-[#EAF5F0] border border-[#4A5D23]/20 flex items-center justify-center text-[#4A5D23] shrink-0">
                                <Package className="w-4 h-4" />
                              </div>
                            )}
                            <div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setDetailItem(item)}
                                  className="text-sm font-bold text-gray-900 hover:text-[#4A5D23] hover:underline text-left cursor-pointer"
                                  title="Clic para ver detalle del producto e historial de bajas"
                                >
                                  {item.name}
                                </button>
                                {itemWriteOffs.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setDetailItem(item)}
                                    className="px-1.5 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[9px] font-black uppercase tracking-wider hover:bg-rose-100 cursor-pointer"
                                    title="Ver historial de bajas de este producto"
                                  >
                                    {itemWriteOffs.length} Baja(s)
                                  </button>
                                )}
                              </div>
                              {isLowStock && (
                                <span className="text-[10px] text-amber-800 font-bold uppercase block">
                                  Mínimo: {formatStockNumber(item.minStock)} {displayUnit(item.unit)}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="p-4 text-gray-600">
                            <span className="px-2 py-1 rounded-md bg-gray-100 border border-gray-200 text-[10px] uppercase font-bold text-gray-700">
                              {item.category || 'General'}
                            </span>
                          </td>

                          <td className="p-4 font-mono uppercase font-bold text-gray-700">
                            {displayUnit(item.unit)}
                          </td>

                          <td className="p-4 text-right font-mono text-sm whitespace-nowrap">
                            <span className="font-black text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 inline-block whitespace-nowrap">
                              {formatStockNumber(item.currentStock)} {displayUnit(item.unit)}
                            </span>
                          </td>

                          <td className="p-4 text-right font-mono font-bold text-gray-900">
                            ${stockValue.toFixed(2)}
                          </td>

                          <td className="p-4 text-right font-mono font-bold text-[#D97706]">
                            ${unitCost.toFixed(4)} / {displayUnit(item.unit)}
                          </td>

                          <td className="p-4 text-center">
                            {expiryInfo.status === 'expired' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 border border-rose-300 text-rose-800 text-[10px] font-black uppercase">
                                {expiryInfo.label} ({item.expiryDate})
                              </span>
                            ) : expiryInfo.status === 'soon' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 border border-[#D97706] text-amber-900 text-[10px] font-black uppercase">
                                {expiryInfo.label}
                              </span>
                            ) : expiryInfo.status === 'ok' ? (
                              <span className="font-mono text-[11px] text-gray-700 font-semibold">
                                {item.expiryDate}
                              </span>
                            ) : (
                              <span className="text-[11px] text-gray-400 italic">Sin fecha</span>
                            )}
                          </td>

                          <td className="p-4 text-center">
                            {hasWaste ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 border border-rose-300 text-rose-800 text-[10px] font-black uppercase tracking-wider animate-pulse">
                                <AlertOctagon className="w-3 h-3" />
                                PENDIENTE POR MERMA
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EAF5F0] border border-[#4A5D23]/20 text-[#4A5D23] text-[10px] font-bold">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                Normal
                              </span>
                            )}
                          </td>

                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {hasWaste && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setWasteProcessingItem(item);
                                    setIsWasteModalOpen(true);
                                  }}
                                  className="px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition-colors shadow-xs cursor-pointer flex items-center gap-1"
                                >
                                  <Scale className="w-3.5 h-3.5" />
                                  Procesar Merma
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItem(item);
                                  setIsEditModalOpen(true);
                                }}
                                className="px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold text-xs transition-colors cursor-pointer flex items-center gap-1.5"
                              >
                                <Edit className="w-3.5 h-3.5 text-[#4A5D23]" />
                                Editar
                              </button>

                              <button
                                type="button"
                                onClick={() => handleRequestDelete('inventory', item.id, item.name)}
                                className="p-1.5 rounded-xl bg-gray-50 hover:bg-rose-50 border border-gray-200 hover:border-rose-300 text-gray-400 hover:text-rose-600 transition-colors cursor-pointer"
                                title="Eliminar insumo (Requiere clave)"
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
              {filteredItems.length > 50 && (
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs">
                  <span className="text-gray-500">
                    Mostrando {visibleInventoryItems.length} de {filteredItems.length} insumos
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllInventory((prev) => !prev)}
                    className="px-3 py-1.5 rounded-xl bg-white hover:bg-gray-100 border border-gray-300 text-[#4A5D23] font-bold cursor-pointer"
                  >
                    {showAllInventory ? 'Mostrar últimos 50' : `Ver todos (${filteredItems.length})`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: KARDEX */}
      {activeSubTab === 'kardex' && (
        <div className="space-y-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Layers className="w-5 h-5 text-[#E89E2D]" />
                Libro Mayor de Kardex (Movimientos de Stock)
              </h3>
              <p className="text-xs text-gray-500">
                Registro cronológico inmutable de Entradas, Salidas y Ajustes de inventario
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-mono text-[#4A5D23] bg-[#EAF5F0] px-3 py-1.5 rounded-xl border border-[#4A5D23]/20 font-bold">
                Total Movimientos: {kardexEntries.length}
              </div>
              <button
                type="button"
                onClick={() => setManualKardexType('Entrada')}
                className="px-3.5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
              >
                <ArrowUpCircle className="w-4 h-4 text-[#E89E2D]" />
                Nueva Entrada
              </button>
              <button
                type="button"
                onClick={() => setManualKardexType('Salida')}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
              >
                <ArrowDownCircle className="w-4 h-4" />
                Nueva Salida
              </button>
            </div>
          </div>

          {kardexEntries.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-gray-200">
              <Layers className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <h3 className="text-base font-bold text-gray-900">Sin movimientos en el Kardex</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Las facturas de compra procesadas y las salidas por merma generarán entradas automáticas aquí.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider border-b border-gray-200 font-bold text-[11px]">
                    <tr>
                      <th className="p-4">Fecha / Hora</th>
                      <th className="p-4">Tipo Movimiento</th>
                      <th className="p-4">Insumo</th>
                      <th className="p-4 text-right">Cantidad</th>
                      <th className="p-4 text-right">Costo Unitario</th>
                      <th className="p-4 text-right">Costo Total</th>
                      <th className="p-4 text-right">Saldo en Stock</th>
                      <th className="p-4">Referencia / Motivo</th>
                      <th className="p-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {visibleKardexEntries.map((entry) => {
                      const isEntry = entry.movementType === 'Entrada';
                      const isExit =
                        entry.movementType === 'Salida' ||
                        entry.movementType === 'Salida por Baja';
                      return (
                        <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                          <td className="p-4 font-mono text-gray-700">
                            {entry.createdAt ? new Date(entry.createdAt).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : 'Reciente'}
                          </td>

                          <td className="p-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                                isEntry
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                  : isExit
                                  ? 'bg-rose-50 text-rose-800 border-rose-300'
                                  : 'bg-amber-50 text-amber-800 border-amber-300'
                              }`}
                            >
                              {isEntry ? (
                                <TrendingUp className="w-3 h-3 text-emerald-600" />
                              ) : isExit ? (
                                <TrendingDown className="w-3 h-3 text-rose-600" />
                              ) : null}
                              {entry.movementType}
                            </span>
                          </td>

                          <td className="p-4 font-bold text-gray-900">{entry.itemName}</td>

                          <td className="p-4 text-right font-mono font-bold">
                            <span className={isEntry ? 'text-emerald-700' : 'text-rose-700'}>
                              {isEntry ? '+' : '-'}
                              {formatStockNumber(entry.quantity)} {displayUnit(entry.unit)}
                            </span>
                          </td>

                          <td className="p-4 text-right font-mono text-gray-700">
                            ${(entry.unitCost || 0).toFixed(2)}
                          </td>

                          <td className="p-4 text-right font-mono font-bold text-gray-900">
                            ${(entry.totalCost || 0).toFixed(2)}
                          </td>

                          <td className="p-4 text-right font-mono font-black text-emerald-700">
                            {entry.balanceStock != null ? `${formatStockNumber(entry.balanceStock)} ${displayUnit(entry.unit)}` : '-'}
                          </td>

                          <td className="p-4 text-gray-500 text-[11px] truncate max-w-xs">
                            {entry.reference || 'Movimiento de inventario'}
                          </td>

                          <td className="p-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleRequestDelete('kardex', entry.id, `Movimiento ${entry.movementType} de ${entry.itemName}`)}
                              className="p-1.5 rounded-xl bg-gray-50 hover:bg-rose-50 border border-gray-200 hover:border-rose-300 text-gray-400 hover:text-rose-600 transition-colors cursor-pointer"
                              title="Eliminar movimiento (Requiere clave)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {kardexEntries.length > 50 && (
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs">
                  <span className="text-gray-500">
                    Mostrando {visibleKardexEntries.length} de {kardexEntries.length} movimientos
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllKardex((prev) => !prev)}
                    className="px-3 py-1.5 rounded-xl bg-white hover:bg-gray-100 border border-gray-300 text-[#4A5D23] font-bold cursor-pointer"
                  >
                    {showAllKardex ? 'Mostrar últimos 50' : `Ver todos (${kardexEntries.length})`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: STOCK MÍNIMO (Highlighted in ORANGE) */}
      {activeSubTab === 'stockMinimo' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-amber-50 border-2 border-[#E89E2D] p-4 rounded-2xl shadow-xs">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 border border-[#E89E2D] flex items-center justify-center text-[#E89E2D]">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Alerta de Stock Crítico y Mínimo</h3>
                <p className="text-xs text-amber-800">
                  Insumos cuyo stock actual es menor o igual al umbral mínimo requerido en cocina.
                </p>
              </div>
            </div>
            <span className="px-3 py-1 rounded-xl bg-[#E89E2D] text-slate-950 text-xs font-black uppercase tracking-wider">
              {lowStockItems.length} Alertas Activas
            </span>
          </div>

          {lowStockItems.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-gray-200">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-gray-900">Stock en niveles óptimos</h3>
              <p className="text-xs text-gray-500 mt-1">
                Ningún insumo se encuentra por debajo de su umbral de stock mínimo.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {lowStockItems.map((item) => {
                const deficit = Math.max(0, item.minStock - item.currentStock);
                return (
                  <div
                    key={item.id}
                    className="p-5 rounded-3xl bg-white border-2 border-[#E89E2D] shadow-xs relative overflow-hidden flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 border border-[#E89E2D] text-amber-900 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-[#E89E2D]" />
                          Stock Crítico
                        </span>
                        <span className="text-[10px] font-mono uppercase text-gray-500">
                          {item.category || 'General'}
                        </span>
                      </div>

                      <h4 className="text-base font-bold text-gray-900 mb-2">{item.name}</h4>

                      <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 space-y-2 mb-4">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">Stock Actual:</span>
                          <span className="font-mono font-black text-emerald-700 text-sm">
                            {formatStockNumber(item.currentStock)} {displayUnit(item.unit)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">Stock Mínimo:</span>
                          <span className="font-mono font-bold text-gray-900">
                            {formatStockNumber(item.minStock)} {displayUnit(item.unit)}
                          </span>
                        </div>
                        <div className="pt-2 border-t border-gray-200 flex items-center justify-between text-xs">
                          <span className="text-rose-600 font-semibold">Déficit de compra:</span>
                          <span className="font-mono font-black text-rose-600">
                            -{formatStockNumber(deficit)} {displayUnit(item.unit)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 flex items-center justify-between gap-2 border-t border-gray-100">
                      <span className="text-[11px] text-gray-500 font-mono">
                        Costo: ${(item.costPerBaseUnit ?? item.cost ?? 0).toFixed(4)}/{displayUnit(item.unit)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingItem(item);
                          setIsEditModalOpen(true);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <Edit className="w-3 h-3 text-[#E89E2D]" />
                        Ajustar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Edit Inventory Item Modal */}
      <EditInventoryItemModal
        item={editingItem}
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingItem(null);
        }}
      />

      {/* Control de Mermas Modal */}
      <ControlMermasModal
        item={wasteProcessingItem}
        isOpen={isWasteModalOpen}
        onClose={() => {
          setIsWasteModalOpen(false);
          setWasteProcessingItem(null);
        }}
      />

      {/* Modal: Registrar Bajas de Inventario */}
      {isWriteOffModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
          <div className="w-full max-w-lg bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 relative">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                  <ClipboardMinus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Registrar Baja de Inventario</h3>
                  <p className="text-xs text-gray-500">
                    Descuenta stock del producto y registra &quot;Salida por Baja&quot; en Kardex
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsWriteOffModalOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {writeOffError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{writeOffError}</span>
              </div>
            )}

            {(() => {
              const selectedProduct = inventoryItems.find((i) => i.id === writeOffItemId);
              const parsedQty = parseFloat(writeOffQty) || 0;
              const projectedStock = selectedProduct
                ? Math.max(0, (selectedProduct.currentStock || 0) - parsedQty)
                : 0;

              return (
                <form onSubmit={handleRegisterWriteOff} noValidate className="space-y-4">
                  {/* 1. Producto */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                      Producto en Inventario <span className="text-rose-500">*</span>
                    </label>
                    <select
                      required
                      value={writeOffItemId}
                      onChange={(e) => {
                        setWriteOffItemId(e.target.value);
                        setWriteOffError(null);
                      }}
                      className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3 py-2.5 text-xs font-bold text-gray-900 focus:outline-none"
                    >
                      <option value="">-- Selecciona un producto --</option>
                      {inventoryItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} — Stock: {formatStockNumber(item.currentStock)} {displayUnit(item.unit)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Stock Info & 2. Cantidad / Peso */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                        Cantidad / Peso a dar de baja{' '}
                        {selectedProduct ? `(${displayUnit(selectedProduct.unit)})` : ''}{' '}
                        <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        placeholder="Ej. 500"
                        value={writeOffQty}
                        onChange={(e) => setWriteOffQty(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-gray-900 focus:outline-none"
                      />
                    </div>

                    <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 flex flex-col justify-center">
                      <div className="flex justify-between text-[11px] text-gray-600">
                        <span>Stock Actual:</span>
                        <span className="font-mono font-black text-emerald-700">
                          {selectedProduct
                            ? `${formatStockNumber(selectedProduct.currentStock)} ${displayUnit(selectedProduct.unit)}`
                            : '-'}
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px] text-rose-700 font-bold mt-1 pt-1 border-t border-gray-200">
                        <span>Nuevo Stock:</span>
                        <span className="font-mono">
                          {selectedProduct
                            ? `${formatStockNumber(projectedStock)} ${displayUnit(selectedProduct.unit)}`
                            : '-'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 3. Motivo de la baja */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                      Motivo de la baja <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. Producto caducado, daño en bodega, derrame accidental..."
                      value={writeOffReason}
                      onChange={(e) => setWriteOffReason(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3.5 py-2.5 text-xs text-gray-900 focus:outline-none"
                    />
                  </div>

                  {/* 4. Responsable */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                      Responsable (Quién registra la baja) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Nombre completo del responsable..."
                      value={writeOffResponsible}
                      onChange={(e) => setWriteOffResponsible(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3.5 py-2.5 text-xs text-gray-900 focus:outline-none"
                    />
                  </div>

                  <div className="pt-3 flex items-center justify-end gap-3 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => setIsWriteOffModalOpen(false)}
                      className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingWriteOff || !writeOffItemId || !writeOffQty || !writeOffReason.trim() || !writeOffResponsible.trim()}
                      className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all disabled:opacity-40 cursor-pointer shadow-xs flex items-center gap-1.5"
                    >
                      <ClipboardMinus className="w-4 h-4" />
                      {isSubmittingWriteOff ? 'Registrando Baja...' : 'Guardar Baja y Descontar Stock'}
                    </button>
                  </div>
                </form>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modal: Detalle del Producto e Historial de Bajas */}
      {detailItem && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900"
          onClick={() => setDetailItem(null)}
        >
          <div
            className="w-full max-w-2xl bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 space-y-5 my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] shrink-0">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#4A5D23]">
                    Detalle de Insumo e Historial de Bajas
                  </span>
                  <h3 className="text-lg font-black text-gray-900 leading-tight">{detailItem.name}</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(() => {
              const unitCost = detailItem.costPerBaseUnit ?? detailItem.cost ?? 0;
              const stockVal = (detailItem.currentStock || 0) * unitCost;
              const itemWriteOffs = getItemWriteOffs(detailItem);
              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
                      <span className="text-[10px] font-bold uppercase text-emerald-800 block">
                        Stock Actual
                      </span>
                      <span className="font-mono font-black text-base text-emerald-700 mt-0.5 block">
                        {formatStockNumber(detailItem.currentStock)} {displayUnit(detailItem.unit)}
                      </span>
                    </div>
                    <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200">
                      <span className="text-[10px] font-bold uppercase text-gray-500 block">
                        Valor Total
                      </span>
                      <span className="font-mono font-black text-base text-gray-900 mt-0.5 block">
                        ${stockVal.toFixed(2)}
                      </span>
                    </div>
                    <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200">
                      <span className="text-[10px] font-bold uppercase text-amber-800 block">
                        Costo / Unidad
                      </span>
                      <span className="font-mono font-black text-sm text-[#D97706] mt-0.5 block">
                        ${unitCost.toFixed(4)}
                      </span>
                    </div>
                    <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200">
                      <span className="text-[10px] font-bold uppercase text-gray-500 block">
                        Caducidad
                      </span>
                      <span className="font-mono font-bold text-xs text-gray-800 mt-1 block">
                        {detailItem.expiryDate || 'Sin fecha'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-wider text-gray-800 flex items-center gap-1.5">
                        <History className="w-4 h-4 text-rose-600" />
                        Historial de Bajas ({itemWriteOffs.length})
                      </h4>
                      <button
                        type="button"
                        onClick={() => {
                          const targetId = detailItem.id;
                          setDetailItem(null);
                          handleOpenWriteOffModal(targetId);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        <ClipboardMinus className="w-3.5 h-3.5" />
                        + Registrar Baja
                      </button>
                    </div>

                    {itemWriteOffs.length === 0 ? (
                      <div className="p-8 text-center rounded-2xl bg-gray-50 border border-dashed border-gray-300 text-xs text-gray-500">
                        Este producto no registra bajas en el historial todavía.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {itemWriteOffs.map((wo) => {
                          const refText = wo.reference || '';
                          const motivoMatch = refText.match(/Motivo:\s*([^|]+)/i);
                          const respMatch = refText.match(/Responsable:\s*(.+)$/i);
                          const reasonText = (wo as any).reason || (motivoMatch ? motivoMatch[1].trim() : refText || 'Baja registrada');
                          const responsibleText = (wo as any).responsible || (respMatch ? respMatch[1].trim() : 'No especificado');

                          return (
                            <div
                              key={wo.id}
                              className="p-3.5 rounded-2xl bg-rose-50/60 border border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                            >
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono font-black text-rose-700">
                                    -{formatStockNumber(wo.quantity)} {displayUnit(wo.unit)}
                                  </span>
                                  <span className="text-gray-400">·</span>
                                  <span className="font-semibold text-gray-900">{reasonText}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
                                  <span className="inline-flex items-center gap-1 font-semibold">
                                    <User className="w-3 h-3 text-rose-600" />
                                    Registrado por: <strong className="text-gray-900">{responsibleText}</strong>
                                  </span>
                                  <span className="font-mono">
                                    {wo.createdAt
                                      ? new Date(wo.createdAt).toLocaleString('es-EC', {
                                          dateStyle: 'short',
                                          timeStyle: 'short',
                                        })
                                      : 'Reciente'}
                                  </span>
                                </div>
                              </div>
                              {wo.balanceStock != null && (
                                <div className="text-right shrink-0">
                                  <span className="text-[10px] uppercase font-bold text-gray-500 block">
                                    Saldo Resultante
                                  </span>
                                  <span className="font-mono font-black text-emerald-700">
                                    {formatStockNumber(wo.balanceStock)} {displayUnit(wo.unit)}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Manual Kardex Modal (Nuevas Entradas / Nuevas Salidas) */}
      <ManualKardexMovementModal
        isOpen={manualKardexType !== null}
        initialType={manualKardexType || 'Entrada'}
        items={inventoryItems}
        onClose={() => setManualKardexType(null)}
        onSuccess={(msg) => {
          setModuleFeedback(msg);
          if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
          feedbackTimerRef.current = window.setTimeout(() => {
            setModuleFeedback(null);
            feedbackTimerRef.current = null;
          }, 5000);
        }}
      />

      {/* Delete Auth Modal */}
      <DeleteAuthModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setDeleteTarget(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Eliminar Registro de Inventario"
        itemDescription={deleteTarget ? deleteTarget.name : 'este registro'}
      />
    </div>
  );
};
