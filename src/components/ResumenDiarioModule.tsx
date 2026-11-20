import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { Order, RestaurantTable } from '../types';
import { Reservation } from './ReservasModule';
import {
  DollarSign,
  Users,
  ChefHat,
  TrendingUp,
  Clock,
  CreditCard,
  Banknote,
  Smartphone,
  Calendar,
  CalendarClock,
  ArrowRight,
} from 'lucide-react';

interface ResumenDiarioProps {
  onOpenReservas?: () => void;
}

function getLocalTodayYYYYMMDD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const ResumenDiarioModule: React.FC<ResumenDiarioProps> = ({ onOpenReservas }) => {
  const { activeBranch } = useBranch();
  const [rawOrders, setRawOrders] = useState<Order[]>([]);
  const [rawTables, setRawTables] = useState<RestaurantTable[]>([]);
  const [rawReservations, setRawReservations] = useState<Reservation[]>([]);
  const [activeTab, setActiveTab] = useState<'ventas' | 'mesas' | 'cocina' | 'ticket'>('ventas');

  const [showAllTodayOrders, setShowAllTodayOrders] = useState(false);

  // Real-time orders listener
  useEffect(() => {
    const q = query(collection(db, 'orders'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Order[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }));
        setRawOrders(list);
      },
      (err) => console.warn('Resumen orders listener notice:', err?.code || err?.message)
    );
    return () => unsub();
  }, []);

  // Real-time tables listener
  useEffect(() => {
    const q = query(collection(db, 'tables'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: RestaurantTable[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<RestaurantTable, 'id'>) }));
        setRawTables(list);
      },
      (err) => console.warn('Resumen tables listener notice:', err?.code || err?.message)
    );
    return () => unsub();
  }, []);

  // Real-time reservations listener for daily alert
  useEffect(() => {
    const q = query(collection(db, 'reservations'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Reservation[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Reservation, 'id'>) }));
        setRawReservations(list);
      },
      (err) => console.warn('Resumen reservations listener notice:', err?.code || err?.message)
    );
    return () => unsub();
  }, []);

  const orders = useMemo(
    () => rawOrders.filter((o) => belongsToBranch(o.branch, activeBranch)),
    [rawOrders, activeBranch]
  );
  const tables = useMemo(
    () => rawTables.filter((t) => belongsToBranch(t.branch, activeBranch)),
    [rawTables, activeBranch]
  );
  const reservations = useMemo(
    () => rawReservations.filter((r) => belongsToBranch(r.branch, activeBranch)),
    [rawReservations, activeBranch]
  );

  const todayStr = getLocalTodayYYYYMMDD();
  const utcTodayStr = new Date().toISOString().split('T')[0];

  const todayReservations = useMemo(
    () =>
      reservations
        .filter(
          (r) =>
            (r.date === todayStr || r.date === utcTodayStr) &&
            r.status !== 'Cancelada' &&
            r.status !== 'Completada'
        )
        .sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    [reservations, todayStr, utcTodayStr]
  );

  const todayOrders = useMemo(
    () =>
      orders
        .filter((o) => {
          const d = (o.createdAt || '').split('T')[0];
          return d === todayStr || d === utcTodayStr;
        })
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [orders, todayStr, utcTodayStr]
  );

  const visibleTodayOrders = useMemo(
    () => (showAllTodayOrders ? todayOrders : todayOrders.slice(0, 50)),
    [todayOrders, showAllTodayOrders]
  );

  const { totalVentasHoy, occupiedTables, totalTables, enCocinaOrders, ticketPromedio, cashEstimated, cardEstimated, transferEstimated } =
    useMemo(() => {
      const totalVentas = todayOrders.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
      const occupied = tables.filter((t) => t.status === 'Ocupada').length;
      const totalTbl = tables.length || 6;
      const enCocina = orders.filter((o) => o.status === 'En Cocina' && o.sentToKitchen);
      const ticket = todayOrders.length > 0 ? totalVentas / todayOrders.length : 0;
      return {
        totalVentasHoy: totalVentas,
        occupiedTables: occupied,
        totalTables: totalTbl,
        enCocinaOrders: enCocina,
        ticketPromedio: ticket,
        cashEstimated: totalVentas * 0.45,
        cardEstimated: totalVentas * 0.4,
        transferEstimated: totalVentas * 0.15,
      };
    }, [todayOrders, tables, orders]);

  return (
    <div className="space-y-6 text-gray-900">
      {/* Top Banner */}
      <div className="bg-white border border-gray-200/90 rounded-3xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] shadow-xs shrink-0">
            <TrendingUp className="w-6 h-6 text-[#4A5D23]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900 tracking-tight">Resumen Diario</h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Supervisión de ventas, reservas del día, ocupación de mesas y despacho de cocina
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono font-bold text-gray-600 bg-gray-50 px-3.5 py-2 rounded-2xl border border-gray-200 self-start md:self-auto">
          <Calendar className="w-4 h-4 text-[#4A5D23]" />
          <span>Hoy: {new Date().toLocaleDateString('es-EC', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
      </div>

      {/* Prominent Daily Reservations Alert Card (FASE 1 Requirement) */}
      {todayReservations.length > 0 && (
        <div className="bg-amber-50/90 border-2 border-[#E89E2D] rounded-3xl p-5 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[#E89E2D] text-white flex items-center justify-center shadow-xs shrink-0">
                <CalendarClock className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#4A5D23] text-white">
                    Alerta de Reservas Hoy
                  </span>
                  <h3 className="text-base font-black text-gray-900">
                    Tienes {todayReservations.length} reserva(s) programada(s) para hoy
                  </h3>
                </div>
                <p className="text-xs text-amber-900/80 font-medium mt-0.5">
                  Prepara las mesas asignadas con anticipación para recibir a tus clientes puntualmente.
                </p>
              </div>
            </div>

            {onOpenReservas && (
              <button
                type="button"
                onClick={onOpenReservas}
                className="px-4 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
              >
                <span>Ir a Reservas</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
            {todayReservations.map((res) => (
              <div
                key={res.id}
                className="p-3 rounded-2xl bg-white border border-amber-200 shadow-xs flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-extrabold text-gray-900 truncate">{res.customerName}</div>
                  <div className="text-[11px] text-gray-600 flex items-center gap-2 mt-0.5 font-medium">
                    <span className="font-mono font-bold text-[#4A5D23] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {res.time}
                    </span>
                    <span>• {res.pax} pers.</span>
                    {res.tableNumber && <span>• Mesa {res.tableNumber}</span>}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                    res.status === 'Confirmada'
                      ? 'bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30'
                      : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}
                >
                  {res.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4 Interactive KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: Ventas de Hoy */}
        <div
          onClick={() => setActiveTab('ventas')}
          className={`p-5 rounded-3xl border transition-all cursor-pointer shadow-sm ${
            activeTab === 'ventas'
              ? 'bg-white border-[#4A5D23] ring-2 ring-[#4A5D23]/20 shadow-md'
              : 'bg-white border-gray-200/90 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500">
              Ventas de Hoy
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-[#E89E2D] flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-[#E89E2D] leading-tight">
            ${totalVentasHoy.toFixed(2)}
          </div>
          <div className="text-xs text-gray-500 mt-1 font-medium">
            {todayOrders.length} pedido(s) hoy
          </div>
        </div>

        {/* KPI 2: Mesas Ocupadas */}
        <div
          onClick={() => setActiveTab('mesas')}
          className={`p-5 rounded-3xl border transition-all cursor-pointer shadow-xs ${
            activeTab === 'mesas'
              ? 'bg-white border-[#4A5D23] ring-2 ring-[#4A5D23]/20 shadow-md'
              : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500">
              Mesas Ocupadas
            </span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-gray-900 leading-tight">
            {occupiedTables} <span className="text-base text-gray-400 font-normal">/ {totalTables}</span>
          </div>
          <div className="text-xs text-gray-500 mt-1 font-medium">
            {Math.max(0, totalTables - occupiedTables)} mesas libres
          </div>
        </div>

        {/* KPI 3: En Cocina */}
        <div
          onClick={() => setActiveTab('cocina')}
          className={`p-5 rounded-3xl border transition-all cursor-pointer shadow-xs ${
            activeTab === 'cocina'
              ? 'bg-white border-[#4A5D23] ring-2 ring-[#4A5D23]/20 shadow-md'
              : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500">
              En Cocina
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <ChefHat className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-purple-700 leading-tight">
            {enCocinaOrders.length} <span className="text-base font-bold">comandas</span>
          </div>
          <div className="text-xs text-gray-500 mt-1 font-medium">
            En preparación activa
          </div>
        </div>

        {/* KPI 4: Ticket Promedio */}
        <div
          onClick={() => setActiveTab('ticket')}
          className={`p-5 rounded-3xl border transition-all cursor-pointer shadow-xs ${
            activeTab === 'ticket'
              ? 'bg-white border-[#4A5D23] ring-2 ring-[#4A5D23]/20 shadow-md'
              : 'bg-white border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500">
              Ticket Promedio
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-[#4A5D23] flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-[#E89E2D] leading-tight">
            ${ticketPromedio.toFixed(2)}
          </div>
          <div className="text-xs text-gray-500 mt-1 font-medium">
            Promedio por mesa/orden
          </div>
        </div>
      </div>

      {/* Detail Sections depending on active tab */}
      <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-xs space-y-4">
        {activeTab === 'ventas' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900 text-base">Detalle de Ventas del Día</h3>
                <p className="text-xs text-gray-500">Estimación de recaudación por métodos de pago y transacciones</p>
              </div>
              <span className="font-mono text-xs font-bold text-[#4A5D23] bg-[#EAF5F0] px-3 py-1 rounded-xl">
                {todayOrders.length} pedidos hoy
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 text-[#4A5D23] flex items-center justify-center">
                    <Banknote className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-gray-700 block">Efectivo (Caja)</span>
                    <span className="text-base font-black font-mono text-gray-900">${cashEstimated.toFixed(2)}</span>
                  </div>
                </div>
                <span className="text-xs font-bold text-gray-400">45%</span>
              </div>

              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center">
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-gray-700 block">Tarjetas D/C</span>
                    <span className="text-base font-black font-mono text-gray-900">${cardEstimated.toFixed(2)}</span>
                  </div>
                </div>
                <span className="text-xs font-bold text-gray-400">40%</span>
              </div>

              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-gray-700 block">Transferencias / Deuna</span>
                    <span className="text-base font-black font-mono text-gray-900">${transferEstimated.toFixed(2)}</span>
                  </div>
                </div>
                <span className="text-xs font-bold text-gray-400">15%</span>
              </div>
            </div>

            {/* List of today orders */}
            <div className="pt-2">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Últimas Comandas Registradas Hoy
                </h4>
                {todayOrders.length > 50 && (
                  <button
                    type="button"
                    onClick={() => setShowAllTodayOrders((v) => !v)}
                    className="text-[11px] font-bold text-[#4A5D23] hover:underline cursor-pointer"
                  >
                    {showAllTodayOrders ? 'Ver últimas 50' : `Ver todas (${todayOrders.length})`}
                  </button>
                )}
              </div>
              {todayOrders.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-xs">
                  No se registran comandas facturadas hoy.
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {visibleTodayOrders.map((o) => (
                    <div
                      key={o.id}
                      className="p-3 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-xl bg-white border border-gray-200 font-bold flex items-center justify-center text-[#4A5D23]">
                          {o.tableNumber === 0 ? '🛵' : `M${o.tableNumber}`}
                        </span>
                        <div>
                          <span className="font-bold text-gray-900 block">
                            {o.tableNumber === 0 ? 'DOMICILIO' : `Mesa ${o.tableNumber}`} • Comanda #{o.id.substring(0, 5).toUpperCase()}
                          </span>
                          <span className="text-[10px] text-gray-500">
                            {o.items?.length || 0} producto(s) • {o.status}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-black text-sm text-[#E89E2D] block">
                          ${(Number(o.total) || 0).toFixed(2)}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {o.createdAt ? new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'mesas' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900 text-base">Estado de Salón</h3>
                <p className="text-xs text-gray-500">Disponibilidad de mesas y ocupación activa</p>
              </div>
              <span className="font-mono text-xs font-bold text-rose-700 bg-rose-50 px-3 py-1 rounded-xl">
                {occupiedTables} ocupadas de {totalTables}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {tables.map((table) => {
                const isOccupied = table.status === 'Ocupada';
                return (
                  <div
                    key={table.id}
                    className={`p-4 rounded-2xl border text-center transition-all ${
                      isOccupied
                        ? 'bg-rose-50/60 border-rose-300'
                        : 'bg-emerald-50/60 border-emerald-300'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center font-mono font-black text-base ${
                        isOccupied ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                      }`}
                    >
                      {table.tableNumber}
                    </div>
                    <div className="font-bold text-xs text-gray-900">Mesa {table.tableNumber}</div>
                    <div
                      className={`text-[10px] font-bold uppercase mt-1 ${
                        isOccupied ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {table.status}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'cocina' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900 text-base">Comandas en Cocina Activas</h3>
                <p className="text-xs text-gray-500">Pedidos actualmente en preparación por los cocineros</p>
              </div>
              <span className="font-mono text-xs font-bold text-purple-700 bg-purple-50 px-3 py-1 rounded-xl">
                {enCocinaOrders.length} en preparación
              </span>
            </div>

            {enCocinaOrders.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-xs">
                <ChefHat className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                No hay comandas pendientes en cocina. Todo al día.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {enCocinaOrders.map((o) => (
                  <div key={o.id} className="p-4 rounded-2xl bg-purple-50/50 border border-purple-200 text-xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-black text-sm text-gray-900">Mesa {o.tableNumber}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-200 text-purple-900">
                        En Preparación
                      </span>
                    </div>
                    <div className="space-y-1 text-gray-700">
                      {o.items?.map((it, idx) => (
                        <div key={idx} className="flex justify-between">
                          <span>{it.quantity}x {it.name}</span>
                          {it.notes && <span className="text-[#E89E2D] font-bold italic">"{it.notes}"</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'ticket' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900 text-base">Análisis de Ticket Promedio</h3>
                <p className="text-xs text-gray-500">Gasto medio por mesa y comportamiento de consumo</p>
              </div>
              <span className="font-mono text-sm font-black text-[#E89E2D]">
                ${ticketPromedio.toFixed(2)} / comanda
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 text-xs text-gray-700 leading-relaxed">
              <strong className="text-[#4A5D23] block text-sm mb-1">Rendimiento Operativo</strong>
              El ticket promedio se calcula dividiendo las ventas totales registradas hoy (${totalVentasHoy.toFixed(2)}) entre las comandas facturadas ({todayOrders.length}). Un promedio elevado indica mayor venta cruzada de entradas, bebidas y postres.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
