import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  doc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { DeleteAuthModal } from './DeleteAuthModal';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  Plus,
  Search,
  Trash2,
  UserCheck,
  AlertCircle,
  CheckCircle2,
  X,
  Edit,
} from 'lucide-react';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  identification?: string; // RUC o Cédula
  totalSpent?: number;
  ordersCount?: number;
  isVip?: boolean;
  notes?: string;
  createdAt: string;
}

export const ClientesModule: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 150);
  const [showAllCustomers, setShowAllCustomers] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Form states - Empty by default
  const [name, setName] = useState('');
  const [identification, setIdentification] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isVip, setIsVip] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Security deletion
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [moduleError, setModuleError] = useState<string | null>(null);

  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedbackMsg({ type, text });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setFeedbackMsg((prev) => (prev?.text === text ? null : prev));
    }, type === 'error' ? 5500 : 4000);
  };

  useEffect(() => {
    const q = query(collection(db, 'customers'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Customer[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Customer));
        setCustomers(list);
        setModuleError(null);
      },
      (err) => {
        console.warn('Clientes listener notice:', err?.code || err?.message);
        setModuleError('No se pudo sincronizar el directorio de clientes con el servidor.');
      }
    );

    return () => unsub();
  }, []);

  const handleOpenEdit = (cust: Customer) => {
    setEditingCustomer(cust);
    setName(cust.name || '');
    setIdentification(cust.identification || (cust as any).taxId || '');
    setPhone(cust.phone || '');
    setEmail(cust.email || '');
    setAddress(cust.address || '');
    setNotes(cust.notes || '');
    setIsVip(Boolean(cust.isVip));
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (isSubmitting) return;

    const cleanName = name.trim();
    if (!cleanName) {
      setFormError('El Nombre Completo o Razón Social es obligatorio.');
      return;
    }

    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);

      if (editingCustomer) {
        const updatePayload = {
          name: cleanName,
          identification: identification.trim(),
          taxId: identification.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          notes: notes.trim(),
          isVip,
          updatedAt: now,
        };
        const custRef = doc(db, 'customers', editingCustomer.id);
        const clientRef = doc(db, 'clients', editingCustomer.id);
        batch.set(custRef, updatePayload, { merge: true });
        batch.set(clientRef, updatePayload, { merge: true });
        await batch.commit();

        showFeedback('success', `Cliente "${cleanName}" actualizado correctamente en Firebase.`);
      } else {
        const clientPayload = {
          name: cleanName,
          identification: identification.trim(),
          taxId: identification.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          notes: notes.trim(),
          isVip,
          totalSpent: 0,
          ordersCount: 0,
          createdAt: now,
          updatedAt: now,
        };

        const custRef = doc(collection(db, 'customers'));
        const clientRef = doc(db, 'clients', custRef.id);
        batch.set(custRef, clientPayload);
        batch.set(clientRef, clientPayload);
        await batch.commit();

        showFeedback('success', `Cliente "${clientPayload.name}" guardado exitosamente en el sistema.`);
      }

      setEditingCustomer(null);
      setName('');
      setIdentification('');
      setPhone('');
      setEmail('');
      setAddress('');
      setNotes('');
      setIsVip(false);
      setFormError(null);
      setIsModalOpen(false);
    } catch (err: any) {
      console.error('Error al guardar cliente:', err);
      setFormError('Error al guardar cliente en Firestore: ' + (err?.message || 'Error'));
      showFeedback('error', 'Error al guardar cliente en Firestore: ' + (err?.message || 'Error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'customers', deleteTarget.id));
      batch.delete(doc(db, 'clients', deleteTarget.id));
      await batch.commit();
      showFeedback('success', `Cliente "${deleteTarget.name}" eliminado correctamente.`);
      setDeleteTarget(null);
    } catch (err: any) {
      console.error(err);
      setModuleError('No se pudo eliminar el cliente: ' + (err?.message || 'Error'));
      setDeleteTarget(null);
    }
  };

  const filteredCustomers = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.identification || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q)
      );
    });
  }, [customers, debouncedSearch]);

  const visibleCustomers = useMemo(
    () => (showAllCustomers ? filteredCustomers : filteredCustomers.slice(0, 50)),
    [filteredCustomers, showAllCustomers]
  );

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 flex items-center justify-center text-[#4A5D23]">
            <UserCheck className="w-6 h-6 text-[#4A5D23]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Directorio de Clientes</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30">
                CRM
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Historial de consumos, datos para facturación electrónica y programas de fidelidad
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingCustomer(null);
            setName('');
            setIdentification('');
            setPhone('');
            setEmail('');
            setAddress('');
            setNotes('');
            setIsVip(false);
            setFormError(null);
            setIsModalOpen(true);
          }}
          className="px-4 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#E89E2D]" />
          Nuevo Cliente
        </button>
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

      {feedbackMsg && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
            feedbackMsg.type === 'success'
              ? 'bg-[#EAF5F0] border-[#4A5D23]/30 text-[#4A5D23]'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedbackMsg.text}</span>
          </div>
          <button type="button" onClick={() => setFeedbackMsg(null)} className="opacity-70 hover:opacity-100 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search Bar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, RUC/Cédula o teléfono..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
          />
        </div>

        <span className="text-xs text-gray-500 font-medium">
          {filteredCustomers.length} Clientes registrados
        </span>
      </div>

      {/* Customers Table */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider border-b border-gray-200 font-semibold text-[11px]">
              <tr>
                <th className="p-3.5">Cliente</th>
                <th className="p-3.5">RUC / Cédula</th>
                <th className="p-3.5">Teléfono</th>
                <th className="p-3.5">Correo</th>
                <th className="p-3.5 text-center">Visitas</th>
                <th className="p-3.5 text-right">Consumo Acumulado</th>
                <th className="p-3.5 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400">
                    No se encontraron clientes registrados.
                  </td>
                </tr>
              ) : (
                visibleCustomers.map((cust) => (
                  <tr key={cust.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="p-3.5 font-bold text-gray-900 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-[#EAF5F0] text-[#4A5D23] flex items-center justify-center font-bold text-xs shrink-0">
                        {(cust.name || 'C').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span>{cust.name}</span>
                          {cust.isVip && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-[#E89E2D] text-white">
                              VIP
                            </span>
                          )}
                        </div>
                        {cust.notes && <div className="text-[10px] text-gray-400 font-normal">{cust.notes}</div>}
                      </div>
                    </td>
                    <td className="p-3.5 font-mono text-gray-600">{cust.identification || '-'}</td>
                    <td className="p-3.5 font-mono text-gray-700">{cust.phone || '-'}</td>
                    <td className="p-3.5 text-gray-600">{cust.email || '-'}</td>
                    <td className="p-3.5 text-center font-mono font-bold text-gray-900">
                      {cust.ordersCount || 0}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-[#4A5D23]">
                      ${(Number(cust.totalSpent) || 0).toFixed(2)}
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(cust)}
                          className="px-2.5 py-1.5 rounded-lg bg-gray-50 hover:bg-[#EAF5F0] border border-gray-200 hover:border-[#4A5D23]/40 text-gray-700 hover:text-[#4A5D23] font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                          title="Editar datos del cliente"
                        >
                          <Edit className="w-3.5 h-3.5 text-[#4A5D23]" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(cust)}
                          className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer"
                          title="Eliminar cliente (requiere clave admin)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredCustomers.length > 50 && (
          <div className="pt-3 mt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>
              Mostrando {visibleCustomers.length} de {filteredCustomers.length} clientes
            </span>
            <button
              type="button"
              onClick={() => setShowAllCustomers((prev) => !prev)}
              className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold cursor-pointer"
            >
              {showAllCustomers ? 'Mostrar últimos 50' : `Ver todos (${filteredCustomers.length})`}
            </button>
          </div>
        )}
      </div>

      {/* Create / Edit Customer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-gray-200 text-gray-900">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <h3 className="font-bold text-base text-gray-900">
                {editingCustomer ? 'Editar Cliente' : 'Registrar Cliente'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingCustomer(null);
                }}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mb-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form noValidate onSubmit={handleSaveCustomer} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Nombre Completo o Razón Social *</label>
                <input
                  type="text"
                  placeholder="Ej. Sofía Andrade"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Cédula o RUC</label>
                  <input
                    type="text"
                    placeholder="Ej. 1729384756"
                    value={identification}
                    onChange={(e) => setIdentification(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Teléfono / WhatsApp</label>
                  <input
                    type="tel"
                    placeholder="Ej. 0991234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Correo Electrónico</label>
                  <input
                    type="email"
                    placeholder="sofia@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Dirección</label>
                  <input
                    type="text"
                    placeholder="Ej. Quito Norte"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="vip-check"
                  checked={isVip}
                  onChange={(e) => setIsVip(e.target.checked)}
                  className="rounded text-[#4A5D23] focus:ring-[#4A5D23]"
                />
                <label htmlFor="vip-check" className="font-bold text-gray-700 cursor-pointer">
                  Marcar como Cliente VIP / Preferencial
                </label>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Notas / Preferencias</label>
                <textarea
                  rows={2}
                  placeholder="Ej. Sin cebolla, alérgico a nueces, cumpleaños 14 de Mayo..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingCustomer(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#4A5D23] text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting
                    ? 'Guardando...'
                    : editingCustomer
                    ? 'Guardar Cambios'
                    : 'Guardar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Auth Modal */}
      <DeleteAuthModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Eliminar Cliente"
        itemDescription={`el cliente "${deleteTarget?.name}"`}
      />
    </div>
  );
};
