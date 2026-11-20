import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  setDoc,
  deleteDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { DeleteAuthModal } from './DeleteAuthModal';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  Calendar,
  Clock,
  Plus,
  Search,
  Phone,
  Trash2,
  Check,
  AlertCircle,
  X,
} from 'lucide-react';

export interface Reservation {
  id: string;
  customerName: string;
  phone: string;
  email?: string;
  date: string;
  time: string;
  pax: number;
  tableNumber?: number;
  status: 'Confirmada' | 'Pendiente' | 'Cancelada' | 'Completada';
  notes?: string;
  branch?: string;
  createdAt: string;
}

export const ReservasModule: React.FC = () => {
  const { activeBranch } = useBranch();
  const [rawReservations, setRawReservations] = useState<Reservation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 150);
  const [statusFilter, setStatusFilter] = useState<string>('Todas');
  const [showAllReservations, setShowAllReservations] = useState(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  // Form states - Completely EMPTY by default
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [pax, setPax] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [moduleError, setModuleError] = useState<string | null>(null);

  // Available tables list
  const [rawTables, setRawTables] = useState<{ id: string; tableNumber: number; branch?: string }[]>([]);

  // Security deletion modal state
  const [deleteTarget, setDeleteTarget] = useState<Reservation | null>(null);

  // Real-time listener for reservations and tables
  useEffect(() => {
    const qRes = query(collection(db, 'reservations'), orderBy('date', 'asc'));
    const unsubRes = onSnapshot(
      qRes,
      (snap) => {
        const list: Reservation[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as Reservation);
        });
        setRawReservations(list);
        setModuleError(null);
      },
      (err) => {
        console.error('Error al escuchar reservaciones:', err);
        setModuleError('No se pudo sincronizar las reservaciones con Firestore.');
      }
    );

    const qTables = query(collection(db, 'tables'), orderBy('tableNumber', 'asc'));
    const unsubTables = onSnapshot(
      qTables,
      (snap) => {
        const tList: { id: string; tableNumber: number; branch?: string }[] = [];
        snap.forEach((d) => {
          const dat = d.data();
          tList.push({ id: d.id, tableNumber: dat.tableNumber || 1, branch: dat.branch });
        });
        setRawTables(tList);
      },
      (err) => {
        console.error('Error al escuchar mesas:', err);
      }
    );

    return () => {
      unsubRes();
      unsubTables();
    };
  }, []);

  const reservations = useMemo(
    () => rawReservations.filter((r) => belongsToBranch(r.branch, activeBranch)),
    [rawReservations, activeBranch]
  );

  const availableTables = useMemo(
    () => rawTables.filter((t) => belongsToBranch(t.branch, activeBranch)),
    [rawTables, activeBranch]
  );

  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setFormError(null);

    const trimmedName = customerName.trim();
    if (!trimmedName) {
      setFormError('Por favor ingresa el nombre del cliente.');
      return;
    }
    if (!date) {
      setFormError('Por favor selecciona la fecha de la reserva.');
      return;
    }
    if (!time) {
      setFormError('Por favor selecciona la hora de la reserva.');
      return;
    }

    setIsSubmitting(true);
    try {
      const parsedPax = parseInt(pax, 10);
      const parsedTable = parseInt(tableNumber, 10);

      const payload = {
        customerName: trimmedName,
        phone: phone.trim() || 'Sin teléfono',
        email: email.trim() || '',
        date,
        time,
        pax: !isNaN(parsedPax) && parsedPax > 0 ? parsedPax : 2,
        tableNumber: !isNaN(parsedTable) && parsedTable > 0 ? parsedTable : 1,
        status: 'Confirmada',
        notes: notes.trim() || '',
        branch: activeBranch,
        createdAt: new Date().toISOString(),
      };

      const resRef = doc(collection(db, 'reservations'));
      await commitOfflineSafe(setDoc(resRef, payload), 'create_reservation');

      // Reset form to empty
      setCustomerName('');
      setPhone('');
      setEmail('');
      setDate('');
      setTime('');
      setPax('');
      setTableNumber('');
      setNotes('');
      setFormError(null);
      setIsNewModalOpen(false);
    } catch (err: any) {
      console.error('Error al crear reserva en Firestore:', err);
      setFormError(err?.message || 'Error al guardar la reserva en la base de datos.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: Reservation['status']) => {
    try {
      await commitOfflineSafe(
        updateDoc(doc(db, 'reservations', id), {
          status: newStatus,
          updatedAt: new Date().toISOString(),
        }),
        'update_reservation_status'
      );
      setModuleError(null);
    } catch (err: any) {
      console.error('Error al actualizar estado:', err);
      setModuleError('No se pudo actualizar el estado de la reserva: ' + (err?.message || 'Error'));
    }
  };

  const confirmDeleteReservation = async () => {
    if (!deleteTarget) return;
    try {
      await commitOfflineSafe(deleteDoc(doc(db, 'reservations', deleteTarget.id)), 'delete_reservation');
      setDeleteTarget(null);
      setModuleError(null);
    } catch (err: any) {
      console.error('Error al eliminar reserva:', err);
      setModuleError('No se pudo eliminar la reserva: ' + (err?.message || 'Error'));
      setDeleteTarget(null);
    }
  };

  const filteredReservations = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return reservations.filter((r) => {
      const matchesStatus = statusFilter === 'Todas' || r.status === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      return (
        (r.customerName || '').toLowerCase().includes(q) ||
        (r.phone || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q)
      );
    });
  }, [reservations, debouncedSearch, statusFilter]);

  const visibleReservations = useMemo(
    () => (showAllReservations ? filteredReservations : filteredReservations.slice(0, 50)),
    [filteredReservations, showAllReservations]
  );

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 flex items-center justify-center text-[#4A5D23]">
            <Clock className="w-6 h-6 text-[#4A5D23]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Reservas de Mesas</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30">
                Servicio
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Agenda de reservaciones, comensales por mesa y estados de confirmación
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCustomerName('');
              setPhone('');
              setEmail('');
              setDate('');
              setTime('');
              setPax('');
              setTableNumber('');
              setNotes('');
              setFormError(null);
              setIsNewModalOpen(true);
            }}
            className="px-4 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#E89E2D]" />
            Nueva Reserva
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

      {/* Filter and Search Bar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {['Todas', 'Confirmada', 'Pendiente', 'Completada', 'Cancelada'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-[#4A5D23] text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por cliente o teléfono..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none transition-colors w-full sm:w-64"
          />
        </div>
      </div>

      {/* Reservations Table / Cards */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm overflow-hidden">
        {visibleReservations.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-xs">
            <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="font-semibold text-gray-600">No hay reservas registradas</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Toca "Nueva Reserva" para agendar a un cliente.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider border-b border-gray-200 font-semibold text-[11px]">
                <tr>
                  <th className="p-3.5">Cliente</th>
                  <th className="p-3.5">Contacto</th>
                  <th className="p-3.5">Fecha y Hora</th>
                  <th className="p-3.5 text-center">Pax</th>
                  <th className="p-3.5 text-center">Mesa</th>
                  <th className="p-3.5 text-center">Estado</th>
                  <th className="p-3.5">Notas</th>
                  <th className="p-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleReservations.map((res) => (
                  <tr key={res.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="p-3.5 font-bold text-gray-900 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-[#EAF5F0] text-[#4A5D23] flex items-center justify-center font-bold text-xs shrink-0">
                        {(res.customerName || 'R').charAt(0).toUpperCase()}
                      </div>
                      {res.customerName}
                    </td>
                    <td className="p-3.5 font-mono text-gray-600">
                      <div className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-gray-400" />
                        {res.phone}
                      </div>
                    </td>
                    <td className="p-3.5 font-mono text-gray-700">
                      <div>{res.date}</div>
                      <div className="text-[10px] text-gray-500 font-bold">{res.time}</div>
                    </td>
                    <td className="p-3.5 text-center font-mono font-bold text-gray-900">
                      {res.pax}
                    </td>
                    <td className="p-3.5 text-center">
                      <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 font-mono font-bold text-xs border border-gray-200">
                        Mesa {res.tableNumber || 1}
                      </span>
                    </td>
                    <td className="p-3.5 text-center">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          res.status === 'Confirmada'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : res.status === 'Pendiente'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : res.status === 'Completada'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {res.status}
                      </span>
                    </td>
                    <td className="p-3.5 text-gray-500 text-[11px] max-w-xs truncate">
                      {res.notes || '-'}
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {res.status !== 'Completada' && (
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(res.id, 'Completada')}
                            className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
                            title="Marcar como sentada / completada"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(res)}
                          className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer"
                          title="Eliminar reserva (requiere clave admin)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filteredReservations.length > 50 && (
          <div className="pt-3 mt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>
              Mostrando {visibleReservations.length} de {filteredReservations.length} reservas
            </span>
            <button
              type="button"
              onClick={() => setShowAllReservations((prev) => !prev)}
              className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold cursor-pointer"
            >
              {showAllReservations ? 'Mostrar últimas 50' : `Ver todas (${filteredReservations.length})`}
            </button>
          </div>
        )}
      </div>

      {/* New Reservation Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-gray-200 text-gray-900">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-[#4A5D23]" />
                <h3 className="font-bold text-base text-gray-900">Nueva Reservación</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 cursor-pointer"
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

            <form noValidate onSubmit={handleCreateReservation} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Nombre del Cliente *</label>
                <input
                  type="text"
                  placeholder="Ej. Carlos Mendoza"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  required
                  className="w-full bg-[#F8F9FA] border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23] focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Teléfono / WhatsApp</label>
                  <input
                    type="tel"
                    placeholder="Ej. 0998765432"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-[#F8F9FA] border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Correo Electrónico</label>
                  <input
                    type="email"
                    placeholder="cliente@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#F8F9FA] border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23] focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Fecha *</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className="w-full bg-[#F8F9FA] border border-gray-300 rounded-xl px-2.5 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Hora *</label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    required
                    className="w-full bg-[#F8F9FA] border border-gray-300 rounded-xl px-2.5 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Comensales (Pax)</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    placeholder="Ej. 2"
                    value={pax}
                    onChange={(e) => setPax(e.target.value)}
                    className="w-full bg-[#F8F9FA] border border-gray-300 rounded-xl px-2.5 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23] focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Mesa Asignada / Sugerida</label>
                {availableTables.length > 0 ? (
                  <select
                    value={tableNumber}
                    onChange={(e) => setTableNumber(e.target.value)}
                    className="w-full bg-[#F8F9FA] border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23] focus:bg-white cursor-pointer font-bold"
                  >
                    <option value="">Seleccionar mesa...</option>
                    {availableTables.map((t) => (
                      <option key={t.id} value={t.tableNumber}>
                        Mesa {t.tableNumber}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    placeholder="Ej. 1"
                    value={tableNumber}
                    onChange={(e) => setTableNumber(e.target.value)}
                    className="w-full bg-[#F8F9FA] border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23] focus:bg-white"
                  />
                )}
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Notas Especiales / Ocasión</label>
                <textarea
                  rows={2}
                  placeholder="Ej. Aniversario, mesa junto a la ventana, alergia a mariscos..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-[#F8F9FA] border border-gray-300 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-[#4A5D23] focus:bg-white resize-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-bold cursor-pointer transition-all shadow-xs flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4 text-[#D97706]" />
                  {isSubmitting ? 'Guardando...' : 'Guardar Reserva'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Security Authorization Modal */}
      <DeleteAuthModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteReservation}
        title="Eliminar Reservación"
        itemDescription={`la reserva de ${deleteTarget?.customerName} para el ${deleteTarget?.date}`}
      />
    </div>
  );
};
