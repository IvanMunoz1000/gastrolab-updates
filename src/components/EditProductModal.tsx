import React, { useState, useEffect, useRef, useMemo } from 'react';
import { doc, updateDoc, deleteDoc, collection, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  Product,
  ProductComponentLink,
  InventoryItem,
  ComboIncludedProduct,
  ProductCustomizationGroup,
} from '../types';
import { uploadProductImage, compressImageFile } from '../utils/storage';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  X,
  Edit,
  Check,
  Trash2,
  Upload,
  AlertCircle,
  CheckCircle2,
  BookOpen,
  Crop,
  Plus,
  Search,
  Package,
  Layers,
  Minus,
  SlidersHorizontal,
} from 'lucide-react';
import { ImageCropperModal } from './ImageCropperModal';

interface Props {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  onDeleted?: (productId: string) => void;
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

export const EditProductModal: React.FC<Props> = ({
  product,
  isOpen,
  onClose,
  onUpdated,
  onDeleted,
}) => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Platos Fuertes');
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [productCategories, setProductCategories] = useState<string[]>([]);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  const [imageUrl, setImageUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  // Multi-component linking state
  const [inventoryOptions, setInventoryOptions] = useState<ComponentCatalogOption[]>([]);
  const [recipeOptions, setRecipeOptions] = useState<ComponentCatalogOption[]>([]);
  const [subrecipeOptions, setSubrecipeOptions] = useState<ComponentCatalogOption[]>([]);
  const [linkedComponents, setLinkedComponents] = useState<ProductComponentLink[]>([]);
  const [componentSearch, setComponentSearch] = useState('');
  const [isComponentDropdownOpen, setIsComponentDropdownOpen] = useState(false);

  // Combo items editor state (when product.isCombo === true)
  const [catalogDishes, setCatalogDishes] = useState<Product[]>([]);
  const [comboItems, setComboItems] = useState<ComboIncludedProduct[]>([]);
  const [comboDishSearch, setComboDishSearch] = useState('');
  const [isComboPickerOpen, setIsComboPickerOpen] = useState(false);

  // Personalización / Extras (Modificadores)
  const [customizations, setCustomizations] = useState<ProductCustomizationGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMultiSelect, setNewGroupMultiSelect] = useState(true);
  const [newGroupRequired, setNewGroupRequired] = useState(false);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, { name: string; extraPrice: string }>>({});

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const debouncedComponentSearch = useDebouncedValue(componentSearch, 150);
  const debouncedComboDishSearch = useDebouncedValue(comboDishSearch, 150);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Load inventory, recipes, and subrecipes cleanly
  useEffect(() => {
    if (!isOpen) return;

    const unsubInv = onSnapshot(
      collection(db, 'inventory'),
      (snap) => {
        const list: ComponentCatalogOption[] = [];
        snap.forEach((d) => {
          const data = d.data() as InventoryItem;
          list.push({
            id: d.id,
            name: data.name || 'Insumo',
            type: 'ingrediente',
            defaultUnit: normalizeUnit(data.unit),
          });
        });
        setInventoryOptions(list.sort((a, b) => a.name.localeCompare(b.name)));
      },
      (err) => console.warn('EditProduct inventory listener notice:', err)
    );

    const unsubRec = onSnapshot(
      collection(db, 'recipes'),
      (snap) => {
        const list: ComponentCatalogOption[] = [];
        snap.forEach((d) => {
          list.push({
            id: d.id,
            name: d.data().name || 'Receta',
            type: 'receta',
            defaultUnit: 'Unds.',
          });
        });
        setRecipeOptions(list.sort((a, b) => a.name.localeCompare(b.name)));
      },
      (err) => console.warn('EditProduct recipes listener notice:', err)
    );

    const unsubSub = onSnapshot(
      collection(db, 'subrecipes'),
      (snap) => {
        const list: ComponentCatalogOption[] = [];
        snap.forEach((sd) => {
          const sdata = sd.data();
          list.push({
            id: sd.id,
            name: sdata.name || 'Subreceta',
            type: 'subreceta',
            defaultUnit: normalizeUnit(sdata.yieldUnit),
          });
        });
        setSubrecipeOptions(list.sort((a, b) => a.name.localeCompare(b.name)));
      },
      (err) => console.warn('EditProduct subrecipes listener notice:', err)
    );

    const unsubProducts = onSnapshot(
      collection(db, 'products'),
      (snap) => {
        const cats = new Set<string>();
        const dishList: Product[] = [];
        snap.forEach((d) => {
          const pdata = d.data() as Omit<Product, 'id'>;
          const c = (pdata.category || '').trim();
          if (c) cats.add(c);
          if (!pdata.isCombo) {
            dishList.push({ id: d.id, ...pdata });
          }
        });
        setProductCategories(Array.from(cats));
        setCatalogDishes(dishList.sort((a, b) => a.name.localeCompare(b.name)));
      },
      (err) => console.warn('EditProduct products listener notice:', err)
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
      (err) => console.warn('EditProduct settings listener notice:', err)
    );

    return () => {
      unsubInv();
      unsubRec();
      unsubSub();
      unsubProducts();
      unsubSettings();
    };
  }, [isOpen]);

  useEffect(() => {
    if (product) {
      setName(product.name || '');
      setPrice(product.price != null ? String(product.price) : '');
      setCategory(product.category || 'Platos Fuertes');
      setImageUrl(product.imageUrl || '');

      if (Array.isArray(product.linkedComponents) && product.linkedComponents.length > 0) {
        setLinkedComponents(product.linkedComponents);
      } else if (product.linkedRecipeId) {
        setLinkedComponents([
          {
            id: product.linkedRecipeId,
            name: product.linkedRecipeName || 'Ficha Técnica Vinculada',
            type: product.linkedRecipeType || 'receta',
            quantity: 1,
            unit: 'Unds.',
          },
        ]);
      } else {
        setLinkedComponents([]);
      }

      setComboItems(Array.isArray(product.comboItems) ? product.comboItems : []);
      setCustomizations(Array.isArray(product.customizations) ? product.customizations : []);
      setNewGroupName('');
      setNewGroupMultiSelect(true);
      setNewGroupRequired(false);
      setOptionDrafts({});
      setComboDishSearch('');
      setIsComboPickerOpen(false);
      setSelectedFile(null);
      setPreviewUrl(null);
      setConfirmDelete(false);
      setIsComponentDropdownOpen(false);
      setIsCreatingCategory(false);
      setNewCategoryInput('');
      setComponentSearch('');
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [product, isOpen]);

  const availableCategories = useMemo(
    () =>
      Array.from(
        new Set([...DEFAULT_CATEGORIES, ...customCategories, ...productCategories, ...(category ? [category] : [])])
      ).filter(Boolean),
    [customCategories, productCategories, category]
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

  const filteredCatalogDishes = useMemo(() => {
    const q = debouncedComboDishSearch.trim().toLowerCase();
    return catalogDishes.filter(
      (d) => d.id !== product?.id && (!q || d.name.toLowerCase().includes(q))
    );
  }, [catalogDishes, product?.id, debouncedComboDishSearch]);

  const comboTotalQty = useMemo(
    () => comboItems.reduce((a, b) => a + b.quantity, 0),
    [comboItems]
  );

  if (!isOpen || !product) return null;

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
      setErrorMsg('El nombre del platillo es obligatorio.');
      return;
    }

    if (isNaN(numPrice) || numPrice < 0) {
      setErrorMsg('Ingresa un precio de venta válido.');
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

    setIsSaving(true);
    try {
      let finalImageUrl = imageUrl.trim();

      if (selectedFile) {
        finalImageUrl = await uploadProductImage(selectedFile);
      }

      const firstRecipe = linkedComponents.find((c) => c.type === 'receta' || c.type === 'subreceta');

      if (product.isCombo && comboItems.length === 0) {
        setErrorMsg('El combo debe incluir al menos un producto de la Carta.');
        setIsSaving(false);
        return;
      }

      await updateDoc(doc(db, 'products', product.id), {
        name: cleanName,
        price: numPrice,
        category: category.trim(),
        imageUrl: finalImageUrl,
        ...(product.isCombo ? { comboItems } : {}),
        linkedComponents,
        customizations,
        linkedRecipeId: firstRecipe ? firstRecipe.id : null,
        linkedRecipeName: firstRecipe ? firstRecipe.name : null,
        linkedRecipeType: firstRecipe ? firstRecipe.type : null,
        updatedAt: new Date().toISOString(),
      });

      setSuccessMsg('¡Platillo actualizado exitosamente!');
      if (onUpdated) onUpdated();

      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
      }, 700);
    } catch (err: any) {
      console.error('Error al actualizar platillo:', err);
      setErrorMsg(err.message || 'Error al actualizar el producto.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDirect = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'products', product.id));
      if (onDeleted) onDeleted(product.id);
      onClose();
    } catch (err: any) {
      console.error('Error al eliminar platillo:', err);
      setErrorMsg(err.message || 'Error al eliminar el producto.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl relative text-gray-900 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
              <Edit className="w-4 h-4 text-[#4A5D23]" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-gray-900">Editar Platillo de la Carta</h3>
              <p className="text-[11px] text-gray-500">Modifica datos, precio, foto y múltiples componentes</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-bold">{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto space-y-4 pt-3.5 pr-1">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
              Nombre del Platillo <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="Ej. Ceviche Clásico"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-xl px-3 py-2.5 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23] font-semibold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Precio de Venta ($) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-xl px-3 py-2.5 text-xs font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23]"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Categoría
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
                className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-xl px-3 py-2.5 text-xs font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23] cursor-pointer"
              >
                {availableCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__create__">+ Crear nueva categoría...</option>
              </select>
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

          {product.isCombo && (
            <div className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#D97706]" />
                  Platos Incluidos en el Combo ({comboTotalQty} uds.)
                </label>
                <button
                  type="button"
                  onClick={() => setIsComboPickerOpen((p) => !p)}
                  className="px-2.5 py-1 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#E89E2D]" />
                  {isComboPickerOpen ? 'Ocultar Lista' : 'Añadir Platos'}
                </button>
              </div>

              {comboItems.map((ci) => (
                <div
                  key={ci.productId}
                  className="p-2 rounded-xl bg-white border border-amber-200 flex items-center justify-between gap-2"
                >
                  <span className="font-bold text-xs text-gray-900 truncate flex-1">{ci.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setComboItems((prev) =>
                          prev
                            .map((x) =>
                              x.productId === ci.productId ? { ...x, quantity: x.quantity - 1 } : x
                            )
                            .filter((x) => x.quantity > 0)
                        )
                      }
                      className="w-6 h-6 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center cursor-pointer"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-6 text-center font-mono font-bold text-xs">{ci.quantity}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setComboItems((prev) =>
                          prev.map((x) =>
                            x.productId === ci.productId ? { ...x, quantity: x.quantity + 1 } : x
                          )
                        )
                      }
                      className="w-6 h-6 rounded-lg bg-[#4A5D23] text-white flex items-center justify-center cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setComboItems((prev) => prev.filter((x) => x.productId !== ci.productId))
                      }
                      className="p-1 text-gray-400 hover:text-rose-600 cursor-pointer ml-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {isComboPickerOpen && (
                <div className="p-2.5 bg-white border border-gray-200 rounded-2xl space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Buscar plato de la Carta..."
                      value={comboDishSearch}
                      onChange={(e) => setComboDishSearch(e.target.value)}
                      className="w-full bg-[#F8F9FA] border border-gray-200 rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-[#4A5D23]"
                    />
                  </div>
                  <div className="max-h-36 overflow-y-auto divide-y divide-gray-100">
                    {filteredCatalogDishes.map((dish) => (
                        <button
                          key={dish.id}
                          type="button"
                          onClick={() =>
                            setComboItems((prev) => {
                              const idx = prev.findIndex((x) => x.productId === dish.id);
                              if (idx > -1) {
                                return prev.map((x, i) =>
                                  i === idx ? { ...x, quantity: x.quantity + 1 } : x
                                );
                              }
                              return [
                                ...prev,
                                {
                                  productId: dish.id,
                                  name: dish.name,
                                  quantity: 1,
                                  category: dish.category,
                                  unitPrice: dish.price,
                                },
                              ];
                            })
                          }
                          className="w-full p-2 text-left text-xs hover:bg-[#EAF5F0] rounded-lg flex items-center justify-between cursor-pointer"
                        >
                          <span className="font-semibold truncate">{dish.name}</span>
                          <span className="text-[10px] font-bold text-[#4A5D23] shrink-0 ml-2">+ Añadir</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Dynamic Multi-Component Editor */}
          <div className="p-3.5 rounded-2xl bg-[#F8F9FA] border border-gray-200 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-[#4A5D23]" />
                Componentes Vinculados ({linkedComponents.length})
              </label>
              <button
                type="button"
                onClick={() => setIsComponentDropdownOpen(!isComponentDropdownOpen)}
                className="px-2.5 py-1 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#D97706]" />
                Añadir Componente
              </button>
            </div>
            <p className="text-[11px] text-[#4B5563]">
              Agrega ingredientes directos, subrecetas o recetas completas para el descuento automático de stock.
            </p>

            {isComponentDropdownOpen && (
              <div className="p-2.5 bg-white border border-gray-200 rounded-2xl shadow-md space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Buscar ingrediente, subreceta o receta..."
                    value={componentSearch}
                    onChange={(e) => setComponentSearch(e.target.value)}
                    className="w-full bg-[#F8F9FA] border border-gray-200 focus:border-[#4A5D23] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none"
                    autoFocus
                  />
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1 divide-y divide-gray-100">
                  {filteredOptions.length === 0 ? (
                    <div className="p-2 text-center text-gray-400 text-xs">
                      No se encontraron coincidencias.
                    </div>
                  ) : (
                    filteredOptions.map((opt) => (
                      <button
                        key={`${opt.type}_${opt.id}`}
                        type="button"
                        onClick={() => handleAddComponent(opt)}
                        className="w-full p-2 rounded-xl text-xs flex items-center justify-between cursor-pointer hover:bg-[#EAF5F0] text-left"
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
                            {opt.type}
                          </span>
                          <span className="font-semibold text-[#1F2937] truncate">{opt.name}</span>
                        </div>
                        <span className="text-[10px] font-bold text-[#4A5D23] shrink-0 ml-2">+ Añadir</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {linkedComponents.length === 0 ? (
              <div className="p-2.5 rounded-xl bg-white border border-dashed border-gray-300 text-center text-[11px] text-gray-400">
                Sin componentes vinculados.
              </div>
            ) : (
              <div className="space-y-1.5">
                {linkedComponents.map((comp, idx) => (
                  <div
                    key={`${comp.type}_${comp.id}_${idx}`}
                    className="p-2 rounded-xl bg-white border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider shrink-0 flex items-center gap-1 ${
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
                      <span className="font-bold text-xs text-gray-900 truncate">{comp.name}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="Cant."
                        value={comp.quantity === 0 ? '' : comp.quantity}
                        onChange={(e) => handleUpdateComponentQty(idx, e.target.value)}
                        className="w-20 bg-gray-50 border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-lg px-2 py-1 text-right font-mono font-bold text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
                      />
                      <select
                        value={comp.unit}
                        onChange={(e) => handleUpdateComponentUnit(idx, e.target.value)}
                        className="bg-gray-50 border border-gray-300 rounded-lg px-2 py-1 text-xs font-bold text-gray-900 focus:outline-none cursor-pointer"
                      >
                        <option value="Grs.">Grs.</option>
                        <option value="Ml.">Ml.</option>
                        <option value="Unds.">Unds.</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleRemoveComponent(idx)}
                        className="p-1 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                        title="Quitar"
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
          <div className="p-3.5 rounded-2xl bg-[#F8F9FA] border border-gray-200 space-y-2.5">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#D97706]" />
                Personalización / Extras ({customizations.length} grupos)
              </label>
              <p className="text-[11px] text-[#4B5563]">
                Opciones elegibles en Mesas (ej. Salsas: BBQ, Picante, Mostaza) con costo adicional opcional.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
              <input
                type="text"
                placeholder="Grupo (ej. Salsas, Término, Extras...)"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomizationGroup();
                  }
                }}
                className="flex-1 min-w-[180px] bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
              />
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white border border-gray-200 text-[11px] font-bold text-gray-700 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={newGroupMultiSelect}
                  onChange={(e) => setNewGroupMultiSelect(e.target.checked)}
                  className="rounded accent-[#4A5D23]"
                />
                Múltiple
              </label>
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white border border-gray-200 text-[11px] font-bold text-gray-700 cursor-pointer shrink-0">
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
                className="px-3 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-[11px] font-bold flex items-center justify-center gap-1 shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#E89E2D]" />
                Crear Grupo
              </button>
            </div>

            {customizations.length > 0 && (
              <div className="space-y-2">
                {customizations.map((grp) => {
                  const draft = optionDrafts[grp.id] || { name: '', extraPrice: '' };
                  return (
                    <div key={grp.id} className="p-2.5 rounded-xl bg-white border border-gray-200 space-y-2">
                      <div className="flex items-center justify-between gap-2 pb-1 border-b border-gray-100">
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
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-[#EAF5F0] border border-[#4A5D23]/25 text-[11px] font-bold text-gray-900"
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

                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          placeholder="Opción (ej. BBQ, Picante...)"
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
                          className="flex-1 bg-gray-50 border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-lg px-2.5 py-1 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
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
                          className="w-28 bg-gray-50 border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-lg px-2 py-1 text-xs font-mono text-right text-gray-900 placeholder-gray-400 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddOptionToGroup(grp.id)}
                          className="px-2.5 py-1 rounded-lg bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white border border-[#4A5D23]/30 text-[11px] font-bold cursor-pointer shrink-0 transition-colors"
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

          {/* Photo Management */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
              Foto del Platillo
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://images.unsplash.com/..."
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="flex-1 bg-gray-50 border border-gray-200 focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23]"
              />
              <button
                type="button"
                disabled={isProcessingImage}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold flex items-center gap-1 border border-gray-200 cursor-pointer disabled:opacity-60"
                title="Subir archivo desde el dispositivo"
              >
                <Upload className="w-3.5 h-3.5" />
                {isProcessingImage ? 'Procesando...' : 'Subir'}
              </button>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />
          </div>

          {/* Image Preview */}
          {(previewUrl || imageUrl) && (
            <div className="space-y-2">
              <div className="w-full h-28 rounded-2xl overflow-hidden bg-gray-100 border border-gray-200 relative group">
                <img
                  src={previewUrl || imageUrl}
                  alt="Vista previa"
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-2 right-2 text-[10px] bg-black/60 text-white px-2 py-0.5 rounded-md">
                  Vista previa
                </span>
              </div>
              <div className="flex items-center justify-between">
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
                  Quitar foto
                </button>
              </div>
            </div>
          )}

          {/* Bottom Actions */}
          <div className="pt-3 border-t border-gray-200 flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={isDeleting || isSaving}
              onClick={handleDeleteDirect}
              className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer border ${
                confirmDelete
                  ? 'bg-rose-600 text-white border-rose-700'
                  : 'text-rose-600 hover:bg-rose-50 border-rose-200'
              }`}
              title="Eliminar este platillo permanentemente"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isDeleting ? 'Eliminando...' : confirmDelete ? 'Confirmar Borrado' : 'Eliminar'}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving || isDeleting}
                className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5 text-[#E89E2D]" />
                {isSaving ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Manual photo crop modal */}
      <ImageCropperModal
        isOpen={isCropperOpen}
        imageSrc={previewUrl || imageUrl}
        onClose={() => setIsCropperOpen(false)}
        onCropComplete={handleCropComplete}
      />
    </div>
  );
};
