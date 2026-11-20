import { OrderItem } from '../types';

export const CUSTOMER_DISPLAY_CHANNEL = 'gastrolab_customer_display';
export const CUSTOMER_DISPLAY_STORAGE_KEY = 'gastrolab_customer_display_state';

export type CustomerDisplayMessage =
  | {
      type: 'IDLE';
      storeName?: string;
      localLogoUrl?: string;
      slogan?: string;
      timestamp: number;
    }
  | {
      type: 'CART';
      tableLabel: string;
      items: OrderItem[];
      subtotal: number;
      discountPercent?: number;
      total: number;
      storeName?: string;
      localLogoUrl?: string;
      slogan?: string;
      timestamp: number;
    }
  | {
      type: 'PAID';
      tableLabel: string;
      items: OrderItem[];
      total: number;
      paymentMethod: string;
      changeAmount?: number;
      clientName: string;
      invoiceNumber?: string;
      storeName?: string;
      localLogoUrl?: string;
      slogan?: string;
      timestamp: number;
    };

let sharedChannel: BroadcastChannel | null = null;
let customerWindowRef: Window | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!sharedChannel) {
    try {
      sharedChannel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
    } catch {
      return null;
    }
  }
  return sharedChannel;
}

export function broadcastCustomerDisplay(message: CustomerDisplayMessage): void {
  try {
    localStorage.setItem(CUSTOMER_DISPLAY_STORAGE_KEY, JSON.stringify(message));
  } catch {
    // Ignore storage quota issues
  }
  try {
    const ch = getChannel();
    ch?.postMessage(message);
  } catch {
    // Ignore BroadcastChannel errors
  }
}

export function openCustomerDisplayWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  try {
    if (customerWindowRef && !customerWindowRef.closed) {
      customerWindowRef.focus();
      return customerWindowRef;
    }
    const url = `${window.location.origin}/?pantalla=cliente`;
    const win = window.open(
      url,
      'GASTROLAB_PANTALLA_CLIENTE',
      'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no'
    );
    if (win) {
      customerWindowRef = win;
    }
    return win;
  } catch {
    return null;
  }
}

export function tryAutoOpenCustomerDisplayIfExtended(): void {
  if (typeof window === 'undefined') return;
  try {
    const alreadyTried = sessionStorage.getItem('gastrolab_dual_auto_checked');
    if (alreadyTried) return;
    const isExtended = Boolean((window.screen as { isExtended?: boolean })?.isExtended);
    if (isExtended) {
      sessionStorage.setItem('gastrolab_dual_auto_checked', '1');
      openCustomerDisplayWindow();
    }
  } catch {
    // Ignore unsupported browser errors
  }
}
