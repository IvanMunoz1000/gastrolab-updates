import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import {
  buildGastroLabOrderPayload,
  DEFAULT_WHATSAPP_CONFIG,
  RetryDispatchResult,
  sendOrderWithExponentialBackoff,
  signGastroLabHmacSha256,
  SignedRequestArtifacts,
} from '../utils/whatsappApiClient';
import {
  BACKEND_PACKAGE_JSON_PREVIEW,
  BACKEND_README_PREVIEW,
  generateEnvFileContent,
  WHATSAPP_ENV_FIELDS,
} from '../utils/whatsappBackendTemplates';
import {
  GastroLabOrderPayload,
  WhatsAppChat,
  WhatsAppIntegrationConfig,
  WhatsAppMessage,
  WhatsAppOrderRecord,
  WhatsAppOrderStatus,
} from '../types';
import {
  MessageCircle,
  Send,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
  DollarSign,
  Eye,
  FileCode2,
  Settings2,
  Copy,
  Check,
  Search,
  Bot,
  User,
  Truck,
  Clock,
  AlertCircle,
  Calendar,
  Plus,
  X,
  CreditCard,
  Receipt,
  Terminal,
} from 'lucide-react';

type WhatsAppSubTab = 'chat' | 'pedidos' | 'verificacion' | 'contabilidad';
type DateFilterMode = 'hoy' | '7dias' | 'mes' | 'todo' | 'personalizado';

const STORAGE_ENV_KEY = 'gastrolab_whatsapp_env_v1';

const getTodayIsoDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
};

const getStatusBadgeClasses = (status: WhatsAppOrderStatus) => {
  switch (status) {
    case 'Pendiente de Pago':
      return 'bg-amber-50 text-amber-800 border-amber-300';
    case 'Pagado':
      return 'bg-sky-50 text-sky-800 border-sky-300';
    case 'Enviado a Sinqro':
      return 'bg-purple-50 text-purple-800 border-purple-300';
    case 'Confirmado':
      return 'bg-emerald-50 text-emerald-800 border-emerald-300';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-300';
  }
};

export const WhatsAppModule: React.FC = () => {
  const { userProfile } = useAuth();
  const { activeBranch } = useBranch();

  const [activeSubTab, setActiveSubTab] = useState<WhatsAppSubTab>('chat');

  // Firestore Collections
  const [chats, setChats] = useState<WhatsAppChat[]>([]);
  const [orders, setOrders] = useState<WhatsAppOrderRecord[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string>('');
  const [chatSearch, setChatSearch] = useState('');
  const [agentInput, setAgentInput] = useState('');

  // Env Configuration State
  const [envConfig, setEnvConfig] = useState<WhatsAppIntegrationConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_ENV_KEY);
      if (saved) return { ...DEFAULT_WHATSAPP_CONFIG, ...JSON.parse(saved) };
    } catch {
      // ignore localStorage error
    }
    return DEFAULT_WHATSAPP_CONFIG;
  });
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configViewTab, setConfigViewTab] = useState<'vars' | 'env' | 'package' | 'readme'>('vars');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // Order Actions / Modals
  const [retryingOrderId, setRetryingOrderId] = useState<string | null>(null);
  const [dispatchResultModal, setDispatchResultModal] = useState<{
    order: WhatsAppOrderRecord;
    result: RetryDispatchResult;
  } | null>(null);
  const [payloadPreviewModal, setPayloadPreviewModal] = useState<{
    order: WhatsAppOrderRecord;
    payload: GastroLabOrderPayload;
    signed: SignedRequestArtifacts;
  } | null>(null);
  const [receiptModalOrder, setReceiptModalOrder] = useState<WhatsAppOrderRecord | null>(null);
  const [toastNotice, setToastNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Accounting Filters
  const [dateFilter, setDateFilter] = useState<DateFilterMode>('mes');
  const [customStartDate, setCustomStartDate] = useState<string>(getTodayIsoDate());
  const [customEndDate, setCustomEndDate] = useState<string>(getTodayIsoDate());

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToastNotice({ type, text });
    setTimeout(() => {
      setToastNotice((curr) => (curr?.text === text ? null : curr));
    }, 4500);
  }, []);

  // Load saved WhatsApp env config from Firestore settings/whatsapp
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'whatsapp'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<WhatsAppIntegrationConfig>;
          setEnvConfig((prev) => {
            const merged = { ...prev, ...data };
            try {
              localStorage.setItem(STORAGE_ENV_KEY, JSON.stringify(merged));
            } catch {
              // ignore
            }
            return merged;
          });
        }
      },
      (err) => console.warn('WhatsApp settings listener:', err)
    );
    return () => unsub();
  }, []);

  // Load chats
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'whatsapp_chats'),
      (snapshot) => {
        const list: WhatsAppChat[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<WhatsAppChat, 'id'>),
        }));
        list.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));
        setChats(list);
        setSelectedChatId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id || ''));
      },
      (err) => console.warn('WhatsApp chats listener:', err)
    );
    return () => unsub();
  }, []);

  // Load orders
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'whatsapp_orders'),
      (snapshot) => {
        const list: WhatsAppOrderRecord[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<WhatsAppOrderRecord, 'id'>),
        }));
        list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setOrders(list);
      },
      (err) => console.warn('WhatsApp orders listener:', err)
    );
    return () => unsub();
  }, []);

  const filteredChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (c) =>
        c.customerName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q)
    );
  }, [chats, chatSearch]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === selectedChatId) || filteredChats[0] || null,
    [chats, selectedChatId, filteredChats]
  );

  const transferOrders = useMemo(
    () => orders.filter((o) => o.paymentMethod === 'TRANSFER'),
    [orders]
  );

  // Accounting filtered orders
  const accountingFilteredOrders = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOf7Days = startOfToday - 6 * 24 * 60 * 60 * 1000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return orders.filter((ord) => {
      const createdMs = new Date(ord.createdAt).getTime();
      if (Number.isNaN(createdMs)) return true;

      if (dateFilter === 'hoy') return createdMs >= startOfToday;
      if (dateFilter === '7dias') return createdMs >= startOf7Days;
      if (dateFilter === 'mes') return createdMs >= startOfMonth;
      if (dateFilter === 'personalizado') {
        const sMs = customStartDate ? new Date(`${customStartDate}T00:00:00`).getTime() : 0;
        const eMs = customEndDate ? new Date(`${customEndDate}T23:59:59`).getTime() : Infinity;
        return createdMs >= sMs && createdMs <= eMs;
      }
      return true;
    });
  }, [orders, dateFilter, customStartDate, customEndDate]);

  const accountingMetrics = useMemo(() => {
    const paidOrConfirmed = accountingFilteredOrders.filter(
      (o) => o.paymentStatus === 'PAID' || o.status !== 'Pendiente de Pago'
    );
    const totalRevenue = paidOrConfirmed.reduce((acc, o) => acc + Number(o.total || 0), 0);
    const pendingRevenue = accountingFilteredOrders
      .filter((o) => o.status === 'Pendiente de Pago')
      .reduce((acc, o) => acc + Number(o.total || 0), 0);
    const totalDelivery = paidOrConfirmed.reduce((acc, o) => acc + Number(o.deliveryFee || 0), 0);
    const avgTicket = paidOrConfirmed.length > 0 ? totalRevenue / paidOrConfirmed.length : 0;

    const byMethod = {
      DEUNA: paidOrConfirmed
        .filter((o) => o.paymentMethod === 'DEUNA')
        .reduce((s, o) => s + Number(o.total || 0), 0),
      TRANSFER: paidOrConfirmed
        .filter((o) => o.paymentMethod === 'TRANSFER')
        .reduce((s, o) => s + Number(o.total || 0), 0),
      CASH: paidOrConfirmed
        .filter((o) => o.paymentMethod === 'CASH')
        .reduce((s, o) => s + Number(o.total || 0), 0),
    };

    return {
      totalRevenue,
      pendingRevenue,
      totalDelivery,
      avgTicket,
      paidCount: paidOrConfirmed.length,
      totalCount: accountingFilteredOrders.length,
      byMethod,
    };
  }, [accountingFilteredOrders]);

  // Action: Human intervention in WhatsApp chat
  const handleSendAgentMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChat || !agentInput.trim()) return;

    const nowIso = new Date().toISOString();
    const agentName = userProfile?.name
      ? `${userProfile.name} ${userProfile.lastName || ''}`.trim()
      : 'Agente POS';

    const newMsg: WhatsAppMessage = {
      id: `msg_${Date.now()}`,
      sender: 'agent',
      senderName: agentName,
      text: agentInput.trim(),
      timestamp: nowIso,
    };

    const updatedMessages = [...(activeChat.messages || []), newMsg];
    const updatedChat: WhatsAppChat = {
      ...activeChat,
      lastMessage: newMsg.text,
      lastMessageAt: nowIso,
      unreadCount: 0,
      status: 'humano',
      messages: updatedMessages,
      updatedAt: nowIso,
    };

    setAgentInput('');
    setChats((prev) => prev.map((c) => (c.id === activeChat.id ? updatedChat : c)));

    await commitOfflineSafe(
      updateDoc(doc(db, 'whatsapp_chats', activeChat.id), {
        lastMessage: updatedChat.lastMessage,
        lastMessageAt: updatedChat.lastMessageAt,
        unreadCount: 0,
        status: 'humano',
        messages: updatedMessages,
        updatedAt: nowIso,
      }),
      'whatsapp_agent_reply'
    );
  };

  // Action: Toggle Bot vs Human mode on active chat
  const handleToggleChatMode = async (chat: WhatsAppChat) => {
    const nextStatus: WhatsAppChat['status'] = chat.status === 'humano' ? 'bot' : 'humano';
    setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, status: nextStatus } : c)));
    await commitOfflineSafe(
      updateDoc(doc(db, 'whatsapp_chats', chat.id), {
        status: nextStatus,
        unreadCount: 0,
        updatedAt: new Date().toISOString(),
      }),
      'whatsapp_toggle_mode'
    );
  };

  // Action: Inspect generated dual JSON + HMAC-SHA256 headers
  const handleInspectPayload = async (order: WhatsAppOrderRecord) => {
    const payload = buildGastroLabOrderPayload(order, envConfig);
    const signed = await signGastroLabHmacSha256(
      'POST',
      '/api/whatsapp/orders/dispatch',
      payload,
      envConfig
    );
    setPayloadPreviewModal({ order, payload, signed });
  };

  // Action: Retry dispatch with Exponential Backoff (max 3 attempts)
  const handleRetrySendOrder = async (order: WhatsAppOrderRecord) => {
    setRetryingOrderId(order.id);
    try {
      const result = await sendOrderWithExponentialBackoff(order, envConfig, 3);
      const nowIso = new Date().toISOString();
      const nextStatus: WhatsAppOrderStatus = result.success
        ? order.status === 'Confirmado'
          ? 'Confirmado'
          : 'Enviado a Sinqro'
        : order.status;

      await commitOfflineSafe(
        updateDoc(doc(db, 'whatsapp_orders', order.id), {
          status: nextStatus,
          retryCount: (order.retryCount || 0) + result.attemptsUsed,
          lastSyncedAt: nowIso,
          lastError: result.success ? '' : result.errorMessage || 'Error de red',
          sinqroTrackingId:
            order.sinqroTrackingId ||
            (result.success ? `SQ-${Math.floor(10000 + Math.random() * 89999)}` : ''),
          updatedAt: nowIso,
        }),
        'wa_retry_dispatch'
      );

      setDispatchResultModal({ order: { ...order, status: nextStatus }, result });
      if (result.success) {
        showToast(
          'success',
          `Pedido ${order.externalReference} procesado con HMAC-SHA256 en ${result.attemptsUsed} intento(s).`
        );
      } else {
        showToast(
          'error',
          `Fallo tras ${result.attemptsUsed} intentos con Backoff Exponencial: ${result.errorMessage}`
        );
      }
    } finally {
      setRetryingOrderId(null);
    }
  };

  // Action: Verify bank transfer receipt & mark Verified
  const handleMarkTransferVerified = async (order: WhatsAppOrderRecord) => {
    const verifier = userProfile?.name
      ? `${userProfile.name} ${userProfile.lastName || ''}`.trim()
      : 'Propietario';
    const nowIso = new Date().toISOString();
    const nextStatus: WhatsAppOrderStatus =
      order.status === 'Pendiente de Pago' ? 'Pagado' : order.status;

    await commitOfflineSafe(
      updateDoc(doc(db, 'whatsapp_orders', order.id), {
        transferVerified: true,
        paymentStatus: 'PAID',
        status: nextStatus,
        verifiedBy: verifier,
        verifiedAt: nowIso,
        updatedAt: nowIso,
      }),
      'wa_verify_transfer'
    );

    if (receiptModalOrder?.id === order.id) {
      setReceiptModalOrder({
        ...order,
        transferVerified: true,
        paymentStatus: 'PAID',
        status: nextStatus,
        verifiedBy: verifier,
        verifiedAt: nowIso,
      });
    }
    showToast('success', `Transferencia del pedido ${order.externalReference} marcada como Verificada.`);
  };

  // Action: Save 10 .env variables
  const handleSaveEnvConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      localStorage.setItem(STORAGE_ENV_KEY, JSON.stringify(envConfig));
      await commitOfflineSafe(
        setDoc(
          doc(db, 'settings', 'whatsapp'),
          {
            ...envConfig,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        ),
        'save_wa_env'
      );
      showToast('success', 'Variables de entorno .env guardadas correctamente.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleCopyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      showToast('error', 'No se pudo copiar al portapapeles.');
    }
  };

  const pendingTransfersCount = transferOrders.filter((o) => !o.transferVerified).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-[#4A5D23]/15 p-4 sm:p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#25D366]/15 border border-[#25D366]/30 text-[#128C7E] flex items-center justify-center shrink-0">
            <MessageCircle className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black text-[#1F2937] tracking-tight">
                WhatsApp Business · Automatización y Sinqro
              </h1>
              <span className="px-2.5 py-0.5 rounded-lg bg-[#EAF5F0] text-[#4A5D23] text-[10px] font-black uppercase tracking-wider border border-[#4A5D23]/20">
                HMAC-SHA256 + Backoff 3x
              </span>
            </div>
            <p className="text-xs text-[#4B5563] mt-0.5">
              Bandeja de chats, despacho automático a Sinqro/GASTROLAB, verificación de transferencias y contabilidad WhatsApp.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsConfigModalOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#F6F8F5] text-[#1F2937] border border-[#4A5D23]/25 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Settings2 className="w-4 h-4 text-[#4A5D23]" />
            Variables .env &amp; Backend Node.js
          </button>
        </div>
      </div>

      {/* Toast Feedback */}
      {toastNotice && (
        <div
          className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-xs font-bold shadow-xs ${
            toastNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-rose-50 border-rose-300 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {toastNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{toastNotice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastNotice(null)}
            className="p-1 hover:bg-black/5 rounded-lg cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 4 Sub-Tabs Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 bg-white p-2 rounded-2xl border border-[#4A5D23]/15 shadow-xs">
        <button
          type="button"
          onClick={() => setActiveSubTab('chat')}
          className={`px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeSubTab === 'chat'
              ? 'bg-[#4A5D23] text-white shadow-sm'
              : 'text-[#4B5563] hover:bg-[#F6F8F5]'
          }`}
        >
          <MessageCircle className="w-4 h-4 shrink-0" />
          <span>Chat WhatsApp</span>
          <span
            className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${
              activeSubTab === 'chat' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {chats.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('pedidos')}
          className={`px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeSubTab === 'pedidos'
              ? 'bg-[#4A5D23] text-white shadow-sm'
              : 'text-[#4B5563] hover:bg-[#F6F8F5]'
          }`}
        >
          <Truck className="w-4 h-4 shrink-0" />
          <span>Pedidos Automáticos</span>
          <span
            className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${
              activeSubTab === 'pedidos' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {orders.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('verificacion')}
          className={`px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeSubTab === 'verificacion'
              ? 'bg-[#4A5D23] text-white shadow-sm'
              : 'text-[#4B5563] hover:bg-[#F6F8F5]'
          }`}
        >
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span>Verificación</span>
          {pendingTransfersCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-amber-500 text-white">
              {pendingTransfersCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('contabilidad')}
          className={`px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeSubTab === 'contabilidad'
              ? 'bg-[#4A5D23] text-white shadow-sm'
              : 'text-[#4B5563] hover:bg-[#F6F8F5]'
          }`}
        >
          <DollarSign className="w-4 h-4 shrink-0" />
          <span>Contabilidad WhatsApp</span>
        </button>
      </div>

      {/* ================================================================== */}
      {/* TAB A: CHAT WHATSAPP (INBOX + HUMAN INTERVENTION)                  */}
      {/* ================================================================== */}
      {activeSubTab === 'chat' && (
        <div className="bg-white rounded-2xl border border-[#4A5D23]/15 shadow-xs overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[540px]">
          {/* Left Panel: Chat List */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-gray-200 flex flex-col bg-[#F9FAF8]">
            <div className="p-3 border-b border-gray-200">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                  placeholder="Buscar cliente o teléfono..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-gray-200 text-xs focus:outline-none focus:border-[#4A5D23]"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 max-h-[300px] lg:max-h-[520px]">
              {filteredChats.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-500">
                  No hay conversaciones que coincidan con tu búsqueda.
                </div>
              ) : (
                filteredChats.map((chat) => {
                  const isSelected = activeChat?.id === chat.id;
                  return (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => setSelectedChatId(chat.id)}
                      className={`w-full text-left p-3.5 transition-colors cursor-pointer flex items-start gap-3 ${
                        isSelected ? 'bg-[#EAF5F0] border-l-4 border-[#4A5D23]' : 'hover:bg-white'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-xl bg-[#4A5D23] text-white font-black text-xs flex items-center justify-center shrink-0">
                        {chat.customerName.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-xs text-[#1F2937] truncate">
                            {chat.customerName}
                          </span>
                          <span className="text-[10px] text-gray-400 shrink-0">
                            {new Date(chat.lastMessageAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500 truncate mt-0.5">
                          {chat.lastMessage}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                              chat.status === 'humano'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {chat.status === 'humano' ? 'Intervención Humana' : 'Bot Activo'}
                          </span>
                          {chat.linkedOrderId && (
                            <span className="px-1.5 py-0.5 rounded bg-gray-200/70 text-gray-700 text-[9px] font-mono font-bold">
                              {chat.linkedOrderId.replace('wa_ord_', 'WA-')}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel: Active Conversation */}
          <div className="lg:col-span-8 flex flex-col bg-[#EFEAE2]/40">
            {activeChat ? (
              <>
                <div className="p-3.5 sm:p-4 bg-white border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#128C7E] text-white font-black text-xs flex items-center justify-center">
                      {activeChat.customerName.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-black text-[#1F2937]">
                        {activeChat.customerName}
                      </div>
                      <div className="text-[11px] text-gray-500 font-mono">{activeChat.phone}</div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleChatMode(activeChat)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border cursor-pointer transition-colors ${
                      activeChat.status === 'humano'
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    }`}
                  >
                    {activeChat.status === 'humano' ? (
                      <>
                        <User className="w-3.5 h-3.5" />
                        Modo Humano (Devolver al Bot)
                      </>
                    ) : (
                      <>
                        <Bot className="w-3.5 h-3.5" />
                        Bot Activo (Tomar Control)
                      </>
                    )}
                  </button>
                </div>

                <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[380px]">
                  {(activeChat.messages || []).map((msg) => {
                    const isOutgoing = msg.sender !== 'customer';
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-3.5 py-2.5 shadow-xs border text-xs ${
                            msg.sender === 'agent'
                              ? 'bg-[#DCF8C6] border-[#4A5D23]/20 text-gray-900'
                              : msg.sender === 'bot'
                              ? 'bg-white border-emerald-200 text-gray-900'
                              : 'bg-white border-gray-200 text-gray-900'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3 mb-1">
                            <span className="text-[10px] font-black uppercase tracking-wide text-[#4A5D23]">
                              {msg.sender === 'customer'
                                ? activeChat.customerName
                                : msg.sender === 'agent'
                                ? `Agente · ${msg.senderName || 'POS'}`
                                : 'Bot GASTROLAB'}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                          {msg.attachmentUrl && (
                            <div className="mt-2 p-2 rounded-xl bg-[#F6F8F5] border border-[#4A5D23]/20 flex items-center gap-2 text-[11px] font-bold text-[#4A5D23]">
                              <Receipt className="w-3.5 h-3.5 shrink-0" />
                              <span>{msg.attachmentUrl}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <form
                  onSubmit={handleSendAgentMessage}
                  className="p-3 bg-white border-t border-gray-200 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={agentInput}
                    onChange={(e) => setAgentInput(e.target.value)}
                    placeholder="Escribe un mensaje para intervenir manualmente en este chat..."
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#F6F8F5] border border-gray-200 text-xs focus:outline-none focus:border-[#4A5D23]"
                  />
                  <button
                    type="submit"
                    disabled={!agentInput.trim()}
                    className="px-4 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Enviar
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-xs text-gray-500">
                Selecciona una conversación en la lista izquierda.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB B: PEDIDOS AUTOMÁTICOS + JSON BUILDER + HMAC + BACKOFF RETRY   */}
      {/* ================================================================== */}
      {activeSubTab === 'pedidos' && (
        <div className="bg-white rounded-2xl border border-[#4A5D23]/15 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-[#1F2937]">
                Pedidos Automáticos de WhatsApp hacia Sinqro &amp; GASTROLAB
              </h2>
              <p className="text-[11px] text-gray-500">
                Cada reintento genera JSON dual (<code>items</code> + <code>productos</code>), firma HMAC-SHA256 y aplica Backoff Exponencial (máx. 3 intentos).
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F6F8F5] border-b border-gray-200 text-[10px] font-black uppercase tracking-wider text-gray-600">
                  <th className="py-3 px-4">ID Pedido</th>
                  <th className="py-3 px-4">Cliente</th>
                  <th className="py-3 px-4">Total</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-[#F9FAF8]">
                    <td className="py-3.5 px-4 align-top">
                      <div className="font-mono font-black text-[#1F2937]">
                        {order.externalReference}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] font-bold">
                          {order.paymentMethod}
                        </span>
                        {order.sinqroTrackingId && (
                          <span className="text-[10px] font-mono text-purple-700">
                            {order.sinqroTrackingId}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 align-top">
                      <div className="font-bold text-[#1F2937]">
                        {order.customerFirstName} {order.customerLastName}
                      </div>
                      <div className="text-[11px] text-gray-500">{order.customerPhone}</div>
                      <div className="text-[10px] text-gray-400 truncate max-w-[220px]">
                        {order.customerAddress}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 align-top">
                      <div className="font-black text-[#4A5D23] text-sm">
                        ${Number(order.total || 0).toFixed(2)}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        Envío: ${Number(order.deliveryFee || 0).toFixed(2)}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 align-top">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-[11px] font-bold ${getStatusBadgeClasses(
                          order.status
                        )}`}
                      >
                        {order.status}
                      </span>
                      {typeof order.retryCount === 'number' && order.retryCount > 0 && (
                        <div className="text-[10px] text-gray-400 mt-1">
                          Intentos registrados: {order.retryCount}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 align-top text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleInspectPayload(order)}
                          className="px-2.5 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <FileCode2 className="w-3.5 h-3.5 text-[#4A5D23]" />
                          JSON / HMAC
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRetrySendOrder(order)}
                          disabled={retryingOrderId === order.id}
                          className="px-3 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-60 text-white text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${
                              retryingOrderId === order.id ? 'animate-spin' : ''
                            }`}
                          />
                          {retryingOrderId === order.id ? 'Enviando...' : 'Reintentar Envío'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB C: VERIFICACIÓN DE TRANSFERENCIAS                              */}
      {/* ================================================================== */}
      {activeSubTab === 'verificacion' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-[#4A5D23]/15 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-[#1F2937]">
                Verificación de Comprobantes por Transferencia
              </h2>
              <p className="text-[11px] text-gray-500">
                Revisa los comprobantes enviados por WhatsApp antes de confirmar el pago y liberar a Sinqro.
              </p>
            </div>
            <span className="px-3 py-1 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold self-start sm:self-auto">
              Pendientes por verificar: {pendingTransfersCount}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {transferOrders.length === 0 ? (
              <div className="md:col-span-2 bg-white rounded-2xl border border-gray-200 p-8 text-center text-xs text-gray-500">
                No existen pedidos por transferencia bancaria todavía.
              </div>
            ) : (
              transferOrders.map((order) => (
                <div
                  key={order.id}
                  className={`bg-white rounded-2xl border p-4 shadow-xs space-y-3 ${
                    order.transferVerified ? 'border-emerald-200' : 'border-amber-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-sm text-[#1F2937]">
                          {order.externalReference}
                        </span>
                        {order.transferVerified ? (
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800 text-[10px] font-black uppercase">
                            Verificado
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-[10px] font-black uppercase">
                            Por Verificar
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-bold text-gray-700 mt-1">
                        {order.customerFirstName} {order.customerLastName} · {order.customerPhone}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        Banco: {order.transferBank || 'Transferencia Bancaria'} · Ref:{' '}
                        <span className="font-mono font-bold">
                          {order.transferReference || 'Sin ref.'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-[#4A5D23]">
                        ${Number(order.total || 0).toFixed(2)}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setReceiptModalOrder(order)}
                      className="px-3 py-1.5 rounded-xl border border-gray-200 bg-[#F6F8F5] hover:bg-gray-100 text-gray-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-[#4A5D23]" />
                      Ver Comprobante
                    </button>

                    {!order.transferVerified ? (
                      <button
                        type="button"
                        onClick={() => handleMarkTransferVerified(order)}
                        className="px-3.5 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Marcar como Verificado
                      </button>
                    ) : (
                      <span className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verificado por {order.verifiedBy || 'POS'}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB D: CONTABILIDAD WHATSAPP + FILTROS DE FECHA                    */}
      {/* ================================================================== */}
      {activeSubTab === 'contabilidad' && (
        <div className="space-y-4">
          {/* Date Filters */}
          <div className="bg-white rounded-2xl border border-[#4A5D23]/15 p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-black text-[#1F2937]">
              <Calendar className="w-4 h-4 text-[#4A5D23]" />
              <span>Filtros de Fecha:</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'hoy', label: 'Hoy' },
                  { id: '7dias', label: 'Últimos 7 días' },
                  { id: 'mes', label: 'Este mes' },
                  { id: 'todo', label: 'Todo el historial' },
                  { id: 'personalizado', label: 'Personalizado' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setDateFilter(opt.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                    dateFilter === opt.id
                      ? 'bg-[#4A5D23] text-white'
                      : 'bg-[#F6F8F5] text-gray-700 hover:bg-gray-200/70'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {dateFilter === 'personalizado' && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl border border-gray-300 bg-white"
                />
                <span className="text-gray-500 font-bold">a</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl border border-gray-300 bg-white"
                />
              </div>
            )}
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-[#4A5D23]/15 p-4 shadow-xs">
              <div className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                Ingresos Confirmados WhatsApp
              </div>
              <div className="text-2xl font-black text-[#4A5D23] mt-1">
                ${accountingMetrics.totalRevenue.toFixed(2)}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                {accountingMetrics.paidCount} pedidos pagados de {accountingMetrics.totalCount}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#4A5D23]/15 p-4 shadow-xs">
              <div className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                Pendiente por Cobrar / Verificar
              </div>
              <div className="text-2xl font-black text-amber-600 mt-1">
                ${accountingMetrics.pendingRevenue.toFixed(2)}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                Transferencias o pedidos en espera
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#4A5D23]/15 p-4 shadow-xs">
              <div className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                Ticket Promedio WhatsApp
              </div>
              <div className="text-2xl font-black text-[#1F2937] mt-1">
                ${accountingMetrics.avgTicket.toFixed(2)}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                Delivery recaudado: ${accountingMetrics.totalDelivery.toFixed(2)}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#4A5D23]/15 p-4 shadow-xs space-y-1.5">
              <div className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                Desglose por Método
              </div>
              <div className="flex justify-between text-xs font-bold">
                <span className="text-purple-700 flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5" /> Deuna!
                </span>
                <span>${accountingMetrics.byMethod.DEUNA.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs font-bold">
                <span className="text-sky-700">Transferencia</span>
                <span>${accountingMetrics.byMethod.TRANSFER.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs font-bold">
                <span className="text-emerald-700">Efectivo</span>
                <span>${accountingMetrics.byMethod.CASH.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Filtered Accounting Table */}
          <div className="bg-white rounded-2xl border border-[#4A5D23]/15 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-gray-200 text-xs font-black text-[#1F2937]">
              Detalle Contable de Pedidos WhatsApp ({accountingFilteredOrders.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F6F8F5] border-b border-gray-200 text-[10px] font-black uppercase text-gray-600">
                    <th className="py-2.5 px-4">Fecha</th>
                    <th className="py-2.5 px-4">Pedido</th>
                    <th className="py-2.5 px-4">Cliente</th>
                    <th className="py-2.5 px-4">Método</th>
                    <th className="py-2.5 px-4">Estado</th>
                    <th className="py-2.5 px-4 text-right">Subtotal</th>
                    <th className="py-2.5 px-4 text-right">Envío</th>
                    <th className="py-2.5 px-4 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {accountingFilteredOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-[#F9FAF8]">
                      <td className="py-2.5 px-4 text-gray-500 font-mono text-[11px]">
                        {new Date(ord.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-bold text-[#1F2937]">
                        {ord.externalReference}
                      </td>
                      <td className="py-2.5 px-4 font-semibold">
                        {ord.customerFirstName} {ord.customerLastName}
                      </td>
                      <td className="py-2.5 px-4 font-bold">{ord.paymentMethod}</td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${getStatusBadgeClasses(
                            ord.status
                          )}`}
                        >
                          {ord.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">${Number(ord.subtotal || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right">
                        ${Number(ord.deliveryFee || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-black text-[#4A5D23]">
                        ${Number(ord.total || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: INSPECTOR DE PAYLOAD DUAL + FIRMA HMAC-SHA256               */}
      {/* ================================================================== */}
      {payloadPreviewModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-[#1F2937]">
                  Payload JSON Dual &amp; Firma HMAC-SHA256 ·{' '}
                  {payloadPreviewModal.order.externalReference}
                </h3>
                <p className="text-[11px] text-gray-500">
                  Cadena firmada: <code>{'{timestamp}.{method}.{path}.{body_json}'}</code>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayloadPreviewModal(null)}
                className="p-1.5 rounded-xl hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-900 text-lime-300 font-mono text-[11px] space-y-1 overflow-x-auto">
                <div>Authorization: {payloadPreviewModal.signed.headers.Authorization}</div>
                <div>
                  X-GASTROLAB-Timestamp: {payloadPreviewModal.signed.headers['X-GASTROLAB-Timestamp']}
                </div>
                <div className="break-all">
                  X-GASTROLAB-Signature: {payloadPreviewModal.signed.headers['X-GASTROLAB-Signature']}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-black text-[#1F2937]">
                    JSON del Pedido (<code>items</code> + <code>productos</code>)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        'payload_json',
                        JSON.stringify(payloadPreviewModal.payload, null, 2)
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-[#F6F8F5] hover:bg-gray-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    {copiedId === 'payload_json' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    Copiar JSON
                  </button>
                </div>
                <pre className="p-3 rounded-xl bg-gray-900 text-gray-100 font-mono text-[11px] overflow-x-auto max-h-72">
                  {JSON.stringify(payloadPreviewModal.payload, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: RESULTADO DE REINTENTO CON BACKOFF EXPONENCIAL              */}
      {/* ================================================================== */}
      {dispatchResultModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[#4A5D23]" />
                <h3 className="text-sm font-black text-[#1F2937]">
                  Trazabilidad de Envío · {dispatchResultModal.order.externalReference}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDispatchResultModal(null)}
                className="p-1.5 rounded-xl hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div
                className={`p-3 rounded-xl border font-bold ${
                  dispatchResultModal.result.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {dispatchResultModal.result.success
                  ? `Éxito en ${dispatchResultModal.result.attemptsUsed} intento(s). Estado actual: ${dispatchResultModal.order.status}`
                  : `Fallo definitivo tras ${dispatchResultModal.result.attemptsUsed} intentos con Backoff Exponencial.`}
              </div>
              <div className="p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] space-y-1 max-h-56 overflow-y-auto">
                {dispatchResultModal.result.logs.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: VER COMPROBANTE DE TRANSFERENCIA                            */}
      {/* ================================================================== */}
      {receiptModalOrder && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-black text-[#1F2937]">
                Comprobante · {receiptModalOrder.externalReference}
              </h3>
              <button
                type="button"
                onClick={() => setReceiptModalOrder(null)}
                className="p-1.5 rounded-xl hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-xs">
              <div className="p-4 rounded-2xl bg-[#F6F8F5] border-2 border-dashed border-[#4A5D23]/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase text-[#4A5D23]">
                    Comprobante Digital Recibido
                  </span>
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                </div>
                <div className="text-lg font-black text-[#1F2937]">
                  ${Number(receiptModalOrder.total || 0).toFixed(2)} USD
                </div>
                <div className="text-xs font-bold text-gray-700">
                  {receiptModalOrder.transferBank || 'Banco Local'}
                </div>
                <div className="text-[11px] font-mono bg-white px-2.5 py-1.5 rounded-lg border border-gray-200">
                  Referencia: {receiptModalOrder.transferReference || 'N/D'}
                </div>
                <div className="text-[11px] text-gray-600">
                  Cliente: {receiptModalOrder.customerFirstName} {receiptModalOrder.customerLastName}{' '}
                  ({receiptModalOrder.customerTaxId})
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReceiptModalOrder(null)}
                  className="px-3.5 py-2 rounded-xl border border-gray-200 text-gray-700 font-bold cursor-pointer"
                >
                  Cerrar
                </button>
                {!receiptModalOrder.transferVerified && (
                  <button
                    type="button"
                    onClick={() => handleMarkTransferVerified(receiptModalOrder)}
                    className="px-4 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Marcar como Verificado
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: VARIABLES DE ENTORNO (.ENV) + BACKEND NODE.JS RENDER/RAILWAY*/}
      {/* ================================================================== */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-[#1F2937]">
                  Configuración .env &amp; Backend Node.js (Render / Railway)
                </h3>
                <p className="text-xs text-gray-500">
                  Administra las 10 variables de integración y copia los archivos listos de la carpeta <code>backend-whatsapp/</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsConfigModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 sm:px-5 pt-3 border-b border-gray-200 flex flex-wrap gap-2 bg-[#F9FAF8]">
              {(
                [
                  { id: 'vars', label: '10 Variables (.env)' },
                  { id: 'env', label: 'Archivo .env Generado' },
                  { id: 'package', label: 'package.json (Backend)' },
                  { id: 'readme', label: 'Guía Render / Railway' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setConfigViewTab(t.id)}
                  className={`px-3 py-2 rounded-t-xl text-xs font-bold border-b-2 cursor-pointer ${
                    configViewTab === t.id
                      ? 'border-[#4A5D23] text-[#4A5D23] bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto flex-1">
              {configViewTab === 'vars' && (
                <form onSubmit={handleSaveEnvConfig} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {WHATSAPP_ENV_FIELDS.map((field) => (
                      <div key={field.key} className="space-y-1">
                        <label className="block text-[11px] font-black font-mono text-[#1F2937]">
                          {field.label}
                        </label>
                        <input
                          type={field.secret ? 'password' : 'text'}
                          value={envConfig[field.key] || ''}
                          onChange={(e) =>
                            setEnvConfig((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 rounded-xl border border-gray-300 text-xs font-mono focus:outline-none focus:border-[#4A5D23]"
                        />
                        <p className="text-[10px] text-gray-500">{field.helper}</p>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 border-t border-gray-100 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsConfigModalOpen(false)}
                      className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 cursor-pointer"
                    >
                      Cerrar
                    </button>
                    <button
                      type="submit"
                      disabled={savingConfig}
                      className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold cursor-pointer"
                    >
                      {savingConfig ? 'Guardando...' : 'Guardar Variables'}
                    </button>
                  </div>
                </form>
              )}

              {configViewTab === 'env' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-700">
                      Copia este contenido en tu archivo <code>.env</code> o panel Environment de Render/Railway:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyText('env_text', generateEnvFileContent(envConfig))}
                      className="px-3 py-1.5 rounded-xl bg-[#4A5D23] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedId === 'env_text' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      Copiar .env
                    </button>
                  </div>
                  <pre className="p-4 rounded-xl bg-gray-900 text-lime-300 font-mono text-xs overflow-x-auto">
                    {generateEnvFileContent(envConfig)}
                  </pre>
                </div>
              )}

              {configViewTab === 'package' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-700">
                      Archivo <code>backend-whatsapp/package.json</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyText('pkg_text', BACKEND_PACKAGE_JSON_PREVIEW)}
                      className="px-3 py-1.5 rounded-xl bg-[#4A5D23] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedId === 'pkg_text' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      Copiar package.json
                    </button>
                  </div>
                  <pre className="p-4 rounded-xl bg-gray-900 text-gray-100 font-mono text-xs overflow-x-auto">
                    {BACKEND_PACKAGE_JSON_PREVIEW}
                  </pre>
                </div>
              )}

              {configViewTab === 'readme' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-700">
                      Instrucciones completas disponibles también en <code>backend-whatsapp/README.md</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyText('readme_text', BACKEND_README_PREVIEW)}
                      className="px-3 py-1.5 rounded-xl bg-[#4A5D23] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedId === 'readme_text' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      Copiar Guía
                    </button>
                  </div>
                  <pre className="p-4 rounded-xl bg-gray-900 text-gray-100 font-mono text-xs whitespace-pre-wrap">
                    {BACKEND_README_PREVIEW}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
