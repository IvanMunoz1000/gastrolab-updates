import {
  collection,
  doc,
  writeBatch,
  WriteBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { belongsToBranch, normalizeBranchName } from '../context/BranchContext';
import { commitOfflineSafe, getDocsOfflineSafe } from './offlineFirestore';
import { OrderItem, Recipe, Subrecipe, InventoryItem, Product } from '../types';

/**
 * Normalizes unit quantities when recipe/component unit differs from inventory unit.
 */
function convertQtyToInventoryUnit(qty: number, sourceUnit?: string, targetUnit?: string): number {
  const s = (sourceUnit || '').toLowerCase();
  const t = (targetUnit || '').toLowerCase();

  const isSourceSmall = s === 'g' || s === 'grs.' || s === 'gramos' || s === 'ml' || s === 'ml.' || s === 'litros_ml';
  const isSourceLarge = s === 'kg' || s === 'lt';
  const isTargetSmall = t === 'g' || t === 'grs.' || t === 'ml' || t === 'ml.';
  const isTargetLarge = t === 'kg' || t === 'lt';

  if (isSourceSmall && isTargetLarge) return qty / 1000;
  if (isSourceLarge && isTargetSmall) return qty * 1000;
  return qty;
}

/**
 * Helper to execute a list of batch-mutator functions safely in <= 400-op chunks.
 */
async function commitBatchedOps(ops: Array<(batch: WriteBatch) => void>): Promise<void> {
  if (ops.length === 0) return;
  const CHUNK_SIZE = 400;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const slice = ops.slice(i, i + CHUNK_SIZE);
    for (const apply of slice) {
      apply(batch);
    }
    await commitOfflineSafe(batch.commit(), 'recipe_inventory_deduction');
  }
}

/**
 * Deducts raw ingredients, subrecipes, and linked recipe components from inventory when items are sold in POS.
 * Accumulates stock deltas in memory and commits all inventory updates + kardex entries via atomic batches.
 */
export async function deductRecipeIngredientsFromInventory(
  orderItems: OrderItem[],
  tableNumber: number | string,
  branch: string = 'Matriz'
): Promise<{ success: boolean; deductedCount: number; message: string }> {
  try {
    const now = new Date().toISOString();
    const activeBranch = normalizeBranchName(branch);

    const [productsSnap, recipesSnap, subrecipesSnap, inventorySnap] = await Promise.all([
      getDocsOfflineSafe(collection(db, 'products')),
      getDocsOfflineSafe(collection(db, 'recipes')),
      getDocsOfflineSafe(collection(db, 'subrecipes')),
      getDocsOfflineSafe(collection(db, 'inventory')),
    ]);

    const productsMap = new Map<string, Product>();
    productsSnap.forEach((d) => productsMap.set(d.id, { id: d.id, ...d.data() } as Product));

    const recipes: Recipe[] = [];
    const recipesMap = new Map<string, Recipe>();
    recipesSnap.forEach((d) => {
      const r = { id: d.id, ...d.data() } as Recipe;
      recipes.push(r);
      recipesMap.set(d.id, r);
    });

    const subrecipesMap = new Map<string, Subrecipe>();
    subrecipesSnap.forEach((d) =>
      subrecipesMap.set(d.id, { id: d.id, ...d.data() } as Subrecipe)
    );

    const inventoryMap = new Map<string, InventoryItem>();
    inventorySnap.forEach((d) => {
      const data = d.data() as Omit<InventoryItem, 'id'>;
      if (belongsToBranch(data.branch, activeBranch)) {
        inventoryMap.set(d.id, { id: d.id, ...data } as InventoryItem);
      }
    });

    const pendingStockUpdates = new Map<string, number>();
    const ops: Array<(batch: WriteBatch) => void> = [];
    let totalDeductions = 0;

    const queueInventoryDeduction = (
      invId: string,
      rawQty: number,
      sourceUnit: string | undefined,
      reference: string
    ) => {
      const invItem = inventoryMap.get(invId);
      if (!invItem || !Number.isFinite(rawQty) || rawQty <= 0) return;

      const deductQty = convertQtyToInventoryUnit(rawQty, sourceUnit, invItem.unit);
      if (!Number.isFinite(deductQty) || deductQty <= 0) return;

      const currentStock = Number(invItem.currentStock) || 0;
      const newStock = Math.max(0, currentStock - deductQty);
      const unitCost = Number(invItem.costPerBaseUnit ?? invItem.cost ?? 0);

      invItem.currentStock = newStock;
      pendingStockUpdates.set(invItem.id, newStock);

      const kardexRef = doc(collection(db, 'kardex'));
      const kardexPayload = {
        itemId: invItem.id,
        itemName: invItem.name,
        movementType: 'Salida' as const,
        quantity: parseFloat(deductQty.toFixed(4)),
        unit: invItem.unit,
        unitCost,
        totalCost: parseFloat((deductQty * unitCost).toFixed(4)),
        balanceStock: parseFloat(newStock.toFixed(4)),
        reference,
        branch: activeBranch,
        createdAt: now,
      };
      ops.push((batch) => batch.set(kardexRef, kardexPayload));
      totalDeductions++;
    };

    const deductSubrecipe = (subId: string, usedQty: number, contextLabel: string) => {
      const subrecipe = subrecipesMap.get(subId);
      if (!subrecipe || !subrecipe.ingredients || usedQty <= 0) return;

      const subrecipeYield = subrecipe.yieldWeight || 1000;
      const proportion = usedQty / subrecipeYield;

      for (const subIng of subrecipe.ingredients) {
        queueInventoryDeduction(
          subIng.id,
          (subIng.quantity || 0) * proportion,
          subIng.unit,
          `Venta POS Subreceta (${subrecipe.name}) en ${contextLabel} - ${tableNumber === 'DOMICILIO' ? 'DOMICILIO' : `Mesa ${tableNumber}`}`
        );
      }
    };

    const deductRecipe = (recipe: Recipe, orderQty: number, dishName: string) => {
      if (!recipe.ingredients) return;
      const recipePortions = recipe.portions && recipe.portions > 0 ? recipe.portions : 1;
      const batchFactor = orderQty / recipePortions;

      for (const ing of recipe.ingredients) {
        if (ing.type === 'inventory') {
          queueInventoryDeduction(
            ing.id,
            (ing.quantity || 0) * batchFactor,
            ing.unit,
            `Venta POS Receta: ${recipe.name} (${dishName} x${orderQty}) - ${tableNumber === 'DOMICILIO' ? 'DOMICILIO' : `Mesa ${tableNumber}`}`
          );
        } else if (ing.type === 'subrecipe') {
          deductSubrecipe(
            ing.id,
            (ing.quantity || 0) * batchFactor,
            `${recipe.name} (${dishName})`
          );
        }
      }
    };

    const deductSingleProduct = (
      productId: string,
      productName: string,
      orderQty: number,
      contextPrefix: string,
      visitedIds: Set<string>
    ) => {
      if (orderQty <= 0 || visitedIds.has(productId)) return;
      const nextVisited = new Set(visitedIds);
      nextVisited.add(productId);

      const product = productsMap.get(productId);
      const label = contextPrefix ? `${contextPrefix} → ${productName}` : productName;

      // 0. If this product is a Combo, deduct all included menu products recursively
      if (product?.isCombo && Array.isArray(product.comboItems) && product.comboItems.length > 0) {
        for (const comboChild of product.comboItems) {
          const childQty = (comboChild.quantity || 1) * orderQty;
          deductSingleProduct(
            comboChild.productId,
            comboChild.name,
            childQty,
            `Combo ${product.name}`,
            nextVisited
          );
        }
      }

      // 1. Prefer multi-component links defined on the product
      if (product?.linkedComponents && product.linkedComponents.length > 0) {
        for (const comp of product.linkedComponents) {
          const compQty = (comp.quantity || 1) * orderQty;
          if (comp.type === 'ingrediente') {
            queueInventoryDeduction(
              comp.id,
              compQty,
              comp.unit,
              `Venta POS ${label} (x${orderQty}) - ${tableNumber === 'DOMICILIO' ? 'DOMICILIO' : `Mesa ${tableNumber}`}`
            );
          } else if (comp.type === 'subreceta') {
            deductSubrecipe(comp.id, compQty, label);
          } else if (comp.type === 'receta') {
            const rec = recipesMap.get(comp.id);
            if (rec) {
              deductRecipe(rec, compQty, label);
            }
          }
        }
        return;
      }

      // 2. Fallback: legacy single linkedRecipeId or name/productId match
      let matchingRecipe: Recipe | undefined;
      if (product?.linkedRecipeId) {
        matchingRecipe = recipesMap.get(product.linkedRecipeId);
        if (!matchingRecipe && product.linkedRecipeType === 'subreceta') {
          deductSubrecipe(product.linkedRecipeId, orderQty, label);
          return;
        }
      }

      if (!matchingRecipe) {
        const cleanProdName = (productName || '').trim().toLowerCase();
        matchingRecipe = recipes.find(
          (r) =>
            r.productId === productId ||
            (r.name || '').trim().toLowerCase() === cleanProdName
        );
      }

      if (matchingRecipe) {
        deductRecipe(matchingRecipe, orderQty, label);
      }
    };

    for (const item of orderItems) {
      const orderQty = Number(item.quantity) || 1;
      deductSingleProduct(item.productId, item.name, orderQty, '', new Set<string>());
    }

    pendingStockUpdates.forEach((finalStock, invId) => {
      const invRef = doc(db, 'inventory', invId);
      ops.push((batch) =>
        batch.update(invRef, {
          currentStock: parseFloat(finalStock.toFixed(4)),
          updatedAt: now,
        })
      );
    });

    await commitBatchedOps(ops);

    return {
      success: true,
      deductedCount: totalDeductions,
      message: `Se descontaron los ingredientes de las recetas vendidas del inventario (${totalDeductions} movimientos).`,
    };
  } catch (error: any) {
    console.error('Error al descontar insumos de recetas en inventario:', error);
    return {
      success: false,
      deductedCount: 0,
      message: error.message || 'Error en la deducción de recetas.',
    };
  }
}

/**
 * Automatically deducts packaging and disposable supplies when a DOMICILIO order is paid.
 * Commits all creations/updates/kardex entries atomically in a single Firestore batch.
 */
export async function deductDeliverySuppliesFromInventory(
  orderItems: OrderItem[],
  branch: string = 'Matriz'
): Promise<{ success: boolean; message: string; deductedItems: string[] }> {
  try {
    const now = new Date().toISOString();
    const activeBranch = normalizeBranchName(branch);
    const inventorySnap = await getDocsOfflineSafe(collection(db, 'inventory'));
    const inventoryList: (InventoryItem & { id: string })[] = [];
    inventorySnap.forEach((d) => {
      const data = d.data() as Omit<InventoryItem, 'id'>;
      if (belongsToBranch(data.branch, activeBranch)) {
        inventoryList.push({ id: d.id, ...data } as any);
      }
    });

    const totalItemQty = orderItems.reduce((acc, curr) => acc + (Number(curr.quantity) || 1), 0);

    let medContainers = 0;
    let smallContainers = 0;

    if (totalItemQty <= 1) {
      smallContainers = 1;
    } else if (totalItemQty <= 3) {
      medContainers = 1;
    } else if (totalItemQty === 4) {
      medContainers = 1;
      smallContainers = 1;
    } else {
      medContainers = Math.floor(totalItemQty / 3);
      const remainder = totalItemQty % 3;
      if (remainder > 0) {
        smallContainers = 1;
      }
    }

    const suppliesToDeduct: { namePattern: RegExp; fallbackName: string; qty: number; defaultCost: number }[] = [
      { namePattern: /servilleta/i, fallbackName: 'Servilletas', qty: 1, defaultCost: 0.02 },
      { namePattern: /palillo/i, fallbackName: 'Par de Palillos', qty: 1, defaultCost: 0.05 },
      { namePattern: /cubierto/i, fallbackName: 'Par de Cubiertos', qty: 1, defaultCost: 0.08 },
      { namePattern: /caramelo/i, fallbackName: 'Caramelos', qty: 1, defaultCost: 0.03 },
      { namePattern: /funda/i, fallbackName: 'Fundas para Domicilio', qty: 1, defaultCost: 0.1 },
    ];

    if (medContainers > 0) {
      suppliesToDeduct.push({
        namePattern: /contenedor.*mediano|tarrina.*mediana/i,
        fallbackName: 'Contenedor Mediano',
        qty: medContainers,
        defaultCost: 0.25,
      });
    }

    if (smallContainers > 0) {
      suppliesToDeduct.push({
        namePattern: /contenedor.*pequeñ|contenedor.*pequeno|tarrina.*pequeñ/i,
        fallbackName: 'Contenedor Pequeño',
        qty: smallContainers,
        defaultCost: 0.18,
      });
    }

    const deductedSummary: string[] = [];
    const ops: Array<(batch: WriteBatch) => void> = [];

    for (const supply of suppliesToDeduct) {
      let targetInv = inventoryList.find((item) => supply.namePattern.test(item.name || ''));
      const newDocRef = !targetInv ? doc(collection(db, 'inventory')) : null;

      if (!targetInv && newDocRef) {
        const newStock = Math.max(0, 100 - supply.qty);
        const createdItem = {
          name: supply.fallbackName,
          category: 'Desechables',
          unit: 'Unds.' as const,
          currentStock: newStock,
          minStock: 20,
          cost: supply.defaultCost,
          costPerBaseUnit: supply.defaultCost,
          hasPendingWaste: false,
          branch: activeBranch,
          createdAt: now,
          updatedAt: now,
        };
        const createdInventoryDoc: InventoryItem & { id: string } = {
          id: newDocRef.id,
          ...createdItem,
        };
        ops.push((batch) => batch.set(newDocRef, createdItem));
        targetInv = createdInventoryDoc;
        inventoryList.push(createdInventoryDoc);
      } else if (targetInv) {
        const currentStock = Number(targetInv.currentStock) || 0;
        const newStock = Math.max(0, currentStock - supply.qty);
        const targetId = targetInv.id;
        targetInv.currentStock = newStock;
        ops.push((batch) =>
          batch.update(doc(db, 'inventory', targetId), {
            currentStock: newStock,
            updatedAt: now,
          })
        );
      }

      if (!targetInv) continue;

      const unitCost = Number(targetInv.costPerBaseUnit ?? targetInv.cost ?? supply.defaultCost);
      const balanceStock = Number(targetInv.currentStock) || 0;
      const kardexRef = doc(collection(db, 'kardex'));
      const kardexPayload = {
        itemId: targetInv.id,
        itemName: targetInv.name,
        movementType: 'Salida' as const,
        quantity: supply.qty,
        unit: 'Unds.',
        unitCost,
        totalCost: parseFloat((supply.qty * unitCost).toFixed(4)),
        balanceStock,
        reference: `Venta Domicilio: Empaque y Desechables (${supply.qty}x ${targetInv.name})`,
        branch: activeBranch,
        createdAt: now,
      };
      ops.push((batch) => batch.set(kardexRef, kardexPayload));
      deductedSummary.push(`${supply.qty}x ${targetInv.name}`);
    }

    await commitBatchedOps(ops);

    return {
      success: true,
      message: `Insumos de Domicilio descontados del inventario: ${deductedSummary.join(', ')}`,
      deductedItems: deductedSummary,
    };
  } catch (err: any) {
    console.error('Error al descontar insumos de empaque de domicilio:', err);
    return {
      success: false,
      message: err.message || 'Error al descontar empaques de domicilio.',
      deductedItems: [],
    };
  }
}

