require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(
  bodyParser.json({
    limit: '5mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
app.use(bodyParser.urlencoded({ extended: true }));

// Almacén en memoria para trazabilidad inmediata (en producción puede conectarse a Firestore/PostgreSQL)
const orderStore = new Map();

/**
 * Construye el payload oficial dual (items + productos) compatible con GASTROLAB POS y Sinqro
 */
function buildGastroLabOrderPayload(input = {}) {
  const deliveryFee = Number(
    input.deliveryFee !== undefined ? input.deliveryFee : process.env.DELIVERY_FEE || 2.5
  );
  const rawItems = Array.isArray(input.items) ? input.items : [];

  const subtotal =
    input.totals?.subtotal !== undefined
      ? Number(input.totals.subtotal)
      : Number(
          rawItems
            .reduce((acc, it) => {
              const extrasTotal = (it.modifiers || []).reduce(
                (mSum, m) => mSum + Number(m.price || 0),
                0
              );
              return acc + (Number(it.unitPrice || 0) + extrasTotal) * Number(it.quantity || 1);
            }, 0)
            .toFixed(2)
        );

  const tax =
    input.totals?.tax !== undefined
      ? Number(input.totals.tax)
      : Number((subtotal * 0.15).toFixed(2));

  const total =
    input.totals?.total !== undefined
      ? Number(input.totals.total)
      : Number((subtotal + tax + deliveryFee).toFixed(2));

  const items = rawItems.map((it) => ({
    menuItemId: String(it.menuItemId || it.id || ''),
    quantity: Number(it.quantity || it.cantidad || 1),
    modifiers: (it.modifiers || it.extras || []).map((mod) => ({
      modifierId: String(mod.modifierId || mod.id || ''),
      name: String(mod.name || mod.nombre || ''),
      price: Number(mod.price ?? mod.precio ?? 0),
    })),
    comment: String(it.comment || it.nota || ''),
  }));

  const productos = rawItems.map((it) => ({
    id: String(it.menuItemId || it.id || ''),
    cantidad: Number(it.quantity || it.cantidad || 1),
    extras: (it.modifiers || it.extras || []).map((mod) => ({
      id: String(mod.modifierId || mod.id || ''),
      nombre: String(mod.name || mod.nombre || ''),
      precio: Number(mod.price ?? mod.precio ?? 0),
    })),
    ingredientes: Array.isArray(it.ingredients) ? it.ingredients : [],
    nota: String(it.comment || it.nota || ''),
  }));

  return {
    orderType: input.orderType === 'PICKUP' ? 'PICKUP' : 'DELIVERY',
    externalReference: String(input.externalReference || `WA-${Date.now()}`),
    customer: {
      firstName: String(input.customer?.firstName || 'Cliente'),
      lastName: String(input.customer?.lastName || 'WhatsApp'),
      taxId: String(input.customer?.taxId || '9999999999999'),
      email: String(input.customer?.email || 'sin-correo@gastrolab.ec'),
      phone: String(input.customer?.phone || ''),
      address: String(input.customer?.address || 'Retiro en local'),
      location: {
        lat: Number(input.customer?.location?.lat || -0.180653),
        lng: Number(input.customer?.location?.lng || -78.467834),
      },
    },
    items,
    productos,
    deliveryFee: input.orderType === 'PICKUP' ? 0 : deliveryFee,
    paymentMethod: ['DEUNA', 'TRANSFER', 'CASH'].includes(input.paymentMethod)
      ? input.paymentMethod
      : 'TRANSFER',
    paymentStatus: input.paymentStatus === 'PAID' ? 'PAID' : 'PENDING',
    totals: {
      subtotal,
      tax,
      total,
    },
  };
}

/**
 * Calcula firma HMAC-SHA256 con formato estricto:
 * {timestamp}.{method}.{path}.{body_json}
 */
function signGastroLabRequest(method, requestPath, bodyObject) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const normalizedMethod = String(method || 'POST').toUpperCase();
  const bodyJson = JSON.stringify(bodyObject || {});
  const signingPayload = `${timestamp}.${normalizedMethod}.${requestPath}.${bodyJson}`;
  const hmacSecret = process.env.GASTROLAB_HMAC_SECRET || '';

  const signature = crypto
    .createHmac('sha256', hmacSecret)
    .update(signingPayload, 'utf8')
    .digest('hex');

  const clientId = process.env.GASTROLAB_CLIENT_ID || '';
  const clientSecret = process.env.GASTROLAB_CLIENT_SECRET || '';
  const bearerToken =
    process.env.GASTROLAB_ACCESS_TOKEN ||
    Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  return {
    timestamp,
    signature,
    signingPayload,
    bodyJson,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
      'X-GASTROLAB-Signature': signature,
      'X-GASTROLAB-Timestamp': timestamp,
      'X-GASTROLAB-Client-Id': clientId,
    },
  };
}

/**
 * Ejecuta una petición axios con Backoff Exponencial (máximo 3 intentos)
 */
async function postWithExponentialBackoff(fn, maxAttempts = 3, baseDelayMs = 600) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fn(attempt);
      return { attempt, response };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const waitMs = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }
  throw lastError;
}

/**
 * Envía el pedido a Sinqro (logística / delivery) y luego a GASTROLAB POS firmado con HMAC-SHA256
 */
async function dispatchOrderToSinqroAndGastroLab(orderInput) {
  const payload = buildGastroLabOrderPayload(orderInput);
  const sinqroUrl = process.env.SINQRO_API_URL || 'https://api.sinqro.com/v1/orders';
  const sinqroKey = process.env.SINQRO_API_KEY || '';

  let sinqroResult = null;
  if (sinqroKey) {
    try {
      const sinqroRes = await postWithExponentialBackoff(
        () =>
          axios.post(
            sinqroUrl,
            {
              externalReference: payload.externalReference,
              orderType: payload.orderType,
              customer: payload.customer,
              deliveryFee: payload.deliveryFee,
              totals: payload.totals,
            },
            {
              timeout: 8000,
              headers: {
                'Content-Type': 'application/json',
                'X-API-Key': sinqroKey,
                Authorization: `Bearer ${sinqroKey}`,
              },
            }
          ),
        3,
        600
      );
      sinqroResult = sinqroRes.response.data;
    } catch (err) {
      console.warn('[Sinqro] Aviso al crear despacho:', err.message);
      sinqroResult = {
        queued: true,
        warning: err.message,
      };
    }
  }

  const gastroBaseUrl = (process.env.GASTROLAB_API_URL || '').replace(/\/+$/, '');
  const apiPath = '/api/orders/external';
  const signed = signGastroLabRequest('POST', apiPath, payload);

  let gastrolabResult = null;
  if (gastroBaseUrl) {
    const gastroRes = await postWithExponentialBackoff(
      () =>
        axios.post(`${gastroBaseUrl}${apiPath}`, payload, {
          timeout: 10000,
          headers: signed.headers,
        }),
      3,
      600
    );
    gastrolabResult = gastroRes.response.data;
  }

  const record = {
    externalReference: payload.externalReference,
    payload,
    sinqroResult,
    gastrolabResult,
    status: sinqroResult && !sinqroResult.warning ? 'Enviado a Sinqro' : 'Pagado',
    updatedAt: new Date().toISOString(),
  };
  orderStore.set(payload.externalReference, record);
  return record;
}

/**
 * Helper para responder mensajes al cliente vía WhatsApp Cloud API
 */
async function sendWhatsAppTextMessage(toPhone, text) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId || !toPhone) return null;

  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'text',
      text: { body: text },
    },
    {
      timeout: 8000,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return res.data;
}

// ==========================================
// RUTAS DE SALUD Y DESPLIEGUE
// ==========================================
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'gastrolab-whatsapp-backend',
    timestamp: new Date().toISOString(),
    configured: {
      whatsapp: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
      sinqro: Boolean(process.env.SINQRO_API_KEY),
      gastrolab: Boolean(process.env.GASTROLAB_API_URL && process.env.GASTROLAB_HMAC_SECRET),
      deuna: Boolean(process.env.DEUNA_API_KEY),
    },
  });
});

// ==========================================
// WEBHOOK META WHATSAPP (VERIFICACIÓN GET)
// ==========================================
app.get('/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || process.env.GASTROLAB_HMAC_SECRET || 'gastrolab_verify';

  if (mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: 'Token de verificación inválido' });
});

// ==========================================
// WEBHOOK META WHATSAPP (EVENTOS POST)
// ==========================================
app.post('/webhooks/whatsapp', async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const messages = change?.messages || [];

    for (const msg of messages) {
      const from = msg.from;
      const bodyText = msg.text?.body || msg.interactive?.button_reply?.title || '';

      // Ejemplo de flujo automático: si el mensaje incluye confirmación de pedido JSON o comando
      if (bodyText.toLowerCase().includes('pedir') || bodyText.toLowerCase().includes('menu')) {
        await sendWhatsAppTextMessage(
          from,
          'Hola, bienvenido a GASTROLAB POS. Envíanos tu pedido, dirección y comprobante de transferencia o pago Deuna! para procesarlo al instante.'
        ).catch((err) => console.warn('[WA Send]', err.message));
      }
    }

    res.status(200).json({ received: true, count: messages.length });
  } catch (err) {
    console.error('[Webhook WhatsApp Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// WEBHOOK SINQRO (CONFIRMACIÓN DELIVERY)
// ==========================================
app.post('/webhooks/sinqro', async (req, res) => {
  try {
    const webhookSecret = process.env.SINQRO_WEBHOOK_SECRET || '';
    const incomingSignature = req.headers['x-sinqro-signature'] || '';

    if (webhookSecret && incomingSignature) {
      const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.rawBody || JSON.stringify(req.body || {}), 'utf8')
        .digest('hex');

      if (incomingSignature !== expected) {
        return res.status(401).json({ error: 'Firma de Sinqro inválida' });
      }
    }

    const { externalReference, trackingId, status, customerPhone } = req.body || {};
    if (externalReference) {
      const existing = orderStore.get(externalReference) || {};
      orderStore.set(externalReference, {
        ...existing,
        externalReference,
        sinqroTrackingId: trackingId || existing.sinqroTrackingId,
        status: status === 'CONFIRMED' || status === 'DELIVERED' ? 'Confirmado' : 'Enviado a Sinqro',
        updatedAt: new Date().toISOString(),
      });
    }

    if (customerPhone && (status === 'CONFIRMED' || status === 'DELIVERED')) {
      await sendWhatsAppTextMessage(
        customerPhone,
        `Tu pedido ${externalReference || ''} fue confirmado por nuestro repartidor Sinqro y va en camino.`
      ).catch(() => {});
    }

    res.status(200).json({ ok: true, externalReference, status: status || 'Confirmado' });
  } catch (err) {
    console.error('[Webhook Sinqro Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// DESPACHO MANUAL / REINTENTO HACIA SINQRO + GASTROLAB
// ==========================================
app.post('/api/whatsapp/orders/dispatch', async (req, res) => {
  try {
    const result = await dispatchOrderToSinqroAndGastroLab(req.body);
    res.status(200).json({ ok: true, data: result });
  } catch (err) {
    console.error('[Dispatch Order Error]', err);
    res.status(502).json({
      ok: false,
      error: err.message || 'Error al despachar pedido a Sinqro / GASTROLAB',
    });
  }
});

app.listen(PORT, () => {
  console.log(`GASTROLAB WhatsApp + Sinqro Backend escuchando en el puerto ${PORT}`);
});
