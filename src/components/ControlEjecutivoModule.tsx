import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  query,
  doc,
  setDoc,
  deleteDoc,
  orderBy,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { isValidCreatorCode } from '../utils/cryptoAuth';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { Order, Product, Recipe, CashShift, PurchaseInvoice } from '../types';
import { translateRoleToSpanish } from '../utils/roleLabels';
import { ConfiguracionModule } from './ConfiguracionModule';
import {
  generateExecutiveExcelReport,
  getExecutiveReportPreview,
  ExecutiveReportId,
  ExecutiveReportPreviewData,
} from '../utils/executiveExcelReports';
import {
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
  Settings,
  Receipt,
  Users,
  TrendingUp,
  DollarSign,
  Plus,
  Trash2,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  Edit3,
  X,
  Calculator,
  Calendar,
  Download,
  BarChart3,
  UtensilsCrossed,
  Clock,
  Utensils,
  Layers,
  Scale,
  FileText,
  CalendarCheck,
  ChevronRight,
} from 'lucide-react';

export interface MonthlyExpenseRecord {
  id: string;
  type: 'fijo' | 'variable';
  name: string;
  amount: number;
  notes?: string;
  branch?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PayrollEmployeeRecord {
  id: string;
  collaborator: string;
  position: string;
  nominalSalary: number;
  hasIess: 'SI' | 'NO';
  iessContribution: number;
  overtimeHours?: number;
  overtimeSurchargePct?: 25 | 50 | 100;
  overtimePay?: number;
  discountAmount: number;
  discountReason: string;
  netPay: number;
  branch?: string;
  createdAt: string;
  updatedAt?: string;
}

function formatPreviewCellValue(val: any, numFmt?: string): string {
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'number' && !isNaN(val)) {
    if (numFmt?.includes('%')) {
      return `${(val * 100).toFixed(1)}%`;
    }
    if (numFmt?.includes('$')) {
      const decimals = numFmt.includes('0.0000') ? 4 : 2;
      return `$${val.toLocaleString('es-EC', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`;
    }
    if (numFmt) {
      const hasDecimals = Math.abs(val % 1) > 0.00001;
      return val.toLocaleString('es-EC', {
        minimumFractionDigits: 0,
        maximumFractionDigits: hasDecimals ? 2 : 0,
      });
    }
    return Number.isInteger(val) ? String(val) : String(Number(val.toFixed(2)));
  }
  return String(val);
}

function getLocalTodayYYYYMMDD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface ControlEjecutivoModuleProps {
  initialTab?: 'gastos' | 'nomina' | 'cierre_mes' | 'informes' | 'configuracion';
}

const EXECUTIVE_REPORT_CARDS: Array<{
  id: ExecutiveReportId;
  number: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  usesDateRange?: boolean;
}> = [
  {
    id: 'mesas_pedidos',
    number: '01',
    title: 'Mesas y Pedidos',
    description:
      'Platos más vendidos, Ticket Promedio y Rendimiento del personal (KPI de ventas por mesero).',
    icon: BarChart3,
    usesDateRange: true,
  },
  {
    id: 'reservas',
    number: '02',
    title: 'Reservas',
    description:
      'Cantidad de reservas al mes (confirmadas, completadas, canceladas) y valor total consumido.',
    icon: Clock,
    usesDateRange: true,
  },
  {
    id: 'carta_rotacion',
    number: '03',
    title: 'Carta (Menor Rotación)',
    description:
      'Listado de platos y combos ordenados de menor a mayor venta para detectar baja rotación.',
    icon: UtensilsCrossed,
    usesDateRange: true,
  },
  {
    id: 'menaje_conteo',
    number: '04',
    title: 'Menaje y Equipos',
    description:
      'Inventario completo con cantidades en sistema y columnas listas para conteo físico y diferencias.',
    icon: Utensils,
    usesDateRange: false,
  },
  {
    id: 'caja_turnos',
    number: '05',
    title: 'Caja y Turnos',
    description:
      'Historial de cierres de caja detallando Efectivo, Transferencia, De Una, Tarjeta, Ingresos y Egresos.',
    icon: DollarSign,
    usesDateRange: true,
  },
  {
    id: 'facturacion',
    number: '06',
    title: 'Facturación',
    description:
      'Listado de facturas emitidas en el rango de fechas con cliente, consumos detallados y valor para auditoría.',
    icon: FileText,
    usesDateRange: true,
  },
  {
    id: 'facturas_compras',
    number: '07',
    title: 'Facturas de Compras',
    description:
      'Listado de compras a proveedores detallado por fechas e ítems para cotejar contra facturas físicas.',
    icon: Receipt,
    usesDateRange: true,
  },
  {
    id: 'kardex',
    number: '08',
    title: 'Kardex',
    description:
      'Informe detallado de entradas y salidas de inventario, alertando desperdicios, caducidades o bajas.',
    icon: Layers,
    usesDateRange: true,
  },
  {
    id: 'control_mermas',
    number: '09',
    title: 'Control de Mermas',
    description:
      'Histórico acumulado por producto con % merma y rendimiento útil para evaluar a los proveedores.',
    icon: Scale,
    usesDateRange: true,
  },
];

export const ControlEjecutivoModule: React.FC<ControlEjecutivoModuleProps> = ({
  initialTab = 'gastos',
}) => {
  const { verifyOwnerPassword, userProfile } = useAuth();
  const { activeBranch } = useBranch();

  // Security Gate: strictly locked on every entry until PROPIETARIO password is verified
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [unlockMethodLabel, setUnlockMethodLabel] = useState<'PROPIETARIO' | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Module tabs: Gastos Mensuales | Gestión de Personal y Nómina | Cierre de Mes | Informes | Configuración
  const [activeTab, setActiveTab] = useState<'gastos' | 'nomina' | 'cierre_mes' | 'informes' | 'configuracion'>(
    initialTab
  );
  const [expenseSubTab, setExpenseSubTab] = useState<'fijo' | 'variable' | 'compras'>('fijo');
  const [reportStartDate, setReportStartDate] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [reportEndDate, setReportEndDate] = useState<string>(getLocalTodayYYYYMMDD());
  const [generatingReportId, setGeneratingReportId] = useState<ExecutiveReportId | null>(null);
  const [previewingReportId, setPreviewingReportId] = useState<ExecutiveReportId | null>(null);
  const [reportPreview, setReportPreview] = useState<ExecutiveReportPreviewData | null>(null);
  const [activePreviewSheetIdx, setActivePreviewSheetIdx] = useState(0);
  const [previewReportTitle, setPreviewReportTitle] = useState('');

  // Local feedback
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Store settings (for local logo & metadata on Rol de Pagos print)
  const [storeSettings, setStoreSettings] = useState<{
    localName?: string;
    ruc?: string;
    address?: string;
    logoUrl?: string;
  }>({});

  // Monthly expenses, live orders, recipes, products & cash shifts for Break-Even & Cierre de Mes
  const [rawExpenses, setRawExpenses] = useState<MonthlyExpenseRecord[]>([]);
  const [rawOrders, setRawOrders] = useState<Order[]>([]);
  const [rawProducts, setRawProducts] = useState<Product[]>([]);
  const [rawRecipes, setRawRecipes] = useState<Recipe[]>([]);
  const [rawCashShifts, setRawCashShifts] = useState<CashShift[]>([]);
  const [rawPurchases, setRawPurchases] = useState<PurchaseInvoice[]>([]);
  const [operatingDays, setOperatingDays] = useState<string>('30');
  const [desiredProfitInput, setDesiredProfitInput] = useState<string>('');
  const [avgMarginInput, setAvgMarginInput] = useState<string>('65');
  const [closingMonth, setClosingMonth] = useState<string>(() => getLocalTodayYYYYMMDD().slice(0, 7));
  const [cierreDrilldown, setCierreDrilldown] = useState<
    'ventas' | 'ordenes' | 'ticket' | 'rentabilidad' | 'equilibrio' | null
  >(null);

  // Expense form states
  const [expenseName, setExpenseName] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNotes, setExpenseNotes] = useState('');
  const [isSavingExpense, setIsSavingExpense] = useState(false);

  // Payroll state
  const [rawEmployees, setRawEmployees] = useState<PayrollEmployeeRecord[]>([]);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [collaborator, setCollaborator] = useState('');
  const [position, setPosition] = useState('');
  const [nominalSalary, setNominalSalary] = useState('');
  const [hasIess, setHasIess] = useState<'SI' | 'NO'>('SI');
  const [overtimeHours, setOvertimeHours] = useState('');
  const [overtimeSurchargePct, setOvertimeSurchargePct] = useState<25 | 50 | 100>(50);
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [isSavingEmployee, setIsSavingEmployee] = useState(false);
  const [isPrintingPayroll, setIsPrintingPayroll] = useState(false);
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const [showAllEmployees, setShowAllEmployees] = useState(false);

  // Delete confirmation modal state
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'expense' | 'employee';
    id: string;
    label: string;
  } | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const printTimerRef = useRef<number | null>(null);
  const printCleanupTimerRef = useRef<number | null>(null);
  const verifyingRef = useRef(false);
  const savingExpenseRef = useRef(false);
  const savingEmployeeRef = useRef(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (printTimerRef.current) window.clearTimeout(printTimerRef.current);
      if (printCleanupTimerRef.current) window.clearTimeout(printCleanupTimerRef.current);
    };
  }, []);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setFeedback({ type, text });
    toastTimerRef.current = window.setTimeout(() => setFeedback(null), 4000);
  }, []);

  // Attach Firestore listeners ONLY after unlocking with Owner or Creator password
  useEffect(() => {
    if (!isUnlocked) return;

    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'general'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as any;
          setStoreSettings({
            localName: d.localName || '',
            ruc: d.ruc || '',
            address: d.address || '',
            logoUrl: d.logoUrl || '/assets/gastrolab_fhd.jpg',
          });
        }
      },
      (err) => console.warn('ControlEjecutivo settings notice:', err)
    );

    const unsubExpenses = onSnapshot(
      query(collection(db, 'monthly_expenses'), orderBy('createdAt', 'desc')),
      (snap) => {
        const list: MonthlyExpenseRecord[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<MonthlyExpenseRecord, 'id'>) }));
        setRawExpenses(list);
      },
      (err) => {
        console.warn('ControlEjecutivo expenses notice:', err);
        showToast('error', 'No se pudieron sincronizar los gastos mensuales.');
      }
    );

    const unsubPayroll = onSnapshot(
      query(collection(db, 'payroll_employees'), orderBy('createdAt', 'desc')),
      (snap) => {
        const list: PayrollEmployeeRecord[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<PayrollEmployeeRecord, 'id'>) }));
        setRawEmployees(list);
      },
      (err) => {
        console.warn('ControlEjecutivo payroll notice:', err);
        showToast('error', 'No se pudo sincronizar la nómina de personal.');
      }
    );

    const unsubOrders = onSnapshot(
      query(collection(db, 'orders')),
      (snap) => {
        const list: Order[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }));
        setRawOrders(list);
      },
      (err) => {
        console.warn('ControlEjecutivo orders notice:', err);
        showToast('error', 'No se pudieron sincronizar las ventas para el punto de equilibrio.');
      }
    );

    const unsubProducts = onSnapshot(
      query(collection(db, 'products')),
      (snap) => {
        const list: Product[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }));
        setRawProducts(list);
      },
      (err) => console.warn('ControlEjecutivo products notice:', err)
    );

    const unsubRecipes = onSnapshot(
      query(collection(db, 'recipes')),
      (snap) => {
        const list: Recipe[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Recipe, 'id'>) }));
        setRawRecipes(list);
      },
      (err) => console.warn('ControlEjecutivo recipes notice:', err)
    );

    const unsubShifts = onSnapshot(
      query(collection(db, 'cash_shifts')),
      (snap) => {
        const list: CashShift[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<CashShift, 'id'>) }));
        setRawCashShifts(list);
      },
      (err) => console.warn('ControlEjecutivo shifts notice:', err)
    );

    const unsubPurchases = onSnapshot(
      query(collection(db, 'purchases'), orderBy('createdAt', 'desc')),
      (snap) => {
        const list: PurchaseInvoice[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<PurchaseInvoice, 'id'>) }));
        setRawPurchases(list);
      },
      (err) => console.warn('ControlEjecutivo purchases notice:', err)
    );

    return () => {
      unsubSettings();
      unsubExpenses();
      unsubPayroll();
      unsubOrders();
      unsubProducts();
      unsubRecipes();
      unsubShifts();
      unsubPurchases();
    };
  }, [isUnlocked, showToast]);

  // Verify exclusive Owner OR Creator password
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyingRef.current) return;
    setUnlockError(null);
    const cleanPass = passwordInput.trim();
    if (!cleanPass) {
      setUnlockError('Ingresa la contraseña exclusiva del PROPIETARIO.');
      return;
    }

    verifyingRef.current = true;
    setIsVerifying(true);
    try {
      // 1. Check creator master key via SHA-256 verification (zero plaintext keys)
      if (await isValidCreatorCode(cleanPass)) {
        setUnlockMethodLabel('PROPIETARIO');
        setIsUnlocked(true);
        setPasswordInput('');
        return;
      }

      // 2. Check Owner exclusive password (rejects any other staff password)
      const isValidOwner = await verifyOwnerPassword(cleanPass);
      if (isValidOwner) {
        setUnlockMethodLabel('PROPIETARIO');
        setIsUnlocked(true);
        setPasswordInput('');
        return;
      }

      setUnlockError('Acceso denegado. Contraseña exclusiva de PROPIETARIO incorrecta.');
    } catch {
      setUnlockError('No se pudo validar la contraseña. Intenta nuevamente.');
    } finally {
      verifyingRef.current = false;
      setIsVerifying(false);
    }
  };

  // Branch-isolated expenses, orders, payroll & cash shifts
  const expenses = useMemo(
    () => rawExpenses.filter((e) => belongsToBranch(e.branch, activeBranch)),
    [rawExpenses, activeBranch]
  );
  const orders = useMemo(
    () => rawOrders.filter((o) => belongsToBranch(o.branch, activeBranch)),
    [rawOrders, activeBranch]
  );
  const employees = useMemo(
    () => rawEmployees.filter((emp) => belongsToBranch(emp.branch, activeBranch)),
    [rawEmployees, activeBranch]
  );
  const branchCashShifts = useMemo(
    () => rawCashShifts.filter((s) => belongsToBranch(s.branch, activeBranch)),
    [rawCashShifts, activeBranch]
  );
  const purchaseInvoices = useMemo(
    () => rawPurchases.filter((inv) => belongsToBranch((inv as any).branch, activeBranch)),
    [rawPurchases, activeBranch]
  );

  // Payroll Totals (computed upfront so Break-Even Costo Fijo Total uses Total Nómina reactively)
  const payrollTotals = useMemo(() => {
    return employees.reduce(
      (acc, emp) => ({
        nominal: acc.nominal + (emp.nominalSalary || 0),
        overtime: acc.overtime + (emp.overtimePay || 0),
        iess: acc.iess + (emp.iessContribution || 0),
        discounts: acc.discounts + (emp.discountAmount || 0),
        net: acc.net + (emp.netPay || 0),
      }),
      { nominal: 0, overtime: 0, iess: 0, discounts: 0, net: 0 }
    );
  }, [employees]);

  // Unit recipe cost map per product (handles direct recipes, linkedRecipeId, and combos)
  const productUnitCostMap = useMemo(() => {
    const recipeCostById = new Map<string, number>();
    const recipeCostByProductId = new Map<string, number>();

    rawRecipes.forEach((r) => {
      const unitCost = (Number(r.realCost) || 0) / Math.max(1, Number(r.portions) || 1);
      recipeCostById.set(r.id, unitCost);
      if (r.productId) {
        recipeCostByProductId.set(r.productId, unitCost);
      }
    });

    const baseCostByProduct = new Map<string, number>();
    rawProducts.forEach((p) => {
      if (p.linkedRecipeId && recipeCostById.has(p.linkedRecipeId)) {
        baseCostByProduct.set(p.id, recipeCostById.get(p.linkedRecipeId) || 0);
      } else if (recipeCostByProductId.has(p.id)) {
        baseCostByProduct.set(p.id, recipeCostByProductId.get(p.id) || 0);
      }
    });

    const finalCostByProduct = new Map<string, number>(baseCostByProduct);
    rawProducts.forEach((p) => {
      if (p.isCombo && Array.isArray(p.comboItems) && p.comboItems.length > 0) {
        const comboRecipeSum = p.comboItems.reduce(
          (sum, ci) => sum + (baseCostByProduct.get(ci.productId) || 0) * (Number(ci.quantity) || 1),
          0
        );
        if (comboRecipeSum > 0) {
          finalCostByProduct.set(p.id, comboRecipeSum);
        }
      }
    });
    return finalCostByProduct;
  }, [rawProducts, rawRecipes]);

  const computeOrdersRecipeCost = useCallback(
    (targetOrders: Order[]): number => {
      let costSum = 0;
      for (const ord of targetOrders) {
        for (const item of ord.items || []) {
          const unitCost = productUnitCostMap.get(item.productId) || 0;
          costSum += unitCost * (Number(item.quantity) || 0);
        }
      }
      return costSum;
    },
    [productUnitCostMap]
  );

  // Expense computations & Strict Financial Break-Even (Punto de Equilibrio)
  const fixedExpenses = useMemo(() => expenses.filter((e) => e.type === 'fijo'), [expenses]);
  const variableExpenses = useMemo(() => expenses.filter((e) => e.type === 'variable'), [expenses]);
  const activeExpenseList = useMemo(
    () => (expenseSubTab === 'fijo' ? fixedExpenses : variableExpenses),
    [expenseSubTab, fixedExpenses, variableExpenses]
  );
  const visibleExpenseList = useMemo(
    () => (showAllExpenses ? activeExpenseList : activeExpenseList.slice(0, 50)),
    [activeExpenseList, showAllExpenses]
  );
  const visibleEmployees = useMemo(
    () => (showAllEmployees ? employees : employees.slice(0, 50)),
    [employees, showAllEmployees]
  );

  const totalFixed = useMemo(
    () => fixedExpenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0),
    [fixedExpenses]
  );
  const totalVariable = useMemo(
    () => variableExpenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0),
    [variableExpenses]
  );
  const totalPurchases = useMemo(
    () => purchaseInvoices.reduce((acc, inv) => acc + (Number(inv.totalAmount) || 0), 0),
    [purchaseInvoices]
  );

  const {
    costoFijoTotal,
    gananciaDeseada,
    metaMensual,
    margenPromedioPct,
    diasOperacion,
    hasBreakEvenDivZero,
    breakEvenErrorMsg,
    puntoEquilibrioMensual,
    dailyBreakEven,
  } = useMemo(() => {
    const cft = totalFixed + totalVariable + totalPurchases + payrollTotals.net;
    const desired = Math.max(0, Number.isFinite(parseFloat(desiredProfitInput)) ? parseFloat(desiredProfitInput) : 0);
    const meta = cft + desired;
    const rawMargin = avgMarginInput.trim() === '' ? 0 : parseFloat(avgMarginInput);
    const safeMargin = Number.isFinite(rawMargin) ? rawMargin : 0;
    const rawDays = operatingDays.trim() === '' ? 0 : parseInt(operatingDays, 10);
    const safeDays = Number.isFinite(rawDays) ? rawDays : 0;

    let divZero = false;
    let errText = '';
    if (safeMargin <= 0) {
      divZero = true;
      errText = 'El Margen Promedio (%) debe ser mayor a 0% para evitar división por cero.';
    } else if (safeDays <= 0) {
      divZero = true;
      errText = 'Los Días del Mes deben ser mayores a 0 para calcular la Meta Diaria.';
    }

    const monthlyBe = safeMargin > 0 ? meta / (safeMargin / 100) : 0;
    const dailyBe = !divZero && safeDays > 0 ? monthlyBe / safeDays : 0;

    return {
      costoFijoTotal: Number.isFinite(cft) ? cft : 0,
      gananciaDeseada: desired,
      metaMensual: Number.isFinite(meta) ? meta : 0,
      margenPromedioPct: safeMargin,
      diasOperacion: safeDays,
      hasBreakEvenDivZero: divZero,
      breakEvenErrorMsg: errText,
      puntoEquilibrioMensual: Number.isFinite(monthlyBe) ? monthlyBe : 0,
      dailyBreakEven: Number.isFinite(dailyBe) ? dailyBe : 0,
    };
  }, [totalFixed, totalVariable, totalPurchases, payrollTotals.net, desiredProfitInput, avgMarginInput, operatingDays]);

  const { todayOrdersList, todaySales, todayRecipeCost, todayRealMargin, todayRealMarginPct } = useMemo(() => {
    const localToday = getLocalTodayYYYYMMDD();
    const utcToday = new Date().toISOString().split('T')[0];
    const list = orders.filter((o) => {
      if (o.status === 'Anulado') return false;
      const dateStr = ((o as any).paidAt || o.createdAt || '').split('T')[0];
      return dateStr === localToday || dateStr === utcToday;
    });
    const sales = list.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
    const recipeCost = computeOrdersRecipeCost(list);
    // Lógica financiera estricta: Ventas Brutas Hoy - Costo de Recetas Vendidas - Total de Facturas de Compras
    const realMargin = sales - recipeCost - totalPurchases;
    const realMarginPct = sales > 0 ? (realMargin / sales) * 100 : 0;
    return {
      todayOrdersList: list,
      todaySales: sales,
      todayRecipeCost: recipeCost,
      todayRealMargin: realMargin,
      todayRealMarginPct: realMarginPct,
    };
  }, [orders, computeOrdersRecipeCost, totalPurchases]);

  const monthSales = useMemo(() => {
    const currentMonth = getLocalTodayYYYYMMDD().slice(0, 7);
    return orders
      .filter((o) => {
        if (o.status === 'Anulado') return false;
        const dateStr = (o as any).paidAt || o.createdAt || '';
        return typeof dateStr === 'string' && dateStr.startsWith(currentMonth);
      })
      .reduce((acc, o) => acc + (Number(o.total) || 0), 0);
  }, [orders]);

  const breakEvenCoveragePct =
    dailyBreakEven > 0 ? Math.min(100, (todaySales / dailyBreakEven) * 100) : todaySales > 0 ? 100 : 0;
  const dailyDifference = todaySales - dailyBreakEven;
  const missingToday = Math.max(0, dailyBreakEven - todaySales);

  // Dynamic Monthly Summary ("Cierre de Mes") computed reactively with useMemo
  const monthlyCloseStats = useMemo(() => {
    const monthOrders = orders
      .filter((o) => {
        if (o.status === 'Anulado') return false;
        const dateStr = (o as any).paidAt || o.createdAt || '';
        return typeof dateStr === 'string' && dateStr.startsWith(closingMonth);
      })
      .sort((a, b) =>
        ((b as any).paidAt || b.createdAt || '').localeCompare((a as any).paidAt || a.createdAt || '')
      );

    const monthShifts = branchCashShifts
      .filter((s) => {
        const d = s.closedAt || s.openedAt || s.createdAt || '';
        return typeof d === 'string' && d.startsWith(closingMonth);
      })
      .sort((a, b) => (b.closedAt || b.openedAt || '').localeCompare(a.closedAt || a.openedAt || ''));

    const ventasTotales = monthOrders.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
    const numOrdenes = monthOrders.length;
    const ticketPromedio = numOrdenes > 0 ? ventasTotales / numOrdenes : 0;
    const costoRecetasMes = computeOrdersRecipeCost(monthOrders);
    const margenBrutoMes = ventasTotales - costoRecetasMes;
    const rentabilidadNeta = margenBrutoMes - costoFijoTotal;
    const rentabilidadPct = ventasTotales > 0 ? (rentabilidadNeta / ventasTotales) * 100 : 0;
    const puntoEquilibrioCumplido =
      puntoEquilibrioMensual > 0 ? ventasTotales >= puntoEquilibrioMensual : ventasTotales > 0;
    const coberturaMensualPct =
      puntoEquilibrioMensual > 0 ? (ventasTotales / puntoEquilibrioMensual) * 100 : ventasTotales > 0 ? 100 : 0;

    return {
      monthOrders,
      monthShifts,
      ventasTotales,
      numOrdenes,
      ticketPromedio,
      costoRecetasMes,
      margenBrutoMes,
      rentabilidadNeta,
      rentabilidadPct,
      puntoEquilibrioCumplido,
      coberturaMensualPct,
    };
  }, [orders, branchCashShifts, closingMonth, computeOrdersRecipeCost, costoFijoTotal, puntoEquilibrioMensual]);

  // Save Fixed or Variable Expense
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingExpenseRef.current) return;
    const cleanName = expenseName.trim();
    const parsedAmt = parseFloat(expenseAmount);

    if (!cleanName) {
      showToast('error', 'Ingresa el nombre del gasto.');
      return;
    }
    if (isNaN(parsedAmt) || parsedAmt <= 0) {
      showToast('error', 'Ingresa un valor válido mayor a $0.00.');
      return;
    }

    savingExpenseRef.current = true;
    setIsSavingExpense(true);
    try {
      const now = new Date().toISOString();
      const docId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await commitOfflineSafe(
        setDoc(doc(db, 'monthly_expenses', docId), {
          type: expenseSubTab === 'variable' ? 'variable' : 'fijo',
          name: cleanName,
          amount: Number(parsedAmt.toFixed(2)),
          notes: expenseNotes.trim(),
          branch: activeBranch,
          createdAt: now,
          updatedAt: now,
        }),
        'registrar gasto mensual'
      );

      setExpenseName('');
      setExpenseAmount('');
      setExpenseNotes('');
      showToast(
        'success',
        `Gasto ${expenseSubTab === 'fijo' ? 'fijo' : 'variable'} "${cleanName}" ($${parsedAmt.toFixed(2)}) registrado en ${activeBranch}.`
      );
    } catch (err: any) {
      console.error('Error al guardar gasto mensual:', err);
      showToast('error', 'Error al guardar el gasto en Firestore.');
    } finally {
      savingExpenseRef.current = false;
      setIsSavingExpense(false);
    }
  };

  // Live Payroll Form Calculations (Ecuador Art. 55: Valor Hora Ordinaria = Nominal / 240)
  const parsedNominal = parseFloat(nominalSalary) || 0;
  const computedIess = hasIess === 'SI' ? Number((parsedNominal * 0.0945).toFixed(2)) : 0;
  const parsedOvertimeHours = Math.max(0, parseFloat(overtimeHours) || 0);
  const ordinaryHourlyRate = parsedNominal > 0 ? parsedNominal / 240 : 0;
  const overtimeMultiplier = 1 + overtimeSurchargePct / 100;
  const computedOvertimePay = Number(
    (ordinaryHourlyRate * overtimeMultiplier * parsedOvertimeHours).toFixed(2)
  );
  const parsedDiscount = parseFloat(discountAmount) || 0;
  const computedNetPay = Number(
    (parsedNominal + computedOvertimePay - computedIess - parsedDiscount).toFixed(2)
  );

  const resetEmployeeForm = useCallback(() => {
    setEditingEmployeeId(null);
    setCollaborator('');
    setPosition('');
    setNominalSalary('');
    setHasIess('SI');
    setOvertimeHours('');
    setOvertimeSurchargePct(50);
    setDiscountAmount('');
    setDiscountReason('');
  }, []);

  useEffect(() => {
    resetEmployeeForm();
    setConfirmDelete(null);
  }, [activeBranch, resetEmployeeForm]);

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingEmployeeRef.current) return;
    const cleanName = collaborator.trim();
    const cleanPos = position.trim();

    if (!cleanName || !cleanPos) {
      showToast('error', 'Ingresa el nombre del colaborador y su cargo / puesto.');
      return;
    }
    if (isNaN(parseFloat(nominalSalary)) || parsedNominal <= 0) {
      showToast('error', 'Ingresa un Sueldo Nominal válido mayor a $0.00.');
      return;
    }
    if (parsedDiscount > 0 && !discountReason.trim()) {
      showToast('error', 'Ingresa el motivo del descuento o adelanto.');
      return;
    }

    savingEmployeeRef.current = true;
    setIsSavingEmployee(true);
    try {
      const now = new Date().toISOString();
      const docId =
        editingEmployeeId || `emp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      await commitOfflineSafe(
        setDoc(
          doc(db, 'payroll_employees', docId),
          {
            collaborator: cleanName,
            position: cleanPos,
            nominalSalary: Number(parsedNominal.toFixed(2)),
            hasIess,
            iessContribution: computedIess,
            overtimeHours: Number(parsedOvertimeHours.toFixed(2)),
            overtimeSurchargePct,
            overtimePay: computedOvertimePay,
            discountAmount: Number(parsedDiscount.toFixed(2)),
            discountReason: discountReason.trim(),
            netPay: computedNetPay,
            branch: activeBranch,
            ...(editingEmployeeId ? {} : { createdAt: now }),
            updatedAt: now,
          },
          { merge: true }
        ),
        'guardar nómina de colaborador'
      );

      showToast(
        'success',
        editingEmployeeId
          ? `Datos de nómina de "${cleanName}" actualizados.`
          : `Colaborador "${cleanName}" agregado a la nómina de ${activeBranch}.`
      );
      resetEmployeeForm();
    } catch (err: any) {
      console.error('Error al guardar empleado:', err);
      showToast('error', 'Error al guardar colaborador en Firestore.');
    } finally {
      savingEmployeeRef.current = false;
      setIsSavingEmployee(false);
    }
  };

  const handleStartEditEmployee = (emp: PayrollEmployeeRecord) => {
    setEditingEmployeeId(emp.id);
    setCollaborator(emp.collaborator);
    setPosition(emp.position);
    setNominalSalary(emp.nominalSalary.toString());
    setHasIess(emp.hasIess);
    setOvertimeHours(emp.overtimeHours && emp.overtimeHours > 0 ? emp.overtimeHours.toString() : '');
    setOvertimeSurchargePct(
      emp.overtimeSurchargePct === 25 || emp.overtimeSurchargePct === 50 || emp.overtimeSurchargePct === 100
        ? emp.overtimeSurchargePct
        : 50
    );
    setDiscountAmount(emp.discountAmount ? emp.discountAmount.toString() : '');
    setDiscountReason(emp.discountReason || '');
  };

  const handleExecuteDelete = async () => {
    if (!confirmDelete || deletingRef.current) return;
    deletingRef.current = true;
    try {
      const col = confirmDelete.type === 'expense' ? 'monthly_expenses' : 'payroll_employees';
      await commitOfflineSafe(
        deleteDoc(doc(db, col, confirmDelete.id)),
        'eliminar registro ejecutivo'
      );
      showToast('success', `${confirmDelete.label} eliminado correctamente.`);
    } catch (err) {
      console.error('Error al eliminar registro:', err);
      showToast('error', 'No se pudo eliminar el registro.');
    } finally {
      deletingRef.current = false;
      setConfirmDelete(null);
    }
  };

  // payrollTotals is computed above with Break-Even memos so CFT auto-sums payrollTotals.net

  // Print Rol de Pagos (with local logo)
  const handlePrintPayroll = useCallback(() => {
    if (employees.length === 0) {
      showToast('error', 'Agrega al menos un colaborador para imprimir el Rol de Pagos.');
      return;
    }
    if (printTimerRef.current) window.clearTimeout(printTimerRef.current);
    if (printCleanupTimerRef.current) window.clearTimeout(printCleanupTimerRef.current);
    setIsPrintingPayroll(true);
    printTimerRef.current = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        // Ignore print error
      }
      printCleanupTimerRef.current = window.setTimeout(() => setIsPrintingPayroll(false), 1200);
    }, 180);
  }, [employees.length, showToast]);

  // Export Rol de Pagos to Excel (.xlsx)
  const handleExportPayrollExcel = () => {
    if (employees.length === 0) {
      showToast('error', 'Agrega al menos un colaborador para exportar el Rol de Pagos.');
      return;
    }

    const rows = employees.map((emp, idx) => ({
      '#': idx + 1,
      Colaborador: emp.collaborator,
      'Cargo / Puesto': emp.position,
      'Sueldo Nominal ($)': Number((emp.nominalSalary || 0).toFixed(2)),
      'Cant. Horas Extras': Number((emp.overtimeHours || 0).toFixed(2)),
      'Recargo H. Extras (%)': emp.overtimeHours ? `${emp.overtimeSurchargePct || 50}%` : '-',
      'Valor Horas Extras ($)': Number((emp.overtimePay || 0).toFixed(2)),
      IESS: emp.hasIess,
      'Aporte IESS 9.45% ($)': Number((emp.iessContribution || 0).toFixed(2)),
      'Descuentos / Adelantos ($)': Number((emp.discountAmount || 0).toFixed(2)),
      'Motivo Descuento': emp.discountReason || '-',
      'Líquido a Recibir ($)': Number((emp.netPay || 0).toFixed(2)),
    }));

    rows.push({
      '#': '' as any,
      Colaborador: 'TOTALES GENERALES',
      'Cargo / Puesto': `${employees.length} Colaboradores`,
      'Sueldo Nominal ($)': Number(payrollTotals.nominal.toFixed(2)),
      'Cant. Horas Extras': '' as any,
      'Recargo H. Extras (%)': '',
      'Valor Horas Extras ($)': Number(payrollTotals.overtime.toFixed(2)),
      IESS: '' as any,
      'Aporte IESS 9.45% ($)': Number(payrollTotals.iess.toFixed(2)),
      'Descuentos / Adelantos ($)': Number(payrollTotals.discounts.toFixed(2)),
      'Motivo Descuento': '',
      'Líquido a Recibir ($)': Number(payrollTotals.net.toFixed(2)),
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Rol de Pagos');
    XLSX.writeFile(
      workbook,
      `ROL_DE_PAGOS_${(storeSettings.localName || 'GASTROLAB').replace(/\s+/g, '_')}_${activeBranch.replace(/\s+/g, '_')}_${getLocalTodayYYYYMMDD()}.xlsx`
    );
    showToast('success', `Rol de Pagos (${activeBranch}) exportado en formato Excel (.xlsx).`);
  };

  // SECURITY LOCK GATE
  if (!isUnlocked) {
    return (
      <div className="max-w-md mx-auto my-8 sm:my-12 bg-white border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-xl text-[#1F2937]">
        <div className="w-16 h-16 rounded-3xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] mx-auto mb-4">
          <ShieldCheck className="w-8 h-8 text-[#D97706]" />
        </div>
        <div className="text-center">
          <span className="px-3 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-black uppercase tracking-wider">
            Área Restringida · Nivel Ejecutivo
          </span>
          <h2 className="text-xl font-black text-gray-900 mt-3">Control Ejecutivo</h2>
          <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
            Este módulo contiene gastos mensuales, punto de equilibrio, nómina de personal y configuración general.
            Ingresa la contraseña exclusiva del <strong className="text-[#4A5D23]">PROPIETARIO</strong>.
          </p>
        </div>

        {unlockError && (
          <div className="mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="font-semibold">{unlockError}</span>
          </div>
        )}

        <form noValidate onSubmit={handleUnlock} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-800 mb-1.5">
              Contraseña Exclusiva — PROPIETARIO
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoFocus
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Contraseña exclusiva del PROPIETARIO..."
                className="w-full bg-gray-50 border border-gray-300 focus:bg-white focus:border-[#4A5D23] rounded-2xl pl-10 pr-10 py-3 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
              />
              <button
                type="button"
                tabIndex={-1}
                data-skip-enter="true"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 text-[11px] text-gray-500 flex items-center justify-between">
            <span>Sesión actual:</span>
            <span className="font-bold text-gray-900">
              {userProfile?.name} ({translateRoleToSpanish(userProfile?.role)})
            </span>
          </div>

          <button
            type="submit"
            disabled={isVerifying}
            className="w-full py-3 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer active:scale-95"
          >
            <Lock className="w-4 h-4 text-[#E89E2D]" />
            {isVerifying ? 'Verificando Autorización...' : 'Desbloquear Control Ejecutivo'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-gray-900">
      {/* Module Top Header + 3 Executive Tabs */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] shrink-0">
            <ShieldCheck className="w-6 h-6 text-[#4A5D23]" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-black text-gray-900">Control Ejecutivo</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-[#D97706] border border-amber-200">
                Autorizado · {unlockMethodLabel || 'PROPIETARIO'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Gastos mensuales, punto de equilibrio, nómina de personal y configuración maestra del sistema
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 w-full lg:w-auto">
          <div className="flex flex-wrap items-center gap-1 bg-gray-100 p-1 rounded-2xl border border-gray-200">
            <button
              type="button"
              onClick={() => setActiveTab('gastos')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'gastos'
                  ? 'bg-[#4A5D23] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Gastos Mensuales
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('nomina')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'nomina'
                  ? 'bg-[#4A5D23] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Gestión de Personal y Nómina
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('cierre_mes')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'cierre_mes'
                  ? 'bg-[#4A5D23] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <CalendarCheck className="w-3.5 h-3.5" />
              Cierre de Mes
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('informes')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'informes'
                  ? 'bg-[#4A5D23] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Informes
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('configuracion')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'configuracion'
                  ? 'bg-[#4A5D23] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              Configuración
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsUnlocked(false);
              setUnlockMethodLabel(null);
            }}
            className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            title="Volver a bloquear Control Ejecutivo"
          >
            <Lock className="w-3.5 h-3.5" />
            Bloquear
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-[#EAF5F0] border-[#4A5D23]/30 text-[#4A5D23]'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="cursor-pointer font-bold">
            ✕
          </button>
        </div>
      )}

      {/* ==================== TAB 1: GASTOS MENSUALES & PUNTO DE EQUILIBRIO ==================== */}
      {activeTab === 'gastos' && (
        <div className="space-y-6">
          {/* Break-Even Panel (Punto de Equilibrio Financiero Estricto) */}
          <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] shrink-0">
                  <Calculator className="w-5 h-5 text-[#E89E2D]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900">
                    Panel de Punto de Equilibrio (Finanzas Ejecutivas)
                  </h3>
                  <p className="text-xs text-gray-500">
                    CFT = Fijos + Variables + Gastos Compras + Nómina ({employees.length} colab.) · Meta Diaria = (CFT + Ganancia) / Margen / Días
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-1.5">
                  <span className="font-semibold text-gray-600">Margen Promedio (%):</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={avgMarginInput}
                    onChange={(e) => setAvgMarginInput(e.target.value)}
                    className="w-16 bg-white border border-gray-300 rounded-lg px-2 py-1 text-center font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                  {todaySales > 0 && todayRealMarginPct > 0 && (
                    <button
                      type="button"
                      onClick={() => setAvgMarginInput(todayRealMarginPct.toFixed(1))}
                      className="px-2 py-1 rounded-lg bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white text-[10px] font-bold transition-colors cursor-pointer"
                      title="Usar margen real calculado de hoy"
                    >
                      Usar Real ({todayRealMarginPct.toFixed(0)}%)
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#4A5D23]" />
                  <span className="font-semibold text-gray-600">Días del mes:</span>
                  <input
                    type="number"
                    min={0}
                    max={31}
                    value={operatingDays}
                    onChange={(e) => setOperatingDays(e.target.value)}
                    className="w-14 bg-white border border-gray-300 rounded-lg px-2 py-1 text-center font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
              </div>
            </div>

            {hasBreakEvenDivZero && (
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center gap-2.5 font-semibold">
                <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0" />
                <span>{breakEvenErrorMsg} Mostrando metas seguras en $0.00.</span>
              </div>
            )}

            {/* 6 Mandatory Dashboard KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* 1. Costos Fijos Totales */}
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">
                  Costos Fijos Totales (CFT)
                </span>
                <span className="text-2xl font-mono font-black text-gray-900 block mt-1">
                  ${costoFijoTotal.toFixed(2)}
                </span>
                <span className="text-[11px] text-gray-500 mt-1 block">
                  Fijos: ${totalFixed.toFixed(2)} · Var: ${totalVariable.toFixed(2)} · Compras: ${totalPurchases.toFixed(2)} · Nómina: ${payrollTotals.net.toFixed(2)}
                </span>
              </div>

              {/* 2. Ganancia Deseada (Editable Input) */}
              <div className="p-4 rounded-2xl bg-white border border-[#4A5D23]/30 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#4A5D23]">
                    Ganancia Deseada ($)
                  </span>
                  <span className="text-[10px] font-mono font-bold text-gray-500">
                    Meta Mes: ${metaMensual.toFixed(2)}
                  </span>
                </div>
                <div className="relative mt-1.5">
                  <DollarSign className="w-4 h-4 text-[#4A5D23] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={desiredProfitInput}
                    onChange={(e) => setDesiredProfitInput(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 focus:bg-white focus:border-[#4A5D23] rounded-xl pl-8 pr-3 py-1.5 font-mono font-black text-lg text-[#4A5D23] focus:outline-none"
                  />
                </div>
                <span className="text-[11px] text-gray-500 mt-1 block">
                  Ganancia aplicada: ${gananciaDeseada.toFixed(2)} / mes
                </span>
              </div>

              {/* 3. Meta Venta Diaria */}
              <div className="p-4 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#4A5D23] block">
                  Meta Venta Diaria
                </span>
                <span className="text-2xl font-mono font-black text-[#4A5D23] block mt-1">
                  ${dailyBreakEven.toFixed(2)} / día
                </span>
                <span className="text-[11px] text-[#4A5D23]/80 mt-1 block">
                  P.E. Mensual: ${puntoEquilibrioMensual.toFixed(2)} ({diasOperacion} días · {margenPromedioPct}%)
                </span>
              </div>

              {/* 4. Ventas Hoy */}
              <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">
                  Ventas Hoy
                </span>
                <span className="text-2xl font-mono font-black text-[#D97706] block mt-1">
                  ${todaySales.toFixed(2)}
                </span>
                <span className="text-[11px] text-amber-800 mt-1 block">
                  {todayOrdersList.length} órdenes hoy · Mes: ${monthSales.toFixed(2)}
                </span>
              </div>

              {/* 5. Margen Real Generado Hoy (Ventas Brutas Hoy - Costo Recetas - Total Facturas de Compras) */}
              <div className="p-4 rounded-2xl bg-sky-50/70 border border-sky-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-900 block">
                  Margen Real Generado Hoy
                </span>
                <span
                  className={`text-2xl font-mono font-black block mt-1 ${
                    todayRealMargin >= 0 ? 'text-sky-800' : 'text-rose-700'
                  }`}
                >
                  ${todayRealMargin.toFixed(2)}
                </span>
                <span className="text-[11px] text-sky-800 mt-1 block">
                  Ventas: ${todaySales.toFixed(2)} · Recetas: -${todayRecipeCost.toFixed(2)} · Compras: -${totalPurchases.toFixed(2)}
                </span>
              </div>

              {/* 6. Faltante para Cubrir Hoy */}
              <div
                className={`p-4 rounded-2xl border ${
                  dailyDifference >= 0
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-rose-50 border-rose-200'
                }`}
              >
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider block ${
                    dailyDifference >= 0 ? 'text-emerald-800' : 'text-rose-800'
                  }`}
                >
                  Faltante para Cubrir Hoy
                </span>
                <span
                  className={`text-2xl font-mono font-black block mt-1 ${
                    dailyDifference >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {dailyBreakEven === 0
                    ? '$0.00'
                    : dailyDifference >= 0
                    ? `$0.00 (+$${dailyDifference.toFixed(2)})`
                    : `$${missingToday.toFixed(2)}`}
                </span>
                <span
                  className={`text-[11px] font-bold mt-1 block ${
                    dailyDifference >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {dailyBreakEven === 0
                    ? 'Ingresa costos o corrige margen/días'
                    : dailyDifference >= 0
                    ? '¡Meta diaria alcanzada y superada!'
                    : `${breakEvenCoveragePct.toFixed(1)}% cubierto de la meta diaria`}
                </span>
              </div>
            </div>

            {/* Coverage Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-gray-600">
                  Cobertura del Punto de Equilibrio Diario ({breakEvenCoveragePct.toFixed(1)}%)
                </span>
                <span className="font-mono text-[#4A5D23]">
                  ${todaySales.toFixed(2)} / ${dailyBreakEven.toFixed(2)}
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-gray-100 overflow-hidden border border-gray-200">
                <div
                  className={`h-full transition-all duration-500 ${
                    dailyDifference >= 0 ? 'bg-emerald-600' : 'bg-[#4A5D23]'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, breakEvenCoveragePct))}%` }}
                />
              </div>
            </div>
          </div>

          {/* Sub-tabs: GASTOS FIJOS | GASTOS VARIABLES | GASTOS COMPRAS */}
          <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
              <div className="flex flex-wrap items-center gap-1.5 bg-gray-100 p-1 rounded-2xl border border-gray-200 w-fit">
                <button
                  type="button"
                  onClick={() => setExpenseSubTab('fijo')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    expenseSubTab === 'fijo'
                      ? 'bg-[#4A5D23] text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Gastos Fijos ({fixedExpenses.length})
                </button>
                <button
                  type="button"
                  onClick={() => setExpenseSubTab('variable')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    expenseSubTab === 'variable'
                      ? 'bg-[#4A5D23] text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Gastos Variables ({variableExpenses.length})
                </button>
                <button
                  type="button"
                  onClick={() => setExpenseSubTab('compras')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    expenseSubTab === 'compras'
                      ? 'bg-[#4A5D23] text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  GASTOS COMPRAS ({purchaseInvoices.length})
                </button>
              </div>

              <div className="text-xs font-bold text-gray-700">
                Subtotal{' '}
                {expenseSubTab === 'fijo'
                  ? 'Gastos Fijos'
                  : expenseSubTab === 'variable'
                  ? 'Gastos Variables'
                  : 'Gastos Compras'}
                :{' '}
                <span className="font-mono text-base font-black text-[#4A5D23]">
                  $
                  {(expenseSubTab === 'fijo'
                    ? totalFixed
                    : expenseSubTab === 'variable'
                    ? totalVariable
                    : totalPurchases
                  ).toFixed(2)}
                </span>
              </div>
            </div>

            {expenseSubTab === 'compras' ? (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-wider text-[#4A5D23]">
                      Total Acumulado en Facturas de Compras ({activeBranch})
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">
                      Sincronizado automáticamente desde el módulo Facturas de Compras e incluido en Costos Fijos Totales (CFT).
                    </p>
                  </div>
                  <div className="text-2xl font-mono font-black text-[#4A5D23]">
                    ${totalPurchases.toFixed(2)}
                  </div>
                </div>

                {purchaseInvoices.length === 0 ? (
                  <div className="p-10 text-center rounded-2xl border border-dashed border-gray-300 text-gray-500 text-xs">
                    <Receipt className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    No hay facturas de compras registradas todavía en {activeBranch}.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-gray-200 rounded-2xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider border-b border-gray-200 font-bold text-[11px]">
                        <tr>
                          <th className="p-3.5">Proveedor</th>
                          <th className="p-3.5">N° Factura</th>
                          <th className="p-3.5">Fecha</th>
                          <th className="p-3.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {purchaseInvoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-gray-50/70">
                            <td className="p-3.5 font-bold text-gray-900">
                              {inv.provider || 'Proveedor General'}
                            </td>
                            <td className="p-3.5 font-mono text-gray-600">
                              #{inv.invoiceNumber || inv.id.slice(0, 8)}
                            </td>
                            <td className="p-3.5 text-gray-600">
                              {inv.date ||
                                (inv.createdAt
                                  ? new Date(inv.createdAt).toLocaleDateString('es-EC')
                                  : '—')}
                            </td>
                            <td className="p-3.5 text-right font-mono font-black text-[#4A5D23] text-sm">
                              ${(Number(inv.totalAmount) || 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Add Expense Form */}
                <form
                  noValidate
                  onSubmit={handleAddExpense}
                  className="p-4 rounded-2xl bg-gray-50 border border-gray-200 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end text-xs"
                >
                  <div className="sm:col-span-5">
                    <label className="block font-bold text-gray-700 mb-1">
                      Nombre del Gasto {expenseSubTab === 'fijo' ? 'Fijo' : 'Variable'} *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={
                        expenseSubTab === 'fijo'
                          ? 'Ej. Arriendo del local, Internet, Luz...'
                          : 'Ej. Gas licuado, Publicidad, Mantenimiento...'
                      }
                      value={expenseName}
                      onChange={(e) => setExpenseName(e.target.value)}
                      className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block font-bold text-gray-700 mb-1">Valor Mensual ($) *</label>
                    <div className="relative">
                      <DollarSign className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        placeholder="0.00"
                        value={expenseAmount}
                        onChange={(e) => setExpenseAmount(e.target.value)}
                        className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl pl-8 pr-3 py-2.5 font-mono font-bold text-gray-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block font-bold text-gray-700 mb-1">Detalle (Opc.)</label>
                    <input
                      type="text"
                      placeholder="Nota..."
                      value={expenseNotes}
                      onChange={(e) => setExpenseNotes(e.target.value)}
                      className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      disabled={isSavingExpense}
                      className="w-full py-2.5 px-4 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white font-bold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <Plus className="w-4 h-4 text-[#E89E2D]" />
                      {isSavingExpense ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                </form>

                {/* Expenses List */}
                {activeExpenseList.length === 0 ? (
                  <div className="p-10 text-center rounded-2xl border border-dashed border-gray-300 text-gray-500 text-xs">
                    <Receipt className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    No hay {expenseSubTab === 'fijo' ? 'gastos fijos' : 'gastos variables'} registrados aún.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="overflow-x-auto border border-gray-200 rounded-2xl">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider border-b border-gray-200 font-bold text-[11px]">
                          <tr>
                            <th className="p-3.5">Nombre del Gasto</th>
                            <th className="p-3.5">Tipo</th>
                            <th className="p-3.5">Detalle / Fecha</th>
                            <th className="p-3.5 text-right">Valor Mensual</th>
                            <th className="p-3.5 text-right">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {visibleExpenseList.map((exp) => (
                            <tr key={exp.id} className="hover:bg-gray-50/70">
                              <td className="p-3.5 font-bold text-gray-900">{exp.name}</td>
                              <td className="p-3.5">
                                <span
                                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                    exp.type === 'fijo'
                                      ? 'bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30'
                                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                                  }`}
                                >
                                  {exp.type === 'fijo' ? 'Gasto Fijo' : 'Gasto Variable'}
                                </span>
                              </td>
                              <td className="p-3.5 text-gray-500">
                                {exp.notes || new Date(exp.createdAt).toLocaleDateString('es-EC')}
                              </td>
                              <td className="p-3.5 text-right font-mono font-black text-gray-900 text-sm">
                                ${(exp.amount || 0).toFixed(2)}
                              </td>
                              <td className="p-3.5 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmDelete({
                                      type: 'expense',
                                      id: exp.id,
                                      label: `el gasto "${exp.name}"`,
                                    })
                                  }
                                  className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 cursor-pointer"
                                  title="Eliminar gasto"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {activeExpenseList.length > 50 && (
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>
                          Mostrando {showAllExpenses ? activeExpenseList.length : 50} de {activeExpenseList.length} gastos
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowAllExpenses((prev) => !prev)}
                          className="px-3.5 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-[#4A5D23] font-bold cursor-pointer"
                        >
                          {showAllExpenses ? 'Mostrar últimos 50' : `Ver todos (${activeExpenseList.length})`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 2: GESTIÓN DE PERSONAL Y NÓMINA ==================== */}
      {activeTab === 'nomina' && (
        <div className="space-y-6">
          {/* Employee Creation / Edit Form */}
          <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
              <div>
                <h3 className="text-base font-black text-gray-900">
                  {editingEmployeeId
                    ? 'Editar Colaborador en Nómina'
                    : 'Registrar Colaborador y Rol de Pagos'}
                </h3>
                <p className="text-xs text-gray-500">
                  Cálculo automático de Aporte IESS (9.45%), descuentos y Líquido a Recibir
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportPayrollExcel}
                  className="px-3.5 py-2 rounded-xl bg-[#EAF5F0] hover:bg-[#dceee5] border border-[#4A5D23]/30 text-[#4A5D23] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Exportar Excel
                </button>
                <button
                  type="button"
                  onClick={handlePrintPayroll}
                  className="px-4 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-[#E89E2D]" />
                  Imprimir Rol de Pagos
                </button>
              </div>
            </div>

            <form noValidate onSubmit={handleSaveEmployee} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <label className="block font-bold text-gray-700 mb-1 uppercase tracking-wider text-[11px]">
                    COLABORADOR (Nombre) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder=""
                    value={collaborator}
                    onChange={(e) => setCollaborator(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3 py-2.5 text-gray-900 font-semibold focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1 uppercase tracking-wider text-[11px]">
                    CARGO / PUESTO *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder=""
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1 uppercase tracking-wider text-[11px]">
                    SUELDO NOMINAL ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder=""
                    value={nominalSalary}
                    onChange={(e) => setNominalSalary(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3 py-2.5 font-mono font-bold text-gray-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1 uppercase tracking-wider text-[11px]">
                    IESS (Afiliación) *
                  </label>
                  <select
                    value={hasIess}
                    onChange={(e) => setHasIess(e.target.value as 'SI' | 'NO')}
                    className="w-full bg-gray-50 border border-gray-300 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3 py-2.5 font-bold text-gray-900 focus:outline-none"
                  >
                    <option value="SI">SI</option>
                    <option value="NO">NO</option>
                  </select>
                </div>
              </div>

              {/* Horas Extras Section (Ecuador Art. 55) */}
              <div className="p-4 rounded-2xl bg-amber-50/40 border border-amber-200/80 grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-stretch">
                <div className="sm:col-span-2 flex flex-col justify-start">
                  <label className="block font-bold text-gray-700 mb-1 uppercase tracking-wider text-[11px] truncate">
                    HORAS EXTRAS (Cant.)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder=""
                    value={overtimeHours}
                    onChange={(e) => setOvertimeHours(e.target.value)}
                    className="w-24 max-w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-2.5 py-2 font-mono font-bold text-center text-gray-900 focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-5">
                  <label className="block font-bold text-gray-700 mb-1 uppercase tracking-wider text-[11px]">
                    TIPO DE RECARGO (LEY ECUADOR)
                  </label>
                  <select
                    value={overtimeSurchargePct}
                    onChange={(e) =>
                      setOvertimeSurchargePct(Number(e.target.value) as 25 | 50 | 100)
                    }
                    className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2.5 font-bold text-gray-900 focus:outline-none"
                  >
                    <option value={25}>25% Suplementaria (1.25x)</option>
                    <option value={50}>50% Extraordinaria (1.50x)</option>
                    <option value={100}>100% Especial / Feriado (2.00x)</option>
                  </select>
                </div>

                <div className="sm:col-span-5 p-3 rounded-2xl bg-white border border-amber-200 flex flex-col justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                    TOTAL HORAS EXTRAS (+{overtimeSurchargePct}%)
                  </span>
                  <div className="font-mono font-black text-base text-[#D97706] mt-0.5">
                    +${computedOvertimePay.toFixed(2)}
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono">
                    Valor Hora Ord.: ${ordinaryHourlyRate.toFixed(2)} (Nominal/240)
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 items-stretch">
                {/* Auto IESS 9.45% */}
                <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 flex flex-col justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    APORTE IESS (9.45%)
                  </span>
                  <div className="font-mono font-black text-base text-rose-600 mt-1">
                    -${computedIess.toFixed(2)}
                  </div>
                  <span className="text-[10px] text-gray-400">
                    {hasIess === 'SI' ? '9.45% sobre sueldo nominal' : 'Sin descuento IESS ($0.00)'}
                  </span>
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1 uppercase tracking-wider text-[11px]">
                    DESCUENTOS / ADELANTOS ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder=""
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3 py-2.5 font-mono font-bold text-gray-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1 uppercase tracking-wider text-[11px]">
                    MOTIVO DEL DESCUENTO / ADELANTO
                  </label>
                  <input
                    type="text"
                    placeholder=""
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-300 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none"
                  />
                </div>

                {/* Auto Líquido a Recibir */}
                <div className="p-3 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex flex-col justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#4A5D23]">
                    LÍQUIDO A RECIBIR
                  </span>
                  <div className="font-mono font-black text-xl text-[#4A5D23] mt-1">
                    ${computedNetPay.toFixed(2)}
                  </div>
                  <span className="text-[10px] text-[#4A5D23]/80">
                    Nominal + H. Extras - IESS - Descuentos
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                {editingEmployeeId && (
                  <button
                    type="button"
                    onClick={resetEmployeeForm}
                    className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancelar Edición
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSavingEmployee}
                  className="px-5 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white font-bold flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-[#E89E2D]" />
                  {isSavingEmployee
                    ? 'Guardando...'
                    : editingEmployeeId
                    ? 'Actualizar Colaborador'
                    : 'Guardar Colaborador en Nómina'}
                </button>
              </div>
            </form>
          </div>

          {/* Payroll Summary & List */}
          <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200">
                <span className="text-[10px] font-bold uppercase text-gray-500 block">Total Nominal</span>
                <span className="text-lg font-mono font-black text-gray-900">
                  ${payrollTotals.nominal.toFixed(2)}
                </span>
              </div>
              <div className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-200">
                <span className="text-[10px] font-bold uppercase text-amber-800 block">Total Horas Extras</span>
                <span className="text-lg font-mono font-black text-emerald-700">
                  +${payrollTotals.overtime.toFixed(2)}
                </span>
              </div>
              <div className="p-3.5 rounded-2xl bg-rose-50/70 border border-rose-200">
                <span className="text-[10px] font-bold uppercase text-rose-700 block">Aporte IESS (9.45%)</span>
                <span className="text-lg font-mono font-black text-rose-700">
                  -${payrollTotals.iess.toFixed(2)}
                </span>
              </div>
              <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200">
                <span className="text-[10px] font-bold uppercase text-amber-800 block">Descuentos / Adelantos</span>
                <span className="text-lg font-mono font-black text-[#D97706]">
                  -${payrollTotals.discounts.toFixed(2)}
                </span>
              </div>
              <div className="p-3.5 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30">
                <span className="text-[10px] font-bold uppercase text-[#4A5D23] block">Total Líquido a Pagar</span>
                <span className="text-lg font-mono font-black text-[#4A5D23]">
                  ${payrollTotals.net.toFixed(2)}
                </span>
              </div>
            </div>

            {employees.length === 0 ? (
              <div className="p-10 text-center rounded-2xl border border-dashed border-gray-300 text-gray-500 text-xs">
                <Users className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                No hay colaboradores registrados en la nómina todavía.
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-2xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider border-b border-gray-200 font-bold text-[11px]">
                    <tr>
                      <th className="p-3.5">Colaborador</th>
                      <th className="p-3.5">Cargo / Puesto</th>
                      <th className="p-3.5 text-right">Sueldo Nominal</th>
                      <th className="p-3.5 text-right">Horas Extras</th>
                      <th className="p-3.5 text-center">IESS</th>
                      <th className="p-3.5 text-right">Aporte IESS (9.45%)</th>
                      <th className="p-3.5 text-right">Descuentos</th>
                      <th className="p-3.5">Motivo</th>
                      <th className="p-3.5 text-right">Líquido a Recibir</th>
                      <th className="p-3.5 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleEmployees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-gray-50/70">
                        <td className="p-3.5 font-bold text-gray-900">{emp.collaborator}</td>
                        <td className="p-3.5 text-gray-600">{emp.position}</td>
                        <td className="p-3.5 text-right font-mono font-bold text-gray-900">
                          ${(emp.nominalSalary || 0).toFixed(2)}
                        </td>
                        <td className="p-3.5 text-right font-mono">
                          {emp.overtimePay && emp.overtimePay > 0 ? (
                            <div className="flex flex-col items-end">
                              <span className="font-bold text-emerald-700">
                                +${(emp.overtimePay || 0).toFixed(2)}
                              </span>
                              <span className="text-[10px] text-gray-500">
                                {emp.overtimeHours}h ({emp.overtimeSurchargePct || 50}%)
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="p-3.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                              emp.hasIess === 'SI'
                                ? 'bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {emp.hasIess}
                          </span>
                        </td>
                        <td className="p-3.5 text-right font-mono text-rose-600 font-semibold">
                          -${(emp.iessContribution || 0).toFixed(2)}
                        </td>
                        <td className="p-3.5 text-right font-mono text-[#D97706] font-semibold">
                          -${(emp.discountAmount || 0).toFixed(2)}
                        </td>
                        <td className="p-3.5 text-gray-500 max-w-[160px] truncate" title={emp.discountReason}>
                          {emp.discountReason || '—'}
                        </td>
                        <td className="p-3.5 text-right font-mono font-black text-[#4A5D23] text-sm">
                          ${(emp.netPay || 0).toFixed(2)}
                        </td>
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleStartEditEmployee(emp)}
                              className="p-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-[#EAF5F0] hover:text-[#4A5D23] cursor-pointer"
                              title="Editar nómina del colaborador"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmDelete({
                                  type: 'employee',
                                  id: emp.id,
                                  label: `al colaborador "${emp.collaborator}"`,
                                })
                              }
                              className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 cursor-pointer"
                              title="Eliminar colaborador"
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

            {employees.length > 50 && (
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  Mostrando {showAllEmployees ? employees.length : 50} de {employees.length} colaboradores
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllEmployees((prev) => !prev)}
                  className="px-3.5 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-[#4A5D23] font-bold cursor-pointer"
                >
                  {showAllEmployees ? 'Mostrar últimos 50' : `Ver todos (${employees.length})`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 3: INFORMES (9 REPORTES EXCEL CON LOGO) ==================== */}
      {activeTab === 'informes' && (
        <div className="space-y-6">
          {/* Date Range & Local Logo Preview Header */}
          <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                <img
                  src={storeSettings.logoUrl || '/assets/gastrolab_fhd.jpg'}
                  alt={storeSettings.localName || 'Logo del Local'}
                  className="w-full h-full object-contain"
                />
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900">
                  Centro de Informes Ejecutivos en Excel (.xlsx)
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Todos los reportes incluyen el logotipo de{' '}
                  <strong className="text-[#4A5D23]">{storeSettings.localName || 'tu local'}</strong>,
                  encabezado institucional y formato profesional listo para auditoría.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2.5 text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                  Fecha Desde
                </label>
                <input
                  type="date"
                  value={reportStartDate}
                  onChange={(e) => setReportStartDate(e.target.value)}
                  className="bg-gray-50 border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-1.5 font-mono text-xs text-gray-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                  Fecha Hasta
                </label>
                <input
                  type="date"
                  value={reportEndDate}
                  onChange={(e) => setReportEndDate(e.target.value)}
                  className="bg-gray-50 border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-1.5 font-mono text-xs text-gray-900 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const t = getLocalTodayYYYYMMDD();
                    setReportStartDate(t);
                    setReportEndDate(t);
                  }}
                  className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold cursor-pointer"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    setReportStartDate(
                      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
                    );
                    setReportEndDate(getLocalTodayYYYYMMDD());
                  }}
                  className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold cursor-pointer"
                >
                  Este Mes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReportStartDate('');
                    setReportEndDate('');
                  }}
                  className="px-3 py-2 rounded-xl bg-[#EAF5F0] hover:bg-[#dceee5] text-[#4A5D23] border border-[#4A5D23]/30 font-bold cursor-pointer"
                >
                  Todo
                </button>
              </div>
            </div>
          </div>

          {/* 9 Individual Report Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {EXECUTIVE_REPORT_CARDS.map((rep) => {
              const Icon = rep.icon;
              const isLoading = generatingReportId === rep.id;
              const isPreviewLoading = previewingReportId === rep.id;
              const isBusy = generatingReportId !== null || previewingReportId !== null;
              return (
                <div
                  key={rep.id}
                  className="bg-white border border-gray-200 rounded-3xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/25 flex items-center justify-center text-[#4A5D23] shrink-0">
                        <Icon className="w-5 h-5" />
                      </div>
                      <span className="text-[11px] font-mono font-bold text-gray-400">
                        REPORTE {rep.number}
                      </span>
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-gray-900">{rep.title}</h4>
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                        {rep.description}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-gray-100 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-400 font-medium">
                        {rep.usesDateRange
                          ? reportStartDate || reportEndDate
                            ? 'Aplica rango de fechas'
                            : 'Todo el historial'
                          : 'Inventario vigente completo'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setPreviewingReportId(rep.id);
                          try {
                            const preview = await getExecutiveReportPreview(
                              rep.id,
                              { ...storeSettings, branch: activeBranch },
                              {
                                startDate: reportStartDate || undefined,
                                endDate: reportEndDate || undefined,
                              }
                            );
                            setPreviewReportTitle(rep.title);
                            setActivePreviewSheetIdx(0);
                            setReportPreview(preview);
                          } catch (err: any) {
                            console.error('Error al visualizar informe:', err);
                            showToast(
                              'error',
                              `No se pudo visualizar "${rep.title}": ${err?.message || 'Error inesperado'}`
                            );
                          } finally {
                            setPreviewingReportId(null);
                          }
                        }}
                        className="flex-1 px-3 py-2 rounded-xl bg-[#EAF5F0] hover:bg-[#dceee5] border border-[#4A5D23]/30 disabled:opacity-50 text-[#4A5D23] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        {isPreviewLoading ? 'Cargando...' : 'Visualizar Informe'}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setGeneratingReportId(rep.id);
                          try {
                            const file = await generateExecutiveExcelReport(
                              rep.id,
                              { ...storeSettings, branch: activeBranch },
                              {
                                startDate: reportStartDate || undefined,
                                endDate: reportEndDate || undefined,
                              }
                            );
                            showToast('success', `Informe "${rep.title}" descargado: ${file}`);
                          } catch (err: any) {
                            console.error('Error al generar informe Excel:', err);
                            showToast(
                              'error',
                              `No se pudo generar "${rep.title}": ${err?.message || 'Error inesperado'}`
                            );
                          } finally {
                            setGeneratingReportId(null);
                          }
                        }}
                        className="flex-1 px-3 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer transition-all active:scale-95"
                      >
                        <Download className="w-3.5 h-3.5 text-[#E89E2D]" />
                        {isLoading ? 'Generando...' : 'Descargar Excel'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== TAB 2.5: CIERRE DE MES (DINÁMICO CON DRILL-DOWN) ==================== */}
      {activeTab === 'cierre_mes' && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] shrink-0">
                <CalendarCheck className="w-6 h-6 text-[#E89E2D]" />
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900">
                  Cierre de Mes — Auditoría Consolidada ({activeBranch})
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Toca cualquier fila de la tabla dinámica para inspeccionar el detalle de órdenes o cierres de caja.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2 text-xs">
              <Calendar className="w-4 h-4 text-[#4A5D23]" />
              <span className="font-bold text-gray-700">Mes de Auditoría:</span>
              <input
                type="month"
                value={closingMonth}
                onChange={(e) => setClosingMonth(e.target.value)}
                className="bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-2.5 py-1 font-mono font-bold text-gray-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="overflow-x-auto border border-gray-200 rounded-2xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#4A5D23] text-white uppercase tracking-wider font-bold text-[11px]">
                  <tr>
                    <th className="p-4">Indicador Mensual</th>
                    <th className="p-4">Detalle de Cálculo</th>
                    <th className="p-4 text-right">Resultado</th>
                    <th className="p-4 text-right">Auditoría</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr
                    onClick={() => setCierreDrilldown('ventas')}
                    className="hover:bg-[#EAF5F0]/60 transition-colors cursor-pointer group"
                  >
                    <td className="p-4 font-black text-gray-900">Ventas Totales</td>
                    <td className="p-4 text-gray-600">
                      Ingresos brutos del mes y cierres de caja ({monthlyCloseStats.monthShifts.length} turnos)
                    </td>
                    <td className="p-4 text-right font-mono font-black text-base text-[#4A5D23]">
                      ${monthlyCloseStats.ventasTotales.toFixed(2)}
                    </td>
                    <td className="p-4 text-right">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#EAF5F0] text-[#4A5D23] font-bold text-[11px] group-hover:bg-[#4A5D23] group-hover:text-white transition-colors">
                        Ver Cierres de Caja <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </td>
                  </tr>

                  <tr
                    onClick={() => setCierreDrilldown('ordenes')}
                    className="hover:bg-[#EAF5F0]/60 transition-colors cursor-pointer group"
                  >
                    <td className="p-4 font-black text-gray-900">N° Órdenes</td>
                    <td className="p-4 text-gray-600">Total de comandas válidas procesadas en el mes</td>
                    <td className="p-4 text-right font-mono font-black text-base text-gray-900">
                      {monthlyCloseStats.numOrdenes}
                    </td>
                    <td className="p-4 text-right">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gray-100 text-gray-700 font-bold text-[11px] group-hover:bg-[#4A5D23] group-hover:text-white transition-colors">
                        Inspeccionar <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </td>
                  </tr>

                  <tr
                    onClick={() => setCierreDrilldown('ticket')}
                    className="hover:bg-[#EAF5F0]/60 transition-colors cursor-pointer group"
                  >
                    <td className="p-4 font-black text-gray-900">Ticket Promedio</td>
                    <td className="p-4 text-gray-600">Ventas Totales / N° Órdenes</td>
                    <td className="p-4 text-right font-mono font-black text-base text-[#D97706]">
                      ${monthlyCloseStats.ticketPromedio.toFixed(2)}
                    </td>
                    <td className="p-4 text-right">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-50 text-amber-800 font-bold text-[11px] group-hover:bg-[#4A5D23] group-hover:text-white transition-colors">
                        Desglose <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </td>
                  </tr>

                  <tr
                    onClick={() => setCierreDrilldown('rentabilidad')}
                    className="hover:bg-[#EAF5F0]/60 transition-colors cursor-pointer group"
                  >
                    <td className="p-4 font-black text-gray-900">Rentabilidad</td>
                    <td className="p-4 text-gray-600">
                      Ventas (${monthlyCloseStats.ventasTotales.toFixed(2)}) - Costo Recetas (${monthlyCloseStats.costoRecetasMes.toFixed(2)}) - CFT (${costoFijoTotal.toFixed(2)})
                    </td>
                    <td
                      className={`p-4 text-right font-mono font-black text-base ${
                        monthlyCloseStats.rentabilidadNeta >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      ${monthlyCloseStats.rentabilidadNeta.toFixed(2)} ({monthlyCloseStats.rentabilidadPct.toFixed(1)}%)
                    </td>
                    <td className="p-4 text-right">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gray-100 text-gray-700 font-bold text-[11px] group-hover:bg-[#4A5D23] group-hover:text-white transition-colors">
                        Auditar <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </td>
                  </tr>

                  <tr
                    onClick={() => setCierreDrilldown('equilibrio')}
                    className="hover:bg-[#EAF5F0]/60 transition-colors cursor-pointer group"
                  >
                    <td className="p-4 font-black text-gray-900">Punto de Equilibrio</td>
                    <td className="p-4 text-gray-600">
                      Meta mensual: ${puntoEquilibrioMensual.toFixed(2)} ({monthlyCloseStats.coberturaMensualPct.toFixed(1)}% cubierto)
                    </td>
                    <td className="p-4 text-right">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
                          monthlyCloseStats.puntoEquilibrioCumplido
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-rose-100 text-rose-800 border border-rose-300'
                        }`}
                      >
                        {monthlyCloseStats.puntoEquilibrioCumplido ? 'Cumplido' : 'No'}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gray-100 text-gray-700 font-bold text-[11px] group-hover:bg-[#4A5D23] group-hover:text-white transition-colors">
                        Revisar <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Drill-Down Audit Modal for Cierre de Mes */}
          {cierreDrilldown && (
            <div
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
              onClick={() => setCierreDrilldown(null)}
            >
              <div
                className="w-full max-w-4xl max-h-[85vh] bg-white border border-gray-200 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-5 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-base font-black text-gray-900">
                      {cierreDrilldown === 'ventas' && `Cierres de Caja del Mes (${closingMonth})`}
                      {cierreDrilldown === 'ordenes' && `Órdenes Procesadas (${closingMonth})`}
                      {cierreDrilldown === 'ticket' && `Análisis de Ticket Promedio (${closingMonth})`}
                      {cierreDrilldown === 'rentabilidad' && `Auditoría de Rentabilidad Mensual (${closingMonth})`}
                      {cierreDrilldown === 'equilibrio' && `Auditoría de Punto de Equilibrio (${closingMonth})`}
                    </h4>
                    <p className="text-xs text-gray-500">Sucursal: {activeBranch}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCierreDrilldown(null)}
                    className="p-2 rounded-xl bg-white hover:bg-gray-100 border border-gray-200 text-gray-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-auto p-5 space-y-4 text-xs">
                  {cierreDrilldown === 'ventas' && (
                    monthlyCloseStats.monthShifts.length === 0 ? (
                      <div className="p-10 text-center rounded-2xl border border-dashed border-gray-300 text-gray-500">
                        No hay cierres de caja registrados para {closingMonth}. Ventas registradas en órdenes: ${monthlyCloseStats.ventasTotales.toFixed(2)}.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-gray-200 rounded-2xl">
                        <table className="w-full text-left">
                          <thead className="bg-gray-50 text-gray-600 uppercase text-[11px] font-bold border-b border-gray-200">
                            <tr>
                              <th className="p-3">Caja / Turno</th>
                              <th className="p-3">Cierre / Apertura</th>
                              <th className="p-3">Responsable</th>
                              <th className="p-3">Estado</th>
                              <th className="p-3 text-right">Efectivo</th>
                              <th className="p-3 text-right">Tarjeta/Transf/DeUna</th>
                              <th className="p-3 text-right">Total Ventas</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {monthlyCloseStats.monthShifts.map((s) => {
                              const digitalSales =
                                (s.cardSales || 0) + (s.transferSales || 0) + (s.deUnaSales || 0);
                              return (
                                <tr key={s.id} className="hover:bg-gray-50">
                                  <td className="p-3 font-bold text-gray-900">
                                    {s.registerName || 'Caja'} #{s.shiftNumber || '—'}
                                  </td>
                                  <td className="p-3 font-mono text-gray-600">
                                    {new Date(s.closedAt || s.openedAt).toLocaleString('es-EC')}
                                  </td>
                                  <td className="p-3 text-gray-700">{s.closedBy || s.openedBy || s.cashierName || '—'}</td>
                                  <td className="p-3">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                        s.status === 'closed'
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : 'bg-amber-100 text-amber-800'
                                      }`}
                                    >
                                      {s.status === 'closed' ? 'Cerrado' : 'Abierto'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-right font-mono">${(s.cashSales || 0).toFixed(2)}</td>
                                  <td className="p-3 text-right font-mono">${digitalSales.toFixed(2)}</td>
                                  <td className="p-3 text-right font-mono font-black text-[#4A5D23]">
                                    ${(s.totalSales || 0).toFixed(2)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  )}

                  {(cierreDrilldown === 'ordenes' || cierreDrilldown === 'ticket') && (
                    monthlyCloseStats.monthOrders.length === 0 ? (
                      <div className="p-10 text-center rounded-2xl border border-dashed border-gray-300 text-gray-500">
                        No hay órdenes registradas en {closingMonth}.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-gray-200 rounded-2xl">
                        <table className="w-full text-left">
                          <thead className="bg-gray-50 text-gray-600 uppercase text-[11px] font-bold border-b border-gray-200">
                            <tr>
                              <th className="p-3">Fecha / Hora</th>
                              <th className="p-3">Mesa / Tipo</th>
                              <th className="p-3">Atendido por</th>
                              <th className="p-3">Método</th>
                              <th className="p-3 text-right">Platos</th>
                              <th className="p-3 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {monthlyCloseStats.monthOrders.map((o) => (
                              <tr key={o.id} className="hover:bg-gray-50">
                                <td className="p-3 font-mono text-gray-600">
                                  {new Date((o as any).paidAt || o.createdAt).toLocaleString('es-EC')}
                                </td>
                                <td className="p-3 font-bold text-gray-900">
                                  {o.tableNumber === 0 ? 'DOMICILIO' : `Mesa ${o.tableNumber}`}
                                </td>
                                <td className="p-3 text-gray-700">{o.waiterName || (o as any).collectedBy || '—'}</td>
                                <td className="p-3 text-gray-700">{(o as any).paymentMethod || o.status}</td>
                                <td className="p-3 text-right font-mono">
                                  {(o.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0)}
                                </td>
                                <td className="p-3 text-right font-mono font-black text-[#4A5D23]">
                                  ${(Number(o.total) || 0).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  )}

                  {cierreDrilldown === 'rentabilidad' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Ventas Totales del Mes:</span>
                          <span className="font-mono font-black">${monthlyCloseStats.ventasTotales.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">(-) Costo Estimado de Recetas:</span>
                          <span className="font-mono font-bold text-rose-600">
                            -${monthlyCloseStats.costoRecetasMes.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-gray-200 pt-2">
                          <span className="font-bold">Margen Bruto Contribuyente:</span>
                          <span className="font-mono font-black text-[#4A5D23]">
                            ${monthlyCloseStats.margenBrutoMes.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2">
                        <div className="flex justify-between">
                          <span className="text-gray-600">(-) Gastos Fijos + Variables:</span>
                          <span className="font-mono font-bold text-rose-600">
                            -${(totalFixed + totalVariable).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">(-) Nómina Total:</span>
                          <span className="font-mono font-bold text-rose-600">
                            -${payrollTotals.net.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-gray-200 pt-2">
                          <span className="font-black">Utilidad / Rentabilidad Neta:</span>
                          <span
                            className={`font-mono font-black ${
                              monthlyCloseStats.rentabilidadNeta >= 0 ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            ${monthlyCloseStats.rentabilidadNeta.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {cierreDrilldown === 'equilibrio' && (
                    <div className="p-5 rounded-2xl bg-gray-50 border border-gray-200 space-y-3">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Costo Fijo Total (CFT = Fijos + Variables + Nómina):</span>
                        <span className="font-mono font-black">${costoFijoTotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">(+) Ganancia Deseada configurada:</span>
                        <span className="font-mono font-bold">${gananciaDeseada.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Punto de Equilibrio Mensual (al {margenPromedioPct}% margen):</span>
                        <span className="font-mono font-black text-[#4A5D23]">${puntoEquilibrioMensual.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Ventas Reales del Mes ({closingMonth}):</span>
                        <span className="font-mono font-black text-[#D97706]">${monthlyCloseStats.ventasTotales.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-200 pt-3">
                        <span className="font-black">Estado de Cumplimiento:</span>
                        <span
                          className={`font-black ${
                            monthlyCloseStats.puntoEquilibrioCumplido ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {monthlyCloseStats.puntoEquilibrioCumplido
                            ? `CUMPLIDO (+$${(monthlyCloseStats.ventasTotales - puntoEquilibrioMensual).toFixed(2)})`
                            : `NO CUMPLIDO (Faltan $${Math.max(0, puntoEquilibrioMensual - monthlyCloseStats.ventasTotales).toFixed(2)})`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 4: CONFIGURACIÓN (MOVIDA AQUÍ INTACTA) ==================== */}
      {activeTab === 'configuracion' && <ConfiguracionModule unlockedByParent={isUnlocked} />}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-black text-gray-900">Confirmar Eliminación</h4>
                <p className="text-xs text-gray-500">Esta acción no se puede deshacer.</p>
              </div>
            </div>
            <p className="text-xs text-gray-700">
              ¿Deseas eliminar <strong className="text-gray-900">{confirmDelete.label}</strong>?
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteDelete}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                Sí, Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Vista Previa del Informe Ejecutivo */}
      {reportPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="w-full max-w-6xl max-h-[90vh] bg-white border border-gray-200 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-gray-200 bg-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-white border border-gray-200 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                  <img
                    src={storeSettings.logoUrl || '/assets/gastrolab_fhd.jpg'}
                    alt={storeSettings.localName || 'Logo del Local'}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base sm:text-lg font-black text-gray-900 truncate">
                      {previewReportTitle || 'Vista Previa del Informe'}
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30">
                      Vista Previa en Pantalla
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {reportPreview.sheets[activePreviewSheetIdx]?.subtitle || reportPreview.filename}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setReportPreview(null)}
                className="p-2 rounded-xl bg-white hover:bg-gray-100 border border-gray-200 text-gray-600 self-end sm:self-center cursor-pointer"
                title="Cerrar vista previa"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Multi-sheet switcher */}
            {reportPreview.sheets.length > 1 && (
              <div className="px-4 sm:px-5 py-2.5 bg-white border-b border-gray-100 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mr-1">
                  Hojas del informe:
                </span>
                {reportPreview.sheets.map((s, idx) => (
                  <button
                    key={s.sheetName}
                    type="button"
                    onClick={() => setActivePreviewSheetIdx(idx)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      activePreviewSheetIdx === idx
                        ? 'bg-[#4A5D23] text-white shadow-xs'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {s.sheetName} ({s.rows.length})
                  </button>
                ))}
              </div>
            )}

            {/* Table Body */}
            <div className="flex-1 overflow-auto p-4 sm:p-5 bg-white">
              {(() => {
                const activeSheet = reportPreview.sheets[activePreviewSheetIdx];
                if (!activeSheet) return null;
                if (activeSheet.rows.length === 0) {
                  return (
                    <div className="p-12 text-center rounded-2xl border border-dashed border-gray-300 text-gray-500 text-xs">
                      No hay registros encontrados para el rango de fechas o filtros seleccionados.
                    </div>
                  );
                }
                return (
                  <div className="overflow-x-auto border border-gray-200 rounded-2xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#4A5D23] text-white uppercase tracking-wider font-bold text-[11px] sticky top-0">
                        <tr>
                          {activeSheet.columns.map((col) => (
                            <th
                              key={col.key}
                              className={`p-3 whitespace-nowrap ${
                                col.align === 'right'
                                  ? 'text-right'
                                  : col.align === 'center'
                                  ? 'text-center'
                                  : 'text-left'
                              }`}
                            >
                              {col.header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {activeSheet.rows.map((row, rIdx) => {
                          const hl = activeSheet.highlightRowFn ? activeSheet.highlightRowFn(row) : null;
                          const rowBg =
                            hl === 'danger'
                              ? 'bg-rose-50 text-rose-900'
                              : hl === 'warn'
                              ? 'bg-amber-50 text-amber-950'
                              : hl === 'ok'
                              ? 'bg-[#EAF5F0] text-[#1F2937]'
                              : rIdx % 2 === 1
                              ? 'bg-gray-50/70'
                              : 'bg-white';
                          return (
                            <tr key={rIdx} className={`${rowBg} hover:bg-[#EAF5F0]/50 transition-colors`}>
                              {activeSheet.columns.map((col) => (
                                <td
                                  key={col.key}
                                  className={`p-3 whitespace-nowrap ${
                                    col.align === 'right'
                                      ? 'text-right font-mono font-semibold'
                                      : col.align === 'center'
                                      ? 'text-center'
                                      : 'text-left'
                                  }`}
                                >
                                  {formatPreviewCellValue(row[col.key], col.numFmt)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                      {activeSheet.totalsRow && (
                        <tfoot className="bg-[#EAF5F0] border-t-2 border-[#4A5D23]/40 font-black text-gray-900">
                          <tr>
                            {activeSheet.columns.map((col) => (
                              <td
                                key={col.key}
                                className={`p-3 whitespace-nowrap ${
                                  col.align === 'right'
                                    ? 'text-right font-mono'
                                    : col.align === 'center'
                                    ? 'text-center'
                                    : 'text-left'
                                }`}
                              >
                                {activeSheet.totalsRow?.[col.key] !== undefined &&
                                activeSheet.totalsRow?.[col.key] !== ''
                                  ? formatPreviewCellValue(activeSheet.totalsRow[col.key], col.numFmt)
                                  : ''}
                              </td>
                            ))}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="p-4 sm:p-5 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-gray-500 font-mono truncate">
                Archivo: {reportPreview.filename}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setReportPreview(null)}
                  className="px-4 py-2 rounded-xl bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 text-xs font-bold cursor-pointer"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  disabled={generatingReportId !== null}
                  onClick={async () => {
                    const targetId = reportPreview.reportId;
                    setGeneratingReportId(targetId);
                    try {
                      const file = await generateExecutiveExcelReport(
                        targetId,
                        { ...storeSettings, branch: activeBranch },
                        {
                          startDate: reportStartDate || undefined,
                          endDate: reportEndDate || undefined,
                        }
                      );
                      showToast('success', `Informe "${previewReportTitle}" descargado: ${file}`);
                    } catch (err: any) {
                      console.error('Error al descargar informe Excel:', err);
                      showToast(
                        'error',
                        `No se pudo descargar "${previewReportTitle}": ${err?.message || 'Error inesperado'}`
                      );
                    } finally {
                      setGeneratingReportId(null);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#E89E2D]" />
                  {generatingReportId === reportPreview.reportId
                    ? 'Descargando...'
                    : 'Descargar en Excel (.xlsx)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Printable Rol de Pagos (.sheet-print-area) with Local Logo */}
      {isPrintingPayroll && (
        <div className="hidden print:block sheet-print-area bg-white text-black p-6 space-y-4 text-xs">
          <div className="border-b-2 border-black pb-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img
                src={storeSettings.logoUrl || '/assets/gastrolab_fhd.jpg'}
                alt={storeSettings.localName || 'Logo del Local'}
                className="w-16 h-16 object-contain border border-gray-300 rounded-lg p-1"
              />
              <div>
                <h1 className="text-lg font-black uppercase">
                  {storeSettings.localName || ''} ({activeBranch}) — ROL DE PAGOS GENERAL
                </h1>
                {storeSettings.ruc && <p className="font-mono">RUC: {storeSettings.ruc}</p>}
                {storeSettings.address && <p>{storeSettings.address}</p>}
              </div>
            </div>
            <div className="text-right font-mono">
              <div className="font-bold">GASTROLAB by Iván Muñoz</div>
              <div>Sucursal: {activeBranch}</div>
              <div>Fecha: {new Date().toLocaleDateString('es-EC')}</div>
              <div>Colaboradores: {employees.length}</div>
            </div>
          </div>

          <table className="w-full border-collapse border border-black text-[11px]">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black p-2 text-left">Colaborador</th>
                <th className="border border-black p-2 text-left">Cargo / Puesto</th>
                <th className="border border-black p-2 text-right">Sueldo Nominal</th>
                <th className="border border-black p-2 text-right">Horas Extras</th>
                <th className="border border-black p-2 text-center">IESS</th>
                <th className="border border-black p-2 text-right">Aporte IESS (9.45%)</th>
                <th className="border border-black p-2 text-right">Descuentos</th>
                <th className="border border-black p-2 text-left">Motivo</th>
                <th className="border border-black p-2 text-right">Líquido a Recibir</th>
                <th className="border border-black p-2 text-center">Firma</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td className="border border-black p-2 font-bold">{emp.collaborator}</td>
                  <td className="border border-black p-2">{emp.position}</td>
                  <td className="border border-black p-2 text-right font-mono">
                    ${(emp.nominalSalary || 0).toFixed(2)}
                  </td>
                  <td className="border border-black p-2 text-right font-mono">
                    {emp.overtimePay && emp.overtimePay > 0
                      ? `+$${(emp.overtimePay || 0).toFixed(2)} (${emp.overtimeHours}h ${emp.overtimeSurchargePct || 50}%)`
                      : '—'}
                  </td>
                  <td className="border border-black p-2 text-center font-bold">{emp.hasIess}</td>
                  <td className="border border-black p-2 text-right font-mono">
                    -${(emp.iessContribution || 0).toFixed(2)}
                  </td>
                  <td className="border border-black p-2 text-right font-mono">
                    -${(emp.discountAmount || 0).toFixed(2)}
                  </td>
                  <td className="border border-black p-2">{emp.discountReason || '-'}</td>
                  <td className="border border-black p-2 text-right font-mono font-black">
                    ${(emp.netPay || 0).toFixed(2)}
                  </td>
                  <td className="border border-black p-2 w-24"></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-black">
                <td colSpan={2} className="border border-black p-2 uppercase">
                  Totales Generales
                </td>
                <td className="border border-black p-2 text-right font-mono">
                  ${payrollTotals.nominal.toFixed(2)}
                </td>
                <td className="border border-black p-2 text-right font-mono">
                  +${payrollTotals.overtime.toFixed(2)}
                </td>
                <td className="border border-black p-2"></td>
                <td className="border border-black p-2 text-right font-mono">
                  -${payrollTotals.iess.toFixed(2)}
                </td>
                <td className="border border-black p-2 text-right font-mono">
                  -${payrollTotals.discounts.toFixed(2)}
                </td>
                <td className="border border-black p-2"></td>
                <td className="border border-black p-2 text-right font-mono">
                  ${payrollTotals.net.toFixed(2)}
                </td>
                <td className="border border-black p-2"></td>
              </tr>
            </tfoot>
          </table>

          <div className="pt-8 grid grid-cols-2 gap-12 text-center">
            <div className="border-t border-black pt-1.5">Elaborado / Autorizado por Propietario</div>
            <div className="border-t border-black pt-1.5">Fecha de Emisión: {new Date().toLocaleString('es-EC')}</div>
          </div>
        </div>
      )}
    </div>
  );
};
