import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { OrderItem } from '../types';
import { ElectronicInvoiceRecord } from '../utils/sriHelpers';
import {
  DEFAULT_SYSTEM_OFFICE_PRINTER,
  DEFAULT_SYSTEM_THERMAL_PRINTER,
  SIMULATED_DRIVER_PRINTERS,
  ExtendedPrinterDevice,
  PaperFormat,
  StorePrintSettings,
  applyDynamicPrintPageStyle,
  buildEscPosRideBytes,
  buildEscPosTicketBytes,
  isWebSerialAvailable,
  isWebUsbAvailable,
  requestSerialPrinterPairing,
  requestUsbPrinterPairing,
  scanConnectedSerialPrinters,
  scanConnectedUsbPrinters,
  sendBytesToSerialPrinter,
  sendBytesToUsbPrinter,
} from '../utils/printerService';
import { RidePrintDocument } from '../components/RidePrintDocument';
import { groupOrderCustomizations } from '../utils/customizationFormatters';

export interface ThermalReceiptPrintPayload {
  title?: string;
  tableLabel: string;
  isDomicilio?: boolean;
  isPrecuenta?: boolean;
  clientName: string;
  clientId: string;
  clientEmail?: string;
  clientAddress?: string;
  clientPhone?: string;
  items: OrderItem[];
  subtotal: number;
  discountPercent?: number;
  discountAmount?: number;
  ivaRate: number;
  ivaAmount: number;
  total: number;
  paymentMethod?: string;
  changeAmount?: number;
  splitLabel?: string;
  sriClave?: string;
  invoiceNumber?: string;
  footerNote?: string;
}

export interface KitchenComandaPrintPayload {
  isDomicilio: boolean;
  tableLabel: string;
  isUpdate: boolean;
  items: OrderItem[];
  generalNotes?: string;
  sentAt: string;
}

type ActivePrintJob =
  | { kind: 'ride'; invoice: ElectronicInvoiceRecord; format: PaperFormat; isReprint: boolean }
  | { kind: 'receipt'; payload: ThermalReceiptPrintPayload; format: PaperFormat }
  | { kind: 'kitchen'; payload: KitchenComandaPrintPayload; format: PaperFormat }
  | { kind: 'test'; format: PaperFormat };

interface PrinterContextType {
  storeSettings: StorePrintSettings;
  printers: ExtendedPrinterDevice[];
  activeReceiptPrinter: ExtendedPrinterDevice;
  activeReportPrinter: ExtendedPrinterDevice;
  activeKitchenPrinter: ExtendedPrinterDevice;
  isScanning: boolean;
  isPrinting: boolean;
  hardwareStatusBanner: string | null;
  detectPrintersNow: () => Promise<ExtendedPrinterDevice[]>;
  pairUsbPrinter: () => Promise<ExtendedPrinterDevice | null>;
  pairSerialPrinter: () => Promise<ExtendedPrinterDevice | null>;
  addCustomNetworkPrinter: (name: string, paperSize: PaperFormat, connection: 'USB' | 'Red / Ethernet' | 'Bluetooth') => Promise<void>;
  removeCustomPrinter: (printerId: string) => Promise<void>;
  printRideInvoice: (
    invoice: ElectronicInvoiceRecord,
    options?: { formatOverride?: PaperFormat; isReprint?: boolean }
  ) => Promise<void>;
  printThermalReceipt: (
    payload: ThermalReceiptPrintPayload,
    formatOverride?: PaperFormat
  ) => Promise<void>;
  printKitchenComanda: (payload: KitchenComandaPrintPayload) => Promise<void>;
  printTestTicket: (formatOverride?: PaperFormat) => Promise<void>;
}

const DEFAULT_STORE_SETTINGS: StorePrintSettings = {
  localName: '',
  slogan: '',
  ruc: '',
  address: '',
  establishment: '',
  logoUrl: '/assets/gastrolab_fhd.jpg',
  ivaPercentage: 15,
  paperSize: '80mm',
  autoCut: true,
  receiptPrinter: DEFAULT_SYSTEM_THERMAL_PRINTER.name,
  reportsPrinter: DEFAULT_SYSTEM_OFFICE_PRINTER.name,
  kitchenPrinter: DEFAULT_SYSTEM_THERMAL_PRINTER.name,
  savedPrinters: [],
};

const PrinterContext = createContext<PrinterContextType | null>(null);

export const usePrinter = () => {
  const ctx = useContext(PrinterContext);
  if (!ctx) throw new Error('usePrinter debe usarse dentro de PrinterProvider');
  return ctx;
};

export const PrinterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [storeSettings, setStoreSettings] = useState<StorePrintSettings>(DEFAULT_STORE_SETTINGS);
  const [usbPrinters, setUsbPrinters] = useState<ExtendedPrinterDevice[]>([]);
  const [serialPrinters, setSerialPrinters] = useState<ExtendedPrinterDevice[]>([]);
  const [driverPrinters, setDriverPrinters] = useState<ExtendedPrinterDevice[]>(SIMULATED_DRIVER_PRINTERS);
  const [isScanning, setIsScanning] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [hardwareStatusBanner, setHardwareStatusBanner] = useState<string | null>(null);
  const [activePrintJob, setActivePrintJob] = useState<ActivePrintJob | null>(null);

  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const printLockRef = useRef(false);

  const showBanner = useCallback((msg: string) => {
    setHardwareStatusBanner(msg);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setHardwareStatusBanner(null), 5000);
  }, []);

  // Load store settings & printer defaults live from Firestore (settings/general)
  useEffect(() => {
    try {
      const cached = localStorage.getItem('gastrolab_settings_backup');
      if (cached) {
        const d = JSON.parse(cached);
        setStoreSettings((prev) => ({
          ...prev,
          localName: d.localName ?? prev.localName,
          slogan: d.slogan ?? prev.slogan,
          ruc: d.ruc ?? prev.ruc,
          address: d.address ?? prev.address,
          establishment: d.establishment || prev.establishment,
          logoUrl: d.logoUrl || prev.logoUrl,
          ivaPercentage: d.ivaPercentage !== undefined ? Number(d.ivaPercentage) : prev.ivaPercentage,
          paperSize: d.paperSize || prev.paperSize,
          autoCut: d.autoCut !== undefined ? Boolean(d.autoCut) : prev.autoCut,
          receiptPrinter: d.receiptPrinter || prev.receiptPrinter,
          reportsPrinter: d.reportsPrinter || prev.reportsPrinter,
          kitchenPrinter: d.kitchenPrinter || prev.kitchenPrinter,
          savedPrinters: Array.isArray(d.savedPrinters) ? d.savedPrinters : prev.savedPrinters,
        }));
      }
    } catch {
      // Ignore storage error
    }

    let cancelled = false;
    let unsub: (() => void) | null = null;

    auth.authStateReady().then(() => {
      if (cancelled) return;
      unsub = onSnapshot(
        doc(db, 'settings', 'general'),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data() as any;
            setStoreSettings((prev) => ({
              ...prev,
              localName: d.localName ?? prev.localName,
              slogan: d.slogan ?? prev.slogan,
              ruc: d.ruc ?? prev.ruc,
              address: d.address ?? prev.address,
              establishment: d.establishment || prev.establishment,
              logoUrl: d.logoUrl || prev.logoUrl,
              ivaPercentage: d.ivaPercentage !== undefined ? Number(d.ivaPercentage) : prev.ivaPercentage,
              paperSize: d.paperSize || prev.paperSize,
              autoCut: d.autoCut !== undefined ? Boolean(d.autoCut) : prev.autoCut,
              receiptPrinter: d.receiptPrinter || prev.receiptPrinter,
              reportsPrinter: d.reportsPrinter || prev.reportsPrinter,
              kitchenPrinter: d.kitchenPrinter || prev.kitchenPrinter,
              savedPrinters: Array.isArray(d.savedPrinters) ? d.savedPrinters : prev.savedPrinters,
            }));
          }
        },
        (err) => console.warn('PrinterProvider settings listener notice:', err)
      );
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  // Merge all real detected hardware + OS system printers + saved custom printers
  const printers = React.useMemo<ExtendedPrinterDevice[]>(() => {
    const merged: ExtendedPrinterDevice[] = [];
    const seenIds = new Set<string>();

    // 1. Live WebUSB & WebSerial connected hardware first
    [...usbPrinters, ...serialPrinters].forEach((p) => {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        merged.push({
          ...p,
          isDefaultReceipt: storeSettings.receiptPrinter === p.name,
          isDefaultReport: storeSettings.reportsPrinter === p.name,
        });
      }
    });

    // 2. Saved custom / network printers from Firestore
    (storeSettings.savedPrinters || []).forEach((p) => {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        merged.push({
          ...p,
          isDefaultReceipt: storeSettings.receiptPrinter === p.name,
          isDefaultReport: storeSettings.reportsPrinter === p.name,
        });
      }
    });

    // 3. Always include Real OS Print Spooler profiles (supports any Epson/HP/Canon/Thermal installed in Windows/macOS/Android)
    const sysThermal: ExtendedPrinterDevice = {
      ...DEFAULT_SYSTEM_THERMAL_PRINTER,
      paperSize: storeSettings.paperSize === '58mm' ? '58mm' : '80mm',
      isDefaultReceipt:
        storeSettings.receiptPrinter === DEFAULT_SYSTEM_THERMAL_PRINTER.name ||
        !merged.some((m) => m.name === storeSettings.receiptPrinter),
      isDefaultReport: storeSettings.reportsPrinter === DEFAULT_SYSTEM_THERMAL_PRINTER.name,
    };

    const sysOffice: ExtendedPrinterDevice = {
      ...DEFAULT_SYSTEM_OFFICE_PRINTER,
      isDefaultReceipt: storeSettings.receiptPrinter === DEFAULT_SYSTEM_OFFICE_PRINTER.name,
      isDefaultReport:
        storeSettings.reportsPrinter === DEFAULT_SYSTEM_OFFICE_PRINTER.name ||
        !merged.some((m) => m.name === storeSettings.reportsPrinter),
    };

    merged.push(sysThermal, sysOffice);

    // 4. Detected OS / Driver profiles (Epson TM-T20III, Térmica 58mm, Epson EcoTank Normal Carta/A4)
    driverPrinters.forEach((dp) => {
      if (!seenIds.has(dp.id)) {
        seenIds.add(dp.id);
        merged.push({
          ...dp,
          isDefaultReceipt: storeSettings.receiptPrinter === dp.name,
          isDefaultReport: storeSettings.reportsPrinter === dp.name,
        });
      }
    });

    return merged;
  }, [usbPrinters, serialPrinters, driverPrinters, storeSettings]);

  const activeReceiptPrinter = React.useMemo(() => {
    return (
      printers.find((p) => p.name === storeSettings.receiptPrinter) ||
      usbPrinters[0] ||
      serialPrinters[0] ||
      DEFAULT_SYSTEM_THERMAL_PRINTER
    );
  }, [printers, storeSettings.receiptPrinter, usbPrinters, serialPrinters]);

  const activeReportPrinter = React.useMemo(() => {
    return (
      printers.find((p) => p.name === storeSettings.reportsPrinter) ||
      DEFAULT_SYSTEM_OFFICE_PRINTER
    );
  }, [printers, storeSettings.reportsPrinter]);

  const activeKitchenPrinter = React.useMemo(() => {
    return (
      printers.find((p) => p.name === storeSettings.kitchenPrinter) ||
      activeReceiptPrinter
    );
  }, [printers, storeSettings.kitchenPrinter, activeReceiptPrinter]);

  const receiptPrinterRef = useRef(storeSettings.receiptPrinter);
  useEffect(() => {
    receiptPrinterRef.current = storeSettings.receiptPrinter;
  }, [storeSettings.receiptPrinter]);

  const detectPrintersNow = useCallback(async (): Promise<ExtendedPrinterDevice[]> => {
    setIsScanning(true);
    try {
      const [foundUsb, foundSerial] = await Promise.all([
        scanConnectedUsbPrinters(),
        scanConnectedSerialPrinters(),
      ]);
      setUsbPrinters((prev) =>
        prev.length === foundUsb.length && prev.every((p, i) => p.id === foundUsb[i]?.id && p.name === foundUsb[i]?.name)
          ? prev
          : foundUsb
      );
      setSerialPrinters((prev) =>
        prev.length === foundSerial.length && prev.every((p, i) => p.id === foundSerial[i]?.id && p.name === foundSerial[i]?.name)
          ? prev
          : foundSerial
      );

      const refreshedDrivers = SIMULATED_DRIVER_PRINTERS;
      setDriverPrinters((prev) => (prev === refreshedDrivers ? prev : refreshedDrivers));

      // Auto-select newly detected physical USB/Serial receipt printer if user is on default
      const physicalDetected = [...foundUsb, ...foundSerial];
      if (physicalDetected.length > 0) {
        const thermalFirst = physicalDetected.find((p) => p.paperSize !== 'A4') || physicalDetected[0];
        const officeFirst = physicalDetected.find((p) => p.paperSize === 'A4');
        showBanner(
          `Detección automática: ${physicalDetected.length} impresora(s) USB/Serie activa(s) + ${refreshedDrivers.length} drivers Epson/Térmica/Carta listos.`
        );
        // Persist detected selection only if current printer was empty or default
        const currentReceiptPrinter = receiptPrinterRef.current;
        if (
          thermalFirst &&
          (currentReceiptPrinter === DEFAULT_SYSTEM_THERMAL_PRINTER.name ||
            !currentReceiptPrinter)
        ) {
          setDoc(
            doc(db, 'settings', 'general'),
            {
              receiptPrinter: thermalFirst.name,
              paperSize: thermalFirst.paperSize,
              ...(officeFirst ? { reportsPrinter: officeFirst.name } : {}),
            },
            { merge: true }
          ).catch(() => {});
        }
      } else {
        showBanner(
          `Detección completada: Perfiles Epson Térmica 80mm, Térmica 58mm, Epson Normal Carta/A4 y Spooler del Sistema cargados.`
        );
      }
      return [
        ...physicalDetected,
        DEFAULT_SYSTEM_THERMAL_PRINTER,
        DEFAULT_SYSTEM_OFFICE_PRINTER,
        ...refreshedDrivers,
      ];
    } finally {
      setIsScanning(false);
    }
  }, [showBanner]);

  // Automatic real-time USB & Serial hardware plug-and-play detection listeners
  useEffect(() => {
    detectPrintersNow();

    const handleUsbConnect = async () => {
      const found = await scanConnectedUsbPrinters();
      setUsbPrinters(found);
      if (found.length > 0) {
        const newest = found[found.length - 1];
        showBanner(`Impresora USB conectada y cargada automáticamente: ${newest.name}`);
      }
    };

    const handleUsbDisconnect = async () => {
      const found = await scanConnectedUsbPrinters();
      setUsbPrinters(found);
      showBanner('Una impresora USB fue desconectada. Respaldo automático a Impresora del Sistema activo.');
    };

    const handleSerialChange = async () => {
      const found = await scanConnectedSerialPrinters();
      setSerialPrinters(found);
    };

    if (isWebUsbAvailable()) {
      const usb = (navigator as any).usb;
      usb.addEventListener?.('connect', handleUsbConnect);
      usb.addEventListener?.('disconnect', handleUsbDisconnect);
    }
    if (isWebSerialAvailable()) {
      const serial = (navigator as any).serial;
      serial.addEventListener?.('connect', handleSerialChange);
      serial.addEventListener?.('disconnect', handleSerialChange);
    }

    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      if (isWebUsbAvailable()) {
        const usb = (navigator as any).usb;
        usb.removeEventListener?.('connect', handleUsbConnect);
        usb.removeEventListener?.('disconnect', handleUsbDisconnect);
      }
      if (isWebSerialAvailable()) {
        const serial = (navigator as any).serial;
        serial.removeEventListener?.('connect', handleSerialChange);
        serial.removeEventListener?.('disconnect', handleSerialChange);
      }
    };
  }, [detectPrintersNow, showBanner]);

  const pairUsbPrinter = useCallback(async () => {
    const dev = await requestUsbPrinterPairing();
    if (dev) {
      await detectPrintersNow();
      await setDoc(
        doc(db, 'settings', 'general'),
        {
          receiptPrinter: dev.name,
          paperSize: dev.paperSize,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
      showBanner(`Impresora "${dev.name}" vinculada y seleccionada automáticamente.`);
    }
    return dev;
  }, [detectPrintersNow, showBanner]);

  const pairSerialPrinter = useCallback(async () => {
    const dev = await requestSerialPrinterPairing();
    if (dev) {
      await detectPrintersNow();
      await setDoc(
        doc(db, 'settings', 'general'),
        {
          receiptPrinter: dev.name,
          paperSize: dev.paperSize,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
      showBanner(`Impresora serie "${dev.name}" vinculada y seleccionada.`);
    }
    return dev;
  }, [detectPrintersNow, showBanner]);

  const addCustomNetworkPrinter = useCallback(
    async (name: string, paperSize: PaperFormat, connection: 'USB' | 'Red / Ethernet' | 'Bluetooth') => {
      const cleanName = name.trim();
      if (!cleanName) return;
      const newPrinter: ExtendedPrinterDevice = {
        id: `custom-${Date.now()}`,
        name: cleanName,
        type: paperSize === 'A4' ? 'standard_office' : 'thermal_receipt',
        connection,
        status: 'online',
        paperSize,
        source: 'custom_network',
        supportsEscPos: paperSize !== 'A4',
        lastSeenAt: new Date().toISOString(),
      };
      const nextSaved = [...(storeSettings.savedPrinters || []), newPrinter];
      await setDoc(
        doc(db, 'settings', 'general'),
        {
          savedPrinters: nextSaved,
          receiptPrinter: cleanName,
          paperSize,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      showBanner(`Impresora "${cleanName}" agregada y lista para imprimir.`);
    },
    [storeSettings.savedPrinters, showBanner]
  );

  const removeCustomPrinter = useCallback(
    async (printerId: string) => {
      const nextSaved = (storeSettings.savedPrinters || []).filter((p) => p.id !== printerId);
      await setDoc(
        doc(db, 'settings', 'general'),
        { savedPrinters: nextSaved, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    },
    [storeSettings.savedPrinters]
  );

  // Core browser print orchestrator using body-level #gastrolab-print-root portal
  const triggerPortalPrint = useCallback(
    async (job: ActivePrintJob, format: PaperFormat) => {
      if (printLockRef.current) return;
      printLockRef.current = true;
      setIsPrinting(true);

      try {
        applyDynamicPrintPageStyle(format);
        setActivePrintJob(job);

        // Wait for React to commit the portal DOM
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );

        // Wait briefly for any logo image inside the portal to finish decoding
        const rootEl = document.getElementById('gastrolab-print-root');
        if (rootEl) {
          const imgs = Array.from(rootEl.querySelectorAll('img'));
          await Promise.race([
            Promise.all(
              imgs.map((img) =>
                img.complete
                  ? Promise.resolve()
                  : new Promise<void>((res) => {
                      img.onload = () => res();
                      img.onerror = () => res();
                    })
              )
            ),
            new Promise<void>((res) => setTimeout(res, 600)),
          ]);
        }

        document.body.classList.add('gastrolab-portal-printing');

        await new Promise<void>((resolve) => {
          let finished = false;
          const cleanup = () => {
            if (finished) return;
            finished = true;
            window.removeEventListener('afterprint', cleanup);
            resolve();
          };
          window.addEventListener('afterprint', cleanup);
          try {
            window.print();
          } catch (err) {
            console.warn('Print dialog trigger notice:', err);
          }
          // Safety fallback in case browser blocks/closes print synchronously or headless
          setTimeout(cleanup, 1200);
        });
      } finally {
        document.body.classList.remove('gastrolab-portal-printing');
        setActivePrintJob(null);
        setIsPrinting(false);
        printLockRef.current = false;
      }
    },
    []
  );

  const tryDirectHardwareEscPos = useCallback(
    async (printer: ExtendedPrinterDevice, bytes: Uint8Array): Promise<boolean> => {
      if (printer.source === 'webusb' && printer.vendorId && printer.productId) {
        return await sendBytesToUsbPrinter(printer.vendorId, printer.productId, bytes);
      }
      if (printer.source === 'webserial') {
        return await sendBytesToSerialPrinter(printer.serialPortIndex || 0, bytes);
      }
      return false;
    },
    []
  );

  const printRideInvoice = useCallback(
    async (
      invoice: ElectronicInvoiceRecord,
      options?: { formatOverride?: PaperFormat; isReprint?: boolean }
    ) => {
      const targetFormat: PaperFormat =
        options?.formatOverride ||
        (activeReceiptPrinter?.paperSize && activeReceiptPrinter.source !== 'system_spooler'
          ? activeReceiptPrinter.paperSize
          : storeSettings.paperSize || 'A4');
      const isReprint = Boolean(options?.isReprint);

      // If direct WebUSB / WebSerial thermal printer is selected and format is thermal, try raw ESC/POS first
      if (targetFormat !== 'A4' && activeReceiptPrinter.supportsEscPos) {
        const escBytes = buildEscPosRideBytes(
          invoice,
          storeSettings,
          targetFormat,
          isReprint,
          storeSettings.autoCut
        );
        const sentDirect = await tryDirectHardwareEscPos(activeReceiptPrinter, escBytes);
        if (sentDirect) {
          showBanner(`RIDE N° ${invoice.invoiceNumber} impreso directo en ${activeReceiptPrinter.name}.`);
          return;
        }
      }

      // Universal OS Printer Spooler path (works with Epson normal A4, HP, Canon, and any 58mm/80mm thermal driver)
      await triggerPortalPrint(
        { kind: 'ride', invoice, format: targetFormat, isReprint },
        targetFormat
      );
    },
    [activeReceiptPrinter, storeSettings, triggerPortalPrint, tryDirectHardwareEscPos, showBanner]
  );

  const printThermalReceipt = useCallback(
    async (payload: ThermalReceiptPrintPayload, formatOverride?: PaperFormat) => {
      const targetFormat: PaperFormat =
        formatOverride || (storeSettings.paperSize === '58mm' ? '58mm' : storeSettings.paperSize === 'A4' ? 'A4' : '80mm');

      if (targetFormat !== 'A4' && activeReceiptPrinter.supportsEscPos) {
        const escBytes = buildEscPosTicketBytes(
          storeSettings.localName || 'GASTROLAB',
          `RUC: ${storeSettings.ruc} · ${payload.tableLabel}`,
          payload.items,
          [
            { label: 'Subtotal:', value: `$${payload.subtotal.toFixed(2)}` },
            ...(payload.discountPercent && payload.discountPercent > 0
              ? [{ label: `Descuento (${payload.discountPercent}%):`, value: `-$${(payload.discountAmount || 0).toFixed(2)}` }]
              : []),
            { label: `IVA (${payload.ivaRate}%):`, value: `$${payload.ivaAmount.toFixed(2)}` },
            { label: 'TOTAL:', value: `$${payload.total.toFixed(2)}`, bold: true },
          ],
          [
            `Cliente: ${payload.clientName}`,
            `RUC/CI: ${payload.clientId}`,
            ...(payload.sriClave ? [`Clave SRI: ${payload.sriClave}`] : []),
            payload.footerNote || 'Gracias por su preferencia!',
          ],
          targetFormat,
          storeSettings.autoCut
        );
        const sentDirect = await tryDirectHardwareEscPos(activeReceiptPrinter, escBytes);
        if (sentDirect) return;
      }

      await triggerPortalPrint({ kind: 'receipt', payload, format: targetFormat }, targetFormat);
    },
    [activeReceiptPrinter, storeSettings, triggerPortalPrint, tryDirectHardwareEscPos]
  );

  const printKitchenComanda = useCallback(
    async (payload: KitchenComandaPrintPayload) => {
      const targetFormat: PaperFormat =
        storeSettings.paperSize === '58mm'
          ? '58mm'
          : storeSettings.paperSize === 'A4'
          ? 'A4'
          : '80mm';

      if (targetFormat !== 'A4' && activeKitchenPrinter.supportsEscPos) {
        const escBytes = buildEscPosTicketBytes(
          'COMANDA DE COCINA',
          `${payload.tableLabel}${payload.isUpdate ? ' - ACTUALIZACION' : ''}`,
          payload.items,
          [{ label: 'Hora:', value: new Date(payload.sentAt).toLocaleTimeString('es-EC') }],
          payload.generalNotes ? [`NOTA: ${payload.generalNotes}`] : [],
          targetFormat,
          storeSettings.autoCut
        );
        const sentDirect = await tryDirectHardwareEscPos(activeKitchenPrinter, escBytes);
        if (sentDirect) return;
      }

      await triggerPortalPrint({ kind: 'kitchen', payload, format: targetFormat }, targetFormat);
    },
    [activeKitchenPrinter, storeSettings, triggerPortalPrint, tryDirectHardwareEscPos]
  );

  const printTestTicket = useCallback(
    async (formatOverride?: PaperFormat) => {
      const targetFormat: PaperFormat = formatOverride || storeSettings.paperSize || '80mm';
      if (targetFormat !== 'A4' && activeReceiptPrinter.supportsEscPos) {
        const escBytes = buildEscPosTicketBytes(
          storeSettings.localName || 'GASTROLAB',
          `PRUEBA DE IMPRESORA: ${activeReceiptPrinter.name}`,
          [{ productId: 'test', name: 'Lomo Fino Demi-Glace', price: 18.5, quantity: 1 }],
          [
            { label: 'Subtotal:', value: '$18.50' },
            { label: `IVA (${storeSettings.ivaPercentage}%):`, value: `$${((18.5 * storeSettings.ivaPercentage) / 100).toFixed(2)}` },
            { label: 'TOTAL:', value: `$${(18.5 * (1 + storeSettings.ivaPercentage / 100)).toFixed(2)}`, bold: true },
          ],
          ['Prueba exitosa en impresora ESC/POS', 'GASTROLAB by Ivan Munoz'],
          targetFormat,
          storeSettings.autoCut
        );
        const sentDirect = await tryDirectHardwareEscPos(activeReceiptPrinter, escBytes);
        if (sentDirect) {
          showBanner(`Prueba enviada directamente a ${activeReceiptPrinter.name}.`);
          return;
        }
      }
      await triggerPortalPrint({ kind: 'test', format: targetFormat }, targetFormat);
    },
    [activeReceiptPrinter, storeSettings, triggerPortalPrint, tryDirectHardwareEscPos, showBanner]
  );

  const renderPortalJob = () => {
    if (!activePrintJob || typeof document === 'undefined') return null;

    return createPortal(
      <div id="gastrolab-print-root" className="hidden print:block bg-white text-black">
        {activePrintJob.kind === 'ride' && (
          <RidePrintDocument
            invoice={activePrintJob.invoice}
            store={storeSettings}
            format={activePrintJob.format}
            isReprint={activePrintJob.isReprint}
            autoCut={storeSettings.autoCut}
          />
        )}

        {activePrintJob.kind === 'receipt' && (
          <div
            data-auto-cut={storeSettings.autoCut ? 'true' : 'false'}
            className={`bg-white text-black font-mono mx-auto p-3 space-y-2 ${
              activePrintJob.format === '58mm'
                ? 'text-[10px]'
                : activePrintJob.format === 'A4'
                ? 'text-xs'
                : 'text-[11px]'
            } ${storeSettings.autoCut ? 'gastrolab-thermal-autocut' : ''}`}
            style={{
              width:
                activePrintJob.format === '58mm'
                  ? '52mm'
                  : activePrintJob.format === '80mm'
                  ? '74mm'
                  : '100%',
              maxWidth: activePrintJob.format === 'A4' ? '185mm' : '100%',
            }}
          >
            <div className="text-center space-y-0.5">
              {storeSettings.logoUrl && (
                <img
                  src={storeSettings.logoUrl}
                  alt={storeSettings.localName}
                  className="h-10 w-auto object-contain mx-auto mb-1"
                />
              )}
              <div className="font-black text-xs uppercase">
                {storeSettings.localName || 'GASTROLAB'}
              </div>
              {storeSettings.ruc && <div>RUC: {storeSettings.ruc}</div>}
              {storeSettings.address && <div className="text-[10px]">{storeSettings.address}</div>}
              {activePrintJob.payload.title && (
                <div className="font-black border-y border-dashed border-black py-1 mt-1">
                  {activePrintJob.payload.title}
                </div>
              )}
            </div>

            <div className="border-b border-dashed border-black pb-1 space-y-0.5">
              <div className="flex justify-between font-bold">
                <span>{activePrintJob.payload.tableLabel}</span>
                <span>{new Date().toLocaleDateString('es-EC')}</span>
              </div>
              {activePrintJob.payload.isDomicilio && (
                <div className="text-center font-black border border-black py-0.5">
                  *** DOMICILIO ***
                </div>
              )}
              <div>
                <strong>CLIENTE:</strong> {activePrintJob.payload.clientName}
              </div>
              <div>
                <strong>RUC/CI:</strong> {activePrintJob.payload.clientId}
              </div>
              {activePrintJob.payload.clientEmail && (
                <div className="break-all">
                  <strong>EMAIL:</strong> {activePrintJob.payload.clientEmail}
                </div>
              )}
              {activePrintJob.payload.clientAddress && (
                <div>
                  <strong>DIRECCIÓN:</strong> {activePrintJob.payload.clientAddress}
                </div>
              )}
              {activePrintJob.payload.clientPhone && (
                <div>
                  <strong>TEL:</strong> {activePrintJob.payload.clientPhone}
                </div>
              )}
              {activePrintJob.payload.splitLabel && (
                <div className="font-bold">{activePrintJob.payload.splitLabel}</div>
              )}
            </div>

            <div className="space-y-1 border-b border-dashed border-black pb-1">
              {activePrintJob.payload.items.map((it, idx) => (
                <div key={idx} className="space-y-0.5">
                  <div className="flex justify-between gap-2">
                    <span>
                      {it.quantity}x {it.name}
                    </span>
                    <span className="font-bold shrink-0">
                      ${(it.price * it.quantity).toFixed(2)}
                    </span>
                  </div>
                  {it.dinerName && it.dinerName.trim() !== '' && (
                    <div className="text-[9px] font-bold pl-2">COMENSAL: {it.dinerName}</div>
                  )}
                  {it.selectedCustomizations && it.selectedCustomizations.length > 0 && (
                    <div className="text-[9px] pl-2 space-y-0.5">
                      {groupOrderCustomizations(it.selectedCustomizations).map((grp, gIdx) => (
                        <div key={gIdx}>
                          <div className="font-bold">{grp.groupLabel}</div>
                          {grp.options.map((opt, oIdx) => (
                            <div key={oIdx} className="pl-2">
                              • {opt.optionName}
                              {opt.extraPrice > 0 ? ` (+$${opt.extraPrice.toFixed(2)})` : ''}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-0.5">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>${activePrintJob.payload.subtotal.toFixed(2)}</span>
              </div>
              {activePrintJob.payload.discountPercent &&
              activePrintJob.payload.discountPercent > 0 ? (
                <div className="flex justify-between font-bold">
                  <span>Descuento ({activePrintJob.payload.discountPercent}%):</span>
                  <span>-${(activePrintJob.payload.discountAmount || 0).toFixed(2)}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span>IVA ({activePrintJob.payload.ivaRate}%):</span>
                <span>${activePrintJob.payload.ivaAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-black text-xs border-t border-black pt-1">
                <span>TOTAL A PAGAR:</span>
                <span>${activePrintJob.payload.total.toFixed(2)}</span>
              </div>
            </div>

            {activePrintJob.payload.paymentMethod && (
              <div className="flex justify-between text-[10px] pt-1">
                <span>Método: {activePrintJob.payload.paymentMethod}</span>
                {activePrintJob.payload.paymentMethod === 'Efectivo' &&
                  activePrintJob.payload.changeAmount !== undefined && (
                    <span>Cambio: ${activePrintJob.payload.changeAmount.toFixed(2)}</span>
                  )}
              </div>
            )}

            {activePrintJob.payload.isPrecuenta && (
              <div className="border-t border-dashed border-black pt-2 mt-2 space-y-2 text-[10px]">
                <div className="text-center font-black uppercase">
                  DATOS PARA FACTURA (LLENAR)
                </div>
                <div className="flex justify-between font-bold">
                  <span>CONSUMIDOR FINAL:</span>
                  <span>(   )</span>
                </div>
                <div>
                  <div className="text-[9px] font-bold">Nombre / Razón Social:</div>
                  <div className="border-b border-black h-4 w-full" />
                </div>
                <div>
                  <div className="text-[9px] font-bold">RUC / Cédula:</div>
                  <div className="border-b border-black h-4 w-full" />
                </div>
                <div>
                  <div className="text-[9px] font-bold">Correo Electrónico:</div>
                  <div className="border-b border-black h-4 w-full" />
                </div>
                <div>
                  <div className="text-[9px] font-bold">Dirección:</div>
                  <div className="border-b border-black h-4 w-full" />
                </div>
                <div>
                  <div className="text-[9px] font-bold">Teléfono:</div>
                  <div className="border-b border-black h-4 w-full" />
                </div>
                <div>
                  <div className="text-[9px] font-bold">Propina ($):</div>
                  <div className="border-b border-black h-4 w-full" />
                </div>
              </div>
            )}

            <div className="text-center pt-2 border-t border-dashed border-black text-[9px]">
              <div>*** GRACIAS POR SU PREFERENCIA ***</div>
              <div>{activePrintJob.payload.footerNote || 'GASTROLAB by Iván Muñoz'}</div>
            </div>
            {storeSettings.autoCut && (
              <div className="gastrolab-cut-feed-line">--- ✂ CORTE AUTOMÁTICO ---</div>
            )}
          </div>
        )}

        {activePrintJob.kind === 'kitchen' && (
          <div
            data-auto-cut={storeSettings.autoCut ? 'true' : 'false'}
            className={`bg-white text-black font-mono p-2 space-y-2 mx-auto ${
              storeSettings.autoCut ? 'gastrolab-thermal-autocut' : ''
            }`}
            style={{
              width:
                activePrintJob.format === '58mm'
                  ? '52mm'
                  : activePrintJob.format === 'A4'
                  ? '185mm'
                  : '74mm',
              maxWidth: '100%',
            }}
          >
            <div className="text-center font-black text-sm uppercase">COMANDA DE COCINA</div>
            <div className="text-center text-[10px]">{storeSettings.localName || 'GASTROLAB'}</div>
            {activePrintJob.payload.isDomicilio ? (
              <div className="text-center font-black text-2xl uppercase tracking-widest border-2 border-black py-1.5 my-1">
                DOMICILIO
              </div>
            ) : (
              <div className="text-center font-black text-lg uppercase border border-black py-1">
                {activePrintJob.payload.tableLabel}
              </div>
            )}
            {activePrintJob.payload.isUpdate && (
              <div className="text-center font-black text-xs uppercase bg-black text-white py-1">
                *** ACTUALIZACIÓN - SOLO NUEVOS ***
              </div>
            )}
            <div className="text-[10px] flex justify-between border-b border-dashed border-black pb-1">
              <span>
                HORA: {new Date(activePrintJob.payload.sentAt).toLocaleTimeString('es-EC')}
              </span>
              <span>{activePrintJob.payload.isDomicilio ? 'PARA ENTREGA' : 'SALÓN'}</span>
            </div>
            <div className="space-y-1.5 pt-1">
              {activePrintJob.payload.items.map((item, idx) => (
                <div key={idx} className="border-b border-dotted border-gray-500 pb-1">
                  {item.dinerName && item.dinerName.trim() !== '' && (
                    <div className="text-xs font-black uppercase bg-gray-100 border border-black px-1.5 py-0.5 mb-0.5 inline-block">
                      COMENSAL: {item.dinerName}
                    </div>
                  )}
                  <div className="font-black text-sm">
                    {item.quantity}x {item.name}
                  </div>
                  {item.selectedCustomizations && item.selectedCustomizations.length > 0 && (
                    <div className="text-[11px] font-bold pl-2 mt-0.5 space-y-0.5">
                      {groupOrderCustomizations(item.selectedCustomizations).map((grp, gIdx) => (
                        <div key={gIdx}>
                          <div className="font-black uppercase">{grp.groupLabel}</div>
                          <div className="pl-2 space-y-0.5">
                            {grp.options.map((opt, oIdx) => (
                              <div key={oIdx}>
                                • {opt.optionName}
                                {opt.extraPrice > 0 ? ` (+$${opt.extraPrice.toFixed(2)})` : ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {item.notes && item.notes.trim() !== '' && (
                    <div className="text-xs font-bold pl-2 mt-0.5">NOTA: {item.notes}</div>
                  )}
                </div>
              ))}
            </div>
            {activePrintJob.payload.generalNotes &&
              activePrintJob.payload.generalNotes.trim() !== '' && (
                <div className="border-2 border-black p-1.5 mt-2">
                  <div className="text-[10px] font-black uppercase">NOTA GENERAL:</div>
                  <div className="text-xs font-bold">{activePrintJob.payload.generalNotes}</div>
                </div>
              )}
            {storeSettings.autoCut && (
              <div className="gastrolab-cut-feed-line">--- ✂ CORTE AUTOMÁTICO ---</div>
            )}
          </div>
        )}

        {activePrintJob.kind === 'test' && (
          <div
            data-auto-cut={storeSettings.autoCut ? 'true' : 'false'}
            className={`bg-white text-black font-mono text-[11px] p-3 space-y-2 mx-auto ${
              storeSettings.autoCut ? 'gastrolab-thermal-autocut' : ''
            }`}
            style={{
              width:
                activePrintJob.format === '58mm'
                  ? '52mm'
                  : activePrintJob.format === '80mm'
                  ? '74mm'
                  : '185mm',
            }}
          >
            <div className="text-center font-black text-xs uppercase">
              {storeSettings.localName} — PRUEBA DE IMPRESIÓN
            </div>
            <div className="text-center text-[10px]">
              RUC: {storeSettings.ruc} · {storeSettings.address}
            </div>
            <div className="border-t border-dashed border-black my-1" />
            <div className="flex justify-between text-[10px]">
              <span>Impresora: {activeReceiptPrinter.name}</span>
              <span>Formato: {activePrintJob.format}</span>
            </div>
            <div className="border-t border-dashed border-black my-1" />
            <div className="flex justify-between font-bold">
              <span>1x Lomo Fino Demi-Glace</span>
              <span>$18.50</span>
            </div>
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>$18.50</span>
            </div>
            <div className="flex justify-between">
              <span>IVA ({storeSettings.ivaPercentage}%):</span>
              <span>${((18.5 * storeSettings.ivaPercentage) / 100).toFixed(2)}</span>
            </div>
            <div className="border-t border-black pt-1 flex justify-between font-black text-xs">
              <span>TOTAL A PAGAR:</span>
              <span>${(18.5 * (1 + storeSettings.ivaPercentage / 100)).toFixed(2)}</span>
            </div>
            <div className="text-center pt-2 text-[9px] border-t border-dashed border-black">
              ¡Impresión configurada y funcionando al 100%!
            </div>
            {storeSettings.autoCut && (
              <div className="gastrolab-cut-feed-line">--- ✂ CORTE AUTOMÁTICO ---</div>
            )}
          </div>
        )}
      </div>,
      document.body
    );
  };

  const contextValue = useMemo<PrinterContextType>(
    () => ({
      storeSettings,
      printers,
      activeReceiptPrinter,
      activeReportPrinter,
      activeKitchenPrinter,
      isScanning,
      isPrinting,
      hardwareStatusBanner,
      detectPrintersNow,
      pairUsbPrinter,
      pairSerialPrinter,
      addCustomNetworkPrinter,
      removeCustomPrinter,
      printRideInvoice,
      printThermalReceipt,
      printKitchenComanda,
      printTestTicket,
    }),
    [
      storeSettings,
      printers,
      activeReceiptPrinter,
      activeReportPrinter,
      activeKitchenPrinter,
      isScanning,
      isPrinting,
      hardwareStatusBanner,
      detectPrintersNow,
      pairUsbPrinter,
      pairSerialPrinter,
      addCustomNetworkPrinter,
      removeCustomPrinter,
      printRideInvoice,
      printThermalReceipt,
      printKitchenComanda,
      printTestTicket,
    ]
  );

  return (
    <PrinterContext.Provider value={contextValue}>
      {children}
      {renderPortalJob()}
    </PrinterContext.Provider>
  );
};
