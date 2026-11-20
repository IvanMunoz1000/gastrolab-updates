import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  doc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  Order,
  WasteRecord,
  InventoryItem,
  Product,
} from '../types';
import {
  DollarSign,
  Receipt,
  Scale,
  Package,
  AlertTriangle,
  Download,
  Calendar,
  Search,
  CheckCircle2,
  Sparkles,
  BarChart3,
  UtensilsCrossed,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LabelList,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import * as XLSX from 'xlsx';
import { DeleteAuthModal } from './DeleteAuthModal';

type DateFilterType = 'today' | 'week' | 'month' | 'custom';
type TableViewType = 'ventas' | 'compras' | 'mermas';

const PIE_COLORS = ['#3B6E1C', '#1D70B8', '#E89E2D', '#7C3AED', '#2E7D32', '#64748B'];

function safeToDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'object') {
    const obj = val as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') {
      try {
        const d = obj.toDate();
        return d instanceof Date && !isNaN(d.getTime()) ? d : null;
      } catch {
        return null;
      }
    }
    if (typeof obj.seconds === 'number') {
      const d = new Date(obj.seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

function safeDateKey(val: unknown): string {
  const d = safeToDate(val);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatOrderOriginLabel(o: Order): string {
  if (o.isDomicilio || o.orderType === 'DOMICILIO' || o.tableNumber === 0) {
    return 'DOMICILIO';
  }
  return `Mesa ${o.tableNumber || 1}`;
}

export const ReportesModule: React.FC = () => {
  const { activeBranch } = useBranch();

  // Real-time Firestore states
  const [rawOrders, setRawOrders] = useState<Order[]>([]);
  const [rawPurchases, setRawPurchases] = useState<any[]>([]);
  const [rawWasteRecords, setRawWasteRecords] = useState<WasteRecord[]>([]);
  const [rawInventoryItems, setRawInventoryItems] = useState<InventoryItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Filter bar states
  const [dateFilter, setDateFilter] = useState<DateFilterType>('month');
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [customEndDate, setCustomEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Table view & search states
  const [activeTableView, setActiveTableView] = useState<TableViewType>('ventas');
  const [salesChartStyle, setSalesChartStyle] = useState<'bar' | 'area'>('bar');
  const [searchTableQuery, setSearchTableQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchTableQuery, 150);
  const [showAllTableRows, setShowAllTableRows] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const seedingRef = useRef(false);

  // Subscribe to Orders
  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Order[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as Order);
        });
        setRawOrders(list);
      },
      (err) => {
        console.error('Error al escuchar órdenes:', err);
        setModuleError('No se pudieron cargar las órdenes en tiempo real.');
      }
    );
    return () => unsubscribe();
  }, []);

  // Subscribe to Purchases
  useEffect(() => {
    const q = query(collection(db, 'purchases'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() });
        });
        setRawPurchases(list);
      },
      (err) => {
        console.error('Error al escuchar compras:', err);
        setModuleError('No se pudieron cargar las facturas de compras.');
      }
    );
    return () => unsubscribe();
  }, []);

  // Subscribe to Waste Records
  useEffect(() => {
    const q = query(collection(db, 'waste_records'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: WasteRecord[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as WasteRecord);
        });
        setRawWasteRecords(list);
      },
      (err) => {
        console.error('Error al escuchar mermas:', err);
        setModuleError('No se pudieron cargar los registros de mermas.');
      }
    );
    return () => unsubscribe();
  }, []);

  // Subscribe to Inventory
  useEffect(() => {
    const q = query(collection(db, 'inventory'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: InventoryItem[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as InventoryItem);
        });
        setRawInventoryItems(list);
      },
      (err) => {
        console.error('Error al escuchar inventario:', err);
        setModuleError('No se pudo sincronizar el inventario.');
      }
    );
    return () => unsubscribe();
  }, []);

  // Branch-isolated records (products remain shared across menu)
  const orders = useMemo(
    () => rawOrders.filter((o) => belongsToBranch(o.branch, activeBranch)),
    [rawOrders, activeBranch]
  );
  const purchases = useMemo(
    () => rawPurchases.filter((p) => belongsToBranch(p.branch, activeBranch)),
    [rawPurchases, activeBranch]
  );
  const wasteRecords = useMemo(
    () => rawWasteRecords.filter((w) => belongsToBranch(w.branch, activeBranch)),
    [rawWasteRecords, activeBranch]
  );
  const inventoryItems = useMemo(
    () => rawInventoryItems.filter((i) => belongsToBranch(i.branch, activeBranch)),
    [rawInventoryItems, activeBranch]
  );

  // Subscribe to Products
  useEffect(() => {
    const q = query(collection(db, 'products'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Product[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as Product);
        });
        setProducts(list);
      },
      (err) => {
        console.error('Error al escuchar productos:', err);
        setModuleError('No se pudo sincronizar el catálogo de productos.');
      }
    );
    return () => unsubscribe();
  }, []);

  // Helper date filtering function (handles ISO strings, numbers, Date, and Firestore Timestamps)
  const filterByDateRange = useCallback(
    (itemDateVal?: unknown): boolean => {
      const itemDate = safeToDate(itemDateVal);
      if (!itemDate) return false;
      const now = new Date();

      if (dateFilter === 'today') {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        return itemDate >= todayStart && itemDate <= todayEnd;
      }

      if (dateFilter === 'week') {
        const dayOfWeek = now.getDay() || 7; // Monday = 1, Sunday = 7
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1, 0, 0, 0);
        return itemDate >= weekStart;
      }

      if (dateFilter === 'month') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        return itemDate >= monthStart;
      }

      if (dateFilter === 'custom') {
        const start = customStartDate ? new Date(`${customStartDate}T00:00:00`) : new Date(0);
        const end = customEndDate ? new Date(`${customEndDate}T23:59:59`) : new Date();
        return itemDate >= start && itemDate <= end;
      }

      return true;
    },
    [dateFilter, customStartDate, customEndDate]
  );

  // Filtered collections (exclude voided orders from sales)
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => o?.status !== 'Anulado' && filterByDateRange(o?.createdAt));
  }, [orders, filterByDateRange]);

  const filteredPurchases = useMemo(() => {
    return purchases.filter((p) => filterByDateRange(p?.date || p?.createdAt));
  }, [purchases, filterByDateRange]);

  const filteredWaste = useMemo(() => {
    return wasteRecords.filter((w) => filterByDateRange(w?.date || w?.createdAt));
  }, [wasteRecords, filterByDateRange]);

  // O(1) lookup maps to eliminate inner-loop .find() calls
  const inventoryByIdMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of inventoryItems) {
      map.set(item.id, item);
    }
    return map;
  }, [inventoryItems]);

  const { productByIdMap, productByLowerNameMap } = useMemo(() => {
    const byId = new Map<string, Product>();
    const byName = new Map<string, Product>();
    for (const p of products) {
      byId.set(p.id, p);
      if (p.name) {
        byName.set(p.name.toLowerCase(), p);
      }
    }
    return { productByIdMap: byId, productByLowerNameMap: byName };
  }, [products]);

  // Aggregated KPIs
  const totalSalesAmount = useMemo(() => {
    return filteredOrders.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
  }, [filteredOrders]);

  const totalOrdersCount = filteredOrders.length;

  const averageTicket = useMemo(() => {
    return totalOrdersCount > 0 ? totalSalesAmount / totalOrdersCount : 0;
  }, [totalSalesAmount, totalOrdersCount]);

  const totalWasteCost = useMemo(() => {
    return filteredWaste.reduce((acc, w) => {
      const weight = Number(w.wasteAmount) || 0;
      const invItem = w.itemId ? inventoryByIdMap.get(w.itemId) : undefined;
      const costPerUnit = Number(invItem?.costPerBaseUnit) || 0.015;
      return acc + weight * costPerUnit;
    }, 0);
  }, [filteredWaste, inventoryByIdMap]);

  const totalPurchasesAmount = useMemo(() => {
    return filteredPurchases.reduce((acc, p) => acc + (Number(p.totalAmount) || 0), 0);
  }, [filteredPurchases]);

  // 1. Sales Trend Data for Recharts AreaChart
  const salesTrendData = useMemo(() => {
    const dailyMap: Record<string, { date: string; displayDate: string; ventas: number; ordenes: number }> = {};

    filteredOrders.forEach((o) => {
      const d = safeDateKey(o.createdAt);
      if (!d) return;
      if (!dailyMap[d]) {
        const dateObj = new Date(`${d}T12:00:00`);
        const formatted = isNaN(dateObj.getTime())
          ? d
          : dateObj.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' });
        dailyMap[d] = { date: d, displayDate: formatted, ventas: 0, ordenes: 0 };
      }
      dailyMap[d].ventas += Number(o.total) || 0;
      dailyMap[d].ordenes += 1;
    });

    const sorted = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    if (sorted.length === 0) {
      return [
        { date: '2026-11-01', displayDate: '01 Nov', ventas: 0, ordenes: 0 },
        { date: '2026-11-08', displayDate: 'Hoy', ventas: 0, ordenes: 0 },
      ];
    }
    return sorted;
  }, [filteredOrders]);

  // 2. Top Selling Products
  const topSellingProducts = useMemo(() => {
    const productStats: Record<string, { name: string; quantity: number; revenue: number }> = {};

    filteredOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const safeName = item?.name || 'Platillo';
        const key = item?.productId || safeName;
        if (!productStats[key]) {
          productStats[key] = {
            name: safeName,
            quantity: 0,
            revenue: 0,
          };
        }
        const qty = Number(item?.quantity) || 1;
        const price = Number(item?.price) || 0;
        productStats[key].quantity += qty;
        productStats[key].revenue += price * qty;
      });
    });

    return Object.values(productStats)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }, [filteredOrders]);

  // 2B. Pie Chart 1: Ventas por Categoría de Producto (O(1) product lookup)
  const salesByCategoryData = useMemo(() => {
    const catMap: Record<string, number> = {};
    filteredOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const matchedProduct =
          (item?.productId ? productByIdMap.get(item.productId) : undefined) ||
          (item?.name ? productByLowerNameMap.get(item.name.toLowerCase()) : undefined);
        const cat = matchedProduct?.category || 'Carta / Platos';
        const amount = (Number(item?.price) || 0) * (Number(item?.quantity) || 1);
        catMap[cat] = (catMap[cat] || 0) + amount;
      });
    });
    const sorted = Object.entries(catMap)
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);

    const sliced =
      sorted.length <= 6
        ? sorted
        : [
            ...sorted.slice(0, 5),
            {
              name: 'Otros',
              value: Number(sorted.slice(5).reduce((s, x) => s + x.value, 0).toFixed(2)),
            },
          ];

    const total = sliced.reduce((s, x) => s + x.value, 0);
    return sliced.map((x) => ({
      ...x,
      percent: total > 0 ? Number(((x.value / total) * 100).toFixed(1)) : 0,
    }));
  }, [filteredOrders, productByIdMap, productByLowerNameMap]);

  const categoryChartTotal = useMemo(
    () => salesByCategoryData.reduce((s, x) => s + x.value, 0),
    [salesByCategoryData]
  );

  // 2C. Pie Chart 2: Ventas por Canal / Método de Pago
  const salesByChannelData = useMemo(() => {
    const channelMap: Record<string, number> = {};
    filteredOrders.forEach((order) => {
      const anyOrder = order as unknown as { paymentMethod?: string };
      const label = anyOrder.paymentMethod
        ? anyOrder.paymentMethod
        : order.isDomicilio || order.orderType === 'DOMICILIO' || order.tableNumber === 0
        ? 'Domicilio'
        : 'Salón / Mesas';
      const amt = Number(order.total) || 0;
      channelMap[label] = (channelMap[label] || 0) + amt;
    });
    const list = Object.entries(channelMap)
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = list.reduce((s, x) => s + x.value, 0);
    return list.map((x) => ({
      ...x,
      percent: total > 0 ? Number(((x.value / total) * 100).toFixed(1)) : 0,
    }));
  }, [filteredOrders]);

  const channelChartTotal = useMemo(
    () => salesByChannelData.reduce((s, x) => s + x.value, 0),
    [salesByChannelData]
  );

  // 3. Low stock alerts
  const lowStockItems = useMemo(() => {
    return inventoryItems
      .filter((item) => (Number(item.currentStock) || 0) <= (Number(item.minStock) || 0))
      .map((item) => ({
        ...item,
        deficit: Math.max(0, (Number(item.minStock) || 0) - (Number(item.currentStock) || 0)),
      }));
  }, [inventoryItems]);

  // Debounced & memoized detail table filtering
  const searchedOrders = useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase();
    if (!q) return filteredOrders;
    return filteredOrders.filter(
      (o) =>
        formatOrderOriginLabel(o).toLowerCase().includes(q) ||
        (o.items || []).some((i) => (i?.name || '').toLowerCase().includes(q))
    );
  }, [filteredOrders, debouncedSearchQuery]);

  const searchedPurchases = useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase();
    if (!q) return filteredPurchases;
    return filteredPurchases.filter(
      (p) =>
        (p.provider || '').toLowerCase().includes(q) ||
        (p.invoiceNumber || '').toLowerCase().includes(q)
    );
  }, [filteredPurchases, debouncedSearchQuery]);

  const searchedWaste = useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase();
    if (!q) return filteredWaste;
    return filteredWaste.filter(
      (w) =>
        (w.productName || '').toLowerCase().includes(q) ||
        (w.responsible || '').toLowerCase().includes(q) ||
        (w.wasteReason || '').toLowerCase().includes(q)
    );
  }, [filteredWaste, debouncedSearchQuery]);

  const visibleOrders = useMemo(
    () => (showAllTableRows ? searchedOrders : searchedOrders.slice(0, 50)),
    [searchedOrders, showAllTableRows]
  );

  const visiblePurchases = useMemo(
    () => (showAllTableRows ? searchedPurchases : searchedPurchases.slice(0, 50)),
    [searchedPurchases, showAllTableRows]
  );

  const visibleWaste = useMemo(
    () => (showAllTableRows ? searchedWaste : searchedWaste.slice(0, 50)),
    [searchedWaste, showAllTableRows]
  );

  const activeSearchedCount =
    activeTableView === 'ventas'
      ? searchedOrders.length
      : activeTableView === 'compras'
      ? searchedPurchases.length
      : searchedWaste.length;

  // Seed sample demonstration data
  const handleSeedDemoReports = async () => {
    if (seedingRef.current) return;
    seedingRef.current = true;
    setIsSeeding(true);
    setModuleError(null);
    try {
      const batch = writeBatch(db);
      const now = new Date();

      for (let i = 4; i >= 0; i--) {
        const orderDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 14, 30);
        const dateStr = orderDate.toISOString();

        const orderRef = doc(collection(db, 'orders'));
        const subtotal = 18.5 * 2 + 14.0 + (i % 2 === 0 ? 24 : 16.5);
        batch.set(orderRef, {
          tableNumber: (i % 6) + 1,
          status: 'Cobrado',
          sentToKitchen: true,
          branch: activeBranch,
          total: subtotal,
          items: [
            { id: 'item-1', name: 'Lomo Fino Angus en Salsa Demi-Glace', price: 18.5, quantity: 2 },
            { id: 'item-2', name: 'Ceviche Mixto Gastrolab', price: 14.0, quantity: 1 },
            { id: 'item-3', name: 'Hamburguesa Brioche Wagyu', price: 12.0, quantity: i % 2 === 0 ? 2 : 1 },
          ],
          createdAt: dateStr,
          updatedAt: dateStr,
        });
      }

      await commitOfflineSafe(batch.commit(), 'cargar ventas demo');
    } catch (e: any) {
      console.error('Error al sembrar datos demo de reportes:', e);
      setModuleError(e?.message || 'Error al cargar las ventas de demostración.');
    } finally {
      seedingRef.current = false;
      setIsSeeding(false);
    }
  };

  // TRUE 5-SHEET EXCEL EXPORT USING XLSX LIBRARY
  const executeExcelExport = () => {
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Ventas Totales
      const ventasData = filteredOrders.map((o) => {
        const parsedDate = safeToDate(o.createdAt);
        return {
          'ID Pedido': o.id || '',
          'Mesa / Orden': formatOrderOriginLabel(o),
          'Fecha y Hora': parsedDate ? parsedDate.toLocaleString('es-EC') : '',
          'Estado': o.status || 'Completado',
          'Cantidad Items': (o.items || []).reduce((acc, i) => acc + (Number(i?.quantity) || 1), 0),
          'Total Venta ($)': Number((Number(o.total) || 0).toFixed(2)),
          'Detalle de Platillos': (o.items || []).map((i) => `${i?.quantity || 1}x ${i?.name || 'Platillo'}`).join(' | '),
        };
      });
      const wsVentas = XLSX.utils.json_to_sheet(ventasData.length > 0 ? ventasData : [{ Mensaje: 'Sin registros de ventas' }]);
      XLSX.utils.book_append_sheet(wb, wsVentas, 'Ventas Totales');

      // Sheet 2: Ticket Promedio
      const ticketPromedioData = [
        {
          Métrica: 'Ventas Totales ($)',
          Valor: Number(totalSalesAmount.toFixed(2)),
          Detalle: 'Monto total recaudado en el período',
        },
        {
          Métrica: 'Número de Comandas / Mesas',
          Valor: totalOrdersCount,
          Detalle: 'Cantidad de órdenes procesadas',
        },
        {
          Métrica: 'Ticket Promedio General ($)',
          Valor: Number(averageTicket.toFixed(2)),
          Detalle: 'Gasto promedio calculado por comanda',
        },
        {
          Métrica: 'Período Seleccionado',
          Valor: dateFilter.toUpperCase(),
          Detalle: `${customStartDate} al ${customEndDate}`,
        },
      ];
      const wsTicket = XLSX.utils.json_to_sheet(ticketPromedioData);
      XLSX.utils.book_append_sheet(wb, wsTicket, 'Ticket Promedio');

      // Sheet 3: Costo de Mermas
      const mermasData = filteredWaste.map((w) => ({
        'Fecha': w.date || '',
        'Producto': w.productName || '',
        'Unidad': w.unit || 'Grs.',
        'Peso Inicial': Number((w.initialWeight || 0).toFixed(2)),
        'Peso Final': Number((w.finalWeight || 0).toFixed(2)),
        'Merma Neta': Number((w.wasteAmount || 0).toFixed(2)),
        'Merma %': Number((w.wastePercentage || 0).toFixed(1)),
        'Cantidad Útil': Number((w.usableQuantity || 0).toFixed(2)),
        'Responsable': w.responsible || '',
        'Motivo / Justificación': w.wasteReason || '',
      }));
      const wsMermas = XLSX.utils.json_to_sheet(mermasData.length > 0 ? mermasData : [{ Mensaje: 'Sin registros de mermas' }]);
      XLSX.utils.book_append_sheet(wb, wsMermas, 'Costo de Mermas');

      // Sheet 4: Compras de Insumos
      const comprasData = filteredPurchases.map((p) => ({
        'N° Factura': p.invoiceNumber || '',
        'Proveedor': p.provider || '',
        'Fecha de Factura': p.date || '',
        'Cantidad de Insumos': (p.items || []).length,
        'Monto Total ($)': Number((p.totalAmount || 0).toFixed(2)),
        'Tiene Merma Asociada': p.hasWaste ? 'SÍ' : 'NO',
      }));
      const wsCompras = XLSX.utils.json_to_sheet(comprasData.length > 0 ? comprasData : [{ Mensaje: 'Sin registros de compras' }]);
      XLSX.utils.book_append_sheet(wb, wsCompras, 'Compras de Insumos');

      // Sheet 5: Platos más vendidos
      const platosData = topSellingProducts.map((p, idx) => ({
        'Posición / Ranking': idx + 1,
        'Platillo / Receta': p.name,
        'Unidades Vendidas': p.quantity,
        'Ingresos Acumulados ($)': Number(p.revenue.toFixed(2)),
      }));
      const wsPlatos = XLSX.utils.json_to_sheet(platosData.length > 0 ? platosData : [{ Mensaje: 'Sin ventas para calcular ranking' }]);
      XLSX.utils.book_append_sheet(wb, wsPlatos, 'Platos más vendidos');

      // Generate file download
      XLSX.writeFile(wb, `GASTROLAB_${activeBranch.replace(/\s+/g, '_')}_Reporte_Integral_5_Hojas_${dateFilter}.xlsx`);
    } catch (err: any) {
      console.error('Error al generar Excel 5 hojas:', err);
      setModuleError(err?.message || 'Error al generar el archivo Excel de 5 hojas.');
    }
  };

  return (
    <div className="space-y-6 text-gray-900">
      {moduleError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-semibold">{moduleError}</span>
          </div>
          <button
            type="button"
            onClick={() => setModuleError(null)}
            className="text-rose-600 hover:text-rose-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header & Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-gray-200 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
            <BarChart3 className="w-6 h-6 text-[#E89E2D]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-[#4A5D23]">Dashboard y Reportes Gerenciales</h2>
            </div>
            <p className="text-xs text-gray-500">
              Ventas consolidadas, ticket promedio, costo de mermas, platillos top y exportación en 5 hojas Excel
            </p>
          </div>
        </div>

        {/* Action Controls & Excel Download */}
        <div className="flex flex-wrap items-center gap-2.5">
          {orders.length === 0 && (
            <button
              type="button"
              disabled={isSeeding}
              onClick={handleSeedDemoReports}
              className="px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-xs text-[#4A5D23] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4 text-[#E89E2D]" />
              {isSeeding ? 'Cargando Demo...' : 'Cargar Ventas Demo'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsAuthModalOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] border border-[#4A5D23] text-white text-xs font-bold flex items-center gap-2 transition-all shadow-xs active:scale-95 cursor-pointer"
            title="Exportar archivo de 5 hojas (.xlsx) protegido con clave de administrador"
          >
            <Download className="w-4 h-4 text-[#E89E2D]" />
            <span>Descargar en Excel (5 Hojas)</span>
          </button>
        </div>
      </div>

      {/* Date Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50 p-3 rounded-2xl border border-gray-200">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-xs font-bold text-gray-500 mr-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-[#E89E2D]" />
            Período:
          </span>
          <button
            type="button"
            onClick={() => setDateFilter('today')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              dateFilter === 'today'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 bg-white border border-gray-200'
            }`}
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => setDateFilter('week')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              dateFilter === 'week'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 bg-white border border-gray-200'
            }`}
          >
            Esta Semana
          </button>
          <button
            type="button"
            onClick={() => setDateFilter('month')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              dateFilter === 'month'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 bg-white border border-gray-200'
            }`}
          >
            Este Mes
          </button>
          <button
            type="button"
            onClick={() => setDateFilter('custom')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              dateFilter === 'custom'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 bg-white border border-gray-200'
            }`}
          >
            Rango Personalizado
          </button>
        </div>

        {dateFilter === 'custom' && (
          <div className="flex items-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-200">
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="bg-white border border-gray-200 rounded-xl px-2.5 py-1 text-xs text-gray-900 focus:outline-none"
            />
            <span className="text-gray-400 text-xs">hasta</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="bg-white border border-gray-200 rounded-xl px-2.5 py-1 text-xs text-gray-900 focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* 4 PRIMARY KPI CARDS (Olive Green Dashboard Gradient Style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Ventas Totales */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-[#355415] to-[#587D23] text-white shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/90 mb-2">
            <span>Ventas Totales</span>
            <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center text-white">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-mono font-black text-white">
              ${totalSalesAmount.toFixed(2)}
            </div>
            <div className="text-xs text-emerald-100 mt-1 flex items-center gap-1 font-semibold">
              <span>{totalOrdersCount} órdenes en período</span>
            </div>
          </div>
        </div>

        {/* KPI 2: Ticket Promedio */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-[#5B8722] to-[#7DA63B] text-white shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/90 mb-2">
            <span>Ticket Promedio</span>
            <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center text-white">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-mono font-black text-white">
              ${averageTicket.toFixed(2)}
            </div>
            <div className="text-xs text-white/85 mt-1 font-medium">
              Gasto medio por mesa
            </div>
          </div>
        </div>

        {/* KPI 3: Costo de Mermas */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-[#125568] to-[#1E6F84] text-white shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/90 mb-2">
            <span>Costo de Mermas</span>
            <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center text-white">
              <Scale className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-mono font-black text-white">
              ${totalWasteCost.toFixed(2)}
            </div>
            <div className="text-xs text-cyan-100 mt-1 font-medium">
              {filteredWaste.length} registros procesados
            </div>
          </div>
        </div>

        {/* KPI 4: Compras de Insumos */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-[#D68B1C] to-[#E8A534] text-white shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/95 mb-2">
            <span>Compras de Insumos</span>
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-white">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-mono font-black text-white">
              ${totalPurchasesAmount.toFixed(2)}
            </div>
            <div className="text-xs text-amber-50 mt-1 font-medium">
              {filteredPurchases.length} facturas registradas
            </div>
          </div>
        </div>
      </div>

      {/* SECTION: CHARTS ROW (Ventas Diarias con Valores + Top Platillos) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CHART 1: Ventas Diarias (Barras con valores exactos / Área) */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#4A5D23]" />
                Ventas Diarias (Valores Exactos)
              </h3>
              <p className="text-xs text-gray-500">Facturación acumulada por fecha con montos exactos ($)</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-black text-[#4A5D23] bg-[#EAF5F0] px-2.5 py-1 rounded-lg border border-[#4A5D23]/20">
                ${totalSalesAmount.toFixed(2)} total
              </span>
              <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setSalesChartStyle('bar')}
                  className={`px-2 py-1 rounded-md cursor-pointer transition-colors ${
                    salesChartStyle === 'bar' ? 'bg-[#4A5D23] text-white' : 'text-gray-600'
                  }`}
                >
                  Barras
                </button>
                <button
                  type="button"
                  onClick={() => setSalesChartStyle('area')}
                  className={`px-2 py-1 rounded-md cursor-pointer transition-colors ${
                    salesChartStyle === 'area' ? 'bg-[#4A5D23] text-white' : 'text-gray-600'
                  }`}
                >
                  Área
                </button>
              </div>
            </div>
          </div>

          <div className="h-64 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
              {salesChartStyle === 'bar' ? (
                <BarChart data={salesTrendData} margin={{ top: 22, right: 10, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="oliveBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6B8E23" />
                      <stop offset="100%" stopColor="#2F4A10" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="displayDate" stroke="#6B7280" fontSize={11} tickLine={false} />
                  <YAxis stroke="#6B7280" fontSize={11} tickLine={false} tickFormatter={(val) => `$${val}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#E5E7EB',
                      borderRadius: '0.85rem',
                      color: '#111827',
                      fontSize: '12px',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                    formatter={(val: any) => [`$${Number(val || 0).toFixed(2)}`, 'Ventas']}
                    labelFormatter={(label) => `Fecha: ${label}`}
                  />
                  <Bar dataKey="ventas" fill="url(#oliveBarGrad)" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    <LabelList
                      dataKey="ventas"
                      position="top"
                      fill="#1F2937"
                      fontSize={10}
                      fontWeight={700}
                      formatter={(val: any) => (Number(val) > 0 ? `$${Number(val).toFixed(0)}` : '')}
                    />
                  </Bar>
                </BarChart>
              ) : (
                <AreaChart data={salesTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesGradientLight" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4A5D23" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#4A5D23" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="displayDate" stroke="#9CA3AF" fontSize={11} tickLine={false} />
                  <YAxis stroke="#9CA3AF" fontSize={11} tickLine={false} tickFormatter={(val) => `$${val}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#E5E7EB',
                      borderRadius: '1rem',
                      color: '#111827',
                      fontSize: '12px',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                    formatter={(val: any) => [`$${Number(val).toFixed(2)}`, 'Ventas']}
                    labelFormatter={(label) => `Fecha: ${label}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="ventas"
                    stroke="#4A5D23"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#salesGradientLight)"
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 2: Platillos Más Vendidos (Top Products) */}
        <div className="lg:col-span-1 bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2 mb-1">
              <UtensilsCrossed className="w-4 h-4 text-[#E89E2D]" />
              Platillos Más Vendidos
            </h3>
            <p className="text-xs text-gray-500 mb-4">Ranking por volumen de comandas</p>

            {topSellingProducts.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-xs">
                No hay ventas registradas en el período.
              </div>
            ) : (
              <div className="space-y-2.5">
                {topSellingProducts.map((p, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5 truncate max-w-[170px]">
                      <span className="w-5 h-5 rounded-lg bg-[#4A5D23] text-white font-black text-[10px] flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-gray-900 truncate">{p.name}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-[#E89E2D]">{p.quantity} vendidos</div>
                      <div className="text-[10px] text-gray-500 font-mono">${p.revenue.toFixed(2)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION: PIE CHARTS WITH EXACT $ VALUES AND % PERCENTAGES */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PIE 1: Ventas por Categoría */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col justify-between">
          <div className="mb-3">
            <h3 className="text-base font-bold text-gray-900">Ventas por Categoría de Producto</h3>
            <p className="text-xs text-gray-500">Porcentaje exacto (%) y valor en dólares ($) por categoría</p>
          </div>
          {salesByCategoryData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-gray-400">
              Sin ventas registradas en el período para graficar categorías.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div className="h-56 w-full min-w-0 relative">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
                  <PieChart>
                    <Pie
                      data={salesByCategoryData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={46}
                      outerRadius={78}
                      paddingAngle={2}
                      labelLine={false}
                      label={({ percent }: any) => (percent >= 0.06 ? `${(percent * 100).toFixed(0)}%` : '')}
                    >
                      {salesByCategoryData.map((_, idx) => (
                        <Cell key={`cat-cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any, _name: any, props: any) => [
                        `$${Number(val || 0).toFixed(2)} (${props?.payload?.percent ?? 0}%)`,
                        props?.payload?.name || 'Categoría',
                      ]}
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#E5E7EB',
                        borderRadius: '0.85rem',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono font-black text-sm text-gray-900">
                    ${categoryChartTotal.toFixed(2)}
                  </span>
                  <span className="text-[10px] font-bold text-gray-500 uppercase">Total</span>
                </div>
              </div>

              <div className="space-y-2">
                {salesByCategoryData.map((item, idx) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between gap-2 text-xs py-1.5 px-2.5 rounded-xl bg-gray-50/80 border border-gray-100"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                      />
                      <span className="font-bold text-gray-800 truncate">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0 font-mono">
                      <span className="font-bold text-gray-900">${item.value.toFixed(2)}</span>
                      <span className="px-1.5 py-0.5 rounded-md bg-white border border-gray-200 font-black text-[#4A5D23] text-[11px]">
                        {item.percent.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* PIE 2: Ventas por Canal / Método */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col justify-between">
          <div className="mb-3">
            <h3 className="text-base font-bold text-gray-900">Métodos de Pago / Canal</h3>
            <p className="text-xs text-gray-500">Porcentaje exacto (%) y monto en dólares ($) por canal o cobro</p>
          </div>
          {salesByChannelData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-gray-400">
              Sin ventas registradas en el período para graficar canales.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div className="h-56 w-full min-w-0 relative">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
                  <PieChart>
                    <Pie
                      data={salesByChannelData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={46}
                      outerRadius={78}
                      paddingAngle={2}
                      labelLine={false}
                      label={({ percent }: any) => (percent >= 0.06 ? `${(percent * 100).toFixed(0)}%` : '')}
                    >
                      {salesByChannelData.map((_, idx) => (
                        <Cell key={`chan-cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any, _name: any, props: any) => [
                        `$${Number(val || 0).toFixed(2)} (${props?.payload?.percent ?? 0}%)`,
                        props?.payload?.name || 'Canal',
                      ]}
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#E5E7EB',
                        borderRadius: '0.85rem',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono font-black text-sm text-gray-900">
                    ${channelChartTotal.toFixed(2)}
                  </span>
                  <span className="text-[10px] font-bold text-gray-500 uppercase">Total</span>
                </div>
              </div>

              <div className="space-y-2">
                {salesByChannelData.map((item, idx) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between gap-2 text-xs py-1.5 px-2.5 rounded-xl bg-gray-50/80 border border-gray-100"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                      />
                      <span className="font-bold text-gray-800 truncate">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0 font-mono">
                      <span className="font-bold text-gray-900">${item.value.toFixed(2)}</span>
                      <span className="px-1.5 py-0.5 rounded-md bg-white border border-gray-200 font-black text-[#4A5D23] text-[11px]">
                        {item.percent.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SECTION: LOW STOCK ALERTS (WIDGET NARANJA - PRODUCTOS A COMPRAR) */}
      <div className="bg-amber-50/50 border-2 border-[#E89E2D] rounded-3xl p-5 sm:p-6 shadow-sm relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E89E2D]/20 border border-[#E89E2D] flex items-center justify-center text-[#E89E2D] shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-gray-900">Alerta de Insumos Críticos (Stock Mínimo en Naranja)</h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#E89E2D] text-white">
                  {lowStockItems.length} por Comprar
                </span>
              </div>
              <p className="text-xs text-gray-600">
                Insumos que alcanzaron o cayeron por debajo del umbral mínimo de seguridad.
              </p>
            </div>
          </div>
        </div>

        {lowStockItems.length === 0 ? (
          <div className="p-6 rounded-2xl bg-white border border-gray-200 text-center text-xs text-gray-600 flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Todos los insumos de inventario se encuentran por encima de su stock mínimo de seguridad.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lowStockItems.map((item) => (
              <div
                key={item.id}
                className="p-3.5 rounded-2xl bg-white border border-[#E89E2D]/50 flex items-center justify-between text-xs shadow-xs"
              >
                <div>
                  <div className="font-bold text-gray-900 text-sm">{item.name}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                    {item.category || 'Insumo'} · Unidad: {item.unit}
                  </div>
                  <div className="mt-1 font-mono text-xs text-rose-600 font-bold">
                    Stock actual: {(Number(item.currentStock) || 0).toFixed(2)} {item.unit || 'Unds.'}
                  </div>
                </div>

                <div className="text-right">
                  <div className="px-2 py-0.5 rounded-md bg-[#E89E2D]/20 text-[#4A5D23] border border-[#E89E2D]/40 font-mono font-black text-xs">
                    Mínimo: {Number(item.minStock) || 0} {item.unit || 'Unds.'}
                  </div>
                  <div className="text-[11px] font-bold text-amber-700 mt-1">
                    Pedir: +{(Number(item.deficit) || 0).toFixed(2)} {item.unit || 'Unds.'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION: REPORTS DETAIL DATA TABLE WITH SUB-TABS & EXCEL EXPORT */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        {/* Sub-tab selection for Table */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-200">
          <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-2xl border border-gray-200 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTableView('ventas')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                activeTableView === 'ventas'
                  ? 'bg-[#4A5D23] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Ventas y Pedidos ({filteredOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTableView('compras')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                activeTableView === 'compras'
                  ? 'bg-[#4A5D23] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Facturas de Compras ({filteredPurchases.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTableView('mermas')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                activeTableView === 'mermas'
                  ? 'bg-[#4A5D23] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Control de Mermas ({filteredWaste.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar en registros..."
                value={searchTableQuery}
                onChange={(e) => setSearchTableQuery(e.target.value)}
                className="bg-gray-50 border border-gray-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setIsAuthModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] border border-[#4A5D23] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              title="Descargar libro Excel de 5 hojas"
            >
              <Download className="w-3.5 h-3.5 text-[#E89E2D]" />
              <span className="hidden sm:inline">Excel (5 Hojas)</span>
            </button>
          </div>
        </div>

        {/* 1. VENTAS TABLE */}
        {activeTableView === 'ventas' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-[#4A5D23] uppercase tracking-wider border-b border-gray-200 font-semibold text-[11px]">
                <tr>
                  <th className="p-3.5">Mesa / Orden</th>
                  <th className="p-3.5">Fecha y Hora</th>
                  <th className="p-3.5">Estado</th>
                  <th className="p-3.5">Platillos / Composición</th>
                  <th className="p-3.5 text-right">Total ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {visibleOrders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-gray-400">
                      No hay pedidos registrados que coincidan en este rango de fechas.
                    </td>
                  </tr>
                ) : (
                  visibleOrders.map((order) => {
                    const orderDate = safeToDate(order.createdAt);
                    return (
                      <tr key={order.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="p-3.5 font-bold text-gray-900">{formatOrderOriginLabel(order)}</td>
                        <td className="p-3.5 text-gray-500 font-mono text-[11px]">
                          {orderDate ? orderDate.toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                        </td>
                        <td className="p-3.5">
                          <span className="px-2 py-0.5 rounded-md bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30 text-[10px] font-bold uppercase">
                            {order.status || 'Completado'}
                          </span>
                        </td>
                        <td className="p-3.5 text-gray-600">
                          <div className="truncate max-w-md">
                            {(order.items || []).map((i) => `${i?.quantity || 1}x ${i?.name || 'Platillo'}`).join(', ')}
                          </div>
                        </td>
                        <td className="p-3.5 text-right font-mono font-black text-[#4A5D23] text-sm">
                          ${(Number(order.total) || 0).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 2. COMPRAS TABLE */}
        {activeTableView === 'compras' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-[#4A5D23] uppercase tracking-wider border-b border-gray-200 font-semibold text-[11px]">
                <tr>
                  <th className="p-3.5">N° Factura</th>
                  <th className="p-3.5">Proveedor</th>
                  <th className="p-3.5">Fecha</th>
                  <th className="p-3.5 text-center">Insumos</th>
                  <th className="p-3.5 text-center">Merma</th>
                  <th className="p-3.5 text-right">Monto Total ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {visiblePurchases.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-400">
                      No hay compras registradas que coincidan en este rango de fechas.
                    </td>
                  </tr>
                ) : (
                  visiblePurchases.map((purchase) => (
                    <tr key={purchase.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-gray-900">{purchase.invoiceNumber}</td>
                      <td className="p-3.5 font-bold text-[#4A5D23]">{purchase.provider}</td>
                      <td className="p-3.5 text-gray-500 font-mono text-[11px]">{purchase.date}</td>
                      <td className="p-3.5 text-center font-mono text-gray-700">{(purchase.items || []).length} ítems</td>
                      <td className="p-3.5 text-center">
                        {purchase.hasWaste ? (
                          <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                            Con Merma
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30 text-[10px] font-bold">
                            Directa
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-right font-mono font-black text-gray-900 text-sm">
                        ${(purchase.totalAmount || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 3. MERMAS TABLE */}
        {activeTableView === 'mermas' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-[#4A5D23] uppercase tracking-wider border-b border-gray-200 font-semibold text-[11px]">
                <tr>
                  <th className="p-3.5">Fecha</th>
                  <th className="p-3.5">Producto</th>
                  <th className="p-3.5 text-right">Peso Inicial</th>
                  <th className="p-3.5 text-right">Peso Final</th>
                  <th className="p-3.5 text-right">Merma</th>
                  <th className="p-3.5 text-right">Merma %</th>
                  <th className="p-3.5 text-right">Cantidad Útil</th>
                  <th className="p-3.5">Responsable</th>
                  <th className="p-3.5">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {visibleWaste.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-gray-400">
                      No hay registros de merma que coincidan en este rango de fechas.
                    </td>
                  </tr>
                ) : (
                  visibleWaste.map((waste) => (
                    <tr key={waste.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="p-3.5 text-gray-500 font-mono text-[11px]">{waste.date}</td>
                      <td className="p-3.5 font-bold text-gray-900">{waste.productName}</td>
                      <td className="p-3.5 text-right font-mono text-gray-700">
                        {waste.initialWeight} {waste.unit}
                      </td>
                      <td className="p-3.5 text-right font-mono text-gray-900 font-bold">
                        {waste.finalWeight} {waste.unit}
                      </td>
                      <td className="p-3.5 text-right font-mono text-rose-600 font-bold">
                        {waste.wasteAmount} {waste.unit}
                      </td>
                      <td className="p-3.5 text-right font-mono font-black text-rose-600">
                        {waste.wastePercentage?.toFixed(1)}%
                      </td>
                      <td className="p-3.5 text-right font-mono text-emerald-700 font-bold">
                        {waste.usableQuantity} {waste.unit}
                      </td>
                      <td className="p-3.5 text-gray-700">{waste.responsible}</td>
                      <td className="p-3.5 text-gray-500 text-[11px] truncate max-w-xs">{waste.wasteReason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeSearchedCount > 50 && (
          <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>
              Mostrando {showAllTableRows ? activeSearchedCount : 50} de {activeSearchedCount} registros
            </span>
            <button
              type="button"
              onClick={() => setShowAllTableRows((prev) => !prev)}
              className="px-3.5 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-[#4A5D23] font-bold cursor-pointer"
            >
              {showAllTableRows ? 'Mostrar últimos 50' : `Ver todos (${activeSearchedCount})`}
            </button>
          </div>
        )}
      </div>

      {/* Delete / Export Auth Security Modal */}
      <DeleteAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onConfirm={executeExcelExport}
        title="Autorización para Descarga de Reportes"
        itemDescription="la descarga del reporte integral de 5 hojas en Excel"
        confirmButtonText="Autorizar Descarga Excel"
      />
    </div>
  );
};
