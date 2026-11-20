import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  query,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Product, Promotion } from '../types';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { SPANISH_WEEKDAYS, isPromotionValidNow } from '../utils/customizationFormatters';
import {
  Tag,
  Percent,
  Gift,
  Calendar,
  Check,
  Search,
  Plus,
  Trash2,
  Edit,
  Power,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';

interface Props {
  products: Product[];
}

export const PromocionesTab: React.FC<Props> = ({ products }) => {
  const { activeBranch } = useBranch();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [promoType, setPromoType] = useState<'descuento' | 'multi_compra'>('descuento');
  const [editingPromoId, setEditingPromoId] = useState<string | null>(null);

  // Form inputs — strictly empty ("") by default per global UX rule
  const [name, setName] = useState<string>('');
  const [grossPriceStr, setGrossPriceStr] = useState<string>('');
  const [discountPercentStr, setDiscountPercentStr] = useState<string>('');
  const [deliverQtyStr, setDeliverQtyStr] = useState<string>('');
  const [chargeQtyStr, setChargeQtyStr] = useState<string>('');
  const [multiPromoPriceStr, setMultiPromoPriceStr] = useState<string>('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productFilter, setProductFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>([]);

  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Real-time listener for Firestore "promotions" collection
  useEffect(() => {
    const q = query(collection(db, 'promotions'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Promotion[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Promotion, 'id'>) }));
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setPromotions(list);
      },
      (err) => {
        console.error('Error al escuchar promociones:', err);
      }
    );
    return () => unsub();
  }, []);

  const branchPromotions = useMemo(
    () => promotions.filter((p) => belongsToBranch(p.branch, activeBranch)),
    [promotions, activeBranch]
  );

  // Auto-calculated Precio Promoción for Descuento type
  const calculatedDiscountPrice = useMemo(() => {
    const gross = parseFloat(grossPriceStr);
    const pct = parseFloat(discountPercentStr);
    if (!Number.isFinite(gross) || gross <= 0) return null;
    const safePct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
    return Math.max(0, gross * (1 - safePct / 100));
  }, [grossPriceStr, discountPercentStr]);

  const filteredProducts = useMemo(() => {
    const q = productFilter.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
    );
  }, [products, productFilter]);

  const resetForm = () => {
    setEditingPromoId(null);
    setName('');
    setGrossPriceStr('');
    setDiscountPercentStr('');
    setDeliverQtyStr('');
    setChargeQtyStr('');
    setMultiPromoPriceStr('');
    setSelectedProductIds([]);
    setProductFilter('');
    setStartDate('');
    setEndDate('');
    setDaysOfWeek([]);
  };

  const handleToggleProduct = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const handleToggleDay = (day: string) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleEditPromo = (promo: Promotion) => {
    setEditingPromoId(promo.id);
    setPromoType(promo.type);
    setName(promo.name || '');
    setGrossPriceStr(promo.grossPrice !== undefined ? String(promo.grossPrice) : '');
    setDiscountPercentStr(promo.discountPercent !== undefined ? String(promo.discountPercent) : '');
    setDeliverQtyStr(promo.deliverQty !== undefined ? String(promo.deliverQty) : '');
    setChargeQtyStr(promo.chargeQty !== undefined ? String(promo.chargeQty) : '');
    setMultiPromoPriceStr(promo.type === 'multi_compra' ? String(promo.promoPrice ?? '') : '');
    setSelectedProductIds(promo.productIds || []);
    setStartDate(promo.startDate || '');
    setEndDate(promo.endDate || '');
    setDaysOfWeek(promo.daysOfWeek || []);
    setFeedback(null);
  };

  const handleSavePromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const cleanName = name.trim();
    if (!cleanName) {
      setFeedback({ type: 'error', message: 'Ingresa el nombre de la promoción.' });
      return;
    }

    if (selectedProductIds.length === 0) {
      setFeedback({ type: 'error', message: 'Selecciona al menos un producto para esta promoción.' });
      return;
    }

    let promoPrice = 0;
    let grossPrice: number | undefined;
    let discountPercent: number | undefined;
    let deliverQty: number | undefined;
    let chargeQty: number | undefined;

    if (promoType === 'descuento') {
      const parsedGross = parseFloat(grossPriceStr);
      const parsedPct = parseFloat(discountPercentStr);
      if (!Number.isFinite(parsedGross) || parsedGross <= 0) {
        setFeedback({ type: 'error', message: 'Ingresa un Precio Bruto válido mayor a $0.00.' });
        return;
      }
      if (!Number.isFinite(parsedPct) || parsedPct <= 0 || parsedPct > 100) {
        setFeedback({ type: 'error', message: 'Ingresa un Descuento (%) válido entre 1 y 100.' });
        return;
      }
      grossPrice = Number(parsedGross.toFixed(2));
      discountPercent = Number(parsedPct.toFixed(2));
      promoPrice = Number(Math.max(0, grossPrice * (1 - discountPercent / 100)).toFixed(2));
    } else {
      const parsedDeliver = parseInt(deliverQtyStr, 10);
      const parsedCharge = parseInt(chargeQtyStr, 10);
      const parsedMultiPrice = parseFloat(multiPromoPriceStr);
      if (!Number.isFinite(parsedDeliver) || parsedDeliver < 2) {
        setFeedback({ type: 'error', message: 'Ingresa Cantidad a Entregar válida (ej. 2 o 3).' });
        return;
      }
      if (!Number.isFinite(parsedCharge) || parsedCharge < 1 || parsedCharge > parsedDeliver) {
        setFeedback({
          type: 'error',
          message: 'La Cantidad a Comprar/Cobrar debe ser al menos 1 y menor o igual a Cantidad a Entregar.',
        });
        return;
      }
      if (!Number.isFinite(parsedMultiPrice) || parsedMultiPrice < 0) {
        setFeedback({ type: 'error', message: 'Ingresa el Precio de Promoción.' });
        return;
      }
      deliverQty = parsedDeliver;
      chargeQty = parsedCharge;
      promoPrice = Number(parsedMultiPrice.toFixed(2));
    }

    if (startDate && endDate && startDate > endDate) {
      setFeedback({
        type: 'error',
        message: 'La fecha de inicio no puede ser posterior a la fecha de fin.',
      });
      return;
    }

    const linkedProducts = products.filter((p) => selectedProductIds.includes(p.id));
    const productNames = linkedProducts.map((p) => p.name);
    const categories = Array.from(
      new Set(linkedProducts.map((p) => p.category || 'General').filter(Boolean))
    );

    const now = new Date().toISOString();
    const docRef = editingPromoId
      ? doc(db, 'promotions', editingPromoId)
      : doc(collection(db, 'promotions'));

    const payload: Record<string, any> = {
      name: cleanName,
      type: promoType,
      promoPrice,
      productIds: selectedProductIds,
      productNames,
      categories,
      startDate: startDate.trim(),
      endDate: endDate.trim(),
      daysOfWeek,
      active: true,
      branch: activeBranch,
      updatedAt: now,
      ...(editingPromoId ? {} : { createdAt: now }),
      ...(promoType === 'descuento'
        ? { grossPrice, discountPercent }
        : { deliverQty, chargeQty }),
    };

    setIsSaving(true);
    try {
      await commitOfflineSafe(setDoc(docRef, payload, { merge: true }), 'save_promotion');
      resetForm();
      setFeedback({
        type: 'success',
        message: editingPromoId
          ? `Promoción "${cleanName}" actualizada correctamente.`
          : `Promoción "${cleanName}" guardada y disponible en Mesas y Pedidos.`,
      });
    } catch (err: any) {
      console.error('Error al guardar promoción:', err);
      setFeedback({ type: 'error', message: err?.message || 'No se pudo guardar la promoción.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (promo: Promotion) => {
    try {
      await commitOfflineSafe(
        updateDoc(doc(db, 'promotions', promo.id), {
          active: !promo.active,
          updatedAt: new Date().toISOString(),
        }),
        'toggle_promotion'
      );
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Error al cambiar estado de promoción.' });
    }
  };

  const handleDeletePromo = async (promo: Promotion) => {
    try {
      await commitOfflineSafe(deleteDoc(doc(db, 'promotions', promo.id)), 'delete_promotion');
      if (editingPromoId === promo.id) resetForm();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Error al eliminar la promoción.' });
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left: Create / Edit Promotion Form */}
      <form
        onSubmit={handleSavePromotion}
        className="xl:col-span-5 bg-white border border-gray-200 rounded-3xl p-5 shadow-xs space-y-4"
      >
        <div className="flex items-center justify-between pb-3 border-b border-gray-200">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
              <Tag className="w-5 h-5 text-[#E89E2D]" />
            </div>
            <div>
              <h3 className="font-black text-base text-gray-900">
                {editingPromoId ? 'Editar Promoción' : 'Nueva Promoción'}
              </h3>
              <p className="text-[11px] text-gray-500">
                Sincronizada en tiempo real con Mesas y Pedidos
              </p>
            </div>
          </div>
          {editingPromoId && (
            <button
              type="button"
              onClick={resetForm}
              className="px-2.5 py-1 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Cancelar
            </button>
          )}
        </div>

        {/* Promotion Type Switcher: A) Descuento vs B) 2x1 / 3x2 */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-gray-100 border border-gray-200">
          <button
            type="button"
            onClick={() => setPromoType('descuento')}
            className={`py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              promoType === 'descuento'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Percent className="w-3.5 h-3.5 text-[#E89E2D]" />
            Descuento (%)
          </button>
          <button
            type="button"
            onClick={() => setPromoType('multi_compra')}
            className={`py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              promoType === 'multi_compra'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Gift className="w-3.5 h-3.5 text-[#E89E2D]" />
            2X1 / 3X2
          </button>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-2xl text-xs font-bold flex items-center gap-2 border ${
              feedback.type === 'success'
                ? 'bg-[#EAF5F0] border-[#4A5D23]/30 text-[#4A5D23]'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Nombre de la promoción */}
        <div>
          <label className="block text-[11px] font-extrabold uppercase tracking-wider text-gray-700 mb-1">
            Nombre de la Promoción *
          </label>
          <input
            type="text"
            placeholder={
              promoType === 'descuento'
                ? 'Ej. Combo Almuerzo 20% OFF'
                : 'Ej. Jueves 3x2 en Alitas'
            }
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3.5 py-2.5 text-xs text-gray-900 placeholder:text-gray-400/75 focus:outline-none"
          />
        </div>

        {/* Type A Fields: Descuento */}
        {promoType === 'descuento' ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-700 mb-1">
                Precio Bruto ($) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Ej. 15.00"
                value={grossPriceStr}
                onChange={(e) => setGrossPriceStr(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs font-mono text-gray-900 placeholder:text-gray-400/75 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-700 mb-1">
                Descuento (%) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="Ej. 20"
                value={discountPercentStr}
                onChange={(e) => setDiscountPercentStr(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs font-mono text-gray-900 placeholder:text-gray-400/75 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#4A5D23] mb-1">
                Precio Promoción
              </label>
              <div className="w-full bg-[#EAF5F0] border border-[#4A5D23]/30 rounded-xl px-3 py-2 text-xs font-mono font-black text-[#4A5D23] flex items-center justify-between">
                <span>$</span>
                <span>
                  {calculatedDiscountPrice !== null ? calculatedDiscountPrice.toFixed(2) : '--.--'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* Type B Fields: 2X1 o 3X2 */
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-700 mb-1">
                Cant. a Entregar *
              </label>
              <input
                type="number"
                min="2"
                step="1"
                placeholder="Ej. 3"
                value={deliverQtyStr}
                onChange={(e) => setDeliverQtyStr(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs font-mono text-gray-900 placeholder:text-gray-400/75 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-700 mb-1">
                Cant. a Cobrar *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="Ej. 2"
                value={chargeQtyStr}
                onChange={(e) => setChargeQtyStr(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs font-mono text-gray-900 placeholder:text-gray-400/75 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#4A5D23] mb-1">
                Precio Promo ($) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Ej. 18.00"
                value={multiPromoPriceStr}
                onChange={(e) => setMultiPromoPriceStr(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-900 placeholder:text-gray-400/75 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Selector de múltiples productos */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-extrabold uppercase tracking-wider text-gray-700">
              Productos Incluidos ({selectedProductIds.length}) *
            </label>
            {selectedProductIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedProductIds([])}
                className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
              >
                Limpiar selección
              </button>
            )}
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filtrar productos de la Carta..."
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 placeholder:text-gray-400/75 focus:outline-none focus:border-[#4A5D23]"
            />
          </div>
          <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-2xl bg-gray-50 p-2 space-y-1">
            {filteredProducts.length === 0 ? (
              <div className="text-center py-4 text-xs text-gray-400">
                No se encontraron productos en la Carta.
              </div>
            ) : (
              filteredProducts.map((p) => {
                const isChecked = selectedProductIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-xs cursor-pointer border transition-colors ${
                      isChecked
                        ? 'bg-[#EAF5F0] border-[#4A5D23]/40 text-[#4A5D23] font-bold'
                        : 'bg-white border-gray-200/80 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleProduct(p.id)}
                        className="accent-[#4A5D23] shrink-0 cursor-pointer"
                      />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="font-mono text-[11px] font-bold text-[#D97706] shrink-0">
                      ${(Number(p.price) || 0).toFixed(2)}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* Rango de fechas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-700 mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-[#4A5D23]" />
              Fecha Inicio
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-gray-700 mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-[#4A5D23]" />
              Fecha Fin
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
            />
          </div>
        </div>

        {/* Selector de días de la semana (Lunes a Domingo) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-700">
              Días de la Semana (Vacío = Todos los días)
            </label>
            <button
              type="button"
              onClick={() =>
                setDaysOfWeek((prev) =>
                  prev.length === SPANISH_WEEKDAYS.length ? [] : [...SPANISH_WEEKDAYS]
                )
              }
              className="text-[10px] font-bold text-[#4A5D23] hover:underline cursor-pointer"
            >
              {daysOfWeek.length === SPANISH_WEEKDAYS.length ? 'Desmarcar' : 'Todos'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SPANISH_WEEKDAYS.map((day) => {
              const active = daysOfWeek.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleToggleDay(day)}
                  className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-colors flex items-center gap-1 cursor-pointer ${
                    active
                      ? 'bg-[#4A5D23] text-white border-[#4A5D23]'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {active && <Check className="w-3 h-3 text-[#E89E2D]" />}
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="w-full py-3.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-50"
        >
          <Plus className="w-4 h-4 text-[#E89E2D]" />
          {isSaving
            ? 'Guardando...'
            : editingPromoId
            ? 'Actualizar Promoción'
            : 'Guardar Promoción en Firebase'}
        </button>
      </form>

      {/* Right: Registered Promotions List */}
      <div className="xl:col-span-7 space-y-4">
        <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-xs flex items-center justify-between">
          <div>
            <h3 className="font-black text-base text-gray-900">
              Promociones Configuradas ({branchPromotions.length})
            </h3>
            <p className="text-xs text-gray-500">
              Las promociones vigentes aparecen automáticamente en Mesas y Pedidos.
            </p>
          </div>
          <span className="px-3 py-1 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-xs font-black">
            Local: {activeBranch}
          </span>
        </div>

        {branchPromotions.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-200 rounded-3xl p-12 text-center">
            <Tag className="w-12 h-12 text-[#4A5D23]/40 mx-auto mb-3" />
            <h4 className="font-bold text-gray-900 text-sm">Aún no has creado promociones</h4>
            <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
              Crea promociones de Descuento (%) o combos 2X1 / 3X2 en el formulario de la izquierda.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {branchPromotions.map((promo) => {
              const isValidToday = isPromotionValidNow(promo, activeBranch);
              return (
                <div
                  key={promo.id}
                  className={`bg-white rounded-3xl border p-4 shadow-xs flex flex-col justify-between space-y-3 ${
                    promo.active === false
                      ? 'border-gray-200 opacity-70'
                      : isValidToday
                      ? 'border-[#4A5D23]/40'
                      : 'border-amber-200'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${
                            promo.type === 'descuento'
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : 'bg-purple-100 text-purple-900 border border-purple-300'
                          }`}
                        >
                          {promo.type === 'descuento'
                            ? `Descuento -${promo.discountPercent || 0}%`
                            : `${promo.deliverQty || 2}x${promo.chargeQty || 1}`}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${
                            promo.active === false
                              ? 'bg-gray-100 text-gray-600'
                              : isValidToday
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {promo.active === false
                            ? 'Pausada'
                            : isValidToday
                            ? 'Vigente Hoy'
                            : 'Programada'}
                        </span>
                      </div>

                      <div className="text-right shrink-0">
                        {promo.type === 'descuento' && promo.grossPrice !== undefined && (
                          <div className="text-[10px] text-gray-400 line-through font-mono">
                            ${Number(promo.grossPrice).toFixed(2)}
                          </div>
                        )}
                        <div className="text-lg font-black font-mono text-[#E89E2D]">
                          ${Number(promo.promoPrice || 0).toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <h4 className="font-extrabold text-sm text-gray-900 leading-snug">
                      {promo.name}
                    </h4>

                    {promo.productNames && promo.productNames.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {promo.productNames.map((pName, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded-md bg-gray-100 border border-gray-200 text-[10px] font-bold text-gray-700"
                          >
                            {pName}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="text-[11px] text-gray-500 space-y-1 pt-1">
                      {(promo.startDate || promo.endDate) && (
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-[#4A5D23]" />
                          <span>
                            {promo.startDate || 'Inicio abierto'} → {promo.endDate || 'Sin fin'}
                          </span>
                        </div>
                      )}
                      <div>
                        <span className="font-bold text-gray-700">Días: </span>
                        {promo.daysOfWeek && promo.daysOfWeek.length > 0
                          ? promo.daysOfWeek.join(', ')
                          : 'Todos los días'}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-gray-100 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(promo)}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 border cursor-pointer ${
                        promo.active === false
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {promo.active === false ? 'Activar' : 'Pausar'}
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleEditPromo(promo)}
                        className="px-2.5 py-1.5 rounded-xl bg-[#EAF5F0] hover:bg-[#dceee5] text-[#4A5D23] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePromo(promo)}
                        className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer"
                        title="Eliminar promoción"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
