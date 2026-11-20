import { configuredBranches, MAX_BRANCHES } from '../context/BranchContext';
import { UpdateButton } from './UpdateButton';
import React, { useState, useEffect, useRef } from 'react';
import { doc, setDoc, onSnapshot, collection, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { usePrinter } from '../context/PrinterContext';
import { commitOfflineSafe, getDocsOfflineSafe } from '../utils/offlineFirestore';
import { PaperFormat } from '../utils/printerService';
import { compressImageFile } from '../utils/storage';
import { translateRoleToSpanish } from '../utils/roleLabels';
import {
  Settings,
  Printer,
  Upload,
  CheckCircle2,
  Percent,
  Building,
  Image as ImageIcon,
  RotateCcw,
  RefreshCw,
  FileText,
  Sliders,
  Lock,
  Receipt,
  FileSpreadsheet,
  Check,
  MapPin,
  FileCheck,
  Plus,
  Download,
  Eye,
  EyeOff,
  AlertTriangle,
  ShieldCheck,
  Trash2,
  DatabaseZap,
  Eraser,
} from 'lucide-react';

type DangerActionType = 'encerar_sistema' | 'borrar_inventario' | 'borrar_registros';

interface ConfiguracionModuleProps {
  unlockedByParent?: boolean;
}

export const ConfiguracionModule: React.FC<ConfiguracionModuleProps> = ({
  unlockedByParent = false,
}) => {
  const { userProfile, currentUser, verifyOwnerPassword, logoutAndSync } = useAuth();
  const {
    printers: detectedPrinters,
    isScanning: isScanningPrinters,
    isPrinting,
    detectPrintersNow,
    pairUsbPrinter,
    pairSerialPrinter,
    addCustomNetworkPrinter,
    removeCustomPrinter,
    printTestTicket,
    hardwareStatusBanner,
  } = usePrinter();
  const isOwner = userProfile?.role === 'Owner' || unlockedByParent;

  const [activeSubTab, setActiveSubTab] = useState<'general' | 'impresoras'>('general');
  const hasPendingEditRef = useRef(false);

  // General Settings state
  // General Settings state - empty defaults per global rule
  const [localName, setLocalName] = useState('');
  const [slogan, setSlogan] = useState('');
  const [ruc, setRuc] = useState('');
  const [address, setAddress] = useState('');
  const [mainEstablishment, setMainEstablishment] = useState('');
  const [branches, setBranches] = useState<string[]>(['Matriz']);
  const [newBranchName, setNewBranchName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string>('/assets/gastrolab_fhd.jpg');
  const [ivaPercentage, setIvaPercentage] = useState<string>('');
  const [foodCostPercentage, setFoodCostPercentage] = useState<string>('');
  const [isHydrated, setIsHydrated] = useState(false);
  const [autoSavedAt, setAutoSavedAt] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Printers state synced with real PrinterContext
  const [defaultReceiptPrinter, setDefaultReceiptPrinter] = useState('Impresora del Sistema — Térmica (80mm / 58mm)');
  const [defaultReportPrinter, setDefaultReportPrinter] = useState('Impresora del Sistema — Normal A4 / Carta (Epson / HP / Canon)');
  const [defaultKitchenPrinter, setDefaultKitchenPrinter] = useState('Impresora del Sistema — Térmica (80mm / 58mm)');
  const [paperSize, setPaperSize] = useState<'58mm' | '80mm' | 'A4'>('80mm');
  const [autoCut, setAutoCut] = useState(true);
  const [customPrinterName, setCustomPrinterName] = useState('');
  const [customPrinterPaper, setCustomPrinterPaper] = useState<PaperFormat>('A4');
  const [customPrinterConn, setCustomPrinterConn] = useState<'USB' | 'Red / Ethernet' | 'Bluetooth'>('Red / Ethernet');

  // Status feedback
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [testPrintModalOpen, setTestPrintModalOpen] = useState(false);

  // Mandatory Owner Password Gate (Point 14) - locked every time module opens unless unlocked by Control Ejecutivo
  const [isUnlocked, setIsUnlocked] = useState(unlockedByParent);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isVerifyingUnlock, setIsVerifyingUnlock] = useState(false);

  useEffect(() => {
    if (unlockedByParent) {
      setIsUnlocked(true);
    }
  }, [unlockedByParent]);

  // Maintenance / Danger Zone Modal state
  const [dangerAction, setDangerAction] = useState<DangerActionType | null>(null);
  const [dangerPassword, setDangerPassword] = useState('');
  const [showDangerPassword, setShowDangerPassword] = useState(false);
  const [dangerError, setDangerError] = useState<string | null>(null);
  const [isExecutingDanger, setIsExecutingDanger] = useState(false);

  // Factory Reset ("Restablecimiento de Fábrica") 2-step state
  const [factoryResetStep, setFactoryResetStep] = useState<'closed' | 'password' | 'confirm'>('closed');
  const [factoryResetPassword, setFactoryResetPassword] = useState('');
  const [showFactoryResetPassword, setShowFactoryResetPassword] = useState(false);
  const [factoryResetError, setFactoryResetError] = useState<string | null>(null);
  const [isVerifyingFactoryResetPass, setIsVerifyingFactoryResetPass] = useState(false);
  const [isExecutingFactoryReset, setIsExecutingFactoryReset] = useState(false);
  const [factoryResetProgress, setFactoryResetProgress] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
      if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    };
  }, []);

  const markDirty = () => {
    hasPendingEditRef.current = true;
  };

  // Subscribe to settings in Firestore & load local fallback immediately
  useEffect(() => {
    try {
      const localBackup = localStorage.getItem('gastrolab_settings_backup');
      if (localBackup) {
        const data = JSON.parse(localBackup);
        if (data.localName) setLocalName(data.localName);
        if (data.slogan !== undefined) setSlogan(data.slogan);
        if (data.ruc) setRuc(data.ruc);
        if (data.address) setAddress(data.address);
        if (data.establishment) setMainEstablishment(data.establishment);
        if (Array.isArray(data.branches) && data.branches.length > 0) setBranches(configuredBranches(data.branches));
        if (data.logoUrl) setLogoUrl(data.logoUrl);
        if (data.ivaPercentage !== undefined) setIvaPercentage(data.ivaPercentage.toString());
        if (data.foodCostPercentage !== undefined) setFoodCostPercentage(data.foodCostPercentage.toString());
      }
    } catch {
      // Ignore parse error
    }

    const docRef = doc(db, 'settings', 'general');
    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        if (snap.exists() && !hasPendingEditRef.current) {
          const data = snap.data() as any;
          if (data.localName !== undefined) setLocalName(data.localName);
          if (data.slogan !== undefined) setSlogan(data.slogan);
          if (data.ruc !== undefined) setRuc(data.ruc);
          if (data.address !== undefined) setAddress(data.address);
          if (data.establishment !== undefined) setMainEstablishment(data.establishment);
          if (Array.isArray(data.branches) && data.branches.length > 0) setBranches(configuredBranches(data.branches));
          if (data.logoUrl) setLogoUrl(data.logoUrl);
          if (data.ivaPercentage !== undefined) setIvaPercentage(data.ivaPercentage.toString());
          if (data.foodCostPercentage !== undefined) setFoodCostPercentage(data.foodCostPercentage.toString());
          if (data.receiptPrinter) setDefaultReceiptPrinter(data.receiptPrinter);
          if (data.reportsPrinter) setDefaultReportPrinter(data.reportsPrinter);
          if (data.kitchenPrinter) setDefaultKitchenPrinter(data.kitchenPrinter);
          if (data.paperSize) setPaperSize(data.paperSize);
          if (data.autoCut !== undefined) setAutoCut(data.autoCut);
        }
        setIsHydrated(true);
      },
      (err) => {
        console.warn('Configuracion settings listener notice:', err);
        setIsHydrated(true);
      }
    );

    return () => unsubscribe();
  }, []);

  // Auto-save ONLY when user has actively edited a field (prevents Firestore snapshot write loop)
  useEffect(() => {
    if (!isHydrated || !isOwner || !isUnlocked || !hasPendingEditRef.current) return;

    const payload = {
      localName: localName.trim(),
      slogan: slogan.trim(),
      ruc: ruc.trim(),
      address: address.trim(),
      establishment: mainEstablishment.trim(),
      branches: configuredBranches(branches),
      logoUrl,
      ivaPercentage: ivaPercentage.trim() === '' ? 15 : (parseFloat(ivaPercentage) || 0),
      foodCostPercentage: foodCostPercentage.trim() === '' ? 30 : (parseFloat(foodCostPercentage) || 30),
      receiptPrinter: defaultReceiptPrinter,
      reportsPrinter: defaultReportPrinter,
      kitchenPrinter: defaultKitchenPrinter,
      paperSize,
      autoCut,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.email || 'Owner',
    };

    try {
      localStorage.setItem('gastrolab_settings_backup', JSON.stringify(payload));
    } catch {
      // Ignore quota errors
    }

    const timer = setTimeout(async () => {
      hasPendingEditRef.current = false;
      try {
        await setDoc(doc(db, 'settings', 'general'), payload, { merge: true });
        setAutoSavedAt(new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } catch (err) {
        console.warn('Auto-save queued offline:', err);
      }
    }, 650);

    return () => clearTimeout(timer);
  }, [
    isHydrated,
    isOwner,
    isUnlocked,
    localName,
    slogan,
    ruc,
    address,
    mainEstablishment,
    branches,
    logoUrl,
    ivaPercentage,
    foodCostPercentage,
    defaultReceiptPrinter,
    defaultReportPrinter,
    defaultKitchenPrinter,
    paperSize,
    autoCut,
    currentUser?.email,
  ]);

  // Handle Logo Upload with lightweight JPEG compression so session is never interrupted
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.target.files?.[0];
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (!file) return;

    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name)) {
      showError('Por favor selecciona una imagen válida (JPG, PNG, WebP).');
      return;
    }

    try {
      const { dataUrl } = await compressImageFile(file, 320, 0.82);
      setLogoUrl(dataUrl);

      try {
        await setDoc(
          doc(db, 'settings', 'general'),
          { logoUrl: dataUrl, updatedAt: new Date().toISOString() },
          { merge: true }
        );
        showFeedback('¡Logotipo actualizado y guardado en el sistema con éxito!');
      } catch (err) {
        console.error('Error al guardar logotipo en Firestore:', err);
        showFeedback('Logo cargado en vista previa. Presiona Guardar para sincronizar.');
      }
    } catch (err: any) {
      console.error('Error procesando imagen de logo:', err);
      showError(err?.message || 'No se pudo procesar la imagen seleccionada. Intenta con otra imagen.');
    }
  };

  const handleResetLogo = async () => {
    const defaultLogo = '/assets/gastrolab_fhd.jpg';
    hasPendingEditRef.current = false;
    setLogoUrl(defaultLogo);
    try {
      await setDoc(doc(db, 'settings', 'general'), { logoUrl: defaultLogo }, { merge: true });
      showFeedback('Logo restablecido al logotipo oficial GASTROLAB.');
    } catch {
      showFeedback('Logo restablecido temporalmente.');
    }
  };

  const showFeedback = (msg: string) => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    setErrorMsg(null);
    setSaveSuccessMsg(msg);
    feedbackTimerRef.current = window.setTimeout(() => setSaveSuccessMsg(null), 4500);
  };

  const showError = (msg: string) => {
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current);
    setSaveSuccessMsg(null);
    setErrorMsg(msg);
    errorTimerRef.current = window.setTimeout(() => setErrorMsg(null), 5000);
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError(null);
    const cleanPass = unlockPassword.trim();
    if (!cleanPass) {
      setUnlockError('Ingresa la clave personal del Propietario.');
      return;
    }

    setIsVerifyingUnlock(true);
    try {
      const verified = await verifyOwnerPassword(cleanPass);
      if (verified) {
        setIsUnlocked(true);
        setUnlockPassword('');
        setUnlockError(null);
      } else {
        setUnlockError('Contraseña incorrecta. Acceso denegado al módulo de Configuración.');
      }
    } catch {
      setUnlockError('No se pudo verificar la clave. Inténtalo nuevamente.');
    } finally {
      setIsVerifyingUnlock(false);
    }
  };

  const handleAddBranch = () => {
    const trimmed = newBranchName.trim();
    if (branches.length >= MAX_BRANCHES) {
      showError(`El límite es de ${MAX_BRANCHES} establecimientos, incluida la Matriz.`);
      return;
    }
    if (trimmed && !branches.some((name) => name.toLowerCase() === trimmed.toLowerCase())) {
      markDirty();
      setBranches((prev) => configuredBranches([...prev, trimmed]));
      setNewBranchName('');
    }
  };

  const handleRemoveBranch = (name: string) => {
    if (name === 'Matriz') return;
    markDirty();
    setBranches((prev) => prev.filter((b) => b !== name));
  };

  // Chunked batch deletion helper (respects Firestore 500 ops limit per batch)
  const deleteCollectionDocs = async (colName: string): Promise<number> => {
    const snap = await getDocs(collection(db, colName));
    if (snap.empty) return 0;
    let deleted = 0;
    let batch = writeBatch(db);
    let count = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      count++;
      deleted++;
      if (count >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
    if (count > 0) {
      await batch.commit();
    }
    return deleted;
  };

  const resetOperationalTablesAndCash = async () => {
    const now = new Date().toISOString();
    const tablesSnap = await getDocs(collection(db, 'tables'));
    if (!tablesSnap.empty) {
      const batch = writeBatch(db);
      tablesSnap.docs.forEach((d) => {
        batch.update(d.ref, {
          status: 'Libre',
          currentOrderId: '',
          total: 0,
          itemCount: 0,
          activeSince: '',
          updatedAt: now,
        });
      });
      await batch.commit();
    }

    const regSnap = await getDocs(collection(db, 'cash_registers'));
    if (!regSnap.empty) {
      const batch = writeBatch(db);
      regSnap.docs.forEach((d) => {
        batch.update(d.ref, {
          status: 'closed',
          updatedAt: now,
        });
      });
      await batch.commit();
    }

    try {
      const draftKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('gastrolab_draft_')) draftKeys.push(k);
      }
      draftKeys.forEach((k) => localStorage.removeItem(k));
    } catch {
      // Ignore storage error
    }
  };

  const handleConfirmDangerAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dangerAction) return;
    setDangerError(null);

    const cleanPass = dangerPassword.trim();
    if (!cleanPass) {
      setDangerError('Ingresa la contraseña del Propietario para continuar.');
      return;
    }

    setIsExecutingDanger(true);
    try {
      const isValidOwner = await verifyOwnerPassword(cleanPass);
      if (!isValidOwner) {
        setDangerError('Contraseña del Propietario incorrecta. Operación cancelada.');
        setIsExecutingDanger(false);
        return;
      }

      if (dangerAction === 'borrar_inventario') {
        await deleteCollectionDocs('inventory');
        await deleteCollectionDocs('inventory_audits');
        showFeedback('Inventario y auditorías físicas eliminados correctamente.');
      } else if (dangerAction === 'borrar_registros') {
        const transactionalCols = [
          'orders',
          'cash_shifts',
          'cash_movements',
          'electronic_invoices',
          'invoices',
          'purchases',
          'kardex',
          'waste_records',
          'reservations',
          'inventory_audits',
        ];
        for (const colName of transactionalCols) {
          await deleteCollectionDocs(colName);
        }
        await resetOperationalTablesAndCash();
        showFeedback('Registros operativos y ventas borrados correctamente. Catálogo y usuarios conservados.');
      } else if (dangerAction === 'encerar_sistema') {
        const allBusinessCols = [
          'orders',
          'cash_shifts',
          'cash_movements',
          'electronic_invoices',
          'invoices',
          'purchases',
          'kardex',
          'waste_records',
          'reservations',
          'inventory_audits',
          'inventory',
          'products',
          'recipes',
          'subrecipes',
          'clients',
          'customers',
          'suppliers',
          'menaje',
          'equipment',
        ];
        for (const colName of allBusinessCols) {
          await deleteCollectionDocs(colName);
        }
        await resetOperationalTablesAndCash();
        showFeedback('¡Sistema encerado por completo! Cuenta Propietario, licencia y configuración conservadas.');
      }

      setDangerAction(null);
      setDangerPassword('');
      setDangerError(null);
    } catch (err: any) {
      console.error('Error ejecutando mantenimiento crítico:', err);
      setDangerError(err?.message || 'Error al limpiar los datos en Firestore.');
    } finally {
      setIsExecutingDanger(false);
    }
  };

  // Factory Reset Step 1: Verify Owner Password before showing destructive confirmation alert
  const handleVerifyFactoryResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFactoryResetError(null);

    const cleanPass = factoryResetPassword.trim();
    if (!cleanPass) {
      setFactoryResetError('Ingresa la contraseña del Propietario para continuar.');
      return;
    }

    setIsVerifyingFactoryResetPass(true);
    try {
      const isValidOwner = await verifyOwnerPassword(cleanPass);
      if (!isValidOwner) {
        setFactoryResetError('Contraseña del Propietario incorrecta. No se realizaron cambios.');
        return;
      }
      setFactoryResetPassword('');
      setFactoryResetError(null);
      setFactoryResetStep('confirm');
    } catch {
      setFactoryResetError('No se pudo validar la contraseña del Propietario. Inténtalo nuevamente.');
    } finally {
      setIsVerifyingFactoryResetPass(false);
    }
  };

  // Factory Reset Step 2: Confirm SI -> wipe all Firestore collections, clear local caches, sign out & redirect to Login
  const handleExecuteFactoryReset = async () => {
    setIsExecutingFactoryReset(true);
    setFactoryResetError(null);
    hasPendingEditRef.current = false;

    const collectionsToWipe = [
      // Colecciones operativas y de negocio (orden seguro dejando usuarios/configuración al final)
      'products',
      'inventory',
      'kardex',
      'orders',
      'tables',
      'sales',
      'providers',
      'purchases',
      'recipes',
      'waste',
      'promotions',
      'whatsapp_chats',
      'whatsapp_orders',
      // Colecciones complementarias del ecosistema GASTROLAB
      'suppliers',
      'waste_records',
      'subrecipes',
      'electronic_invoices',
      'invoices',
      'cash_registers',
      'cash_shifts',
      'cash_movements',
      'clients',
      'customers',
      'monthly_expenses',
      'payroll_employees',
      'reservations',
      'inventory_audits',
      'menaje',
      'equipment',
      // Configuraciones y perfiles de acceso al cierre
      'settings',
      'login_profiles',
      'users',
    ];

    try {
      for (const colName of collectionsToWipe) {
        setFactoryResetProgress(`Eliminando registros de "${colName}"...`);
        try {
          await deleteCollectionDocs(colName);
        } catch (colErr) {
          console.warn(`Aviso al limpiar colección ${colName}:`, colErr);
        }
      }

      setFactoryResetProgress('Limpiando memoria local y cerrando sesión...');

      try {
        const keysToRemove: string[] = [
          'gastrolab_cached_users',
          'gastrolab_settings_backup',
          'gastrolab_selected_branch',
          'gastrolab_customer_display_state',
          'gastrolab_whatsapp_env_v1',
        ];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('gastrolab_draft_')) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
        localStorage.setItem('gastrolab_factory_reset_success', 'Sistema restablecido con éxito');
      } catch {
        // Ignore localStorage restrictions
      }

      await logoutAndSync();
    } catch (err: any) {
      console.error('Error durante el Restablecimiento de Fábrica:', err);
      setFactoryResetError(err?.message || 'Error al ejecutar el restablecimiento completo.');
      setIsExecutingFactoryReset(false);
    }
  };

  // Export Menu & Configuration from Matriz (Point 11 Multisucursal - deduplicated by normalized name)
  const handleExportMenuAndConfig = async () => {
    try {
      const [productsSnap, recipesSnap, subrecipesSnap] = await Promise.all([
        getDocsOfflineSafe(collection(db, 'products')),
        getDocsOfflineSafe(collection(db, 'recipes')),
        getDocsOfflineSafe(collection(db, 'subrecipes')),
      ]);

      const dedupeDocs = (docs: Array<{ id: string; [key: string]: any }>) => {
        const byName = new Map<string, { id: string; [key: string]: any }>();
        for (const item of docs) {
          const normName = String(item.name || '').trim().toLowerCase();
          const key = normName || item.id;
          if (!byName.has(key)) {
            byName.set(key, item);
          }
        }
        return Array.from(byName.values());
      };

      const rawProducts = productsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }));
      const rawRecipes = recipesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }));
      const rawSubrecipes = subrecipesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }));

      const exportPackage = {
        exportedAt: new Date().toISOString(),
        sourceBranch: 'Matriz',
        system: 'GASTROLAB by Iván Muñoz',
        settings: {
          localName,
          slogan,
          ruc,
          address,
          establishment: mainEstablishment,
          branches,
          ivaPercentage: parseFloat(ivaPercentage) || 15,
          foodCostPercentage: parseFloat(foodCostPercentage) || 30,
        },
        products: dedupeDocs(rawProducts),
        recipes: dedupeDocs(rawRecipes),
        subrecipes: dedupeDocs(rawSubrecipes),
      };

      const blob = new Blob([JSON.stringify(exportPackage, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `GASTROLAB_Menu_Config_Matriz_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showFeedback('Menú y configuración de Matriz exportados correctamente.');
    } catch (err: any) {
      showError('Error al exportar menú y configuración: ' + err.message);
    }
  };

  // Import Menu & Configuration into Sucursal (Point 11 Multisucursal - strict deduplication)
  const handleImportMenuAndConfig = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const pkg = JSON.parse(text);

      if (pkg.settings) {
        hasPendingEditRef.current = false;
        const nextLocalName = pkg.settings.localName ?? localName;
        const nextSlogan = pkg.settings.slogan !== undefined ? pkg.settings.slogan : slogan;
        const nextRuc = pkg.settings.ruc ?? ruc;
        const nextAddress = pkg.settings.address ?? address;
        const nextBranches = Array.isArray(pkg.settings.branches) && pkg.settings.branches.length > 0
          ? configuredBranches(pkg.settings.branches)
          : branches;
        const nextIva = pkg.settings.ivaPercentage !== undefined ? Number(pkg.settings.ivaPercentage) : (parseFloat(ivaPercentage) || 15);
        const nextFoodCost = pkg.settings.foodCostPercentage !== undefined ? Number(pkg.settings.foodCostPercentage) : (parseFloat(foodCostPercentage) || 30);

        if (pkg.settings.localName) setLocalName(nextLocalName);
        if (pkg.settings.slogan !== undefined) setSlogan(nextSlogan);
        if (pkg.settings.ruc) setRuc(nextRuc);
        if (pkg.settings.address) setAddress(nextAddress);
        if (Array.isArray(pkg.settings.branches) && pkg.settings.branches.length > 0) setBranches(nextBranches);
        if (pkg.settings.ivaPercentage !== undefined) setIvaPercentage(String(nextIva));
        if (pkg.settings.foodCostPercentage !== undefined) setFoodCostPercentage(String(nextFoodCost));

        await commitOfflineSafe(
          setDoc(
            doc(db, 'settings', 'general'),
            {
              localName: String(nextLocalName || '').trim(),
              slogan: String(nextSlogan || '').trim(),
              ruc: String(nextRuc || '').trim(),
              address: String(nextAddress || '').trim(),
              branches: nextBranches,
              ivaPercentage: nextIva,
              foodCostPercentage: nextFoodCost,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          ),
          'importar configuración general'
        );
      }

      const [existingProdSnap, existingRecSnap, existingSubSnap] = await Promise.all([
        getDocsOfflineSafe(collection(db, 'products')),
        getDocsOfflineSafe(collection(db, 'recipes')),
        getDocsOfflineSafe(collection(db, 'subrecipes')),
      ]);

      const buildLookup = (snap: typeof existingProdSnap) => {
        const byId = new Set<string>();
        const byName = new Map<string, string>();
        snap.docs.forEach((d) => {
          byId.add(d.id);
          const nm = String((d.data() as any)?.name || '').trim().toLowerCase();
          if (nm && !byName.has(nm)) {
            byName.set(nm, d.id);
          }
        });
        return { byId, byName };
      };

      const mergeCollectionDeduped = async (
        colName: 'products' | 'recipes' | 'subrecipes',
        items: any[],
        lookup: { byId: Set<string>; byName: Map<string, string> }
      ): Promise<number> => {
        if (!Array.isArray(items) || items.length === 0) return 0;
        const seenNames = new Set<string>();
        let batch = writeBatch(db);
        let ops = 0;
        let written = 0;

        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const { id, ...rest } = item;
          const normName = String(rest.name || '').trim().toLowerCase();
          if (normName && seenNames.has(normName)) continue;
          if (normName) seenNames.add(normName);

          const matchedId =
            (id && lookup.byId.has(String(id)) ? String(id) : '') ||
            (normName ? lookup.byName.get(normName) || '' : '') ||
            (id ? String(id) : '');

          const targetRef = matchedId
            ? doc(db, colName, matchedId)
            : doc(collection(db, colName));

          if (normName) lookup.byName.set(normName, targetRef.id);
          lookup.byId.add(targetRef.id);

          batch.set(targetRef, rest, { merge: true });
          ops++;
          written++;
          if (ops >= 400) {
            await commitOfflineSafe(batch.commit(), `importar ${colName}`);
            batch = writeBatch(db);
            ops = 0;
          }
        }

        if (ops > 0) {
          await commitOfflineSafe(batch.commit(), `importar ${colName}`);
        }
        return written;
      };

      const importedProducts = await mergeCollectionDeduped(
        'products',
        pkg.products,
        buildLookup(existingProdSnap)
      );
      await mergeCollectionDeduped('recipes', pkg.recipes, buildLookup(existingRecSnap));
      await mergeCollectionDeduped('subrecipes', pkg.subrecipes, buildLookup(existingSubSnap));

      showFeedback(
        `¡Importación exitosa en Sucursal! (${importedProducts} productos sin duplicados y configuración sincronizados).`
      );
    } catch (err: any) {
      showError('Archivo inválido o error al importar configuración: ' + err.message);
    } finally {
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  // Save General Settings
  const handleSaveGeneralSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setSaveSuccessMsg(null);

    const parsedIva = ivaPercentage.trim() === '' ? 15 : (parseFloat(ivaPercentage) || 0);
    const parsedFoodCost = foodCostPercentage.trim() === '' ? 30 : (parseFloat(foodCostPercentage) || 30);

    try {
      const docRef = doc(db, 'settings', 'general');
      const settingsPayload: any = {
        localName: localName.trim(),
        slogan: slogan.trim(),
        ruc: ruc.trim(),
        address: address.trim(),
        establishment: mainEstablishment.trim(),
        branches: configuredBranches(branches),
        logoUrl: logoUrl,
        ivaPercentage: parsedIva,
        foodCostPercentage: parsedFoodCost,
        receiptPrinter: defaultReceiptPrinter,
        reportsPrinter: defaultReportPrinter,
        kitchenPrinter: defaultKitchenPrinter,
        paperSize: paperSize,
        autoCut: autoCut,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || 'Owner',
      };

      await setDoc(docRef, settingsPayload, { merge: true });
      showFeedback('¡Configuración guardada exitosamente! Datos actualizados en todo el sistema.');
    } catch (err: any) {
      console.error('Error al guardar configuración:', err);
      showError('Error al guardar configuración en Firestore.');
    } finally {
      setIsSaving(false);
    }
  };

  // Real Automatic Hardware Detection (WebUSB + WebSerial + OS Print Spooler)
  const handleDetectPrinters = async () => {
    try {
      const found = await detectPrintersNow();
      const hwCount = found.filter((p) => p.source === 'webusb' || p.source === 'webserial').length;
      showFeedback(
        hwCount > 0
          ? `Detección completada: ${hwCount} impresora(s) USB/Serie activa(s) y ${found.length} perfiles listos para imprimir.`
          : 'Detección completada: Impresoras del Sistema (Epson, HP, Canon, Láser y Térmicas) listas para imprimir.'
      );
    } catch (err: any) {
      showError(err?.message || 'Error al escanear impresoras conectadas.');
    }
  };

  const handlePairUsb = async () => {
    try {
      const paired = await pairUsbPrinter();
      if (paired) {
        setDefaultReceiptPrinter(paired.name);
        setPaperSize(paired.paperSize);
        showFeedback(`Impresora USB "${paired.name}" conectada y cargada automáticamente.`);
      }
    } catch (err: any) {
      showError(err?.message || 'No se pudo vincular la impresora USB directamente.');
    }
  };

  const handlePairSerial = async () => {
    try {
      const paired = await pairSerialPrinter();
      if (paired) {
        setDefaultReceiptPrinter(paired.name);
        setPaperSize(paired.paperSize);
        showFeedback(`Impresora serie "${paired.name}" vinculada correctamente.`);
      }
    } catch (err: any) {
      showError(err?.message || 'No se pudo vincular el puerto serie.');
    }
  };

  const handleAddCustomPrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPrinterName.trim()) {
      showError('Ingresa el nombre o modelo de la impresora (ej. Epson L3250 o Epson TM-T20III).');
      return;
    }
    try {
      await addCustomNetworkPrinter(customPrinterName, customPrinterPaper, customPrinterConn);
      setDefaultReceiptPrinter(customPrinterName.trim());
      setPaperSize(customPrinterPaper);
      setCustomPrinterName('');
      showFeedback('Impresora guardada y seleccionada automáticamente en el sistema.');
    } catch (err: any) {
      showError(err?.message || 'Error al guardar la impresora.');
    }
  };

  // Restrict to Owner
  if (!isOwner) {
    return (
      <div className="p-12 text-center bg-white rounded-3xl border border-gray-200 max-w-xl mx-auto my-12 text-gray-900 shadow-xl">
        <div className="w-16 h-16 rounded-3xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 mx-auto mb-4">
          <Lock className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-black text-gray-900">Módulo Restringido</h3>
        <p className="text-xs text-gray-600 mt-2 leading-relaxed">
          El módulo de <strong className="text-gray-900">Configuración del Sistema e Impresoras</strong> está reservado exclusivamente para el rol <strong className="text-[#D97706]">PROPIETARIO</strong> de GASTROLAB.
        </p>
        <div className="mt-6 p-3 rounded-2xl bg-gray-50 border border-gray-200 text-xs text-gray-500">
          Tu rol activo actual es: <span className="font-bold text-gray-900 uppercase">{translateRoleToSpanish(userProfile?.role)}</span>
        </div>
      </div>
    );
  }

  // Mandatory Owner Personal Password Prompt (Point 14)
  if (!isUnlocked) {
    return (
      <div className="max-w-md mx-auto my-10 bg-white border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-xl text-[#1F2937]">
        <div className="w-14 h-14 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] mx-auto mb-4">
          <ShieldCheck className="w-7 h-7 text-[#D97706]" />
        </div>
        <h3 className="text-lg font-black text-center text-[#1F2937]">
          Verificación de Seguridad — Configuración
        </h3>
        <p className="text-xs text-[#4B5563] text-center mt-1.5 leading-relaxed">
          Esta sección sensible solo puede abrirse confirmando la contraseña personal del <strong className="text-[#4A5D23]">Propietario</strong>.
        </p>

        {unlockError && (
          <div className="mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="font-semibold">{unlockError}</span>
          </div>
        )}

        <form onSubmit={handleUnlockSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#1F2937] mb-1.5">
              Contraseña o PIN del Propietario
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showUnlockPassword ? 'text' : 'password'}
                autoFocus
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                placeholder="Ingresa tu contraseña de Propietario..."
                className="w-full bg-[#F8F9FA] border border-gray-300 focus:bg-white focus:border-[#4A5D23] rounded-2xl pl-10 pr-10 py-3 text-sm font-mono text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors"
              />
              <button
                type="button"
                tabIndex={-1}
                data-skip-enter="true"
                onClick={() => setShowUnlockPassword((prev) => !prev)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                {showUnlockPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isVerifyingUnlock}
            className="w-full py-3 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer active:scale-95"
          >
            <Lock className="w-4 h-4 text-[#D97706]" />
            {isVerifyingUnlock ? 'Verificando...' : 'Desbloquear Configuración'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-gray-900">
      <UpdateButton />
      {/* Top Header Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
            <Settings className="w-6 h-6 text-[#E89E2D]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-[#4A5D23]">Configuración del Sistema</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#E89E2D]/20 text-[#4A5D23] border border-[#E89E2D]/50">
                Solo Propietario
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Identidad comercial, RUC, sucursales, IVA global %, Food Cost % e impresoras térmicas ESC/POS
            </p>
          </div>
        </div>

        {/* Sub-tab selection */}
        <div className="flex items-center gap-1.5 bg-gray-50 p-1.5 rounded-2xl border border-gray-200">
          <button
            type="button"
            onClick={() => setActiveSubTab('general')}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
              activeSubTab === 'general'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Sliders className="w-4 h-4 text-[#E89E2D]" />
            General y Local
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('impresoras')}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
              activeSubTab === 'impresoras'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Printer className="w-4 h-4 text-[#E89E2D]" />
            Impresoras
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span className="font-bold">{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs text-rose-700 hover:text-rose-900 font-bold ml-3 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Success Banner */}
      {saveSuccessMsg && (
        <div className="p-4 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-xs flex items-center justify-between shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-[#E89E2D]" />
            <span className="font-bold">{saveSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveSuccessMsg(null)}
            className="text-xs text-[#E89E2D] hover:text-[#4A5D23] font-bold ml-3 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Auto-Save Resilience Status Card (Point 16) */}
      <div className="bg-[#EAF5F0] border border-[#4A5D23]/25 rounded-2xl px-4 py-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-[#4A5D23] font-bold">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Auto-guardado instantáneo activo en memoria local y nube</span>
        </div>
        {autoSavedAt && (
          <span className="font-mono text-[11px] text-[#4A5D23] font-bold">
            Sincronizado {autoSavedAt}
          </span>
        )}
      </div>

      {/* SUB-TAB 1: GENERAL & LOCAL */}
      {activeSubTab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Form Fields */}
          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-3xl p-6 shadow-sm space-y-6">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2 border-b border-gray-200 pb-3">
              <Building className="w-4 h-4 text-[#E89E2D]" />
              Identidad del Establecimiento y Parámetros Globales
            </h3>

            <form onSubmit={handleSaveGeneralSettings} className="space-y-5">
              {/* 1. Nombre del Local (Reordered) */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5 text-[#E89E2D]" />
                  1. Nombre Comercial del Establecimiento <span className="text-rose-500">*</span>
                </label>
                  <input
                  type="text"
                  required
                  value={localName}
                  onChange={(e) => {
                    markDirty();
                    setLocalName(e.target.value);
                  }}
                  placeholder="Nombre comercial"
                  className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-2xl px-4 py-3 text-sm font-bold text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#4A5D23] transition-colors"
                />
              </div>

              {/* 2. Slogan del Local (Reordered) */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                  2. Slogan del Local
                </label>
                <input
                  type="text"
                  value={slogan}
                  onChange={(e) => {
                    markDirty();
                    setSlogan(e.target.value);
                  }}
                  placeholder="Ej. Gastronomía Molecular y Cocina de Autor"
                  className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-2xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#4A5D23] transition-colors"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Se muestra debajo del logotipo en la cabecera del sistema y en los tickets de comanda.
                </p>
              </div>

              {/* 3. RUC, Dirección y Establecimiento */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                    <FileCheck className="w-3.5 h-3.5 text-[#E89E2D]" />
                    RUC del Establecimiento
                  </label>
                  <input
                    type="text"
                    value={ruc}
                    onChange={(e) => {
                      markDirty();
                      setRuc(e.target.value);
                    }}
                    placeholder="RUC de 13 dígitos"
                    className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-2xl px-4 py-2.5 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#E89E2D]" />
                    Dirección Matriz
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => {
                      markDirty();
                      setAddress(e.target.value);
                    }}
                    placeholder="Ej. Av. República de El Salvador"
                    className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-2xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-[#E89E2D]" />
                    Establecimiento
                  </label>
                  <input
                    type="text"
                    value={mainEstablishment}
                    onChange={(e) => {
                      markDirty();
                      setMainEstablishment(e.target.value);
                    }}
                    placeholder="Ej. Matriz 001"
                    className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-2xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
              </div>

              {/* 4. Multisucursal (Sucursales e intercambio de configuración) */}
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                    Multisucursal (hasta {MAX_BRANCHES}, incluida la Matriz)
                  </label>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/20">
                    {branches.length}/{MAX_BRANCHES} Registradas
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {branches.map((b) => (
                    <span
                      key={b}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-800 shadow-2xs"
                    >
                      <Building className="w-3.5 h-3.5 text-[#E89E2D]" />
                      {b}
                      {b !== 'Matriz' && (
                        <button
                          type="button"
                          onClick={() => handleRemoveBranch(b)}
                          className="text-gray-400 hover:text-rose-600 cursor-pointer ml-1"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={branches.length >= MAX_BRANCHES}
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder={branches.length >= MAX_BRANCHES ? 'Límite de sucursales alcanzado' : 'Nueva sucursal (ej. Sucursal 1)...'}
                    className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#4A5D23] disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={branches.length >= MAX_BRANCHES}
                    onClick={handleAddBranch}
                    className="px-3.5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#E89E2D]" />
                    Agregar
                  </button>
                </div>

                {/* Exportar / Importar Menú y Configuración entre Matriz y Sucursal */}
                <div className="pt-2 border-t border-gray-200 flex flex-col sm:flex-row gap-2">
                  <input
                    type="file"
                    ref={importFileRef}
                    accept="application/json,.json"
                    onChange={handleImportMenuAndConfig}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={handleExportMenuAndConfig}
                    className="flex-1 py-2 px-3 rounded-xl bg-white hover:bg-gray-100 border border-[#4A5D23]/30 text-[#4A5D23] text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#D97706]" />
                    Exportar Menú/Configuración
                  </button>
                  <button
                    type="button"
                    onClick={() => importFileRef.current?.click()}
                    className="flex-1 py-2 px-3 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#D97706]" />
                    Importar en Sucursal
                  </button>
                </div>
              </div>

              {/* Grid 2 Cols: IVA % Sistema + Food Cost % */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-1">
                {/* IVA % Sistema */}
                <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#4A5D23] flex items-center gap-1.5">
                      <Percent className="w-3.5 h-3.5 text-[#E89E2D]" />
                      IVA % Sistema
                    </label>
                    <span className="text-[10px] text-emerald-700 font-bold bg-[#EAF5F0] px-2 py-0.5 rounded-full border border-emerald-200">
                      Global
                    </span>
                  </div>
                  <div className="relative mt-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={ivaPercentage}
                      onChange={(e) => {
                        markDirty();
                        setIvaPercentage(e.target.value);
                      }}
                      placeholder="15"
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-base font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 font-mono font-bold">
                      %
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-2">
                    Al guardar, este IVA se aplica a la emisión fiscal y caja en todo el sistema.
                  </p>
                </div>

                {/* Food Cost % */}
                <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#4A5D23] flex items-center gap-1.5">
                      <Percent className="w-3.5 h-3.5 text-[#E89E2D]" />
                      Food Cost %
                    </label>
                    <span className="text-[10px] text-gray-500 font-mono">Meta</span>
                  </div>
                  <div className="relative mt-2">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      value={foodCostPercentage}
                      onChange={(e) => {
                        markDirty();
                        setFoodCostPercentage(e.target.value);
                      }}
                      placeholder="30"
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-base font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 font-mono font-bold">
                      %
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-2">
                    Margen de costo objetivo utilizado para los cálculos de rentabilidad de recetas.
                  </p>
                </div>
              </div>

              {/* Auto-guardado automático en segundo plano (Point 16) */}
              <div className="pt-3 flex items-center justify-between text-xs text-[#4B5563] border-t border-gray-100">
                <span className="flex items-center gap-1.5 font-semibold text-[#4A5D23]">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Los cambios se guardan automáticamente al escribir
                </span>
                {autoSavedAt && (
                  <span className="font-mono text-[11px] text-gray-500">Último respaldo: {autoSavedAt}</span>
                )}
              </div>
            </form>
          </div>

          {/* Right Column: Logo Upload & Visual Live Preview */}
          <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-6">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2 border-b border-gray-200 pb-3 mb-4">
                <ImageIcon className="w-4 h-4 text-[#E89E2D]" />
                Logotipo del Establecimiento
              </h3>

              {/* Logo Preview Container */}
              <div className="p-6 rounded-2xl bg-gray-50 border border-gray-200 flex flex-col items-center text-center">
                <div className="w-32 h-32 rounded-2xl bg-white border-2 border-[#4A5D23]/30 p-2 flex items-center justify-center shadow-xs relative group overflow-hidden">
                  <img
                    src={logoUrl}
                    alt="Logo del Local"
                    className="max-h-full max-w-full object-contain rounded-xl"
                  />
                </div>

                <div className="mt-3">
                  <span className="text-sm font-bold text-gray-900 block">
                    {localName || 'GASTROLAB'}
                  </span>
                  <span className="text-[11px] font-semibold text-[#4A5D23] block mt-0.5 max-w-[200px] truncate">
                    {slogan || 'Slogan del Local'}
                  </span>
                </div>
              </div>

              {/* File Input for Logo Upload */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleLogoUpload}
                accept="image/*"
                className="hidden"
              />

              <div className="mt-4 space-y-2.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="w-full py-3 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] border border-[#4A5D23] text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs active:scale-95"
                >
                  <Upload className="w-4 h-4 text-[#E89E2D]" />
                  Subir Logotipo del Local
                </button>

                <button
                  type="button"
                  onClick={handleResetLogo}
                  className="w-full py-2.5 rounded-2xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 hover:text-gray-900 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#E89E2D]" />
                  Restablecer a Logo Oficial
                </button>
              </div>

              <div className="mt-4 p-3 rounded-xl bg-gray-50 border border-gray-200 text-[11px] text-gray-500 leading-normal">
                <strong className="text-gray-900">Auto-Centrado y Ajuste:</strong> Al cargar una imagen, se procesa automáticamente para mantener nitidez en la cabecera y en los tickets de comanda.
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
              <span>Resolución sugerida:</span>
              <span className="font-mono text-[#4A5D23] font-bold">500 x 500 px</span>
            </div>
          </div>

          {/* Zona de Mantenimiento Crítico (Solo Propietario) */}
          <div className="lg:col-span-3 bg-white border border-rose-200 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-rose-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900">
                    Mantenimiento y Limpieza del Sistema
                  </h3>
                  <p className="text-xs text-gray-500">
                    Acciones críticas protegidas exclusivamente con la contraseña del Propietario.
                  </p>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 self-start sm:self-center">
                Exclusivo Propietario
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 1. Encerar sistema */}
              <div className="p-4 rounded-2xl bg-rose-50/40 border border-rose-200 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-black text-rose-900">
                    <DatabaseZap className="w-4 h-4 text-rose-600" />
                    Encerar sistema
                  </div>
                  <p className="text-[11px] text-gray-600 mt-1.5 leading-relaxed">
                    Reinicia por completo pedidos, ventas, turnos, inventario, recetas, carta, clientes y proveedores. Conserva tu cuenta de Propietario, licencia y configuración del local.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDangerAction('encerar_sistema');
                    setDangerPassword('');
                    setDangerError(null);
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
                >
                  <DatabaseZap className="w-4 h-4" />
                  Encerar sistema
                </button>
              </div>

              {/* 2. Borrar inventario */}
              <div className="p-4 rounded-2xl bg-amber-50/40 border border-amber-200 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-black text-amber-900">
                    <Eraser className="w-4 h-4 text-[#D97706]" />
                    Borrar inventario
                  </div>
                  <p className="text-[11px] text-gray-600 mt-1.5 leading-relaxed">
                    Elimina todos los ingredientes, insumos y auditorías de conteo físico del inventario para comenzar una carga nueva desde cero.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDangerAction('borrar_inventario');
                    setDangerPassword('');
                    setDangerError(null);
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#D97706] hover:bg-amber-700 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
                >
                  <Eraser className="w-4 h-4" />
                  Borrar inventario
                </button>
              </div>

              {/* 3. Borrar registros */}
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-black text-gray-900">
                    <Trash2 className="w-4 h-4 text-rose-600" />
                    Borrar registros
                  </div>
                  <p className="text-[11px] text-gray-600 mt-1.5 leading-relaxed">
                    Borra comandas, facturas SRI, compras, movimientos de caja, kardex, mermas y reservas. Mantiene intactos tu carta, recetas e inventario.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDangerAction('borrar_registros');
                    setDangerPassword('');
                    setDangerError(null);
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-gray-900 hover:bg-black text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
                >
                  <Trash2 className="w-4 h-4 text-rose-400" />
                  Borrar registros
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: IMPRESORAS */}
      {activeSubTab === 'impresoras' && (
        <div className="space-y-6">
          {/* Detection Bar */}
          <div className="p-6 rounded-3xl bg-white border border-gray-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Printer className="w-5 h-5 text-[#E89E2D]" />
                Detección Automática de Impresoras (Normal Epson/HP y Térmicas)
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Al conectar cualquier impresora USB, Red o del Sistema (Epson normal A4, Láser o Térmica 58/80mm), GASTROLAB la carga y adapta el formato automáticamente.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleDetectPrinters}
                disabled={isScanningPrinters}
                className="px-4 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] border border-[#4A5D23] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-xs active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 text-[#E89E2D] ${isScanningPrinters ? 'animate-spin' : ''}`} />
                {isScanningPrinters ? 'Detectando...' : 'Detectar Impresoras'}
              </button>

              <button
                type="button"
                onClick={handlePairUsb}
                className="px-3.5 py-2.5 rounded-2xl bg-[#EAF5F0] hover:bg-[#d8ede3] border border-[#4A5D23]/30 text-[#4A5D23] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                title="Autorizar conexión USB directa ESC/POS"
              >
                <Plus className="w-4 h-4 text-[#E89E2D]" />
                Vincular USB
              </button>

              <button
                type="button"
                onClick={handlePairSerial}
                className="px-3.5 py-2.5 rounded-2xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                title="Vincular impresora por puerto Serie / COM"
              >
                <Sliders className="w-3.5 h-3.5 text-[#E89E2D]" />
                Puerto Serie
              </button>

              <button
                type="button"
                onClick={() => setTestPrintModalOpen(true)}
                className="px-4 py-2.5 rounded-2xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-800 hover:text-black text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-colors cursor-pointer"
              >
                <FileText className="w-4 h-4 text-[#E89E2D]" />
                Prueba de Impresión
              </button>
            </div>
          </div>

          {hardwareStatusBanner && (
            <div className="p-3.5 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{hardwareStatusBanner}</span>
            </div>
          )}

          {/* OS-style PC Installed Printer Dropdown Selector */}
          <div className="p-5 rounded-3xl bg-white border border-gray-200 shadow-sm grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            <div className="md:col-span-5">
              <label
                htmlFor="pc-printer-selector"
                className="block text-xs font-bold uppercase tracking-wider text-[#4A5D23]"
              >
                Impresora Instalada en el Sistema (PC / Driver)
              </label>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Selecciona rápidamente la impresora conectada para Tickets, Comandas y RIDE.
              </p>
            </div>
            <div className="md:col-span-7 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <select
                id="pc-printer-selector"
                value={defaultReceiptPrinter}
                onChange={(e) => {
                  const chosenName = e.target.value;
                  const chosen = detectedPrinters.find((pr) => pr.name === chosenName);
                  const nextPaper = chosen?.paperSize || paperSize;
                  markDirty();
                  setDefaultReceiptPrinter(chosenName);
                  setPaperSize(nextPaper);
                  setDoc(
                    doc(db, 'settings', 'general'),
                    {
                      receiptPrinter: chosenName,
                      paperSize: nextPaper,
                      updatedAt: new Date().toISOString(),
                    },
                    { merge: true }
                  )
                    .then(() =>
                      showFeedback(
                        `Impresora "${chosenName}" (${nextPaper}) seleccionada y guardada.`
                      )
                    )
                    .catch(() => {});
                }}
                className="flex-1 bg-gray-50 border border-gray-300 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3.5 py-2.5 text-xs font-bold text-gray-900 focus:outline-none cursor-pointer"
              >
                {detectedPrinters.map((pr) => (
                  <option key={pr.id} value={pr.name}>
                    {pr.name} — ({pr.paperSize} · {pr.connection})
                  </option>
                ))}
                {!detectedPrinters.some((pr) => pr.name === defaultReceiptPrinter) &&
                  defaultReceiptPrinter && (
                    <option value={defaultReceiptPrinter}>{defaultReceiptPrinter}</option>
                  )}
              </select>
              <span className="px-3 py-2 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/25 text-[#4A5D23] text-[11px] font-mono font-bold text-center shrink-0">
                Papel: {paperSize}
              </span>
            </div>
          </div>

          {/* Connected Printers Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {detectedPrinters.map((p) => {
              const isDefaultRec = defaultReceiptPrinter === p.name;
              const isDefaultRep = defaultReportPrinter === p.name;
              return (
                <div
                  key={p.id}
                  className={`p-5 rounded-3xl bg-white border transition-all ${
                    isDefaultRec || isDefaultRep
                      ? 'border-[#E89E2D] shadow-md ring-1 ring-[#E89E2D]/40'
                      : 'border-gray-200 shadow-xs'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                      <Printer className="w-5 h-5 text-[#E89E2D]" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        {p.id.startsWith('drv-')
                          ? 'Driver PC / Sistema'
                          : p.source === 'system_spooler'
                          ? 'Auto / Sistema'
                          : `En línea (${p.connection})`}
                      </span>
                      {p.source === 'custom_network' && (
                        <button
                          type="button"
                          onClick={() => removeCustomPrinter(p.id)}
                          className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 cursor-pointer"
                          title="Eliminar impresora personalizada"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <h4 className="font-bold text-gray-900 text-sm mb-1">{p.name}</h4>
                  <div className="text-xs text-gray-500 mb-4 font-mono">
                    Formato: {p.paperSize} · {p.supportsEscPos ? 'ESC/POS Directo + Sistema' : 'Spooler Universal'}
                  </div>

                  <div className="pt-3 border-t border-gray-200 space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        markDirty();
                        setDefaultReceiptPrinter(p.name);
                        setPaperSize(p.paperSize);
                        setDoc(
                          doc(db, 'settings', 'general'),
                          { receiptPrinter: p.name, paperSize: p.paperSize, updatedAt: new Date().toISOString() },
                          { merge: true }
                        ).then(() => showFeedback(`Impresora "${p.name}" fijada para Facturas / RIDE y Tickets.`));
                      }}
                      className={`w-full py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                        isDefaultRec
                          ? 'bg-[#4A5D23] text-white border border-[#4A5D23]'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Receipt className="w-3.5 h-3.5 text-[#E89E2D]" />
                        Predeterminada Facturas / RIDE
                      </span>
                      {isDefaultRec && <Check className="w-4 h-4 text-[#E89E2D]" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        markDirty();
                        setDefaultReportPrinter(p.name);
                        setDoc(
                          doc(db, 'settings', 'general'),
                          { reportsPrinter: p.name, updatedAt: new Date().toISOString() },
                          { merge: true }
                        ).then(() => showFeedback(`Impresora "${p.name}" fijada para Reportes y Hojas.`));
                      }}
                      className={`w-full py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                        isDefaultRep
                          ? 'bg-[#4A5D23] text-white border border-[#4A5D23]'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <FileSpreadsheet className="w-3.5 h-3.5 text-[#E89E2D]" />
                        Predeterminada Reportes
                      </span>
                      {isDefaultRep && <Check className="w-4 h-4 text-[#E89E2D]" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Register Network / Named Local Printer */}
          <form
            onSubmit={handleAddCustomPrinter}
            className="p-5 rounded-3xl bg-white border border-gray-200 shadow-sm space-y-3"
          >
            <div className="text-xs font-bold uppercase tracking-wider text-[#4A5D23]">
              Registrar Impresora Adicional (Epson Normal, Wi-Fi, Ethernet o Bluetooth)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <input
                type="text"
                placeholder="Ej. Epson L3250 Oficina o Térmica Barra 80mm"
                value={customPrinterName}
                onChange={(e) => setCustomPrinterName(e.target.value)}
                className="sm:col-span-5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23]"
              />
              <select
                value={customPrinterPaper}
                onChange={(e) => setCustomPrinterPaper(e.target.value as PaperFormat)}
                className="sm:col-span-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-900 focus:outline-none"
              >
                <option value="A4">Formato A4 / Carta (Normal)</option>
                <option value="80mm">Térmica 80mm</option>
                <option value="58mm">Térmica 58mm</option>
              </select>
              <select
                value={customPrinterConn}
                onChange={(e) => setCustomPrinterConn(e.target.value as any)}
                className="sm:col-span-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-900 focus:outline-none"
              >
                <option value="Red / Ethernet">Red / Wi-Fi</option>
                <option value="USB">USB</option>
                <option value="Bluetooth">Bluetooth</option>
              </select>
              <button
                type="submit"
                className="sm:col-span-2 px-4 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold cursor-pointer"
              >
                + Agregar
              </button>
            </div>
          </form>

          {/* Hardware Configuration Options */}
          <div className="p-6 rounded-3xl bg-white border border-gray-200 shadow-sm space-y-5">
            <h4 className="text-sm font-bold uppercase tracking-wider text-[#4A5D23] border-b border-gray-200 pb-3">
              Opciones de Salida Térmica y Corte
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Paper width */}
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200">
                <label className="block text-xs font-bold text-gray-900 mb-2">
                  Tamaño de Papel
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: '58mm', label: '58mm' },
                    { value: '80mm', label: '80mm' },
                    { value: 'A4', label: 'A4' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        markDirty();
                        setPaperSize(opt.value);
                        setDoc(
                          doc(db, 'settings', 'general'),
                          { paperSize: opt.value, updatedAt: new Date().toISOString() },
                          { merge: true }
                        ).catch(() => {});
                      }}
                      className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                        paperSize === opt.value
                          ? 'bg-[#4A5D23] border-[#4A5D23] text-white'
                          : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto Cut */}
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-gray-900">
                    Corte Automático
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {autoCut
                      ? 'Activo: envía comando ESC/POS de corte al finalizar la impresión.'
                      : 'Inactivo: imprime todo el texto completo sin comando de corte.'}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoCut}
                  onClick={() => {
                    const nextCut = !autoCut;
                    markDirty();
                    setAutoCut(nextCut);
                    setDoc(
                      doc(db, 'settings', 'general'),
                      { autoCut: nextCut, updatedAt: new Date().toISOString() },
                      { merge: true }
                    ).catch(() => {});
                  }}
                  aria-label="Corte Automático"
                  className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                    autoCut ? 'bg-[#4A5D23]' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      autoCut ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleSaveGeneralSettings()}
                className="px-6 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] border border-[#4A5D23] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4 text-[#E89E2D]" />
                {isSaving ? 'Guardando...' : 'Guardar Configuración de Impresoras'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOTÓN VISIBLE DE RESTABLECIMIENTO DE FÁBRICA AL FINAL DE CONFIGURACIÓN */}
      <div className="bg-rose-50 border-2 border-rose-500 rounded-3xl p-6 shadow-md space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-red-900 uppercase tracking-tight">
                Restablecimiento de Fábrica
              </h3>
              <p className="text-xs text-red-800 mt-0.5 leading-relaxed max-w-2xl">
                Prepara el sistema desde cero para entrega o venta final. Elimina todos los productos, ventas, inventario, clientes, configuraciones y usuarios registrados de Firestore y cierra la sesión actual.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setFactoryResetPassword('');
              setFactoryResetError(null);
              setShowFactoryResetPassword(false);
              setFactoryResetStep('password');
            }}
            className="w-full md:w-auto px-6 py-4 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white text-xs sm:text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2.5 shadow-lg shadow-red-600/30 transition-all cursor-pointer shrink-0 border-2 border-red-800"
          >
            <Trash2 className="w-5 h-5" />
            RESTABLECER SISTEMA (BORRAR TODO)
          </button>
        </div>
      </div>

      {/* Test Print Simulated Modal */}
      {testPrintModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl text-gray-900">
            <div className="text-center pb-4 border-b border-gray-200">
              <div className="w-10 h-10 rounded-2xl bg-[#EAF5F0] text-[#4A5D23] flex items-center justify-center mx-auto mb-2">
                <Printer className="w-5 h-5 text-[#E89E2D]" />
              </div>
              <h4 className="font-bold text-base text-gray-900">Ticket de Prueba ESC/POS</h4>
              <p className="text-xs text-gray-500">Impresora: {defaultReceiptPrinter}</p>
            </div>

            {/* Simulated Receipt Preview */}
            <div className="my-4 p-4 rounded-xl bg-gray-50 text-black font-mono text-[11px] shadow-inner space-y-2 border border-gray-200">
              <div className="text-center font-bold text-xs uppercase tracking-wider">
                {localName}
              </div>
              <div className="text-center text-[10px] text-gray-600 italic">
                {slogan}
              </div>
              <div className="text-center text-[9px] text-gray-500">
                RUC: {ruc} · {address}
              </div>
              <div className="border-t border-dashed border-gray-300 my-1" />
              <div className="flex justify-between">
                <span>Fecha: {new Date().toLocaleDateString('es-EC')}</span>
                <span>Hora: {new Date().toLocaleTimeString('es-EC')}</span>
              </div>
              <div className="border-t border-dashed border-gray-300 my-1" />
              <div className="flex justify-between font-bold">
                <span>1x Lomo Fino Demi-Glace</span>
                <span>$18.50</span>
              </div>
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>$18.50</span>
              </div>
              <div className="flex justify-between">
                <span>IVA ({ivaPercentage.trim() === '' ? 15 : (parseFloat(ivaPercentage) || 0)}%):</span>
                <span>${((18.5 * (ivaPercentage.trim() === '' ? 15 : (parseFloat(ivaPercentage) || 0))) / 100).toFixed(2)}</span>
              </div>
              <div className="border-t border-black pt-1 flex justify-between font-black text-xs">
                <span>TOTAL A PAGAR:</span>
                <span>${(18.5 * (1 + (ivaPercentage.trim() === '' ? 15 : (parseFloat(ivaPercentage) || 0)) / 100)).toFixed(2)}</span>
              </div>
              <div className="border-t border-dashed border-gray-300 my-1" />
              <div className="text-center text-[9px] text-gray-600">
                ¡Gracias por su visita a {localName}!
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTestPrintModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs font-bold transition-colors cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                disabled={isPrinting}
                onClick={async () => {
                  await printTestTicket(paperSize);
                  setTestPrintModalOpen(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                {isPrinting ? 'Imprimiendo...' : 'Imprimir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Danger Zone Owner Confirmation Modal */}
      {dangerAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => !isExecutingDanger && setDangerAction(null)}
        >
          <div
            className="w-full max-w-md bg-white border-2 border-rose-300 rounded-3xl p-6 shadow-2xl text-gray-900 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 pb-3 border-b border-gray-200">
              <div className="w-11 h-11 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-base font-black text-gray-900">
                  {dangerAction === 'encerar_sistema'
                    ? 'Confirmar: Encerar sistema'
                    : dangerAction === 'borrar_inventario'
                    ? 'Confirmar: Borrar inventario'
                    : 'Confirmar: Borrar registros'}
                </h4>
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600">
                  Acción Irreversible · Solo Propietario
                </span>
              </div>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              {dangerAction === 'encerar_sistema'
                ? 'Esta acción eliminará TODOS los datos operativos, catálogo, carta, recetas e inventario. Solo conservarás tu usuario Propietario, licencia y configuración general.'
                : dangerAction === 'borrar_inventario'
                ? 'Esta acción eliminará permanentemente todos los productos del inventario y sus registros de conteo físico.'
                : 'Esta acción eliminará el historial de comandas, facturas SRI, compras, caja, kardex, mermas y reservas.'}
            </p>

            {dangerError && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{dangerError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmDangerAction} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-800 mb-1.5">
                  Contraseña del Propietario *
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showDangerPassword ? 'text' : 'password'}
                    autoFocus
                    required
                    value={dangerPassword}
                    onChange={(e) => setDangerPassword(e.target.value)}
                    placeholder="Ingresa tu clave de Propietario..."
                    className="w-full bg-gray-50 border border-gray-300 focus:bg-white focus:border-rose-500 rounded-2xl pl-10 pr-10 py-2.5 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    data-skip-enter="true"
                    onClick={() => setShowDangerPassword((p) => !p)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
                  >
                    {showDangerPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  disabled={isExecutingDanger}
                  onClick={() => setDangerAction(null)}
                  className="flex-1 py-2.5 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isExecutingDanger}
                  className="flex-1 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
                >
                  {isExecutingDanger ? 'Procesando...' : 'Sí, Ejecutar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Factory Reset Step 1 & Step 2 Modals */}
      {factoryResetStep !== 'closed' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => !isVerifyingFactoryResetPass && !isExecutingFactoryReset && setFactoryResetStep('closed')}
        >
          <div
            className="w-full max-w-md bg-white border-2 border-red-500 rounded-3xl p-6 shadow-2xl text-gray-900 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {factoryResetStep === 'password' ? (
              <>
                <div className="flex items-center gap-3 pb-3 border-b border-red-100">
                  <div className="w-11 h-11 rounded-2xl bg-red-100 border border-red-300 flex items-center justify-center text-red-600 shrink-0">
                    <Lock className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-base font-black text-gray-900">
                      Autorización de Propietario
                    </h4>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-red-600">
                      Restablecimiento de Fábrica · Paso 1 de 2
                    </span>
                  </div>
                </div>

                <p className="text-xs text-gray-600 leading-relaxed">
                  Para continuar con <strong className="text-red-700">RESTABLECER SISTEMA (BORRAR TODO)</strong>, ingresa la contraseña personal del Propietario.
                </p>

                {factoryResetError && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{factoryResetError}</span>
                  </div>
                )}

                <form onSubmit={handleVerifyFactoryResetPassword} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-800 mb-1.5">
                      Contraseña del Propietario *
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showFactoryResetPassword ? 'text' : 'password'}
                        autoFocus
                        required
                        value={factoryResetPassword}
                        onChange={(e) => setFactoryResetPassword(e.target.value)}
                        placeholder="Ingresa la contraseña del Propietario..."
                        className="w-full bg-gray-50 border border-gray-300 focus:bg-white focus:border-red-500 rounded-2xl pl-10 pr-10 py-2.5 text-sm font-mono text-gray-900 placeholder-gray-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        data-skip-enter="true"
                        onClick={() => setShowFactoryResetPassword((p) => !p)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
                      >
                        {showFactoryResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      disabled={isVerifyingFactoryResetPass}
                      onClick={() => setFactoryResetStep('closed')}
                      className="flex-1 py-2.5 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isVerifyingFactoryResetPass}
                      className="flex-1 py-2.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
                    >
                      {isVerifyingFactoryResetPass ? 'Verificando...' : 'Continuar'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 pb-3 border-b border-red-200">
                  <div className="w-12 h-12 rounded-2xl bg-red-600 text-white flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="text-base font-black text-red-700 uppercase">
                      Alerta Crítica · Paso 2 de 2
                    </h4>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                      Confirmación Final Requerida
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-red-50 border border-red-300 text-red-900 text-sm font-bold leading-relaxed">
                  ¿ESTÁS SEGURO? Se borrarán todos los productos, ventas, usuarios y configuraciones. Esta acción no se puede deshacer.
                </div>

                {factoryResetError && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{factoryResetError}</span>
                  </div>
                )}

                {isExecutingFactoryReset && factoryResetProgress && (
                  <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-amber-600 animate-spin shrink-0" />
                    <span>{factoryResetProgress}</span>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    disabled={isExecutingFactoryReset}
                    onClick={() => {
                      setFactoryResetStep('closed');
                      setFactoryResetPassword('');
                      setFactoryResetError(null);
                    }}
                    className="flex-1 py-3 rounded-2xl bg-gray-200 hover:bg-gray-300 text-gray-900 text-sm font-black uppercase tracking-wider cursor-pointer disabled:opacity-50"
                  >
                    NO
                  </button>
                  <button
                    type="button"
                    disabled={isExecutingFactoryReset}
                    onClick={handleExecuteFactoryReset}
                    className="flex-1 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-black uppercase tracking-wider cursor-pointer disabled:opacity-50 shadow-lg shadow-red-600/30"
                  >
                    {isExecutingFactoryReset ? 'Borrando...' : 'SI'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
