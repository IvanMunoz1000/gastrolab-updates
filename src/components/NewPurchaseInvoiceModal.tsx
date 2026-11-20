import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe, getDocsOfflineSafe } from '../utils/offlineFirestore';
import { InventoryItem, PurchaseItem, InventoryUnit } from '../types';
import {
  X,
  FileText,
  Building2,
  Calendar,
  Plus,
  Trash2,
  AlertOctagon,
  CheckCircle2,
  Calculator,
  AlertTriangle,
  Search,
  Sparkles,
  PackagePlus,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

interface InvoiceRow {
  id: string;
  itemId: string;
  itemName: string;
  unit: InventoryUnit;
  quantity: string;
  totalCost: string;
  expiryDate: string;
  showExpiryInput?: boolean;
  hasWaste: boolean;
  isNewlyCreated?: boolean;
}

const createEmptyRow = (idSuffix = Date.now().toString()): InvoiceRow => ({
  id: `row-${idSuffix}`,
  itemId: '',
  itemName: '',
  unit: 'Grs.',
  quantity: '',
  totalCost: '',
  expiryDate: '',
  showExpiryInput: false,
  hasWaste: false,
  isNewlyCreated: false,
});

const normalizeSearch = (val: string) =>
  val
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const formatUnitCost = (n: number): string => {
  if (!isFinite(n) || n <= 0) return '0.00';
  if (n >= 1) return parseFloat(n.toFixed(4)).toString();
  if (n >= 0.01) return parseFloat(n.toFixed(4)).toString();
  return parseFloat(n.toFixed(6)).toString();
};

export const NewPurchaseInvoiceModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const { activeBranch } = useBranch();
  const [provider, setProvider] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [inventoryList, setInventoryList] = useState<InventoryItem[]>([]);
  const [supplierList, setSupplierList] = useState<{ id: string; name: string; category?: string }[]>([]);
  const [rows, setRows] = useState<InvoiceRow[]>([createEmptyRow('1')]);
  const [activeDropdownRowId, setActiveDropdownRowId] = useState<string | null>(null);
  const [creatingRowId, setCreatingRowId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [duplicateAlert, setDuplicateAlert] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const duplicateAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (duplicateAlertTimerRef.current) clearTimeout(duplicateAlertTimerRef.current);
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    // Reset clean form state when modal opens
    setProvider('');
    setSupplierList([]);
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setRows([createEmptyRow('1')]);
    setActiveDropdownRowId(null);
    setErrorMsg(null);
    setDuplicateAlert(null);

    const fetchSuppliers = async () => {
      try {
        const snap = await getDocsOfflineSafe(collection(db, 'suppliers'));
        const sups: { id: string; name: string; category?: string }[] = [];
        snap.forEach((d) => {
          const data = d.data();
          if (data.name) sups.push({ id: d.id, name: data.name, category: data.category });
        });

        setSupplierList(sups);
      } catch (err) {
        console.error('Error al cargar proveedores:', err);
      }
    };

    const fetchInventory = async () => {
      try {
        const snap = await getDocsOfflineSafe(collection(db, 'inventory'));
        const items: InventoryItem[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<InventoryItem, 'id'>;
          if (belongsToBranch(data.branch, activeBranch)) {
            items.push({ id: d.id, ...data });
          }
        });
        items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setInventoryList(items);
      } catch (err) {
        console.error('Error al cargar inventario:', err);
      }
    };

    fetchSuppliers();
    fetchInventory();
  }, [isOpen, activeBranch]);

  const inventoryMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    inventoryList.forEach((item) => map.set(item.id, item));
    return map;
  }, [inventoryList]);

  const invoiceTotal = useMemo(
    () => rows.reduce((acc, r) => acc + (parseFloat(r.totalCost) || 0), 0),
    [rows]
  );

  if (!isOpen) return null;

  const normalizeUnit = (u?: string): InventoryUnit => {
    if (!u) return 'Grs.';
    const low = u.toLowerCase();
    if (low === 'kg' || low === 'grs.' || low === 'g' || low === 'gramos') return 'Grs.';
    if (low === 'lt' || low === 'ml.' || low === 'ml' || low === 'litros') return 'Ml.';
    return 'Unds.';
  };

  const triggerDuplicateAlert = (msg: string) => {
    setDuplicateAlert(msg);
    if (duplicateAlertTimerRef.current) clearTimeout(duplicateAlertTimerRef.current);
    duplicateAlertTimerRef.current = setTimeout(() => {
      setDuplicateAlert((curr) => (curr === msg ? null : curr));
    }, 6000);
  };

  // Select an existing inventory product for a row, strictly blocking duplicates (merging qty/cost if entered)
  const handleSelectInventoryItem = (rowId: string, item: InventoryItem) => {
    setErrorMsg(null);

    const existingOtherRowIndex = rows.findIndex(
      (r) => r.id !== rowId && r.itemId && r.itemId === item.id
    );

    if (existingOtherRowIndex !== -1) {
      const currentRow = rows.find((r) => r.id === rowId);
      const addQty = parseFloat(currentRow?.quantity || '') || 0;
      const addCost = parseFloat(currentRow?.totalCost || '') || 0;

      setRows((prev) => {
        const updated = prev.map((r, idx) => {
          if (idx !== existingOtherRowIndex) return r;
          const prevQty = parseFloat(r.quantity) || 0;
          const prevCost = parseFloat(r.totalCost) || 0;
          const nextQty = prevQty + addQty;
          const nextCost = prevCost + addCost;
          return {
            ...r,
            quantity: nextQty > 0 ? String(Number(nextQty.toFixed(4))) : r.quantity,
            totalCost: nextCost > 0 ? String(Number(nextCost.toFixed(4))) : r.totalCost,
          };
        });
        // Remove the duplicate row if there are multiple rows
        return updated.length > 1 ? updated.filter((r) => r.id !== rowId) : updated;
      });

      setActiveDropdownRowId(null);
      triggerDuplicateAlert(
        addQty > 0 || addCost > 0
          ? `"${item.name}" ya estaba en la Línea #${existingOtherRowIndex + 1}. No se permiten duplicados; se sumaron cantidad y precio a esa fila.`
          : `"${item.name}" ya está agregado en la Línea #${existingOtherRowIndex + 1}. No se permiten productos duplicados en la misma factura.`
      );
      return;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              itemId: item.id,
              itemName: item.name,
              unit: normalizeUnit(item.unit),
              isNewlyCreated: false,
            }
          : r
      )
    );
    setActiveDropdownRowId(null);
  };

  // Manual typing inside Producto search input
  const handleProductNameInput = (rowId: string, text: string) => {
    setErrorMsg(null);
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        // Clear linked itemId if user edits the selected name away
        const linkedItem = r.itemId ? inventoryMap.get(r.itemId) : undefined;
        const stillMatchesLinked =
          linkedItem && normalizeSearch(linkedItem.name) === normalizeSearch(text);
        return {
          ...r,
          itemName: text,
          itemId: stillMatchesLinked ? r.itemId : '',
          isNewlyCreated: stillMatchesLinked ? r.isNewlyCreated : false,
        };
      })
    );
    setActiveDropdownRowId(rowId);
  };

  // Instant creation of missing product directly into Firestore Inventory without leaving screen
  const handleCreateNewInventoryProduct = async (row: InvoiceRow) => {
    const cleanName = row.itemName.trim();
    if (!cleanName) return;

    // Guard: if an existing product matches exact name, select it instead of creating a duplicate in inventory
    const exactExisting = inventoryList.find(
      (i) => normalizeSearch(i.name) === normalizeSearch(cleanName)
    );
    if (exactExisting) {
      handleSelectInventoryItem(row.id, exactExisting);
      return;
    }

    setCreatingRowId(row.id);
    setErrorMsg(null);
    try {
      const now = new Date().toISOString();
      const newInvPayload = {
        name: cleanName,
        unit: row.unit || 'Grs.',
        currentStock: 0,
        minStock: 0,
        totalCost: 0,
        cost: 0,
        costPerBaseUnit: 0,
        hasPendingWaste: row.hasWaste,
        pendingWasteQty: 0,
        category: 'General',
        expiryDate: row.expiryDate || '',
        branch: activeBranch,
        createdAt: now,
        updatedAt: now,
      };

      const createdRef = doc(collection(db, 'inventory'));
      await commitOfflineSafe(setDoc(createdRef, newInvPayload), 'create_purchase_inventory_item');
      const createdItem: InventoryItem = {
        id: createdRef.id,
        ...newInvPayload,
      };

      setInventoryList((prev) =>
        [...prev, createdItem].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      );

      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                itemId: createdRef.id,
                itemName: cleanName,
                isNewlyCreated: true,
              }
            : r
        )
      );
      setActiveDropdownRowId(null);
    } catch (err: any) {
      console.error('Error al crear producto en inventario:', err);
      setErrorMsg(err.message || 'No se pudo crear el producto en Inventario.');
    } finally {
      setCreatingRowId(null);
    }
  };

  const handleRowChange = (rowId: string, field: keyof InvoiceRow, value: any) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r))
    );
  };

  const addRow = () => {
    const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setRows((prev) => [...prev, createEmptyRow(newId)]);
  };

  const removeRow = (rowId: string) => {
    if (rows.length === 1) return;
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || isSubmitting) return;
    setErrorMsg(null);
    setDuplicateAlert(null);

    if (!provider) {
      setErrorMsg('Por favor selecciona un Proveedor.');
      return;
    }

    if (!invoiceDate) {
      setErrorMsg('Por favor selecciona la Fecha de Emisión.');
      return;
    }

    // Check if any row has typed a product name that hasn't been selected or created yet
    const unlinkedRow = rows.find((r) => r.itemName.trim().length > 0 && !r.itemId);
    if (unlinkedRow) {
      setErrorMsg(
        `El producto "${unlinkedRow.itemName}" aún no ha sido seleccionado o creado en Inventario. Haz clic en "+ Crear nuevo producto en Inventario" o elígelo de la lista.`
      );
      return;
    }

    const validRows = rows.filter((r) => {
      const q = parseFloat(r.quantity);
      const c = parseFloat(r.totalCost);
      return r.itemId && !isNaN(q) && q > 0 && !isNaN(c) && c > 0;
    });

    if (validRows.length === 0) {
      setErrorMsg('Debes ingresar al menos un producto con cantidad y precio total válidos.');
      return;
    }

    // Final duplicate safeguard
    const seenIds = new Set<string>();
    for (const r of validRows) {
      if (seenIds.has(r.itemId)) {
        setErrorMsg(
          `El producto "${r.itemName}" aparece duplicado en la factura. Combina las líneas antes de guardar.`
        );
        return;
      }
      seenIds.add(r.itemId);
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const purchaseItems: PurchaseItem[] = validRows.map((r) => {
        const q = parseFloat(r.quantity);
        const c = parseFloat(r.totalCost);
        const exactUnitCost = c / q;
        return {
          itemId: r.itemId,
          name: r.itemName,
          productName: r.itemName,
          unit: r.unit,
          quantity: q,
          totalCost: c,
          unitCost: exactUnitCost,
          costPerUnit: exactUnitCost,
          expiryDate: r.expiryDate || '',
          hasWaste: r.hasWaste,
          wasteStatus: r.hasWaste ? 'pending' : 'processed',
        };
      });

      const hasAnyWaste = purchaseItems.some((i) => i.hasWaste);
      const invoiceData = {
        provider,
        invoiceNumber: invoiceNumber.trim() || `FAC-${Date.now().toString().slice(-6)}`,
        date: invoiceDate,
        totalAmount: invoiceTotal,
        items: purchaseItems,
        hasWaste: hasAnyWaste,
        wasteStatus: hasAnyWaste ? 'pending' : 'none',
        branch: activeBranch,
        createdAt: now,
      };

      const purchaseDocRef = doc(collection(db, 'purchases'));
      const isOnline = typeof navigator === 'undefined' || navigator.onLine;
      const invRecords = await Promise.all(
        purchaseItems.map(async (pItem) => {
          const cached = inventoryMap.get(pItem.itemId);
          if (!isOnline && cached) return cached;
          try {
            const snap = await getDoc(doc(db, 'inventory', pItem.itemId));
            return snap.exists() ? ({ id: snap.id, ...snap.data() } as InventoryItem) : cached || null;
          } catch {
            return cached || null;
          }
        })
      );

      let batch = writeBatch(db);
      let opsInBatch = 0;
      const commitIfFull = async () => {
        if (opsInBatch >= 400) {
          await commitOfflineSafe(batch.commit(), 'purchase_invoice_batch_chunk');
          batch = writeBatch(db);
          opsInBatch = 0;
        }
      };

      batch.set(purchaseDocRef, invoiceData);
      opsInBatch += 1;

      for (let i = 0; i < purchaseItems.length; i++) {
        const pItem = purchaseItems[i];
        const sourceRow = validRows[i];
        const invItemRef = doc(db, 'inventory', pItem.itemId);
        const invData = invRecords[i];

        if (invData) {
          const itemBranch = invData.branch || activeBranch;
          const rawCurrentStock = Number(invData.currentStock) || 0;
          const stockActual = Math.max(0, rawCurrentStock);
          const costoActual = Number(invData.costPerBaseUnit ?? invData.cost ?? 0);
          const nuevaCantidad = pItem.quantity;
          const nuevoCosto = pItem.unitCost;

          if (pItem.hasWaste) {
            await commitIfFull();
            batch.update(invItemRef, {
              ...(sourceRow?.isNewlyCreated || rawCurrentStock === 0 ? { unit: pItem.unit } : {}),
              ...(costoActual === 0 ? { cost: nuevoCosto, costPerBaseUnit: nuevoCosto } : {}),
              hasPendingWaste: true,
              pendingWasteQty: (invData.pendingWasteQty || 0) + pItem.quantity,
              ...(pItem.expiryDate ? { expiryDate: pItem.expiryDate } : {}),
              updatedAt: now,
            });
            opsInBatch += 1;

            await commitIfFull();
            const wasteRef = doc(collection(db, 'waste_records'));
            batch.set(wasteRef, {
              date: invoiceDate,
              itemId: pItem.itemId,
              productName: pItem.name || pItem.productName || 'Insumo',
              unit: pItem.unit,
              initialWeight: pItem.quantity,
              finalWeight: 0,
              wasteAmount: pItem.quantity,
              wastePercentage: 100,
              usableQuantity: 0,
              responsible: 'Jefe de Cocina',
              wasteReason: `Factura ${invoiceData.invoiceNumber} - ${provider}`,
              status: 'pending',
              invoiceId: purchaseDocRef.id,
              branch: itemBranch,
              createdAt: now,
            });
            opsInBatch += 1;
          } else {
            // Formula: ((Costo Actual * Stock Actual) + (Nuevo Costo * Nueva Cantidad)) / (Stock Actual + Nueva Cantidad)
            const totalQtyForAvg = stockActual + nuevaCantidad;
            const totalValueForAvg = costoActual * stockActual + nuevoCosto * nuevaCantidad;
            const weightedAvgCost =
              totalQtyForAvg > 0 ? totalValueForAvg / totalQtyForAvg : nuevoCosto;
            const newStock = rawCurrentStock + nuevaCantidad;
            const baseUnitCost =
              pItem.unit === 'kg' || pItem.unit === 'lt'
                ? weightedAvgCost / 1000
                : weightedAvgCost;

            await commitIfFull();
            const kardexRef = doc(collection(db, 'kardex'));
            batch.set(kardexRef, {
              itemId: pItem.itemId,
              itemName: pItem.name || pItem.productName || 'Insumo',
              movementType: 'Entrada',
              quantity: pItem.quantity,
              unit: pItem.unit,
              unitCost: nuevoCosto,
              totalCost: pItem.totalCost,
              balanceStock: newStock,
              reference: `Factura Compra #${invoiceData.invoiceNumber} - ${provider}`,
              branch: itemBranch,
              createdAt: now,
            });
            opsInBatch += 1;

            await commitIfFull();
            batch.update(invItemRef, {
              ...(sourceRow?.isNewlyCreated || rawCurrentStock === 0 ? { unit: pItem.unit } : {}),
              currentStock: newStock,
              totalCost: totalValueForAvg,
              cost: baseUnitCost,
              costPerBaseUnit: baseUnitCost,
              ...(pItem.expiryDate ? { expiryDate: pItem.expiryDate } : {}),
              updatedAt: now,
            });
            opsInBatch += 1;
          }
        }
      }

      if (opsInBatch > 0) {
        await commitOfflineSafe(batch.commit(), 'purchase_invoice_commit');
      }

      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      console.error('Error al guardar factura de compra:', err);
      setErrorMsg(err?.message || 'Error al guardar la factura de compra.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto text-gray-900">
      <div className="w-full max-w-4xl bg-white border border-gray-200 rounded-3xl shadow-2xl p-5 sm:p-7 relative max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
              <FileText className="w-5 h-5 text-[#E89E2D]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Nueva Factura de Compra</h3>
              <p className="text-xs text-gray-500">
                Búsqueda inteligente, creación instantánea en inventario y Promedio Ponderado automático
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 shrink-0">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {duplicateAlert && (
          <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0" />
              <span className="font-semibold">{duplicateAlert}</span>
            </div>
            <button
              type="button"
              onClick={() => setDuplicateAlert(null)}
              className="text-amber-700 hover:text-amber-950 font-bold px-1.5 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        <form noValidate onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-4 pt-4 pr-1">
          {/* Top Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-200">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[#E89E2D]" />
                Proveedor Registrado <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none cursor-pointer"
              >
                <option value="">{supplierList.length ? 'Seleccionar proveedor…' : 'Sin proveedores registrados'}</option>
                {supplierList.map((sup) => (
                  <option key={sup.id} value={sup.name}>
                    {sup.name} {sup.category ? `(${sup.category})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#E89E2D]" />
                Fecha de Emisión <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                N° de Factura / Referencia
              </label>
              <input
                type="text"
                placeholder="Ej. 001-002-00012345"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none font-mono"
              />
            </div>
          </div>

          {/* Product Lines Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                Detalle de Productos Facturados ({rows.length})
              </span>
              <button
                type="button"
                onClick={addRow}
                className="px-3 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#E89E2D]" />
                + Añadir Línea
              </button>
            </div>

            <div className="space-y-2.5">
              {rows.map((row, index) => {
                const qty = parseFloat(row.quantity) || 0;
                const tot = parseFloat(row.totalCost) || 0;
                const calculatedUnitCost = qty > 0 ? tot / qty : 0;

                const normInput = normalizeSearch(row.itemName);
                const matchingItems = inventoryList.filter((item) =>
                  !normInput ? true : normalizeSearch(item.name).includes(normInput)
                );
                const exactInventoryMatch =
                  normInput.length > 0
                    ? inventoryList.find((item) => normalizeSearch(item.name) === normInput)
                    : undefined;
                const hasExactInventoryMatch = Boolean(exactInventoryMatch);
                const showCreateButton =
                  normInput.length > 0 && !row.itemId && !hasExactInventoryMatch;
                const isDropdownOpen = activeDropdownRowId === row.id;

                // Weighted average live preview for existing stock items
                const linkedInventoryItem = row.itemId ? inventoryMap.get(row.itemId) : undefined;
                const existingStock = Math.max(0, Number(linkedInventoryItem?.currentStock) || 0);
                const existingCost = Number(
                  linkedInventoryItem?.costPerBaseUnit ?? linkedInventoryItem?.cost ?? 0
                );
                const previewWeightedAvg =
                  !row.hasWaste && qty > 0 && tot > 0 && existingStock + qty > 0
                    ? (existingCost * existingStock + calculatedUnitCost * qty) /
                      (existingStock + qty)
                    : calculatedUnitCost;

                return (
                  <div
                    key={row.id}
                    className={`p-3.5 rounded-2xl border transition-all ${
                      row.hasWaste
                        ? 'bg-rose-50/70 border-rose-200'
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
                      {/* Searchable Product Input + Dropdown + Quick Create */}
                      <div className="sm:col-span-4 relative">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-bold uppercase text-gray-700">
                            Producto #{index + 1} <span className="text-rose-500">*</span>
                          </label>
                          {row.itemId && (
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                                row.isNewlyCreated
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/20'
                              }`}
                            >
                              {row.isNewlyCreated ? 'Nuevo en Inv. ✓' : 'En Inventario ✓'}
                            </span>
                          )}
                        </div>

                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            required
                            autoComplete="off"
                            placeholder="Escribe para buscar o crear producto..."
                            value={row.itemName}
                            onFocus={() => setActiveDropdownRowId(row.id)}
                            onBlur={() => {
                              if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
                              blurTimerRef.current = setTimeout(() => {
                                setActiveDropdownRowId((curr) => (curr === row.id ? null : curr));
                              }, 150);
                            }}
                            onChange={(e) => handleProductNameInput(row.id, e.target.value)}
                            className={`w-full bg-white border rounded-xl pl-8 pr-7 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none ${
                              row.itemId
                                ? 'border-[#4A5D23] font-semibold'
                                : 'border-gray-200 focus:border-[#4A5D23]'
                            }`}
                          />
                          {row.itemName && (
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleProductNameInput(row.id, '');
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs cursor-pointer"
                              title="Limpiar"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        {/* Autocomplete Dropdown */}
                        {isDropdownOpen && (
                          <div className="absolute left-0 right-0 mt-1 z-30 bg-white border border-gray-200 rounded-2xl shadow-xl max-h-56 overflow-y-auto">
                            {matchingItems.length > 0 ? (
                              <div className="py-1">
                                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">
                                  Productos existentes en Inventario ({matchingItems.length})
                                </div>
                                {matchingItems.slice(0, 30).map((item) => {
                                  const alreadyRowIdx = rows.findIndex(
                                    (r) => r.id !== row.id && r.itemId === item.id
                                  );
                                  const itemUnit = normalizeUnit(item.unit);
                                  const itemCost = item.costPerBaseUnit ?? item.cost ?? 0;

                                  return (
                                    <button
                                      key={item.id}
                                      type="button"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleSelectInventoryItem(row.id, item);
                                      }}
                                      className="w-full text-left px-3 py-2 hover:bg-[#EAF5F0] transition-colors flex items-center justify-between gap-2 border-b border-gray-50 last:border-b-0 cursor-pointer"
                                    >
                                      <div className="min-w-0">
                                        <div className="text-xs font-bold text-gray-900 truncate">
                                          {item.name}
                                        </div>
                                        <div className="text-[10px] text-gray-500 font-mono">
                                          Stock: {Number(item.currentStock || 0)} {itemUnit} • Costo: $
                                          {formatUnitCost(itemCost)} / {itemUnit}
                                        </div>
                                      </div>
                                      {alreadyRowIdx !== -1 ? (
                                        <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                                          En Línea #{alreadyRowIdx + 1}
                                        </span>
                                      ) : (
                                        <span className="shrink-0 text-[10px] font-bold text-[#4A5D23]">
                                          Elegir
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="px-3 py-2.5 text-[11px] text-gray-500">
                                No se encontró &quot;{row.itemName.trim()}&quot; en el Inventario.
                              </div>
                            )}

                            {showCreateButton && (
                              <div className="p-2 border-t border-gray-100 bg-emerald-50/70">
                                <button
                                  type="button"
                                  disabled={creatingRowId === row.id}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleCreateNewInventoryProduct(row);
                                  }}
                                  className="w-full py-2 px-3 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                                >
                                  <PackagePlus className="w-3.5 h-3.5 text-[#E89E2D]" />
                                  {creatingRowId === row.id
                                    ? 'Creando en Inventario...'
                                    : '+ Crear nuevo producto en Inventario'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Visible quick-create CTA even when dropdown closes after typing */}
                        {showCreateButton && !isDropdownOpen && (
                          <button
                            type="button"
                            disabled={creatingRowId === row.id}
                            onClick={() => handleCreateNewInventoryProduct(row)}
                            className="mt-1.5 w-full py-1.5 px-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-[#E89E2D]" />
                            {creatingRowId === row.id
                              ? 'Creando...'
                              : '+ Crear nuevo producto en Inventario'}
                          </button>
                        )}

                        {exactInventoryMatch && !row.itemId && !isDropdownOpen && (
                          <button
                            type="button"
                            onClick={() => handleSelectInventoryItem(row.id, exactInventoryMatch)}
                            className="mt-1.5 w-full py-1.5 px-2.5 rounded-xl bg-[#EAF5F0] hover:bg-[#d8ede2] text-[#4A5D23] border border-[#4A5D23]/30 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Seleccionar &quot;{exactInventoryMatch.name}&quot;
                          </button>
                        )}
                      </div>

                      {/* Quantity */}
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold uppercase text-gray-700 mb-1">
                          Cantidad
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          placeholder="Ej. 1000"
                          value={row.quantity}
                          onChange={(e) => handleRowChange(row.id, 'quantity', e.target.value)}
                          className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-gray-900 font-mono font-bold focus:outline-none"
                        />
                      </div>

                      {/* Unit Selector */}
                      <div className="sm:col-span-1">
                        <label className="block text-[10px] font-bold uppercase text-gray-700 mb-1">
                          Unidad
                        </label>
                        <select
                          value={row.unit}
                          onChange={(e) => handleRowChange(row.id, 'unit', e.target.value as InventoryUnit)}
                          className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-1.5 py-2 text-xs font-semibold text-gray-900 focus:outline-none cursor-pointer"
                        >
                          <option value="Grs.">Grs.</option>
                          <option value="Ml.">Ml.</option>
                          <option value="Unds.">Unds.</option>
                        </select>
                      </div>

                      {/* Total Price (Precio Total) */}
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold uppercase text-gray-700 mb-1">
                          Precio Total ($)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          placeholder="$ 3.00"
                          value={row.totalCost}
                          onChange={(e) => handleRowChange(row.id, 'totalCost', e.target.value)}
                          className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-gray-900 font-mono font-bold focus:outline-none"
                        />
                      </div>

                      {/* Expiry Date (Fecha de Caducidad) & Waste Toggle */}
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold uppercase text-gray-700 mb-1">
                          Caducidad / Merma
                        </label>
                        {row.showExpiryInput || row.expiryDate ? (
                          <div className="flex items-center gap-1 mb-1.5">
                            <input
                              type="date"
                              value={row.expiryDate}
                              onChange={(e) => handleRowChange(row.id, 'expiryDate', e.target.value)}
                              className="flex-1 min-w-0 bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-1.5 py-1.5 text-[11px] text-gray-900 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                handleRowChange(row.id, 'expiryDate', '');
                                handleRowChange(row.id, 'showExpiryInput', false);
                              }}
                              className="px-1.5 py-1.5 rounded-lg bg-gray-100 hover:bg-rose-50 text-gray-500 hover:text-rose-600 text-[10px] font-bold cursor-pointer"
                              title="Quitar fecha"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRowChange(row.id, 'showExpiryInput', true)}
                            className="w-full py-1.5 px-2 mb-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-[#D97706]/50 text-amber-900 text-[10px] font-bold transition-colors cursor-pointer flex items-center justify-center gap-1"
                          >
                            <Calendar className="w-3 h-3 text-[#D97706]" />
                            <span>Fecha de Caducidad</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRowChange(row.id, 'hasWaste', !row.hasWaste)}
                          className={`w-full py-1.5 px-2 rounded-xl border text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                            row.hasWaste
                              ? 'bg-rose-100 border-rose-300 text-rose-800'
                              : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {row.hasWaste ? (
                            <>
                              <AlertOctagon className="w-3 h-3 text-rose-600" />
                              <span>Con Merma</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-[#4A5D23]" />
                              <span>Sin Merma</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Delete row */}
                      <div className="sm:col-span-1 flex items-end justify-center pt-2 sm:pt-5">
                        <button
                          type="button"
                          disabled={rows.length === 1}
                          onClick={() => removeRow(row.id)}
                          className="p-2 rounded-xl text-gray-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 cursor-pointer transition-colors"
                          title="Eliminar fila"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Feedback calculation on this row */}
                    <div className="mt-2.5 pt-2 border-t border-gray-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-600">
                      <div className="flex flex-wrap items-center gap-3">
                        <span>
                          Costo unitario exacto:{' '}
                          <span className="font-mono font-bold text-[#4A5D23]">
                            ${formatUnitCost(calculatedUnitCost)} / {row.unit}
                          </span>
                        </span>
                        {linkedInventoryItem && existingStock > 0 && !row.hasWaste && qty > 0 && tot > 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-lg bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/20 font-mono font-semibold">
                            Actual: ${formatUnitCost(existingCost)} ({existingStock} {row.unit}) → Prom. Ponderado:{' '}
                            <strong>${formatUnitCost(previewWeightedAvg)} / {row.unit}</strong>
                          </span>
                        )}
                      </div>
                      <div>
                        {row.hasWaste ? (
                          <span className="text-rose-700 font-semibold flex items-center gap-1">
                            <AlertOctagon className="w-3.5 h-3.5" />
                            Se marcará en ROJO como PENDIENTE hasta procesar desposte.
                          </span>
                        ) : (
                          <span className="text-emerald-800 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            Ingreso inmediato al Kardex con promedio ponderado.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Grand Total Summary Box */}
          <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-[#E89E2D]" />
              <div>
                <div className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                  Monto Total de la Factura
                </div>
                <div className="text-[11px] text-gray-500">Suma de todas las líneas de productos</div>
              </div>
            </div>
            <div className="text-2xl font-mono font-black text-[#E89E2D]">
              ${invoiceTotal.toFixed(2)}
            </div>
          </div>

          {/* Submit buttons */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer border border-gray-200"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || invoiceTotal <= 0}
              className="px-6 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
            >
              <FileText className="w-4 h-4 text-[#E89E2D]" />
              {isSubmitting ? 'Guardando Factura...' : 'Guardar Factura de Compra'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
