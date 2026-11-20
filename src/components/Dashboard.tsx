import { UpdateButton } from './UpdateButton';
import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useAuth, deduplicateUserProfiles } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { isValidCreatorCode } from '../utils/cryptoAuth';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  LogOut,
  KeyRound,
  Clock,
  Users,
  ChefHat,
  UtensilsCrossed,
  LayoutGrid,
  Receipt,
  Building2,
  Scale,
  DollarSign,
  BarChart3,
  HelpCircle,
  Info,
  Layers,
  Utensils,
  UserCheck,
  FileText,
  Menu,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ClipboardList,
  BookOpen,
  Package,
  ArrowLeftRight,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
  Lock,
  WifiOff,
  MessageCircle,
  Eye,
  EyeOff,
  CheckCircle2,
} from 'lucide-react';
import { ClientOverride, UserProfile } from '../types';
import { translateRoleToSpanish } from '../utils/roleLabels';
import { UserAccessModal } from './UserAccessModal';
import { CreatorMasterModal } from './CreatorMasterModal';
import { SupportModal } from './SupportModal';
import { AboutUsModal } from './AboutUsModal';
import {
  openCustomerDisplayWindow,
  tryAutoOpenCustomerDisplayIfExtended,
} from '../utils/customerDisplayChannel';
import { MesasModule } from './MesasModule';
import { CocinaModule } from './CocinaModule';
import { CartaModule } from './CartaModule';
import { CajaModule } from './CajaModule';
import { ReservasModule } from './ReservasModule';
import { ResumenDiarioModule } from './ResumenDiarioModule';

// Lazy-loaded heavy modules for instant navigation & PWA performance (Point 15)
const InventarioModule = lazy(() => import('./InventarioModule').then((m) => ({ default: m.InventarioModule })));
const ReportesModule = lazy(() => import('./ReportesModule').then((m) => ({ default: m.ReportesModule })));
const RecetasModule = lazy(() => import('./RecetasModule').then((m) => ({ default: m.RecetasModule })));
const KardexModule = lazy(() => import('./KardexModule').then((m) => ({ default: m.KardexModule })));
const ProveedoresModule = lazy(() => import('./ProveedoresModule').then((m) => ({ default: m.ProveedoresModule })));
const PurchasesModule = lazy(() => import('./PurchasesModule').then((m) => ({ default: m.PurchasesModule })));
const ControlMermasModule = lazy(() => import('./ControlMermasModule').then((m) => ({ default: m.ControlMermasModule })));
const MenajeModule = lazy(() => import('./MenajeModule').then((m) => ({ default: m.MenajeModule })));
const ClientesModule = lazy(() => import('./ClientesModule').then((m) => ({ default: m.ClientesModule })));
const FacturacionModule = lazy(() => import('./FacturacionModule').then((m) => ({ default: m.FacturacionModule })));
const UsuariosPermisosModule = lazy(() => import('./UsuariosPermisosModule').then((m) => ({ default: m.UsuariosPermisosModule })));
const ControlInventarioModule = lazy(() => import('./ControlInventarioModule').then((m) => ({ default: m.ControlInventarioModule })));
const ControlEjecutivoModule = lazy(() => import('./ControlEjecutivoModule').then((m) => ({ default: m.ControlEjecutivoModule })));
const WhatsAppModule = lazy(() => import('./WhatsAppModule').then((m) => ({ default: m.WhatsAppModule })));

export type AppTab =
  | 'whatsapp'
  | 'resumen'
  | 'mesas'
  | 'reservas'
  | 'cocina'
  | 'carta'
  | 'inventario'
  | 'kardex'
  | 'recetas'
  | 'mermas'
  | 'menaje'
  | 'caja'
  | 'proveedores'
  | 'compras'
  | 'reportes'
  | 'configuracion'
  | 'usuarios'
  | 'clientes'
  | 'facturacion'
  | 'control_inventario'
  | 'control_ejecutivo'
  | 'sistema';

export const Dashboard: React.FC = () => {
  // Flag para reactivar el módulo WhatsApp en el menú lateral sin perder ninguna lógica interna
  const showWhatsApp = false;

  const {
    userProfile,
    ownerProfile,
    currentUser,
    isExpiringSoon,
    daysRemaining,
    switchActiveUserWithPassword,
    logoutAndSync,
  } = useAuth();
  const { activeBranch: selectedLocal, setActiveBranch, availableBranches } = useBranch();

  // Active module tab (default landing module: Resumen Diario)
  const [activeTab, setActiveTab] = useState<AppTab>('resumen');
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Sidebar collapsible state (responsive)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Modals & GASTROLAB Logo Dropdown state
  const [isUserAccessOpen, setIsUserAccessOpen] = useState(false);
  const [isCreatorMasterOpen, setIsCreatorMasterOpen] = useState(false);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [isAboutUsModalOpen, setIsAboutUsModalOpen] = useState(false);
  const [isGastrolabMenuOpen, setIsGastrolabMenuOpen] = useState(false);
  const gastrolabMenuRef = useRef<HTMLDivElement | null>(null);

  // In-place User Switcher Modal state (Sidebar "Cambiar") & Synced Logout state
  const [isSwitchUserModalOpen, setIsSwitchUserModalOpen] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState<UserProfile[]>([]);
  const [selectedSwitchUser, setSelectedSwitchUser] = useState<UserProfile | null>(null);
  const [switchPasswordInput, setSwitchPasswordInput] = useState('');
  const [showSwitchPassword, setShowSwitchPassword] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [isSwitchingUser, setIsSwitchingUser] = useState(false);
  const [isLoggingOutSync, setIsLoggingOutSync] = useState(false);

  // Settings listener for custom logo, slogan, and up to 2 branches
  const [systemSettings, setSystemSettings] = useState<{
    slogan?: string;
    logoUrl?: string;
    localName?: string;
    ivaPercentage?: number;
    branches?: string[];
  } | null>(null);
  const [clientOverride, setClientOverride] = useState<ClientOverride | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'general'),
      (snap) => {
        if (snap.exists()) {
          setSystemSettings(snap.data() as any);
        }
      },
      (err) => console.warn('Dashboard settings listener notice:', err)
    );
    return () => unsub();
  }, []);

  // Isolated per-client override listener keyed strictly by active local/store
  useEffect(() => {
    const storeDocId = selectedLocal.toLowerCase().includes('sucursal') ? 'store_2' : 'store_1';
    const unsubOv = onSnapshot(
      doc(db, 'client_overrides', storeDocId),
      (snap) => {
        if (snap.exists()) {
          setClientOverride({ id: snap.id, ...(snap.data() as Omit<ClientOverride, 'id'>) });
        } else {
          setClientOverride(null);
        }
      },
      () => setClientOverride(null)
    );
    return () => unsubOv();
  }, [selectedLocal]);

  // Real-time list of all created users for the Sidebar Switch User modal
  useEffect(() => {
    const unsubUsers = onSnapshot(
      query(collection(db, 'users')),
      (snap) => {
        const raw: UserProfile[] = [];
        snap.forEach((d) => raw.push({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }));
        const { uniqueProfiles } = deduplicateUserProfiles(raw, currentUser?.uid);
        uniqueProfiles.sort((a, b) => {
          if (a.role === 'Owner') return -1;
          if (b.role === 'Owner') return 1;
          return (a.name || '').localeCompare(b.name || '');
        });
        setDirectoryUsers(uniqueProfiles);
      },
      () => {
        try {
          const cached = localStorage.getItem('gastrolab_cached_users');
          if (cached) {
            setDirectoryUsers(deduplicateUserProfiles(JSON.parse(cached)).uniqueProfiles);
          }
        } catch {
          // Ignore fallback error
        }
      }
    );
    return () => unsubUsers();
  }, [currentUser?.uid]);

  // Invisible Creator / Soporte access strictly via special URL parameter
  useEffect(() => {
    const checkUrlCode = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const candidate =
          params.get('acceso') ||
          params.get('soporte') ||
          params.get('creator') ||
          hashParams.get('acceso') ||
          hashParams.get('soporte') ||
          '';
        if (candidate && (await isValidCreatorCode(candidate))) {
          setIsCreatorMasterOpen(true);
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch {
        // Ignore URL error
      }
    };
    checkUrlCode();
  }, []);

  // Dual Display: Auto-open secondary customer display if extended screen detected + Ctrl+Shift+D hidden shortcut
  useEffect(() => {
    tryAutoOpenCustomerDisplayIfExtended();
    const handleDualDisplayShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        openCustomerDisplayWindow();
      }
    };
    window.addEventListener('keydown', handleDualDisplayShortcut);
    return () => window.removeEventListener('keydown', handleDualDisplayShortcut);
  }, []);

  // Close GASTROLAB dropdown menu on outside click or Escape
  useEffect(() => {
    if (!isGastrolabMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-gastrolab-brand-menu="true"]')) return;
      setIsGastrolabMenuOpen(false);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsGastrolabMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isGastrolabMenuOpen]);

  const handleBranchChange = (branch: string) => {
    setActiveBranch(branch);
  };

  const role = userProfile?.role || 'Owner';
  const userName = userProfile?.name
    ? `${userProfile.name} ${userProfile.lastName || ''}`.trim()
    : 'Propietario';
  const fixedOwnerName = ownerProfile
    ? `${ownerProfile.name || ''} ${ownerProfile.lastName || ''}`.trim() || 'Propietario'
    : role === 'Owner'
    ? userName
    : 'Propietario';

  const TAB_TO_AREA_ALIASES: Record<AppTab, string[]> = {
    whatsapp: ['WhatsApp', 'Mesas y Pedidos', 'Resumen Diario'],
    resumen: ['Resumen Diario'],
    mesas: ['Mesas y Pedidos', 'Mesas y pedidos'],
    reservas: ['Reservas'],
    cocina: ['Cocina'],
    carta: ['Productos de venta', 'Carta'],
    inventario: ['Inventario de ingredientes e insumos', 'Inventario'],
    kardex: ['Kardex - Entradas y Salidas'],
    recetas: ['Recetas y Subrecetas', 'Recetas y subrecetas'],
    mermas: ['Control de Mermas', 'Mermas', 'Control de mermas'],
    menaje: ['Menaje y Equipos', 'Inventario de menaje y equipos', 'Menaje y equipos'],
    caja: ['Cajas y Turnos', 'Caja y turnos'],
    proveedores: ['Proveedores'],
    compras: ['Facturas de Compras', 'Facturas de compras'],
    reportes: ['Dashboard'],
    configuracion: ['Configuración'],
    usuarios: ['Usuarios y Permisos', 'Usuarios y permisos'],
    clientes: ['Clientes'],
    facturacion: ['Facturación'],
    control_inventario: ['Control de Inventario'],
    control_ejecutivo: ['Control Ejecutivo'],
    sistema: [],
  };

  const ROLE_FALLBACK_TABS: Record<string, AppTab[]> = {
    Owner: Object.keys(TAB_TO_AREA_ALIASES) as AppTab[],
    Admin: [
      'whatsapp',
      'resumen',
      'mesas',
      'reservas',
      'cocina',
      'carta',
      'recetas',
      'inventario',
      'menaje',
      'caja',
      'facturacion',
      'clientes',
      'proveedores',
      'compras',
      'kardex',
      'mermas',
      'control_inventario',
      'usuarios',
    ],
    Cashier: ['whatsapp', 'resumen', 'mesas', 'reservas', 'caja', 'clientes', 'facturacion'],
    'Kitchen Manager': [
      'cocina',
      'carta',
      'recetas',
      'inventario',
      'menaje',
      'compras',
      'proveedores',
      'kardex',
      'mermas',
      'control_inventario',
    ],
    'Kitchen Assistant': ['cocina', 'recetas', 'mermas'],
    'Service Staff': ['whatsapp', 'resumen', 'mesas', 'reservas', 'clientes'],
  };

  const canAccessTab = useCallback(
    (tabId: AppTab): boolean => {
      if (tabId === 'control_ejecutivo') return true;
      if (role === 'Owner') return true;
      if (tabId === 'configuracion') return false;

      if (Array.isArray(userProfile?.authorizedAreas)) {
        const aliases = TAB_TO_AREA_ALIASES[tabId] || [];
        return aliases.some((alias) => userProfile.authorizedAreas!.includes(alias));
      }

      const fallback = ROLE_FALLBACK_TABS[role] || ['resumen'];
      return fallback.includes(tabId);
    },
    [role, userProfile?.authorizedAreas]
  );

  const navSections = useMemo<
    Array<{
      title: string;
      items: Array<{
        id: AppTab;
        label: string;
        icon: React.ComponentType<{ className?: string }>;
        ownerOnly?: boolean;
        isProtected?: boolean;
      }>;
    }>
  >(
    () => [
      {
        title: 'SERVICIO',
        items: [
          { id: 'resumen' as AppTab, label: 'Resumen Diario', icon: BarChart3 },
          { id: 'mesas' as AppTab, label: 'Mesas y Pedidos', icon: LayoutGrid },
          { id: 'reservas' as AppTab, label: 'Reservas', icon: Clock },
          { id: 'cocina' as AppTab, label: 'Cocina', icon: ChefHat },
        ],
      },
      {
        title: 'GESTIÓN',
        items: [
          { id: 'carta' as AppTab, label: 'Carta', icon: UtensilsCrossed },
          { id: 'recetas' as AppTab, label: 'Recetas y Subrecetas', icon: BookOpen },
          { id: 'inventario' as AppTab, label: 'Inventario', icon: Package },
          { id: 'menaje' as AppTab, label: 'Menaje y Equipos', icon: Utensils },
        ],
      },
      {
        title: 'ADMINISTRACIÓN',
        items: [
          { id: 'caja' as AppTab, label: 'Cajas y Turnos', icon: DollarSign },
          { id: 'facturacion' as AppTab, label: 'Facturación', icon: FileText },
          { id: 'clientes' as AppTab, label: 'Clientes', icon: UserCheck },
          { id: 'proveedores' as AppTab, label: 'Proveedores', icon: Building2 },
          { id: 'compras' as AppTab, label: 'Facturas de Compras', icon: Receipt },
          { id: 'kardex' as AppTab, label: 'Kardex - Entradas y Salidas', icon: Layers },
          { id: 'reportes' as AppTab, label: 'Dashboard', icon: BarChart3, ownerOnly: true },
        ],
      },
      {
        title: 'GERENCIA Y OPERACIONES',
        items: [
          { id: 'mermas' as AppTab, label: 'Control de Mermas', icon: Scale },
          { id: 'control_inventario' as AppTab, label: 'Control de Inventario', icon: ClipboardList },
          { id: 'usuarios' as AppTab, label: 'Usuarios y Permisos', icon: Users },
        ],
      },
      {
        title: 'CONTROL EJECUTIVO',
        items: [
          { id: 'control_ejecutivo' as AppTab, label: 'Control Ejecutivo', icon: ShieldCheck, isProtected: true },
        ],
      },
    ],
    []
  );

  // Auto-redirect activeTab to first permitted tab if user lacks access to current activeTab
  useEffect(() => {
    if (!userProfile) return;
    if (!canAccessTab(activeTab)) {
      const allTabs = navSections.flatMap((s) => s.items.map((i) => i.id));
      const firstPermitted = allTabs.find((id) => canAccessTab(id));
      if (firstPermitted && firstPermitted !== activeTab) {
        setActiveTab(firstPermitted);
      }
    }
  }, [userProfile, activeTab, canAccessTab, navSections]);

  const handleTabSelect = useCallback(
    (tab: AppTab) => {
      if (!canAccessTab(tab)) return;
      setActiveTab(tab);
      setIsMobileSidebarOpen(false);
    },
    [canAccessTab]
  );

  const handleOpenSwitchUserModal = () => {
    setSelectedSwitchUser(null);
    setSwitchPasswordInput('');
    setShowSwitchPassword(false);
    setSwitchError(null);
    setIsSwitchUserModalOpen(true);
  };

  const handleConfirmSwitchUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSwitchUser || isSwitchingUser) return;
    setSwitchError(null);
    setIsSwitchingUser(true);
    try {
      await switchActiveUserWithPassword(selectedSwitchUser, switchPasswordInput);
      setIsSwitchUserModalOpen(false);
      setIsMobileSidebarOpen(false);
      setSelectedSwitchUser(null);
      setSwitchPasswordInput('');
    } catch (err: any) {
      setSwitchError(err?.message || 'Contraseña incorrecta.');
    } finally {
      setIsSwitchingUser(false);
    }
  };

  const handleFullLogoutAndSync = async () => {
    if (isLoggingOutSync) return;
    setIsLoggingOutSync(true);
    try {
      await logoutAndSync();
    } finally {
      setIsLoggingOutSync(false);
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-[#F6F8F5] text-[#1F2937] flex flex-col font-sans">
      {/* Mobile / Minimized Window Centered Clickable GASTROLAB Brand Strip */}
      <div
        data-gastrolab-brand-menu="true"
        className="md:hidden shrink-0 bg-[#4A5D23] border-b border-white/15 px-3 py-1.5 flex items-center justify-center relative z-40"
      >
        <button
          type="button"
          onClick={() => setIsGastrolabMenuOpen((prev) => !prev)}
          className="bg-white hover:bg-gray-50 rounded-xl px-2.5 py-1 shadow-xs flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95"
          title="Menú GASTROLAB (About Us y Soporte Técnico)"
        >
          <img
            src="/assets/gastrolab_fhd.jpg"
            alt="GASTROLAB by Iván Muñoz"
            className="w-6 h-6 object-contain rounded-md"
          />
          <span className="font-black text-xs tracking-tight text-[#2A3D12] leading-none">
            GASTRO<span className="text-[#6B8E23]">LAB</span>
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-[#4A5D23] transition-transform ${
              isGastrolabMenuOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {isGastrolabMenuOpen && (
          <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 w-52 bg-white border border-gray-200 rounded-2xl shadow-xl p-1.5 space-y-1 z-50 text-gray-800">
            <button
              type="button"
              onClick={() => {
                setIsGastrolabMenuOpen(false);
                setIsAboutUsModalOpen(true);
              }}
              className="w-full px-3 py-2 rounded-xl hover:bg-[#EAF5F0] text-left text-xs font-bold flex items-center gap-2 text-gray-800 hover:text-[#4A5D23] cursor-pointer"
            >
              <Info className="w-4 h-4 text-[#4A5D23] shrink-0" />
              <span>About Us</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsGastrolabMenuOpen(false);
                setIsSupportModalOpen(true);
              }}
              className="w-full px-3 py-2 rounded-xl hover:bg-amber-50 text-left text-xs font-bold flex items-center gap-2 text-gray-800 hover:text-amber-900 cursor-pointer"
            >
              <HelpCircle className="w-4 h-4 text-[#D97706] shrink-0" />
              <span>Soporte Técnico</span>
            </button>
          </div>
        )}
      </div>

      {/* Top Header Bar (Verde Oliva exacto #4A5D23, altura reducida) */}
      <header className="shrink-0 z-30 bg-[#4A5D23] text-white border-b border-white/15 px-2.5 sm:px-5 py-1.5 flex items-center justify-between gap-2 sm:gap-4 shadow-sm">
        {/* Left: Mobile hamburger + Desktop collapse toggle + Slim Brand & Branch */}
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
          {/* Mobile hamburger menu */}
          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
            className="md:hidden p-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/20 transition-colors cursor-pointer shrink-0"
            title="Abrir menú"
          >
            <Menu className="w-4 h-4 text-white" />
          </button>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="hidden md:flex p-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/20 transition-colors cursor-pointer shrink-0"
            title={isSidebarOpen ? 'Colapsar barra lateral' : 'Expandir barra lateral'}
          >
            {isSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          {/* Client Logo (Slimmed) + Top-Bar Multisucursal Selector (Matriz / Sucursal 1) */}
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-white border border-white/30 p-1 shadow-xs flex items-center justify-center shrink-0 overflow-hidden">
              <img
                src={systemSettings?.logoUrl || '/assets/gastrolab_fhd.jpg'}
                alt={systemSettings?.localName || ''}
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.target as any).src = '/assets/gastrolab_fhd.jpg';
                }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5 min-w-0">
                <span className="font-black text-sm sm:text-lg lg:text-xl tracking-tight text-white uppercase leading-none truncate">
                  {systemSettings?.localName || ''}
                </span>
                {/* Selector Multisucursal junto al logo */}
                <div className="relative shrink-0">
                  <select
                    aria-label="Seleccionar Sucursal"
                    value={selectedLocal}
                    onChange={(e) => handleBranchChange(e.target.value)}
                    className="pl-2 pr-5 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-black uppercase tracking-wider bg-white text-[#4A5D23] border border-white/40 appearance-none cursor-pointer focus:outline-none shadow-2xs"
                  >
                    {availableBranches.map((branchName) => (
                      <option key={branchName} value={branchName}>
                        {branchName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 text-[#4A5D23] absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
              <p className="text-[11px] sm:text-xs font-semibold text-lime-100/90 hidden sm:block leading-tight mt-0.5 truncate">
                {systemSettings?.slogan || 'Punto de Venta Gastronómico'}
              </p>
            </div>
          </div>
        </div>

        {/* Right Header: Online/Offline indicator + Horizontal User Profile Chip (sin botón rojo Cambiar Usuario) */}
        <div className="flex items-center gap-2 shrink-0">
          {isOnline ? (
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/20 text-white text-[11px] font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>En línea</span>
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-rose-600 border border-rose-400 text-white text-[10px] sm:text-[11px] font-bold"
              title="Sin internet: Mesas, pedidos y cobros siguen funcionando y se sincronizarán automáticamente al volver la señal."
            >
              <WifiOff className="w-3.5 h-3.5 text-white shrink-0" />
              <span className="hidden sm:inline">Sin internet · Modo Offline</span>
              <span className="sm:hidden">Offline</span>
            </div>
          )}

          {/* Horizontal User Profile Chip: Nombre - Cargo */}
          <div className="flex items-center gap-2 bg-white/15 border border-white/20 px-2.5 py-1 rounded-xl">
            <div className="w-6 h-6 rounded-lg bg-[#E89E2D] text-slate-950 flex items-center justify-center font-black text-xs shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-xs font-bold text-white leading-none">{userName}</span>
              <span className="text-lime-200 font-bold leading-none">-</span>
              <span className="text-xs font-semibold text-lime-200 leading-none">
                {translateRoleToSpanish(role)}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Body with Exact Matching #4A5D23 Olive Green Sidebar + Independent Scroll Content */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* MOBILE SIDEBAR BACKDROP */}
        {isMobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs md:hidden"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        )}

        {/* SIDEBAR — Exact #4A5D23 Olive Green matching Header */}
        <aside
          className={`fixed md:static inset-y-0 left-0 z-50 h-full overflow-hidden bg-[#4A5D23] text-white border-r border-white/15 flex flex-col justify-between transition-all duration-200 ease-in-out shadow-xl md:shadow-none ${
            isMobileSidebarOpen
              ? 'translate-x-0 w-[216px]'
              : '-translate-x-full md:translate-x-0'
          } ${isSidebarOpen ? 'md:w-[216px]' : 'md:w-20'}`}
        >
          {/* Sidebar Top: Clickable GASTROLAB Brand Header + Client Card + Local & User */}
          <div
            className={`${
              isSidebarOpen ? 'p-2.5' : 'px-2 py-3.5'
            } overflow-y-auto overflow-x-hidden flex-1 space-y-2.5`}
          >
            {/* 1. GASTROLAB Brand Block (Clickable -> About Us & Soporte Técnico dropdown) */}
            {isSidebarOpen ? (
              <div ref={gastrolabMenuRef} data-gastrolab-brand-menu="true" className="relative">
                <div className="bg-white rounded-2xl shadow-sm p-2 flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => setIsGastrolabMenuOpen((prev) => !prev)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer hover:opacity-90 transition-opacity"
                    title="Menú GASTROLAB: About Us y Soporte Técnico"
                  >
                    <div className="w-9 h-9 p-0.5 rounded-xl bg-[#F6F8F5] border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                      <img
                        src="/assets/gastrolab_fhd.jpg"
                        alt="GASTROLAB by Iván Muñoz"
                        className="h-full w-full object-contain rounded-lg"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <h1 className="font-black text-sm tracking-tight text-[#2A3D12] leading-tight">
                          GASTRO<span className="text-[#6B8E23]">LAB</span>
                        </h1>
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-[#4A5D23] shrink-0 transition-transform ${
                            isGastrolabMenuOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 font-bold select-none block truncate">
                        POS · v2.0
                      </span>
                    </div>
                  </button>

                  {/* Close button on mobile */}
                  <button
                    type="button"
                    onClick={() => setIsMobileSidebarOpen(false)}
                    className="md:hidden p-1 rounded-lg text-gray-400 hover:text-gray-700 shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {isGastrolabMenuOpen && (
                  <div className="mt-1.5 bg-white border border-gray-200 rounded-2xl shadow-lg p-1.5 space-y-1 text-gray-800">
                    <button
                      type="button"
                      onClick={() => {
                        setIsGastrolabMenuOpen(false);
                        setIsMobileSidebarOpen(false);
                        setIsAboutUsModalOpen(true);
                      }}
                      className="w-full px-2.5 py-2 rounded-xl hover:bg-[#EAF5F0] text-left text-xs font-bold flex items-center gap-2 text-gray-800 hover:text-[#4A5D23] cursor-pointer"
                    >
                      <Info className="w-4 h-4 text-[#4A5D23] shrink-0" />
                      <span>About Us</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsGastrolabMenuOpen(false);
                        setIsMobileSidebarOpen(false);
                        setIsSupportModalOpen(true);
                      }}
                      className="w-full px-2.5 py-2 rounded-xl hover:bg-amber-50 text-left text-xs font-bold flex items-center gap-2 text-gray-800 hover:text-amber-900 cursor-pointer"
                    >
                      <HelpCircle className="w-4 h-4 text-[#D97706] shrink-0" />
                      <span>Soporte Técnico</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div data-gastrolab-brand-menu="true" className="w-full flex items-center justify-center relative">
                <button
                  type="button"
                  onClick={() => setIsGastrolabMenuOpen((prev) => !prev)}
                  className="w-11 h-11 p-1 rounded-2xl bg-white shadow-sm flex items-center justify-center shrink-0 overflow-hidden cursor-pointer hover:ring-2 hover:ring-[#E89E2D] transition-all"
                  title="Menú GASTROLAB: About Us y Soporte Técnico"
                >
                  <img
                    src="/assets/gastrolab_fhd.jpg"
                    alt="GASTROLAB by Iván Muñoz"
                    className="w-full h-full object-contain rounded-xl"
                  />
                </button>
                {isGastrolabMenuOpen && (
                  <div className="fixed left-20 top-24 w-48 bg-white border border-gray-200 rounded-2xl shadow-2xl p-1.5 space-y-1 z-[95] text-gray-800">
                    <button
                      type="button"
                      onClick={() => {
                        setIsGastrolabMenuOpen(false);
                        setIsAboutUsModalOpen(true);
                      }}
                      className="w-full px-3 py-2 rounded-xl hover:bg-[#EAF5F0] text-left text-xs font-bold flex items-center gap-2 text-gray-800 hover:text-[#4A5D23] cursor-pointer"
                    >
                      <Info className="w-4 h-4 text-[#4A5D23] shrink-0" />
                      <span>About Us</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsGastrolabMenuOpen(false);
                        setIsSupportModalOpen(true);
                      }}
                      className="w-full px-3 py-2 rounded-xl hover:bg-amber-50 text-left text-xs font-bold flex items-center gap-2 text-gray-800 hover:text-amber-900 cursor-pointer"
                    >
                      <HelpCircle className="w-4 h-4 text-[#D97706] shrink-0" />
                      <span>Soporte Técnico</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 2. Client Card & Active Branch/User in Sidebar */}
            {isSidebarOpen && (
              <div className="p-3 rounded-2xl bg-white/10 border border-white/15 space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-white p-1 flex items-center justify-center shrink-0 shadow-xs">
                    <img
                      src={systemSettings?.logoUrl || '/assets/gastrolab_fhd.jpg'}
                      alt="Local"
                      className="max-h-full max-w-full object-contain"
                      onError={(e) => {
                        (e.target as any).src = '/assets/gastrolab_fhd.jpg';
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-extrabold text-xs text-white uppercase tracking-tight truncate">
                      {systemSettings?.localName || ''}
                    </h3>
                    <div className="relative mt-0.5">
                      <select
                        value={selectedLocal}
                        onChange={(e) => handleBranchChange(e.target.value)}
                        className="w-full bg-white/15 border border-white/20 rounded-lg pl-2 pr-6 py-0.5 text-[11px] font-bold text-white appearance-none focus:outline-none cursor-pointer"
                      >
                        {availableBranches.map((b) => (
                          <option key={b} value={b} className="text-gray-900">
                            {b}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3 h-3 text-white/80 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-white/15 flex items-center justify-between gap-2 text-[11px]">
                  <div className="min-w-0">
                    <div className="font-bold text-white truncate">{userName}</div>
                    <div className="text-[10px] text-lime-200 font-semibold truncate">
                      {translateRoleToSpanish(role)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenSwitchUserModal}
                    className="px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                    title="Cambiar de Usuario en Tiempo Real"
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                    Cambiar
                  </button>
                </div>
              </div>
            )}

            {/* Direct WhatsApp Module Button (Oculto con showWhatsApp = false en stand-by) */}
            {showWhatsApp && canAccessTab('whatsapp') && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => handleTabSelect('whatsapp')}
                  className={`w-full flex items-center rounded-xl text-[12px] font-bold transition-colors cursor-pointer border ${
                    isSidebarOpen ? 'gap-2.5 px-3 py-2.5' : 'justify-center px-0 py-2.5'
                  } ${
                    activeTab === 'whatsapp'
                      ? 'bg-[#25D366] text-slate-950 border-[#25D366] shadow-md'
                      : 'bg-white/10 hover:bg-white/15 text-white border-white/15'
                  }`}
                  title="WhatsApp"
                >
                  <MessageCircle
                    className={`w-4 h-4 shrink-0 ${
                      activeTab === 'whatsapp' ? 'text-slate-950' : 'text-[#25D366]'
                    }`}
                  />
                  {isSidebarOpen && (
                    <span className="truncate flex-1 text-left">WhatsApp</span>
                  )}
                  {isSidebarOpen && (
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        activeTab === 'whatsapp' ? 'bg-slate-950' : 'bg-[#25D366]'
                      }`}
                    />
                  )}
                </button>
              </div>
            )}

            {/* 3. Menu Sections (Strict RBAC filtered) */}
            <div className="pt-1 space-y-3.5">
              {navSections.map((section) => {
                const visibleItems = section.items.filter(
                  (item) => (!item.ownerOnly || role === 'Owner') && canAccessTab(item.id)
                );
                if (visibleItems.length === 0) return null;

                return (
                  <div key={section.title} className="space-y-1">
                    {/* Section Header */}
                    {isSidebarOpen ? (
                      <h4 className="text-[10px] font-black uppercase tracking-wider text-lime-200/70 px-3 py-0.5">
                        {section.title}
                      </h4>
                    ) : (
                      <div className="w-full border-t border-white/10 my-2" />
                    )}

                    {/* Section Menu Items */}
                    <div className="space-y-0.5">
                      {visibleItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;

                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleTabSelect(item.id)}
                            className={`w-full flex items-center rounded-xl text-[11.5px] font-semibold transition-colors cursor-pointer ${
                              isSidebarOpen ? 'gap-2 px-2 py-2' : 'justify-center px-0 py-2.5'
                            } ${
                              isActive
                                ? 'bg-[#6B8E23] text-white font-bold shadow-md'
                                : 'text-white/85 hover:text-white hover:bg-white/10'
                            }`}
                            title={item.label}
                          >
                            <Icon
                              className={`w-4 h-4 shrink-0 ${
                                isActive ? 'text-white' : 'text-lime-200/80'
                              }`}
                            />
                            {isSidebarOpen && (
                              <span className="truncate flex-1 text-left">{item.label}</span>
                            )}
                            {isSidebarOpen && item.isProtected && (
                              <Lock className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-amber-200' : 'text-white/50'}`} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sidebar Bottom: CERRAR SESIÓN, Buscar actualizaciones & User profile key badge */}
          <div
            className={`${
              isSidebarOpen ? 'p-3' : 'px-2 py-3'
            } border-t border-white/15 bg-[#3D4E1C]/60 space-y-2 shrink-0 flex flex-col items-center`}
          >
            <button
              type="button"
              disabled={isLoggingOutSync}
              onClick={handleFullLogoutAndSync}
              className={`flex items-center justify-center rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 border border-rose-400/60 text-white text-xs font-black uppercase tracking-wider transition-colors cursor-pointer shadow-xs ${
                isSidebarOpen ? 'w-full gap-2 py-2 px-3' : 'w-11 h-11 p-0'
              }`}
              title="Sincronizar datos en Firebase y Cerrar Sesión"
            >
              <LogOut className={`w-3.5 h-3.5 text-white shrink-0 ${isLoggingOutSync ? 'animate-pulse' : ''}`} />
              {isSidebarOpen && (
                <span>{isLoggingOutSync ? 'Sincronizando...' : 'CERRAR SESIÓN'}</span>
              )}
            </button>

            <UpdateButton compact={!isSidebarOpen} />

            {/* User Pill Chip */}
            <div
              onClick={() => setIsUserAccessOpen(true)}
              className={`rounded-2xl bg-white text-[#1F2937] flex items-center shadow-sm cursor-pointer hover:ring-2 hover:ring-[#6B8E23] transition-all ${
                isSidebarOpen ? 'w-full p-2 justify-between' : 'w-11 h-11 p-1 justify-center'
              }`}
              title="Mi Acceso y Licencia"
            >
              <div className={`flex items-center ${isSidebarOpen ? 'gap-2 truncate' : 'justify-center'}`}>
                <div className="w-7 h-7 rounded-lg bg-[#4A5D23]/10 text-[#4A5D23] flex items-center justify-center font-bold text-xs shrink-0">
                  {fixedOwnerName.slice(0, 2).toUpperCase() || 'PR'}
                </div>
                {isSidebarOpen && (
                  <div className="text-left truncate">
                    <div className="text-xs font-bold text-[#1F2937] truncate">{fixedOwnerName}</div>
                    <div className="text-[10px] text-[#4B5563] font-mono">PROPIETARIO · 1.5.13</div>
                  </div>
                )}
              </div>
              {isSidebarOpen && <KeyRound className="w-4 h-4 text-[#D97706] shrink-0 ml-1" />}
            </div>
          </div>
        </aside>

        {/* Content Area (Independent scroll container) */}
        <main className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-6 lg:p-8 space-y-5 sm:space-y-6 bg-[#F6F8F5]">
          {/* 10-Day License Expiration Warning Banner (1 year validity, zero data loss on renewal) */}
          {isExpiringSoon && daysRemaining > 0 && (
            <div className="p-4 rounded-2xl bg-amber-50 border-2 border-[#E89E2D] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-3 text-xs text-amber-950">
                <div className="w-9 h-9 rounded-xl bg-[#E89E2D]/20 text-[#D97706] flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-black uppercase tracking-wider text-amber-900">
                    Aviso de Renovación de Licencia · {daysRemaining} {daysRemaining === 1 ? 'día restante' : 'días restantes'}
                  </div>
                  <p className="text-[11px] text-amber-800">
                    Tu licencia vence pronto. Renueva con un código de 12 caracteres para mantener 1 año adicional sin perder ningún dato de tu restaurante.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsUserAccessOpen(true)}
                className="shrink-0 px-4 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#E89E2D]" />
                Renovar Licencia
              </button>
            </div>
          )}

          {/* Isolated Per-Client Customization Banner (only shown for this specific storeId) */}
          {(clientOverride?.featureFlags?.customBannerText || clientOverride?.customTag) && (
            <div className="px-4 py-2.5 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex flex-wrap items-center justify-between gap-2 text-xs text-[#4A5D23]">
              <div className="flex items-center gap-2 font-bold">
                <Sparkles className="w-4 h-4 text-[#D97706] shrink-0" />
                <span>{clientOverride.featureFlags?.customBannerText || clientOverride.customTag}</span>
              </div>
              {clientOverride.customTag && (
                <span className="px-2.5 py-0.5 rounded-full bg-white border border-[#4A5D23]/30 text-[10px] font-black uppercase">
                  {clientOverride.customTag}
                </span>
              )}
            </div>
          )}

          {/* ACTIVE TAB MODULES WITH LAZY LOADING SUSPENSE */}
          <Suspense
            fallback={
              <div className="p-12 flex flex-col items-center justify-center text-center">
                <RefreshCw className="w-8 h-8 text-[#4A5D23] animate-spin mb-3" />
                <p className="text-xs font-bold text-[#4B5563] uppercase tracking-wider">
                  Cargando módulo...
                </p>
              </div>
            }
          >
            {/* MÓDULO WHATSAPP (en stand-by controlado por showWhatsApp) */}
            {showWhatsApp && activeTab === 'whatsapp' && canAccessTab('whatsapp') && (
              <WhatsAppModule />
            )}

            {/* SECCIÓN SERVICIO */}
            {activeTab === 'resumen' && canAccessTab('resumen') && (
              <ResumenDiarioModule onOpenReservas={() => handleTabSelect('reservas')} />
            )}
            {activeTab === 'mesas' && canAccessTab('mesas') && <MesasModule />}
            {activeTab === 'reservas' && canAccessTab('reservas') && <ReservasModule />}
            {activeTab === 'cocina' && canAccessTab('cocina') && <CocinaModule />}

            {/* SECCIÓN GESTIÓN */}
            {activeTab === 'carta' && canAccessTab('carta') && <CartaModule />}
            {activeTab === 'inventario' && canAccessTab('inventario') && <InventarioModule />}
            {activeTab === 'kardex' && canAccessTab('kardex') && <KardexModule />}
            {activeTab === 'recetas' && canAccessTab('recetas') && <RecetasModule />}
            {activeTab === 'mermas' && canAccessTab('mermas') && <ControlMermasModule />}

            {/* SECCIÓN ADMINISTRACIÓN */}
            {activeTab === 'menaje' && canAccessTab('menaje') && <MenajeModule />}
            {activeTab === 'caja' && canAccessTab('caja') && <CajaModule />}
            {activeTab === 'proveedores' && canAccessTab('proveedores') && (
              <ProveedoresModule onGoToPurchases={() => canAccessTab('compras') && setActiveTab('compras')} />
            )}
            {activeTab === 'compras' && canAccessTab('compras') && <PurchasesModule />}
            {activeTab === 'reportes' && canAccessTab('reportes') && <ReportesModule />}

            {/* SECCIÓN GERENCIA Y OPERACIONES / CONTROL EJECUTIVO */}
            {activeTab === 'control_ejecutivo' && (
              <ControlEjecutivoModule key="control-ejecutivo" />
            )}
            {activeTab === 'configuracion' && canAccessTab('configuracion') && (
              <ControlEjecutivoModule key="control-ejecutivo-config" initialTab="configuracion" />
            )}
            {activeTab === 'usuarios' && canAccessTab('usuarios') && <UsuariosPermisosModule />}
            {activeTab === 'clientes' && canAccessTab('clientes') && <ClientesModule />}
            {activeTab === 'facturacion' && canAccessTab('facturacion') && <FacturacionModule />}
            {activeTab === 'control_inventario' && canAccessTab('control_inventario') && <ControlInventarioModule />}
          </Suspense>
        </main>
      </div>

      {/* User Access & License Modal */}
      <UserAccessModal
        isOpen={isUserAccessOpen}
        onClose={() => setIsUserAccessOpen(false)}
        restaurantName={systemSettings?.localName || ''}
      />

      {/* Hidden Creator Master Panel (Iván Muñoz) */}
      <CreatorMasterModal
        isOpen={isCreatorMasterOpen}
        onClose={() => setIsCreatorMasterOpen(false)}
      />

      {/* Technical Support Modal (?) */}
      <SupportModal
        isOpen={isSupportModalOpen}
        onClose={() => setIsSupportModalOpen(false)}
      />

      {/* About Us Modal */}
      <AboutUsModal
        isOpen={isAboutUsModalOpen}
        onClose={() => setIsAboutUsModalOpen(false)}
      />

      {/* Real-time Sidebar User Switch Modal (sin recargar página ni volver al Login) */}
      {isSwitchUserModalOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => !isSwitchingUser && setIsSwitchUserModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white border border-gray-200 rounded-3xl shadow-2xl overflow-hidden text-[#1F2937]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 bg-[#4A5D23] text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
                  <ArrowLeftRight className="w-4 h-4 text-[#E89E2D]" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide">
                    Cambiar Usuario Activo
                  </h3>
                  <p className="text-[11px] text-lime-100/90">
                    Cambio inmediato de permisos y módulos sin salir del POS
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSwitchingUser}
                onClick={() => setIsSwitchUserModalOpen(false)}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!selectedSwitchUser ? (
              <div className="p-4 sm:p-5 space-y-2.5 max-h-[65vh] overflow-y-auto">
                <p className="text-xs font-semibold text-gray-600 mb-2">
                  Selecciona el usuario para ingresar con su contraseña:
                </p>
                {directoryUsers.length === 0 ? (
                  <div className="p-6 text-center text-xs text-gray-500 border border-dashed border-gray-300 rounded-2xl">
                    No hay usuarios registrados disponibles.
                  </div>
                ) : (
                  directoryUsers.map((u) => {
                    const isCurrent = u.uid === userProfile?.uid;
                    const displayName = `${u.name || ''} ${u.lastName || ''}`.trim() || u.email;
                    return (
                      <button
                        key={u.uid}
                        type="button"
                        onClick={() => {
                          setSelectedSwitchUser(u);
                          setSwitchPasswordInput('');
                          setSwitchError(null);
                        }}
                        className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between gap-3 transition-all cursor-pointer ${
                          isCurrent
                            ? 'bg-[#EAF5F0] border-[#4A5D23] ring-1 ring-[#4A5D23]/40'
                            : 'bg-gray-50 hover:bg-[#EAF5F0]/60 border-gray-200 hover:border-[#4A5D23]/40'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-[#4A5D23] text-white font-black text-sm flex items-center justify-center shrink-0">
                            {displayName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-gray-900 truncate">
                              {displayName}
                            </div>
                            <div className="text-[11px] font-semibold text-[#4A5D23]">
                              {translateRoleToSpanish(u.role)}
                            </div>
                          </div>
                        </div>
                        {isCurrent ? (
                          <span className="px-2 py-0.5 rounded-lg bg-[#4A5D23] text-white text-[10px] font-black uppercase flex items-center gap-1 shrink-0">
                            <CheckCircle2 className="w-3 h-3" />
                            Activo
                          </span>
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <form onSubmit={handleConfirmSwitchUser} className="p-4 sm:p-5 space-y-4">
                <div className="p-3.5 rounded-2xl bg-[#F6F8F5] border border-gray-200 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#4A5D23] text-white font-black text-sm flex items-center justify-center shrink-0">
                      {(selectedSwitchUser.name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-black text-sm text-gray-900 truncate">
                        {`${selectedSwitchUser.name || ''} ${selectedSwitchUser.lastName || ''}`.trim()}
                      </div>
                      <div className="text-[11px] font-bold text-[#4A5D23]">
                        {translateRoleToSpanish(selectedSwitchUser.role)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isSwitchingUser}
                    onClick={() => {
                      setSelectedSwitchUser(null);
                      setSwitchPasswordInput('');
                      setSwitchError(null);
                    }}
                    className="text-xs font-bold text-[#4A5D23] hover:underline cursor-pointer shrink-0"
                  >
                    Elegir otro
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">
                    Ingresa la contraseña de {selectedSwitchUser.name}
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showSwitchPassword ? 'text' : 'password'}
                      autoFocus
                      required
                      value={switchPasswordInput}
                      onChange={(e) => setSwitchPasswordInput(e.target.value)}
                      placeholder="Contraseña..."
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-gray-300 focus:border-[#4A5D23] bg-white text-sm font-semibold focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSwitchPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
                    >
                      {showSwitchPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {switchError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
                    {switchError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isSwitchingUser}
                    onClick={() => setIsSwitchUserModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSwitchingUser || !switchPasswordInput.trim()}
                    className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    {isSwitchingUser ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      <>
                        <KeyRound className="w-3.5 h-3.5 text-[#E89E2D]" />
                        Cambiar Usuario
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
