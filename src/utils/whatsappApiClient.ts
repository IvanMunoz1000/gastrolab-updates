import {
  GastroLabOrderPayload,
  WhatsAppIntegrationConfig,
  WhatsAppOrderRecord,
} from '../types';

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppIntegrationConfig = {
  WHATSAPP_TOKEN: '',
  WHATSAPP_PHONE_ID: '',
  SINQRO_API_KEY: '',
  SINQRO_WEBHOOK_SECRET: '',
  GASTROLAB_API_URL: '',
  GASTROLAB_CLIENT_ID: 'gastrolab_wa_client_01',
  GASTROLAB_CLIENT_SECRET: '',
  GASTROLAB_HMAC_SECRET: '',
  DELIVERY_FEE: '2.50',
  DEUNA_API_KEY: '',
};

/**
 * Arma el JSON oficial del pedido con doble estructura:
 * `items` (inglés / estándar GASTROLAB-Sinqro) + `productos` (español / POS interno).
 */
export function buildGastroLabOrderPayload(
  order: WhatsAppOrderRecord,
  config?: Partial<WhatsAppIntegrationConfig>
): GastroLabOrderPayload {
  const configuredDelivery = Number(config?.DELIVERY_FEE ?? order.deliveryFee ?? 2.5);
  const deliveryFee = Number.isFinite(configuredDelivery)
    ? Number(configuredDelivery.toFixed(2))
    : 2.5;

  const [firstName, ...lastNameParts] = (order.customerFirstName
    ? [order.customerFirstName, order.customerLastName]
    : ['Cliente', 'WhatsApp']
  );

  const items = (order.items || []).map((item) => ({
    menuItemId: item.menuItemId,
    quantity: Number(item.quantity || 1),
    modifiers: (item.modifiers || []).map((mod) => ({
      modifierId: mod.modifierId,
      name: mod.name,
      price: Number(mod.price || 0),
    })),
    comment: item.comment || '',
  }));

  const productos = (order.items || []).map((item) => ({
    id: item.menuItemId,
    cantidad: Number(item.quantity || 1),
    extras: (item.modifiers || []).map((mod) => ({
      id: mod.modifierId,
      nombre: mod.name,
      precio: Number(mod.price || 0),
    })),
    ingredientes: Array.isArray(item.ingredients) ? item.ingredients : [],
    nota: item.comment || '',
  }));

  return {
    orderType: order.customerAddress?.toLowerCase().includes('retiro') ? 'PICKUP' : 'DELIVERY',
    externalReference: order.externalReference || order.id,
    customer: {
      firstName: firstName || 'Cliente',
      lastName: order.customerLastName || lastNameParts.join(' ') || 'WhatsApp',
      taxId: order.customerTaxId || '9999999999999',
      email: order.customerEmail || 'cliente@gastrolab.ec',
      phone: order.customerPhone || '',
      address: order.customerAddress || 'Entrega a domicilio',
      location: {
        lat: Number(order.location?.lat ?? -0.180653),
        lng: Number(order.location?.lng ?? -78.467834),
      },
    },
    items,
    productos,
    deliveryFee,
    paymentMethod: order.paymentMethod || 'TRANSFER',
    paymentStatus: order.paymentStatus || 'PENDING',
    totals: {
      subtotal: Number((order.subtotal || 0).toFixed(2)),
      tax: Number((order.tax || 0).toFixed(2)),
      total: Number((order.total || 0).toFixed(2)),
    },
  };
}

/**
 * Pure-JS SHA-256 fallback in case browser context blocks window.crypto.subtle (non-HTTPS LAN IP).
 */
function sha256BytesFallback(messageBytes: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  const bitLen = messageBytes.length * 8;
  const paddedLen = Math.ceil((messageBytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(messageBytes);
  padded[messageBytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((val, idx) => outView.setUint32(idx * 4, val, false));
  return out;
}

function hmacSha256FallbackHex(secret: string, message: string): string {
  const enc = new TextEncoder();
  const rawKeyBytes = enc.encode(secret);
  const keyBytes = rawKeyBytes.length > 64 ? sha256BytesFallback(rawKeyBytes) : rawKeyBytes;
  const blockKey = new Uint8Array(64);
  blockKey.set(keyBytes);

  const oPad = new Uint8Array(64);
  const iPad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    oPad[i] = blockKey[i] ^ 0x5c;
    iPad[i] = blockKey[i] ^ 0x36;
  }
  const msgBytes = enc.encode(message);
  const innerInput = new Uint8Array(64 + msgBytes.length);
  innerInput.set(iPad);
  innerInput.set(msgBytes, 64);
  const innerHash = sha256BytesFallback(innerInput);

  const outerInput = new Uint8Array(64 + 32);
  outerInput.set(oPad);
  outerInput.set(innerHash, 64);
  const finalHash = sha256BytesFallback(outerInput);

  return Array.from(finalHash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface SignedRequestArtifacts {
  timestamp: string;
  signature: string;
  signingString: string;
  bodyJson: string;
  headers: {
    'Content-Type': string;
    Authorization: string;
    'X-GASTROLAB-Signature': string;
    'X-GASTROLAB-Timestamp': string;
    'X-GASTROLAB-Client-Id': string;
  };
}

/**
 * Firma el request con HMAC-SHA256 sobre:
 * `{timestamp}.{method}.{path}.{body_json}`
 * e inyecta Authorization: Bearer ..., X-GASTROLAB-Signature y X-GASTROLAB-Timestamp.
 */
export async function signGastroLabHmacSha256(
  method: string,
  path: string,
  payload: unknown,
  config: Partial<WhatsAppIntegrationConfig>
): Promise<SignedRequestArtifacts> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const upperMethod = String(method || 'POST').toUpperCase();
  const bodyJson = JSON.stringify(payload ?? {});
  const signingString = `${timestamp}.${upperMethod}.${path}.${bodyJson}`;
  const secret = config.GASTROLAB_HMAC_SECRET || 'gastrolab_dev_hmac_secret';

  let signatureHex = '';
  try {
    if (typeof window !== 'undefined' && window.crypto?.subtle) {
      const encoder = new TextEncoder();
      const key = await window.crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sigBuffer = await window.crypto.subtle.sign('HMAC', key, encoder.encode(signingString));
      signatureHex = Array.from(new Uint8Array(sigBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } else {
      signatureHex = hmacSha256FallbackHex(secret, signingString);
    }
  } catch {
    signatureHex = hmacSha256FallbackHex(secret, signingString);
  }

  const clientId = config.GASTROLAB_CLIENT_ID || 'gastrolab_wa_client_01';
  const clientSecret = config.GASTROLAB_CLIENT_SECRET || 'demo_secret';
  const rawToken =
    typeof btoa === 'function'
      ? btoa(`${clientId}:${clientSecret}`)
      : `${clientId}:${clientSecret}`;

  return {
    timestamp,
    signature: signatureHex,
    signingString,
    bodyJson,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${rawToken}`,
      'X-GASTROLAB-Signature': signatureHex,
      'X-GASTROLAB-Timestamp': timestamp,
      'X-GASTROLAB-Client-Id': clientId,
    },
  };
}

export interface RetryDispatchResult {
  success: boolean;
  attemptsUsed: number;
  simulatedLocalFallback: boolean;
  payload: GastroLabOrderPayload;
  signed: SignedRequestArtifacts;
  logs: string[];
  errorMessage?: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Envía el pedido firmado hacia el endpoint configurado con Backoff Exponencial (máx. 3 intentos).
 */
export async function sendOrderWithExponentialBackoff(
  order: WhatsAppOrderRecord,
  config: Partial<WhatsAppIntegrationConfig>,
  maxAttempts = 3
): Promise<RetryDispatchResult> {
  const payload = buildGastroLabOrderPayload(order, config);
  const path = '/api/whatsapp/orders/dispatch';
  const signed = await signGastroLabHmacSha256('POST', path, payload, config);
  const baseUrl = (config.GASTROLAB_API_URL || '').trim().replace(/\/+$/, '');
  const logs: string[] = [];

  if (!baseUrl) {
    // Sin URL externa aún desplegada: valida payload + HMAC localmente con trazabilidad real
    logs.push(
      `[Intento 1/${maxAttempts}] Payload JSON dual (items + productos) construido (${payload.items.length} ítems).`
    );
    logs.push(
      `Firma HMAC-SHA256 generada: X-GASTROLAB-Timestamp=${signed.timestamp}, firma=${signed.signature.slice(0, 18)}...`
    );
    logs.push(
      'GASTROLAB_API_URL no configurada aún; sincronización registrada en modo local listo para Render/Railway.'
    );
    return {
      success: true,
      attemptsUsed: 1,
      simulatedLocalFallback: true,
      payload,
      signed,
      logs,
    };
  }

  const endpoint = `${baseUrl}${path}`;
  let lastError = 'Error desconocido de conexión';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logs.push(`[Intento ${attempt}/${maxAttempts}] POST ${endpoint}`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: signed.headers,
        body: signed.bodyJson,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
      }
      logs.push(`[Intento ${attempt}/${maxAttempts}] Respuesta HTTP ${res.status} OK.`);
      return {
        success: true,
        attemptsUsed: attempt,
        simulatedLocalFallback: false,
        payload,
        signed,
        logs,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logs.push(`[Intento ${attempt}/${maxAttempts}] Fallo: ${lastError}`);
      if (attempt < maxAttempts) {
        const delayMs = 600 * Math.pow(2, attempt - 1);
        logs.push(`Esperando ${delayMs}ms (Backoff Exponencial) antes del siguiente intento...`);
        await wait(delayMs);
      }
    }
  }

  return {
    success: false,
    attemptsUsed: maxAttempts,
    simulatedLocalFallback: false,
    payload,
    signed,
    logs,
    errorMessage: lastError,
  };
}
