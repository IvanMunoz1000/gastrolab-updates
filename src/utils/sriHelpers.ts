import { OrderItem } from '../types';

export interface ElectronicInvoiceClient {
  docType: 'RUC' | 'Cédula' | 'Pasaporte' | 'Consumidor Final' | string;
  docNumber: string;
  name: string;
  email?: string;
  address?: string;
  phone?: string;
}

export interface ElectronicInvoiceRecord {
  id?: string;
  invoiceNumber: string;
  claveAcceso: string;
  date: string;
  status: 'AUTORIZADO' | 'PENDIENTE_ENVIO_OFFLINE' | 'TICKET_INTERNO' | string;
  isInternalTicket?: boolean;
  sriAuthorizationNumber?: string;
  sriAuthorizationDate?: string | null;
  client: ElectronicInvoiceClient;
  reference?: string;
  paymentMethod?: string;
  subtotal: number;
  ivaRate: number;
  ivaAmount: number;
  discountAmount?: number;
  total: number;
  items: OrderItem[] | Array<{ name: string; quantity: number; price: number }>;
  createdAt?: string;
}

/**
 * Generates an authentic 49-digit Ecuador SRI Access Key (Clave de Acceso)
 * validated with Módulo 11 check digit.
 * Format: [ddmmyyyy 8][01 Factura 2][RUC 13][Ambiente 2 1][Serie 001001 6][Secuencial 9][CodNum 8][TipoEmision 1][DV 1]
 */
export function generateClaveDeAcceso(
  secuencial: string,
  rucEmisor: string,
  fecha: Date = new Date()
): string {
  const day = String(fecha.getDate()).padStart(2, '0');
  const month = String(fecha.getMonth() + 1).padStart(2, '0');
  const year = String(fecha.getFullYear());
  const dateStr = `${day}${month}${year}`;
  const tipoComp = '01';
  const cleanRuc = rucEmisor.replace(/\D/g, '');
  if (cleanRuc.length !== 13) throw new Error('Configura el RUC de 13 dígitos del establecimiento antes de emitir la factura.');
  const ambiente = '2'; // Producción
  const serie = '001001';
  const secDigits = (secuencial || '1').replace(/\D/g, '');
  const secStr = secDigits.padStart(9, '0').slice(-9);
  const codigoNum = String((fecha.getTime() % 89999999) + 10000000).slice(0, 8);
  const tipoEmision = '1';

  const base48 = `${dateStr}${tipoComp}${cleanRuc}${ambiente}${serie}${secStr}${codigoNum}${tipoEmision}`;

  let factor = 2;
  let sum = 0;
  for (let i = base48.length - 1; i >= 0; i--) {
    sum += parseInt(base48.charAt(i), 10) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rem = sum % 11;
  const digito = rem === 0 ? 0 : rem === 1 ? 1 : 11 - rem;

  return `${base48}${digito}`;
}

export function getSriPaymentMethodLabel(method?: string): string {
  switch (method) {
    case 'Efectivo':
      return '01 - Sin Utilización del Sistema Financiero (Efectivo)';
    case 'Tarjeta de Débito':
      return '16 - Tarjeta de Débito';
    case 'Tarjeta':
    case 'Tarjeta de Crédito':
      return '19 - Tarjeta de Crédito';
    case 'Transferencia':
    case 'De Una':
      return `20 - Otros con Utilización del Sistema Financiero (${method})`;
    default:
      return method || '01 - Sin Utilización del Sistema Financiero';
  }
}
