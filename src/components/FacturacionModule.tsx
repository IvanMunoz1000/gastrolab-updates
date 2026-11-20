import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe, getDocsOfflineSafe } from '../utils/offlineFirestore';
import { Order } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { usePrinter } from '../context/PrinterContext';
import { PaperFormat } from '../utils/printerService';
import { ElectronicInvoiceRecord, generateClaveDeAcceso } from '../utils/sriHelpers';
import { RidePrintDocument } from './RidePrintDocument';
import {
  Receipt,
  Search,
  CheckCircle2,
  Plus,
  Wifi,
  WifiOff,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  X,
  Printer,
  Copy,
  Check,
  Send,
  Eye,
} from 'lucide-react';

export const FacturacionModule: React.FC = () => {
  const {
    storeSettings,
    activeReceiptPrinter,
    printRideInvoice,
    printThermalReceipt,
    isPrinting,
    hardwareStatusBanner,
  } = usePrinter();

  const { activeBranch } = useBranch();
  const [rawOrders, setRawOrders] = useState<Order[]>([]);
  const [rawInvoices, setRawInvoices] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [ivaRate, setIvaRate] = useState(15);
  const [rucEmisor, setRucEmisor] = useState('');

  const orders = useMemo(
    () => rawOrders.filter((o) => belongsToBranch(o.branch, activeBranch)),
    [rawOrders, activeBranch]
  );
  const invoices = useMemo(
    () => rawInvoices.filter((inv) => belongsToBranch(inv.branch, activeBranch)),
    [rawInvoices, activeBranch]
  );

  // Modal Emitir Factura Electrónica
  const [isEmitModalOpen, setIsEmitModalOpen] = useState(false);
  const [clientDocType, setClientDocType] = useState<'RUC' | 'Cédula' | 'Pasaporte' | 'Consumidor Final'>('Cédula');
  const [clientDocNumber, setClientDocNumber] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientFoundMessage, setClientFoundMessage] = useState<string | null>(null);
  const [clientsByDocMap, setClientsByDocMap] = useState<
    Map<string, { name?: string; email?: string; address?: string; phone?: string; docType?: string }>
  >(new Map());
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Efectivo' | 'Tarjeta de Débito' | 'Tarjeta de Crédito' | 'Transferencia'>('Tarjeta de Débito');

  // Submitting / Result / Reprint State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<ElectronicInvoiceRecord | null>(null);
  const [reprintPreviewInvoice, setReprintPreviewInvoice] = useState<ElectronicInvoiceRecord | null>(null);
  const [selectedPrintFormat, setSelectedPrintFormat] = useState<PaperFormat>(storeSettings.paperSize || 'A4');
  const [copiedKey, setCopiedKey] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [sriFeedback, setSriFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const debouncedSearch = useDebouncedValue(searchQuery, 150);

  const syncingRef = useRef(false);
  const submittingRef = useRef(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invoicesRef = useRef<any[]>([]);

  useEffect(() => {
    setSelectedPrintFormat(storeSettings.paperSize || 'A4');
  }, [storeSettings.paperSize]);

  useEffect(() => {
    invoicesRef.current = invoices;
  }, [invoices]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const showFeedback = useCallback((type: 'success' | 'error', text: string) => {
    setSriFeedback({ type, text });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setSriFeedback((prev) => (prev?.text === text ? null : prev));
    }, 5000);
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleSyncSingleInvoice = async (invoiceId: string) => {
    try {
      await commitOfflineSafe(
        updateDoc(doc(db, 'electronic_invoices', invoiceId), {
          status: 'AUTORIZADO',
          sriAuthorizationDate: new Date().toISOString(),
        }),
        'sync_single_invoice'
      );
      showFeedback('success', 'Factura transmitida y autorizada exitosamente por el SRI.');
    } catch (err: any) {
      showFeedback('error', 'Error al sincronizar con SRI: ' + (err?.message || 'Error desconocido'));
    }
  };

  const handleSyncAllOffline = useCallback(
    async (silentIfEmpty = false) => {
      const pending = invoicesRef.current.filter((i) => i.status === 'PENDIENTE_ENVIO_OFFLINE');
      if (pending.length === 0) {
        if (!silentIfEmpty) {
          showFeedback('success', 'No hay facturas pendientes de envío.');
        }
        return;
      }
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        const now = new Date().toISOString();
        let batch = writeBatch(db);
        let count = 0;
        for (const inv of pending) {
          batch.update(doc(db, 'electronic_invoices', inv.id), {
            status: 'AUTORIZADO',
            sriAuthorizationDate: now,
          });
          count += 1;
          if (count >= 400) {
            await commitOfflineSafe(batch.commit(), 'sync_offline_invoices_chunk');
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) {
          await commitOfflineSafe(batch.commit(), 'sync_offline_invoices_final');
        }
        showFeedback(
          'success',
          `${pending.length} factura(s) emitida(s) sin internet sincronizada(s) automáticamente con el SRI.`
        );
      } catch (err: any) {
        showFeedback('error', 'Error al sincronizar facturas pendientes: ' + (err?.message || 'Error'));
      } finally {
        syncingRef.current = false;
      }
    },
    [showFeedback]
  );

  const pendingOfflineCount = useMemo(
    () => invoices.filter((i) => i.status === 'PENDIENTE_ENVIO_OFFLINE').length,
    [invoices]
  );

  // Auto-sync pending offline invoices as soon as internet connectivity is restored
  useEffect(() => {
    if (!isOnline || pendingOfflineCount === 0) return;
    handleSyncAllOffline(true);
  }, [isOnline, pendingOfflineCount, handleSyncAllOffline]);

  useEffect(() => {
    const qOrders = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsubOrders = onSnapshot(
      qOrders,
      (snap) => {
        const list: Order[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as Order));
        setRawOrders(list);
      },
      (err) => console.warn('Facturacion orders listener notice:', err)
    );

    const qInvoices = query(collection(db, 'electronic_invoices'), orderBy('createdAt', 'desc'));
    const unsubInvoices = onSnapshot(
      qInvoices,
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setRawInvoices(list);
      },
      (err) => console.warn('Facturacion invoices listener notice:', err)
    );

    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'general'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.ivaPercentage !== undefined) setIvaRate(Number(data.ivaPercentage));
          setRucEmisor(data.ruc ?? '');
        }
      },
      (err) => console.warn('Facturacion settings listener notice:', err)
    );

    return () => {
      unsubOrders();
      unsubInvoices();
      unsubSettings();
    };
  }, []);

  // Generate authentic 49-digit Modulo-11 SRI Clave de Acceso using current RUC
  const buildClaveDeAcceso = (secuencial: string): string => {
    return generateClaveDeAcceso(secuencial, rucEmisor || storeSettings.ruc);
  };

  // Live subscription to clients catalog when Emitir Factura modal is open
  useEffect(() => {
    if (!isEmitModalOpen) return;
    const unsub = onSnapshot(
      collection(db, 'clients'),
      (snap) => {
        const nextMap = new Map<
          string,
          { name?: string; email?: string; address?: string; phone?: string; docType?: string }
        >();
        snap.forEach((d) => {
          const data = d.data() as any;
          const docNum = String(data?.docNumber || '').trim();
          if (docNum) {
            nextMap.set(docNum, {
              name: data.name || '',
              email: data.email || '',
              address: data.address || '',
              phone: data.phone || '',
              docType: data.docType || '',
            });
          }
        });
        setClientsByDocMap(nextMap);
      },
      (err) => console.warn('Facturacion clients listener notice:', err)
    );
    return () => unsub();
  }, [isEmitModalOpen]);

  const handleClientDocChange = (val: string) => {
    setClientDocNumber(val);
    const cleanDoc = val.trim();
    if (!cleanDoc) {
      setClientFoundMessage(null);
      return;
    }
    const matched = clientsByDocMap.get(cleanDoc);
    if (matched) {
      setClientName(matched.name || '');
      setClientEmail(matched.email || '');
      setClientPhone(matched.phone || '');
      setClientAddress(matched.address || '');
      setClientFoundMessage(`✓ Cliente encontrado: ${matched.name || cleanDoc}`);
    } else {
      setClientFoundMessage(null);
    }
  };

  const handleClientDocBlur = async () => {
    const cleanDoc = clientDocNumber.trim();
    if (cleanDoc.length < 5 || clientDocType === 'Consumidor Final') return;

    const cached = clientsByDocMap.get(cleanDoc);
    if (cached) {
      setClientName(cached.name || '');
      setClientEmail(cached.email || '');
      setClientPhone(cached.phone || '');
      setClientAddress(cached.address || '');
      setClientFoundMessage(`✓ Cliente encontrado: ${cached.name || cleanDoc}`);
      return;
    }

    try {
      const q = query(collection(db, 'clients'), where('docNumber', '==', cleanDoc));
      const snap = await getDocsOfflineSafe(q);
      if (!snap.empty) {
        const data = snap.docs[0].data() as any;
        setClientName(data.name || '');
        setClientEmail(data.email || '');
        setClientPhone(data.phone || '');
        setClientAddress(data.address || '');
        setClientFoundMessage(`✓ Cliente encontrado: ${data.name || cleanDoc}`);
      }
    } catch (err) {
      console.warn('Notice querying client in Facturacion:', err);
    }
  };

  const handleOpenEmitModal = () => {
    setClientDocType('Cédula');
    setClientDocNumber('');
    setClientName('');
    setClientEmail('');
    setClientPhone('');
    setClientAddress('');
    setClientFoundMessage(null);
    setSelectedOrderId('');
    setManualDescription('');
    setManualAmount('');
    setCreatedInvoice(null);
    setIsEmitModalOpen(true);
  };

  const handleEmitInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || isSubmitting) return;

    if (clientDocType !== 'Consumidor Final') {
      if (!clientDocNumber.trim()) {
        showFeedback('error', 'Ingresa el número de Cédula, RUC o Pasaporte del cliente.');
        return;
      }
      if (!clientName.trim()) {
        showFeedback('error', 'Ingresa el Nombre o Razón Social del cliente.');
        return;
      }
    }

    if (!selectedOrderId && !manualDescription.trim()) {
      showFeedback('error', 'Ingresa el concepto o detalle de la factura.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      let totalAmount = 0;
      let itemsList: any[] = [];
      let refTitle = 'Consumo General';

      if (selectedOrderId) {
        const order = orders.find((o) => o.id === selectedOrderId);
        if (order) {
          totalAmount = Number(order.total) || 0;
          itemsList = order.items || [];
          refTitle = `Mesa ${order.tableNumber}`;
        }
      } else {
        totalAmount = parseFloat(manualAmount) || 0;
        itemsList = [{ name: manualDescription.trim(), quantity: 1, price: totalAmount }];
      }

      if (totalAmount <= 0 || !isFinite(totalAmount)) {
        showFeedback('error', 'Por favor ingresa un monto válido mayor a $0.00 para la factura.');
        return;
      }

      const safeIva = isFinite(ivaRate) && ivaRate >= 0 ? ivaRate : 15;
      const subtotal = totalAmount / (1 + safeIva / 100);
      const iva = totalAmount - subtotal;
      const nextSeq = String(invoices.length + 1001).padStart(9, '0');
      const invoiceNumber = `001-001-${nextSeq}`;
      const isConsumidorFinal = clientDocType === 'Consumidor Final';
      const claveAcceso = isConsumidorFinal
        ? `TICKET-INTERNO-${nextSeq}`
        : buildClaveDeAcceso(nextSeq);
      const now = new Date().toISOString();

      const newInv: ElectronicInvoiceRecord & { branch: string } = {
        invoiceNumber,
        claveAcceso,
        date: now,
        status: isConsumidorFinal
          ? 'TICKET_INTERNO'
          : !isOnline
          ? 'PENDIENTE_ENVIO_OFFLINE'
          : 'AUTORIZADO',
        isInternalTicket: isConsumidorFinal,
        sriAuthorizationNumber: isConsumidorFinal ? '' : claveAcceso,
        sriAuthorizationDate: isConsumidorFinal ? null : !isOnline ? null : now,
        client: {
          docType: clientDocType,
          docNumber: isConsumidorFinal ? '9999999999999' : clientDocNumber.trim(),
          name: isConsumidorFinal ? 'CONSUMIDOR FINAL' : clientName.trim(),
          email: clientEmail.trim(),
          phone: clientPhone.trim(),
          address: clientAddress.trim(),
        },
        reference: refTitle,
        paymentMethod,
        subtotal,
        ivaRate: safeIva,
        ivaAmount: iva,
        total: totalAmount,
        items: itemsList,
        branch: activeBranch,
        createdAt: now,
      };

      const docRef = doc(collection(db, 'electronic_invoices'));
      await commitOfflineSafe(setDoc(docRef, newInv), 'emit_electronic_invoice');

      // Also save client in background if new so future invoices & checkouts autocomplete immediately
      if (!isConsumidorFinal && clientDocNumber.trim() && clientName.trim()) {
        const docNumClean = clientDocNumber.trim();
        const docTypeClean = clientDocType;
        const nameClean = clientName.trim();
        const emailClean = clientEmail.trim();
        const phoneClean = clientPhone.trim();
        const addressClean = clientAddress.trim();
        void (async () => {
          try {
            const qCheck = query(collection(db, 'clients'), where('docNumber', '==', docNumClean));
            const existingSnap = await getDocsOfflineSafe(qCheck);
            if (existingSnap.empty) {
              const clientRef = doc(collection(db, 'clients'));
              await commitOfflineSafe(
                setDoc(clientRef, {
                  docType: docTypeClean,
                  docNumber: docNumClean,
                  name: nameClean,
                  email: emailClean,
                  phone: phoneClean,
                  address: addressClean,
                  createdAt: new Date().toISOString(),
                }),
                'create_client_from_facturacion'
              );
            }
          } catch (e) {
            console.warn('Notice saving client from Facturacion:', e);
          }
        })();
      }

      setCreatedInvoice({ id: docRef.id, ...newInv });
    } catch (err: any) {
      console.error('Error al emitir factura electrónica:', err);
      showFeedback('error', 'Error al emitir factura electrónica: ' + (err?.message || 'Error'));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopiedKey(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopiedKey(false), 2000);
      }
    } catch {
      showFeedback('error', 'No se pudo copiar la clave al portapapeles en este navegador.');
    }
  };

  const { totalInvoiced, totalIvaCollected, totalSubtotalNet } = useMemo(() => {
    const total = orders.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
    const safeIva = isFinite(ivaRate) && ivaRate >= 0 ? ivaRate : 15;
    const iva = total - total / (1 + safeIva / 100);
    return {
      totalInvoiced: total,
      totalIvaCollected: iva,
      totalSubtotalNet: total - iva,
    };
  }, [orders, ivaRate]);

  const filteredInvoices = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      return (
        (inv.invoiceNumber || '').toLowerCase().includes(q) ||
        (inv.claveAcceso || '').toLowerCase().includes(q) ||
        (inv.client?.name || '').toLowerCase().includes(q) ||
        (inv.client?.docNumber || '').toLowerCase().includes(q)
      );
    });
  }, [invoices, debouncedSearch]);

  const visibleInvoices = useMemo(
    () => (showAllInvoices ? filteredInvoices : filteredInvoices.slice(0, 50)),
    [filteredInvoices, showAllInvoices]
  );

  return (
    <div className="space-y-6 text-gray-900">
      {/* Top Header Card */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
            <Receipt className="w-6 h-6 text-[#E89E2D]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-[#4A5D23]">Facturación Electrónica SRI</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                SRI Producción
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Emisión de comprobantes autorizados con Clave de Acceso de 49 dígitos, RUC {rucEmisor} e IVA {ivaRate}%
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="px-3 py-2 rounded-2xl bg-gray-50 border border-gray-200 text-[11px] flex items-center gap-2">
            <Printer className="w-3.5 h-3.5 text-[#4A5D23]" />
            <span className="font-semibold text-gray-700 truncate max-w-[200px]">
              {activeReceiptPrinter.name}
            </span>
            <span className="px-1.5 py-0.5 rounded-md bg-[#EAF5F0] text-[#4A5D23] font-mono font-bold text-[10px]">
              {selectedPrintFormat}
            </span>
          </div>

          <button
            type="button"
            onClick={handleOpenEmitModal}
            className="px-5 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-xs transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#E89E2D]" />
            Emitir Factura Electrónica
          </button>
        </div>
      </div>

      {hardwareStatusBanner && (
        <div className="p-3 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-xs font-bold flex items-center gap-2">
          <Printer className="w-4 h-4 text-[#E89E2D] shrink-0" />
          <span>{hardwareStatusBanner}</span>
        </div>
      )}

      {/* In-UI Feedback Banner */}
      {sriFeedback && (
        <div
          className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-xs font-bold ${
            sriFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-rose-50 border-rose-300 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {sriFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{sriFeedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setSriFeedback(null)}
            className="p-1 rounded-lg hover:bg-black/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* SRI Online / Offline Auto-Connection Live Status Banner */}
      <div className={`bg-white border rounded-3xl p-4.5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 ${!isOnline ? 'border-rose-300 bg-rose-50/40' : 'border-emerald-200'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 ${!isOnline ? 'bg-rose-100 border-rose-300 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
            {!isOnline ? <WifiOff className="w-5 h-5 animate-pulse" /> : <Wifi className="w-5 h-5 animate-pulse" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-gray-900 uppercase tracking-wider">
                {!isOnline ? 'Sin Conexión a Internet (Modo Offline)' : 'Conexión en línea con SRI'}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${!isOnline ? 'bg-rose-600 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
                {!isOnline ? 'OFFLINE' : 'PRODUCCIÓN'}
              </span>
            </div>
            <p className="text-[11px] text-gray-500">
              {!isOnline
                ? 'Las ventas siguen guardándose localmente. Las facturas emitidas quedarán en rojo como "Pendiente SRI" hasta recuperar conexión.'
                : <>Web Service SRI: <span className="font-mono text-gray-700">celcer.sri.gob.ec</span> · Certificado Digital: <strong className="text-emerald-700">Válido y Activo</strong></>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {pendingOfflineCount > 0 && isOnline && (
            <button
              type="button"
              onClick={() => handleSyncAllOffline(false)}
              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Enviar Pendientes al SRI ({pendingOfflineCount})
            </button>
          )}
          <div className="p-2 px-3 rounded-xl bg-gray-50 border border-gray-200 font-mono text-gray-700">
            RUC: <strong className="text-gray-900">{rucEmisor}</strong>
          </div>
          <div className={`flex items-center gap-1.5 font-bold px-3 py-1.5 rounded-xl border ${!isOnline ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>
            <ShieldCheck className="w-4 h-4" />
            <span>{!isOnline ? 'RESPALDO LOCAL ACTIVO' : 'AUTORIZACIÓN AUTOMÁTICA'}</span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-3xl bg-white border border-gray-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Total Facturado (Bruto)
          </span>
          <div className="mt-2 text-2xl font-black font-mono text-gray-900">
            ${totalInvoiced.toFixed(2)}
          </div>
          <span className="text-[11px] text-gray-400 mt-1">{orders.length} comprobantes procesados</span>
        </div>

        <div className="p-5 rounded-3xl bg-white border border-gray-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Base Imponible (Subtotal Neto)
          </span>
          <div className="mt-2 text-2xl font-black font-mono text-[#4A5D23]">
            ${totalSubtotalNet.toFixed(2)}
          </div>
          <span className="text-[11px] text-gray-400 mt-1">Sin impuestos</span>
        </div>

        <div className="p-5 rounded-3xl bg-white border border-gray-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-[#E89E2D]">
            IVA Recaudado ({ivaRate}%)
          </span>
          <div className="mt-2 text-2xl font-black font-mono text-[#E89E2D]">
            ${totalIvaCollected.toFixed(2)}
          </div>
          <span className="text-[11px] text-gray-400 mt-1">Crédito fiscal generado</span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por N° factura, clave de acceso o cliente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
          />
        </div>

        <span className="text-xs text-gray-500 font-mono">
          Formato SRI XML + RIDE · Módulo 11 Validado
        </span>
      </div>

      {/* Invoices Table */}
      <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-600 uppercase tracking-wider border-b border-gray-200 font-semibold text-[11px]">
              <tr>
                <th className="p-3.5">N° Factura</th>
                <th className="p-3.5">Cliente / RUC</th>
                <th className="p-3.5">Clave de Acceso (49 dígitos)</th>
                <th className="p-3.5 text-right">Subtotal</th>
                <th className="p-3.5 text-right">IVA ({ivaRate}%)</th>
                <th className="p-3.5 text-right">Total ($)</th>
                <th className="p-3.5 text-center">Estado SRI</th>
                <th className="p-3.5 text-center">Documento Físico</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-400">
                    No se registran facturas electrónicas emitidas. Haz clic en "Emitir Factura Electrónica" para autorizar una nueva factura.
                  </td>
                </tr>
              ) : (
                visibleInvoices.map((inv) => {
                  const isOfflinePending = inv.status === 'PENDIENTE_ENVIO_OFFLINE';
                  const isInternal = Boolean(inv.isInternalTicket) || inv.status === 'TICKET_INTERNO';
                  return (
                    <tr
                      key={inv.id}
                      className={`transition-colors ${
                        isOfflinePending
                          ? 'bg-rose-50/90 hover:bg-rose-100/70 border-l-4 border-l-rose-600'
                          : isInternal
                          ? 'bg-amber-50/30 hover:bg-amber-50/60 border-l-4 border-l-[#E89E2D]'
                          : 'hover:bg-emerald-50/30 border-l-4 border-l-emerald-500'
                      }`}
                    >
                      <td
                        className={`p-3.5 font-mono font-bold whitespace-nowrap ${
                          isOfflinePending ? 'text-rose-900' : 'text-gray-900'
                        }`}
                      >
                        {inv.invoiceNumber}
                      </td>
                      <td className="p-3.5">
                        <div className={`font-bold ${isOfflinePending ? 'text-rose-900' : 'text-gray-900'}`}>
                          {inv.client?.name || 'CONSUMIDOR FINAL'}
                        </div>
                        <div className="text-[10px] text-gray-500 font-mono">
                          {inv.client?.docType || 'RUC/CI'}: {inv.client?.docNumber || '9999999999999'}
                        </div>
                      </td>
                      <td className="p-3.5 max-w-xs">
                        {isInternal ? (
                          <div className="text-[10px] font-semibold text-amber-900 bg-amber-50 px-2 py-1.5 rounded-lg border border-amber-200">
                            Documento interno — Consumidor Final (No enviado al SRI)
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 font-mono text-[10px] text-gray-600 bg-white/80 p-1.5 rounded-lg border border-gray-200">
                            <span className="truncate">{inv.claveAcceso}</span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(inv.claveAcceso)}
                              className="text-gray-400 hover:text-gray-900 cursor-pointer shrink-0"
                              title="Copiar clave de acceso"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="p-3.5 text-right font-mono text-gray-600 whitespace-nowrap">
                        ${(Number(inv.subtotal) || 0).toFixed(2)}
                      </td>
                      <td className="p-3.5 text-right font-mono text-[#E89E2D] font-bold whitespace-nowrap">
                        ${(Number(inv.ivaAmount) || 0).toFixed(2)}
                      </td>
                      <td
                        className={`p-3.5 text-right font-mono font-black text-sm whitespace-nowrap ${
                          isOfflinePending ? 'text-rose-700' : 'text-gray-900'
                        }`}
                      >
                        ${(Number(inv.total) || 0).toFixed(2)}
                      </td>
                      <td className="p-3.5 text-center whitespace-nowrap">
                        {isOfflinePending ? (
                          <div className="inline-flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-black bg-rose-600 text-white border border-rose-700 shadow-xs">
                              <AlertTriangle className="w-3.5 h-3.5 text-white shrink-0" />
                              Pendiente SRI
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSyncSingleInvoice(inv.id)}
                              className="p-1.5 rounded-lg bg-white hover:bg-[#4A5D23] hover:text-white text-rose-700 border border-rose-300 text-[10px] font-bold cursor-pointer transition-colors"
                              title="Reintentar transmisión al SRI ahora"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : isInternal ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-300">
                            TICKET INTERNO · SIN SRI
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            AUTORIZADO SRI
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isPrinting}
                            onClick={() => {
                              if (isInternal && selectedPrintFormat !== 'A4') {
                                void printThermalReceipt(
                                  {
                                    title: 'REIMPRESIÓN — TICKET INTERNO',
                                    tableLabel: inv.reference || 'VENTA LOCAL',
                                    isDomicilio: String(inv.reference || '').toUpperCase().includes('DOMICILIO'),
                                    clientName: inv.client?.name || 'CONSUMIDOR FINAL',
                                    clientId: inv.client?.docNumber || '9999999999999',
                                    items: inv.items || [],
                                    subtotal: Number(inv.subtotal) || 0,
                                    discountAmount: Number(inv.discountAmount) || 0,
                                    ivaRate: Number(inv.ivaRate) || ivaRate,
                                    ivaAmount: Number(inv.ivaAmount) || 0,
                                    total: Number(inv.total) || 0,
                                    paymentMethod: inv.paymentMethod || 'Efectivo',
                                    invoiceNumber: inv.invoiceNumber,
                                    footerNote: 'Reimpresión de documento interno — Sin envío al SRI',
                                  },
                                  selectedPrintFormat
                                );
                              } else {
                                void printRideInvoice(inv, {
                                  formatOverride: selectedPrintFormat,
                                  isReprint: true,
                                });
                              }
                            }}
                            className="px-3 py-1.5 rounded-xl bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white border border-[#4A5D23]/30 text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                            title={
                              isInternal
                                ? 'Reimprimir ticket interno (Consumidor Final)'
                                : 'Reimprimir documento físico (No vuelve a emitir al SRI)'
                            }
                          >
                            <Printer className="w-3.5 h-3.5 text-[#E89E2D]" />
                            Reimprimir
                          </button>
                          <button
                            type="button"
                            onClick={() => setReprintPreviewInvoice(inv)}
                            className="p-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200 transition-colors cursor-pointer"
                            title="Ver documento y elegir formato de impresora (A4 / 80mm / 58mm)"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredInvoices.length > 50 && (
          <div className="pt-3 mt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>
              Mostrando {visibleInvoices.length} de {filteredInvoices.length} comprobantes
            </span>
            <button
              type="button"
              onClick={() => setShowAllInvoices((prev) => !prev)}
              className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold cursor-pointer"
            >
              {showAllInvoices ? 'Mostrar últimos 50' : `Ver todos (${filteredInvoices.length})`}
            </button>
          </div>
        )}
      </div>

      {/* Modal: Emitir Factura Electrónica a Cliente */}
      {isEmitModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto text-gray-900">
          <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-3xl shadow-2xl p-5 sm:p-7 relative max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <Receipt className="w-5 h-5 text-[#E89E2D]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Emitir Factura Electrónica a Cliente</h3>
                  <p className="text-xs text-gray-500">Conexión directa SRI · Generación de Clave de Acceso 49 dígitos</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEmitModalOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createdInvoice ? (
              /* Success Card (SRI Authorized vs Consumidor Final Ticket Interno) */
              (() => {
                const isCreatedInternal =
                  Boolean(createdInvoice.isInternalTicket) ||
                  createdInvoice.status === 'TICKET_INTERNO';
                return (
                  <div className="space-y-4 py-4 overflow-y-auto">
                    <div
                      className={`p-4 rounded-2xl border flex items-center gap-3 ${
                        isCreatedInternal
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-emerald-50 border-emerald-200'
                      }`}
                    >
                      <CheckCircle2
                        className={`w-7 h-7 shrink-0 ${
                          isCreatedInternal ? 'text-[#E89E2D]' : 'text-emerald-600'
                        }`}
                      />
                      <div>
                        <h4
                          className={`font-bold text-sm ${
                            isCreatedInternal ? 'text-amber-950' : 'text-emerald-900'
                          }`}
                        >
                          {isCreatedInternal
                            ? '¡Ticket Interno Registrado (Consumidor Final)!'
                            : '¡Factura Autorizada por el SRI!'}
                        </h4>
                        <p
                          className={`text-xs ${
                            isCreatedInternal ? 'text-amber-800' : 'text-emerald-700'
                          }`}
                        >
                          {isCreatedInternal
                            ? 'Guardado en historial del local sin envío al SRI. Listo para imprimir ticket físico.'
                            : 'Comprobante transmitido y validado exitosamente en el servidor tributario.'}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-3 text-xs">
                      <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                        <span className="font-bold text-gray-700">
                          {isCreatedInternal ? 'N° Ticket Interno:' : 'N° Factura:'}
                        </span>
                        <span className="font-mono font-black text-gray-900 text-sm">
                          {createdInvoice.invoiceNumber}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                        <span className="font-bold text-gray-700">Cliente:</span>
                        <span className="font-semibold text-gray-900">
                          {createdInvoice.client?.name}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                        <span className="font-bold text-gray-700">Monto Total:</span>
                        <span className="font-mono font-black text-emerald-700 text-base">
                          ${createdInvoice.total.toFixed(2)}
                        </span>
                      </div>
                      {!isCreatedInternal && (
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-bold text-gray-700">
                              Clave de Acceso (49 dígitos):
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(createdInvoice.claveAcceso)}
                              className="text-xs text-[#4A5D23] hover:underline font-bold flex items-center gap-1 cursor-pointer"
                            >
                              {copiedKey ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              {copiedKey ? '¡Copiado!' : 'Copiar Clave'}
                            </button>
                          </div>
                          <div className="p-2.5 rounded-xl bg-white border border-gray-300 font-mono text-[11px] text-gray-800 break-all select-all">
                            {createdInvoice.claveAcceso}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 text-gray-700 font-semibold">
                        <Printer className="w-4 h-4 text-[#4A5D23]" />
                        <span>Formato de impresión:</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {(['A4', '80mm', '58mm'] as const).map((fmt) => (
                          <button
                            key={fmt}
                            type="button"
                            onClick={() => setSelectedPrintFormat(fmt)}
                            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] border cursor-pointer transition-colors ${
                              selectedPrintFormat === fmt
                                ? 'bg-[#4A5D23] text-white border-[#4A5D23]'
                                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            {fmt === 'A4' ? 'A4 / Normal' : `Térmica ${fmt}`}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        disabled={isPrinting}
                        onClick={() => {
                          if (!createdInvoice) return;
                          if (isCreatedInternal && selectedPrintFormat !== 'A4') {
                            void printThermalReceipt(
                              {
                                title: 'TICKET DE VENTA — CONSUMIDOR FINAL',
                                tableLabel: createdInvoice.reference || 'VENTA LOCAL',
                                clientName: 'CONSUMIDOR FINAL',
                                clientId: '9999999999999',
                                items: createdInvoice.items as any,
                                subtotal: createdInvoice.subtotal,
                                ivaRate: createdInvoice.ivaRate,
                                ivaAmount: createdInvoice.ivaAmount,
                                total: createdInvoice.total,
                                paymentMethod: createdInvoice.paymentMethod,
                                invoiceNumber: createdInvoice.invoiceNumber,
                                footerNote: 'Documento interno del local — Sin envío SRI',
                              },
                              selectedPrintFormat
                            );
                          } else {
                            void printRideInvoice(createdInvoice, {
                              formatOverride: selectedPrintFormat,
                              isReprint: false,
                            });
                          }
                        }}
                        className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Printer className="w-4 h-4 text-[#E89E2D]" />
                        {isPrinting
                          ? 'Imprimiendo...'
                          : isCreatedInternal
                          ? 'Imprimir Ticket Interno'
                          : 'Imprimir RIDE'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEmitModalOpen(false)}
                        className="px-6 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold cursor-pointer"
                      >
                        Aceptar y Cerrar
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : (
              <form noValidate onSubmit={handleEmitInvoice} className="flex-1 overflow-y-auto space-y-4 pt-4 pr-1">
                {/* Client Ident Type */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                      Tipo de Identificación
                    </label>
                    <select
                      value={clientDocType}
                      onChange={(e) => setClientDocType(e.target.value as any)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-900 focus:outline-none"
                    >
                      <option value="Cédula">Cédula de Identidad</option>
                      <option value="RUC">RUC</option>
                      <option value="Pasaporte">Pasaporte</option>
                      <option value="Consumidor Final">Consumidor Final</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                      N° Documento / RUC {clientDocType !== 'Consumidor Final' && <span className="text-rose-500">*</span>}
                    </label>
                    <input
                      type="text"
                      disabled={clientDocType === 'Consumidor Final'}
                      required={clientDocType !== 'Consumidor Final'}
                      placeholder={clientDocType === 'Consumidor Final' ? '9999999999999' : 'Escribe RUC o Cédula para autocompletar...'}
                      value={clientDocType === 'Consumidor Final' ? '9999999999999' : clientDocNumber}
                      onChange={(e) => handleClientDocChange(e.target.value)}
                      onBlur={handleClientDocBlur}
                      className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-xl px-3 py-2 text-xs font-mono text-gray-900 placeholder-gray-400 focus:outline-none disabled:opacity-60"
                    />
                    {clientFoundMessage && clientDocType !== 'Consumidor Final' && (
                      <p className="text-[10px] text-emerald-700 font-bold mt-1">{clientFoundMessage}</p>
                    )}
                  </div>
                </div>

                {/* Client Name & Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                      Razón Social / Nombres <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      disabled={clientDocType === 'Consumidor Final'}
                      placeholder={clientDocType === 'Consumidor Final' ? 'CONSUMIDOR FINAL' : 'Nombres o Razón Social...'}
                      value={clientDocType === 'Consumidor Final' ? 'CONSUMIDOR FINAL' : clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                      Correo Electrónico (para XML y RIDE)
                    </label>
                    <input
                      type="email"
                      disabled={clientDocType === 'Consumidor Final'}
                      placeholder="cliente@correo.com"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none disabled:opacity-60"
                    />
                  </div>
                </div>

                {/* Client Phone & Address */}
                {clientDocType !== 'Consumidor Final' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                        Contacto / Teléfono
                      </label>
                      <input
                        type="tel"
                        placeholder="Teléfono / WhatsApp..."
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                        Dirección
                      </label>
                      <input
                        type="text"
                        placeholder="Dirección del cliente..."
                        value={clientAddress}
                        onChange={(e) => setClientAddress(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {/* Comanda / Origen de Facturación */}
                <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-3">
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700">
                    Origen de la Venta a Facturar
                  </label>
                  <select
                    value={selectedOrderId}
                    onChange={(e) => setSelectedOrderId(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-900 focus:outline-none cursor-pointer"
                  >
                    <option value="">Ingreso Manual de Monto / Consumo</option>
                    {orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        Mesa {o.tableNumber} — Total: ${(o.total || 0).toFixed(2)} ({o.items?.length || 0} ítems)
                      </option>
                    ))}
                  </select>

                  {!selectedOrderId && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-600 mb-1">Concepto / Detalle</label>
                        <input
                          type="text"
                          required
                          value={manualDescription}
                          onChange={(e) => setManualDescription(e.target.value)}
                          placeholder="Ej. Consumo de Alimentos y Bebidas"
                          className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-600 mb-1">Total a Facturar ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          value={manualAmount}
                          onChange={(e) => setManualAmount(e.target.value)}
                          placeholder="$ 0.00"
                          className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-900 focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Forma de Pago */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                    Forma de Pago SRI
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-900 focus:outline-none"
                  >
                    <option value="Efectivo">01 - Sin Utilización del Sistema Financiero (Efectivo)</option>
                    <option value="Tarjeta de Débito">16 - Tarjeta de Débito</option>
                    <option value="Tarjeta de Crédito">19 - Tarjeta de Crédito</option>
                    <option value="Transferencia">20 - Otros con Utilización del Sistema Financiero (Transferencia)</option>
                  </select>
                </div>

                <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setIsEmitModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-6 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
                  >
                    <Send className="w-4 h-4 text-[#E89E2D]" />
                    {isSubmitting ? 'Transmitiendo al SRI...' : 'Autorizar y Emitir Comprobante'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal: Reimpresión Física de RIDE / Ticket Interno (Sin Reenvío al SRI) */}
      {reprintPreviewInvoice && (() => {
        const isPreviewInternal =
          Boolean(reprintPreviewInvoice.isInternalTicket) ||
          reprintPreviewInvoice.status === 'TICKET_INTERNO';
        return (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto text-gray-900"
          onClick={() => setReprintPreviewInvoice(null)}
        >
          <div
            className="w-full max-w-4xl bg-white border border-gray-200 rounded-3xl shadow-2xl p-5 sm:p-6 relative max-h-[94vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <Printer className="w-5 h-5 text-[#E89E2D]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    {isPreviewInternal
                      ? `Reimprimir Ticket Interno — ${reprintPreviewInvoice.invoiceNumber}`
                      : `Reimprimir Documento Físico — Factura ${reprintPreviewInvoice.invoiceNumber}`}
                  </h3>
                  <p className="text-xs text-emerald-700 font-semibold">
                    {isPreviewInternal
                      ? 'Copia física únicamente · Ticket de Consumidor Final (No emitido ni reenviado al SRI)'
                      : 'Copia física únicamente · Comprobante ya emitido electrónicamente al SRI (no se re-transmite)'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReprintPreviewInvoice(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Format selector + Active printer banner */}
            <div className="my-3 p-3 rounded-2xl bg-gray-50 border border-gray-200 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-700">Impresora activa:</span>
                <span className="font-mono text-[#4A5D23] font-bold">{activeReceiptPrinter.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {(['A4', '80mm', '58mm'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setSelectedPrintFormat(fmt)}
                    className={`px-3 py-1 rounded-xl font-bold text-xs border cursor-pointer transition-colors ${
                      selectedPrintFormat === fmt
                        ? 'bg-[#4A5D23] text-white border-[#4A5D23]'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {fmt === 'A4' ? 'A4 / Normal (Epson/HP)' : `Térmica ${fmt}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Crisp Visual Preview of Exact Physical Document */}
            <div className="flex-1 overflow-y-auto bg-gray-100 p-4 rounded-2xl border border-gray-200">
              <div className="bg-white shadow-md rounded-xl overflow-hidden mx-auto w-fit max-w-full">
                <RidePrintDocument
                  invoice={reprintPreviewInvoice}
                  store={storeSettings}
                  format={selectedPrintFormat}
                  isReprint={true}
                  autoCut={storeSettings.autoCut}
                />
              </div>
            </div>

            <div className="pt-4 mt-3 border-t border-gray-200 flex items-center justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setReprintPreviewInvoice(null)}
                className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                disabled={isPrinting}
                onClick={() => {
                  if (isPreviewInternal && selectedPrintFormat !== 'A4') {
                    void printThermalReceipt(
                      {
                        title: 'REIMPRESIÓN — TICKET INTERNO',
                        tableLabel: reprintPreviewInvoice.reference || 'VENTA LOCAL',
                        isDomicilio: String(reprintPreviewInvoice.reference || '').toUpperCase().includes('DOMICILIO'),
                        clientName: reprintPreviewInvoice.client?.name || 'CONSUMIDOR FINAL',
                        clientId: reprintPreviewInvoice.client?.docNumber || '9999999999999',
                        items: reprintPreviewInvoice.items as any,
                        subtotal: Number(reprintPreviewInvoice.subtotal) || 0,
                        discountAmount: Number(reprintPreviewInvoice.discountAmount) || 0,
                        ivaRate: Number(reprintPreviewInvoice.ivaRate) || ivaRate,
                        ivaAmount: Number(reprintPreviewInvoice.ivaAmount) || 0,
                        total: Number(reprintPreviewInvoice.total) || 0,
                        paymentMethod: reprintPreviewInvoice.paymentMethod || 'Efectivo',
                        invoiceNumber: reprintPreviewInvoice.invoiceNumber,
                        footerNote: 'Reimpresión de documento interno — Sin envío al SRI',
                      },
                      selectedPrintFormat
                    );
                  } else {
                    void printRideInvoice(reprintPreviewInvoice, {
                      formatOverride: selectedPrintFormat,
                      isReprint: true,
                    });
                  }
                }}
                className="px-6 py-2.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-4 h-4 text-[#E89E2D]" />
                {isPrinting
                  ? 'Imprimiendo...'
                  : isPreviewInternal
                  ? 'Reimprimir Ticket Interno'
                  : 'Imprimir Duplicado Físico (RIDE)'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
};
