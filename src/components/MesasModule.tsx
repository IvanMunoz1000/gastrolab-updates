import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  query,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  orderBy,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBranch, belongsToBranch, getBranchTableDocId } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { RestaurantTable, Order, Product, TableShape } from '../types';
import { TableOrderModal } from './TableOrderModal';
import { DeleteAuthModal } from './DeleteAuthModal';
import {
  Plus,
  UtensilsCrossed,
  Clock,
  Users,
  CheckCircle2,
  Bike,
  Sliders,
  GripVertical,
  AlertTriangle,
  SlidersHorizontal,
  Search,
  X,
  CheckSquare,
  Square,
  Link2,
  Unlink,
  Move,
  LayoutGrid,
  Maximize2,
  Circle,
  Square as SquareIcon,
  RectangleHorizontal,
  Minus,
} from 'lucide-react';

const SHAPE_PRESETS: Record<
  TableShape,
  { label: string; width: number; height: number; description: string }
> = {
  cuadrada: {
    label: 'Cuadrada',
    width: 172,
    height: 148,
    description: 'Compacta estándar',
  },
  redonda: {
    label: 'Redonda',
    width: 162,
    height: 162,
    description: 'Mesa circular 50%',
  },
  rectangular: {
    label: 'Rectangular',
    width: 244,
    height: 138,
    description: 'Mesa grupal alargada',
  },
  barra: {
    label: 'Barra',
    width: 312,
    height: 106,
    description: 'Barra larga de atención',
  },
};

const getDefaultTableCoords = (idx: number) => {
  const col = idx % 5;
  const row = Math.floor(idx / 5);
  return {
    posX: 18 + col * 188,
    posY: 18 + row * 164,
  };
};

const INITIAL_6_TABLES: Omit<RestaurantTable, 'id'>[] = [
  {
    tableNumber: 1,
    name: 'Mesa 1',
    status: 'Libre',
    capacity: 4,
    total: 0,
    itemCount: 0,
    displayOrder: 1,
    shape: 'cuadrada',
    ...getDefaultTableCoords(0),
    width: SHAPE_PRESETS.cuadrada.width,
    height: SHAPE_PRESETS.cuadrada.height,
    mergedTables: [],
  },
  {
    tableNumber: 2,
    name: 'Mesa 2',
    status: 'Libre',
    capacity: 4,
    total: 0,
    itemCount: 0,
    displayOrder: 2,
    shape: 'cuadrada',
    ...getDefaultTableCoords(1),
    width: SHAPE_PRESETS.cuadrada.width,
    height: SHAPE_PRESETS.cuadrada.height,
    mergedTables: [],
  },
  {
    tableNumber: 3,
    name: 'Mesa 3',
    status: 'Libre',
    capacity: 2,
    total: 0,
    itemCount: 0,
    displayOrder: 3,
    shape: 'cuadrada',
    ...getDefaultTableCoords(2),
    width: SHAPE_PRESETS.cuadrada.width,
    height: SHAPE_PRESETS.cuadrada.height,
    mergedTables: [],
  },
  {
    tableNumber: 4,
    name: 'Mesa 4',
    status: 'Libre',
    capacity: 6,
    total: 0,
    itemCount: 0,
    displayOrder: 4,
    shape: 'cuadrada',
    ...getDefaultTableCoords(3),
    width: SHAPE_PRESETS.cuadrada.width,
    height: SHAPE_PRESETS.cuadrada.height,
    mergedTables: [],
  },
  {
    tableNumber: 5,
    name: 'Mesa 5',
    status: 'Libre',
    capacity: 4,
    total: 0,
    itemCount: 0,
    displayOrder: 5,
    shape: 'cuadrada',
    ...getDefaultTableCoords(4),
    width: SHAPE_PRESETS.cuadrada.width,
    height: SHAPE_PRESETS.cuadrada.height,
    mergedTables: [],
  },
  {
    tableNumber: 6,
    name: 'Mesa 6',
    status: 'Libre',
    capacity: 4,
    total: 0,
    itemCount: 0,
    displayOrder: 6,
    shape: 'cuadrada',
    ...getDefaultTableCoords(5),
    width: SHAPE_PRESETS.cuadrada.width,
    height: SHAPE_PRESETS.cuadrada.height,
    mergedTables: [],
  },
];

const TableElapsedBadge: React.FC<{ activeSince: string }> = React.memo(({ activeSince }) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const startedMs = new Date(activeSince).getTime();
  const mins = Number.isFinite(startedMs) ? Math.max(1, Math.round((nowMs - startedMs) / 60000)) : 1;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-gray-500">
      <Clock className="w-2.5 h-2.5 text-gray-400 shrink-0" />
      <span>{mins}m</span>
    </span>
  );
});

interface RenderTableEntry {
  master: RestaurantTable;
  isUnified: boolean;
  memberTables: RestaurantTable[];
  memberNumbers: number[];
  combinedCapacity: number;
  resolvedX: number;
  resolvedY: number;
  resolvedWidth: number;
  resolvedHeight: number;
  resolvedShape: TableShape;
}

export const MesasModule: React.FC = () => {
  const { userProfile } = useAuth();
  const { activeBranch } = useBranch();
  const canEditFloorPlan =
    userProfile?.role === 'Owner' || userProfile?.role === 'Admin';

  const [rawTables, setRawTables] = useState<RestaurantTable[]>([]);
  const [tablesFromServer, setTablesFromServer] = useState(false);
  const [rawOrders, setRawOrders] = useState<Order[]>([]);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [isAvailabilityModalOpen, setIsAvailabilityModalOpen] = useState(false);
  const [availabilityTab, setAvailabilityTab] = useState<'productos' | 'personalizados'>('productos');
  const [availabilitySearch, setAvailabilitySearch] = useState('');
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Floor Plan Layout, Drag/Resize, Shape Config Modal & Multi-Select Merge Mode
  const [isLayoutEditMode, setIsLayoutEditMode] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [showMobileCanvas, setShowMobileCanvas] = useState(false);

  // Shape & Size Configuration Modal state (opened via 6-dot handle click)
  const [configModalTableId, setConfigModalTableId] = useState<string | null>(null);
  const [configShape, setConfigShape] = useState<TableShape>('cuadrada');
  const [configWidth, setConfigWidth] = useState<number>(172);
  const [configHeight, setConfigHeight] = useState<number>(148);
  const [configCapacity, setConfigCapacity] = useState<number>(4);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Security deletion state for removing tables
  const [deleteTargetTable, setDeleteTargetTable] = useState<RestaurantTable | null>(null);

  const hasAttemptedSeedBranchRef = useRef<Set<string>>(new Set());
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const justDraggedAtRef = useRef<number>(0);

  const tables = useMemo(() => {
    const filtered = rawTables.filter((t) => belongsToBranch(t.branch, activeBranch));
    filtered.sort((a, b) => (a.displayOrder ?? a.tableNumber) - (b.displayOrder ?? b.tableNumber));
    return filtered;
  }, [rawTables, activeBranch]);

  const orders = useMemo(
    () => rawOrders.filter((o) => belongsToBranch(o.branch, activeBranch)),
    [rawOrders, activeBranch]
  );

  const showFeedback = useCallback((type: 'success' | 'error', text: string, duration = 3500) => {
    setFeedback({ type, text });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), duration);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  // Reset multi-select when switching branches
  useEffect(() => {
    setSelectedTableIds([]);
    setIsSelectionMode(false);
  }, [activeBranch]);

  // Pre-indexed O(1) lookup maps for active orders
  const { activeDomicilioOrder, activeOrdersById, activeOrdersByTableNumber } = useMemo(() => {
    const byId = new Map<string, Order>();
    const byTableNum = new Map<number, Order>();
    let domicilio: Order | undefined;

    for (const o of orders) {
      if (o.status === 'Cobrado' || o.status === 'Anulado') continue;
      byId.set(o.id, o);
      if ((o.tableNumber === 0 || (o as any).isDomicilio) && !domicilio) {
        domicilio = o;
      } else if (typeof o.tableNumber === 'number' && o.tableNumber > 0 && !byTableNum.has(o.tableNumber)) {
        byTableNum.set(o.tableNumber, o);
      }
    }

    return {
      activeDomicilioOrder: domicilio,
      activeOrdersById: byId,
      activeOrdersByTableNumber: byTableNum,
    };
  }, [orders]);

  // Reconcile tables with active orders in real time
  const effectiveTables = useMemo(() => {
    return tables.map((table) => {
      const liveOrder =
        (table.currentOrderId ? activeOrdersById.get(table.currentOrderId) : undefined) ||
        activeOrdersByTableNumber.get(table.tableNumber);

      if (liveOrder) {
        const liveItemCount =
          (liveOrder.items || []).reduce((acc, i) => acc + (Number(i?.quantity) || 0), 0) ??
          table.itemCount ??
          0;
        const liveTotal = Number(liveOrder.total ?? table.total ?? 0);
        return {
          ...table,
          status: 'Ocupada' as const,
          currentOrderId: liveOrder.id,
          total: liveTotal,
          itemCount: liveItemCount,
          activeSince: table.activeSince || liveOrder.createdAt,
          orderStatus: (liveOrder.status === 'Entregado' ? 'Entregado' : 'En Cocina') as
            | 'En Cocina'
            | 'Entregado',
        };
      }

      return table;
    });
  }, [tables, activeOrdersById, activeOrdersByTableNumber]);

  // Group unified tables into single fused blocks for visual & operational unity
  const { renderedTableEntries, canvasMinHeight, canvasMinWidth } = useMemo(() => {
    const byId = new Map(effectiveTables.map((t) => [t.id, t]));
    const consumedIds = new Set<string>();
    const entries: RenderTableEntry[] = [];

    effectiveTables.forEach((table, idx) => {
      if (consumedIds.has(table.id)) return;

      const rawGroup = Array.isArray(table.mergedTables)
        ? table.mergedTables.filter((id) => byId.has(id))
        : [];
      const isPartOfGroup = rawGroup.length > 1;

      if (isPartOfGroup) {
        const groupMembers = rawGroup
          .map((id) => byId.get(id)!)
          .sort((a, b) => a.tableNumber - b.tableNumber);
        const master =
          (table.mergedMasterId ? byId.get(table.mergedMasterId) : undefined) || groupMembers[0];

        if (master.id !== table.id) {
          // Defer rendering until we process the master (or render master right now and mark all consumed)
        }

        groupMembers.forEach((m) => consumedIds.add(m.id));
        const masterIdx = effectiveTables.findIndex((t) => t.id === master.id);
        const fallbackCoords = getDefaultTableCoords(masterIdx >= 0 ? masterIdx : idx);
        const resolvedShape: TableShape = master.shape || 'rectangular';
        const preset = SHAPE_PRESETS[resolvedShape] || SHAPE_PRESETS.rectangular;
        const resolvedX = typeof master.posX === 'number' ? master.posX : fallbackCoords.posX;
        const resolvedY = typeof master.posY === 'number' ? master.posY : fallbackCoords.posY;
        const defaultMergedW = Math.min(520, Math.max(256, 220 + (groupMembers.length - 2) * 52));
        const resolvedWidth =
          typeof master.width === 'number' && master.width >= 180
            ? master.width
            : Math.max(preset.width, defaultMergedW);
        const resolvedHeight =
          typeof master.height === 'number' && master.height >= 100
            ? master.height
            : Math.max(preset.height, 156);

        const memberNumbers = groupMembers.map((m) => m.tableNumber).sort((a, b) => a - b);
        const combinedCapacity = groupMembers.reduce((sum, m) => sum + (m.capacity || 4), 0);

        entries.push({
          master: {
            ...master,
            mergedTables: groupMembers.map((m) => m.id),
            mergedMasterId: master.id,
            mergedTableNumbers: memberNumbers,
          },
          isUnified: true,
          memberTables: groupMembers,
          memberNumbers,
          combinedCapacity,
          resolvedX,
          resolvedY,
          resolvedWidth,
          resolvedHeight,
          resolvedShape,
        });
      } else {
        consumedIds.add(table.id);
        const fallbackCoords = getDefaultTableCoords(idx);
        const resolvedShape: TableShape = table.shape || 'cuadrada';
        const preset = SHAPE_PRESETS[resolvedShape] || SHAPE_PRESETS.cuadrada;
        const resolvedX = typeof table.posX === 'number' ? table.posX : fallbackCoords.posX;
        const resolvedY = typeof table.posY === 'number' ? table.posY : fallbackCoords.posY;
        const resolvedWidth = typeof table.width === 'number' && table.width >= 100 ? table.width : preset.width;
        const resolvedHeight = typeof table.height === 'number' && table.height >= 85 ? table.height : preset.height;

        entries.push({
          master: table,
          isUnified: false,
          memberTables: [table],
          memberNumbers: [table.tableNumber],
          combinedCapacity: table.capacity || 4,
          resolvedX,
          resolvedY,
          resolvedWidth,
          resolvedHeight,
          resolvedShape,
        });
      }
    });

    entries.sort((a, b) => (a.master.displayOrder ?? a.master.tableNumber) - (b.master.displayOrder ?? b.master.tableNumber));

    let maxBottom = 520;
    let maxRight = 940;
    entries.forEach((entry) => {
      maxBottom = Math.max(maxBottom, entry.resolvedY + entry.resolvedHeight + 48);
      maxRight = Math.max(maxRight, entry.resolvedX + entry.resolvedWidth + 40);
    });

    return {
      renderedTableEntries: entries,
      canvasMinHeight: maxBottom,
      canvasMinWidth: maxRight,
    };
  }, [effectiveTables]);

  // Keep selectedTable continuously updated from live Firestore snapshots (preserving merged metadata)
  const liveSelectedTable = useMemo(() => {
    if (!selectedTable) return null;
    if (selectedTable.id === 'mesa_domicilio' || selectedTable.tableNumber === 0) {
      return {
        id: 'mesa_domicilio',
        tableNumber: 0,
        name: 'DOMICILIO',
        status: (activeDomicilioOrder ? 'Ocupada' : 'Libre') as 'Libre' | 'Ocupada',
        currentOrderId: activeDomicilioOrder ? activeDomicilioOrder.id : undefined,
        capacity: 0,
        total: activeDomicilioOrder ? activeDomicilioOrder.total || 0 : 0,
        itemCount: activeDomicilioOrder
          ? activeDomicilioOrder.items?.reduce((acc, i) => acc + i.quantity, 0) || 0
          : 0,
        activeSince: activeDomicilioOrder?.createdAt,
      } as RestaurantTable;
    }
    const matchingEntry = renderedTableEntries.find(
      (e) =>
        e.master.id === selectedTable.id ||
        e.memberTables.some((m) => m.id === selectedTable.id)
    );
    if (matchingEntry) return matchingEntry.master;
    return effectiveTables.find((t) => t.id === selectedTable.id) || selectedTable;
  }, [selectedTable, renderedTableEntries, effectiveTables, activeDomicilioOrder]);

  // Open Domicilio order modal
  const handleOpenDomicilioOrder = () => {
    const domicilioTable: RestaurantTable = {
      id: 'mesa_domicilio',
      tableNumber: 0,
      name: 'DOMICILIO',
      status: activeDomicilioOrder ? 'Ocupada' : 'Libre',
      currentOrderId: activeDomicilioOrder ? activeDomicilioOrder.id : undefined,
      capacity: 0,
      total: activeDomicilioOrder ? activeDomicilioOrder.total || 0 : 0,
      itemCount: activeDomicilioOrder
        ? activeDomicilioOrder.items?.reduce((acc, i) => acc + i.quantity, 0) || 0
        : 0,
      activeSince: activeDomicilioOrder?.createdAt,
    };
    setSelectedTable(domicilioTable);
  };

  // Listen to tables
  useEffect(() => {
    const q = query(collection(db, 'tables'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: RestaurantTable[] = [];
        const invalidIds: string[] = [];

        snapshot.forEach((d) => {
          const data = d.data() as Omit<RestaurantTable, 'id'>;
          if (d.id === 'mesa_domicilio' || d.id === 'mesa_0' || !data.tableNumber || data.tableNumber <= 0) {
            invalidIds.push(d.id);
          } else {
            list.push({ id: d.id, ...data });
          }
        });

        for (const invalidId of invalidIds) {
          deleteDoc(doc(db, 'tables', invalidId)).catch(() => {});
        }

        setRawTables(list);
        setTablesFromServer(!snapshot.metadata.fromCache);
      },
      (err) => {
        console.error('Error al escuchar mesas:', err);
        showFeedback('error', 'Error de sincronización al cargar el plano de mesas.');
      }
    );

    return () => unsubscribe();
  }, [showFeedback]);

  // Auto-seed 6 default tables per branch
  useEffect(() => {
    if (!tablesFromServer || tables.length > 0) return;
    if (hasAttemptedSeedBranchRef.current.has(activeBranch)) return;
    hasAttemptedSeedBranchRef.current.add(activeBranch);

    const seedBranchTables = async () => {
      try {
        const batch = writeBatch(db);
        const now = new Date().toISOString();
        for (const t of INITIAL_6_TABLES) {
          const tableId = getBranchTableDocId(t.tableNumber, activeBranch);
          const ref = doc(db, 'tables', tableId);
          batch.set(ref, {
            ...t,
            id: tableId,
            branch: activeBranch,
            createdAt: now,
            updatedAt: now,
          });
        }
        await commitOfflineSafe(batch.commit(), `seed_tables_${activeBranch}`);
      } catch (seedErr: any) {
        console.error('Error al inicializar mesas:', seedErr);
        showFeedback('error', 'No se pudieron inicializar las mesas automáticamente. Verifica tu conexión.');
      }
    };
    void seedBranchTables();
  }, [tablesFromServer, tables.length, activeBranch, showFeedback]);

  // Listen to orders
  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Order[] = [];
        snapshot.forEach((d) => list.push({ id: d.id, ...d.data() } as Order));
        setRawOrders(list);
      },
      (err) => {
        console.warn('Mesas orders listener notice:', err);
        showFeedback('error', 'No se pudieron sincronizar las comandas en tiempo real.');
      }
    );
    return () => unsubscribe();
  }, [showFeedback]);

  // Listen to Carta products when Disponibilidad modal is open
  useEffect(() => {
    if (!isAvailabilityModalOpen) return;
    const unsub = onSnapshot(
      query(collection(db, 'products')),
      (snap) => {
        const list: Product[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }));
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setCatalogProducts(list);
      },
      (err) => {
        console.warn('Mesas availability products listener notice:', err);
        showFeedback('error', 'No se pudo cargar la disponibilidad de Carta.');
      }
    );
    return () => unsub();
  }, [isAvailabilityModalOpen, showFeedback]);

  const sortedAvailabilityProducts = useMemo(() => {
    const q = availabilitySearch.trim().toLowerCase();
    if (!q) return catalogProducts;
    return catalogProducts.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
    );
  }, [catalogProducts, availabilitySearch]);

  const groupedCustomOptions = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        groupName: string;
        optionName: string;
        extraPrice: number;
        available: boolean;
        productNames: string[];
        productIds: string[];
      }
    >();

    catalogProducts.forEach((prod) => {
      (prod.customizations || []).forEach((group) => {
        (group.options || []).forEach((opt) => {
          const gName = (group.name || '').trim();
          const oName = (opt.name || '').trim();
          if (!oName) return;
          const key = `${gName.toLowerCase()}||${oName.toLowerCase()}`;
          const optAvailable = opt.available !== false;
          const existing = map.get(key);
          if (existing) {
            if (!existing.productIds.includes(prod.id)) {
              existing.productIds.push(prod.id);
              existing.productNames.push(prod.name);
            }
            if (optAvailable) existing.available = true;
          } else {
            map.set(key, {
              key,
              groupName: gName || 'Personalizado',
              optionName: oName,
              extraPrice: Number(opt.extraPrice) || 0,
              available: optAvailable,
              productNames: [prod.name],
              productIds: [prod.id],
            });
          }
        });
      });
    });

    const list = Array.from(map.values()).sort((a, b) =>
      `${a.groupName} ${a.optionName}`.localeCompare(`${b.groupName} ${b.optionName}`)
    );
    const q = availabilitySearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (item) =>
        item.optionName.toLowerCase().includes(q) ||
        item.groupName.toLowerCase().includes(q) ||
        item.productNames.some((n) => n.toLowerCase().includes(q))
    );
  }, [catalogProducts, availabilitySearch]);

  const handleToggleProductAvailability = async (product: Product) => {
    if (togglingKey) return;
    const currentlyAvailable = product.available !== false;
    const nextAvailable = !currentlyAvailable;
    setTogglingKey(`prod_${product.id}`);
    setCatalogProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, available: nextAvailable } : p))
    );
    try {
      await commitOfflineSafe(
        updateDoc(doc(db, 'products', product.id), {
          available: nextAvailable,
          updatedAt: new Date().toISOString(),
        }),
        'toggle_product_availability'
      );
    } catch (err: any) {
      setCatalogProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, available: currentlyAvailable } : p))
      );
      showFeedback('error', err?.message || 'Error al actualizar disponibilidad del producto.');
    } finally {
      setTogglingKey(null);
    }
  };

  const handleToggleCustomOptionAvailability = async (entry: {
    key: string;
    groupName: string;
    optionName: string;
    available: boolean;
    productIds: string[];
  }) => {
    if (togglingKey) return;
    const nextAvailable = !entry.available;
    const gTarget = entry.groupName.trim().toLowerCase();
    const oTarget = entry.optionName.trim().toLowerCase();
    setTogglingKey(`opt_${entry.key}`);

    const prevSnapshot = catalogProducts;
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    let updatedCount = 0;

    const updatedProducts = catalogProducts.map((prod) => {
      if (!entry.productIds.includes(prod.id) || !prod.customizations) return prod;
      let touched = false;
      const nextCustomizations = prod.customizations.map((group) => {
        if ((group.name || '').trim().toLowerCase() !== gTarget) return group;
        const nextOptions = (group.options || []).map((opt) => {
          if ((opt.name || '').trim().toLowerCase() !== oTarget) return opt;
          touched = true;
          return { ...opt, available: nextAvailable };
        });
        return { ...group, options: nextOptions };
      });
      if (touched) {
        updatedCount += 1;
        batch.update(doc(db, 'products', prod.id), {
          customizations: nextCustomizations,
          updatedAt: now,
        });
        return { ...prod, customizations: nextCustomizations };
      }
      return prod;
    });

    setCatalogProducts(updatedProducts);
    try {
      if (updatedCount > 0) {
        await commitOfflineSafe(batch.commit(), 'toggle_custom_option_availability');
      }
    } catch (err: any) {
      setCatalogProducts(prevSnapshot);
      showFeedback('error', err?.message || 'Error al actualizar disponibilidad de personalizado.');
    } finally {
      setTogglingKey(null);
    }
  };

  // Dynamically add a new table with neat non-overlapping default coordinates
  const handleAddTable = async () => {
    const currentMax = tables.reduce((max, t) => Math.max(max, t.tableNumber), 0);
    const currentMaxOrder = tables.reduce((max, t, idx) => Math.max(max, t.displayOrder ?? idx + 1), 0);
    const newNumber = Math.max(1, currentMax + 1);
    const tableId = getBranchTableDocId(newNumber, activeBranch);
    const coords = getDefaultTableCoords(tables.length);

    try {
      await commitOfflineSafe(
        setDoc(doc(db, 'tables', tableId), {
          id: tableId,
          tableNumber: newNumber,
          name: `Mesa ${newNumber}`,
          status: 'Libre',
          capacity: 4,
          total: 0,
          itemCount: 0,
          displayOrder: currentMaxOrder + 1,
          shape: 'cuadrada',
          posX: coords.posX,
          posY: coords.posY,
          width: SHAPE_PRESETS.cuadrada.width,
          height: SHAPE_PRESETS.cuadrada.height,
          mergedTables: [],
          branch: activeBranch,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        'add_table'
      );
      showFeedback('success', `Mesa ${newNumber} agregada al plano (${activeBranch}).`);
      setIsManageModalOpen(false);
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al agregar mesa.');
    }
  };

  // Remove table through security authorization
  const confirmDeleteTable = async () => {
    if (!deleteTargetTable) return;
    try {
      await commitOfflineSafe(deleteDoc(doc(db, 'tables', deleteTargetTable.id)), 'delete_table');
      showFeedback('success', `Mesa ${deleteTargetTable.tableNumber} eliminada del plano.`);
      setDeleteTargetTable(null);
      setIsManageModalOpen(false);
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al eliminar mesa.');
    }
  };

  // Open Table Shape & Size Config Modal
  const openConfigModalForEntry = useCallback(
    (entry: RenderTableEntry) => {
      setConfigModalTableId(entry.master.id);
      setConfigShape(entry.resolvedShape);
      setConfigWidth(Math.round(entry.resolvedWidth));
      setConfigHeight(Math.round(entry.resolvedHeight));
      setConfigCapacity(entry.master.capacity || 4);
    },
    []
  );

  const handleSelectShapeInModal = (shape: TableShape) => {
    setConfigShape(shape);
    const preset = SHAPE_PRESETS[shape];
    setConfigWidth(preset.width);
    setConfigHeight(preset.height);
  };

  const handleSaveTableConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configModalTableId || isSavingConfig) return;
    if (!canEditFloorPlan) {
      showFeedback('error', 'Solo el Propietario o Administrador puede modificar la forma del plano.');
      return;
    }

    const safeW = Math.min(540, Math.max(115, Number(configWidth) || 172));
    const safeH = Math.min(420, Math.max(88, Number(configHeight) || 148));
    const safeCap = Math.min(40, Math.max(1, Number(configCapacity) || 4));
    const finalH = configShape === 'redonda' ? safeW : safeH;
    const now = new Date().toISOString();

    setIsSavingConfig(true);
    setRawTables((prev) =>
      prev.map((t) =>
        t.id === configModalTableId
          ? { ...t, shape: configShape, width: safeW, height: finalH, capacity: safeCap }
          : t
      )
    );

    try {
      await commitOfflineSafe(
        updateDoc(doc(db, 'tables', configModalTableId), {
          shape: configShape,
          width: safeW,
          height: finalH,
          capacity: safeCap,
          updatedAt: now,
        }),
        'save_table_shape'
      );
      showFeedback('success', `Diseño de mesa (${SHAPE_PRESETS[configShape].label}) guardado.`, 2400);
      setConfigModalTableId(null);
    } catch (err: any) {
      showFeedback('error', err?.message || 'Error al guardar diseño de mesa.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Auto-tidy tables into neat compact grid coordinates
  const handleAutoArrangeGrid = async () => {
    if (!canEditFloorPlan || renderedTableEntries.length === 0) return;
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    const updates = new Map<string, { posX: number; posY: number }>();

    let cursorX = 18;
    let cursorY = 18;
    let rowMaxH = 0;
    const maxRowWidth = 940;

    renderedTableEntries.forEach((entry) => {
      if (cursorX + entry.resolvedWidth > maxRowWidth && cursorX > 18) {
        cursorX = 18;
        cursorY += rowMaxH + 18;
        rowMaxH = 0;
      }
      updates.set(entry.master.id, { posX: cursorX, posY: cursorY });
      batch.update(doc(db, 'tables', entry.master.id), {
        posX: cursorX,
        posY: cursorY,
        updatedAt: now,
      });
      cursorX += entry.resolvedWidth + 18;
      rowMaxH = Math.max(rowMaxH, entry.resolvedHeight);
    });

    setRawTables((prev) =>
      prev.map((t) => {
        const u = updates.get(t.id);
        return u ? { ...t, posX: u.posX, posY: u.posY } : t;
      })
    );

    try {
      await commitOfflineSafe(batch.commit(), 'auto_arrange_tables');
      showFeedback('success', 'Mesas alineadas ordenadamente en el plano.', 2200);
    } catch {
      showFeedback('error', 'No se pudo guardar la alineación en la nube.');
    }
  };

  // Zero-lag GPU-accelerated Pointer Drag (from 6-dot handle OR card in Edit Mode)
  const startPointerDrag = useCallback(
    (
      e: React.PointerEvent<HTMLElement>,
      entry: RenderTableEntry,
      originatedOnSixDots: boolean
    ) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (!canEditFloorPlan) {
        if (originatedOnSixDots) {
          e.stopPropagation();
          showFeedback('error', 'Solo el Propietario puede mover o cambiar la forma de las mesas.');
        }
        return;
      }

      e.stopPropagation();
      const targetEl = cardRefs.current.get(entry.master.id);
      if (!targetEl) return;

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const origX = entry.resolvedX;
      const origY = entry.resolvedY;
      let latestDx = 0;
      let latestDy = 0;
      let hasMoved = false;
      let rafId: number | null = null;

      targetEl.style.zIndex = '40';
      targetEl.style.transition = 'none';
      targetEl.style.willChange = 'transform';

      const onPointerMove = (moveEvt: PointerEvent) => {
        const dx = moveEvt.clientX - startClientX;
        const dy = moveEvt.clientY - startClientY;
        if (!hasMoved && Math.hypot(dx, dy) < 5) return;
        hasMoved = true;

        const clampedDx = Math.max(8 - origX, dx);
        const clampedDy = Math.max(8 - origY, dy);
        latestDx = clampedDx;
        latestDy = clampedDy;

        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          targetEl.style.transform = `translate3d(${latestDx}px, ${latestDy}px, 0)`;
        });
      };

      const onPointerUp = async () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        if (rafId !== null) cancelAnimationFrame(rafId);

        targetEl.style.transform = '';
        targetEl.style.zIndex = '';
        targetEl.style.transition = '';
        targetEl.style.willChange = '';

        if (!hasMoved) {
          if (originatedOnSixDots) {
            openConfigModalForEntry(entry);
          }
          return;
        }

        justDraggedAtRef.current = Date.now();
        const finalX = Math.max(8, Math.round(origX + latestDx));
        const finalY = Math.max(8, Math.round(origY + latestDy));
        const now = new Date().toISOString();

        setRawTables((prev) =>
          prev.map((t) =>
            t.id === entry.master.id ? { ...t, posX: finalX, posY: finalY } : t
          )
        );

        try {
          await commitOfflineSafe(
            updateDoc(doc(db, 'tables', entry.master.id), {
              posX: finalX,
              posY: finalY,
              updatedAt: now,
            }),
            'save_table_position'
          );
        } catch (err) {
          console.warn('Error al guardar posición de mesa:', err);
          showFeedback('error', 'No se pudo guardar la posición de la mesa.');
        }
      };

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    },
    [canEditFloorPlan, openConfigModalForEntry, showFeedback]
  );

  // Zero-lag Pointer Resize (bottom-right corner)
  const startPointerResize = useCallback(
    (e: React.PointerEvent<HTMLElement>, entry: RenderTableEntry) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      if (!canEditFloorPlan) return;

      const targetEl = cardRefs.current.get(entry.master.id);
      if (!targetEl) return;

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const origW = entry.resolvedWidth;
      const origH = entry.resolvedHeight;
      let latestW = origW;
      let latestH = origH;
      let hasResized = false;
      let rafId: number | null = null;

      targetEl.style.zIndex = '40';
      targetEl.style.transition = 'none';

      const onPointerMove = (moveEvt: PointerEvent) => {
        const dx = moveEvt.clientX - startClientX;
        const dy = moveEvt.clientY - startClientY;
        if (!hasResized && Math.hypot(dx, dy) < 4) return;
        hasResized = true;

        const nextW = Math.min(540, Math.max(120, Math.round(origW + dx)));
        const nextH =
          entry.resolvedShape === 'redonda'
            ? nextW
            : Math.min(420, Math.max(90, Math.round(origH + dy)));
        latestW = nextW;
        latestH = nextH;

        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          targetEl.style.width = `${latestW}px`;
          targetEl.style.height = `${latestH}px`;
        });
      };

      const onPointerUp = async () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        if (rafId !== null) cancelAnimationFrame(rafId);

        targetEl.style.zIndex = '';
        targetEl.style.transition = '';

        if (!hasResized) return;

        justDraggedAtRef.current = Date.now();
        const now = new Date().toISOString();

        setRawTables((prev) =>
          prev.map((t) =>
            t.id === entry.master.id ? { ...t, width: latestW, height: latestH } : t
          )
        );

        try {
          await commitOfflineSafe(
            updateDoc(doc(db, 'tables', entry.master.id), {
              width: latestW,
              height: latestH,
              updatedAt: now,
            }),
            'save_table_size'
          );
        } catch (err) {
          console.warn('Error al guardar tamaño de mesa:', err);
          showFeedback('error', 'No se pudo guardar el nuevo tamaño de la mesa.');
        }
      };

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    },
    [canEditFloorPlan, showFeedback]
  );

  // Toggle table selection for Unificar Mesas
  const toggleSelectEntry = (entry: RenderTableEntry) => {
    const id = entry.master.id;
    setSelectedTableIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Unify 2+ selected tables into ONE fused reception block + master account
  const handleUnifyTables = async () => {
    if (isMerging || selectedTableIds.length < 2) return;

    const selectedEntries = renderedTableEntries.filter((e) =>
      selectedTableIds.includes(e.master.id)
    );
    const allMemberTables = selectedEntries.flatMap((e) => e.memberTables);
    const uniqueMembersMap = new Map(allMemberTables.map((t) => [t.id, t]));
    const memberList = Array.from(uniqueMembersMap.values()).sort(
      (a, b) => a.tableNumber - b.tableNumber
    );

    if (memberList.length < 2) {
      showFeedback('error', 'Selecciona al menos 2 mesas para unificar.');
      return;
    }

    // Check if multiple selected tables already have separate active orders
    const activeOrdersInGroup = new Set(
      memberList
        .filter((m) => m.status === 'Ocupada' && m.currentOrderId)
        .map((m) => m.currentOrderId!)
    );

    if (activeOrdersInGroup.size > 1) {
      showFeedback(
        'error',
        'No puedes unificar mesas con dos cuentas abiertas diferentes al mismo tiempo. Cobra o libera una primero.'
      );
      return;
    }

    // Master table: prefer whichever currently holds an open order, otherwise lowest tableNumber
    const occupiedOwner = memberList.find((m) => m.status === 'Ocupada' && m.currentOrderId);
    const master = occupiedOwner || memberList[0];
    const memberIds = memberList.map((m) => m.id);
    const memberNumbers = memberList.map((m) => m.tableNumber).sort((a, b) => a - b);

    const masterShape: TableShape =
      master.shape === 'barra' ? 'barra' : 'rectangular';
    const currentW =
      typeof master.width === 'number'
        ? master.width
        : SHAPE_PRESETS[master.shape || 'cuadrada'].width;
    const currentH =
      typeof master.height === 'number'
        ? master.height
        : SHAPE_PRESETS[master.shape || 'cuadrada'].height;
    const mergedW = Math.min(520, Math.max(currentW, 240 + (memberIds.length - 2) * 48));
    const mergedH = Math.max(currentH, 152);
    const now = new Date().toISOString();

    setIsMerging(true);
    try {
      const batch = writeBatch(db);

      memberList.forEach((m) => {
        const isMaster = m.id === master.id;
        batch.update(doc(db, 'tables', m.id), {
          mergedTables: memberIds,
          mergedMasterId: master.id,
          mergedTableNumbers: memberNumbers,
          ...(isMaster
            ? {
                preMergeWidth: currentW,
                preMergeHeight: currentH,
                shape: masterShape,
                width: mergedW,
                height: mergedH,
              }
            : {}),
          ...(occupiedOwner
            ? {
                status: 'Ocupada',
                orderStatus: occupiedOwner.orderStatus || 'En Cocina',
                currentOrderId: occupiedOwner.currentOrderId || '',
                total: occupiedOwner.total || 0,
                itemCount: occupiedOwner.itemCount || 0,
                activeSince: occupiedOwner.activeSince || now,
              }
            : {}),
          updatedAt: now,
        });
      });

      if (occupiedOwner?.currentOrderId) {
        batch.update(doc(db, 'orders', occupiedOwner.currentOrderId), {
          tableName: `Mesas ${memberNumbers.join(' + ')}`,
          mergedTableIds: memberIds,
          mergedTableNumbers: memberNumbers,
          updatedAt: now,
        });
      }

      await commitOfflineSafe(batch.commit(), 'unify_tables');
      setSelectedTableIds([]);
      setIsSelectionMode(false);
      showFeedback(
        'success',
        `Mesas ${memberNumbers.join(' + ')} unificadas en una sola cuenta maestra.`
      );
    } catch (err: any) {
      console.error('Error al unificar mesas:', err);
      showFeedback('error', err?.message || 'No se pudieron unificar las mesas.');
    } finally {
      setIsMerging(false);
    }
  };

  // Unmerge (Separar Mesas) back to individual tables cleanly
  const handleSeparateTables = async (entry: RenderTableEntry) => {
    if (!entry.isUnified || isMerging) return;
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    setIsMerging(true);

    try {
      entry.memberTables.forEach((m, idx) => {
        const isMaster = m.id === entry.master.id;
        const restoreShape: TableShape = m.shape || 'cuadrada';
        const preset = SHAPE_PRESETS[restoreShape] || SHAPE_PRESETS.cuadrada;
        const restoreW =
          typeof m.preMergeWidth === 'number' && m.preMergeWidth >= 110
            ? m.preMergeWidth
            : preset.width;
        const restoreH =
          typeof m.preMergeHeight === 'number' && m.preMergeHeight >= 85
            ? m.preMergeHeight
            : preset.height;

        // Preserve any open order safely on the Master Table while freeing secondary tables
        batch.update(doc(db, 'tables', m.id), {
          mergedTables: [],
          mergedMasterId: '',
          mergedTableNumbers: [],
          name: `Mesa ${m.tableNumber}`,
          ...(isMaster
            ? {
                width: restoreW,
                height: restoreH,
                shape: restoreShape,
              }
            : {
                status: 'Libre',
                orderStatus: null,
                currentOrderId: '',
                total: 0,
                itemCount: 0,
                activeSince: '',
                posX:
                  typeof m.posX === 'number'
                    ? m.posX
                    : entry.resolvedX + ((idx + 1) % 3) * 186,
                posY:
                  typeof m.posY === 'number'
                    ? m.posY
                    : entry.resolvedY + Math.floor((idx + 1) / 3) * 162,
              }),
          updatedAt: now,
        });
      });

      if (entry.master.currentOrderId) {
        batch.update(doc(db, 'orders', entry.master.currentOrderId), {
          tableName: `Mesa ${entry.master.tableNumber}`,
          mergedTableIds: [],
          mergedTableNumbers: [],
          updatedAt: now,
        });
      }

      await commitOfflineSafe(batch.commit(), 'separate_tables');
      setSelectedTableIds((prev) => prev.filter((id) => id !== entry.master.id));
      showFeedback(
        'success',
        `Mesas ${entry.memberNumbers.join(' + ')} separadas nuevamente a estado individual.`
      );
    } catch (err: any) {
      console.error('Error al separar mesas:', err);
      showFeedback('error', err?.message || 'No se pudieron separar las mesas.');
    } finally {
      setIsMerging(false);
    }
  };

  const selectedUnifiedEntries = useMemo(
    () =>
      renderedTableEntries.filter(
        (e) => e.isUnified && selectedTableIds.includes(e.master.id)
      ),
    [renderedTableEntries, selectedTableIds]
  );

  // Render helper for a compact, shape-aware table card (reused in Spatial Canvas & Mobile Grid)
  const renderTableCard = (entry: RenderTableEntry, isCanvasMode: boolean) => {
    const { master, isUnified, memberNumbers, combinedCapacity, resolvedShape } = entry;
    const isOccupied = master.status === 'Ocupada';
    const isChecked = selectedTableIds.includes(master.id);
    const isRound = resolvedShape === 'redonda';
    const isBarra = resolvedShape === 'barra';
    const dotColor = !isOccupied
      ? 'bg-emerald-500 ring-2 ring-emerald-100'
      : 'bg-rose-500 ring-2 ring-rose-100';

    const shapeBorderRadius = isRound ? '50%' : isBarra ? '14px' : '18px';

    return (
      <div
        key={master.id}
        ref={(el) => {
          if (isCanvasMode) {
            if (el) cardRefs.current.set(master.id, el);
            else cardRefs.current.delete(master.id);
          }
        }}
        onPointerDown={(e) => {
          if (isCanvasMode && isLayoutEditMode && !isSelectionMode) {
            startPointerDrag(e, entry, false);
          }
        }}
        onClick={() => {
          if (Date.now() - justDraggedAtRef.current < 180) return;
          if (isSelectionMode) {
            toggleSelectEntry(entry);
            return;
          }
          if (isLayoutEditMode) return;
          setSelectedTable(master);
        }}
        style={
          isCanvasMode
            ? {
                position: 'absolute',
                left: `${entry.resolvedX}px`,
                top: `${entry.resolvedY}px`,
                width: `${entry.resolvedWidth}px`,
                height: `${entry.resolvedHeight}px`,
                borderRadius: shapeBorderRadius,
              }
            : {
                borderRadius: shapeBorderRadius,
                minHeight: isBarra ? '98px' : isRound ? '156px' : '138px',
              }
        }
        className={`group select-none transition-shadow duration-150 flex flex-col justify-between shadow-sm hover:shadow-md border-2 relative overflow-hidden ${
          isRound ? 'p-3 text-center items-center' : isBarra ? 'px-3 py-2' : 'p-2.5'
        } ${
          isSelectionMode
            ? 'cursor-pointer'
            : isLayoutEditMode
            ? 'cursor-grab active:cursor-grabbing'
            : 'cursor-pointer active:scale-[0.98]'
        } ${
          isChecked
            ? 'bg-[#EAF5F0] border-[#4A5D23] ring-4 ring-[#4A5D23]/25'
            : isUnified
            ? isOccupied
              ? 'bg-rose-50/40 border-rose-400 ring-2 ring-amber-300/60'
              : 'bg-[#F8FAF3] border-[#4A5D23] ring-2 ring-[#E89E2D]/40'
            : isOccupied
            ? 'bg-white border-rose-300 hover:border-rose-500'
            : 'bg-white border-gray-200 hover:border-[#4A5D23]'
        }`}
      >
        {/* 6-Dot Handle (Top-Left Corner) -> Drag OR Click to Configure Shape */}
        <button
          type="button"
          data-drag-handle="true"
          onPointerDown={(e) => {
            if (!isCanvasMode || isSelectionMode) return;
            startPointerDrag(e, entry, true);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (!isCanvasMode && !isSelectionMode) {
              if (canEditFloorPlan) {
                openConfigModalForEntry(entry);
              } else {
                showFeedback('error', 'Solo el Propietario puede cambiar la forma de las mesas.');
              }
            }
          }}
          style={{ touchAction: 'none' }}
          title="Arrastrar mesa o clic para cambiar forma y tamaño"
          className={`absolute z-20 p-1 rounded-lg bg-white/90 hover:bg-[#EAF5F0] border border-gray-200/80 text-gray-400 hover:text-[#4A5D23] transition-colors cursor-grab active:cursor-grabbing shadow-2xs ${
            isRound ? 'top-2 left-1/2 -translate-x-1/2' : 'top-1.5 left-1.5'
          }`}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>

        {/* Selection Mode Checkbox (Top-Right Corner) */}
        {isSelectionMode && (
          <div
            className={`absolute z-20 ${
              isRound ? 'top-2 right-5' : 'top-1.5 right-1.5'
            }`}
          >
            {isChecked ? (
              <CheckSquare className="w-5 h-5 text-[#4A5D23] fill-white" />
            ) : (
              <Square className="w-5 h-5 text-gray-400 fill-white/80" />
            )}
          </div>
        )}

        {/* Card Content Layout adapted by Shape (Barra / Redonda / Cuadrada & Rectangular) */}
        {isBarra ? (
          // BARRA: Sleek horizontal counter layout
          <div className="w-full h-full flex items-center justify-between gap-2 pl-6 pr-2">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-black text-sm border shrink-0 ${
                  isOccupied
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-[#EAF5F0] text-[#4A5D23] border-[#4A5D23]/25'
                }`}
              >
                {isUnified ? memberNumbers.join('+') : master.tableNumber}
              </div>
              <div className="min-w-0 text-left">
                <div className="font-black text-xs text-gray-900 truncate flex items-center gap-1">
                  <span>{isUnified ? `Mesas ${memberNumbers.join(' + ')}` : `Mesa ${master.tableNumber}`}</span>
                  {isUnified && (
                    <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 text-[9px] font-black uppercase">
                      Unidas
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                  <span className="flex items-center gap-0.5">
                    <Users className="w-2.5 h-2.5" /> {combinedCapacity}p
                  </span>
                  <span className={`inline-flex items-center gap-1 font-bold ${isOccupied ? 'text-rose-600' : 'text-emerald-700'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isOccupied ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                    {isOccupied ? 'Ocupada' : 'Libre'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isOccupied ? (
                <div className="text-right">
                  <div className="font-mono text-sm font-black text-[#E89E2D]">
                    ${(master.total || 0).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-gray-500 font-bold">
                    {master.itemCount || 0} ítems
                  </div>
                </div>
              ) : (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
                  Barra Libre
                </span>
              )}
              {isUnified && !isSelectionMode && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSeparateTables(entry);
                  }}
                  title="Separar Mesas"
                  className="p-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 cursor-pointer"
                >
                  <Unlink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ) : isRound ? (
          // REDONDA: Centered circular layout
          <div className="w-full h-full flex flex-col items-center justify-center pt-5 pb-1 px-1 space-y-1">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center font-mono font-black text-base border shadow-2xs ${
                isOccupied
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-[#EAF5F0] text-[#4A5D23] border-[#4A5D23]/25'
              }`}
            >
              {isUnified ? memberNumbers.join('+') : master.tableNumber}
            </div>

            <div className="text-[11px] font-black text-gray-900 leading-tight truncate max-w-[92%]">
              {isUnified ? `M. ${memberNumbers.join('+')}` : `Mesa ${master.tableNumber}`}
            </div>

            <div className="flex items-center justify-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
              <span
                className={`text-[9px] font-black uppercase ${
                  isOccupied ? 'text-rose-700' : 'text-emerald-700'
                }`}
              >
                {isOccupied ? 'Ocupada' : `${combinedCapacity}p Libre`}
              </span>
            </div>

            {isOccupied ? (
              <div className="font-mono text-xs font-black text-[#E89E2D] leading-none">
                ${(master.total || 0).toFixed(2)} · {master.itemCount || 0}i
              </div>
            ) : (
              <span className="text-[9px] text-gray-400 font-semibold">Tocar para pedir</span>
            )}

            {isUnified && !isSelectionMode && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSeparateTables(entry);
                }}
                className="px-2 py-0.5 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 text-[9px] font-black flex items-center gap-0.5 cursor-pointer"
              >
                <Unlink className="w-2.5 h-2.5" />
                Separar
              </button>
            )}
          </div>
        ) : (
          // CUADRADA & RECTANGULAR: Compact, dense, super legible card layout
          <>
            {/* Top Header */}
            <div className="flex items-start justify-between gap-1 pl-6 pr-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center font-mono font-black text-sm border shrink-0 ${
                    isOccupied
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : 'bg-[#EAF5F0] text-[#4A5D23] border-[#4A5D23]/25'
                  }`}
                >
                  {isUnified ? memberNumbers.join('+') : master.tableNumber}
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-black text-gray-900 truncate leading-tight">
                    {isUnified ? `Mesas ${memberNumbers.join(' + ')}` : `Mesa ${master.tableNumber}`}
                  </h3>
                  <div className="flex items-center gap-1 text-[10px] text-gray-500 leading-none mt-0.5">
                    <Users className="w-2.5 h-2.5 text-gray-400 shrink-0" />
                    <span>{combinedCapacity} Asientos</span>
                  </div>
                </div>
              </div>

              {!isSelectionMode && (
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase ${
                      !isOccupied
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}
                  >
                    {!isOccupied ? 'Libre' : 'Ocupada'}
                  </span>
                </div>
              )}
            </div>

            {/* Unified Group Badge if merged */}
            {isUnified && (
              <div className="mt-1 px-2 py-0.5 rounded-lg bg-amber-100/90 border border-amber-300 text-amber-950 text-[9px] font-black uppercase tracking-wider flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 truncate">
                  <Link2 className="w-2.5 h-2.5 shrink-0" />
                  Bloque Unido ({memberNumbers.length})
                </span>
                {!isSelectionMode && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSeparateTables(entry);
                    }}
                    className="px-1.5 py-0.2 rounded bg-white/80 hover:bg-white text-amber-950 border border-amber-400 flex items-center gap-0.5 cursor-pointer shrink-0"
                    title="Separar Mesas"
                  >
                    <Unlink className="w-2.5 h-2.5" />
                    Separar
                  </button>
                )}
              </div>
            )}

            {/* Compact Middle Body */}
            <div className="my-1 px-2 py-1.5 rounded-xl bg-gray-50 border border-gray-100 text-[11px] flex-1 flex flex-col justify-center">
              {isOccupied ? (
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 text-[10px] font-semibold">
                      {master.itemCount || 0} platos
                    </span>
                    <strong className="font-mono text-xs font-black text-[#E89E2D]">
                      ${(master.total || 0).toFixed(2)}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between pt-0.5">
                    {master.orderStatus ? (
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                          master.orderStatus === 'Entregado'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {master.orderStatus === 'Entregado' ? 'Entregado' : 'Cocina'}
                      </span>
                    ) : (
                      <span />
                    )}
                    {master.activeSince && <TableElapsedBadge activeSince={master.activeSince} />}
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <span className="text-[11px] text-emerald-700 font-bold block leading-tight">
                    Disponible
                  </span>
                  <span className="text-[9px] text-gray-400">Toca para ordenar</span>
                </div>
              )}
            </div>

            {/* Compact Bottom Footer */}
            <div className="pt-1 border-t border-gray-100 flex items-center justify-between text-[10px] pr-3">
              <span className="text-[#4A5D23] font-bold flex items-center gap-1 truncate">
                <UtensilsCrossed className="w-2.5 h-2.5 text-[#E89E2D] shrink-0" />
                {isOccupied ? 'Ver Cuenta' : 'Pedir'}
              </span>
              <span className="text-gray-400 font-mono font-bold">→</span>
            </div>
          </>
        )}

        {/* Bottom-Right Resize Grip Handle (Desktop/Canvas Mode for Owner/Admin) */}
        {isCanvasMode && canEditFloorPlan && !isSelectionMode && (
          <div
            onPointerDown={(e) => startPointerResize(e, entry)}
            style={{ touchAction: 'none' }}
            title="Arrastra para redimensionar esta mesa"
            className={`absolute z-20 p-1 rounded-tl-lg text-gray-300 hover:text-[#4A5D23] hover:bg-[#EAF5F0]/90 cursor-nwse-resize transition-opacity ${
              isRound
                ? 'bottom-2 right-5 opacity-70 group-hover:opacity-100'
                : 'bottom-0.5 right-0.5 opacity-60 group-hover:opacity-100'
            } ${isLayoutEditMode ? '!opacity-100 text-[#4A5D23]' : ''}`}
          >
            <Maximize2 className="w-3 h-3 rotate-90" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Action Bar: Selection/Merge, Layout Mode, Disponibilidad, + Domicilio, + Mesas */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Multi-select & Merge / Separate Controls */}
          <button
            type="button"
            onClick={() => {
              setIsSelectionMode((prev) => {
                if (prev) setSelectedTableIds([]);
                return !prev;
              });
              setIsLayoutEditMode(false);
            }}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
              isSelectionMode
                ? 'bg-[#4A5D23] text-white border-[#4A5D23] shadow-xs'
                : 'bg-gray-50 hover:bg-[#EAF5F0] text-gray-700 hover:text-[#4A5D23] border-gray-200'
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>
              {isSelectionMode
                ? `Cancelar Selección (${selectedTableIds.length})`
                : 'Seleccionar Mesas'}
            </span>
          </button>

          {isSelectionMode && selectedTableIds.length >= 2 && (
            <button
              type="button"
              disabled={isMerging}
              onClick={handleUnifyTables}
              className="px-3.5 py-2 rounded-xl bg-[#E89E2D] hover:bg-[#d48c22] text-slate-950 font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>Unificar Mesas ({selectedTableIds.length})</span>
            </button>
          )}

          {selectedUnifiedEntries.length === 1 && (
            <button
              type="button"
              disabled={isMerging}
              onClick={() => handleSeparateTables(selectedUnifiedEntries[0])}
              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
            >
              <Unlink className="w-3.5 h-3.5" />
              <span>Separar Mesas</span>
            </button>
          )}

          {canEditFloorPlan && (
            <>
              <button
                type="button"
                onClick={() => {
                  setIsLayoutEditMode((prev) => !prev);
                  setIsSelectionMode(false);
                  setSelectedTableIds([]);
                }}
                className={`hidden md:flex px-3 py-2 rounded-xl text-xs font-bold items-center gap-1.5 border transition-all cursor-pointer ${
                  isLayoutEditMode
                    ? 'bg-amber-100 text-amber-950 border-[#E89E2D] shadow-xs'
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
                }`}
                title="Activa para arrastrar y redimensionar mesas libremente"
              >
                <Move className="w-3.5 h-3.5 text-[#D97706]" />
                <span>{isLayoutEditMode ? 'Listo (Editar Plano)' : 'Mover Plano'}</span>
              </button>

              {isLayoutEditMode && (
                <button
                  type="button"
                  onClick={handleAutoArrangeGrid}
                  className="hidden md:flex px-3 py-2 rounded-xl text-xs font-bold items-center gap-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 cursor-pointer"
                  title="Alinear todas las mesas automáticamente"
                >
                  <LayoutGrid className="w-3.5 h-3.5 text-[#4A5D23]" />
                  <span>Auto-ordenar</span>
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setShowMobileCanvas((prev) => !prev)}
            className="md:hidden px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-gray-50 text-gray-700 border border-gray-200 cursor-pointer"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-[#4A5D23]" />
            <span>{showMobileCanvas ? 'Vista Lista' : 'Ver Plano'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setAvailabilitySearch('');
              setAvailabilityTab('productos');
              setIsAvailabilityModalOpen(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/40 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer"
            title="Habilitar o deshabilitar productos y personalizados agotados"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#E89E2D]" />
            <span>Disponibilidad</span>
          </button>

          <button
            type="button"
            onClick={handleOpenDomicilioOrder}
            className="px-3.5 py-2 rounded-xl bg-[#E89E2D] hover:bg-[#d48c22] text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer"
            title="Tomar comanda a Domicilio"
          >
            <Bike className="w-3.5 h-3.5 text-slate-950" />
            <span>+ Domicilio</span>
            {activeDomicilioOrder && (
              <span className="bg-slate-950 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold">
                Activo
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsManageModalOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-[#E89E2D]" />
            <span>+ Mesas</span>
          </button>
        </div>
      </div>

      {/* Helper hint for 6-dots & layout */}
      {isSelectionMode && (
        <div className="px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs font-semibold flex items-center justify-between gap-2">
          <span>
            Toca 2 o más mesas para unificarlas en una sola cuenta maestra de recepción grande.
          </span>
          <span className="font-mono font-black">{selectedTableIds.length} elegidas</span>
        </div>
      )}

      {/* Feedback / Error banner */}
      {feedback && (
        <div
          className={`p-3 rounded-2xl border text-xs font-semibold flex items-center justify-between ${
            feedback.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-[#EAF5F0] border-[#4A5D23]/30 text-[#4A5D23]'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-[#4A5D23] shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="font-bold hover:underline cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Active Domicilio Strip (compact banner above physical floor plan) */}
      {activeDomicilioOrder && (
        <div
          onClick={handleOpenDomicilioOrder}
          className="p-3 rounded-2xl border-2 border-amber-400 bg-amber-50/70 hover:bg-amber-50 shadow-xs flex flex-wrap items-center justify-between gap-3 cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#4A5D23] text-white flex items-center justify-center text-lg shadow-xs">
              🛵
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-xs sm:text-sm text-gray-900">
                  PEDIDO A DOMICILIO EN CURSO
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-400 text-slate-950">
                  #{activeDomicilioOrder.id.substring(0, 5).toUpperCase()}
                </span>
              </div>
              <div className="text-[11px] text-gray-600">
                {activeDomicilioOrder.items?.reduce((acc, i) => acc + i.quantity, 0) || 0} platillos · Total:{' '}
                <strong className="font-mono text-[#D97706]">
                  ${(activeDomicilioOrder.total || 0).toFixed(2)}
                </strong>
              </div>
            </div>
          </div>
          <span className="px-3 py-1.5 rounded-xl bg-[#4A5D23] text-white text-xs font-bold">
            Abrir Comanda →
          </span>
        </div>
      )}

      {/* DESKTOP / TABLET SPATIAL FLOOR PLAN CANVAS (Free X/Y Drag & Drop + Resize + Shapes) */}
      <div
        className={`${
          showMobileCanvas ? 'block' : 'hidden md:block'
        } bg-white border border-gray-200 rounded-3xl shadow-sm overflow-x-auto relative`}
      >
        <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
          <div className="flex items-center gap-2">
            <GripVertical className="w-3.5 h-3.5 text-[#4A5D23]" />
            <span>
              Plano Real de Salón ({activeBranch}) — Arrastra desde los <strong>6 puntos</strong> para mover o haz <strong>clic</strong> en ellos para cambiar la forma.
            </span>
          </div>
          <span className="font-mono font-bold text-[#4A5D23]">
            {renderedTableEntries.length} bloques · {tables.length} mesas
          </span>
        </div>

        <div
          ref={canvasRef}
          style={{
            minHeight: `${canvasMinHeight}px`,
            minWidth: `${canvasMinWidth}px`,
            backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
          className="relative w-full bg-[#FAFBF9]"
        >
          {renderedTableEntries.map((entry) => renderTableCard(entry, true))}
        </div>
      </div>

      {/* MOBILE COMPACT GRID FALLBACK (Responsive vertical / 2-col cards on small phones) */}
      {!showMobileCanvas && (
        <div className="md:hidden grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {renderedTableEntries.map((entry) => renderTableCard(entry, false))}
        </div>
      )}

      {/* TABLE SHAPE & SIZE CONFIG MODAL (Triggered on clicking the 6-dot icon) */}
      {configModalTableId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={() => !isSavingConfig && setConfigModalTableId(null)}
        >
          <form
            onSubmit={handleSaveTableConfig}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-3xl p-5 shadow-2xl border border-gray-200 text-gray-900 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <GripVertical className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-gray-900">
                    Configurar Forma y Tamaño
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    {tables.find((t) => t.id === configModalTableId)?.name || 'Mesa'} · Se guarda en Firestore
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfigModalTableId(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 4 Shape Options: Redonda, Cuadrada, Rectangular, Barra */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-2">
                Forma visual de la mesa:
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                {(
                  [
                    { key: 'cuadrada' as TableShape, icon: SquareIcon },
                    { key: 'redonda' as TableShape, icon: Circle },
                    { key: 'rectangular' as TableShape, icon: RectangleHorizontal },
                    { key: 'barra' as TableShape, icon: Minus },
                  ] as const
                ).map(({ key, icon: Icon }) => {
                  const preset = SHAPE_PRESETS[key];
                  const active = configShape === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSelectShapeInModal(key)}
                      className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                        active
                          ? 'bg-[#EAF5F0] border-[#4A5D23] text-[#4A5D23] shadow-xs'
                          : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-700'
                      }`}
                    >
                      <div
                        className={`w-9 h-9 flex items-center justify-center border shrink-0 ${
                          key === 'redonda'
                            ? 'rounded-full'
                            : key === 'barra'
                            ? 'rounded-md h-5'
                            : 'rounded-xl'
                        } ${
                          active
                            ? 'bg-[#4A5D23] text-white border-[#4A5D23]'
                            : 'bg-white text-gray-500 border-gray-300'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-black">{preset.label}</div>
                        <div className="text-[10px] opacity-75 truncate">{preset.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Size (Width / Height) & Capacity Controls */}
            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Ancho (px)
                </label>
                <input
                  type="number"
                  min={115}
                  max={540}
                  value={configWidth}
                  onChange={(e) => setConfigWidth(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-gray-300 bg-white text-xs font-mono font-bold focus:outline-none focus:border-[#4A5D23]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Alto (px)
                </label>
                <input
                  type="number"
                  min={88}
                  max={420}
                  disabled={configShape === 'redonda'}
                  value={configShape === 'redonda' ? configWidth : configHeight}
                  onChange={(e) => setConfigHeight(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-gray-300 bg-white disabled:bg-gray-100 text-xs font-mono font-bold focus:outline-none focus:border-[#4A5D23]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Asientos
                </label>
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={configCapacity}
                  onChange={(e) => setConfigCapacity(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-gray-300 bg-white text-xs font-mono font-bold focus:outline-none focus:border-[#4A5D23]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-100 gap-2">
              <button
                type="button"
                onClick={() => handleSelectShapeInModal(configShape)}
                className="text-[11px] font-bold text-gray-500 hover:text-[#4A5D23] underline cursor-pointer"
              >
                Restablecer tamaño
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfigModalTableId(null)}
                  className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="px-4 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold cursor-pointer shadow-xs disabled:opacity-60"
                >
                  {isSavingConfig ? 'Guardando...' : 'Aplicar Forma'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Manage Tables Modal (+ Mesas) */}
      {isManageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-gray-200 text-gray-900">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <h3 className="font-bold text-base text-gray-900 flex items-center gap-2">
                <Sliders className="w-5 h-5 text-[#4A5D23]" />
                Administrar Mesas del Salón
              </h3>
              <button
                type="button"
                onClick={() => setIsManageModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-600 mb-4 leading-relaxed">
              Actualmente tienes <strong className="text-gray-900">{tables.length} mesas</strong> configuradas en el plano de tu restaurante.
            </p>

            <div className="space-y-3">
              <button
                type="button"
                onClick={handleAddTable}
                className="w-full py-3 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-sm transition-all"
              >
                <Plus className="w-4 h-4 text-[#E89E2D]" />
                Añadir Mesa {tables.reduce((m, t) => Math.max(m, t.tableNumber), 0) + 1}
              </button>

              <div className="pt-2 border-t border-gray-100">
                <label className="block text-xs font-bold text-gray-700 mb-2">
                  Eliminar una mesa libre del plano:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {tables.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      disabled={t.status === 'Ocupada' || (t.mergedTables?.length || 0) > 1}
                      onClick={() => setDeleteTargetTable(t)}
                      className={`p-2.5 rounded-xl border text-xs font-bold transition-all ${
                        t.status === 'Ocupada' || (t.mergedTables?.length || 0) > 1
                          ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                          : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 cursor-pointer'
                      }`}
                    >
                      Mesa {t.tableNumber}{' '}
                      {t.status === 'Ocupada'
                        ? '(Ocupada)'
                        : (t.mergedTables?.length || 0) > 1
                        ? '(Unida)'
                        : '✕'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => setIsManageModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disponibilidad Modal (Productos & Personalizados) */}
      {isAvailabilityModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsAvailabilityModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl bg-white rounded-3xl p-5 sm:p-6 shadow-2xl border border-gray-200 text-gray-900 max-h-[90vh] flex flex-col space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <SlidersHorizontal className="w-5 h-5 text-[#E89E2D]" />
                </div>
                <div>
                  <h3 className="font-black text-base text-gray-900">Control de Disponibilidad</h3>
                  <p className="text-xs text-gray-500">
                    Activa (Verde) o desactiva (Rojo) productos y personalizados agotados al instante
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAvailabilityModalOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 2 Tabs + Search */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-2xl border border-gray-200 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setAvailabilityTab('productos')}
                  className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    availabilityTab === 'productos'
                      ? 'bg-[#4A5D23] text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Productos ({catalogProducts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAvailabilityTab('personalizados')}
                  className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    availabilityTab === 'personalizados'
                      ? 'bg-[#4A5D23] text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Personalizados ({groupedCustomOptions.length})
                </button>
              </div>

              <div className="relative flex-1 sm:max-w-xs">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={
                    availabilityTab === 'productos'
                      ? 'Buscar producto o categoría...'
                      : 'Buscar personalizado o grupo...'
                  }
                  value={availabilitySearch}
                  onChange={(e) => setAvailabilitySearch(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl pl-8 pr-3 py-2 text-xs text-gray-900 focus:outline-none"
                />
              </div>
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {availabilityTab === 'productos' ? (
                sortedAvailabilityProducts.length === 0 ? (
                  <div className="py-10 text-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-2xl">
                    No se encontraron productos en la Carta.
                  </div>
                ) : (
                  sortedAvailabilityProducts.map((prod) => {
                    const isAvailable = prod.available !== false;
                    const busy = togglingKey === `prod_${prod.id}`;
                    return (
                      <div
                        key={prod.id}
                        className={`p-3 rounded-2xl border flex items-center justify-between gap-3 transition-colors ${
                          isAvailable
                            ? 'bg-white border-gray-200'
                            : 'bg-rose-50/70 border-rose-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`font-bold text-xs sm:text-sm truncate ${
                                isAvailable ? 'text-gray-900' : 'text-rose-900 line-through'
                              }`}
                            >
                              {prod.name}
                            </span>
                            <span className="px-2 py-0.5 rounded-md bg-gray-100 text-[10px] font-bold uppercase text-gray-600">
                              {prod.category}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-[#E89E2D] font-bold">
                            ${(Number(prod.price) || 0).toFixed(2)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <span
                            className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                              isAvailable
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-100 text-rose-700 border-rose-300'
                            }`}
                          >
                            {isAvailable ? 'Disponible' : 'Agotado'}
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleToggleProductAvailability(prod)}
                            aria-pressed={isAvailable}
                            title={isAvailable ? 'Marcar como agotado (Rojo)' : 'Habilitar de nuevo (Verde)'}
                            className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center cursor-pointer disabled:opacity-60 ${
                              isAvailable ? 'bg-emerald-500 justify-end' : 'bg-rose-500 justify-start'
                            }`}
                          >
                            <span className="w-5 h-5 rounded-full bg-white shadow-sm block" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )
              ) : groupedCustomOptions.length === 0 ? (
                <div className="py-10 text-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-2xl">
                  No hay modificadores ni personalizados configurados en los productos de la Carta.
                </div>
              ) : (
                groupedCustomOptions.map((entry) => {
                  const busy = togglingKey === `opt_${entry.key}`;
                  return (
                    <div
                      key={entry.key}
                      className={`p-3 rounded-2xl border flex items-center justify-between gap-3 transition-colors ${
                        entry.available
                          ? 'bg-white border-gray-200'
                          : 'bg-rose-50/70 border-rose-200'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-bold text-xs sm:text-sm ${
                              entry.available ? 'text-gray-900' : 'text-rose-900 line-through'
                            }`}
                          >
                            {entry.optionName}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/20 text-[10px] font-bold uppercase">
                            {entry.groupName}
                          </span>
                          {entry.extraPrice > 0 && (
                            <span className="text-[11px] font-mono font-bold text-[#D97706]">
                              +${entry.extraPrice.toFixed(2)}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 truncate mt-0.5">
                          En {entry.productNames.length} plato(s): {entry.productNames.join(', ')}
                        </p>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <span
                          className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                            entry.available
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-100 text-rose-700 border-rose-300'
                          }`}
                        >
                          {entry.available ? 'Disponible' : 'Agotado'}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleToggleCustomOptionAvailability(entry)}
                          aria-pressed={entry.available}
                          title={
                            entry.available
                              ? 'Desactivar opción personalizada (Rojo)'
                              : 'Habilitar opción personalizada (Verde)'
                          }
                          className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center cursor-pointer disabled:opacity-60 ${
                            entry.available ? 'bg-emerald-500 justify-end' : 'bg-rose-500 justify-start'
                          }`}
                        >
                          <span className="w-5 h-5 rounded-full bg-white shadow-sm block" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-gray-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setIsAvailabilityModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold cursor-pointer"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Table Security Authorization Modal */}
      <DeleteAuthModal
        isOpen={!!deleteTargetTable}
        onClose={() => setDeleteTargetTable(null)}
        onConfirm={confirmDeleteTable}
        title="Eliminar Mesa del Salón"
        itemDescription={`la Mesa ${deleteTargetTable?.tableNumber} del plano`}
      />

      {/* Central Order Modal */}
      {liveSelectedTable && (
        <TableOrderModal
          key={liveSelectedTable.id}
          table={liveSelectedTable}
          isOpen={!!liveSelectedTable}
          onClose={() => setSelectedTable(null)}
          onTableUpdated={(msg) => {
            if (msg) showFeedback('success', msg, 2500);
          }}
        />
      )}
    </div>
  );
};
