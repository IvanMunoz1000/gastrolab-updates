import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  addDoc,
  deleteDoc,
  orderBy,
  doc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { PurchaseInvoice, Supplier } from '../types';
import { DeleteAuthModal } from './DeleteAuthModal';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  Building2,
  Phone,
  Mail,
  MapPin,
  Receipt,
  Plus,
  ArrowRight,
  Search,
  X,
  AlertTriangle,
  Trash2,
  Calendar,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface Props {
  onGoToPurchases: (providerName?: string) => void;
}

export const ProveedoresModule: React.FC<Props> = ({ onGoToPurchases }) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 150);
  const [showAllSuppliers, setShowAllSuppliers] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Security deletion state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);

  // Form state for new supplier - UX: completely empty by default
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [taxId, setTaxId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [selectedSupplierForInvoices, setSelectedSupplierForInvoices] = useState<Supplier | null>(null);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  // Subscribe to suppliers collection in Firestore
  useEffect(() => {
    const q = query(collection(db, 'suppliers'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Supplier[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as Supplier);
        });
        setSuppliers(list);
        setModuleError(null);

      },
      (err) => {
        console.error('Error al escuchar proveedores:', err);
        setModuleError('No se pudo sincronizar el directorio de proveedores.');
      }
    );

    return () => unsubscribe();
  }, []);

  // Subscribe to purchases to calculate statistics
  useEffect(() => {
    const q = query(collection(db, 'purchases'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: PurchaseInvoice[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() } as PurchaseInvoice);
        });
        setInvoices(list);
      },
      (err) => console.error('Error al escuchar compras:', err)
    );

    return () => unsubscribe();
  }, []);

  const statsMap = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    invoices.forEach((inv) => {
      const p = (inv.provider || '').trim().toLowerCase();
      if (p) {
        if (!map[p]) map[p] = { count: 0, total: 0 };
        map[p].count += 1;
        map[p].total += Number(inv.totalAmount) || 0;
      }
    });
    return map;
  }, [invoices]);

  const selectedSupplierInvoices = useMemo(() => {
    if (!selectedSupplierForInvoices) return [];
    const targetName = (selectedSupplierForInvoices.name || '').trim().toLowerCase();
    return invoices
      .filter((inv) => (inv.provider || '').trim().toLowerCase() === targetName)
      .sort((a, b) => {
        const tA = new Date(a.date || a.createdAt || 0).getTime();
        const tB = new Date(b.date || b.createdAt || 0).getTime();
        return tB - tA;
      });
  }, [invoices, selectedSupplierForInvoices]);

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg(null);

    const cleanName = name.trim();
    if (!cleanName) {
      setErrorMsg('El Nombre del Proveedor es obligatorio.');
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'suppliers'), {
        name: cleanName,
        category: category.trim() || 'Insumos Generales',
        phone: phone.trim() || '+593 99 000 0000',
        email: email.trim() || `contacto@${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}.ec`,
        city: city.trim() || 'Ecuador',
        taxId: taxId.trim() || '9999999999001',
        createdAt: new Date().toISOString(),
      });

      setName('');
      setCategory('');
      setPhone('');
      setEmail('');
      setCity('');
      setTaxId('');
      setIsAddModalOpen(false);
    } catch (err: any) {
      console.error('Error al guardar proveedor:', err);
      setErrorMsg(err?.message || 'Error al guardar el proveedor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestDeleteSupplier = (supplier: Supplier) => {
    setSupplierToDelete(supplier);
    setDeleteModalOpen(true);
  };

  const handleConfirmDeleteSupplier = async () => {
    if (!supplierToDelete) return;
    try {
      await deleteDoc(doc(db, 'suppliers', supplierToDelete.id));
      setSupplierToDelete(null);
      setModuleError(null);
    } catch (err: any) {
      console.error('Error al eliminar proveedor:', err);
      setModuleError('No se pudo eliminar el proveedor: ' + (err?.message || 'Error'));
      setSupplierToDelete(null);
    }
  };

  const filteredSuppliers = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => {
      return (
        (s.name || '').toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q) ||
        (s.taxId || '').toLowerCase().includes(q)
      );
    });
  }, [suppliers, debouncedSearch]);

  const visibleSuppliers = useMemo(
    () => (showAllSuppliers ? filteredSuppliers : filteredSuppliers.slice(0, 50)),
    [filteredSuppliers, showAllSuppliers]
  );

  return (
    <div className="space-y-6 text-gray-900">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
            <Building2 className="w-6 h-6 text-[#E89E2D]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Directorio de Proveedores</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/20">
                Abastecimiento
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Proveedores oficiales guardados para selección directa en Facturas de Compra
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
          <button
            type="button"
            onClick={() => {
              setName('');
              setCategory('');
              setPhone('');
              setEmail('');
              setCity('');
              setTaxId('');
              setErrorMsg(null);
              setIsAddModalOpen(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-2 transition-all shadow-xs active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#E89E2D]" />
            + Nuevo Proveedor
          </button>

          <button
            type="button"
            onClick={() => onGoToPurchases()}
            className="px-4 py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 text-xs font-bold flex items-center gap-2 transition-all cursor-pointer"
          >
            <Receipt className="w-4 h-4 text-[#4A5D23]" />
            Facturas de Compras
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {moduleError && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{moduleError}</span>
          </div>
          <button type="button" onClick={() => setModuleError(null)} className="text-rose-500 hover:text-rose-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar proveedor por nombre o rubro..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl pl-10 pr-4 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
          />
        </div>
        <div className="text-xs text-gray-500 font-mono">
          {filteredSuppliers.length} proveedores registrados
        </div>
      </div>

      {/* Grid of Providers */}
      {visibleSuppliers.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-3xl border border-gray-200">
          <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-gray-900">No hay proveedores</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            Haz clic en "+ Nuevo Proveedor" para registrar tu primer proveedor.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleSuppliers.map((prov) => {
              const stats = statsMap[(prov.name || '').trim().toLowerCase()] || { count: 0, total: 0 };
              return (
                <div
                  key={prov.id}
                  className="p-5 rounded-3xl bg-white border border-gray-200 hover:border-[#4A5D23] shadow-xs hover:shadow-md transition-all flex flex-col justify-between group relative"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="w-10 h-10 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center text-[#4A5D23]">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedInvoiceId(null);
                            setSelectedSupplierForInvoices(prov);
                          }}
                          className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white border border-[#4A5D23]/30 transition-colors cursor-pointer flex items-center gap-1"
                          title="Ver historial de facturas de este proveedor"
                        >
                          <FileText className="w-3 h-3" />
                          {stats.count} Factura(s)
                        </button>
                        {/* Delete supplier protected button */}
                        <button
                          type="button"
                          onClick={() => handleRequestDeleteSupplier(prov)}
                          className="p-1 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Eliminar proveedor (Requiere clave)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <h4 className="text-base font-bold text-gray-900">{prov.name}</h4>
                    <p className="text-xs text-[#E89E2D] font-bold mt-0.5">{prov.category}</p>

                    <div className="mt-4 pt-3 border-t border-gray-100 space-y-2 text-xs text-gray-600">
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-[#4A5D23]" />
                        <span>{prov.phone || '+593 99 000 0000'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-[#4A5D23]" />
                        <span className="truncate">{prov.email || 'contacto@proveedor.ec'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-[#4A5D23]" />
                        <span>{prov.city || 'Ecuador'}</span>
                      </div>
                      {prov.taxId && (
                        <div className="text-[11px] text-gray-500 font-mono">
                          RUC: {prov.taxId}
                        </div>
                      )}
                    </div>

                    {/* Total Billing */}
                    <div className="mt-4 p-3 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between text-xs">
                      <span className="text-gray-500">Total Facturado:</span>
                      <span className="font-mono font-black text-[#E89E2D] text-sm">
                        ${stats.total.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedInvoiceId(null);
                        setSelectedSupplierForInvoices(prov);
                      }}
                      className="py-2 px-3 rounded-xl bg-[#EAF5F0] hover:bg-[#dceee5] text-[#4A5D23] font-bold text-xs transition-all border border-[#4A5D23]/30 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Facturas ({stats.count})
                    </button>
                    <button
                      type="button"
                      onClick={() => onGoToPurchases(prov.name)}
                      className="py-2 px-3 rounded-xl bg-gray-50 hover:bg-[#4A5D23] text-gray-700 hover:text-white font-bold text-xs transition-all border border-gray-200 hover:border-[#4A5D23] cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Receipt className="w-3.5 h-3.5 text-[#E89E2D]" />
                      Nueva Factura
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredSuppliers.length > 50 && (
            <div className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl px-4 py-3 text-xs text-gray-600">
              <span>
                Mostrando {visibleSuppliers.length} de {filteredSuppliers.length} proveedores
              </span>
              <button
                type="button"
                onClick={() => setShowAllSuppliers((prev) => !prev)}
                className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold cursor-pointer"
              >
                {showAllSuppliers ? 'Mostrar primeros 50' : `Ver todos (${filteredSuppliers.length})`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal: + Nuevo Proveedor */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 relative">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <Building2 className="w-5 h-5 text-[#E89E2D]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Registrar Proveedor</h3>
                  <p className="text-xs text-gray-500">Disponible en la lista desplegable de compras</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form noValidate onSubmit={handleAddSupplier} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                  Nombre Comercial / Razón Social <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Distribuidora Central"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                  Categoría
                </label>
                <input
                  type="text"
                  placeholder="Ej. Carnes, Abarrotes, Vegetales"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                    Teléfono
                  </label>
                  <input
                    type="text"
                    placeholder="099 123 4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                    Ciudad / Origen
                  </label>
                  <input
                    type="text"
                    placeholder="Quito"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  placeholder="ventas@proveedor.ec"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                  RUC / Identificación Tributaria
                </label>
                <input
                  type="text"
                  placeholder="1790000000001"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none font-mono"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-xs font-semibold cursor-pointer border border-gray-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Guardando...' : 'Guardar Proveedor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Historial de Facturas del Proveedor */}
      {selectedSupplierForInvoices && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
          <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 relative max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between pb-4 border-b border-gray-200 mb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] shrink-0">
                  <Receipt className="w-5 h-5 text-[#E89E2D]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900">
                    Historial de Facturas — {selectedSupplierForInvoices.name}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {selectedSupplierForInvoices.category}
                    {selectedSupplierForInvoices.taxId ? ` · RUC: ${selectedSupplierForInvoices.taxId}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSupplierForInvoices(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary KPI row */}
            <div className="grid grid-cols-2 gap-3 mb-4 shrink-0">
              <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between text-xs">
                <span className="text-gray-500 font-semibold">Facturas Registradas:</span>
                <span className="font-mono font-black text-gray-900 text-sm">
                  {selectedSupplierInvoices.length}
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/25 flex items-center justify-between text-xs">
                <span className="text-[#4A5D23] font-semibold">Total Facturado:</span>
                <span className="font-mono font-black text-[#4A5D23] text-sm">
                  $
                  {selectedSupplierInvoices
                    .reduce((acc, inv) => acc + (Number(inv.totalAmount) || 0), 0)
                    .toFixed(2)}
                </span>
              </div>
            </div>

            {/* Invoices list */}
            <div className="overflow-y-auto flex-1 space-y-3 pr-1">
              {selectedSupplierInvoices.length === 0 ? (
                <div className="py-12 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-300">
                  <Receipt className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                  <h4 className="text-sm font-bold text-gray-900">Sin facturas registradas</h4>
                  <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                    Aún no se han ingresado facturas de compra asociadas a este proveedor.
                  </p>
                </div>
              ) : (
                selectedSupplierInvoices.map((inv) => {
                  const isExp = expandedInvoiceId === inv.id;
                  return (
                    <div
                      key={inv.id}
                      className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-2xs"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedInvoiceId(isExp ? null : inv.id)}
                        className="w-full p-4 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/20 flex items-center justify-center text-[#4A5D23] shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-black text-xs text-gray-900">
                                Factura #{inv.invoiceNumber || inv.id.slice(0, 6)}
                              </span>
                              {inv.wasteStatus === 'pending' && (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-rose-100 text-rose-700 border border-rose-200">
                                  Merma Pendiente
                                </span>
                              )}
                              {inv.wasteStatus === 'processed' && (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-100 text-emerald-700 border border-emerald-200">
                                  Merma Procesada
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-[#4A5D23]" />
                                {inv.date ||
                                  (inv.createdAt
                                    ? new Date(inv.createdAt).toLocaleDateString('es-EC')
                                    : '-')}
                              </span>
                              <span>{(inv.items || []).length} producto(s)</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-black text-sm text-[#E89E2D]">
                            ${(Number(inv.totalAmount) || 0).toFixed(2)}
                          </span>
                          {isExp ? (
                            <ChevronUp className="w-4 h-4 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </button>

                      {isExp && (
                        <div className="px-4 pb-4 pt-2 border-t border-gray-100 bg-gray-50/70">
                          <table className="w-full text-left text-[11px]">
                            <thead className="text-gray-500 uppercase border-b border-gray-200">
                              <tr>
                                <th className="py-1.5">Producto</th>
                                <th className="py-1.5 text-right">Cantidad</th>
                                <th className="py-1.5 text-right">Costo Unit.</th>
                                <th className="py-1.5 text-right">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200/70">
                              {(inv.items || []).map((item, idx) => (
                                <tr key={idx}>
                                  <td className="py-1.5 font-bold text-gray-900">
                                    {item.name || item.productName || 'Producto'}
                                  </td>
                                  <td className="py-1.5 text-right font-mono text-gray-700">
                                    {item.quantity} {item.unit}
                                  </td>
                                  <td className="py-1.5 text-right font-mono text-gray-600">
                                    ${Number(item.unitCost ?? item.costPerUnit ?? 0).toFixed(4)}
                                  </td>
                                  <td className="py-1.5 text-right font-mono font-bold text-[#4A5D23]">
                                    ${Number(item.totalCost || 0).toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-4 mt-4 border-t border-gray-200 flex items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const provName = selectedSupplierForInvoices.name;
                  setSelectedSupplierForInvoices(null);
                  onGoToPurchases(provName);
                }}
                className="px-4 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#E89E2D]" />
                Registrar Nueva Factura
              </button>
              <button
                type="button"
                onClick={() => setSelectedSupplierForInvoices(null)}
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
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setSupplierToDelete(null);
        }}
        onConfirm={handleConfirmDeleteSupplier}
        title="Eliminar Proveedor"
        itemDescription={
          supplierToDelete ? `el proveedor "${supplierToDelete.name}"` : 'este proveedor'
        }
      />
    </div>
  );
};
