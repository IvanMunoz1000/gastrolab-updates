# GASTROLAB POS — Backend WhatsApp + Sinqro + Deuna!

Servicio Node.js / Express desacoplado listo para desplegar en **Render** o **Railway**.
Gestiona los webhooks de Meta WhatsApp Cloud API, despacha entregas a **Sinqro** y envía pedidos firmados con **HMAC-SHA256** (`{timestamp}.{method}.{path}.{body_json}`) hacia **GASTROLAB POS** con reintentos de **Backoff Exponencial** (máximo 3 intentos).

---

## 1. Subir a GitHub

1. Crea un repositorio nuevo en GitHub (ej. `gastrolab-whatsapp-backend`).
2. Copia los archivos de esta carpeta (`server.js`, `package.json`, `.env.example`, `README.md`) a la raíz de ese repositorio.
3. Ejecuta:
   ```bash
   git init
   git add .
   git commit -m "GASTROLAB WhatsApp + Sinqro Backend"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/gastrolab-whatsapp-backend.git
   git push -u origin main
   ```

---

## 2. Despliegue en Render (Web Service)

1. Inicia sesión en [render.com](https://render.com) y haz clic en **New + > Web Service**.
2. Conecta tu repositorio de GitHub `gastrolab-whatsapp-backend`.
3. Configura:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. En **Environment > Environment Variables**, agrega las 10 variables obligatorias (más `WHATSAPP_VERIFY_TOKEN`):
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_ID`
   - `WHATSAPP_VERIFY_TOKEN`
   - `SINQRO_API_KEY`
   - `SINQRO_WEBHOOK_SECRET`
   - `GASTROLAB_API_URL`
   - `GASTROLAB_CLIENT_ID`
   - `GASTROLAB_CLIENT_SECRET`
   - `GASTROLAB_HMAC_SECRET`
   - `DELIVERY_FEE`
   - `DEUNA_API_KEY`
5. Haz clic en **Create Web Service**. Render generará tu URL HTTPS (ej. `https://gastrolab-wa.onrender.com`).

---

## 3. Despliegue alternativo en Railway

1. Inicia sesión en [railway.app](https://railway.app) y selecciona **New Project > Deploy from GitHub repo**.
2. Selecciona `gastrolab-whatsapp-backend`.
3. Railway detectará automáticamente `package.json` y ejecutará `npm start`.
4. Ve a la pestaña **Variables** y pega las mismas variables de `.env.example`.
5. En **Settings > Networking**, genera el dominio público (`https://tu-proyecto.up.railway.app`).

---

## 4. Configurar Webhooks en Meta y Sinqro

- **Meta Developers (WhatsApp > Configuration > Webhook)**:
  - Callback URL: `https://TU_DOMINIO/webhooks/whatsapp`
  - Verify token: el valor de `WHATSAPP_VERIFY_TOKEN`
  - Suscribirse al campo `messages`.
- **Panel Sinqro (Webhooks)**:
  - Webhook URL: `https://TU_DOMINIO/webhooks/sinqro`
  - Secret: el valor de `SINQRO_WEBHOOK_SECRET`
- **Verificación de salud**:
  - Visita `https://TU_DOMINIO/health` — debe responder `{ "ok": true }`.
