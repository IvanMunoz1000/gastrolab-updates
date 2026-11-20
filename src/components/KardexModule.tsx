import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { KardexEntry } from '../types';
import { DeleteAuthModal } from './DeleteAuthModal';
import { ManualKardexMovementModal } from './ManualKardexMovementModal';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatStockNumber } from '../utils/formatters';
import {
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  Search,
  Download,
  Edit,
  Trash2,
  X,
  CheckCircle2,
} from 'lucide-react';

export const KardexModule: React.FC = () => {
  const { userProfile } = useAuth();
  const { activeBranch } = useBranch();
  const [rawEntries, setRawEntries] = useState<KardexEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'Todos' | 'Entrada' | 'Salida' | 'Salida por Baja' | 'Ajuste'>('Todos');
  const [showAllEntries, setShowAllEntries] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [moduleSuccess, setModuleSuccess] = useState<string | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 150);

  // Manual Entry / Exit modal state
  const [isMovementChooserOpen, setIsMovementChooserOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualMovementType, setManualMovementType] = useState<'Entrada' | 'Salida'>('Entrada');

  // Edit entry modal state
  const [editingEntry, setEditingEntry] = useState<KardexEntry | null>(null);
  const [editQty, setEditQty] = useState('');
  const [editUnitCost, setEditUnitCost] = useState('');
  const [editReference, setEditReference] = useState('');
  const [editType, setEditType] = useState<'Entrada' | 'Salida' | 'Salida por Baja' | 'Ajuste'>('Entrada');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<KardexEntry | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const qKardex = query(collection(db, 'kardex'), orderBy('createdAt', 'desc'));
    const unsubKardex = onSnapshot(
      qKardex,
      (snap) => {
        const list: KardexEntry[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as KardexEntry));
        setRawEntries(list);
      },
      (err) => {
        console.warn('Kardex listener notice:', err);
        setModuleError('No se pudo sincronizar el Kardex.');
      }
    );

    return () => {
      unsubKardex();
    };
  }, []);

  const entries = useMemo(
    () => rawEntries.filter((e) => belongsToBranch(e.branch, activeBranch)),
    [rawEntries, activeBranch]
  );

  const { totalEntries, totalExits } = useMemo(() => {
    let ins = 0;
    let outs = 0;
    for (const e of entries) {
      if (e.movementType === 'Entrada') ins++;
      else if (e.movementType === 'Salida' || e.movementType === 'Salida por Baja') outs++;
    }
    return { totalEntries: ins, totalExits: outs };
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return entries.filter((e) => {
      const matchesType =
        typeFilter === 'Todos' ||
        (typeFilter === 'Salida'
          ? e.movementType === 'Salida' || e.movementType === 'Salida por Baja'
          : e.movementType === typeFilter);
      if (!matchesType) return false;
      if (!q) return true;
      return (
        e.itemName.toLowerCase().includes(q) ||
        (e.reference || '').toLowerCase().includes(q)
      );
    });
  }, [entries, debouncedSearch, typeFilter]);

  const visibleEntries = useMemo(
    () => (showAllEntries ? filteredEntries : filteredEntries.slice(0, 50)),
    [filteredEntries, showAllEntries]
  );

  const handleOpenEdit = (entry: KardexEntry) => {
    setEditingEntry(entry);
    setEditQty(String(entry.quantity || ''));
    setEditUnitCost(String(entry.unitCost || ''));
    setEditReference(entry.reference || '');
    setEditType(entry.movementType);
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;
    setEditError(null);

    const parsedQty = parseFloat(editQty);
    const parsedUnitCost = parseFloat(editUnitCost);

    if (isNaN(parsedQty) || isNaN(parsedUnitCost)) {
      setEditError('Ingresa valores numéricos válidos.');
      return;
    }

    setIsSavingEdit(true);
    try {
      const calculatedTotal = parsedQty * parsedUnitCost;
      await commitOfflineSafe(
        updateDoc(doc(db, 'kardex', editingEntry.id), {
          quantity: parsedQty,
          unitCost: parsedUnitCost,
          totalCost: calculatedTotal,
          movementType: editType,
          reference: editReference.trim(),
          updatedAt: new Date().toISOString(),
        }),
        'kardex_update'
      );
      setEditingEntry(null);
    } catch (err) {
      console.error('Error al actualizar movimiento en Kardex:', err);
      setEditError('Error al guardar cambios en el movimiento.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setModuleError(null);
    try {
      await commitOfflineSafe(deleteDoc(doc(db, 'kardex', deleteTarget.id)), 'kardex_delete');
      setDeleteTarget(null);
      setIsDeleteOpen(false);
    } catch (err: any) {
      console.error('Error al eliminar movimiento de Kardex:', err);
      setModuleError('No se pudo eliminar el movimiento: ' + (err?.message || 'Error de base de datos'));
    }
  };

  const handleExportCsv = () => {
    let csv = 'Fecha,Item,Tipo Movimiento,Cantidad,Unidad,Costo Unitario,Costo Total,Stock Resultante,Referencia\r\n';
    filteredEntries.forEach((e) => {
      const dateStr = e.createdAt ? new Date(e.createdAt).toLocaleString('es-EC') : '';
      csv += `"${dateStr}","${e.itemName}","${e.movementType}",${e.quantity},"${e.unit}",${e.unitCost},${e.totalCost},${e.balanceStock},"${e.reference || ''}"\r\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `GASTROLAB_Kardex_${activeBranch.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 flex items-center justify-center text-[#4A5D23]">
            <Layers className="w-6 h-6 text-[#4A5D23]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Kardex - Entradas y Salidas</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30">
                Auditoría
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Registro trazable de compras, mermas, consumos en cocina y ajustes de inventario
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setIsMovementChooserOpen(true)}
            className="px-4 py-2.5 rounded-2xl bg-white hover:bg-[#EAF5F0] border border-[#4A5D23]/40 text-[#4A5D23] text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs transition-all active:scale-95 cursor-pointer"
          >
            <ArrowLeftRight className="w-4 h-4 text-[#E89E2D]" />
            Movimientos
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="px-4 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs transition-all active:scale-95 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#E89E2D]" />
            Exportar Kardex (CSV)
          </button>
        </div>
      </div>

      {moduleError && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center justify-between">
          <span>{moduleError}</span>
          <button
            type="button"
            onClick={() => setModuleError(null)}
            className="text-rose-700 font-bold hover:underline ml-3 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {moduleSuccess && (
        <div className="p-3.5 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-xs font-semibold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{moduleSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setModuleSuccess(null)}
            className="text-gray-500 hover:text-gray-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-3xl bg-white border border-gray-200 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Movimientos Registrados</span>
          <div className="text-2xl font-black font-mono text-gray-900 mt-1">{entries.length}</div>
          <span className="text-[11px] text-gray-400">Total acumulado en el sistema</span>
        </div>
        <div className="p-5 rounded-3xl bg-white border border-gray-200 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">Entradas de Stock</span>
          <div className="text-2xl font-black font-mono text-emerald-600 mt-1">{totalEntries}</div>
          <span className="text-[11px] text-gray-400">Facturas de compras y mermas procesadas</span>
        </div>
        <div className="p-5 rounded-3xl bg-white border border-gray-200 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-rose-600">Salidas y Despachos</span>
          <div className="text-2xl font-black font-mono text-rose-600 mt-1">{totalExits}</div>
          <span className="text-[11px] text-gray-400">Deducción de comandas y ajustes</span>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(['Todos', 'Entrada', 'Salida', 'Salida por Baja', 'Ajuste'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                typeFilter === t
                  ? 'bg-[#4A5D23] text-white shadow-xs'
                  : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por insumo o referencia..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Kardex Table */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider border-b border-gray-200 font-semibold text-[11px]">
              <tr>
                <th className="p-3.5">Fecha y Hora</th>
                <th className="p-3.5">Insumo</th>
                <th className="p-3.5 text-center">Tipo</th>
                <th className="p-3.5 text-right">Cantidad</th>
                <th className="p-3.5 text-right">Costo Unit.</th>
                <th className="p-3.5 text-right">Costo Total</th>
                <th className="p-3.5 text-right">Saldo Stock</th>
                <th className="p-3.5">Referencia</th>
                <th className="p-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-gray-400">
                    No se registran movimientos en el Kardex.
                  </td>
                </tr>
              ) : (
                visibleEntries.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="p-3.5 font-mono text-gray-500 text-[11px]">
                      {e.createdAt ? new Date(e.createdAt).toLocaleString('es-EC') : '-'}
                    </td>
                    <td className="p-3.5 font-bold text-gray-900">
                      {e.itemName}
                    </td>
                    <td className="p-3.5 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          e.movementType === 'Entrada'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : e.movementType === 'Salida' || e.movementType === 'Salida por Baja'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {e.movementType === 'Entrada' ? (
                          <ArrowDownRight className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <ArrowUpRight className="w-3 h-3 text-rose-600" />
                        )}
                        {e.movementType}
                      </span>
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-gray-900">
                      {formatStockNumber(e.quantity)} {e.unit}
                    </td>
                    <td className="p-3.5 text-right font-mono text-gray-600">
                      ${(e.unitCost || 0).toFixed(4)}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-[#4A5D23]">
                      ${(e.totalCost || 0).toFixed(2)}
                    </td>
                    <td className="p-3.5 text-right font-mono font-black text-emerald-700">
                      {formatStockNumber(e.balanceStock)} {e.unit}
                    </td>
                    <td className="p-3.5 text-gray-500 text-[11px] max-w-xs truncate">
                      {e.reference || '-'}
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(e)}
                          className="px-2.5 py-1 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                          title="Editar ítem mal ingresado"
                        >
                          <Edit className="w-3.5 h-3.5 text-[#4A5D23]" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteTarget(e);
                            setIsDeleteOpen(true);
                          }}
                          className="p-1.5 rounded-xl bg-gray-50 hover:bg-rose-50 border border-gray-200 hover:border-rose-300 text-gray-400 hover:text-rose-600 transition-colors cursor-pointer"
                          title="Borrar (Requiere clave de administrador)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filteredEntries.length > 50 && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
            <span className="text-gray-500">
              Mostrando {visibleEntries.length} de {filteredEntries.length} movimientos
            </span>
            <button
              type="button"
              onClick={() => setShowAllEntries((prev) => !prev)}
              className="px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-300 text-[#4A5D23] font-bold cursor-pointer"
            >
              {showAllEntries ? 'Mostrar últimos 50' : `Ver todos (${filteredEntries.length})`}
            </button>
          </div>
        )}
      </div>

      {/* Edit Kardex Entry Modal */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl relative text-gray-900">
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <Edit className="w-4 h-4 text-[#4A5D23]" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-gray-900">Editar Movimiento Kardex</h3>
                  <p className="text-[11px] text-gray-500 font-mono">{editingEntry.itemName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div className="mb-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} noValidate className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  Tipo de Movimiento
                </label>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as any)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                >
                  <option value="Entrada">Entrada (Ingreso)</option>
                  <option value="Salida">Salida (Egreso/Consumo)</option>
                  <option value="Salida por Baja">Salida por Baja</option>
                  <option value="Ajuste">Ajuste de Auditoría</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                    Cantidad ({editingEntry.unit})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={editQty}
                    onChange={(e) => setEditQty(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                    Costo Unitario ($)
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    required
                    value={editUnitCost}
                    onChange={(e) => setEditUnitCost(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  Referencia / Motivo
                </label>
                <input
                  type="text"
                  placeholder="Ej. Corrección de factura, ajuste manual..."
                  value={editReference}
                  onChange={(e) => setEditReference(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                />
              </div>

              {/* Calculated total display */}
              <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between text-xs">
                <span className="text-gray-500 font-semibold">Costo Total Recalculado:</span>
                <span className="font-mono font-black text-sm text-[#E89E2D]">
                  ${((parseFloat(editQty) || 0) * (parseFloat(editUnitCost) || 0)).toFixed(2)}
                </span>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setEditingEntry(null)}
                  className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50"
                >
                  {isSavingEdit ? 'Guardando...' : 'Guardar Corrección'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Movement Type Chooser Modal ("Movimientos" -> Registrar Entrada / Registrar Salida) */}
      {isMovementChooserOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setIsMovementChooserOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl space-y-5 text-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <ArrowLeftRight className="w-5 h-5 text-[#E89E2D]" />
                </div>
                <div>
                  <h3 className="font-black text-base text-gray-900">Movimientos de Kardex</h3>
                  <p className="text-xs text-gray-500">Selecciona el tipo de movimiento manual</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMovementChooserOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsMovementChooserOpen(false);
                  setManualMovementType('Entrada');
                  setIsManualModalOpen(true);
                }}
                className="p-4 rounded-2xl bg-emerald-50 hover:bg-emerald-600 text-emerald-900 hover:text-white border-2 border-emerald-300 hover:border-emerald-600 flex flex-col items-center text-center gap-2 transition-all shadow-xs active:scale-95 cursor-pointer group"
              >
                <div className="w-11 h-11 rounded-2xl bg-emerald-600 group-hover:bg-white text-white group-hover:text-emerald-600 flex items-center justify-center transition-colors">
                  <ArrowDownRight className="w-6 h-6" />
                </div>
                <span className="font-black text-sm">Registrar Entrada</span>
                <span className="text-[11px] opacity-80 leading-tight">
                  Ingresar stock manual al inventario y Kardex
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMovementChooserOpen(false);
                  setManualMovementType('Salida');
                  setIsManualModalOpen(true);
                }}
                className="p-4 rounded-2xl bg-rose-50 hover:bg-rose-600 text-rose-900 hover:text-white border-2 border-rose-300 hover:border-rose-600 flex flex-col items-center text-center gap-2 transition-all shadow-xs active:scale-95 cursor-pointer group"
              >
                <div className="w-11 h-11 rounded-2xl bg-rose-600 group-hover:bg-white text-white group-hover:text-rose-600 flex items-center justify-center transition-colors">
                  <ArrowUpRight className="w-6 h-6" />
                </div>
                <span className="font-black text-sm">Registrar Salida</span>
                <span className="text-[11px] opacity-80 leading-tight">
                  Descontar stock manual del inventario y Kardex
                </span>
              </button>
            </div>

            <div className="pt-2 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => setIsMovementChooserOpen(false)}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Kardex Entry / Exit Modal */}
      <ManualKardexMovementModal
        isOpen={isManualModalOpen}
        initialType={manualMovementType}
        defaultResponsible={userProfile?.name || ''}
        onClose={() => setIsManualModalOpen(false)}
        onSuccess={(msg) => {
          setModuleSuccess(msg);
          if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
          successTimerRef.current = window.setTimeout(() => {
            setModuleSuccess((prev) => (prev === msg ? null : prev));
            successTimerRef.current = null;
          }, 6000);
        }}
      />

      {/* Security Deletion Modal */}
      <DeleteAuthModal
        isOpen={isDeleteOpen}
        onClose={() => {
          setIsDeleteOpen(false);
          setDeleteTarget(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Eliminar Movimiento de Kardex"
        itemDescription={deleteTarget ? `${deleteTarget.movementType} de ${deleteTarget.itemName}` : 'este movimiento'}
      />
    </div>
  );
};

