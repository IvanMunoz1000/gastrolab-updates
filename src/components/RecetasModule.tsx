import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  query,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  Recipe,
  Subrecipe,
  RecipeIngredient,
  InventoryItem,
} from '../types';
import { DeleteAuthModal } from './DeleteAuthModal';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  BookOpen,
  ChefHat,
  Plus,
  Trash2,
  Edit,
  Search,
  Layers,
  CheckCircle2,
  Check,
  ChevronDown,
  Percent,
  X,
  AlertTriangle,
} from 'lucide-react';

export const RecetasModule: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'recetas' | 'subrecetas' | 'configuracion'>('recetas');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [subrecipes, setSubrecipes] = useState<Subrecipe[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [moduleError, setModuleError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 150);

  // Target Food Cost % (empty input by default; configurable in settings, fallback 30%)
  const [foodCostInput, setFoodCostInput] = useState<string>('');
  const globalFoodCostTarget = Math.max(1, Math.min(99, parseFloat(foodCostInput) || 30));

  // Security deletion state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [targetToDelete, setTargetToDelete] = useState<{
    type: 'recipe' | 'subrecipe';
    id: string;
    name: string;
  } | null>(null);

  // Unified Recipe / Subrecipe Modal State (Matches Screenshot 1 exactly)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<{
    type: 'recipe' | 'subrecipe';
    id: string;
  } | null>(null);

  // Form Fields - UX: EMPTY BY DEFAULT
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'recipe' | 'subrecipe'>('recipe');
  const [formYield, setFormYield] = useState('');
  const [formYieldUnit, setFormYieldUnit] = useState<'Grs.' | 'Ml.' | 'Unds.'>('Unds.');
  const [formIngredients, setFormIngredients] = useState<RecipeIngredient[]>([]);
  const [formProcedure, setFormProcedure] = useState('');
  const [isIngredientDropdownOpen, setIsIngredientDropdownOpen] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rawQtyMap, setRawQtyMap] = useState<Record<string, string>>({});
  const debouncedIngredientSearch = useDebouncedValue(ingredientSearch, 150);

  // Normalize units
  const normalizeUnit = (u?: string): 'Grs.' | 'Ml.' | 'Unds.' => {
    if (!u) return 'Grs.';
    const low = u.toLowerCase();
    if (low === 'kg' || low === 'grs.' || low === 'g' || low === 'gramos') return 'Grs.';
    if (low === 'lt' || low === 'ml.' || low === 'ml' || low === 'litros') return 'Ml.';
    return 'Unds.';
  };

  // Listeners
  useEffect(() => {
    const qR = query(collection(db, 'recipes'));
    const unsubR = onSnapshot(
      qR,
      (snap) => {
        const list: Recipe[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Recipe));
        setRecipes(list);
      },
      (err) => console.warn('Recetas recipes listener notice:', err)
    );

    const qS = query(collection(db, 'subrecipes'));
    const unsubS = onSnapshot(
      qS,
      (snap) => {
        const list: Subrecipe[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Subrecipe));
        setSubrecipes(list);
      },
      (err) => console.warn('Recetas subrecipes listener notice:', err)
    );

    const qI = query(collection(db, 'inventory'));
    const unsubI = onSnapshot(
      qI,
      (snap) => {
        const list: InventoryItem[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as InventoryItem));
        setInventoryItems(list);
      },
      (err) => console.warn('Recetas inventory listener notice:', err)
    );

    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'general'),
      (snap) => {
        if (snap.exists() && snap.data().foodCostPercentage !== undefined) {
          setFoodCostInput(String(snap.data().foodCostPercentage));
        }
      },
      (err) => console.warn('Recetas settings listener notice:', err)
    );

    return () => {
      unsubR();
      unsubS();
      unsubI();
      unsubSettings();
    };
  }, []);

  const inventoryMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const i of inventoryItems) map.set(i.id, i);
    return map;
  }, [inventoryItems]);

  const subrecipeMap = useMemo(() => {
    const map = new Map<string, Subrecipe>();
    for (const s of subrecipes) map.set(s.id, s);
    return map;
  }, [subrecipes]);

  // Open modal in creation mode
  const handleOpenCreate = (initialType: 'recipe' | 'subrecipe' = 'recipe') => {
    setEditingTarget(null);
    setFormName('');
    setFormType(initialType);
    setFormYield('');
    setFormYieldUnit(initialType === 'recipe' ? 'Unds.' : 'Grs.');
    setFormIngredients([]);
    setFormProcedure('');
    setIsIngredientDropdownOpen(false);
    setIngredientSearch('');
    setRawQtyMap({});
    setErrorMsg(null);
    setIsModalOpen(true);
  };

  // Resolve exact live unit cost from inventory or subrecipes in O(1)
  const getLiveIngredientUnitCost = useCallback(
    (type: 'inventory' | 'subrecipe', id: string, fallbackCost = 0): number => {
      if (type === 'inventory') {
        const inv = inventoryMap.get(id);
        if (inv) {
          const rawUnit = (inv.unit || '').toLowerCase();
          const isBulkUnit = rawUnit === 'kg' || rawUnit === 'lt';
          if (inv.totalCost != null && inv.totalCost > 0 && inv.currentStock > 0) {
            const denom = isBulkUnit ? inv.currentStock * 1000 : inv.currentStock;
            const computed = denom > 0 ? inv.totalCost / denom : 0;
            if (inv.costPerBaseUnit != null && inv.costPerBaseUnit > 0) {
              return inv.costPerBaseUnit;
            }
            if (computed > 0) return computed;
          }
          if (inv.costPerBaseUnit != null && inv.costPerBaseUnit > 0) return inv.costPerBaseUnit;
          if (inv.cost != null && inv.cost > 0) {
            return isBulkUnit ? inv.cost / 1000 : inv.cost;
          }
        }
      } else if (type === 'subrecipe') {
        const sub = subrecipeMap.get(id);
        if (sub) {
          if (sub.costPerGramOrMl != null && sub.costPerGramOrMl > 0) return sub.costPerGramOrMl;
          if (sub.totalCost != null && sub.totalCost > 0 && sub.yieldWeight > 0) {
            return sub.totalCost / sub.yieldWeight;
          }
        }
      }
      return fallbackCost || 0;
    },
    [inventoryMap, subrecipeMap]
  );

  // Open modal in edit mode (syncs latest inventory/subrecipe unit costs so prices stay exact)
  const syncIngredientsCost = (ings: RecipeIngredient[]): RecipeIngredient[] =>
    ings.map((ing) => {
      const latestCost = getLiveIngredientUnitCost(ing.type, ing.id, ing.costPerBaseUnit || 0);
      return {
        ...ing,
        unit: normalizeUnit(ing.unit),
        costPerBaseUnit: latestCost,
        totalCost: (Number(ing.quantity) || 0) * latestCost,
      };
    });

  const buildQtyMap = (ings: RecipeIngredient[]): Record<string, string> => {
    const map: Record<string, string> = {};
    ings.forEach((ing) => {
      map[`${ing.type}_${ing.id}`] = ing.quantity > 0 ? String(ing.quantity) : '';
    });
    return map;
  };

  const handleOpenEditRecipe = (recipe: Recipe) => {
    const synced = syncIngredientsCost(recipe.ingredients || []);
    setEditingTarget({ type: 'recipe', id: recipe.id });
    setFormName(recipe.name || '');
    setFormType('recipe');
    setFormYield(String(recipe.portions || 1));
    setFormYieldUnit('Unds.');
    setFormIngredients(synced);
    setRawQtyMap(buildQtyMap(synced));
    setFormProcedure(recipe.instructions || '');
    setIsIngredientDropdownOpen(false);
    setIngredientSearch('');
    setErrorMsg(null);
    setIsModalOpen(true);
  };

  const handleOpenEditSubrecipe = (sub: Subrecipe) => {
    const synced = syncIngredientsCost(sub.ingredients || []);
    setEditingTarget({ type: 'subrecipe', id: sub.id });
    setFormName(sub.name || '');
    setFormType('subrecipe');
    setFormYield(String(sub.yieldWeight || ''));
    setFormYieldUnit(normalizeUnit(sub.yieldUnit));
    setFormIngredients(synced);
    setRawQtyMap(buildQtyMap(synced));
    setFormProcedure(sub.notes || '');
    setIsIngredientDropdownOpen(false);
    setIngredientSearch('');
    setErrorMsg(null);
    setIsModalOpen(true);
  };

  // Toggle / Add ingredient immediately upon selection (marks it visually)
  const handleDirectSelectIngredient = (val: string) => {
    if (!val) return;

    if (val.startsWith('sub_')) {
      const subId = val.replace('sub_', '');
      const sub = subrecipeMap.get(subId);
      if (!sub) return;
      const unitCost = getLiveIngredientUnitCost('subrecipe', sub.id, sub.costPerGramOrMl ?? 0);
      setFormIngredients((prev) => {
        if (prev.some((p) => p.type === 'subrecipe' && p.id === sub.id)) {
          return prev;
        }
        return [
          ...prev,
          {
            type: 'subrecipe',
            id: sub.id,
            name: `[Subreceta] ${sub.name}`,
            unit: normalizeUnit(sub.yieldUnit),
            quantity: 0,
            costPerBaseUnit: unitCost,
            totalCost: 0,
          },
        ];
      });
    } else {
      const inv = inventoryMap.get(val);
      if (!inv) return;
      const baseCost = getLiveIngredientUnitCost('inventory', inv.id, inv.costPerBaseUnit ?? inv.cost ?? 0);
      setFormIngredients((prev) => {
        if (prev.some((p) => p.type === 'inventory' && p.id === inv.id)) {
          return prev;
        }
        return [
          ...prev,
          {
            type: 'inventory',
            id: inv.id,
            name: inv.name,
            unit: normalizeUnit(inv.unit),
            quantity: 0,
            costPerBaseUnit: baseCost,
            totalCost: 0,
          },
        ];
      });
    }
  };

  const handleToggleIngredientSelection = (type: 'inventory' | 'subrecipe', id: string) => {
    const exists = formIngredients.some((item) => item.type === type && item.id === id);
    if (exists) {
      const key = `${type}_${id}`;
      setRawQtyMap((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setFormIngredients((prev) => prev.filter((item) => !(item.type === type && item.id === id)));
    } else {
      handleDirectSelectIngredient(type === 'subrecipe' ? `sub_${id}` : id);
    }
  };

  const handleUpdateIngredientQtyText = (index: number, rawInput: string) => {
    const normalized = rawInput.replace(',', '.');
    if (normalized !== '' && !/^\d*(\.\d*)?$/.test(normalized)) return;
    const itemTarget = formIngredients[index];
    if (!itemTarget) return;
    const key = `${itemTarget.type}_${itemTarget.id}`;
    setRawQtyMap((prev) => ({ ...prev, [key]: normalized }));

    const parsed = parseFloat(normalized);
    const safeQty = normalized === '' || isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setFormIngredients((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const unitCost = getLiveIngredientUnitCost(item.type, item.id, item.costPerBaseUnit || 0);
        return {
          ...item,
          quantity: safeQty,
          costPerBaseUnit: unitCost,
          totalCost: safeQty * unitCost,
        };
      })
    );
  };

  const handleUpdateIngredientUnit = (index: number, unit: 'Grs.' | 'Ml.' | 'Unds.') => {
    setFormIngredients((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, unit } : item))
    );
  };

  const handleRemoveIngredient = (index: number) => {
    const target = formIngredients[index];
    if (target) {
      const key = `${target.type}_${target.id}`;
      setRawQtyMap((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    setFormIngredients((prev) => prev.filter((_, i) => i !== index));
  };

  // Real-time live Cost calculation (always up to date with inventory & subrecipe unit costs)
  const resolvedFormIngredients: RecipeIngredient[] = useMemo(
    () =>
      formIngredients.map((item) => {
        const liveUnitCost = getLiveIngredientUnitCost(item.type, item.id, item.costPerBaseUnit || 0);
        const qty = Number(item.quantity) || 0;
        return {
          ...item,
          costPerBaseUnit: liveUnitCost,
          totalCost: qty * liveUnitCost,
        };
      }),
    [formIngredients, getLiveIngredientUnitCost]
  );

  const selectedIngredientKeys = useMemo(() => {
    const set = new Set<string>();
    for (const fi of formIngredients) set.add(`${fi.type}_${fi.id}`);
    return set;
  }, [formIngredients]);

  const { totalRealCost, parsedYield, costPerGramOrUnit, suggestedSellingPrice } = useMemo(() => {
    const realCost = resolvedFormIngredients.reduce((sum, i) => sum + (i.totalCost || 0), 0);
    const y = parseFloat(formYield) || 1;
    const perUnit = y > 0 ? realCost / y : 0;
    const suggested = globalFoodCostTarget > 0 ? realCost / (globalFoodCostTarget / 100) : 0;
    return {
      totalRealCost: realCost,
      parsedYield: y,
      costPerGramOrUnit: perUnit,
      suggestedSellingPrice: suggested,
    };
  }, [resolvedFormIngredients, formYield, globalFoodCostTarget]);

  const { filteredDropdownInv, filteredDropdownSub } = useMemo(() => {
    const qIng = debouncedIngredientSearch.trim().toLowerCase();
    return {
      filteredDropdownInv: inventoryItems.filter((inv) => !qIng || inv.name.toLowerCase().includes(qIng)),
      filteredDropdownSub: subrecipes.filter((sub) => !qIng || sub.name.toLowerCase().includes(qIng)),
    };
  }, [inventoryItems, subrecipes, debouncedIngredientSearch]);

  // Submit form (Save / Update)
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanName = formName.trim();
    if (!cleanName) {
      setErrorMsg('El Nombre de la ficha técnica es obligatorio.');
      return;
    }

    const numericYield = parseFloat(formYield);
    if (isNaN(numericYield) || numericYield <= 0) {
      setErrorMsg('El rendimiento del lote debe ser mayor a 0.');
      return;
    }

    if (formIngredients.length === 0) {
      setErrorMsg('Debes agregar al menos un ingrediente al lote.');
      return;
    }

    const zeroQty = resolvedFormIngredients.find((ing) => !ing.quantity || ing.quantity <= 0);
    if (zeroQty) {
      setErrorMsg(`Ingresa una cantidad mayor a 0 para "${zeroQty.name}".`);
      return;
    }

    setIsSubmitting(true);
    try {
      if (formType === 'recipe') {
        const recipeData = {
          name: cleanName,
          category: 'Platos Fuertes',
          portions: Math.max(1, parseInt(formYield, 10) || 1),
          ingredients: resolvedFormIngredients,
          realCost: parseFloat(totalRealCost.toFixed(4)),
          suggestedPrice: parseFloat(suggestedSellingPrice.toFixed(2)),
          targetFoodCostPercentage: globalFoodCostTarget,
          instructions: formProcedure.trim(),
          updatedAt: new Date().toISOString(),
        };

        if (editingTarget && editingTarget.type === 'recipe') {
          await updateDoc(doc(db, 'recipes', editingTarget.id), recipeData);
        } else {
          await addDoc(collection(db, 'recipes'), {
            ...recipeData,
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        // Subrecipe
        const subrecipeData = {
          name: cleanName,
          category: 'Bases y Preparaciones',
          yieldWeight: Math.max(1, numericYield || 1000),
          yieldUnit: formYieldUnit,
          ingredients: resolvedFormIngredients,
          totalCost: parseFloat(totalRealCost.toFixed(4)),
          costPerGramOrMl: parseFloat(costPerGramOrUnit.toFixed(6)),
          notes: formProcedure.trim(),
          updatedAt: new Date().toISOString(),
        };

        if (editingTarget && editingTarget.type === 'subrecipe') {
          await updateDoc(doc(db, 'subrecipes', editingTarget.id), subrecipeData);
        } else {
          await addDoc(collection(db, 'subrecipes'), {
            ...subrecipeData,
            createdAt: new Date().toISOString(),
          });
        }
      }

      setIsModalOpen(false);
      setEditingTarget(null);
    } catch (err: any) {
      console.error('Error al guardar ficha técnica:', err);
      setErrorMsg(err.message || 'No se pudo guardar la ficha técnica.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete
  const handleConfirmDelete = async () => {
    if (!targetToDelete) return;
    setModuleError(null);
    try {
      if (targetToDelete.type === 'recipe') {
        await deleteDoc(doc(db, 'recipes', targetToDelete.id));
      } else {
        await deleteDoc(doc(db, 'subrecipes', targetToDelete.id));
      }
      setTargetToDelete(null);
    } catch (err: any) {
      console.error('Error al eliminar:', err);
      setModuleError('No se pudo eliminar la ficha técnica: ' + (err?.message || 'Error de base de datos'));
    }
  };

  // Filtered lists
  const filteredRecipes = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((r) => r.name.toLowerCase().includes(q));
  }, [recipes, debouncedSearch]);

  const filteredSubrecipes = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return subrecipes;
    return subrecipes.filter((s) => s.name.toLowerCase().includes(q));
  }, [subrecipes, debouncedSearch]);

  return (
    <div className="space-y-6 text-gray-900">
      {/* Top Banner / Actions in Light Theme */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
            <BookOpen className="w-6 h-6 text-[#E89E2D]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Recetas y Subrecetas</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/20">
                Fichas Técnicas
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Cálculo de costo real por insumo, deducción automática de stock y Food Cost %
            </p>
          </div>
        </div>

        {/* Sub-tabs: Recetas, Subrecetas, Food Cost % */}
        <div className="flex items-center gap-2 bg-gray-100 p-1.5 rounded-2xl border border-gray-200">
          <button
            type="button"
            onClick={() => setActiveSubTab('recetas')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeSubTab === 'recetas'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Recetas ({recipes.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('subrecetas')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeSubTab === 'subrecetas'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Subrecetas ({subrecipes.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('configuracion')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeSubTab === 'configuracion'
                ? 'bg-[#E89E2D] text-slate-950 font-black shadow-xs'
                : 'text-amber-800 hover:text-amber-950'
            }`}
          >
            Food Cost ({globalFoodCostTarget}%)
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

      {/* SUB-TAB 1: RECETAS */}
      {activeSubTab === 'recetas' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar receta o ficha técnica..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl pl-10 pr-4 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
              />
            </div>

            {/* Rename "Nueva Receta Madre" to "Nueva Receta" (Requirement 7) */}
            <button
              type="button"
              onClick={() => handleOpenCreate('recipe')}
              className="px-4 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-2 transition-all shadow-xs active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#E89E2D]" />
              + Nueva Receta
            </button>
          </div>

          {filteredRecipes.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-gray-200">
              <ChefHat className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <h3 className="text-base font-bold text-gray-900">No hay recetas registradas</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Toca "+ Nueva Receta" para crear una ficha técnica con ingredientes y rendimiento.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredRecipes.map((r) => {
                const fc = r.targetFoodCostPercentage || globalFoodCostTarget;
                const price = fc > 0 ? (r.realCost || 0) / (fc / 100) : r.suggestedPrice || 0;

                return (
                  <div
                    key={r.id}
                    className="p-5 rounded-3xl bg-white border border-gray-200 hover:border-[#4A5D23] shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/20">
                          Receta / Plato
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditRecipe(r)}
                            className="p-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors cursor-pointer"
                            title="Editar ficha técnica"
                          >
                            <Edit className="w-3.5 h-3.5 text-[#4A5D23]" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTargetToDelete({ type: 'recipe', id: r.id, name: r.name });
                              setDeleteModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-gray-50 hover:bg-rose-50 text-gray-400 hover:text-rose-600 border border-gray-200 transition-colors cursor-pointer"
                            title="Eliminar receta (Requiere clave)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <h4 className="text-base font-black text-gray-900 mb-1">{r.name}</h4>
                      <p className="text-[11px] text-gray-500 mb-3 font-mono">
                        Rendimiento: {r.portions} Porción(es)
                      </p>

                      {/* Ingredients Box */}
                      <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 space-y-1 mb-4 text-xs">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1">
                          Ingredientes ({r.ingredients.length}):
                        </span>
                        {r.ingredients.map((ing, idx) => (
                          <div key={idx} className="flex justify-between text-gray-700 text-[11px]">
                            <span className="truncate max-w-[170px]">{ing.name}</span>
                            <span className="font-mono font-bold">
                              {ing.quantity} {ing.unit} (${ing.totalCost.toFixed(2)})
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Cost breakdown */}
                      <div className="p-3.5 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 space-y-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-gray-700">Costo Real:</span>
                          <span className="font-mono font-black text-sm text-gray-900">
                            ${(r.realCost || 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="pt-1.5 border-t border-[#4A5D23]/20 flex justify-between items-center text-xs">
                          <span className="font-bold text-[#4A5D23]">Precio Sugerido ({fc}% FC):</span>
                          <span className="font-mono font-black text-base text-[#E89E2D]">
                            ${price.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400 mt-4">
                      <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Deducción de stock activa
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: SUBRECETAS */}
      {activeSubTab === 'subrecetas' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar subreceta o preparación..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl pl-10 pr-4 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => handleOpenCreate('subrecipe')}
              className="px-4 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-2 transition-all shadow-xs active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#E89E2D]" />
              + Nueva Subreceta
            </button>
          </div>

          {filteredSubrecipes.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-gray-200">
              <Layers className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <h3 className="text-base font-bold text-gray-900">No hay subrecetas registradas</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Crea preparaciones intermedias (salsas, masas, fondos) para incluirlas en tus recetas madres.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredSubrecipes.map((sub) => (
                <div
                  key={sub.id}
                  className="p-5 rounded-3xl bg-white border border-gray-200 hover:border-[#4A5D23] shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-900 border border-amber-300">
                        Subreceta / Preparación
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEditSubrecipe(sub)}
                          className="p-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors cursor-pointer"
                          title="Editar subreceta"
                        >
                          <Edit className="w-3.5 h-3.5 text-[#4A5D23]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTargetToDelete({ type: 'subrecipe', id: sub.id, name: sub.name });
                            setDeleteModalOpen(true);
                          }}
                          className="p-1.5 rounded-lg bg-gray-50 hover:bg-rose-50 text-gray-400 hover:text-rose-600 border border-gray-200 transition-colors cursor-pointer"
                          title="Eliminar subreceta (Requiere clave)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <h4 className="text-base font-black text-gray-900 mb-1">{sub.name}</h4>
                    <p className="text-[11px] text-gray-500 mb-3 font-mono">
                      Rendimiento: {sub.yieldWeight} {sub.yieldUnit}
                    </p>

                    <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 space-y-1 mb-4 text-xs">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-1">
                        Ingredientes del lote ({sub.ingredients.length}):
                      </span>
                      {sub.ingredients.map((ing, idx) => (
                        <div key={idx} className="flex justify-between text-gray-700 text-[11px]">
                          <span className="truncate max-w-[170px]">{ing.name}</span>
                          <span className="font-mono font-bold">
                            {ing.quantity} {ing.unit}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 space-y-2">
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>Costo Total del Lote:</span>
                        <span className="font-mono font-bold text-gray-900">
                          ${(sub.totalCost || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="pt-1.5 border-t border-gray-200 flex justify-between text-xs">
                        <span className="font-bold text-[#4A5D23]">Costo por {sub.yieldUnit}:</span>
                        <span className="font-mono font-black text-sm text-[#E89E2D]">
                          ${(sub.costPerGramOrMl || 0).toFixed(4)} / {sub.yieldUnit}
                        </span>
                      </div>
                    </div>
                  </div>

                  {sub.notes && (
                    <p className="mt-3 text-[11px] text-gray-500 italic">"{sub.notes}"</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: CONFIGURACIÓN FOOD COST % */}
      {activeSubTab === 'configuracion' && (
        <div className="max-w-xl mx-auto bg-white border border-gray-200 rounded-3xl p-6 sm:p-7 shadow-xs space-y-5">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-200">
            <div className="w-10 h-10 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
              <Percent className="w-5 h-5 text-[#E89E2D]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Food Cost Objetivo</h3>
              <p className="text-xs text-gray-500">
                Porcentaje objetivo para el cálculo del precio de venta sugerido
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">
                Food Cost % General Objetivo
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="10"
                  max="70"
                  placeholder="30"
                  value={foodCostInput}
                  onChange={(e) => setFoodCostInput(e.target.value)}
                  className="w-32 bg-gray-50 border border-gray-200 focus:border-[#4A5D23] rounded-xl px-4 py-2.5 text-lg font-mono font-black text-[#E89E2D] focus:outline-none"
                />
                <span className="text-lg font-bold text-gray-800">%</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-700">Atajos:</span>
              <div className="grid grid-cols-4 gap-2">
                {[25, 28, 30, 35].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setFoodCostInput(String(pct))}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      foodCostInput === String(pct)
                        ? 'bg-[#4A5D23] text-white border-[#4A5D23]'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* UNIFIED MODAL: Nueva ficha técnica (Receta) / Editar ficha técnica */}
      {/* EXACT MATCH FOR SCREENSHOT 1: Screenshot_20261109_081944_40c3596b.jpg */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="w-full max-w-lg bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 relative text-gray-900 max-h-[92vh] flex flex-col">
            {/* Header: Title + Close (X) button */}
            <div className="flex items-center justify-between pb-3.5 border-b border-gray-200 shrink-0 mb-4">
              <h3 className="text-lg font-black text-gray-900 tracking-tight">
                {editingTarget
                  ? (formType === 'recipe' ? 'Editar Receta' : 'Editar ficha técnica (Subreceta)')
                  : (formType === 'recipe' ? 'Nueva Receta' : 'Nueva ficha técnica (Subreceta)')}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 shrink-0">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmitForm} noValidate className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Field 1: Nombre de la ficha técnica * */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Nombre de la ficha técnica <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Ceviche Clásico o Salsa Madre"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3.5 py-2.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none shadow-2xs"
                />
              </div>

              {/* Row 2: Tipo * & Rendimiento del lote * */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">
                    Tipo <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as any)}
                    className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs font-bold text-gray-900 focus:outline-none cursor-pointer shadow-2xs"
                  >
                    <option value="recipe">Receta / plato</option>
                    <option value="subrecipe">Subreceta / preparación</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">
                    Rendimiento del lote <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      placeholder="Ej. 1"
                      value={formYield}
                      onChange={(e) => setFormYield(e.target.value)}
                      className="w-20 bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-900 focus:outline-none shadow-2xs"
                    />
                    <select
                      value={formYieldUnit}
                      onChange={(e) => setFormYieldUnit(e.target.value as any)}
                      className="flex-1 bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-2 py-2 text-xs font-bold text-gray-900 focus:outline-none cursor-pointer shadow-2xs"
                    >
                      <option value="Unds.">Unds.</option>
                      <option value="Grs.">Grs.</option>
                      <option value="Ml.">Ml.</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section: Ingredientes del lote (Exact match with Screenshot 1) */}
              <div className="pt-2 border-t border-gray-100">
                <div className="mb-2">
                  <h4 className="text-xs font-bold text-gray-900">Ingredientes del lote</h4>
                  <p className="text-[11px] text-gray-400">
                    Unidad automática del inventario o de la subreceta
                  </p>
                </div>

                {/* Custom Dropdown selector with immediate Verde Oliva (#4A5D23) checkbox */}
                <div className="mb-3 relative">
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                    Seleccionar insumo o subreceta (se marca y agrega automáticamente):
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsIngredientDropdownOpen((prev) => !prev)}
                    className={`w-full bg-white border rounded-xl px-3.5 py-2.5 text-xs flex items-center justify-between transition-all cursor-pointer shadow-2xs ${
                      isIngredientDropdownOpen
                        ? 'border-[#4A5D23] ring-2 ring-[#4A5D23]/15'
                        : 'border-gray-200 hover:border-[#4A5D23]'
                    }`}
                  >
                    <span
                      className={
                        resolvedFormIngredients.length > 0
                          ? 'font-bold text-[#4A5D23]'
                          : 'font-semibold text-gray-700'
                      }
                    >
                      {resolvedFormIngredients.length > 0
                        ? `-- ${resolvedFormIngredients.length} insumo(s) o subreceta(s) seleccionados --`
                        : '-- Elige un insumo o subreceta --'}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-500 transition-transform ${
                        isIngredientDropdownOpen ? 'rotate-180 text-[#4A5D23]' : ''
                      }`}
                    />
                  </button>

                  {isIngredientDropdownOpen && (
                    <div className="mt-1.5 bg-white border border-[#4A5D23]/40 rounded-2xl shadow-xl overflow-hidden z-30">
                      <div className="p-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            placeholder="Buscar insumo o subreceta..."
                            value={ingredientSearch}
                            onChange={(e) => setIngredientSearch(e.target.value)}
                            className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsIngredientDropdownOpen(false)}
                          className="px-3 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-[11px] font-bold cursor-pointer shrink-0"
                        >
                          Listo
                        </button>
                      </div>

                      <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
                        {filteredDropdownInv.length === 0 && filteredDropdownSub.length === 0 ? (
                          <div className="p-4 text-center text-xs text-gray-500">
                            No se encontraron insumos o subrecetas con &quot;{ingredientSearch}&quot;.
                          </div>
                        ) : (
                          <>
                            {filteredDropdownInv.length > 0 && (
                              <div>
                                <div className="px-3 py-1.5 bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                  Insumos de Inventario
                                </div>
                                {filteredDropdownInv.map((inv) => {
                                  const isSelected = selectedIngredientKeys.has(`inventory_${inv.id}`);
                                  const u = normalizeUnit(inv.unit);
                                  const liveCost = getLiveIngredientUnitCost(
                                    'inventory',
                                    inv.id,
                                    inv.costPerBaseUnit ?? inv.cost ?? 0
                                  );
                                  return (
                                    <button
                                      key={`dd_inv_${inv.id}`}
                                      type="button"
                                      onClick={() => handleToggleIngredientSelection('inventory', inv.id)}
                                      className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                                        isSelected ? 'bg-[#EAF5F0]' : 'hover:bg-gray-50'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        <span
                                          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                                            isSelected
                                              ? 'bg-[#4A5D23] border-[#4A5D23] text-white shadow-2xs'
                                              : 'bg-white border-gray-300 text-transparent'
                                          }`}
                                        >
                                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                                        </span>
                                        <div className="min-w-0">
                                          <span
                                            className={`text-xs block truncate ${
                                              isSelected ? 'font-bold text-[#4A5D23]' : 'font-semibold text-gray-800'
                                            }`}
                                          >
                                            {inv.name} ({u})
                                          </span>
                                          <span className="text-[10px] text-gray-500 font-mono">
                                            Unit: ${liveCost.toFixed(4)} / {u}
                                          </span>
                                        </div>
                                      </div>
                                      {isSelected && (
                                        <span className="text-[10px] font-bold text-[#4A5D23] shrink-0">
                                          Agregado
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {filteredDropdownSub.length > 0 && (
                              <div>
                                <div className="px-3 py-1.5 bg-amber-50/70 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                                  Subrecetas Disponibles
                                </div>
                                {filteredDropdownSub.map((sub) => {
                                  const isSelected = selectedIngredientKeys.has(`subrecipe_${sub.id}`);
                                  const u = normalizeUnit(sub.yieldUnit);
                                  const liveCost = getLiveIngredientUnitCost(
                                    'subrecipe',
                                    sub.id,
                                    sub.costPerGramOrMl ?? 0
                                  );
                                    return (
                                      <button
                                        key={`dd_sub_${sub.id}`}
                                        type="button"
                                        onClick={() => handleToggleIngredientSelection('subrecipe', sub.id)}
                                        className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                                          isSelected ? 'bg-[#EAF5F0]' : 'hover:bg-gray-50'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                          <span
                                            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                                              isSelected
                                                ? 'bg-[#4A5D23] border-[#4A5D23] text-white shadow-2xs'
                                                : 'bg-white border-gray-300 text-transparent'
                                            }`}
                                          >
                                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                                          </span>
                                          <div className="min-w-0">
                                            <span
                                              className={`text-xs block truncate ${
                                                isSelected ? 'font-bold text-[#4A5D23]' : 'font-semibold text-gray-800'
                                              }`}
                                            >
                                              {sub.name} ({u})
                                            </span>
                                            <span className="text-[10px] text-gray-500 font-mono">
                                              Unit: ${liveCost.toFixed(4)} / {u}
                                            </span>
                                          </div>
                                        </div>
                                        {isSelected && (
                                          <span className="text-[10px] font-bold text-[#4A5D23] shrink-0">
                                            Agregado
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              </>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Ingredients rows */}
                <div className="space-y-2 mb-3">
                  {resolvedFormIngredients.map((item, index) => (
                    <div
                      key={`${item.type}_${item.id}_${index}`}
                      className="p-3 rounded-2xl bg-[#EAF5F0]/60 border border-[#4A5D23]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-5 h-5 rounded-md bg-[#4A5D23] border border-[#4A5D23] text-white flex items-center justify-center shrink-0 shadow-2xs"
                            title="Insumo marcado y agregado"
                          >
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </span>
                          <span className="font-bold text-gray-900 block truncate">{item.name}</span>
                        </div>
                        <div className="text-[10px] text-gray-600 font-mono pl-7">
                          <span>Unit: ${(item.costPerBaseUnit || 0).toFixed(4)} / {item.unit}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Cantidad input */}
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={
                            rawQtyMap[`${item.type}_${item.id}`] !== undefined
                              ? rawQtyMap[`${item.type}_${item.id}`]
                              : item.quantity === 0
                              ? ''
                              : String(item.quantity)
                          }
                          onChange={(e) => handleUpdateIngredientQtyText(index, e.target.value)}
                          className="w-24 sm:w-28 bg-white border border-gray-200 rounded-xl px-3 py-1.5 text-right font-mono font-bold text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                        />

                        {/* Unidad selector */}
                        <select
                          value={item.unit}
                          onChange={(e) => handleUpdateIngredientUnit(index, e.target.value as any)}
                          className="bg-white border border-gray-200 rounded-xl px-2 py-1.5 text-xs font-bold text-gray-900 focus:outline-none cursor-pointer"
                        >
                          <option value="Grs.">Grs.</option>
                          <option value="Ml.">Ml.</option>
                          <option value="Unds.">Unds.</option>
                        </select>

                        {/* Trash icon */}
                        <button
                          type="button"
                          onClick={() => handleRemoveIngredient(index)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Procedimiento Textarea (Screenshot 1) */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Procedimiento
                </label>
                <textarea
                  rows={3}
                  placeholder="Escribe el método de preparación, tiempos de cocción, temperaturas y emplatado..."
                  value={formProcedure}
                  onChange={(e) => setFormProcedure(e.target.value)}
                  className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl p-3 text-xs text-gray-900 placeholder-gray-400 focus:outline-none shadow-2xs resize-none"
                />
              </div>

              {/* Total real cost preview */}
              <div className="p-3.5 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-[#4A5D23] block">Costo Real Calculado:</span>
                  <span className="text-[10px] text-gray-500">
                    Suma automática de {resolvedFormIngredients.length} insumo(s)
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-mono font-black text-base text-[#D97706]">
                    ${totalRealCost > 0 && totalRealCost < 0.01 ? totalRealCost.toFixed(4) : totalRealCost.toFixed(2)}
                  </div>
                  {formType === 'recipe' ? (
                    <div className="text-[10px] font-mono text-[#4A5D23] font-bold">
                      P. Sugerido ({globalFoodCostTarget}% FC): ${suggestedSellingPrice.toFixed(2)}
                    </div>
                  ) : (
                    parsedYield > 0 && totalRealCost > 0 && (
                      <div className="text-[10px] font-mono text-[#4A5D23] font-bold">
                        ${costPerGramOrUnit.toFixed(4)} / {formYieldUnit}
                      </div>
                    )
                  )}
                </div>
              </div>

              {/* Modal Bottom Actions */}
              <div className="pt-3 border-t border-gray-200 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Guardando...' : editingTarget ? 'Guardar Cambios' : 'Crear Ficha Técnica'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Auth Modal */}
      <DeleteAuthModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setTargetToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Eliminar Ficha Técnica"
        itemDescription={targetToDelete ? `la ficha de "${targetToDelete.name}"` : 'esta receta'}
      />
    </div>
  );
};
