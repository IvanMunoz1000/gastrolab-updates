import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { InventoryItem } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  ClipboardList,
  Printer,
  ArrowUpDown,
  Search,
  CheckCircle2,
  AlertTriangle,
  Lock,
  RotateCcw,
  Package,
  Layers,
  TrendingDown,
  TrendingUp,
  Check,
} from 'lucide-react';

export interface AuditDiffItem {
  id: string;
  name: string;
  unit: string;
  systemStock: number;
  physicalStock: number;
  difference: number;
  cost: number;
  differenceCost: number;
  status: 'faltante' | 'sobrante' | 'exacto';
}

export const ControlInventarioModule: React.FC = () => {
  const { userProfile } = useAuth();
  const { activeBranch } = useBranch();
  const [activeTab, setActiveTab] = useState<'vista' | 'conteo' | 'diferencias'>('vista');
  const [rawInventoryItems, setRawInventoryItems] = useState<InventoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'stockAsc' | 'stockDesc'>('name');
  const [printSortOrder, setPrintSortOrder] = useState<
    'name' | 'category' | 'stockAsc' | 'stockDesc' | 'unit'
  >('name');

  // Physical count state: key is itemId, value is raw string input (empty by default)
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, string>>({});

  // Finalized / Locked state
  const [isFinalized, setIsFinalized] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<'success' | 'error'>('success');
  const [showAllRows, setShowAllRows] = useState(false);
  const debouncedSearch = useDebouncedValue(searchQuery, 150);

  // Reset active count session cleanly on branch switch
  useEffect(() => {
    setPhysicalCounts({});
    setIsFinalized(false);
    setFeedbackMsg(null);
  }, [activeBranch]);

  // Subscribe to real-time inventory
  useEffect(() => {
    const q = query(collection(db, 'inventory'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: InventoryItem[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as InventoryItem);
        });
        setRawInventoryItems(list);
      },
      (err) => {
        console.error('Error al escuchar inventario:', err);
        setFeedbackType('error');
        setFeedbackMsg('No se pudo sincronizar el inventario.');
      }
    );

    return () => unsubscribe();
  }, []);

  const inventoryItems = useMemo(
    () => rawInventoryItems.filter((item) => belongsToBranch(item.branch, activeBranch)),
    [rawInventoryItems, activeBranch]
  );

  // Filter and sort items
  const processedItems = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const result = inventoryItems.filter((i) =>
      !q || i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q)
    );

    if (sortBy === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'stockAsc') {
      result.sort((a, b) => a.currentStock - b.currentStock);
    } else if (sortBy === 'stockDesc') {
      result.sort((a, b) => b.currentStock - a.currentStock);
    }

    return result;
  }, [inventoryItems, debouncedSearch, sortBy]);

  const visibleProcessedItems = useMemo(
    () => (showAllRows ? processedItems : processedItems.slice(0, 50)),
    [processedItems, showAllRows]
  );

  // Sorted list specifically for Printable Count Sheet according to dropdown selection
  const printableItems = useMemo(() => {
    const list = [...inventoryItems];
    if (printSortOrder === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (printSortOrder === 'category') {
      list.sort(
        (a, b) =>
          (a.category || 'General').localeCompare(b.category || 'General') ||
          a.name.localeCompare(b.name)
      );
    } else if (printSortOrder === 'stockAsc') {
      list.sort((a, b) => (a.currentStock || 0) - (b.currentStock || 0));
    } else if (printSortOrder === 'stockDesc') {
      list.sort((a, b) => (b.currentStock || 0) - (a.currentStock || 0));
    } else if (printSortOrder === 'unit') {
      list.sort((a, b) => (a.unit || '').localeCompare(b.unit || '') || a.name.localeCompare(b.name));
    }
    return list;
  }, [inventoryItems, printSortOrder]);

  // Differences calculation
  const differenceRecords: AuditDiffItem[] = useMemo(() => {
    return inventoryItems.map((item) => {
      const rawCount = physicalCounts[item.id];
      const hasInput = rawCount !== undefined && rawCount.trim() !== '';
      const physicalStock = hasInput ? parseFloat(rawCount) || 0 : item.currentStock;
      const systemStock = item.currentStock || 0;
      const difference = physicalStock - systemStock;
      const unitCost = item.costPerBaseUnit || item.cost || 0;
      const differenceCost = Math.abs(difference) * unitCost;

      let status: 'faltante' | 'sobrante' | 'exacto' = 'exacto';
      if (difference < -0.001) status = 'faltante';
      else if (difference > 0.001) status = 'sobrante';

      return {
        id: item.id,
        name: item.name,
        unit: item.unit,
        systemStock,
        physicalStock,
        difference,
        cost: unitCost,
        differenceCost,
        status,
      };
    });
  }, [inventoryItems, physicalCounts]);

  const {
    totalFaltantes,
    totalSobrantes,
    totalExactos,
    totalCostoFaltante,
    totalCostoSobrante,
  } = useMemo(() => {
    let faltantes = 0;
    let sobrantes = 0;
    let exactos = 0;
    let costoFaltante = 0;
    let costoSobrante = 0;
    for (const d of differenceRecords) {
      if (d.status === 'faltante') {
        faltantes++;
        costoFaltante += d.differenceCost;
      } else if (d.status === 'sobrante') {
        sobrantes++;
        costoSobrante += d.differenceCost;
      } else {
        exactos++;
      }
    }
    return {
      totalFaltantes: faltantes,
      totalSobrantes: sobrantes,
      totalExactos: exactos,
      totalCostoFaltante: costoFaltante,
      totalCostoSobrante: costoSobrante,
    };
  }, [differenceRecords]);

  const visibleDifferenceRecords = useMemo(
    () => (showAllRows ? differenceRecords : differenceRecords.slice(0, 50)),
    [differenceRecords, showAllRows]
  );

  // Handle Physical Count Change
  const handleCountChange = (itemId: string, value: string) => {
    if (isFinalized) return;
    setPhysicalCounts((prev) => ({
      ...prev,
      [itemId]: value,
    }));
  };

  // Print function
  const handlePrint = () => {
    window.print();
  };

  // Finalize inventory & save report
  const handleFinalizeInventory = async () => {
    setIsSubmitting(true);
    try {
      let batch = writeBatch(db);
      let opCount = 0;
      const now = new Date().toISOString();
      const responsibleName = userProfile?.name
        ? `${userProfile.name} ${userProfile.lastName || ''}`.trim()
        : 'Administrador';

      const flushBatchIfNeeded = async () => {
        if (opCount >= 400) {
          await commitOfflineSafe(batch.commit(), 'inventory_audit_chunk');
          batch = writeBatch(db);
          opCount = 0;
        }
      };

      // 1. Update stock in inventory collection
      for (const item of differenceRecords) {
        const docRef = doc(db, 'inventory', item.id);
        batch.update(docRef, {
          currentStock: item.physicalStock,
          updatedAt: now,
        });
        opCount++;

        // 2. If there is difference, record adjustment in kardex
        if (Math.abs(item.difference) > 0.001) {
          const kardexRef = doc(collection(db, 'kardex'));
          batch.set(kardexRef, {
            itemId: item.id,
            itemName: item.name,
            movementType: 'Ajuste',
            quantity: Math.abs(item.difference),
            unit: item.unit,
            unitCost: item.cost,
            totalCost: item.differenceCost,
            balanceStock: item.physicalStock,
            reference: `Ajuste Conteo Físico: ${item.difference < 0 ? 'Faltante' : 'Sobrante'} de ${Math.abs(item.difference).toFixed(2)} ${item.unit}`,
            responsible: responsibleName,
            branch: activeBranch,
            createdAt: now,
          });
          opCount++;
        }

        await flushBatchIfNeeded();
      }

      // 3. Save official audit document to inventory_audits
      const auditRef = doc(collection(db, 'inventory_audits'));
      batch.set(auditRef, {
        auditDate: now,
        responsible: responsibleName,
        totalItemsCounted: differenceRecords.length,
        itemsWithDifference: totalFaltantes + totalSobrantes,
        faltantesCount: totalFaltantes,
        sobrantesCount: totalSobrantes,
        totalCostoFaltante,
        totalCostoSobrante,
        status: 'Finalizado y Aplicado',
        branch: activeBranch,
        details: differenceRecords.map((d) => ({
          name: d.name,
          unit: d.unit,
          systemStock: d.systemStock,
          physicalStock: d.physicalStock,
          difference: d.difference,
          status: d.status,
          differenceCost: d.differenceCost,
        })),
        createdAt: now,
      });
      opCount++;

      if (opCount > 0) {
        await commitOfflineSafe(batch.commit(), 'inventory_audit_finalize');
      }

      setIsFinalized(true);
      setIsConfirmModalOpen(false);
      setFeedbackType('success');
      setFeedbackMsg('¡Inventario finalizado con éxito! El stock ha sido ajustado y guardado en los informes del Propietario.');
    } catch (err: any) {
      console.error('Error al finalizar inventario:', err);
      setFeedbackType('error');
      setFeedbackMsg('Error al asentar inventario en Firestore.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 text-gray-900">
      {/* Top Header Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
            <ClipboardList className="w-6 h-6 text-[#4A5D23]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Control de Inventario</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30">
                Auditoría Físico vs Sistema
              </span>
              {isFinalized && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                  <Lock className="w-3 h-3 text-emerald-700" />
                  Finalizado
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Conteo de existencias reales, detección automática de faltantes/sobrantes y ajuste de stock
            </p>
          </div>
        </div>

        {/* Action button + Print Sort Dropdown */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-xl p-1">
            <select
              value={printSortOrder}
              onChange={(e) =>
                setPrintSortOrder(
                  e.target.value as 'name' | 'category' | 'stockAsc' | 'stockDesc' | 'unit'
                )
              }
              aria-label="Orden de impresión de hoja de conteo"
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-gray-700 focus:outline-none focus:border-[#4A5D23] cursor-pointer"
            >
              <option value="name">Orden: Nombre (A-Z)</option>
              <option value="category">Orden: Categoría</option>
              <option value="stockAsc">Orden: Menor stock</option>
              <option value="stockDesc">Orden: Mayor stock</option>
              <option value="unit">Orden: Unidad</option>
            </select>
            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-gray-100 border border-gray-200 text-gray-800 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4 text-[#4A5D23]" />
              Imprimir Hoja de Conteo
            </button>
          </div>

          {!isFinalized ? (
            <button
              type="button"
              onClick={() => setIsConfirmModalOpen(true)}
              className="px-5 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-xs transition-all cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4 text-[#D97706]" />
              Finalizar Inventario
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setIsFinalized(false);
                setPhysicalCounts({});
                setFeedbackMsg(null);
              }}
              className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4 text-gray-500" />
              Nuevo Conteo
            </button>
          )}
        </div>
      </div>

      {/* Feedback Alert */}
      {feedbackMsg && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-center justify-between ${
            feedbackType === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-700'
              : 'bg-[#EAF5F0] border-[#4A5D23]/30 text-[#4A5D23]'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackType === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            )}
            <span className="font-bold">{feedbackMsg}</span>
          </div>
          <button onClick={() => setFeedbackMsg(null)} className="text-gray-400 hover:text-gray-600 font-bold cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* 3 Tabs Navigation: 1. Vista, 2. Conteo Físico, 3. Diferencias */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 pb-2 overflow-x-auto">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('vista')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'vista'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            1. Vista ({inventoryItems.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('conteo')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'conteo'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5" />
            2. Conteo Físico (Stock Real)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('diferencias')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'diferencias'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            3. Diferencias
            {(totalFaltantes > 0 || totalSobrantes > 0) && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#D97706] text-white">
                {totalFaltantes + totalSobrantes}
              </span>
            )}
          </button>
        </div>

        {/* Search & Sort Controls */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar insumo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-44 sm:w-56 bg-gray-50 border border-gray-200 focus:bg-white rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23]"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              if (sortBy === 'name') setSortBy('stockDesc');
              else if (sortBy === 'stockDesc') setSortBy('stockAsc');
              else setSortBy('name');
            }}
            className="p-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            title="Cambiar orden"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-[#4A5D23]" />
            <span className="hidden sm:inline">
              {sortBy === 'name' ? 'A-Z' : sortBy === 'stockDesc' ? 'Mayor Stock' : 'Menor Stock'}
            </span>
          </button>
        </div>
      </div>

      {/* TAB 1: VISTA (Nombre, Unidad, Stock actual) */}
      {activeTab === 'vista' && (
        <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F8F9FA] text-gray-700 uppercase tracking-wider font-bold border-b border-gray-200 text-[11px]">
                <tr>
                  <th className="p-4">Insumo / Producto</th>
                  <th className="p-4">Categoría</th>
                  <th className="p-4 text-center">Unidad Oficial</th>
                  <th className="p-4 text-right">Stock Actual en Sistema</th>
                  <th className="p-4 text-right">Costo Referencial ($)</th>
                  <th className="p-4 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-500">
                      No se encontraron insumos registrados en el inventario.
                    </td>
                  </tr>
                ) : (
                  visibleProcessedItems.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/70 transition-colors">
                      <td className="p-4 font-bold text-gray-900 flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-[#EAF5F0] border border-[#4A5D23]/20 flex items-center justify-center text-[#4A5D23] shrink-0 font-bold text-xs">
                          {item.name.slice(0, 1).toUpperCase()}
                        </div>
                        <span>{item.name}</span>
                      </td>
                      <td className="p-4 text-gray-500">{item.category || 'General'}</td>
                      <td className="p-4 text-center">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-gray-100 text-gray-800 border border-gray-200">
                          {item.unit}
                        </span>
                      </td>
                      <td className="p-4 text-right font-mono font-bold text-gray-900 text-sm">
                        {item.currentStock.toFixed(2)} {item.unit}
                      </td>
                      <td className="p-4 text-right font-mono text-[#D97706] font-bold">
                        ${(item.costPerBaseUnit || item.cost || 0).toFixed(4)}
                      </td>
                      <td className="p-4 text-center">
                        {item.currentStock <= (item.minStock || 0) ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300">
                            Bajo Stock
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
                            Óptimo
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {processedItems.length > 50 && (
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs">
              <span className="text-gray-500">
                Mostrando {visibleProcessedItems.length} de {processedItems.length} insumos
              </span>
              <button
                type="button"
                onClick={() => setShowAllRows((prev) => !prev)}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-gray-100 border border-gray-300 text-[#4A5D23] font-bold cursor-pointer"
              >
                {showAllRows ? 'Mostrar primeros 50' : `Ver todos (${processedItems.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CONTEO FÍSICO (Stock Real) */}
      {activeTab === 'conteo' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200 text-xs text-gray-600 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <strong className="text-gray-900">Instrucciones de Conteo Físico:</strong> Ingresa la cantidad real contada en almacén o cocina. Todos los campos están vacíos por defecto. Si el campo queda vacío, se mantiene el stock del sistema.
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Ordenar conteo:
                </span>
                <select
                  aria-label="Orden de impresión de conteo físico"
                  value={printSortOrder}
                  onChange={(e) =>
                    setPrintSortOrder(
                      e.target.value as 'name' | 'category' | 'stockAsc' | 'stockDesc' | 'unit'
                    )
                  }
                  className="bg-transparent text-[11px] font-bold text-[#4A5D23] focus:outline-none cursor-pointer"
                >
                  <option value="name">Por Nombre (A-Z)</option>
                  <option value="category">Por Categoría</option>
                  <option value="stockAsc">Por Menor Stock</option>
                  <option value="stockDesc">Por Mayor Stock</option>
                  <option value="unit">Por Unidad</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handlePrint}
                className="px-3 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-bold text-[11px] flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-2xs"
              >
                <Printer className="w-3.5 h-3.5 text-[#E89E2D]" />
                Imprimir Hoja de Conteo
              </button>

              {!isFinalized && (
                <button
                  type="button"
                  onClick={() => {
                    const populated: Record<string, string> = {};
                    inventoryItems.forEach((i) => {
                      populated[i.id] = String(i.currentStock);
                    });
                    setPhysicalCounts(populated);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold text-[11px] whitespace-nowrap cursor-pointer"
                >
                  Copiar Stock Actual como Base
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8F9FA] text-gray-700 uppercase tracking-wider font-bold border-b border-gray-200 text-[11px]">
                  <tr>
                    <th className="p-4">Insumo</th>
                    <th className="p-4 text-center">Unidad</th>
                    <th className="p-4 text-right">Stock en Sistema</th>
                    <th className="p-4 text-right w-56">Stock Real Físico (Contado)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleProcessedItems.map((item) => {
                    const rawVal = physicalCounts[item.id] || '';
                    return (
                      <tr key={item.id} className="hover:bg-gray-50/70 transition-colors">
                        <td className="p-4 font-bold text-gray-900">{item.name}</td>
                        <td className="p-4 text-center">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 text-gray-800">
                            {item.unit}
                          </span>
                        </td>
                        <td className="p-4 text-right font-mono text-gray-600 font-bold">
                          {item.currentStock.toFixed(2)}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={isFinalized}
                              placeholder="0.00"
                              value={rawVal}
                              onChange={(e) => handleCountChange(item.id, e.target.value)}
                              className="w-32 bg-gray-50 focus:bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3 py-1.5 text-right font-mono font-bold text-xs text-gray-900 focus:outline-none disabled:opacity-60"
                            />
                            <span className="text-[11px] font-bold text-gray-500 w-8 text-left">
                              {item.unit}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {processedItems.length > 50 && (
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs">
                <span className="text-gray-500">
                  Mostrando {visibleProcessedItems.length} de {processedItems.length} insumos
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllRows((prev) => !prev)}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-gray-100 border border-gray-300 text-[#4A5D23] font-bold cursor-pointer"
                >
                  {showAllRows ? 'Mostrar primeros 50' : `Ver todos (${processedItems.length})`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: DIFERENCIAS (Automático: FALTANTE en rojo, SOBRANTE en verde) */}
      {activeTab === 'diferencias' && (
        <div className="space-y-5">
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
                  Total Faltantes (Rojo)
                </div>
                <div className="text-2xl font-black text-rose-800 mt-0.5 font-mono">
                  {totalFaltantes} ítems
                </div>
                <div className="text-[11px] text-rose-600 font-mono mt-0.5">
                  Costo: -${totalCostoFaltante.toFixed(2)}
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl bg-white border border-rose-200 flex items-center justify-center text-rose-600 shadow-2xs">
                <TrendingDown className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  Total Sobrantes (Verde)
                </div>
                <div className="text-2xl font-black text-emerald-800 mt-0.5 font-mono">
                  {totalSobrantes} ítems
                </div>
                <div className="text-[11px] text-emerald-600 font-mono mt-0.5">
                  Costo: +${totalCostoSobrante.toFixed(2)}
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl bg-white border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-2xs">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  Cuadrados / Exactos
                </div>
                <div className="text-2xl font-black text-gray-800 mt-0.5 font-mono">
                  {totalExactos} ítems
                </div>
                <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                  Sin desviación
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-500 shadow-2xs">
                <Check className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Differences Table */}
          <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8F9FA] text-gray-700 uppercase tracking-wider font-bold border-b border-gray-200 text-[11px]">
                  <tr>
                    <th className="p-4">Insumo</th>
                    <th className="p-4 text-center">Unidad</th>
                    <th className="p-4 text-right">Stock Sistema</th>
                    <th className="p-4 text-right">Stock Real</th>
                    <th className="p-4 text-right">Diferencia</th>
                    <th className="p-4 text-center">Resultado</th>
                    <th className="p-4 text-right">Impacto en Costo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleDifferenceRecords.map((d) => (
                    <tr
                      key={d.id}
                      className={`transition-colors ${
                        d.status === 'faltante'
                          ? 'bg-rose-50/40'
                          : d.status === 'sobrante'
                          ? 'bg-emerald-50/40'
                          : 'hover:bg-gray-50/50'
                      }`}
                    >
                      <td className="p-4 font-bold text-gray-900">{d.name}</td>
                      <td className="p-4 text-center text-gray-600">{d.unit}</td>
                      <td className="p-4 text-right font-mono text-gray-600 font-bold">
                        {d.systemStock.toFixed(2)}
                      </td>
                      <td className="p-4 text-right font-mono text-gray-900 font-bold">
                        {d.physicalStock.toFixed(2)}
                      </td>
                      <td className="p-4 text-right font-mono font-black text-sm">
                        {d.difference > 0
                          ? `+${d.difference.toFixed(2)}`
                          : d.difference.toFixed(2)}
                      </td>
                      <td className="p-4 text-center">
                        {d.status === 'faltante' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
                            FALTANTE
                          </span>
                        )}
                        {d.status === 'sobrante' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                            SOBRANTE
                          </span>
                        )}
                        {d.status === 'exacto' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
                            EXACTO
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right font-mono font-bold">
                        {d.status === 'faltante' && (
                          <span className="text-rose-600">-${d.differenceCost.toFixed(2)}</span>
                        )}
                        {d.status === 'sobrante' && (
                          <span className="text-emerald-600">+${d.differenceCost.toFixed(2)}</span>
                        )}
                        {d.status === 'exacto' && <span className="text-gray-400">$0.00</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {differenceRecords.length > 50 && (
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs">
                <span className="text-gray-500">
                  Mostrando {visibleDifferenceRecords.length} de {differenceRecords.length} registros
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllRows((prev) => !prev)}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-gray-100 border border-gray-300 text-[#4A5D23] font-bold cursor-pointer"
                >
                  {showAllRows ? 'Mostrar primeros 50' : `Ver todos (${differenceRecords.length})`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal: ¿SEGURO FINALIZAR INVENTARIO? (SÍ/NO) */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl p-6 sm:p-7 shadow-2xl text-gray-900">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-[#D97706] mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <h3 className="text-base font-black text-gray-900 mb-2">
              ¿SEGURO FINALIZAR INVENTARIO?
            </h3>

            <p className="text-xs text-gray-600 leading-relaxed mb-4">
              Al confirmar <strong className="text-gray-900">SÍ</strong>, el sistema ajustará automáticamente el stock de todos los insumos al valor del conteo físico real, registrará las correcciones en el Kardex y guardará el reporte en el <strong className="text-[#4A5D23]">Informe de Inventarios</strong> del Propietario.
            </p>

            <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 text-xs space-y-1 mb-5">
              <div className="flex justify-between text-gray-600">
                <span>Faltantes detectados:</span>
                <span className="font-bold text-rose-600">{totalFaltantes} ítems</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Sobrantes detectados:</span>
                <span className="font-bold text-emerald-600">{totalSobrantes} ítems</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors cursor-pointer"
              >
                NO, Cancelar
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleFinalizeInventory}
                className="px-6 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Asentando...' : 'SÍ, Finalizar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Count Sheet (.sheet-print-area) */}
      <div className="hidden print:block sheet-print-area bg-white text-black p-4 space-y-4">
        <div className="border-b-2 border-black pb-2 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-black uppercase">
              GASTROLAB by Iván Muñoz — HOJA DE CONTEO FÍSICO DE INVENTARIO
            </h1>
            <p className="text-xs">
              Ordenado por:{' '}
              {printSortOrder === 'name'
                ? 'Nombre (A-Z)'
                : printSortOrder === 'category'
                ? 'Categoría'
                : printSortOrder === 'stockAsc'
                ? 'Menor stock'
                : printSortOrder === 'stockDesc'
                ? 'Mayor stock'
                : 'Unidad'}
            </p>
          </div>
          <div className="text-right text-xs">
            <div>Fecha: {new Date().toLocaleDateString('es-EC')}</div>
            <div>Responsable: {userProfile?.name || 'Auditor'}</div>
          </div>
        </div>

        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b-2 border-black bg-gray-100">
              <th className="p-1.5 text-left border border-gray-400">#</th>
              <th className="p-1.5 text-left border border-gray-400">Producto / Insumo</th>
              <th className="p-1.5 text-left border border-gray-400">Categoría</th>
              <th className="p-1.5 text-center border border-gray-400">Unidad</th>
              <th className="p-1.5 text-right border border-gray-400">Stock Sistema</th>
              <th className="p-1.5 text-center border border-gray-400 w-28">Conteo Real</th>
              <th className="p-1.5 text-left border border-gray-400 w-36">Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {printableItems.map((item, idx) => (
              <tr key={item.id}>
                <td className="p-1.5 border border-gray-400 font-mono">{idx + 1}</td>
                <td className="p-1.5 border border-gray-400 font-bold">{item.name}</td>
                <td className="p-1.5 border border-gray-400">{item.category || 'General'}</td>
                <td className="p-1.5 border border-gray-400 text-center font-bold">{item.unit}</td>
                <td className="p-1.5 border border-gray-400 text-right font-mono">
                  {(item.currentStock || 0).toFixed(2)}
                </td>
                <td className="p-1.5 border border-gray-400" />
                <td className="p-1.5 border border-gray-400" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
