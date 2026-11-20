import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  setDoc,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { DeleteAuthModal } from './DeleteAuthModal';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  Utensils,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Check,
  X,
  ClipboardMinus,
  Calendar,
  User,
} from 'lucide-react';

export interface EquipmentWriteOff {
  date: string;
  quantity: number;
  reason: string;
  responsible?: string;
}

export interface EquipmentItem {
  id: string;
  code?: string; // Código de inventario (e.g. EQ-001)
  name: string;
  category: 'Menaje' | 'Cocina y Maquinaria' | 'Cristalería' | 'Vajilla' | 'Cubertería' | 'Mobiliario';
  quantity: number;
  location: string;
  condition: 'Óptimo' | 'En Reparación' | 'Desgaste' | 'De Baja';
  unitCost?: number;
  lastMaintenance?: string;
  notes?: string;
  writeOffHistory?: EquipmentWriteOff[];
  branch?: string;
}

export const MenajeModule: React.FC = () => {
  const { userProfile } = useAuth();
  const { activeBranch } = useBranch();
  const [rawItems, setRawItems] = useState<EquipmentItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Detail & Write-Off History modal state
  const [detailItem, setDetailItem] = useState<EquipmentItem | null>(null);

  // Baja / Deterioro modal state
  const [isBajaModalOpen, setIsBajaModalOpen] = useState(false);
  const [bajaItemId, setBajaItemId] = useState('');
  const [bajaQuantity, setBajaQuantity] = useState('');
  const [bajaReason, setBajaReason] = useState('');
  const [bajaResponsible, setBajaResponsible] = useState('');
  const [bajaError, setBajaError] = useState<string | null>(null);
  const [isSubmittingBaja, setIsSubmittingBaja] = useState(false);

  // Form states - Empty by default
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<EquipmentItem['category']>('Menaje');
  const [quantity, setQuantity] = useState('');
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState<EquipmentItem['condition']>('Óptimo');
  const [unitCost, setUnitCost] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Security deletion
  const [deleteTarget, setDeleteTarget] = useState<EquipmentItem | null>(null);
  const [showAllItems, setShowAllItems] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 150);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'equipment'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: EquipmentItem[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as EquipmentItem));
        setRawItems(list);
        setModuleError(null);
      },
      (err) => {
        console.warn('Menaje equipment listener notice:', err);
        setModuleError('No se pudo sincronizar Menaje y Equipos.');
      }
    );

    return () => unsub();
  }, []);

  const items = useMemo(
    () => rawItems.filter((item) => belongsToBranch(item.branch, activeBranch)),
    [rawItems, activeBranch]
  );

  const openNewModal = () => {
    setCode('');
    setName('');
    setCategory('Menaje');
    setQuantity('');
    setLocation('');
    setCondition('Óptimo');
    setUnitCost('');
    setNotes('');
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const cleanName = name.trim();
    if (!cleanName) {
      setModalError('Por favor ingresa el nombre del artículo o equipo.');
      return;
    }

    const parsedQty = parseInt(quantity, 10);
    if (isNaN(parsedQty) || parsedQty < 1) {
      setModalError('Por favor ingresa una cantidad válida mayor o igual a 1.');
      return;
    }

    setIsSubmitting(true);
    try {
      const generatedCode = code.trim() || `EQ-${Math.floor(100 + Math.random() * 900)}`;
      const newEquipRef = doc(collection(db, 'equipment'));
      await commitOfflineSafe(
        setDoc(newEquipRef, {
          code: generatedCode,
          name: cleanName,
          category,
          quantity: parsedQty,
          location: location.trim() || activeBranch,
          condition,
          unitCost: parseFloat(unitCost) || 0,
          notes: notes.trim(),
          branch: activeBranch,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        'create_equipment'
      );

      setCode('');
      setName('');
      setQuantity('');
      setLocation('');
      setUnitCost('');
      setNotes('');
      setModalError(null);
      setIsModalOpen(false);
      setFeedbackMsg(`Artículo "${cleanName}" (${generatedCode}) guardado exitosamente.`);
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedbackMsg(null);
        feedbackTimerRef.current = null;
      }, 4000);
    } catch (err: any) {
      console.error('Error al guardar menaje/equipo:', err);
      setModalError('No se pudo guardar en la base de datos: ' + (err?.message || 'Error de conexión'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openBajaModal = (preselectId?: string) => {
    const firstAvailable = items.find((i) => i.quantity > 0) || items[0];
    setBajaItemId(preselectId || (firstAvailable ? firstAvailable.id : ''));
    setBajaQuantity('');
    setBajaReason('');
    setBajaResponsible('');
    setBajaError(null);
    setIsBajaModalOpen(true);
  };

  const handleConfirmBaja = async (e: React.FormEvent) => {
    e.preventDefault();
    setBajaError(null);

    const selected = items.find((i) => i.id === bajaItemId);
    if (!selected) {
      setBajaError('Selecciona un equipo o menaje de la lista.');
      return;
    }

    const parsedQty = parseInt(bajaQuantity, 10);
    if (isNaN(parsedQty) || parsedQty < 1) {
      setBajaError('Ingresa una cantidad válida mayor o igual a 1.');
      return;
    }

    if (parsedQty > selected.quantity) {
      setBajaError(`No puedes dar de baja ${parsedQty} unidades porque solo hay ${selected.quantity} disponibles.`);
      return;
    }

    const cleanReason = bajaReason.trim();
    if (!cleanReason) {
      setBajaError('Escribe el motivo de la baja o deterioro.');
      return;
    }

    const cleanResponsible = bajaResponsible.trim() || userProfile?.name || 'Personal Autorizado';

    setIsSubmittingBaja(true);
    try {
      const now = new Date().toISOString();
      const remainingQty = Math.max(0, selected.quantity - parsedQty);
      const bajaLogText = `[Baja ${new Date().toLocaleDateString('es-EC')}: -${parsedQty} u. (${cleanReason}) · Resp.: ${cleanResponsible}]`;
      const combinedNotes = selected.notes ? `${selected.notes} · ${bajaLogText}` : bajaLogText;
      const updatedHistory: EquipmentWriteOff[] = [
        ...(selected.writeOffHistory || []),
        {
          date: now,
          quantity: parsedQty,
          reason: cleanReason,
          responsible: cleanResponsible,
        },
      ];

      await commitOfflineSafe(
        updateDoc(doc(db, 'equipment', selected.id), {
          quantity: remainingQty,
          condition: remainingQty === 0 ? 'De Baja' : selected.condition,
          notes: combinedNotes,
          writeOffHistory: updatedHistory,
          updatedAt: now,
        }),
        'baja_equipment'
      );

      if (detailItem && detailItem.id === selected.id) {
        setDetailItem({
          ...selected,
          quantity: remainingQty,
          condition: remainingQty === 0 ? 'De Baja' : selected.condition,
          notes: combinedNotes,
          writeOffHistory: updatedHistory,
        });
      }

      setIsBajaModalOpen(false);
      setBajaItemId('');
      setBajaQuantity('');
      setBajaReason('');
      setBajaResponsible('');
      setFeedbackMsg(
        `Baja / Deterioro registrada: se descontaron ${parsedQty} u. de "${selected.name}". Stock actual: ${remainingQty}.`
      );
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedbackMsg(null);
        feedbackTimerRef.current = null;
      }, 5000);
    } catch (err: any) {
      console.error('Error al registrar baja de menaje/equipo:', err);
      setBajaError('No se pudo actualizar el stock en la base de datos: ' + (err?.message || 'Error de conexión'));
    } finally {
      setIsSubmittingBaja(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setModuleError(null);
    try {
      await commitOfflineSafe(deleteDoc(doc(db, 'equipment', deleteTarget.id)), 'delete_equipment');
      setDeleteTarget(null);
    } catch (err: any) {
      console.error(err);
      setModuleError('No se pudo eliminar el artículo: ' + (err?.message || 'Error de base de datos'));
    }
  };

  const filteredItems = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return items.filter((i) => {
      if (categoryFilter !== 'Todas' && i.category !== categoryFilter) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q) || i.location.toLowerCase().includes(q);
    });
  }, [items, debouncedSearch, categoryFilter]);

  const visibleItems = useMemo(
    () => (showAllItems ? filteredItems : filteredItems.slice(0, 50)),
    [filteredItems, showAllItems]
  );

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 flex items-center justify-center text-[#4A5D23]">
            <Utensils className="w-6 h-6 text-[#4A5D23]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Menaje y Equipos</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30">
                Administración
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Control de maquinaria gastronómica, cristalería, vajilla y cubiertos del local
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <button
            type="button"
            onClick={openNewModal}
            className="px-4 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#E89E2D]" />
            Nuevo Equipo / Menaje
          </button>
          <button
            type="button"
            onClick={() => openBajaModal()}
            className="px-4 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <AlertTriangle className="w-4 h-4 text-white" />
            BAJA / DETERIORO
          </button>
        </div>
      </div>

      {moduleError && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center justify-between">
          <span>{moduleError}</span>
          <button type="button" onClick={() => setModuleError(null)} className="cursor-pointer font-bold">✕</button>
        </div>
      )}

      {feedbackMsg && (
        <div className="p-3.5 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-xs font-bold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            {feedbackMsg}
          </span>
          <button type="button" onClick={() => setFeedbackMsg(null)} className="cursor-pointer font-bold">✕</button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {['Todas', 'Cocina y Maquinaria', 'Vajilla', 'Cristalería', 'Cubertería', 'Menaje'].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-[#4A5D23] text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar equipo o ubicación..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none transition-colors w-full sm:w-64"
          />
        </div>
      </div>

      {/* Items Table */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider border-b border-gray-200 font-semibold text-[11px]">
              <tr>
                <th className="p-3.5">Código</th>
                <th className="p-3.5">Artículo / Maquinaria</th>
                <th className="p-3.5">Categoría</th>
                <th className="p-3.5 text-center">Cantidad</th>
                <th className="p-3.5">Ubicación</th>
                <th className="p-3.5 text-center">Estado</th>
                <th className="p-3.5 text-right">Valor Unit.</th>
                <th className="p-3.5 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleItems.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                  <td className="p-3.5 font-mono font-bold text-[#4A5D23]">
                    <span className="px-2 py-0.5 rounded-md bg-[#EAF5F0] border border-[#4A5D23]/20 text-[11px]">
                      {item.code || 'EQ-001'}
                    </span>
                  </td>
                  <td className="p-3.5 font-bold text-gray-900">
                    <button
                      type="button"
                      onClick={() => setDetailItem(item)}
                      className="text-left font-bold text-gray-900 hover:text-[#4A5D23] hover:underline transition-colors cursor-pointer flex items-center gap-1.5"
                      title="Ver detalle e historial de bajas"
                    >
                      <span>{item.name}</span>
                      {(item.writeOffHistory?.length || 0) > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[9px] font-black uppercase">
                          {item.writeOffHistory!.length} Baja(s)
                        </span>
                      )}
                    </button>
                    {item.notes && <div className="text-[10px] text-gray-400 font-normal mt-0.5">{item.notes}</div>}
                  </td>
                  <td className="p-3.5 text-gray-600 font-medium">
                    <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-[10px] font-bold">
                      {item.category}
                    </span>
                  </td>
                  <td className="p-3.5 text-center font-mono font-bold text-gray-900 text-sm">
                    {item.quantity}
                  </td>
                  <td className="p-3.5 text-gray-600">{item.location}</td>
                  <td className="p-3.5 text-center">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        item.condition === 'Óptimo'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : item.condition === 'En Reparación'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {item.condition}
                    </span>
                  </td>
                  <td className="p-3.5 text-right font-mono text-gray-700">
                    ${(item.unitCost || 0).toFixed(2)}
                  </td>
                  <td className="p-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(item)}
                      className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer"
                      title="Eliminar registro (requiere clave admin)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredItems.length > 50 && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
            <span className="text-gray-500">
              Mostrando {visibleItems.length} de {filteredItems.length} registros
            </span>
            <button
              type="button"
              onClick={() => setShowAllItems((prev) => !prev)}
              className="px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-300 text-[#4A5D23] font-bold cursor-pointer"
            >
              {showAllItems ? 'Mostrar primeros 50' : `Ver todos (${filteredItems.length})`}
            </button>
          </div>
        )}
      </div>

      {/* New Equipment Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-gray-200 text-gray-900">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <h3 className="font-bold text-base text-gray-900">Registrar Menaje / Equipo</h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer">✕</button>
            </div>

            {modalError && (
              <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateItem} noValidate className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Código</label>
                  <input
                    type="text"
                    placeholder="EQ-001"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 font-mono font-bold focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-bold text-gray-700 mb-1">Nombre del Artículo / Equipo *</label>
                  <input
                    type="text"
                    placeholder="Ej. Copas de Gin Tonic 600ml"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Categoría</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  >
                    <option value="Menaje">Menaje</option>
                    <option value="Cocina y Maquinaria">Cocina y Maquinaria</option>
                    <option value="Cristalería">Cristalería</option>
                    <option value="Vajilla">Vajilla</option>
                    <option value="Cubertería">Cubertería</option>
                    <option value="Mobiliario">Mobiliario</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Cantidad *</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Ej. 24"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Ubicación</label>
                  <input
                    type="text"
                    placeholder="Ej. Barra de Cócteles"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Estado</label>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as any)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  >
                    <option value="Óptimo">Óptimo</option>
                    <option value="En Reparación">En Reparación</option>
                    <option value="Desgaste">Desgaste</option>
                    <option value="De Baja">De Baja</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Costo Unitario ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Ej. 12.50"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Notas (Opcional)</label>
                  <input
                    type="text"
                    placeholder="Ej. Marca / Serie..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5 text-[#E89E2D]" />
                  {isSubmitting ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Baja / Deterioro Modal */}
      {isBajaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-gray-200 text-gray-900">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-gray-900">Registrar Baja / Deterioro</h3>
                  <p className="text-[11px] text-gray-500">Descuenta automáticamente del stock del inventario</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBajaModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {bajaError && (
              <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {bajaError}
              </div>
            )}

            <form onSubmit={handleConfirmBaja} noValidate className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Seleccionar Equipo o Menaje *
                </label>
                <select
                  value={bajaItemId}
                  onChange={(e) => setBajaItemId(e.target.value)}
                  required
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2.5 text-gray-900 font-semibold focus:outline-none focus:border-rose-500"
                >
                  <option value="">-- Selecciona un artículo --</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id} disabled={item.quantity <= 0}>
                      {item.name} ({item.code || 'EQ'}) — Stock: {item.quantity}
                    </option>
                  ))}
                </select>
              </div>

              {(() => {
                const selectedItem = items.find((i) => i.id === bajaItemId);
                if (!selectedItem) return null;
                return (
                  <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between text-[11px]">
                    <span className="text-gray-600">
                      Ubicación: <strong className="text-gray-900">{selectedItem.location}</strong>
                    </span>
                    <span className="font-mono font-bold text-[#4A5D23]">
                      Stock actual: {selectedItem.quantity} u.
                    </span>
                  </div>
                );
              })()}

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Cantidad a dar de baja *
                </label>
                <input
                  type="number"
                  min="1"
                  max={items.find((i) => i.id === bajaItemId)?.quantity || undefined}
                  required
                  placeholder="Ej. 2"
                  value={bajaQuantity}
                  onChange={(e) => setBajaQuantity(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2.5 text-gray-900 font-mono font-bold focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Motivo de la baja / deterioro *
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Ej. Copa rota durante el servicio, equipo averiado sin reparación..."
                  value={bajaReason}
                  onChange={(e) => setBajaReason(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-rose-500 resize-none"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Responsable (Quién registra la baja)
                </label>
                <input
                  type="text"
                  placeholder={userProfile?.name ? `Ej. ${userProfile.name}` : 'Nombre completo del responsable...'}
                  value={bajaResponsible}
                  onChange={(e) => setBajaResponsible(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsBajaModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingBaja || !bajaItemId}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {isSubmittingBaja ? 'Procesando...' : 'Confirmar Baja'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail & Bajas History Modal */}
      {detailItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
          <div className="w-full max-w-xl bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 relative max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between pb-4 border-b border-gray-200 mb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] shrink-0">
                  <Utensils className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-black text-gray-900">{detailItem.name}</h3>
                    <span className="px-2 py-0.5 rounded-md bg-[#EAF5F0] border border-[#4A5D23]/20 text-[10px] font-mono font-bold text-[#4A5D23]">
                      {detailItem.code || 'EQ-001'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {detailItem.category} · Ubicación: {detailItem.location}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary KPIs */}
            <div className="grid grid-cols-3 gap-3 mb-4 shrink-0 text-xs">
              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
                <span className="text-[10px] font-bold uppercase text-emerald-700 block">Stock Actual</span>
                <span className="font-mono font-black text-base text-emerald-700">
                  {detailItem.quantity} u.
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200">
                <span className="text-[10px] font-bold uppercase text-gray-500 block">Estado</span>
                <span className="font-bold text-gray-900">{detailItem.condition}</span>
              </div>
              <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200">
                <span className="text-[10px] font-bold uppercase text-gray-500 block">Valor Unit.</span>
                <span className="font-mono font-bold text-[#D97706]">
                  ${(detailItem.unitCost || 0).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Write-Off History */}
            <div className="flex items-center justify-between mb-2 shrink-0">
              <h4 className="text-xs font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                <ClipboardMinus className="w-4 h-4 text-rose-600" />
                Historial de Bajas y Deterioros ({detailItem.writeOffHistory?.length || 0})
              </h4>
              <button
                type="button"
                onClick={() => {
                  const id = detailItem.id;
                  setDetailItem(null);
                  openBajaModal(id);
                }}
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <AlertTriangle className="w-3 h-3" />
                Registrar Baja
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-2.5 pr-1">
              {(!detailItem.writeOffHistory || detailItem.writeOffHistory.length === 0) ? (
                <div className="py-10 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-300 text-xs text-gray-500">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                  Este equipo o menaje no registra bajas ni deterioros hasta el momento.
                </div>
              ) : (
                [...detailItem.writeOffHistory]
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map((baja, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-2xl bg-rose-50/50 border border-rose-200 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-100 text-rose-800 font-mono font-black text-[11px]">
                          -{baja.quantity} u.
                        </span>
                        <span className="text-[11px] font-mono text-gray-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          {baja.date
                            ? new Date(baja.date).toLocaleString('es-EC', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })
                            : 'Fecha no registrada'}
                        </span>
                      </div>
                      <p className="text-gray-900 font-semibold">
                        Motivo: <span className="font-normal text-gray-700">{baja.reason || '-'}</span>
                      </p>
                      <p className="text-[11px] text-gray-600 flex items-center gap-1">
                        <User className="w-3 h-3 text-[#4A5D23]" />
                        Registrado por:{' '}
                        <strong className="text-gray-900">
                          {baja.responsible || 'Personal de turno'}
                        </strong>
                      </p>
                    </div>
                  ))
              )}
            </div>

            <div className="pt-4 mt-4 border-t border-gray-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Auth Modal */}
      <DeleteAuthModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Eliminar Equipo o Menaje"
        itemDescription={`el artículo "${deleteTarget?.name}"`}
      />
    </div>
  );
};
