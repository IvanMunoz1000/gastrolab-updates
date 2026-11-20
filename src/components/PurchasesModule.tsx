import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { PurchaseInvoice } from '../types';
import { NewPurchaseInvoiceModal } from './NewPurchaseInvoiceModal';
import { DeleteAuthModal } from './DeleteAuthModal';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  FileText,
  Plus,
  Calendar,
  AlertOctagon,
  CheckCircle2,
  Search,
  Receipt,
  ChevronDown,
  ChevronUp,
  PackageCheck,
  Trash2,
  AlertCircle,
  X,
} from 'lucide-react';

export const PurchasesModule: React.FC = () => {
  const { activeBranch } = useBranch();
  const [rawInvoices, setRawInvoices] = useState<PurchaseInvoice[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 150);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [isNewInvoiceOpen, setIsNewInvoiceOpen] = useState(false);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [moduleError, setModuleError] = useState<string | null>(null);

  // Security deletion state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<PurchaseInvoice | null>(null);

  // Subscribe to purchases collection
  useEffect(() => {
    const q = query(collection(db, 'purchases'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: PurchaseInvoice[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as PurchaseInvoice);
        });
        setRawInvoices(list);
        setModuleError(null);
      },
      (err) => {
        console.error('Error al escuchar facturas de compra:', err);
        setModuleError('No se pudieron sincronizar las facturas de compra.');
      }
    );

    return () => unsubscribe();
  }, []);

  const invoices = useMemo(
    () => rawInvoices.filter((inv) => belongsToBranch((inv as any).branch, activeBranch)),
    [rawInvoices, activeBranch]
  );

  const filteredInvoices = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      const matchesProvider = (inv.provider || '').toLowerCase().includes(q);
      const matchesNumber = (inv.invoiceNumber || '').toLowerCase().includes(q);
      return matchesProvider || matchesNumber;
    });
  }, [invoices, debouncedSearch]);

  const visibleInvoices = useMemo(
    () => (showAllInvoices ? filteredInvoices : filteredInvoices.slice(0, 50)),
    [filteredInvoices, showAllInvoices]
  );

  const toggleExpand = (id: string) => {
    setExpandedInvoiceId((prev) => (prev === id ? null : id));
  };

  const handleRequestDelete = (e: React.MouseEvent, inv: PurchaseInvoice) => {
    e.stopPropagation();
    setInvoiceToDelete(inv);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!invoiceToDelete) return;
    try {
      await commitOfflineSafe(doc(db, 'purchases', invoiceToDelete.id) ? deleteDoc(doc(db, 'purchases', invoiceToDelete.id)) : Promise.resolve(), 'delete_purchase_invoice');
      setInvoiceToDelete(null);
      setModuleError(null);
    } catch (err: any) {
      console.error('Error al eliminar factura de compra:', err);
      setModuleError('No se pudo eliminar la factura: ' + (err?.message || 'Error'));
      setInvoiceToDelete(null);
    }
  };

  const totalSpent = useMemo(
    () => invoices.reduce((acc, inv) => acc + (Number(inv.totalAmount) || 0), 0),
    [invoices]
  );

  return (
    <div className="space-y-6 text-gray-900">
      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
            <Receipt className="w-6 h-6 text-[#E89E2D]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Facturas de Compras</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/20">
                Proveedores
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Ingreso de compras con Promedio Ponderado de Costos y Clasificación de Mermas
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-stretch sm:self-auto justify-end">
          <div className="text-right hidden md:block">
            <span className="text-[10px] text-gray-400 block uppercase font-bold">Total Invertido</span>
            <span className="text-base font-mono font-black text-[#E89E2D]">
              ${totalSpent.toFixed(2)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsNewInvoiceOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-2 transition-all shadow-xs active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#E89E2D]" />
            + Nueva Factura de Compra
          </button>
        </div>
      </div>

      {moduleError && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{moduleError}</span>
          </div>
          <button type="button" onClick={() => setModuleError(null)} className="text-rose-500 hover:text-rose-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search and Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por proveedor o número de factura..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl pl-10 pr-4 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
          />
        </div>
        <div className="text-xs text-gray-500 font-mono">
          {filteredInvoices.length} factura(s)
        </div>
      </div>

      {/* Invoices List */}
      {visibleInvoices.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-3xl border border-gray-200">
          <Receipt className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-gray-900">No hay facturas de compras registradas</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            {invoices.length === 0
              ? 'Comienza haciendo clic en "+ Nueva Factura de Compra" para abastecer tu inventario.'
              : 'No se encontraron facturas con los términos de búsqueda.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleInvoices.map((inv) => {
            const isExpanded = expandedInvoiceId === inv.id;
            const hasAnyWaste = inv.items?.some((i) => i.hasWaste) || inv.hasWaste;
            const hasPendingWaste =
              inv.items?.some((i) => i.hasWaste && i.wasteStatus !== 'processed') &&
              inv.wasteStatus !== 'processed';
            const hasProcessedWaste = Boolean(hasAnyWaste && !hasPendingWaste);

            return (
              <div
                key={inv.id}
                className={`bg-white border-2 rounded-3xl overflow-hidden shadow-xs transition-all ${
                  hasPendingWaste
                    ? 'border-rose-300 bg-rose-50/20'
                    : hasProcessedWaste
                    ? 'border-emerald-400 bg-emerald-50/20'
                    : 'border-gray-200'
                }`}
              >
                {/* Invoice Main Bar */}
                <div
                  onClick={() => toggleExpand(inv.id)}
                  className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-gray-50/80 transition-colors"
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
                        hasPendingWaste
                          ? 'bg-rose-50 text-rose-600 border-rose-200'
                          : hasProcessedWaste
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-[#EAF5F0] text-[#4A5D23] border-[#4A5D23]/20'
                      }`}
                    >
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-extrabold text-sm text-gray-900">{inv.provider}</h4>
                        <span className="text-xs font-mono font-bold text-gray-500">
                          #{inv.invoiceNumber}
                        </span>
                        {hasPendingWaste && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-300 flex items-center gap-1">
                            <AlertOctagon className="w-3 h-3" />
                            Merma Pendiente
                          </span>
                        )}
                        {hasProcessedWaste && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Merma Procesada
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-[#4A5D23]" />
                          {inv.date}
                        </span>
                        <span>•</span>
                        <span>{inv.items?.length || 0} producto(s)</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4">
                    <div className="text-left sm:text-right">
                      <span className="text-[10px] text-gray-400 uppercase font-bold block">
                        Total Factura
                      </span>
                      <span className="text-base font-black font-mono text-[#E89E2D]">
                        ${(Number(inv.totalAmount) || 0).toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Delete button (Protected by Admin/Owner Password) */}
                      <button
                        type="button"
                        onClick={(e) => handleRequestDelete(e, inv)}
                        className="p-2 rounded-xl text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Eliminar factura (Requiere clave)"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      <div className="p-2 text-gray-400">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-2 border-t border-gray-100 bg-gray-50/50">
                    <h5 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                      Detalle de Productos Facturados
                    </h5>
                    <div className="space-y-2">
                      {inv.items?.map((item, idx) => {
                        const isItemWasteProcessed =
                          item.hasWaste &&
                          (item.wasteStatus === 'processed' || inv.wasteStatus === 'processed');
                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-2xl border flex items-center justify-between text-xs ${
                              item.hasWaste
                                ? isItemWasteProcessed
                                  ? 'bg-emerald-50/60 border-emerald-300'
                                  : 'bg-rose-50/60 border-rose-300'
                                : 'bg-white border-gray-200'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <PackageCheck
                                className={`w-4 h-4 ${
                                  item.hasWaste
                                    ? isItemWasteProcessed
                                      ? 'text-emerald-600'
                                      : 'text-rose-600'
                                    : 'text-[#4A5D23]'
                                }`}
                              />
                              <span className="font-bold text-gray-900">{item.productName || item.name}</span>
                              <span className="text-gray-500">
                                ({item.quantity} {item.unit})
                              </span>
                            </div>

                            <div className="flex items-center gap-4 font-mono">
                              <span className="text-gray-500">
                                ${(Number(item.costPerUnit || item.unitCost) || 0).toFixed(4)} / {item.unit}
                              </span>
                              <span className="font-bold text-gray-900">
                                ${(Number(item.totalCost) || 0).toFixed(2)}
                              </span>
                              {item.hasWaste ? (
                                isItemWasteProcessed ? (
                                  <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
                                    Merma Procesada
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded border border-rose-300">
                                    Merma Pendiente
                                  </span>
                                )
                              ) : (
                                <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                  Stock Inmediato
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredInvoices.length > 50 && (
            <div className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl px-4 py-3 text-xs text-gray-600">
              <span>
                Mostrando {visibleInvoices.length} de {filteredInvoices.length} facturas
              </span>
              <button
                type="button"
                onClick={() => setShowAllInvoices((prev) => !prev)}
                className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold cursor-pointer"
              >
                {showAllInvoices ? 'Mostrar últimas 50' : `Ver todas (${filteredInvoices.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* New Invoice Modal */}
      <NewPurchaseInvoiceModal
        isOpen={isNewInvoiceOpen}
        onClose={() => setIsNewInvoiceOpen(false)}
      />

      {/* Delete Auth Modal */}
      <DeleteAuthModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setInvoiceToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Eliminar Factura de Compra"
        itemDescription={
          invoiceToDelete
            ? `la factura #${invoiceToDelete.invoiceNumber} de "${invoiceToDelete.provider}"`
            : 'esta factura'
        }
      />
    </div>
  );
};
