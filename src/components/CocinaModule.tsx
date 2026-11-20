import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  query,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useBranch, belongsToBranch, getBranchTableDocId } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { groupOrderCustomizations } from '../utils/customizationFormatters';
import { unlockKitchenAudio, playKitchenBellChime } from '../utils/kitchenAudio';
import { Order, OrderItem } from '../types';
import {
  ChefHat,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Flame,
  UtensilsCrossed,
  Bell,
  User,
  Tablet,
  Menu,
  X,
  Minimize2,
  Ban,
  Send,
  Check,
} from 'lucide-react';

function getElapsedMeta(nowMs: number, timestamp?: string) {
  if (!timestamp) return { text: '0:00 min', secondsTotal: 0, minutesTotal: 0 };
  const tsMs = new Date(timestamp).getTime();
  const diffMs = Number.isFinite(tsMs) ? Math.max(0, nowMs - tsMs) : 0;
  const totalSecs = Math.floor(diffMs / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return {
    text: `${mins}:${secs < 10 ? '0' : ''}${secs} min`,
    secondsTotal: totalSecs,
    minutesTotal: mins,
  };
}

/**
 * Computes color styling for elapsed kitchen wait time:
 * - 0 to 15 min (< 900s): VERDE
 * - 15 to 20 min (900s .. 1199s): NARANJA
 * - > 20 min (>= 1200s): ROJO
 */
function getTimerTierClasses(secondsTotal: number) {
  if (secondsTotal >= 1200) {
    return {
      tier: 'red' as const,
      cardBorder: 'border-rose-600 ring-2 ring-rose-500/20',
      headerBg: 'bg-rose-600 text-white',
      badgeBg: 'bg-rose-700 text-white border-rose-400',
      pill: 'bg-rose-100 border-rose-500 text-rose-800',
      label: '+20 min · URGENTE',
    };
  }
  if (secondsTotal >= 900) {
    return {
      tier: 'orange' as const,
      cardBorder: 'border-orange-500 ring-2 ring-orange-400/20',
      headerBg: 'bg-orange-500 text-white',
      badgeBg: 'bg-orange-600 text-white border-orange-300',
      pill: 'bg-orange-100 border-orange-400 text-orange-900',
      label: '15–20 min · ATENCIÓN',
    };
  }
  return {
    tier: 'green' as const,
    cardBorder: 'border-emerald-500',
    headerBg: 'bg-emerald-600 text-white',
    badgeBg: 'bg-emerald-700 text-white border-emerald-400',
    pill: 'bg-[#EAF5F0] border-emerald-500 text-emerald-800',
    label: '0–15 min · A TIEMPO',
  };
}

/**
 * Returns ONLY the dishes currently pending in kitchen (Solo Nuevos).
 * Prevents already-delivered dishes from reappearing when a table adds more items.
 */
function getKitchenDisplayItems(order: Order): OrderItem[] {
  if (Array.isArray(order.activeKitchenItems)) {
    return order.activeKitchenItems;
  }
  if (order.latestKitchenBatch?.isUpdate && Array.isArray(order.latestKitchenBatch.items)) {
    return order.latestKitchenBatch.items;
  }
  return order.items || [];
}

const KitchenElapsedTimer: React.FC<{ sentAt?: string }> = React.memo(({ sentAt }) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { text, secondsTotal } = getElapsedMeta(nowMs, sentAt);
  const tier = getTimerTierClasses(secondsTotal);

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-mono font-black border ${tier.pill}`}
    >
      <Clock className="w-3.5 h-3.5" />
      {text}
    </div>
  );
});

const HISTORY_DISPLAY_LIMIT = 50;

export const CocinaModule: React.FC = () => {
  const { activeBranch } = useBranch();
  const [rawOrders, setRawOrders] = useState<Order[]>([]);
  const [viewMode, setViewMode] = useState<'activas' | 'digitales' | 'historial'>('activas');
  const [deliveringId, setDeliveringId] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // "Comandas Digitales" Tablet Fullscreen states
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [drawerTab, setDrawerTab] = useState<'enviados' | 'cancelados'>('enviados');
  const [checkedDishesMap, setCheckedDishesMap] = useState<Record<string, boolean>>({});

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownDigitalKeysRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // Tick every second while in Comandas Digitales so timer colors (0-15 / 15-20 / +20) & live clock update smoothly
  useEffect(() => {
    if (viewMode !== 'digitales') return;
    setNowTickMs(Date.now());
    const interval = setInterval(() => setNowTickMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [viewMode]);

  const showErrorBanner = useCallback((msg: string) => {
    setErrorMsg(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorMsg(null), 5000);
  }, []);

  // Real-time Firebase listener on "orders" collection
  useEffect(() => {
    const q = query(collection(db, 'orders'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Order[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Omit<Order, 'id'>;
          list.push({ id: docSnap.id, ...data });
        });
        setRawOrders(list);
      },
      (err) => {
        console.error('Error al escuchar comandas de cocina:', err);
        showErrorBanner('No se pudieron sincronizar las comandas de cocina en tiempo real.');
      }
    );

    return () => unsubscribe();
  }, [showErrorBanner]);

  const { activeOrders, deliveredOrders, cancelledRecords } = useMemo(() => {
    const activas: Order[] = [];
    const entregadas: Order[] = [];
    const canceladas: Array<{
      id: string;
      tableLabel: string;
      cancelledAt: string;
      reason: string;
      authorizedBy: string;
      isFullOrderVoid: boolean;
      items: Array<{ name: string; quantity: number; dinerName?: string; reason?: string }>;
    }> = [];

    for (const order of rawOrders) {
      if (!belongsToBranch(order.branch, activeBranch)) continue;
      const displayItems = getKitchenDisplayItems(order);

      if (order.status === 'En Cocina' && order.sentToKitchen && displayItems.length > 0) {
        activas.push(order);
      } else if (order.status === 'Entregado' || (order.deliveredAt && order.status === 'Cobrado')) {
        entregadas.push(order);
      }

      const tableLabel =
        order.tableNumber === 0 || order.isDomicilio
          ? 'DOMICILIO'
          : order.tableName || `Mesa ${order.tableNumber}`;

      if (order.status === 'Anulado') {
        canceladas.push({
          id: `${order.id}_void`,
          tableLabel,
          cancelledAt: order.updatedAt || order.createdAt,
          reason: order.cancellationReason || 'Comanda anulada completamente',
          authorizedBy: order.authorizedBy || order.updatedBy || 'Administrador',
          isFullOrderVoid: true,
          items: (order.cancelledItems && order.cancelledItems.length > 0
            ? order.cancelledItems
            : order.items || []
          ).map((i) => ({
            name: i.name,
            quantity: Number(i.quantity) || 1,
            dinerName: i.dinerName,
          })),
        });
      } else if (Array.isArray(order.cancelledItems) && order.cancelledItems.length > 0) {
        canceladas.push({
          id: `${order.id}_items`,
          tableLabel,
          cancelledAt:
            order.cancelledItems[order.cancelledItems.length - 1]?.cancelledAt ||
            order.updatedAt ||
            order.createdAt,
          reason:
            order.cancelledItems[order.cancelledItems.length - 1]?.reason ||
            order.cancellationReason ||
            'Anulación parcial autorizada',
          authorizedBy:
            order.cancelledItems[order.cancelledItems.length - 1]?.authorizedBy ||
            order.authorizedBy ||
            'Administrador',
          isFullOrderVoid: false,
          items: order.cancelledItems.map((ci) => ({
            name: ci.name,
            quantity: Number(ci.quantity) || 1,
            dinerName: ci.dinerName,
            reason: ci.reason,
          })),
        });
      }
    }

    activas.sort((a, b) => {
      const timeA = new Date(a.sentToKitchenAt || a.createdAt).getTime();
      const timeB = new Date(b.sentToKitchenAt || b.createdAt).getTime();
      return timeA - timeB;
    });

    entregadas.sort((a, b) => {
      const timeA = new Date(a.deliveredAt || a.updatedAt || a.createdAt).getTime();
      const timeB = new Date(b.deliveredAt || b.updatedAt || b.createdAt).getTime();
      return timeB - timeA;
    });

    canceladas.sort(
      (a, b) => new Date(b.cancelledAt).getTime() - new Date(a.cancelledAt).getTime()
    );

    return {
      activeOrders: activas,
      deliveredOrders: entregadas,
      cancelledRecords: canceladas,
    };
  }, [rawOrders, activeBranch]);

  // Automatic Web Audio API bell chime in "Comandas Digitales" when new orders or updated batches arrive
  useEffect(() => {
    if (viewMode !== 'digitales') {
      knownDigitalKeysRef.current = null;
      return;
    }

    const currentKeys = new Set(
      activeOrders.map(
        (o) =>
          `${o.id}__b${o.latestKitchenBatch?.batchNumber || 1}__${o.latestKitchenBatch?.sentAt || o.sentToKitchenAt || ''}`
      )
    );

    if (knownDigitalKeysRef.current === null) {
      // First snapshot on entering Comandas Digitales: record baseline without chiming
      knownDigitalKeysRef.current = currentKeys;
      return;
    }

    let hasNewComanda = false;
    currentKeys.forEach((key) => {
      if (!knownDigitalKeysRef.current!.has(key)) {
        hasNewComanda = true;
      }
    });

    if (hasNewComanda) {
      playKitchenBellChime();
    }
    knownDigitalKeysRef.current = currentKeys;
  }, [activeOrders, viewMode]);

  const handleEnterComandasDigitales = useCallback(() => {
    void unlockKitchenAudio();
    setIsDrawerOpen(false);
    setViewMode('digitales');
    if (typeof document !== 'undefined') {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, []);

  const handleExitComandasDigitales = useCallback(() => {
    setIsDrawerOpen(false);
    setViewMode('activas');
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  const toggleDishChecked = useCallback((dishKey: string) => {
    setCheckedDishesMap((prev) => ({
      ...prev,
      [dishKey]: !prev[dishKey],
    }));
  }, []);

  // WORKFLOW & STATUS: Tap "Entregado" -> clears activeKitchenItems so old dishes NEVER reappear on updates
  const handleMarkAsDelivered = useCallback(
    async (order: Order) => {
      const prevRaw = rawOrders;
      const now = new Date().toISOString();
      setDeliveringId(order.id);
      setRawOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? {
                ...o,
                status: 'Entregado',
                activeKitchenItems: [],
                deliveredAt: now,
                updatedAt: now,
              }
            : o
        )
      );

      try {
        const orderRef = doc(db, 'orders', order.id);
        await commitOfflineSafe(
          updateDoc(orderRef, {
            status: 'Entregado',
            activeKitchenItems: [],
            deliveredAt: now,
            updatedAt: now,
          }),
          'kitchen_deliver_order'
        );

        if (order.tableNumber > 0) {
          const primaryId =
            order.tableId || getBranchTableDocId(order.tableNumber, order.branch || activeBranch);
          const allMergedIds = Array.from(
            new Set([primaryId, ...(order.mergedTableIds || [])].filter(Boolean))
          );
          await commitOfflineSafe(
            Promise.all(
              allMergedIds.map((tid) =>
                updateDoc(doc(db, 'tables', tid), {
                  orderStatus: 'Entregado',
                  lastDeliveredAt: now,
                  updatedAt: now,
                })
              )
            ),
            'kitchen_deliver_table'
          );
        }
      } catch (error: any) {
        console.error('Error al marcar comanda como entregada:', error);
        setRawOrders(prevRaw);
        showErrorBanner(error?.message || 'Error al marcar la comanda como entregada.');
      } finally {
        setDeliveringId(null);
      }
    },
    [rawOrders, activeBranch, showErrorBanner]
  );

  const totalDishesInKitchen = useMemo(
    () =>
      activeOrders.reduce(
        (acc, order) =>
          acc +
          getKitchenDisplayItems(order).reduce(
            (sum, item) => sum + (Number(item?.quantity) || 0),
            0
          ),
        0
      ),
    [activeOrders]
  );

  const visibleDeliveredOrders = useMemo(
    () => (showAllHistory ? deliveredOrders : deliveredOrders.slice(0, HISTORY_DISPLAY_LIMIT)),
    [deliveredOrders, showAllHistory]
  );

  // ============================================================================
  // FULLSCREEN TABLET KDS VIEW: "Comandas Digitales"
  // ============================================================================
  if (viewMode === 'digitales') {
    const liveClockText = new Date(nowTickMs).toLocaleTimeString('es-EC', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    return (
      <div className="fixed inset-0 z-[85] bg-[#F1F4F8] flex flex-col overflow-hidden text-gray-900 select-none">
        {/* Tablet Top Header Bar */}
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 shrink-0 shadow-xs">
          <div className="flex items-center gap-3 min-w-0">
            {/* 3-line Menu Toggle (≡) */}
            <button
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              className="w-11 h-11 rounded-2xl bg-gray-100 hover:bg-[#EAF5F0] border border-gray-200 hover:border-[#4A5D23] flex items-center justify-center text-gray-800 hover:text-[#4A5D23] transition-colors cursor-pointer shrink-0"
              title="Abrir historial de Pedidos Enviados y Cancelados"
              aria-label="Menú lateral"
            >
              <Menu className="w-6 h-6" />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Tablet className="w-5 h-5 text-[#E89E2D] shrink-0" />
                <h2 className="text-lg sm:text-xl font-black text-gray-900 tracking-tight truncate">
                  Comandas Digitales
                </h2>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-bold text-gray-500">
                <span className="text-emerald-700 font-black">0–15 min Verde</span>
                <span>·</span>
                <span className="text-orange-600 font-black">15–20 min Naranja</span>
                <span>·</span>
                <span className="text-rose-600 font-black">+20 min Rojo</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <div className="hidden md:flex items-center gap-3 bg-gray-50 px-3.5 py-2 rounded-2xl border border-gray-200 text-xs">
              <span className="font-black text-gray-900">{activeOrders.length} Activas</span>
              <span className="text-gray-300">|</span>
              <span className="font-mono font-bold text-[#4A5D23]">
                {totalDishesInKitchen} Platillos
              </span>
            </div>

            <div className="px-3.5 py-2 rounded-2xl bg-gray-900 text-white font-mono font-black text-sm tracking-wider shadow-xs">
              {liveClockText}
            </div>

            <button
              type="button"
              onClick={handleExitComandasDigitales}
              className="px-3.5 py-2 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-black flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Minimize2 className="w-4 h-4 text-[#E89E2D]" />
              <span className="hidden sm:inline">Salir de Pantalla Completa</span>
              <span className="sm:hidden">Salir</span>
            </button>
          </div>
        </header>

        {/* Main Tablet Cards Grid */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeOrders.length === 0 ? (
            <div className="h-full min-h-[360px] flex flex-col items-center justify-center bg-white border border-dashed border-gray-300 rounded-3xl p-8 text-center">
              <div className="w-20 h-20 rounded-3xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              </div>
              <h3 className="text-xl font-black text-gray-900">Sin comandas pendientes</h3>
              <p className="text-sm text-gray-500 mt-1 max-w-md">
                En cuanto llegue un nuevo pedido o actualización desde Mesas, sonará el timbre y la tarjeta aparecerá aquí automáticamente.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
              {activeOrders.map((order) => {
                const sentTimestamp = order.sentToKitchenAt || order.createdAt;
                const { text, secondsTotal } = getElapsedMeta(nowTickMs, sentTimestamp);
                const tier = getTimerTierClasses(secondsTotal);
                const displayItems = getKitchenDisplayItems(order);
                const isDomicilio = order.tableNumber === 0 || order.isDomicilio;
                const isUpdate = Boolean(order.latestKitchenBatch?.isUpdate);

                return (
                  <div
                    key={order.id}
                    className={`bg-white rounded-3xl border-[3px] shadow-md flex flex-col overflow-hidden transition-colors ${tier.cardBorder}`}
                  >
                    {/* Colored Card Header with Stopwatch */}
                    <div className={`px-4 py-3 flex items-center justify-between gap-2 ${tier.headerBg}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xl font-black tracking-tight">
                            {isDomicilio ? '🛵 DOMICILIO' : order.tableName || `Mesa ${order.tableNumber}`}
                          </span>
                          {isUpdate && (
                            <span className="px-2 py-0.5 rounded-md bg-white/25 text-white text-[10px] font-black uppercase">
                              Solo Nuevos
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] opacity-90 font-bold truncate">
                          #{order.id.substring(0, 6).toUpperCase()}
                          {order.waiterName ? ` · ${order.waiterName}` : ''}
                        </div>
                      </div>

                      <div
                        className={`px-3 py-1.5 rounded-2xl border font-mono font-black text-sm flex items-center gap-1.5 shrink-0 ${tier.badgeBg}`}
                      >
                        <Clock className="w-4 h-4" />
                        <span>{text}</span>
                      </div>
                    </div>

                    {/* Dishes List with Checkboxes, Grouped Sauces & Prominent Dish Notes */}
                    <div className="p-4 flex-1 divide-y divide-gray-100 space-y-2.5 max-h-[60vh] overflow-y-auto">
                      {displayItems.map((item, idx) => {
                        const dishKey = `${order.id}_${order.latestKitchenBatch?.batchNumber || 1}_${idx}_${item.name}`;
                        const isChecked = !!checkedDishesMap[dishKey];
                        const groupedCusts = groupOrderCustomizations(item.selectedCustomizations);

                        return (
                          <div
                            key={dishKey}
                            onClick={() => toggleDishChecked(dishKey)}
                            className={`cursor-pointer rounded-xl p-1.5 transition-colors ${
                              idx > 0 ? 'pt-3' : ''
                            } ${isChecked ? 'opacity-55 bg-gray-50' : 'hover:bg-gray-50/80'}`}
                          >
                            <div className="flex items-start gap-2.5">
                              {/* Checkbox */}
                              <div
                                className={`mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${
                                  isChecked
                                    ? 'bg-emerald-600 border-emerald-600 text-white'
                                    : 'bg-white border-gray-300 text-transparent'
                                }`}
                              >
                                <Check className="w-4 h-4 stroke-[3]" />
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center flex-wrap gap-1.5">
                                  <span className="font-mono font-black text-base text-[#4A5D23]">
                                    {item.quantity}x
                                  </span>
                                  <span
                                    className={`font-black text-base leading-snug ${
                                      isChecked ? 'line-through text-gray-500' : 'text-gray-900'
                                    }`}
                                  >
                                    {item.name}
                                  </span>
                                  {item.dinerName && item.dinerName.trim() !== '' && (
                                    <span className="px-2 py-0.5 rounded-md bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-[10px] font-black uppercase">
                                      {item.dinerName}
                                    </span>
                                  )}
                                </div>

                                {/* Grouped customizations: header ONCE + options stacked vertically */}
                                {groupedCusts.length > 0 && (
                                  <div className="mt-1.5 pl-1 space-y-1">
                                    {groupedCusts.map((grp, gIdx) => (
                                      <div key={gIdx} className="text-xs">
                                        <div className="font-black text-[#4A5D23] uppercase tracking-wide">
                                          {grp.groupLabel}
                                        </div>
                                        <div className="pl-2 space-y-0.5 text-gray-800 font-bold">
                                          {grp.options.map((opt, oIdx) => (
                                            <div key={oIdx}>• {opt.optionName}</div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Dish preparation note directly underneath dish in bold red */}
                                {item.notes && item.notes.trim() !== '' && (
                                  <div className="mt-2 px-2.5 py-1.5 rounded-xl bg-rose-50 border-l-4 border-rose-600 text-rose-800 text-xs font-black uppercase tracking-wide">
                                    NOTA: {item.notes}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* General Order Note pinned at the bottom before "Entregado" */}
                    {order.notes && order.notes.trim() !== '' && (
                      <div className="mx-4 mb-3 p-2.5 rounded-2xl bg-amber-50 border-2 border-[#E89E2D] text-amber-950">
                        <span className="text-[10px] font-black uppercase tracking-wider text-[#D97706] block">
                          Nota General de la Mesa:
                        </span>
                        <span className="text-xs font-black text-gray-900">"{order.notes}"</span>
                      </div>
                    )}

                    {/* Instant Entregado Button */}
                    <div className="p-3.5 bg-gray-50 border-t border-gray-200">
                      <button
                        type="button"
                        disabled={deliveringId === order.id}
                        onClick={() => handleMarkAsDelivered(order)}
                        className="w-full py-3.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 shadow-md active:scale-98 cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                        Entregado
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {/* Left 3-Line Sidebar Drawer: Pedidos Enviados vs Pedidos Cancelados */}
        {isDrawerOpen && (
          <div
            className="fixed inset-0 z-[95] bg-black/50 flex justify-start"
            onClick={() => setIsDrawerOpen(false)}
          >
            <aside
              className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                <div>
                  <h3 className="font-black text-base text-gray-900">Historial de Cocina</h3>
                  <p className="text-[11px] text-gray-500">
                    Pedidos enviados y cancelaciones autorizadas
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-2 rounded-xl bg-white border border-gray-200 text-gray-600 hover:text-gray-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 2 Tabs inside Sidebar Drawer */}
              <div className="p-3 border-b border-gray-200 grid grid-cols-2 gap-2 bg-white">
                <button
                  type="button"
                  onClick={() => setDrawerTab('enviados')}
                  className={`py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                    drawerTab === 'enviados'
                      ? 'bg-[#4A5D23] text-white shadow-xs'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Send className="w-3.5 h-3.5 text-[#E89E2D]" />
                  Pedidos Enviados ({deliveredOrders.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerTab('cancelados')}
                  className={`py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                    drawerTab === 'cancelados'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Ban className="w-3.5 h-3.5" />
                  Pedidos Cancelados ({cancelledRecords.length})
                </button>
              </div>

              {/* Drawer Content List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {drawerTab === 'enviados' ? (
                  deliveredOrders.length === 0 ? (
                    <div className="py-12 text-center text-xs text-gray-400">
                      No hay pedidos enviados todavía.
                    </div>
                  ) : (
                    deliveredOrders.slice(0, HISTORY_DISPLAY_LIMIT).map((ord) => (
                      <div
                        key={ord.id}
                        className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-black text-sm text-gray-900">
                            {ord.tableNumber === 0 || ord.isDomicilio
                              ? '🛵 DOMICILIO'
                              : ord.tableName || `Mesa ${ord.tableNumber}`}
                          </span>
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase">
                            Entregado ·{' '}
                            {new Date(ord.deliveredAt || ord.updatedAt || ord.createdAt).toLocaleTimeString(
                              'es-EC',
                              { hour: '2-digit', minute: '2-digit' }
                            )}
                          </span>
                        </div>
                        <div className="text-xs text-gray-700 space-y-1">
                          {(ord.items || []).map((it, idx) => (
                            <div key={idx}>
                              <span className="font-bold">
                                {it.quantity}x {it.name}
                              </span>
                              {it.dinerName && (
                                <span className="text-[10px] text-[#4A5D23] font-bold ml-1.5">
                                  [{it.dinerName}]
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )
                ) : cancelledRecords.length === 0 ? (
                  <div className="py-12 text-center text-xs text-gray-400">
                    No hay pedidos o platos cancelados registrados.
                  </div>
                ) : (
                  cancelledRecords.map((rec) => (
                    <div
                      key={rec.id}
                      className="p-3.5 rounded-2xl bg-rose-50/70 border border-rose-200 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black text-sm text-rose-900">{rec.tableLabel}</span>
                        <span className="px-2 py-0.5 rounded-lg bg-rose-600 text-white text-[10px] font-black uppercase">
                          {rec.isFullOrderVoid ? 'Anulado' : 'Plato Cancelado'}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-gray-800">
                        {rec.items.map((it, idx) => (
                          <div key={idx} className="font-bold">
                            {it.quantity}x {it.name}
                            {it.dinerName ? ` [${it.dinerName}]` : ''}
                          </div>
                        ))}
                      </div>
                      <div className="text-[11px] text-rose-800 pt-1.5 border-t border-rose-200/80 space-y-0.5">
                        <div>
                          <strong>Motivo:</strong> {rec.reason}
                        </div>
                        <div className="flex justify-between text-[10px] text-gray-600">
                          <span>Autorizó: {rec.authorizedBy}</span>
                          <span>
                            {new Date(rec.cancelledAt).toLocaleTimeString('es-EC', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // STANDARD KDS VIEW ("En Cocina" & "Entregados")
  // ============================================================================
  return (
    <div className="flex-1 flex flex-col space-y-5 text-gray-900">
      {/* Top Kitchen Display Bar */}
      <div className="bg-white border border-gray-200 rounded-3xl p-4 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#4A5D23]">
              KDS • Pantalla de Cocina y Despacho
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-gray-900 mt-1 flex items-center gap-2">
            <ChefHat className="w-6 h-6 text-[#E89E2D]" />
            Comandas de Cocina
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Los pedidos enviados desde Mesas aparecen automáticamente. Solo se muestran platos nuevos pendientes.
          </p>
        </div>

        {/* Stats & Controls (Zero mute/sound icons here per strict Parte 1 requirement) */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Metrics Pill */}
          <div className="flex items-center gap-3 bg-gray-50 px-4 py-2 rounded-2xl border border-gray-200 text-xs">
            <div className="flex items-center gap-1.5 pr-3 border-r border-gray-200">
              <Flame className="w-4 h-4 text-[#E89E2D] animate-pulse" />
              <span className="text-gray-900 font-extrabold">{activeOrders.length} Comandas</span>
            </div>
            <div className="flex items-center gap-1.5">
              <UtensilsCrossed className="w-4 h-4 text-[#4A5D23]" />
              <span className="text-[#4A5D23] font-mono font-bold">
                {totalDishesInKitchen} Platillos
              </span>
            </div>
          </div>

          {/* View Mode Toggle: En Cocina vs Comandas Digitales vs Entregados */}
          <div className="flex flex-wrap items-center gap-1 bg-gray-100 p-1 rounded-2xl border border-gray-200">
            <button
              type="button"
              onClick={() => setViewMode('activas')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'activas'
                  ? 'bg-[#4A5D23] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              En Cocina ({activeOrders.length})
            </button>
            <button
              type="button"
              onClick={handleEnterComandasDigitales}
              className="px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer bg-[#E89E2D] hover:bg-amber-500 text-slate-950 flex items-center gap-1.5 shadow-xs"
            >
              <Tablet className="w-3.5 h-3.5" />
              Comandas Digitales
            </button>
            <button
              type="button"
              onClick={() => setViewMode('historial')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'historial'
                  ? 'bg-[#4A5D23] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Entregados ({deliveredOrders.length})
            </button>
          </div>
        </div>
      </div>

      {/* Dismissible Error Alert */}
      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="font-bold hover:underline cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main KDS Comandas Grid */}
      {viewMode === 'activas' ? (
        activeOrders.length === 0 ? (
          <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200 p-8 flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-3xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] mb-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Cocina al día</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm">
              No hay comandas pendientes. En cuanto una mesa envíe una orden, aparecerá aquí al instante.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {activeOrders.map((order) => {
              const sentTimestamp = order.sentToKitchenAt || order.createdAt;
              const displayItems = getKitchenDisplayItems(order);
              const isDomicilio = order.tableNumber === 0 || order.isDomicilio;
              const isUpdate = Boolean(order.latestKitchenBatch?.isUpdate);

              return (
                <div
                  key={order.id}
                  className="bg-white border-2 border-gray-200 rounded-3xl shadow-sm hover:shadow-md flex flex-col justify-between overflow-hidden transition-all duration-200 animate-scale-in"
                >
                  {/* Card Header: Table Number & Live Timer */}
                  <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-12 h-12 rounded-2xl ${
                          isDomicilio
                            ? 'bg-[#4A5D23] text-white text-2xl'
                            : 'bg-[#E89E2D] text-slate-950 font-mono text-xl'
                        } font-black flex items-center justify-center shadow-xs`}
                      >
                        {isDomicilio ? '🛵' : `M${order.tableNumber}`}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-lg font-black text-gray-900">
                            {isDomicilio ? 'DOMICILIO' : order.tableName || `Mesa ${order.tableNumber}`}
                          </h4>
                          {isDomicilio && (
                            <span className="px-2.5 py-0.5 rounded-md text-[11px] font-black uppercase tracking-wider bg-amber-500 text-slate-950 shadow-xs border border-amber-600">
                              DOMICILIO
                            </span>
                          )}
                          {isUpdate && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-[#E89E2D] inline-flex items-center gap-1">
                              <Bell className="w-3 h-3 text-[#E89E2D]" />
                              Solo Nuevos
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-500 font-mono">
                          Comanda #{order.id.substring(0, 6).toUpperCase()}
                        </span>
                      </div>
                    </div>

                    {/* Isolated Timer Badge */}
                    <div className="text-right">
                      <KitchenElapsedTimer sentAt={sentTimestamp} />
                      <div className="text-[10px] text-gray-500 mt-1 font-mono">
                        Enviado:{' '}
                        {order.sentToKitchenAt
                          ? new Date(order.sentToKitchenAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })
                          : 'Reciente'}
                      </div>
                    </div>
                  </div>

                  {/* List of Active Kitchen Dishes (Solo Nuevos + Grouped Sauces) */}
                  <div className="p-5 flex-1 space-y-3.5 divide-y divide-gray-100 overflow-y-auto max-h-[380px]">
                    {displayItems.map((item, idx) => {
                      const groupedCusts = groupOrderCustomizations(item.selectedCustomizations);
                      return (
                        <div key={idx} className={idx > 0 ? 'pt-3' : ''}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2.5 flex-1">
                              <span className="w-7 h-7 rounded-xl bg-gray-100 border border-gray-200 font-mono font-black text-sm text-[#4A5D23] flex items-center justify-center shrink-0">
                                {item.quantity}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <h5 className="font-extrabold text-base text-gray-900 leading-tight">
                                    {item.name}
                                  </h5>
                                  {item.dinerName && item.dinerName.trim() !== '' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-[10px] font-black uppercase tracking-wider">
                                      <User className="w-3 h-3 text-[#E89E2D]" />
                                      {item.dinerName}
                                    </span>
                                  )}
                                </div>

                                {groupedCusts.length > 0 && (
                                  <div className="mt-1.5 space-y-1">
                                    {groupedCusts.map((grp, gIdx) => (
                                      <div
                                        key={gIdx}
                                        className="px-2.5 py-1.5 rounded-xl bg-gray-50 border border-gray-200 text-[11px]"
                                      >
                                        <div className="font-black text-[#4A5D23] uppercase">
                                          {grp.groupLabel}
                                        </div>
                                        <div className="pl-2 text-gray-800 font-bold space-y-0.5 mt-0.5">
                                          {grp.options.map((opt, oIdx) => (
                                            <div key={oIdx}>• {opt.optionName}</div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* HIGHLY VISIBLE CUSTOM NOTE in bold orange/gold (#E89E2D) */}
                          {item.notes && item.notes.trim() !== '' && (
                            <div className="mt-2 ml-9 p-2.5 rounded-xl bg-amber-50 border-2 border-[#E89E2D] text-amber-950 flex items-start gap-2 shadow-xs">
                              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#E89E2D]" />
                              <div>
                                <span className="text-[10px] font-black uppercase tracking-wider block text-[#E89E2D]">
                                  ⚠️ NOTA DE PREPARACIÓN:
                                </span>
                                <span className="text-xs font-black text-gray-900">
                                  "{item.notes}"
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* General Order Notes */}
                    {order.notes && order.notes.trim() !== '' && (
                      <div className="pt-3">
                        <div className="p-2.5 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-700">
                          <strong className="text-gray-900 block text-[10px] uppercase tracking-wider mb-0.5">
                            Nota General de la Comanda:
                          </strong>
                          "{order.notes}"
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card Footer: ONLY THE "Entregado" BUTTON */}
                  <div className="p-4 bg-gray-50 border-t border-gray-200">
                    <button
                      type="button"
                      disabled={deliveringId === order.id}
                      onClick={() => handleMarkAsDelivered(order)}
                      className="w-full py-3.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] border border-[#4A5D23] text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-md active:scale-98 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                      Entregado
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* HISTORIAL DE ENTREGADOS */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 px-1">
            <span>Últimas comandas despachadas y entregadas a mesas</span>
            <div className="flex items-center gap-2">
              <span>
                Mostrando {visibleDeliveredOrders.length} de {deliveredOrders.length}
              </span>
              {deliveredOrders.length > HISTORY_DISPLAY_LIMIT && (
                <button
                  type="button"
                  onClick={() => setShowAllHistory((v) => !v)}
                  className="px-2.5 py-1 rounded-lg bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30 font-bold hover:bg-[#dceee5] cursor-pointer"
                >
                  {showAllHistory ? 'Ver últimos 50' : `Ver todos (${deliveredOrders.length})`}
                </button>
              )}
            </div>
          </div>

          {deliveredOrders.length === 0 ? (
            <div className="py-16 text-center bg-white rounded-3xl border border-gray-200 p-8 text-gray-400 text-xs">
              Aún no se han despachado comandas en esta sesión.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleDeliveredOrders.map((order) => (
                <div
                  key={order.id}
                  className="p-4 rounded-2xl bg-white border border-gray-200 shadow-xs hover:border-[#4A5D23] transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-extrabold text-sm text-gray-900">
                      {order.tableNumber === 0 || order.isDomicilio
                        ? 'DOMICILIO'
                        : order.tableName || `Mesa ${order.tableNumber}`}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/20">
                      Entregado
                    </span>
                  </div>

                  <div className="text-xs text-gray-600 space-y-1 my-2">
                    {(order.items || []).map((i, idx) => {
                      const groupedCusts = groupOrderCustomizations(i.selectedCustomizations);
                      return (
                        <div key={idx} className="flex flex-col">
                          <div className="flex justify-between gap-2">
                            <span>
                              {i.quantity}x {i.name}
                              {i.dinerName ? ` · [${i.dinerName}]` : ''}
                            </span>
                            {i.notes && (
                              <span className="text-[#E89E2D] font-bold text-[10px]">
                                ("{i.notes}")
                              </span>
                            )}
                          </div>
                          {groupedCusts.length > 0 && (
                            <div className="text-[10px] text-[#4A5D23] pl-3 space-y-0.5">
                              {groupedCusts.map((grp, gIdx) => (
                                <div key={gIdx}>
                                  <span className="font-bold">{grp.groupLabel}</span>{' '}
                                  {grp.options.map((o) => o.optionName).join(', ')}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-[10px] text-gray-500 pt-2 border-t border-gray-100 flex justify-between font-mono">
                    <span>Total: ${(Number(order.total) || 0).toFixed(2)}</span>
                    <span>
                      {order.deliveredAt || order.updatedAt
                        ? new Date(order.deliveredAt || order.updatedAt || '').toLocaleTimeString()
                        : 'Despachado'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
