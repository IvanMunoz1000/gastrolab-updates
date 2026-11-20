import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, where, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getDocsOfflineSafe, commitOfflineSafe } from '../utils/offlineFirestore';
import { OrderItem, RestaurantTable } from '../types';
import { usePrinter } from '../context/PrinterContext';
import { PaperFormat } from '../utils/printerService';
import { ElectronicInvoiceRecord, generateClaveDeAcceso } from '../utils/sriHelpers';
import {
  X,
  Printer,
  Receipt,
  CreditCard,
  Smartphone,
  Banknote,
  CheckCircle2,
  User,
  Building,
  Check,
  Percent,
  Gift,
  Users,
  Wifi,
  QrCode,
  AlertCircle,
  Plus,
  Minus,
  Copy,
  DollarSign,
} from 'lucide-react';
import { broadcastCustomerDisplay } from '../utils/customerDisplayChannel';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  table: RestaurantTable;
  items: OrderItem[];
  total: number;
  onConfirmPayment: (paymentData: {
    method: 'Efectivo' | 'Transferencia' | 'De Una' | 'Tarjeta';
    receivedAmount: number;
    changeAmount: number;
    clientName: string;
    clientId: string;
    clientEmail?: string;
    clientAddress?: string;
    clientPhone?: string;
    discountPercent?: number;
    isCourtesy?: boolean;
    tipAmount?: number;
    splitParts?: number;
    chargedItems?: OrderItem[];
    chargedTotal?: number;
    isCustomPartial?: boolean;
  }) => Promise<{ invoice: ElectronicInvoiceRecord; isFullSettlement: boolean } | void>;
}

export const CobroModal: React.FC<Props> = ({
  isOpen,
  onClose,
  table,
  items,
  total: initialTotal,
  onConfirmPayment,
}) => {
  const { storeSettings, activeReceiptPrinter, printRideInvoice, printThermalReceipt, isPrinting } =
    usePrinter();

  // Modal Navigation: Cobro Directo vs Facturación SRI
  const [activeTab, setActiveTab] = useState<'COBRO' | 'FACTURACION'>('COBRO');

  const isUnifiedGroup =
    table.tableNumber > 0 && (table.mergedTableNumbers?.length || 0) > 1;
  const cobroTableLabel =
    table.tableNumber === 0
      ? 'DOMICILIO'
      : isUnifiedGroup
      ? `Mesas ${(table.mergedTableNumbers || []).slice().sort((a, b) => a - b).join(' + ')}`
      : `Mesa ${table.tableNumber}`;

  // Payment Method: Efectivo, Transferencia, De Una, Tarjeta
  const [method, setMethod] = useState<'Efectivo' | 'Transferencia' | 'De Una' | 'Tarjeta'>('Efectivo');

  // Courtesy, Discount & Tip (Propinas) state
  const [isCourtesy, setIsCourtesy] = useState(false);
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [showDiscountInput, setShowDiscountInput] = useState(false);
  const [tipAmountInput, setTipAmountInput] = useState<string>('');
  const [showTipInput, setShowTipInput] = useState(false);
  const [completedTip, setCompletedTip] = useState<number>(0);

  // Split Bill state (Cobros Divididos: 1 Solo, Partes Iguales, o Cobro Personalizado por plato)
  const [splitMode, setSplitMode] = useState<'full' | 'equal' | 'custom'>('full');
  const [splitCount, setSplitCount] = useState<number>(1);
  const [customQuantities, setCustomQuantities] = useState<Record<number, number>>({});

  // Client Info Order: 1. DATOS DEL CLIENTE (Default), 2. CONSUMIDOR FINAL
  const [clientType, setClientType] = useState<'datos' | 'final'>('datos');
  const [rucOrCi, setRucOrCi] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [isSearchingClient, setIsSearchingClient] = useState(false);
  const [clientFoundMessage, setClientFoundMessage] = useState<string | null>(null);
  const [clientsByDocMap, setClientsByDocMap] = useState<
    Map<string, { name?: string; email?: string; address?: string; phone?: string }>
  >(new Map());

  // Cash denomination calculation
  const [receivedAmount, setReceivedAmount] = useState<string>('');

  // Processing & Post-Checkout Invoice / Print state
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sriStatus, setSriStatus] = useState<'idle' | 'transmitting' | 'authorized'>('idle');
  const [sriClave, setSriClave] = useState<string>('');
  const [completedInvoice, setCompletedInvoice] = useState<ElectronicInvoiceRecord | null>(null);
  const [completedChange, setCompletedChange] = useState<number>(0);
  const [completedMethod, setCompletedMethod] = useState<string>('Efectivo');
  const [selectedPrintFormat, setSelectedPrintFormat] = useState<PaperFormat>(
    storeSettings.paperSize || '80mm'
  );
  const [copiedClave, setCopiedClave] = useState(false);

  const submittingRef = useRef(false);
  const wasOpenRef = useRef(false);
  const lastTableIdRef = useRef<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setSelectedPrintFormat(storeSettings.paperSize || '80mm');
  }, [storeSettings.paperSize]);

  // Reset residual discounts, client data, SRI status & tab cleanly ONLY when modal opens or table changes
  useEffect(() => {
    const justOpened = isOpen && (!wasOpenRef.current || lastTableIdRef.current !== table.id);
    wasOpenRef.current = isOpen;
    if (isOpen) {
      lastTableIdRef.current = table.id;
    }

    if (justOpened) {
      setActiveTab('COBRO');
      setMethod('Efectivo');
      setIsCourtesy(false);
      setDiscountPercent(0);
      setShowDiscountInput(false);
      setTipAmountInput('');
      setShowTipInput(false);
      setCompletedTip(0);
      setClientType('datos');
      setRucOrCi('');
      setClientName('');
      setClientEmail('');
      setClientAddress('');
      setClientPhone('');
      setClientFoundMessage(null);
      setSriStatus('idle');
      setSriClave('');
      setCompletedInvoice(null);
      setCompletedChange(0);
      setCopiedClave(false);
      setIsProcessing(false);
      setReceivedAmount('');
      setErrorMsg(null);
      submittingRef.current = false;

      const initialMap: Record<number, number> = {};
      items.forEach((it, idx) => {
        initialMap[idx] = Number(it.quantity) || 0;
      });
      setCustomQuantities(initialMap);
      setSplitMode('full');
      setSplitCount(1);
    }
  }, [isOpen, table.id, items]);

  // Calculate charged items & totals based on mode (Full vs Equal Split vs Cobro Personalizado)
  const chargedItems: OrderItem[] = useMemo(() => {
    if (splitMode !== 'custom') return items;
    return items
      .map((it, idx) => ({
        ...it,
        quantity: Math.min(Number(it.quantity) || 0, Math.max(0, customQuantities[idx] ?? 0)),
      }))
      .filter((it) => it.quantity > 0);
  }, [splitMode, items, customQuantities]);

  const grossSelectedTotal = useMemo(() => {
    if (splitMode !== 'custom') return Number(initialTotal) || 0;
    return chargedItems.reduce(
      (acc, it) => acc + (Number(it.price) || 0) * (Number(it.quantity) || 0),
      0
    );
  }, [splitMode, chargedItems, initialTotal]);

  const baseTotal = isCourtesy ? 0 : Math.max(0, grossSelectedTotal * (1 - discountPercent / 100));
  const currentChargeTotal =
    splitMode === 'equal' && splitCount > 1 ? baseTotal / splitCount : baseTotal;
  const tipAmount = isCourtesy ? 0 : Math.max(0, parseFloat(tipAmountInput) || 0);
  const totalWithTip = currentChargeTotal + tipAmount;

  const safeIva =
    Number.isFinite(storeSettings.ivaPercentage) && storeSettings.ivaPercentage >= 0
      ? storeSettings.ivaPercentage
      : 15;
  const subtotal = currentChargeTotal / (1 + safeIva / 100);
  const iva = currentChargeTotal - subtotal;
  const numReceived = parseFloat(receivedAmount) || 0;
  const change = Math.max(0, numReceived - totalWithTip);

  // Subscribe to clients catalog while modal is open for instant real-time autofill while typing RUC/CI
  useEffect(() => {
    if (!isOpen) return;
    const unsub = onSnapshot(
      collection(db, 'clients'),
      (snap) => {
        const nextMap = new Map<string, { name?: string; email?: string; address?: string; phone?: string }>();
        snap.forEach((d) => {
          const data = d.data() as any;
          const docNum = String(data?.docNumber || data?.ruc || data?.cedula || '').trim();
          if (docNum) {
            nextMap.set(docNum, {
              name: data.name || data.razonSocial || '',
              email: data.email || '',
              address: data.address || '',
              phone: data.phone || '',
            });
          }
        });
        setClientsByDocMap(nextMap);
      },
      (err) => console.warn('Notice subscribing to clients for autofill:', err)
    );
    return () => unsub();
  }, [isOpen]);

  // Live autocomplete client as the user types RUC/CI (clears fields when RUC/CI is cleared)
  const handleRucChange = (val: string) => {
    setRucOrCi(val);
    const cleanDoc = val.trim();
    if (!cleanDoc) {
      setClientName('');
      setClientEmail('');
      setClientAddress('');
      setClientPhone('');
      setClientFoundMessage(null);
      return;
    }
    const matched = clientsByDocMap.get(cleanDoc);
    if (matched) {
      setClientName(matched.name || '');
      setClientEmail(matched.email || '');
      setClientAddress(matched.address || '');
      setClientPhone(matched.phone || '');
      setClientFoundMessage(`✓ Cliente encontrado: ${matched.name || cleanDoc}`);
    } else {
      setClientFoundMessage(null);
    }
  };

  // Fallback autocomplete lookup on blur in case offline cache or query catches an uncached entry
  const handleRucBlur = async () => {
    const cleanDoc = rucOrCi.trim();
    if (cleanDoc.length < 5) return;

    const cachedMatch = clientsByDocMap.get(cleanDoc);
    if (cachedMatch) {
      setClientName(cachedMatch.name || '');
      setClientEmail(cachedMatch.email || '');
      setClientAddress(cachedMatch.address || '');
      setClientPhone(cachedMatch.phone || '');
      setClientFoundMessage(`✓ Cliente encontrado: ${cachedMatch.name || cleanDoc}`);
      return;
    }

    setIsSearchingClient(true);
    setClientFoundMessage(null);
    try {
      let snap = await getDocsOfflineSafe(
        query(collection(db, 'clients'), where('docNumber', '==', cleanDoc))
      );
      if (snap.empty) {
        snap = await getDocsOfflineSafe(
          query(collection(db, 'customers'), where('docNumber', '==', cleanDoc))
        );
      }
      if (!snap.empty) {
        const clientData = snap.docs[0].data() as any;
        setClientName(clientData.name || clientData.razonSocial || '');
        setClientEmail(clientData.email || '');
        setClientAddress(clientData.address || '');
        setClientPhone(clientData.phone || '');
        setClientFoundMessage(`✓ Cliente encontrado: ${clientData.name || clientData.razonSocial || cleanDoc}`);
      }
    } catch (err) {
      console.warn('Notice querying client autocomplete:', err);
    } finally {
      setIsSearchingClient(false);
    }
  };

  const handleQuickCash = (amount: number) => {
    setReceivedAmount(amount.toFixed(2));
  };

  const handlePrint = async () => {
    const resolvedName = clientType === 'final' ? 'CONSUMIDOR FINAL' : clientName.trim() || 'CONSUMIDOR FINAL';
    const resolvedId = clientType === 'final' ? '9999999999999' : rucOrCi.trim() || '9999999999999';
    await printThermalReceipt(
      {
        title: activeTab === 'FACTURACION' ? 'FACTURA / COMPROBANTE' : 'COMPROBANTE DE CONSUMO',
        tableLabel: table.tableNumber === 0 ? 'ORDEN: DOMICILIO' : `MESA: ${table.tableNumber}`,
        isDomicilio: table.tableNumber === 0,
        clientName: resolvedName,
        clientId: resolvedId,
        clientEmail: clientEmail.trim(),
        clientAddress: clientAddress.trim(),
        clientPhone: clientPhone.trim(),
        items: chargedItems,
        subtotal,
        discountPercent,
        discountAmount: (grossSelectedTotal * discountPercent) / 100,
        ivaRate: safeIva,
        ivaAmount: iva,
        total: currentChargeTotal,
        paymentMethod: method,
        changeAmount: method === 'Efectivo' ? change : 0,
        splitLabel:
          splitMode === 'equal' && splitCount > 1
            ? `Cuenta dividida en ${splitCount} pagos iguales`
            : splitMode === 'custom'
            ? 'Cobro Personalizado (Pago parcial)'
            : undefined,
      },
      selectedPrintFormat
    );
  };

  const handleApplyCourtesy = () => {
    if (!isCourtesy) {
      setIsCourtesy(true);
      setDiscountPercent(100);
      setReceivedAmount('');
    } else {
      setIsCourtesy(false);
      setDiscountPercent(0);
      setReceivedAmount('');
    }
  };

  const handleSetPresetDiscount = (pct: number) => {
    setIsCourtesy(false);
    setDiscountPercent(pct);
    setShowDiscountInput(false);
  };

  const handleCustomQtyChange = (idx: number, delta: number, maxQty: number) => {
    setErrorMsg(null);
    setCustomQuantities((prev) => {
      const curr = prev[idx] ?? 0;
      const next = Math.max(0, Math.min(maxQty, curr + delta));
      return { ...prev, [idx]: next };
    });
  };

  const handleToggleCustomDish = (idx: number, maxQty: number) => {
    setErrorMsg(null);
    setCustomQuantities((prev) => {
      const curr = prev[idx] ?? 0;
      return { ...prev, [idx]: curr > 0 ? 0 : maxQty };
    });
  };

  const handleSelectAllCustom = (selectAll: boolean) => {
    setErrorMsg(null);
    const next: Record<number, number> = {};
    items.forEach((it, idx) => {
      next[idx] = selectAll ? it.quantity : 0;
    });
    setCustomQuantities(next);
  };

  const handleCompleteCobro = async () => {
    if (submittingRef.current || isProcessing) return;
    if (splitMode === 'custom' && chargedItems.length === 0) {
      setErrorMsg('Selecciona al menos un plato para realizar el cobro personalizado.');
      return;
    }
    if (clientType === 'datos' && (!rucOrCi.trim() || !clientName.trim())) {
      setErrorMsg(
        'Ingresa el RUC/Cédula y Razón Social del cliente para emitir la factura SRI, o selecciona "Consumidor Final".'
      );
      return;
    }

    submittingRef.current = true;
    setErrorMsg(null);
    setIsProcessing(true);
    setSriStatus('transmitting');

    try {
      const secStr = String(Date.now()).slice(-9).padStart(9, '0');
      const isConsumidorFinal = clientType === 'final';
      const previewClave = isConsumidorFinal
        ? `TICKET-INTERNO-${secStr}`
        : generateClaveDeAcceso(secStr, storeSettings.ruc);
      setSriClave(previewClave);

      const resolvedName = isConsumidorFinal
        ? 'CONSUMIDOR FINAL'
        : clientName.trim() || 'CONSUMIDOR FINAL';
      const resolvedId = isConsumidorFinal ? '9999999999999' : rucOrCi.trim() || '9999999999999';

      // Save new client in 'clients' collection in background so checkout & auto-print never stall
      if (clientType === 'datos' && rucOrCi.trim() && clientName.trim()) {
        const docNumClean = rucOrCi.trim();
        const nameClean = clientName.trim();
        const emailClean = clientEmail.trim();
        const addrClean = clientAddress.trim();
        const phoneClean = clientPhone.trim();
        void (async () => {
          try {
            const qCheck = query(collection(db, 'clients'), where('docNumber', '==', docNumClean));
            const existingSnap = await getDocsOfflineSafe(qCheck);
            if (existingSnap.empty) {
              const clientRef = doc(collection(db, 'clients'));
              await commitOfflineSafe(
                setDoc(clientRef, {
                  docType: docNumClean.length === 13 ? 'RUC' : 'Cédula',
                  docNumber: docNumClean,
                  name: nameClean,
                  email: emailClean,
                  address: addrClean,
                  phone: phoneClean,
                  createdAt: new Date().toISOString(),
                }),
                'create_client'
              );
            }
          } catch (e) {
            console.warn('Notice saving new client:', e);
          }
        })();
      }

      const isCustomPartial = splitMode === 'custom';
      const effectiveCashReceived = receivedAmount.trim() === '' ? totalWithTip : numReceived;
      const effectiveCashChange = receivedAmount.trim() === '' ? 0 : change;

      const result = await onConfirmPayment({
        method,
        receivedAmount: method === 'Efectivo' ? effectiveCashReceived : totalWithTip,
        changeAmount: method === 'Efectivo' ? effectiveCashChange : 0,
        clientName: resolvedName,
        clientId: resolvedId,
        clientEmail: clientEmail.trim(),
        clientAddress: clientAddress.trim(),
        clientPhone: clientPhone.trim(),
        discountPercent,
        isCourtesy,
        tipAmount,
        splitParts: splitMode === 'equal' ? splitCount : 1,
        chargedItems,
        chargedTotal: currentChargeTotal,
        isCustomPartial,
      });

      const finalInvoice: ElectronicInvoiceRecord = result?.invoice || {
        invoiceNumber: `001-001-${secStr}`,
        claveAcceso: previewClave,
        date: new Date().toISOString(),
        status: isConsumidorFinal
          ? 'TICKET_INTERNO'
          : navigator.onLine
          ? 'AUTORIZADO'
          : 'PENDIENTE_ENVIO_OFFLINE',
        isInternalTicket: isConsumidorFinal,
        sriAuthorizationNumber: isConsumidorFinal ? '' : previewClave,
        sriAuthorizationDate: isConsumidorFinal ? null : navigator.onLine ? new Date().toISOString() : null,
        client: {
          docType: isConsumidorFinal
            ? 'Consumidor Final'
            : resolvedId.length === 13
            ? 'RUC'
            : 'Cédula',
          docNumber: resolvedId,
          name: resolvedName,
          email: clientEmail.trim(),
          address: clientAddress.trim(),
          phone: clientPhone.trim(),
        },
        reference: cobroTableLabel,
        paymentMethod: method,
        subtotal,
        ivaRate: safeIva,
        ivaAmount: iva,
        total: currentChargeTotal,
        items: chargedItems,
      };

      const changeGiven = method === 'Efectivo' ? effectiveCashChange : 0;
      setSriStatus('authorized');
      setSriClave(finalInvoice.claveAcceso);
      setCompletedChange(changeGiven);
      setCompletedMethod(method);
      setCompletedTip(tipAmount);
      setCompletedInvoice(finalInvoice);

      broadcastCustomerDisplay({
        type: 'PAID',
        tableLabel: cobroTableLabel,
        items: finalInvoice.items as OrderItem[],
        total: totalWithTip,
        paymentMethod: method,
        changeAmount: changeGiven,
        clientName: finalInvoice.client.name,
        invoiceNumber: finalInvoice.invoiceNumber,
        storeName: storeSettings.localName,
        localLogoUrl: storeSettings.logoUrl,
        slogan: storeSettings.slogan,
        timestamp: Date.now(),
      });

      // IMPRESIÓN AUTOMÁTICA INMEDIATA al presionar "Cobrar Mesa"
      const isInternalDoc =
        isConsumidorFinal ||
        finalInvoice.isInternalTicket ||
        finalInvoice.status === 'TICKET_INTERNO';
      if (isInternalDoc) {
        void printThermalReceipt(
          {
            title: 'TICKET DE VENTA — CONSUMIDOR FINAL',
            tableLabel: table.tableNumber === 0 ? 'ORDEN: DOMICILIO' : cobroTableLabel.toUpperCase(),
            isDomicilio: table.tableNumber === 0,
            clientName: 'CONSUMIDOR FINAL',
            clientId: '9999999999999',
            items: finalInvoice.items as OrderItem[],
            subtotal: finalInvoice.subtotal,
            discountPercent,
            discountAmount: finalInvoice.discountAmount,
            ivaRate: finalInvoice.ivaRate,
            ivaAmount: finalInvoice.ivaAmount,
            total: finalInvoice.total,
            paymentMethod: method,
            changeAmount: changeGiven,
            invoiceNumber: finalInvoice.invoiceNumber,
            footerNote: 'Documento interno del local — Sin envío SRI',
          },
          selectedPrintFormat
        ).catch((printErr) => console.warn('Auto-print ticket warning:', printErr));
      } else {
        void printRideInvoice(finalInvoice, {
          formatOverride: selectedPrintFormat,
          isReprint: false,
        }).catch((printErr) => console.warn('Auto-print RIDE warning:', printErr));
      }
    } catch (err: any) {
      console.error('Error al procesar cobro:', err);
      setSriStatus('idle');
      setErrorMsg(err?.message || 'Error al procesar cobro. Verifica tu conexión e intenta de nuevo.');
    } finally {
      submittingRef.current = false;
      setIsProcessing(false);
    }
  };

  const handleCopyCompletedClave = async () => {
    if (!completedInvoice?.claveAcceso) return;
    try {
      await navigator.clipboard?.writeText(completedInvoice.claveAcceso);
      setCopiedClave(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedClave(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/65 flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-3xl bg-white border border-gray-200 rounded-3xl shadow-2xl p-4 sm:p-6 relative text-gray-900 max-h-[94vh] flex flex-col">
        {/* Top Header: COBRAR MESA + Tab Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-gray-200 gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] font-mono font-black text-sm shadow-xs">
              {table.tableNumber === 0 ? '🛵' : `M${table.tableNumber}`}
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-gray-900 tracking-tight">
                COBRAR {table.tableNumber === 0 ? 'DOMICILIO' : cobroTableLabel.toUpperCase()}
              </h3>
              <p className="text-xs text-gray-500">Módulo de cobro, facturación y despacho</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tabs: COBRO vs FACTURACIÓN */}
            <div className="flex items-center bg-gray-100 p-1 rounded-2xl border border-gray-200">
              <button
                type="button"
                onClick={() => setActiveTab('COBRO')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'COBRO'
                    ? 'bg-[#4A5D23] text-white shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Cobro Directo
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('FACTURACION')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                  activeTab === 'FACTURACION'
                    ? 'bg-[#4A5D23] text-white shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Building className="w-3.5 h-3.5 text-[#E89E2D]" />
                Facturación SRI
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        {completedInvoice ? (
          (() => {
            const isCompletedInternal =
              completedInvoice.isInternalTicket || completedInvoice.status === 'TICKET_INTERNO';
            const isOfflinePending = completedInvoice.status === 'PENDIENTE_ENVIO_OFFLINE';
            return (
              <div className="flex-1 overflow-y-auto pt-4 space-y-4">
                <div
                  className={`p-4 rounded-2xl border flex items-center gap-3 ${
                    isCompletedInternal
                      ? 'bg-amber-50 border-amber-200'
                      : isOfflinePending
                      ? 'bg-rose-50 border-rose-200'
                      : 'bg-emerald-50 border-emerald-200'
                  }`}
                >
                  <CheckCircle2
                    className={`w-8 h-8 shrink-0 ${
                      isCompletedInternal
                        ? 'text-[#E89E2D]'
                        : isOfflinePending
                        ? 'text-rose-600'
                        : 'text-emerald-600'
                    }`}
                  />
                  <div>
                    <h4
                      className={`font-black text-sm ${
                        isCompletedInternal
                          ? 'text-amber-950'
                          : isOfflinePending
                          ? 'text-rose-900'
                          : 'text-emerald-900'
                      }`}
                    >
                      {isCompletedInternal
                        ? '¡Cobro Registrado y Ticket Interno Impreso!'
                        : isOfflinePending
                        ? '¡Cobro Registrado (Pendiente SRI · Offline) y Ticket Impreso!'
                        : '¡Cobro Registrado, Factura Autorizada e Impresa!'}
                    </h4>
                    <p
                      className={`text-xs ${
                        isCompletedInternal
                          ? 'text-amber-800'
                          : isOfflinePending
                          ? 'text-rose-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {isCompletedInternal
                        ? 'Consumidor Final: Ticket local enviado a impresión automáticamente y guardado en Facturación (NO se envía al SRI).'
                        : 'Impresión automática enviada. Puedes reimprimir el documento físico cuando desees sin volver a transmitir al SRI.'}
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2.5 text-xs">
                  <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                    <span className="font-bold text-gray-600">
                      {isCompletedInternal ? 'N° Ticket Interno:' : 'N° Factura SRI:'}
                    </span>
                    <span className="font-mono font-black text-gray-900 text-sm">
                      {completedInvoice.invoiceNumber}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                    <span className="font-bold text-gray-600">Cliente:</span>
                    <span className="font-bold text-gray-900">
                      {completedInvoice.client.name} ({completedInvoice.client.docNumber})
                    </span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                    <span className="font-bold text-gray-600">Total Cobrado ({completedMethod}):</span>
                    <span className="font-mono font-black text-[#4A5D23] text-base">
                      ${(Number(completedInvoice.total || 0) + completedTip).toFixed(2)}
                    </span>
                  </div>
                  {completedMethod === 'Efectivo' && completedChange > 0 && (
                    <div className="flex justify-between items-center pb-2 border-b border-gray-200 text-emerald-700 font-bold">
                      <span>Cambio Entregado:</span>
                      <span className="font-mono text-sm">${completedChange.toFixed(2)}</span>
                    </div>
                  )}
                  {!isCompletedInternal ? (
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-gray-600">Clave de Acceso (49 dígitos):</span>
                        <button
                          type="button"
                          onClick={handleCopyCompletedClave}
                          className="text-xs text-[#4A5D23] hover:underline font-bold flex items-center gap-1 cursor-pointer"
                        >
                          {copiedClave ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copiedClave ? '¡Copiado!' : 'Copiar'}
                        </button>
                      </div>
                      <div className="p-2.5 rounded-xl bg-white border border-gray-300 font-mono text-[11px] text-gray-800 break-all select-all">
                        {completedInvoice.claveAcceso}
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-white border border-dashed border-amber-300 text-[11px] text-amber-900 font-semibold">
                      Comprobante interno de Consumidor Final — Registrado en el historial sin envío tributario al SRI.
                    </div>
                  )}
                </div>

                {/* Printer selector & format switch */}
                <div className="p-3.5 rounded-2xl bg-[#F8F9FA] border border-gray-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Printer className="w-4 h-4 text-[#4A5D23]" />
                    <span className="font-bold text-gray-700">Impresora:</span>
                    <span className="font-mono text-[#4A5D23] font-bold">
                      {activeReceiptPrinter.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(['80mm', '58mm', 'A4'] as const).map((fmt) => (
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
                        {fmt === 'A4' ? 'A4 / Epson Normal' : `Térmica ${fmt}`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-end gap-2.5">
                  {!isCompletedInternal && (
                    <button
                      type="button"
                      disabled={isPrinting}
                      onClick={() =>
                        printRideInvoice(completedInvoice, {
                          formatOverride: selectedPrintFormat,
                          isReprint: true,
                        })
                      }
                      className="px-4 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-[#E89E2D]/50 text-amber-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Printer className="w-4 h-4 text-[#E89E2D]" />
                      {isPrinting ? 'Imprimiendo...' : 'Reimprimir RIDE (Factura)'}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isPrinting}
                    onClick={() =>
                      printThermalReceipt(
                        {
                          title: isCompletedInternal
                            ? 'TICKET DE VENTA — CONSUMIDOR FINAL'
                            : 'FACTURA / COMPROBANTE DE VENTA',
                          tableLabel:
                            table.tableNumber === 0 ? 'ORDEN: DOMICILIO' : `MESA: ${table.tableNumber}`,
                          isDomicilio: table.tableNumber === 0,
                          clientName: completedInvoice.client.name,
                          clientId: completedInvoice.client.docNumber,
                          clientEmail: completedInvoice.client.email,
                          clientAddress: completedInvoice.client.address,
                          clientPhone: completedInvoice.client.phone,
                          items: completedInvoice.items as OrderItem[],
                          subtotal: completedInvoice.subtotal,
                          discountPercent,
                          discountAmount: completedInvoice.discountAmount,
                          ivaRate: completedInvoice.ivaRate,
                          ivaAmount: completedInvoice.ivaAmount,
                          total: completedInvoice.total,
                          paymentMethod: completedMethod,
                          changeAmount: completedChange,
                          sriClave: isCompletedInternal ? undefined : completedInvoice.claveAcceso,
                          invoiceNumber: completedInvoice.invoiceNumber,
                          footerNote: isCompletedInternal
                            ? 'Documento interno del local — Sin envío SRI'
                            : undefined,
                        },
                        selectedPrintFormat === 'A4' ? '80mm' : selectedPrintFormat
                      )
                    }
                    className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Receipt className="w-4 h-4 text-[#4A5D23]" />
                    {isCompletedInternal ? 'Reimprimir Ticket Interno' : 'Reimprimir Ticket Térmico'}
                  </button>

                  <button
                    type="button"
                    onClick={onClose}
                    className="px-6 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold cursor-pointer shadow-sm"
                  >
                    Aceptar y Cerrar
                  </button>
                </div>
              </div>
            );
          })()
        ) : (
        <div className="flex-1 overflow-y-auto pt-3.5 pr-1 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="font-semibold">{errorMsg}</span>
            </div>
          )}
          {/* Quick Adjustment Toolbar: Cortesía, Descuento %, Propinas, Cobros Divididos */}
          <div className="p-3 rounded-2xl bg-[#F8F9FA] border border-gray-200 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* Courtesy Button */}
              <button
                type="button"
                onClick={handleApplyCourtesy}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  isCourtesy
                    ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-[#4A5D23]'
                }`}
              >
                <Gift className="w-3.5 h-3.5" />
                <span>{isCourtesy ? '✓ Cortesía Aplicada (100%)' : 'Cortesía'}</span>
              </button>

              {/* Discount Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowDiscountInput(!showDiscountInput);
                    setShowTipInput(false);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                    discountPercent > 0 && !isCourtesy
                      ? 'bg-[#4A5D23] text-white border-[#4A5D23] shadow-xs'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-[#4A5D23]'
                  }`}
                >
                  <Percent className="w-3.5 h-3.5" />
                  <span>
                    {discountPercent > 0 && !isCourtesy
                      ? `Descuento ${discountPercent}%`
                      : 'Descuento %'}
                  </span>
                </button>

                {showDiscountInput && (
                  <div className="absolute left-0 top-9 z-20 bg-white border border-gray-200 rounded-2xl p-2.5 shadow-xl flex items-center gap-1.5 animate-scale-in">
                    {[5, 10, 15, 20, 50].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => handleSetPresetDiscount(p)}
                        className="px-2 py-1 rounded-lg bg-gray-100 hover:bg-[#EAF5F0] hover:text-[#4A5D23] text-xs font-bold text-gray-800 cursor-pointer"
                      >
                        {p}%
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => handleSetPresetDiscount(0)}
                      className="px-2 py-1 rounded-lg text-xs font-bold text-rose-600 hover:bg-rose-50 cursor-pointer"
                    >
                      Quitar
                    </button>
                  </div>
                )}
              </div>

              {/* Propinas Button (Suma al total cobrado y caja, sin desglose en factura impresa) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowTipInput(!showTipInput);
                    setShowDiscountInput(false);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                    tipAmount > 0 && !isCourtesy
                      ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-[#4A5D23]'
                  }`}
                >
                  <DollarSign className="w-3.5 h-3.5 text-[#E89E2D]" />
                  <span>
                    {tipAmount > 0 && !isCourtesy ? `Propina +$${tipAmount.toFixed(2)}` : 'Propinas'}
                  </span>
                </button>

                {showTipInput && (
                  <div className="absolute left-0 top-9 z-20 bg-white border border-gray-200 rounded-2xl p-2.5 shadow-xl flex flex-wrap items-center gap-1.5 min-w-[235px]">
                    {[1, 2, 5, 10].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setTipAmountInput(String(val));
                          setShowTipInput(false);
                        }}
                        className="px-2 py-1 rounded-lg bg-gray-100 hover:bg-[#EAF5F0] hover:text-[#4A5D23] text-xs font-mono font-bold text-gray-800 cursor-pointer"
                      >
                        +${val}
                      </button>
                    ))}
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      placeholder="$ Monto"
                      value={tipAmountInput}
                      onChange={(e) => setTipAmountInput(e.target.value)}
                      className="w-20 bg-gray-50 border border-gray-300 rounded-lg px-2 py-1 text-xs font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setTipAmountInput('');
                        setShowTipInput(false);
                      }}
                      className="px-2 py-1 rounded-lg text-xs font-bold text-rose-600 hover:bg-rose-50 cursor-pointer"
                    >
                      Quitar
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Cobros Divididos (Split Bill & Cobro Personalizado) */}
            <div className="flex flex-wrap items-center gap-1.5 bg-white border border-gray-200 px-2.5 py-1 rounded-xl text-xs">
              <Users className="w-3.5 h-3.5 text-[#4A5D23]" />
              <span className="font-semibold text-gray-600">Dividir cuenta:</span>
              {[1, 2, 3, 4].map((n) => {
                const isSelected =
                  n === 1 ? splitMode === 'full' : splitMode === 'equal' && splitCount === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      if (n === 1) {
                        setSplitMode('full');
                        setSplitCount(1);
                      } else {
                        setSplitMode('equal');
                        setSplitCount(n);
                      }
                    }}
                    className={`px-2 py-0.5 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#4A5D23] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {n === 1 ? '1 Solo' : `${n} Partes`}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  if (splitMode === 'custom') {
                    setSplitMode('full');
                  } else {
                    const cleanMap: Record<number, number> = {};
                    items.forEach((_, idx) => {
                      cleanMap[idx] = 0;
                    });
                    setCustomQuantities(cleanMap);
                    setSplitMode('custom');
                  }
                }}
                className={`px-2.5 py-0.5 rounded-lg font-bold text-xs transition-colors cursor-pointer border ${
                  splitMode === 'custom'
                    ? 'bg-[#D97706] text-white border-[#D97706] shadow-2xs'
                    : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                }`}
              >
                Cobro Personalizado
              </button>
            </div>
          </div>

          {/* Cobro Personalizado Dish Selector */}
          {splitMode === 'custom' && (
            <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-black text-amber-950 uppercase tracking-wider">
                    Cobro Personalizado — Marca los platos que paga este cliente
                  </h4>
                  <p className="text-[11px] text-amber-800">
                    Los platos sin marcar permanecerán abiertos en la mesa para los demás comensales.
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="px-2.5 py-1 rounded-lg bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30 text-[11px] font-black font-mono">
                    {chargedItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0)} selec. · ${grossSelectedTotal.toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSelectAllCustom(true)}
                    className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 text-[11px] font-bold hover:bg-amber-100 cursor-pointer"
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAllCustom(false)}
                    className="px-2.5 py-1 rounded-lg bg-white border border-gray-300 text-gray-700 text-[11px] font-bold hover:bg-gray-100 cursor-pointer"
                  >
                    Ninguno
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                {items.map((it, idx) => {
                  const selectedQty = customQuantities[idx] ?? 0;
                  const isChecked = selectedQty > 0;
                  return (
                    <div
                      key={`${it.productId}_${idx}`}
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs transition-colors ${
                        isChecked
                          ? 'bg-white border-[#4A5D23] ring-1 ring-[#4A5D23]/20 shadow-2xs'
                          : 'bg-white/70 border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleCustomDish(idx, it.quantity)}
                          className="w-4 h-4 rounded accent-[#4A5D23] text-[#4A5D23] border-gray-300 focus:ring-[#4A5D23] cursor-pointer shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className={`font-bold truncate ${isChecked ? 'text-[#4A5D23]' : 'text-gray-900'}`}>
                            {it.name}
                          </div>
                          {(it.dinerName || (it.selectedCustomizations && it.selectedCustomizations.length > 0)) && (
                            <div className="text-[10px] text-amber-800 font-semibold truncate">
                              {it.dinerName ? `Comensal: ${it.dinerName}` : ''}
                              {it.dinerName && it.selectedCustomizations?.length ? ' · ' : ''}
                              {it.selectedCustomizations?.map((c) => c.optionName).join(', ')}
                            </div>
                          )}
                          <div className="text-[10px] font-mono text-gray-500">
                            ${it.price.toFixed(2)} c/u · Cant: {it.quantity}
                          </div>
                        </div>
                      </label>
                      <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg border border-gray-200 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleCustomQtyChange(idx, -1, it.quantity)}
                          className="w-6 h-6 rounded-md bg-white hover:bg-gray-100 text-gray-700 flex items-center justify-center cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center font-mono font-black text-xs text-[#4A5D23]">
                          {selectedQty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCustomQtyChange(idx, 1, it.quantity)}
                          className="w-6 h-6 rounded-md bg-[#4A5D23] hover:bg-[#3d4d1d] text-white flex items-center justify-center cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Left Column: Client Data + Payment Methods */}
            <div className="space-y-4">
              {/* Client Info Section with strict order: 1. DATOS DEL CLIENTE, 2. CONSUMIDOR FINAL */}
              <div className="p-3.5 rounded-2xl bg-[#F8F9FA] border border-gray-200 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-800 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-[#4A5D23]" />
                    1. DATOS DEL CLIENTE
                  </span>

                  {/* Toggle: Con Datos vs Consumidor Final */}
                  <div className="flex items-center bg-white p-0.5 rounded-xl border border-gray-200 text-xs">
                    <button
                      type="button"
                      onClick={() => setClientType('datos')}
                      className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                        clientType === 'datos'
                          ? 'bg-[#4A5D23] text-white shadow-2xs'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Con Datos
                    </button>
                    <button
                      type="button"
                      onClick={() => setClientType('final')}
                      className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                        clientType === 'final'
                          ? 'bg-[#4A5D23] text-white shadow-2xs'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Consumidor Final
                    </button>
                  </div>
                </div>

                {clientType === 'datos' ? (
                  <div className="space-y-2 pt-1 text-xs">
                    <div>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="RUC o Cédula (Escribe y autocompleta)..."
                          value={rucOrCi}
                          onChange={(e) => handleRucChange(e.target.value)}
                          onBlur={handleRucBlur}
                          className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl pl-3 pr-8 py-2 text-xs font-mono font-bold text-gray-900 focus:outline-none"
                        />
                        {isSearchingClient && (
                          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                            <span className="w-3.5 h-3.5 border-2 border-[#4A5D23] border-t-transparent rounded-full animate-spin inline-block" />
                          </div>
                        )}
                      </div>
                      {clientFoundMessage && (
                        <p className="text-[10px] text-emerald-700 font-bold mt-1">
                          {clientFoundMessage}
                        </p>
                      )}
                    </div>

                    <input
                      type="text"
                      placeholder="Razón Social / Nombre Completo *"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none font-semibold"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="email"
                        placeholder="Correo electrónico (SRI)..."
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                      />
                      <input
                        type="tel"
                        placeholder="Teléfono / WhatsApp..."
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                      />
                    </div>

                    <input
                      type="text"
                      placeholder="Dirección del cliente..."
                      value={clientAddress}
                      onChange={(e) => setClientAddress(e.target.value)}
                      className="w-full bg-white border border-gray-300 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="p-3 bg-white rounded-xl border border-gray-200 text-xs text-gray-600 flex items-center justify-between">
                    <div>
                      <strong className="text-gray-900 block">2. CONSUMIDOR FINAL</strong>
                      <span className="text-[11px] font-mono text-gray-500">RUC: 9999999999999</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700">
                      Sin datos fiscales
                    </span>
                  </div>
                )}
              </div>

              {/* Payment Method Selector: Efectivo, Transferencia, De Una, Tarjeta */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">
                  Método de Pago
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {/* 1. Efectivo */}
                  <button
                    type="button"
                    onClick={() => setMethod('Efectivo')}
                    className={`py-2.5 px-1.5 rounded-xl text-xs font-bold flex flex-col items-center gap-1 border transition-all cursor-pointer ${
                      method === 'Efectivo'
                        ? 'bg-[#4A5D23] text-white border-[#4A5D23] shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <Banknote className="w-4 h-4 text-[#E89E2D]" />
                    <span className="text-[11px]">Efectivo</span>
                  </button>

                  {/* 2. Transferencia */}
                  <button
                    type="button"
                    onClick={() => setMethod('Transferencia')}
                    className={`py-2.5 px-1.5 rounded-xl text-xs font-bold flex flex-col items-center gap-1 border transition-all cursor-pointer ${
                      method === 'Transferencia'
                        ? 'bg-[#4A5D23] text-white border-[#4A5D23] shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <Smartphone className="w-4 h-4 text-[#E89E2D]" />
                    <span className="text-[11px]">Transf.</span>
                  </button>

                  {/* 3. De Una */}
                  <button
                    type="button"
                    onClick={() => setMethod('De Una')}
                    className={`py-2.5 px-1.5 rounded-xl text-xs font-bold flex flex-col items-center gap-1 border transition-all cursor-pointer ${
                      method === 'De Una'
                        ? 'bg-[#4A5D23] text-white border-[#4A5D23] shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <QrCode className="w-4 h-4 text-[#E89E2D]" />
                    <span className="text-[11px]">De Una</span>
                  </button>

                  {/* 4. Tarjeta */}
                  <button
                    type="button"
                    onClick={() => setMethod('Tarjeta')}
                    className={`py-2.5 px-1.5 rounded-xl text-xs font-bold flex flex-col items-center gap-1 border transition-all cursor-pointer ${
                      method === 'Tarjeta'
                        ? 'bg-[#4A5D23] text-white border-[#4A5D23] shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-[#E89E2D]" />
                    <span className="text-[11px]">Tarjeta</span>
                  </button>
                </div>
              </div>

              {/* Cash tendered & Quick Denominations ($10, $20, $50, $100, Exacto) */}
              {method === 'Efectivo' && (
                <div className="p-3.5 rounded-2xl bg-[#F8F9FA] border border-gray-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-800">Efectivo Recibido ($):</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={receivedAmount}
                      onChange={(e) => setReceivedAmount(e.target.value)}
                      className="w-28 bg-white border border-gray-300 rounded-xl px-2.5 py-1 text-right font-mono font-bold text-sm text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                    />
                  </div>

                  {/* Quick bills: $10, $20, $50, $100 */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-gray-500 font-bold uppercase">Billetes:</span>
                    <button
                      type="button"
                      onClick={() => handleQuickCash(totalWithTip)}
                      className="px-2 py-0.5 rounded-lg bg-white border border-gray-200 hover:border-[#4A5D23] text-[10px] font-mono font-bold text-[#4A5D23] cursor-pointer shadow-2xs"
                    >
                      Exacto
                    </button>
                    {[10, 20, 50, 100].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => handleQuickCash(val)}
                        className="px-2.5 py-0.5 rounded-lg bg-white border border-gray-200 hover:border-[#4A5D23] text-[10px] font-mono font-bold text-gray-800 cursor-pointer shadow-2xs"
                      >
                        ${val}
                      </button>
                    ))}
                  </div>

                  <div className="pt-2 border-t border-gray-200 flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-800">Cambio a Entregar:</span>
                    <span className="font-mono font-black text-base text-emerald-700">
                      ${change.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Thermal Ticket Preview + SRI Status */}
            <div className="flex flex-col justify-between bg-[#F8F9FA] rounded-2xl p-4 border border-gray-200">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-gray-200 mb-2">
                  <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-[#4A5D23]" />
                    Comprobante Térmico / Factura
                  </span>
                  <span className="text-[10px] text-gray-400 font-mono">80mm Formato SRI</span>
                </div>

                {/* Thermal Paper Simulation */}
                <div className="bg-white border border-dashed border-gray-300 rounded-xl p-3.5 font-mono text-[11px] text-gray-800 space-y-1.5 shadow-2xs">
                  <div className="text-center font-bold text-xs uppercase tracking-tight text-[#4A5D23]">
                    {storeSettings.localName || 'GASTROLAB'}
                  </div>
                  <div className="text-center text-[10px] text-gray-500">
                    RUC: {storeSettings.ruc} • OBLIGADO A LLEVAR CONTABILIDAD
                  </div>
                  <div className="border-b border-dashed border-gray-300 my-1" />

                  <div className="flex justify-between text-[10px]">
                    <span className="font-black text-gray-900">
                      {table.tableNumber === 0 ? 'ORDEN: DOMICILIO' : cobroTableLabel.toUpperCase()}
                    </span>
                    <span>{new Date().toLocaleDateString('es-EC')}</span>
                  </div>
                  {table.tableNumber === 0 && (
                    <div className="text-center font-black text-xs uppercase py-1 bg-amber-50 border border-amber-300 rounded text-amber-900 tracking-wider">
                      *** DOMICILIO ***
                    </div>
                  )}
                  <div className="text-[10px] text-gray-800 font-bold">
                    NOMBRE: {clientType === 'final' ? 'CONSUMIDOR FINAL' : clientName.trim() || '---'}
                  </div>
                  <div className="text-[10px] text-gray-600 font-mono">
                    RUC/CI: {clientType === 'final' ? '9999999999999' : rucOrCi.trim() || '---'}
                  </div>
                  {clientType === 'datos' && (
                    <div className="space-y-0.5 text-[10px] text-gray-600">
                      <div className="truncate">CORREO: {clientEmail.trim() || '---'}</div>
                      <div className="truncate">DIRECCIÓN: {clientAddress.trim() || '---'}</div>
                      <div>TELÉFONO: {clientPhone.trim() || '---'}</div>
                    </div>
                  )}

                  {splitMode === 'equal' && splitCount > 1 && (
                    <div className="text-[10px] font-bold text-[#4A5D23] bg-[#EAF5F0] px-1 py-0.5 rounded">
                      Cuenta dividida en {splitCount} pagos iguales
                    </div>
                  )}
                  {splitMode === 'custom' && (
                    <div className="text-[10px] font-bold text-amber-900 bg-amber-50 px-1 py-0.5 rounded">
                      Cobro Personalizado (Pago parcial por consumo)
                    </div>
                  )}

                  <div className="border-b border-dashed border-gray-300 my-1" />

                  <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                    {chargedItems.length === 0 ? (
                      <div className="text-[10px] text-rose-600 text-center py-2 font-bold">
                        Selecciona platos para cobrar
                      </div>
                    ) : (
                      chargedItems.map((it, idx) => (
                        <div key={idx} className="text-[10px]">
                          <div className="flex justify-between items-center">
                            <span>
                              {it.quantity}x {it.name}
                              {it.dinerName ? ` [${it.dinerName}]` : ''}
                            </span>
                            <span className="font-bold">${(it.price * it.quantity).toFixed(2)}</span>
                          </div>
                          {it.selectedCustomizations && it.selectedCustomizations.length > 0 && (
                            <div className="text-[9px] text-gray-500 pl-3">
                              + {it.selectedCustomizations.map((c) => c.optionName).join(', ')}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="border-t border-dashed border-gray-300 pt-1 space-y-0.5 text-[10px]">
                    <div className="flex justify-between text-gray-600">
                      <span>Subtotal:</span>
                      <span>${subtotal.toFixed(2)}</span>
                    </div>

                    {discountPercent > 0 && (
                      <div className="flex justify-between text-rose-600 font-bold">
                        <span>Descuento ({discountPercent}%):</span>
                        <span>-${((grossSelectedTotal * discountPercent) / 100).toFixed(2)}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-gray-600">
                      <span>IVA ({safeIva}%):</span>
                      <span>${iva.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between font-black text-xs text-[#4A5D23] pt-0.5 border-t border-gray-200">
                      <span>TOTAL A PAGAR:</span>
                      <span>${currentChargeTotal.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="pt-1 text-[10px] text-gray-500 flex justify-between">
                    <span>Método: {method}</span>
                    {method === 'Efectivo' && (
                      <span>Cambio: ${change.toFixed(2)}</span>
                    )}
                  </div>

                  <div className="text-center pt-2 text-[9px] text-gray-400">
                    *** GRACIAS POR SU PREFERENCIA ***<br />
                    GASTROLAB by Iván Muñoz
                  </div>
                </div>
              </div>

              {/* SRI Live UI Connection Indicator */}
              {sriStatus !== 'idle' && (
                <div className="mt-2 p-2.5 rounded-xl bg-white border border-[#4A5D23]/30 flex items-center gap-2 text-xs">
                  {sriStatus === 'transmitting' ? (
                    <>
                      <span className="w-4 h-4 border-2 border-[#4A5D23] border-t-transparent rounded-full animate-spin shrink-0" />
                      <span className="text-[#4A5D23] font-bold">
                        {clientType === 'final'
                          ? 'Registrando Ticket Interno e imprimiendo...'
                          : 'Transmitiendo al SRI y preparando impresión...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-emerald-800 font-bold truncate">
                        {clientType === 'final'
                          ? 'Ticket Interno emitido (Sin envío SRI)'
                          : `¡Autorizado SRI! Clave: ${sriClave.slice(0, 16)}...`}
                      </span>
                    </>
                  )}
                </div>
              )}

              <div className="pt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={isPrinting}
                  onClick={handlePrint}
                  className="flex-1 py-2 rounded-xl bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
                >
                  <Printer className="w-3.5 h-3.5 text-[#4A5D23]" />
                  {isPrinting ? 'Imprimiendo...' : 'Imprimir Previo'}
                </button>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Modal Bottom Buttons */}
        {!completedInvoice && (
        <div className="mt-4 pt-3.5 border-t border-gray-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1 text-xs text-gray-500 font-medium">
            <Wifi className="w-3.5 h-3.5 text-[#4A5D23]" />
            <span>
              {clientType === 'final'
                ? 'Consumidor Final: Impresión Ticket Local (Sin SRI)'
                : 'Facturación SRI + Impresión Automática'}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="button"
              disabled={isProcessing || (splitMode === 'custom' && chargedItems.length === 0)}
              onClick={handleCompleteCobro}
              className="px-6 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              <Check className="w-4 h-4 text-[#D97706]" />
              {isProcessing
                ? 'Conectando con SRI y Cobrando...'
                : splitMode === 'custom'
                ? `Cobrar Selección ($${totalWithTip.toFixed(2)})`
                : `Cobrar Mesa ($${totalWithTip.toFixed(2)})`}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
