import { WhatsAppIntegrationConfig } from '../types';

export interface EnvFieldMeta {
  key: keyof WhatsAppIntegrationConfig;
  label: string;
  placeholder: string;
  secret?: boolean;
  helper: string;
}

export const WHATSAPP_ENV_FIELDS: EnvFieldMeta[] = [
  {
    key: 'WHATSAPP_TOKEN',
    label: 'WHATSAPP_TOKEN',
    placeholder: 'EAAG... (Token permanente Meta Cloud API)',
    secret: true,
    helper: 'Token de acceso de Meta WhatsApp Business API para responder chats automáticamente.',
  },
  {
    key: 'WHATSAPP_PHONE_ID',
    label: 'WHATSAPP_PHONE_ID',
    placeholder: '123456789012345',
    helper: 'ID del número de teléfono remitente en Meta Developers.',
  },
  {
    key: 'SINQRO_API_KEY',
    label: 'SINQRO_API_KEY',
    placeholder: 'sinqro_live_...',
    secret: true,
    helper: 'Llave API para despachar motorizados y tracking en Sinqro.',
  },
  {
    key: 'SINQRO_WEBHOOK_SECRET',
    label: 'SINQRO_WEBHOOK_SECRET',
    placeholder: 'sinqro_whsec_...',
    secret: true,
    helper: 'Secreto para verificar firmas entrantes en POST /webhooks/sinqro.',
  },
  {
    key: 'GASTROLAB_API_URL',
    label: 'GASTROLAB_API_URL',
    placeholder: 'https://tu-backend-whatsapp.onrender.com',
    helper: 'URL pública HTTPS del servicio desplegado en Render o Railway.',
  },
  {
    key: 'GASTROLAB_CLIENT_ID',
    label: 'GASTROLAB_CLIENT_ID',
    placeholder: 'gastrolab_wa_client_01',
    helper: 'Identificador del cliente autorizado para el Bearer Token.',
  },
  {
    key: 'GASTROLAB_CLIENT_SECRET',
    label: 'GASTROLAB_CLIENT_SECRET',
    placeholder: 'gastrolab_client_secret_...',
    secret: true,
    helper: 'Secreto del cliente OAuth/Bearer para autenticación externa.',
  },
  {
    key: 'GASTROLAB_HMAC_SECRET',
    label: 'GASTROLAB_HMAC_SECRET',
    placeholder: 'hmac_sha256_secret_...',
    secret: true,
    helper: 'Clave compartida para firmar {timestamp}.{method}.{path}.{body_json}.',
  },
  {
    key: 'DELIVERY_FEE',
    label: 'DELIVERY_FEE',
    placeholder: '2.50',
    helper: 'Tarifa estándar de envío a domicilio incluida en el payload.',
  },
  {
    key: 'DEUNA_API_KEY',
    label: 'DEUNA_API_KEY',
    placeholder: 'deuna_api_key_...',
    secret: true,
    helper: 'Llave API de comercio para conciliación automática de cobros Deuna!.',
  },
];

export function generateEnvFileContent(config: WhatsAppIntegrationConfig): string {
  return [
    'PORT=4000',
    `WHATSAPP_TOKEN=${config.WHATSAPP_TOKEN || 'EAAG_TU_TOKEN_DE_WHATSAPP_AQUI'}`,
    `WHATSAPP_PHONE_ID=${config.WHATSAPP_PHONE_ID || '123456789012345'}`,
    'WHATSAPP_VERIFY_TOKEN=gastrolab_verify_token_seguro',
    'SINQRO_API_URL=https://api.sinqro.com/v1/orders',
    `SINQRO_API_KEY=${config.SINQRO_API_KEY || 'sinqro_live_api_key_aqui'}`,
    `SINQRO_WEBHOOK_SECRET=${config.SINQRO_WEBHOOK_SECRET || 'sinqro_webhook_secret_aqui'}`,
    `GASTROLAB_API_URL=${config.GASTROLAB_API_URL || 'https://tu-instancia-gastrolab.run.app'}`,
    `GASTROLAB_CLIENT_ID=${config.GASTROLAB_CLIENT_ID || 'gastrolab_wa_client_01'}`,
    `GASTROLAB_CLIENT_SECRET=${config.GASTROLAB_CLIENT_SECRET || 'gastrolab_client_secret_aqui'}`,
    `GASTROLAB_HMAC_SECRET=${config.GASTROLAB_HMAC_SECRET || 'gastrolab_hmac_sha256_secret_aqui'}`,
    `DELIVERY_FEE=${config.DELIVERY_FEE || '2.50'}`,
    `DEUNA_API_KEY=${config.DEUNA_API_KEY || 'deuna_merchant_api_key_aqui'}`,
  ].join('\n');
}

export const BACKEND_PACKAGE_JSON_PREVIEW = `{
  "name": "gastrolab-whatsapp-backend",
  "version": "1.0.0",
  "description": "Middleware Node.js/Express para WhatsApp, Sinqro, Deuna! y GASTROLAB POS",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "axios": "^1.7.9",
    "body-parser": "^1.20.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2"
  }
}`;

export const BACKEND_README_PREVIEW = `# Despliegue Backend WhatsApp + Sinqro en Render o Railway

1. Sube la carpeta \`backend-whatsapp/\` (server.js, package.json, .env.example) a un repositorio de GitHub.
2. En Render (Web Service) o Railway (Deploy from GitHub):
   - Build Command: \`npm install\`
   - Start Command: \`npm start\`
3. Registra las 10 variables de entorno en el panel del hosting.
4. Configura los Webhooks:
   - Meta WhatsApp: \`https://TU-URL/webhooks/whatsapp\`
   - Sinqro Delivery: \`https://TU-URL/webhooks/sinqro\`
5. Pega la URL pública resultante en el campo \`GASTROLAB_API_URL\` de esta pantalla.`;
