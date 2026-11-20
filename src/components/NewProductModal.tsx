import React, { useState, useEffect, useRef, useMemo } from 'react';
import { collection, addDoc, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { uploadProductImage, compressImageFile } from '../utils/storage';
import {
  ProductComponentLink,
  InventoryItem,
  ProductCustomizationGroup,
} from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  X,
  Upload,
  DollarSign,
  Tag,
  Utensils,
  CheckCircle2,
  AlertCircle,
  Link as LinkIcon,
  Search,
  BookOpen,
  Crop,
  Plus,
  Trash2,
  Package,
  Layers,
  SlidersHorizontal,
} from 'lucide-react';
import { ImageCropperModal } from './ImageCropperModal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onProductCreated?: () => void;
}

interface ComponentCatalogOption {
  id: string;
  name: string;
  type: 'ingrediente' | 'receta' | 'subreceta';
  defaultUnit: string;
}

const DEFAULT_CATEGORIES = [
  'Platos Fuertes',
  'Entradas',
  'Bebidas',
  'Postres',
  'Especiales',
];

const normalizeUnit = (u?: string): 'Grs.' | 'Ml.' | 'Unds.' => {
  if (!u) return 'Grs.';
  const low = u.toLowerCase();
  if (low === 'kg' || low === 'grs.' || low === 'g' || low === 'gramos') return 'Grs.';
  if (low === 'lt' || low === 'ml.' || low === 'ml' || low === 'litros') return 'Ml.';
  return 'Unds.';
};

export const NewProductModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onProductCreated,
}) => {
  // Strict empty inputs by default
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [productCategories, setProductCategories] = useState<string[]>([]);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  const [imageUrl, setImageUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('file');
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  // Dynamic multi-component linking (Ingredientes + Subrecetas + Recetas)
  const [inventoryOptions, setInventoryOptions] = useState<ComponentCatalogOption[]>([]);
  const [recipeOptions, setRecipeOptions] = useState<ComponentCatalogOption[]>([]);
  const [subrecipeOptions, setSubrecipeOptions] = useState<ComponentCatalogOption[]>([]);
  const [linkedComponents, setLinkedComponents] = useState<ProductComponentLink[]>([]);
  const [componentSearch, setComponentSearch] = useState('');
  const [isComponentDropdownOpen, setIsComponentDropdownOpen] = useState(false);

  // Personalización / Extras (Modificadores)
  const [customizations, setCustomizations] = useState<ProductCustomizationGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMultiSelect, setNewGroupMultiSelect] = useState(true);
  const [newGroupRequired, setNewGroupRequired] = useState(false);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, { name: string; extraPrice: string }>>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const debouncedComponentSearch = useDebouncedValue(componentSearch, 150);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Reset all fields cleanly on open + load inventory, recipes, and subrecipes
  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setPrice('');
    setCategory('');
    setIsCreatingCategory(false);
    setNewCategoryInput('');
    setImageUrl('');
    setSelectedFile(null);
    setPreviewUrl(null);
    setLinkedComponents([]);
    setCustomizations([]);
    setNewGroupName('');
    setNewGroupMultiSelect(true);
    setNewGroupRequired(false);
    setOptionDrafts({});
    setComponentSearch('');
    setIsComponentDropdownOpen(false);
    setErrorMsg(null);
    setSuccessMsg(null);

    const unsubInv = onSnapshot(
      collection(db, 'inventory'),
      (snap) => {
        const list: ComponentCatalogOption[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as InventoryItem;
          list.push({
            id: docSnap.id,
            name: d.name || 'Insumo sin nombre',
            type: 'ingrediente',
            defaultUnit: normalizeUnit(d.unit),
          });
        });
        setInventoryOptions(list.sort((a, b) => a.name.localeCompare(b.name)));
      },
      (err) => console.warn('NewProduct inventory listener notice:', err)
    );

    const unsubRecipes = onSnapshot(
      collection(db, 'recipes'),
      (snap) => {
        const list: ComponentCatalogOption[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            id: docSnap.id,
            name: d.name || 'Receta sin nombre',
            type: 'receta',
            defaultUnit: 'Unds.',
          });
        });
        setRecipeOptions(list.sort((a, b) => a.name.localeCompare(b.name)));
      },
      (err) => console.warn('NewProduct recipes listener notice:', err)
    );

    const unsubSubrecipes = onSnapshot(
      collection(db, 'subrecipes'),
      (snap) => {
        const list: ComponentCatalogOption[] = [];
        snap.forEach((docSnap) => {
          const sd = docSnap.data();
          list.push({
            id: docSnap.id,
            name: sd.name || 'Subreceta sin nombre',
            type: 'subreceta',
            defaultUnit: normalizeUnit(sd.yieldUnit),
          });
        });
        setSubrecipeOptions(list.sort((a, b) => a.name.localeCompare(b.name)));
      },
      (err) => console.warn('NewProduct subrecipes listener notice:', err)
    );

    const unsubProducts = onSnapshot(
      collection(db, 'products'),
      (snap) => {
        const cats = new Set<string>();
        snap.forEach((d) => {
          const c = (d.data().category || '').trim();
          if (c) cats.add(c);
        });
        setProductCategories(Array.from(cats));
      },
      (err) => console.warn('NewProduct products listener notice:', err)
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
      (err) => console.warn('NewProduct settings listener notice:', err)
    );

    return () => {
      unsubInv();
      unsubRecipes();
      unsubSubrecipes();
      unsubProducts();
      unsubSettings();
    };
  }, [isOpen]);

  const availableCategories = useMemo(
    () =>
      Array.from(
        new Set([...DEFAULT_CATEGORIES, ...customCategories, ...productCategories])
      ),
    [customCategories, productCategories]
  );

  const allCatalogOptions = useMemo(
    () => [...recipeOptions, ...subrecipeOptions, ...inventoryOptions],
    [recipeOptions, subrecipeOptions, inventoryOptions]
  );

  const filteredOptions = useMemo(() => {
    const q = debouncedComponentSearch.trim().toLowerCase();
    if (!q) return allCatalogOptions;
    return allCatalogOptions.filter(
      (opt) => opt.name.toLowerCase().includes(q) || opt.type.toLowerCase().includes(q)
    );
  }, [allCatalogOptions, debouncedComponentSearch]);

  if (!isOpen) return null;

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
      console.error('Error al crear categoría:', err);
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
      setErrorMsg('Por favor selecciona un archivo de imagen válido (JPG, PNG, WebP).');
      return;
    }

    setErrorMsg(null);
    setIsProcessingImage(true);
    try {
      const compressed = await compressImageFile(file, 560, 0.8);
      setPreviewUrl(compressed.dataUrl);
      setSelectedFile(compressed.file);
    } catch (err: any) {
      console.error('Error procesando imagen de plato:', err);
      setErrorMsg('No se pudo procesar la imagen en este dispositivo. Prueba con otra foto.');
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleCropComplete = (croppedDataUrl: string, croppedFile: File) => {
    setPreviewUrl(croppedDataUrl);
    setSelectedFile(croppedFile);
  };

  const handleAddComponent = (opt: ComponentCatalogOption) => {
    setLinkedComponents((prev) => [
      ...prev,
      {
        id: opt.id,
        name: opt.name,
        type: opt.type,
        quantity: 0,
        unit: opt.defaultUnit,
      },
    ]);
    setComponentSearch('');
    setIsComponentDropdownOpen(false);
  };

  const handleUpdateComponentQty = (idx: number, rawVal: string) => {
    const parsed = rawVal === '' ? 0 : parseFloat(rawVal);
    setLinkedComponents((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, quantity: isNaN(parsed) ? 0 : Math.max(0, parsed) } : c))
    );
  };

  const handleUpdateComponentUnit = (idx: number, unit: string) => {
    setLinkedComponents((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, unit } : c))
    );
  };

  const handleRemoveComponent = (idx: number) => {
    setLinkedComponents((prev) => prev.filter((_, i) => i !== idx));
  };

  // Personalización / Extras handlers
  const handleAddCustomizationGroup = () => {
    const clean = newGroupName.trim();
    if (!clean) {
      setErrorMsg('Escribe el nombre del grupo de personalización (ej. Salsas, Término, Extras).');
      return;
    }
    setErrorMsg(null);
    const gid = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setCustomizations((prev) => [
      ...prev,
      {
        id: gid,
        name: clean,
        multiSelect: newGroupMultiSelect,
        required: newGroupRequired,
        options: [],
      },
    ]);
    setNewGroupName('');
    setNewGroupRequired(false);
  };

  const handleToggleGroupMultiSelect = (groupId: string) => {
    setCustomizations((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, multiSelect: !g.multiSelect } : g))
    );
  };

  const handleToggleGroupRequired = (groupId: string) => {
    setCustomizations((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, required: !g.required } : g))
    );
  };

  const handleRemoveCustomizationGroup = (groupId: string) => {
    setCustomizations((prev) => prev.filter((g) => g.id !== groupId));
  };

  const handleAddOptionToGroup = (groupId: string) => {
    const draft = optionDrafts[groupId] || { name: '', extraPrice: '' };
    const cleanOpt = draft.name.trim();
    if (!cleanOpt) {
      setErrorMsg('Ingresa el nombre de la opción (ej. BBQ, Picante, Mostaza).');
      return;
    }
    const parsedExtra = draft.extraPrice.trim() === '' ? 0 : Math.max(0, parseFloat(draft.extraPrice) || 0);
    setErrorMsg(null);
    const oid = `opt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setCustomizations((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              options: [...g.options, { id: oid, name: cleanOpt, extraPrice: parsedExtra }],
            }
          : g
      )
    );
    setOptionDrafts((prev) => ({ ...prev, [groupId]: { name: '', extraPrice: '' } }));
  };

  const handleRemoveOptionFromGroup = (groupId: string, optionId: string) => {
    setCustomizations((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, options: g.options.filter((o) => o.id !== optionId) } : g
      )
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanName = name.trim();
    const numPrice = parseFloat(price);

    if (!cleanName) {
      setErrorMsg('El Nombre del Producto es obligatorio.');
      return;
    }

    if (isNaN(numPrice) || numPrice < 0) {
      setErrorMsg('Por favor ingresa un Precio de Venta válido (mayor o igual a 0).');
      return;
    }

    const finalCategory = category.trim();
    if (!finalCategory || finalCategory === '__create__') {
      setErrorMsg('Por favor selecciona o crea una categoría para el producto.');
      return;
    }

    const invalidComp = linkedComponents.find((c) => !c.quantity || c.quantity <= 0);
    if (invalidComp) {
      setErrorMsg(`Ingresa una cantidad mayor a 0 para "${invalidComp.name}".`);
      return;
    }

    const emptyCustomGroup = customizations.find((g) => g.options.length === 0);
    if (emptyCustomGroup) {
      setErrorMsg(`Agrega al menos una opción dentro del grupo "${emptyCustomGroup.name}" o elimínalo.`);
      return;
    }

    setIsSubmitting(true);
    try {
      let finalImageUrl = imageUrl.trim();

      if (selectedFile) {
        finalImageUrl = await uploadProductImage(selectedFile);
      } else if (!finalImageUrl) {
        finalImageUrl = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80';
      }

      const firstRecipe = linkedComponents.find((c) => c.type === 'receta' || c.type === 'subreceta');

      const newProductData: any = {
        name: cleanName,
        price: numPrice,
        category: finalCategory,
        imageUrl: finalImageUrl,
        available: true,
        linkedComponents,
        customizations,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (firstRecipe) {
        newProductData.linkedRecipeId = firstRecipe.id;
        newProductData.linkedRecipeName = firstRecipe.name;
        newProductData.linkedRecipeType = firstRecipe.type;
      }

      await addDoc(collection(db, 'products'), newProductData);

      setSuccessMsg('¡Platillo agregado exitosamente a la Carta con todos sus componentes!');
      setName('');
      setPrice('');
      setCategory('');
      setNewCategoryInput('');
      setIsCreatingCategory(false);
      setImageUrl('');
      setLinkedComponents([]);
      setCustomizations([]);
      setNewGroupName('');
      setNewGroupRequired(false);
      setOptionDrafts({});
      setSelectedFile(null);
      setPreviewUrl(null);

      if (onProductCreated) onProductCreated();

      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
      }, 900);
    } catch (err: any) {
      console.error('Error al guardar producto:', err);
      setErrorMsg(err.message || 'No se pudo guardar el producto en Firestore.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto text-[#1F2937]">
      <div className="w-full max-w-xl bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 relative max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] shadow-xs">
              <Utensils className="w-5 h-5 text-[#4A5D23]" />
            </div>
            <div>
              <h3 className="text-lg font-black text-[#1F2937]">Nuevo Plato en Carta</h3>
              <p className="text-xs text-[#4B5563]">Crea el producto y vincula múltiples insumos o recetas</p>
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

        {/* Feedback alerts */}
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

        <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto space-y-4 pt-4 pr-1 text-xs">
          {/* Product Name */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] mb-1.5">
              Nombre del Plato o Bebida <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="Ej. Ceviche Mixto Especial"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-2xl px-3.5 py-2.5 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors font-medium"
            />
          </div>

          {/* Price & Category Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] mb-1.5">
                Precio de Venta ($) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#D97706]" />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-2xl pl-9 pr-3 py-2.5 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors font-mono font-bold"
                />
              </div>
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
                  <option value="" disabled className="text-gray-400">
                    -- Seleccionar Categoría --
                  </option>
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
                Nueva Categoría para la Carta
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Ej. Sushi Rolls, Cocteles, Promos..."
                  value={newCategoryInput}
                  onChange={(e) => setNewCategoryInput(e.target.value)}
                  className="flex-1 bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none"
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

          {/* MULTI-COMPONENT DYNAMIC LIST: Ingredientes, Subrecetas y Recetas */}
          <div className="p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-[#4A5D23]" />
                  Componentes Vinculados ({linkedComponents.length})
                </label>
                <p className="text-[11px] text-[#4B5563] mt-0.5">
                  Agrega uno o varios ingredientes, subrecetas o recetas que se descontarán al vender este plato.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsComponentDropdownOpen(!isComponentDropdownOpen)}
                className="px-3 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-[#D97706]" />
                Añadir Componente
              </button>
            </div>

            {/* Expandable Searchable Picker */}
            {isComponentDropdownOpen && (
              <div className="p-3 bg-white border border-gray-200 rounded-2xl shadow-md space-y-2 animate-in fade-in duration-150">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Buscar ingrediente, subreceta o receta..."
                    value={componentSearch}
                    onChange={(e) => setComponentSearch(e.target.value)}
                    className="w-full bg-[#F8F9FA] border border-gray-200 focus:border-[#4A5D23] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none"
                    autoFocus
                  />
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1 pr-1 divide-y divide-gray-100">
                  {filteredOptions.length === 0 ? (
                    <div className="p-3 text-center text-gray-400 text-xs">
                      No se encontraron ingredientes, subrecetas o recetas.
                    </div>
                  ) : (
                    filteredOptions.map((opt) => (
                      <button
                        type="button"
                        key={`${opt.type}_${opt.id}`}
                        onClick={() => handleAddComponent(opt)}
                        className="w-full p-2 rounded-xl text-xs flex items-center justify-between cursor-pointer hover:bg-[#EAF5F0] text-left transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider shrink-0 ${
                              opt.type === 'receta'
                                ? 'bg-[#4A5D23]/15 text-[#4A5D23]'
                                : opt.type === 'subreceta'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-blue-50 text-blue-700'
                            }`}
                          >
                            {opt.type === 'receta'
                              ? 'Receta'
                              : opt.type === 'subreceta'
                              ? 'Subreceta'
                              : 'Ingrediente'}
                          </span>
                          <span className="font-semibold text-[#1F2937] truncate">{opt.name}</span>
                        </div>
                        <span className="text-[10px] font-bold text-[#4A5D23] flex items-center gap-0.5 shrink-0 ml-2">
                          <Plus className="w-3 h-3" /> Añadir
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Dynamic Rows of Linked Components */}
            {linkedComponents.length === 0 ? (
              <div className="p-3 rounded-xl bg-white border border-dashed border-gray-300 text-center text-[11px] text-gray-400">
                Sin componentes vinculados. Pulsa "+ Añadir Componente" para agregar ingredientes o subrecetas.
              </div>
            ) : (
              <div className="space-y-2">
                {linkedComponents.map((comp, idx) => (
                  <div
                    key={`${comp.type}_${comp.id}_${idx}`}
                    className="p-2.5 rounded-xl bg-white border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider shrink-0 flex items-center gap-1 ${
                          comp.type === 'receta'
                            ? 'bg-[#4A5D23]/15 text-[#4A5D23]'
                            : comp.type === 'subreceta'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {comp.type === 'receta' ? (
                          <BookOpen className="w-2.5 h-2.5" />
                        ) : comp.type === 'subreceta' ? (
                          <Layers className="w-2.5 h-2.5" />
                        ) : (
                          <Package className="w-2.5 h-2.5" />
                        )}
                        {comp.type}
                      </span>
                      <span className="font-bold text-xs text-[#1F2937] truncate">{comp.name}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="Cant."
                        value={comp.quantity === 0 ? '' : comp.quantity}
                        onChange={(e) => handleUpdateComponentQty(idx, e.target.value)}
                        className="w-20 bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-lg px-2 py-1 text-right font-mono font-bold text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none"
                      />
                      <select
                        value={comp.unit}
                        onChange={(e) => handleUpdateComponentUnit(idx, e.target.value)}
                        className="bg-[#F8F9FA] border border-gray-300 rounded-lg px-2 py-1 text-xs font-bold text-[#1F2937] focus:outline-none cursor-pointer"
                      >
                        <option value="Grs.">Grs.</option>
                        <option value="Ml.">Ml.</option>
                        <option value="Unds.">Unds.</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleRemoveComponent(idx)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Quitar componente"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* PERSONALIZACIÓN / EXTRAS (Modificadores por plato) */}
          <div className="p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200 space-y-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] flex items-center gap-1.5">
                <SlidersHorizontal className="w-4 h-4 text-[#D97706]" />
                Personalización / Extras ({customizations.length} grupos)
              </label>
              <p className="text-[11px] text-[#4B5563] mt-0.5">
                Define opciones elegibles al tomar el pedido (ej. Salsas: BBQ, Picante, Mostaza) con costo extra opcional.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
              <input
                type="text"
                placeholder="Nombre del grupo (ej. Salsas, Término, Extras...)"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomizationGroup();
                  }
                }}
                className="flex-1 min-w-[180px] bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none"
              />
              <label className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-white border border-gray-200 text-[11px] font-bold text-gray-700 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={newGroupMultiSelect}
                  onChange={(e) => setNewGroupMultiSelect(e.target.checked)}
                  className="rounded accent-[#4A5D23]"
                />
                Selección múltiple
              </label>
              <label className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-white border border-gray-200 text-[11px] font-bold text-gray-700 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={newGroupRequired}
                  onChange={(e) => setNewGroupRequired(e.target.checked)}
                  className="rounded accent-rose-600"
                />
                Obligatoria
              </label>
              <button
                type="button"
                onClick={handleAddCustomizationGroup}
                className="px-3.5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-[11px] font-bold flex items-center justify-center gap-1 shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#E89E2D]" />
                Crear Grupo
              </button>
            </div>

            {customizations.length > 0 && (
              <div className="space-y-2.5">
                {customizations.map((grp) => {
                  const draft = optionDrafts[grp.id] || { name: '', extraPrice: '' };
                  return (
                    <div key={grp.id} className="p-3 rounded-xl bg-white border border-gray-200 space-y-2 shadow-2xs">
                      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-gray-100">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <span className="font-black text-xs text-[#4A5D23] truncate">{grp.name}</span>
                          <button
                            type="button"
                            onClick={() => handleToggleGroupMultiSelect(grp.id)}
                            className="px-2 py-0.5 rounded-md bg-gray-100 hover:bg-gray-200 text-[10px] font-bold text-gray-700 cursor-pointer"
                            title="Cambiar entre selección única o múltiple"
                          >
                            {grp.multiSelect ? 'Múltiple' : 'Única'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleGroupRequired(grp.id)}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer border transition-colors ${
                              grp.required
                                ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            }`}
                            title="Alternar entre opción obligatoria u opcional"
                          >
                            {grp.required ? 'Obligatoria' : 'Opcional'}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomizationGroup(grp.id)}
                          className="p-1 text-gray-400 hover:text-rose-600 cursor-pointer"
                          title="Eliminar grupo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {grp.options.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {grp.options.map((opt) => (
                            <span
                              key={opt.id}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EAF5F0] border border-[#4A5D23]/25 text-[11px] font-bold text-[#1F2937]"
                            >
                              <span>{opt.name}</span>
                              {opt.extraPrice > 0 && (
                                <span className="font-mono text-[#D97706]">+${opt.extraPrice.toFixed(2)}</span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemoveOptionFromGroup(grp.id, opt.id)}
                                className="text-gray-400 hover:text-rose-600 cursor-pointer ml-0.5"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 pt-1">
                        <input
                          type="text"
                          placeholder="Opción (ej. BBQ, Picante, Mostaza...)"
                          value={draft.name}
                          onChange={(e) =>
                            setOptionDrafts((prev) => ({
                              ...prev,
                              [grp.id]: { ...draft, name: e.target.value },
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddOptionToGroup(grp.id);
                            }
                          }}
                          className="flex-1 bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-lg px-2.5 py-1.5 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Extra $ (0.50)"
                          value={draft.extraPrice}
                          onChange={(e) =>
                            setOptionDrafts((prev) => ({
                              ...prev,
                              [grp.id]: { ...draft, extraPrice: e.target.value },
                            }))
                          }
                          className="w-28 bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-lg px-2 py-1.5 text-xs font-mono text-right text-[#1F2937] placeholder-gray-400 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddOptionToGroup(grp.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white border border-[#4A5D23]/30 text-[11px] font-bold cursor-pointer shrink-0 transition-colors"
                        >
                          + Opción
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Photo Upload Section */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937]">
                Foto del Plato
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
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="w-full border-2 border-dashed border-gray-300 hover:border-[#4A5D23] rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer transition-colors bg-[#F8F9FA] disabled:opacity-60"
                >
                  {isProcessingImage ? (
                    <div className="py-4 flex flex-col items-center gap-2 text-[#4A5D23]">
                      <span className="w-6 h-6 border-2 border-[#4A5D23] border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs font-bold">Optimizando fotografía...</span>
                    </div>
                  ) : previewUrl ? (
                    <div className="relative w-full h-28 rounded-xl overflow-hidden group">
                      <img
                        src={previewUrl}
                        alt="Vista previa"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-xs font-semibold text-white">
                        Haz clic para cambiar foto
                      </div>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-7 h-7 text-[#4A5D23] mb-1.5" />
                      <span className="text-xs font-bold text-[#1F2937]">
                        Subir foto desde tu dispositivo
                      </span>
                      <span className="text-[10px] text-gray-500 mt-0.5">
                        Formatos JPG, PNG, HEIC o WebP (compresión automática)
                      </span>
                    </>
                  )}
                </button>

                {previewUrl && (
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsCropperOpen(true);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white border border-[#4A5D23]/30 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Crop className="w-3.5 h-3.5" />
                      Centrar y Recortar Foto
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
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
                  placeholder="https://ejemplo.com/foto-platillo.jpg"
                  value={imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value);
                    setPreviewUrl(e.target.value);
                  }}
                  className="w-full bg-[#F8F9FA] border border-gray-300 focus:border-[#4A5D23] rounded-2xl pl-9 pr-3 py-2 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors"
                />
              </div>
            )}
          </div>

          {/* Action Buttons */}
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
              {isSubmitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Guardando en Firebase...
                </>
              ) : (
                'Guardar Plato'
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Manual photo crop modal */}
      <ImageCropperModal
        isOpen={isCropperOpen}
        imageSrc={previewUrl}
        onClose={() => setIsCropperOpen(false)}
        onCropComplete={handleCropComplete}
      />
    </div>
  );
};
