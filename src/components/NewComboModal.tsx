import React, { useState, useEffect, useRef } from 'react';
import { collection, addDoc, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { uploadProductImage, compressImageFile } from '../utils/storage';
import { Product, ComboIncludedProduct } from '../types';
import {
  X,
  Upload,
  DollarSign,
  Tag,
  Layers,
  CheckCircle2,
  AlertCircle,
  Link as LinkIcon,
  Search,
  Crop,
  Plus,
  Minus,
  Trash2,
} from 'lucide-react';
import { ImageCropperModal } from './ImageCropperModal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onComboCreated?: () => void;
}

const DEFAULT_CATEGORIES = [
  'Combos',
  'Promociones',
  'Platos Fuertes',
  'Entradas',
  'Bebidas',
  'Postres',
  'Especiales',
];

export const NewComboModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onComboCreated,
}) => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Combos');
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [productCategories, setProductCategories] = useState<string[]>([]);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  const [menuProducts, setMenuProducts] = useState<Product[]>([]);
  const [comboItems, setComboItems] = useState<ComboIncludedProduct[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(true);

  const [imageUrl, setImageUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('file');
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setPrice('');
    setCategory('Combos');
    setIsCreatingCategory(false);
    setNewCategoryInput('');
    setComboItems([]);
    setProductSearch('');
    setImageUrl('');
    setSelectedFile(null);
    setPreviewUrl(null);
    setErrorMsg(null);
    setSuccessMsg(null);

    const unsubProducts = onSnapshot(
      collection(db, 'products'),
      (snap) => {
        const list: Product[] = [];
        const cats = new Set<string>();
        snap.forEach((d) => {
          const data = { id: d.id, ...(d.data() as Omit<Product, 'id'>) };
          if (data.category?.trim()) cats.add(data.category.trim());
          if (!data.isCombo) {
            list.push(data);
          }
        });
        setMenuProducts(list.sort((a, b) => a.name.localeCompare(b.name)));
        setProductCategories(Array.from(cats));
      },
      (err) => console.warn('NewCombo products listener notice:', err)
    );

    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'general'),
      (snap) => {
        if (snap.exists() && Array.isArray(snap.data().customCategories)) {
          setCustomCategories(
            snap
              .data()
              .customCategories.map((c: any) => String(c || '').trim())
              .filter(Boolean)
          );
        }
      },
      (err) => console.warn('NewCombo settings listener notice:', err)
    );

    return () => {
      unsubProducts();
      unsubSettings();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const availableCategories = Array.from(
    new Set([...DEFAULT_CATEGORIES, ...customCategories, ...productCategories])
  );

  const filteredMenuProducts = menuProducts.filter((p) => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
  });

  const handleAddDishToCombo = (prod: Product) => {
    setComboItems((prev) => {
      const idx = prev.findIndex((item) => item.productId === prod.id);
      if (idx > -1) {
        return prev.map((item, i) =>
          i === idx ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prev,
        {
          productId: prod.id,
          name: prod.name,
          quantity: 1,
          category: prod.category,
          unitPrice: prod.price,
        },
      ];
    });
  };

  const handleUpdateComboItemQty = (productId: string, delta: number) => {
    setComboItems((prev) =>
      prev
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: item.quantity + delta }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const handleRemoveComboItem = (productId: string) => {
    setComboItems((prev) => prev.filter((item) => item.productId !== productId));
  };

  const regularSum = comboItems.reduce(
    (acc, item) => acc + (item.unitPrice || 0) * item.quantity,
    0
  );
  const parsedComboPrice = parseFloat(price) || 0;
  const savings = regularSum > 0 && parsedComboPrice > 0 ? regularSum - parsedComboPrice : 0;

  const handleCreateCategory = async () => {
    const cleanCat = newCategoryInput.trim();
    if (!cleanCat) {
      setErrorMsg('Escribe el nombre de la nueva categoría.');
      return;
    }
    setIsSavingCategory(true);
    setErrorMsg(null);
    try {
      const merged = Array.from(new Set([...customCategories, cleanCat]));
      await setDoc(
        doc(db, 'settings', 'general'),
        { customCategories: merged, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      setCustomCategories(merged);
      setCategory(cleanCat);
      setNewCategoryInput('');
      setIsCreatingCategory(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo guardar la categoría.');
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/') && !/\.(jpg|jpeg|png|webp|heic|heif)$/i.test(file.name)) {
      setErrorMsg('Selecciona una imagen válida (JPG, PNG, WebP).');
      return;
    }

    setErrorMsg(null);
    setIsProcessingImage(true);
    try {
      const compressed = await compressImageFile(file, 560, 0.8);
      setPreviewUrl(compressed.dataUrl);
      setSelectedFile(compressed.file);
    } catch {
      setErrorMsg('No se pudo procesar la imagen. Intenta con otra.');
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleCropComplete = (croppedDataUrl: string, croppedFile: File) => {
    setPreviewUrl(croppedDataUrl);
    setSelectedFile(croppedFile);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanName = name.trim();
    const numPrice = parseFloat(price);

    if (!cleanName) {
      setErrorMsg('El Nombre del Combo es obligatorio (ej. Combo Familiar).');
      return;
    }

    if (isNaN(numPrice) || numPrice <= 0) {
      setErrorMsg('Ingresa un Precio Especial de Combo válido mayor a $0.00.');
      return;
    }

    if (comboItems.length === 0) {
      setErrorMsg('Selecciona al menos un producto o plato de la Carta para incluir en el Combo.');
      return;
    }

    const finalCategory = category.trim() || 'Combos';

    setIsSubmitting(true);
    try {
      let finalImageUrl = imageUrl.trim();
      if (selectedFile) {
        finalImageUrl = await uploadProductImage(selectedFile);
      } else if (!finalImageUrl) {
        finalImageUrl = 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&auto=format&fit=crop&q=80';
      }

      const now = new Date().toISOString();
      await addDoc(collection(db, 'products'), {
        name: cleanName,
        price: Number(numPrice.toFixed(2)),
        category: finalCategory,
        imageUrl: finalImageUrl,
        available: true,
        isCombo: true,
        comboItems,
        linkedComponents: [],
        createdAt: now,
        updatedAt: now,
      });

      setSuccessMsg(`¡Combo "${cleanName}" creado en la Carta!`);
      setName('');
      setPrice('');
      setCategory('Combos');
      setComboItems([]);
      setImageUrl('');
      setSelectedFile(null);
      setPreviewUrl(null);
      setProductSearch('');

      if (onComboCreated) onComboCreated();

      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: any) {
      console.error('Error al guardar combo:', err);
      setErrorMsg(err?.message || 'No se pudo guardar el Combo en Firestore.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto text-[#1F2937]">
      <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 relative max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-[#D97706]/30 flex items-center justify-center text-[#D97706] shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-[#1F2937]">Nuevo Combo en Carta</h3>
              <p className="text-xs text-[#4B5563]">
                Agrupa varios platos y bebidas; al venderse descontará automáticamente sus ingredientes del inventario
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5 shrink-0">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <div className="font-semibold">{errorMsg}</div>
          </div>
        )}

        {successMsg && (
          <div className="mt-4 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="font-bold">{successMsg}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-4 pt-4 pr-1 text-xs">
          {/* Combo Name */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] mb-1.5">
              Nombre del Combo <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="Ej. Combo Familiar, Promo 2x1 + Bebida..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-2xl px-3.5 py-2.5 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors font-semibold"
            />
          </div>

          {/* Combo Price & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] mb-1.5">
                Precio Especial del Combo ($) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#D97706]" />
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-2xl pl-9 pr-3 py-2.5 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors font-mono font-bold"
                />
              </div>
              {regularSum > 0 && (
                <div className="mt-1 text-[11px] text-gray-500 font-mono">
                  Suma individual: <strong>${regularSum.toFixed(2)}</strong>
                  {savings > 0 && (
                    <span className="text-emerald-700 font-bold ml-1.5">
                      (Ahorro: ${savings.toFixed(2)})
                    </span>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937]">
                  Categoría <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsCreatingCategory(!isCreatingCategory)}
                  className="text-[10px] font-bold text-[#4A5D23] hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  Crear Categoría
                </button>
              </div>
              <div className="relative">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select
                  value={category}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__create__') {
                      setIsCreatingCategory(true);
                    } else {
                      setCategory(val);
                      setIsCreatingCategory(false);
                    }
                  }}
                  className="w-full bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-2xl pl-9 pr-3 py-2.5 text-xs text-[#1F2937] focus:outline-none transition-colors cursor-pointer font-medium"
                  required
                >
                  {availableCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                  <option value="__create__">+ Crear nueva categoría...</option>
                </select>
              </div>
            </div>
          </div>

          {isCreatingCategory && (
            <div className="p-3 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#4A5D23]">
                Nueva Categoría
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Ej. Combos Familiares..."
                  value={newCategoryInput}
                  onChange={(e) => setNewCategoryInput(e.target.value)}
                  className="flex-1 bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-[#1F2937] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={isSavingCategory}
                  onClick={handleCreateCategory}
                  className="px-3.5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSavingCategory ? 'Guardando...' : 'Crear'}
                </button>
              </div>
            </div>
          )}

          {/* Selected Dishes / Drinks in Combo */}
          <div className="p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937]">
                  Elementos Incluidos en el Combo ({comboItems.reduce((acc, i) => acc + i.quantity, 0)} uds.)
                </label>
                <p className="text-[11px] text-[#4B5563] mt-0.5">
                  Selecciona múltiples platos y bebidas de tu Carta (ej. 4 platos + 1 bebida).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPickerOpen((p) => !p)}
                className="px-3 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5 text-[#E89E2D]" />
                {isPickerOpen ? 'Ocultar Lista' : 'Agregar Platos'}
              </button>
            </div>

            {comboItems.length === 0 ? (
              <div className="p-3 rounded-xl bg-white border border-dashed border-gray-300 text-center text-[11px] text-gray-500">
                Aún no has agregado platos al combo. Haz clic en los productos de la lista inferior para añadirlos.
              </div>
            ) : (
              <div className="space-y-2">
                {comboItems.map((item) => (
                  <div
                    key={item.productId}
                    className="p-2.5 rounded-xl bg-white border border-[#4A5D23]/30 flex items-center justify-between gap-2 shadow-2xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs text-gray-900 truncate">{item.name}</div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {item.category || 'Carta'} · ${(item.unitPrice || 0).toFixed(2)} c/u
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleUpdateComboItemQty(item.productId, -1)}
                        className="w-6 h-6 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center font-mono font-black text-xs text-gray-900">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdateComboItemQty(item.productId, 1)}
                        className="w-6 h-6 rounded-lg bg-[#4A5D23] hover:bg-[#3d4d1d] text-white flex items-center justify-center cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveComboItem(item.productId)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer ml-1"
                        title="Quitar del combo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Catalog Picker */}
            {isPickerOpen && (
              <div className="p-3 bg-white border border-gray-200 rounded-2xl shadow-sm space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Buscar plato o bebida de la Carta..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="w-full bg-[#F8F9FA] border border-gray-200 focus:border-[#4A5D23] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#1F2937] focus:outline-none"
                  />
                </div>

                <div className="max-h-44 overflow-y-auto divide-y divide-gray-100 pr-1">
                  {filteredMenuProducts.length === 0 ? (
                    <div className="p-4 text-center text-gray-400 text-xs">
                      No hay platos disponibles que coincidan con la búsqueda.
                    </div>
                  ) : (
                    filteredMenuProducts.map((prod) => {
                      const existing = comboItems.find((c) => c.productId === prod.id);
                      return (
                        <button
                          key={prod.id}
                          type="button"
                          onClick={() => handleAddDishToCombo(prod)}
                          className="w-full py-2 px-2.5 hover:bg-[#EAF5F0] rounded-xl flex items-center justify-between gap-2 text-left transition-colors cursor-pointer"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-bold text-gray-900 truncate block">{prod.name}</span>
                            <span className="text-[10px] text-gray-500">
                              {prod.category} · ${prod.price.toFixed(2)}
                            </span>
                          </div>
                          {existing ? (
                            <span className="px-2 py-0.5 rounded-lg bg-[#4A5D23] text-white font-mono font-bold text-[10px] shrink-0">
                              En combo: x{existing.quantity} (+1)
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold text-[#4A5D23] flex items-center gap-0.5 shrink-0">
                              <Plus className="w-3 h-3" /> Añadir
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Photo Upload Section */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937]">
                Foto del Combo
              </label>
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setUploadMode('file')}
                  className={`px-2 py-0.5 rounded-lg transition-colors cursor-pointer ${
                    uploadMode === 'file'
                      ? 'bg-[#4A5D23] text-white font-bold'
                      : 'text-gray-500 hover:text-gray-900 bg-gray-100'
                  }`}
                >
                  Subir Archivo
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode('url')}
                  className={`px-2 py-0.5 rounded-lg transition-colors cursor-pointer ${
                    uploadMode === 'url'
                      ? 'bg-[#4A5D23] text-white font-bold'
                      : 'text-gray-500 hover:text-gray-900 bg-gray-100'
                  }`}
                >
                  Enlace URL
                </button>
              </div>
            </div>

            {uploadMode === 'file' ? (
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isProcessingImage}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-300 hover:border-[#4A5D23] rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer transition-colors bg-[#F8F9FA] disabled:opacity-60"
                >
                  {isProcessingImage ? (
                    <span className="text-xs font-bold text-[#4A5D23]">Optimizando fotografía...</span>
                  ) : previewUrl ? (
                    <div className="relative w-full h-28 rounded-xl overflow-hidden">
                      <img src={previewUrl} alt="Vista previa combo" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-[#4A5D23] mb-1" />
                      <span className="text-xs font-bold text-[#1F2937]">Subir foto del combo</span>
                    </>
                  )}
                </button>

                {previewUrl && (
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setIsCropperOpen(true)}
                      className="px-3 py-1.5 rounded-xl bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Crop className="w-3.5 h-3.5" />
                      Recortar Foto
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewUrl(null);
                        setSelectedFile(null);
                        setImageUrl('');
                      }}
                      className="text-xs text-rose-600 hover:underline font-semibold cursor-pointer"
                    >
                      Eliminar foto
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="url"
                  placeholder="https://ejemplo.com/foto-combo.jpg"
                  value={imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value);
                    setPreviewUrl(e.target.value);
                  }}
                  className="w-full bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] rounded-2xl pl-9 pr-3 py-2 text-xs text-[#1F2937] focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-[#4B5563] text-xs font-bold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <Layers className="w-4 h-4 text-[#E89E2D]" />
              {isSubmitting ? 'Guardando Combo...' : 'Guardar Combo'}
            </button>
          </div>
        </form>
      </div>

      <ImageCropperModal
        isOpen={isCropperOpen}
        imageSrc={previewUrl}
        onClose={() => setIsCropperOpen(false)}
        onCropComplete={handleCropComplete}
      />
    </div>
  );
};
