import { OrderItem, PrinterDevice } from '../types';
import { ElectronicInvoiceRecord, getSriPaymentMethodLabel } from './sriHelpers';
import { groupOrderCustomizations } from './customizationFormatters';

export type PaperFormat = '58mm' | '80mm' | 'A4';

export interface ExtendedPrinterDevice extends PrinterDevice {
  source: 'system_spooler' | 'webusb' | 'webserial' | 'custom_network';
  vendorId?: number;
  productId?: number;
  serialPortIndex?: number;
  supportsEscPos?: boolean;
  lastSeenAt?: string;
}

export interface StorePrintSettings {
  localName: string;
  slogan: string;
  ruc: string;
  address: string;
  establishment: string;
  logoUrl: string;
  ivaPercentage: number;
  paperSize: PaperFormat;
  autoCut: boolean;
  receiptPrinter: string;
  reportsPrinter: string;
  kitchenPrinter: string;
  savedPrinters: ExtendedPrinterDevice[];
}

export const DEFAULT_SYSTEM_THERMAL_PRINTER: ExtendedPrinterDevice = {
  id: 'sys-default-thermal',
  name: 'Impresora del Sistema — Térmica (80mm / 58mm)',
  type: 'thermal_receipt',
  connection: 'USB',
  status: 'online',
  paperSize: '80mm',
  source: 'system_spooler',
  supportsEscPos: false,
  isDefaultReceipt: true,
  isDefaultReport: false,
};

export const DEFAULT_SYSTEM_OFFICE_PRINTER: ExtendedPrinterDevice = {
  id: 'sys-default-office',
  name: 'Impresora del Sistema — Normal A4 / Carta (Epson / HP / Canon)',
  type: 'standard_office',
  connection: 'USB',
  status: 'online',
  paperSize: 'A4',
  source: 'system_spooler',
  supportsEscPos: false,
  isDefaultReceipt: false,
  isDefaultReport: true,
};

export const SIMULATED_DRIVER_PRINTERS: ExtendedPrinterDevice[] = [
  {
    id: 'drv-epson-thermal-80',
    name: 'Epson TM-T20III Térmica 80mm (Driver)',
    type: 'thermal_receipt',
    connection: 'USB',
    status: 'online',
    paperSize: '80mm',
    source: 'system_spooler',
    supportsEscPos: true,
  },
  {
    id: 'drv-pos-thermal-58',
    name: 'Impresora Térmica POS-58mm (Driver)',
    type: 'thermal_receipt',
    connection: 'USB',
    status: 'online',
    paperSize: '58mm',
    source: 'system_spooler',
    supportsEscPos: true,
  },
  {
    id: 'drv-epson-normal-a4',
    name: 'Epson EcoTank / Normal Carta-A4 (Driver)',
    type: 'standard_office',
    connection: 'Red / Ethernet',
    status: 'online',
    paperSize: 'A4',
    source: 'system_spooler',
    supportsEscPos: false,
  },
];

// Known thermal/POS printer USB vendor IDs
const KNOWN_POS_VENDORS: Record<number, string> = {
  0x04b8: 'Epson',
  0x0519: 'Star Micronics',
  0x1504: 'Bixolon',
  0x1d90: 'Citizen',
  0x0fe6: 'Xprinter / ICS',
  0x20d1: 'Xprinter POS',
  0x0483: 'POS Thermal (STM)',
  0x1a86: 'USB-POS / CH340',
  0x0403: 'FTDI POS',
  0x10c4: 'CP210x POS',
  0x03f0: 'HP',
  0x04a9: 'Canon',
  0x04f9: 'Brother',
};

export function isWebUsbAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator && !!(navigator as any).usb;
}

export function isWebSerialAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator && !!(navigator as any).serial;
}

function inferPaperAndType(name: string, vendorId?: number): {
  type: PrinterDevice['type'];
  paperSize: PaperFormat;
  supportsEscPos: boolean;
} {
  const lower = (name || '').toLowerCase();
  const isOfficeBrand = vendorId === 0x03f0 || vendorId === 0x04a9 || vendorId === 0x04f9;
  const isEpsonNormal =
    lower.includes('ecotank') ||
    lower.includes('l31') ||
    lower.includes('l32') ||
    lower.includes('l42') ||
    lower.includes('l52') ||
    lower.includes('workforce') ||
    lower.includes('expression') ||
    lower.includes('deskjet') ||
    lower.includes('laser') ||
    lower.includes('pixma') ||
    lower.includes('inkjet') ||
    lower.includes('a4');

  if (isOfficeBrand || isEpsonNormal) {
    return { type: 'standard_office', paperSize: 'A4', supportsEscPos: false };
  }
  if (lower.includes('58')) {
    return { type: 'thermal_receipt', paperSize: '58mm', supportsEscPos: true };
  }
  if (lower.includes('kitchen') || lower.includes('cocina')) {
    return { type: 'thermal_kitchen', paperSize: '80mm', supportsEscPos: true };
  }
  return { type: 'thermal_receipt', paperSize: '80mm', supportsEscPos: true };
}

function mapUsbDeviceToPrinter(device: any): ExtendedPrinterDevice {
  const vendorBrand = KNOWN_POS_VENDORS[device.vendorId] || 'USB';
  const productName =
    device.productName ||
    device.manufacturerName ||
    `${vendorBrand} Printer (${Number(device.vendorId || 0).toString(16)}:${Number(device.productId || 0).toString(16)})`;
  const fullName =
    device.manufacturerName && !productName.toLowerCase().includes(device.manufacturerName.toLowerCase())
      ? `${device.manufacturerName} ${productName}`.trim()
      : productName.trim();
  const inferred = inferPaperAndType(fullName, device.vendorId);

  return {
    id: `usb-${device.vendorId}-${device.productId}-${device.serialNumber || 'default'}`,
    name: fullName,
    type: inferred.type,
    connection: 'USB',
    status: 'online',
    paperSize: inferred.paperSize,
    source: 'webusb',
    vendorId: device.vendorId,
    productId: device.productId,
    supportsEscPos: inferred.supportsEscPos,
    lastSeenAt: new Date().toISOString(),
  };
}

export async function scanConnectedUsbPrinters(): Promise<ExtendedPrinterDevice[]> {
  if (!isWebUsbAvailable()) return [];
  try {
    const devices: any[] = await (navigator as any).usb.getDevices();
    return devices
      .filter((d) => {
        if (KNOWN_POS_VENDORS[d.vendorId]) return true;
        const ifaces = d.configuration?.interfaces || [];
        return ifaces.some((iface: any) =>
          (iface.alternates || []).some((alt: any) => alt.interfaceClass === 7)
        );
      })
      .map(mapUsbDeviceToPrinter);
  } catch {
    return [];
  }
}

export async function scanConnectedSerialPrinters(): Promise<ExtendedPrinterDevice[]> {
  if (!isWebSerialAvailable()) return [];
  try {
    const ports: any[] = await (navigator as any).serial.getPorts();
    return ports.map((port, idx) => {
      const info = typeof port.getInfo === 'function' ? port.getInfo() : {};
      const vendorBrand = info?.usbVendorId ? KNOWN_POS_VENDORS[info.usbVendorId] || 'Serie POS' : 'Puerto COM';
      return {
        id: `serial-${info?.usbVendorId || 'com'}-${info?.usbProductId || idx}-${idx}`,
        name: `Impresora Térmica Serie (${vendorBrand} #${idx + 1})`,
        type: 'thermal_receipt' as const,
        connection: 'USB' as const,
        status: 'online' as const,
        paperSize: '80mm' as const,
        source: 'webserial' as const,
        vendorId: info?.usbVendorId,
        productId: info?.usbProductId,
        serialPortIndex: idx,
        supportsEscPos: true,
        lastSeenAt: new Date().toISOString(),
      };
    });
  } catch {
    return [];
  }
}

export async function requestUsbPrinterPairing(): Promise<ExtendedPrinterDevice | null> {
  if (!isWebUsbAvailable()) {
    throw new Error('Tu navegador o vista previa actual no habilita WebUSB directo. Usa "Impresora del Sistema", que funciona con cualquier Epson, HP o térmica instalada.');
  }
  try {
    const device = await (navigator as any).usb.requestDevice({
      filters: [
        { classCode: 7 }, // USB Printer Class
        { vendorId: 0x04b8 }, // Epson
        { vendorId: 0x0519 }, // Star Micronics
        { vendorId: 0x1504 }, // Bixolon
        { vendorId: 0x1d90 }, // Citizen
        { vendorId: 0x0fe6 }, // Xprinter / ICS
        { vendorId: 0x20d1 }, // Xprinter POS
        { vendorId: 0x0483 }, // STM Thermal
        { vendorId: 0x1a86 }, // CH340 USB-POS
        { vendorId: 0x0403 }, // FTDI
        { vendorId: 0x10c4 }, // CP210x
        { vendorId: 0x03f0 }, // HP
        { vendorId: 0x04a9 }, // Canon
        { vendorId: 0x04f9 }, // Brother
      ],
    });
    return device ? mapUsbDeviceToPrinter(device) : null;
  } catch (err: any) {
    if (err?.name === 'NotFoundError') return null; // User cancelled chooser
    throw err;
  }
}

export async function requestSerialPrinterPairing(): Promise<ExtendedPrinterDevice | null> {
  if (!isWebSerialAvailable()) {
    throw new Error('Tu navegador no soporta WebSerial en este contexto. Usa "Impresora del Sistema".');
  }
  try {
    const port = await (navigator as any).serial.requestPort();
    if (!port) return null;
    const ports = await scanConnectedSerialPrinters();
    return ports[ports.length - 1] || null;
  } catch (err: any) {
    if (err?.name === 'NotFoundError') return null;
    throw err;
  }
}

// Convert Spanish accented characters to clean printer-safe ASCII for ESC/POS compatibility
function toPrinterAscii(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N')
    .replace(/[^\x20-\x7E\n\r]/g, '');
}

function padLine(left: string, right: string, width: number): string {
  const l = toPrinterAscii(left);
  const r = toPrinterAscii(right);
  const space = Math.max(1, width - l.length - r.length);
  if (l.length + r.length + 1 > width) {
    const clippedLeft = l.slice(0, Math.max(4, width - r.length - 1));
    return `${clippedLeft} ${r}`;
  }
  return `${l}${' '.repeat(space)}${r}`;
}

export function buildEscPosRideBytes(
  invoice: ElectronicInvoiceRecord,
  store: StorePrintSettings,
  paperWidthMm: '58mm' | '80mm',
  isReprint: boolean,
  autoCut: boolean
): Uint8Array {
  const cols = paperWidthMm === '58mm' ? 32 : 48;
  const sep = '-'.repeat(cols);
  const eq = '='.repeat(cols);
  const lines: string[] = [];

  lines.push('\x1b\x40'); // ESC @ Reset
  lines.push('\x1b\x61\x01'); // Center
  lines.push('\x1b\x45\x01'); // Bold on
  lines.push(toPrinterAscii((store.localName || 'GASTROLAB').toUpperCase()));
  lines.push('\x1b\x45\x00'); // Bold off
  if (store.ruc) lines.push(`RUC: ${toPrinterAscii(store.ruc)}`);
  if (store.address) lines.push(toPrinterAscii(store.address));
  lines.push(eq);
  lines.push('\x1b\x45\x01');
  lines.push(`FACTURA ELECTRONICA SRI`);
  lines.push(`No. ${toPrinterAscii(invoice.invoiceNumber)}`);
  lines.push('\x1b\x45\x00');
  if (isReprint) {
    lines.push('*** REIMPRESION / COPIA FISICA ***');
    lines.push('(COMPROBANTE YA AUTORIZADO EN SRI)');
  }
  lines.push(sep);
  lines.push('\x1b\x61\x00'); // Left align
  lines.push(`Fecha: ${new Date(invoice.date || invoice.createdAt || Date.now()).toLocaleString('es-EC')}`);
  lines.push(`Cliente: ${toPrinterAscii(invoice.client?.name || 'CONSUMIDOR FINAL')}`);
  lines.push(`${toPrinterAscii(invoice.client?.docType || 'RUC/CI')}: ${toPrinterAscii(invoice.client?.docNumber || '9999999999999')}`);
  if (invoice.client?.email) lines.push(`Email: ${toPrinterAscii(invoice.client.email)}`);
  if (invoice.client?.address) lines.push(`Dir: ${toPrinterAscii(invoice.client.address)}`);
  lines.push(sep);
  lines.push(padLine('CANT DESCRIPCION', 'TOTAL', cols));
  lines.push(sep);

  (invoice.items || []).forEach((it) => {
    const qty = Number(it.quantity) || 1;
    const price = Number(it.price) || 0;
    const lineTotal = `$${(qty * price).toFixed(2)}`;
    const desc = `${qty}x ${it.name}`;
    lines.push(padLine(desc, lineTotal, cols));
    const groupedCusts = groupOrderCustomizations((it as OrderItem).selectedCustomizations);
    if (groupedCusts.length > 0) {
      groupedCusts.forEach((grp) => {
        lines.push(`  ${toPrinterAscii(grp.groupLabel)}`);
        grp.options.forEach((opt) => {
          const extra = opt.extraPrice > 0 ? ` (+$${opt.extraPrice.toFixed(2)})` : '';
          lines.push(`    - ${toPrinterAscii(`${opt.optionName}${extra}`)}`);
        });
      });
    }
  });

  lines.push(sep);
  lines.push(padLine('Subtotal:', `$${(Number(invoice.subtotal) || 0).toFixed(2)}`, cols));
  lines.push(padLine(`IVA (${invoice.ivaRate ?? store.ivaPercentage ?? 15}%):`, `$${(Number(invoice.ivaAmount) || 0).toFixed(2)}`, cols));
  lines.push('\x1b\x45\x01');
  lines.push(padLine('VALOR TOTAL:', `$${(Number(invoice.total) || 0).toFixed(2)}`, cols));
  lines.push('\x1b\x45\x00');
  lines.push(sep);
  lines.push(`Pago: ${toPrinterAscii(getSriPaymentMethodLabel(invoice.paymentMethod))}`);
  lines.push(`Estado SRI: ${toPrinterAscii(invoice.status || 'AUTORIZADO')}`);
  lines.push('Clave de Acceso / Autorizacion:');
  lines.push(toPrinterAscii(invoice.claveAcceso || ''));
  lines.push('\x1b\x61\x01');
  lines.push(sep);
  lines.push('Gracias por su preferencia!');
  if (autoCut) {
    lines.push('\n\n');
    lines.push('\x1d\x56\x42\x00'); // GS V 66 0 (Comando de Corte Automático)
  } else {
    lines.push('\n\n');
  }

  return new TextEncoder().encode(lines.join('\n'));
}

export function buildEscPosTicketBytes(
  title: string,
  subtitle: string,
  items: OrderItem[],
  summaryLines: Array<{ label: string; value: string; bold?: boolean }>,
  footerLines: string[],
  paperWidthMm: '58mm' | '80mm',
  autoCut: boolean
): Uint8Array {
  const cols = paperWidthMm === '58mm' ? 32 : 48;
  const sep = '-'.repeat(cols);
  const lines: string[] = [];

  lines.push('\x1b\x40');
  lines.push('\x1b\x61\x01');
  lines.push('\x1b\x45\x01');
  lines.push(toPrinterAscii(title.toUpperCase()));
  lines.push('\x1b\x45\x00');
  if (subtitle) lines.push(toPrinterAscii(subtitle));
  lines.push(sep);
  lines.push('\x1b\x61\x00');

  items.forEach((it) => {
    const lineTotal = `$${((Number(it.price) || 0) * (Number(it.quantity) || 1)).toFixed(2)}`;
    if (it.dinerName && it.dinerName.trim() !== '') {
      lines.push('\x1b\x45\x01');
      lines.push(`[COMENSAL: ${toPrinterAscii(it.dinerName.toUpperCase())}]`);
      lines.push('\x1b\x45\x00');
    }
    lines.push(padLine(`${it.quantity}x ${it.name}`, lineTotal, cols));
    const groupedCusts = groupOrderCustomizations(it.selectedCustomizations);
    if (groupedCusts.length > 0) {
      groupedCusts.forEach((grp) => {
        lines.push(`  ${toPrinterAscii(grp.groupLabel)}`);
        grp.options.forEach((opt) => {
          const extra = opt.extraPrice > 0 ? ` (+$${opt.extraPrice.toFixed(2)})` : '';
          lines.push(`    - ${toPrinterAscii(`${opt.optionName}${extra}`)}`);
        });
      });
    }
    if (it.notes && it.notes.trim() !== '') {
      lines.push(`  NOTA: ${toPrinterAscii(it.notes)}`);
    }
  });

  lines.push(sep);
  summaryLines.forEach((s) => {
    if (s.bold) lines.push('\x1b\x45\x01');
    lines.push(padLine(s.label, s.value, cols));
    if (s.bold) lines.push('\x1b\x45\x00');
  });

  if (footerLines.length > 0) {
    lines.push(sep);
    lines.push('\x1b\x61\x01');
    footerLines.forEach((f) => lines.push(toPrinterAscii(f)));
  }

  if (autoCut) {
    lines.push('\n\n');
    lines.push('\x1d\x56\x42\x00');
  } else {
    lines.push('\n\n');
  }

  return new TextEncoder().encode(lines.join('\n'));
}

export async function sendBytesToUsbPrinter(
  vendorId: number,
  productId: number,
  data: Uint8Array
): Promise<boolean> {
  if (!isWebUsbAvailable()) return false;
  let device: any = null;
  try {
    const devices: any[] = await (navigator as any).usb.getDevices();
    device = devices.find((d) => d.vendorId === vendorId && d.productId === productId);
    if (!device) return false;

    if (!device.opened) await device.open();
    if (!device.configuration) await device.selectConfiguration(1);

    const ifaces = device.configuration?.interfaces || [];
    let targetIfaceNum = 0;
    let outEndpointNum = 1;

    for (const iface of ifaces) {
      for (const alt of iface.alternates || []) {
        const outEp = (alt.endpoints || []).find((ep: any) => ep.direction === 'out');
        if (outEp) {
          targetIfaceNum = iface.interfaceNumber;
          outEndpointNum = outEp.endpointNumber;
          break;
        }
      }
    }

    await device.claimInterface(targetIfaceNum);
    await device.transferOut(outEndpointNum, data);
    await device.releaseInterface(targetIfaceNum);
    return true;
  } catch (err) {
    console.warn('WebUSB direct transfer fallback to OS printer:', err);
    return false;
  }
}

export async function sendBytesToSerialPrinter(
  portIndex: number,
  data: Uint8Array
): Promise<boolean> {
  if (!isWebSerialAvailable()) return false;
  let port: any = null;
  try {
    const ports: any[] = await (navigator as any).serial.getPorts();
    port = ports[portIndex] || ports[0];
    if (!port) return false;

    if (!port.readable && !port.writable) {
      await port.open({ baudRate: 9600 });
    }
    const writer = port.writable?.getWriter();
    if (!writer) return false;
    await writer.write(data);
    writer.releaseLock();
    return true;
  } catch (err) {
    console.warn('WebSerial direct transfer fallback to OS printer:', err);
    return false;
  }
}

/**
 * Updates dynamic @page CSS size so standard A4/Carta printers (Epson L-series, HP, etc.)
 * AND 58mm/80mm thermal printers receive proper page dimensions from the browser print dialog.
 */
export function applyDynamicPrintPageStyle(format: PaperFormat) {
  if (typeof document === 'undefined') return;
  const styleId = 'gastrolab-dynamic-page-style';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  if (format === '58mm') {
    styleEl.textContent = `@media print { @page { size: 58mm auto; margin: 1.5mm; } }`;
  } else if (format === '80mm') {
    styleEl.textContent = `@media print { @page { size: 80mm auto; margin: 2mm; } }`;
  } else {
    styleEl.textContent = `@media print { @page { size: A4 portrait; margin: 8mm; } }`;
  }
}
