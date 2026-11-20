import { useAuth } from '../context/AuthContext';
import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Shield,
  Download,
  Building2,
  KeyRound,
  CheckCircle2,
  Lock,
  AlertCircle,
  Sliders,
  Save,
} from 'lucide-react';
import { collection, onSnapshot, query, doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { Order, ClientOverride } from '../types';
import { download200LicensesCsv } from '../utils/licenseCsvExport';
import { isValidCreatorCode } from '../utils/cryptoAuth';

interface CreatorMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface BranchStore {
  id: string;
  name: string;
  branch: string;
  ruc: string;
  ownerName: string;
  ownerEmail: string;
  authStatusNote: string;
  salesMonth: string;
  salesToday: string;
  ordersCount: number;
  licenseStatus: 'Activa' | 'Demo' | 'Expirada';
  licenseKey: string;
  validUntil: string;
}

export const CreatorMasterModal: React.FC<CreatorMasterModalProps> = ({ isOpen, onClose }) => {
  const { ownerProfile, systemLicense } = useAuth();
  const [identity, setIdentity] = useState<{ localName?: string; ruc?: string }>({});
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);

  const [selectedStore, setSelectedStore] = useState<BranchStore | null>(null);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [creatorFeedback, setCreatorFeedback] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Isolated per-client overrides (client_overrides/{storeId})
  const [overridesMap, setOverridesMap] = useState<Record<string, ClientOverride>>({});
  const [editingOverrideStore, setEditingOverrideStore] = useState<BranchStore | null>(null);
  const [ovTag, setOvTag] = useState('');
  const [ovBannerText, setOvBannerText] = useState('');
  const [ovTaxRate, setOvTaxRate] = useState('');
  const [ovNotes, setOvNotes] = useState('');
  const [isSavingOverride, setIsSavingOverride] = useState(false);

  const [liveTodaySales, setLiveTodaySales] = useState<number>(0);
  const [liveMonthSales, setLiveMonthSales] = useState<number>(0);
  const [liveOrdersCount, setLiveOrdersCount] = useState<number>(0);

  useEffect(() => {
    if (!isOpen || !isUnlocked || !auth.currentUser) return;
    const unsub = onSnapshot(
      query(collection(db, 'orders')),
      (snap) => {
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const monthStr = todayStr.slice(0, 7);
        let tSum = 0;
        let mSum = 0;
        let count = 0;

        snap.forEach((docSnap) => {
          const o = docSnap.data() as Order;
          if (o.status === 'Anulado') return;
          const amt = Number(o.total || 0);
          const created = typeof o.createdAt === 'string' ? o.createdAt : '';
          if (created.startsWith(monthStr)) {
            mSum += amt;
          }
          if (created.startsWith(todayStr)) {
            tSum += amt;
            count++;
          }
        });

        setLiveTodaySales(tSum);
        setLiveMonthSales(mSum);
        setLiveOrdersCount(count);
      },
      (err) => {
        console.warn('Creator orders listener notice:', err?.code || err?.message);
      }
    );

    const unsubIdentity = onSnapshot(doc(db, 'settings', 'general'), (snap) => {
      setIdentity(snap.data() ?? {});
    }, (err) => console.warn('Creator settings listener:', err));

    const unsubOverrides = onSnapshot(
      collection(db, 'client_overrides'),
      (snap) => {
        const map: Record<string, ClientOverride> = {};
        snap.forEach((d) => {
          map[d.id] = { id: d.id, ...(d.data() as Omit<ClientOverride, 'id'>) };
        });
        setOverridesMap(map);
      },
      (err) => {
        console.warn('Creator overrides listener notice:', err?.code || err?.message);
      }
    );

    return () => {
      unsub();
      unsubOverrides();
      unsubIdentity();
    };
  }, [isOpen, isUnlocked]);

  useEffect(() => {
    if (!isOpen) {
      setPinInput('');
      setPinError(null);
      setIsUnlocked(false);
      setShowCredentialsModal(false);
      setEditingOverrideStore(null);
      setCreatorFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifyingPin(true);
    try {
      const valid = await isValidCreatorCode(pinInput);
      if (valid) {
        setIsUnlocked(true);
        setPinError(null);
        setPinInput('');
      } else {
        setPinError('Clave maestra incorrecta. Acceso reservado únicamente para Iván Muñoz.');
      }
    } finally {
      setIsVerifyingPin(false);
    }
  };

  const registeredStores: BranchStore[] = identity.localName ? [{
    id: 'store_1',
    name: identity.localName,
    branch: 'Matriz',
    ruc: identity.ruc || '',
    ownerName: [ownerProfile?.name, ownerProfile?.lastName].filter(Boolean).join(' '),
    ownerEmail: ownerProfile?.email || '',
    authStatusNote: 'Autenticación Firebase',
    salesMonth: `$${Math.max(liveMonthSales, 0).toFixed(2)}`,
    salesToday: `$${Math.max(liveTodaySales, 0).toFixed(2)}`,
    ordersCount: liveOrdersCount,
    licenseStatus: systemLicense?.status === 'active' ? 'Activa' :
      systemLicense?.status === 'expired' ? 'Expirada' : 'Demo',
    licenseKey: systemLicense?.activeLicenseCode || '',
    validUntil: systemLicense?.licenseValidUntil || systemLicense?.trialEndsAt || '',
  }] : [];

  const handleDownloadCsv = () => {
    download200LicensesCsv();
    setDownloadSuccess(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDownloadSuccess(false), 4500);
  };

  const openCredentials = (store: BranchStore) => {
    setSelectedStore(store);
    setShowCredentialsModal(true);
  };

  const openOverrideEditor = (store: BranchStore) => {
    const existing = overridesMap[store.id];
    setEditingOverrideStore(store);
    setOvTag(existing?.customTag || '');
    setOvBannerText(existing?.featureFlags?.customBannerText || '');
    setOvTaxRate(
      existing?.featureFlags?.customTaxRate != null
        ? String(existing.featureFlags.customTaxRate)
        : ''
    );
    setOvNotes(existing?.notes || '');
  };

  const handleSaveClientOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOverrideStore) return;
    setIsSavingOverride(true);
    try {
      const parsedTax = ovTaxRate.trim() !== '' ? parseFloat(ovTaxRate) : null;
      const payload: Omit<ClientOverride, 'id'> = {
        storeId: editingOverrideStore.id,
        storeName: `${editingOverrideStore.name} · ${editingOverrideStore.branch}`,
        customTag: ovTag.trim(),
        notes: ovNotes.trim(),
        featureFlags: {
          customPricingEnabled: Boolean(ovTag.trim() || ovBannerText.trim()),
          customBannerText: ovBannerText.trim(),
          customTaxRate: parsedTax !== null && !isNaN(parsedTax) ? parsedTax : null,
        },
        updatedBy: 'Iván Muñoz',
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'client_overrides', editingOverrideStore.id), payload, { merge: true });
      setCreatorFeedback(
        `Personalización aislada guardada exclusivamente para ${editingOverrideStore.name} (${editingOverrideStore.branch}). Los demás locales no fueron afectados.`
      );
      setEditingOverrideStore(null);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCreatorFeedback(null), 5000);
    } catch (err: any) {
      setCreatorFeedback('Error al guardar personalización: ' + (err?.message || 'Error'));
    } finally {
      setIsSavingOverride(false);
    }
  };

  // Step 1: Creator Master Authentication Gate (hidden role only for Iván Muñoz)
  if (!isUnlocked) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-sm bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl text-[#1F2937]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-xl bg-gray-100 text-gray-500 hover:text-gray-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex flex-col items-center text-center mb-5">
            <div className="w-12 h-12 rounded-2xl bg-[#4A5D23] text-white flex items-center justify-center shadow-md mb-3">
              <Shield className="w-6 h-6 text-[#D97706]" />
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30">
              Acceso Maestro
            </span>
            <h3 className="text-lg font-black text-[#1F2937] mt-1.5">
              PROPIETARIO
            </h3>
            <p className="text-xs text-[#4B5563] mt-0.5">
              Panel de administración maestra · Iván Muñoz
            </p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#4B5563] mb-1">
                Clave Maestra del PROPIETARIO
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  autoFocus
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="Ingresa clave maestra..."
                  className="w-full bg-[#F8F9FA] border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-2xl pl-10 pr-4 py-2.5 text-sm font-mono font-bold text-[#1F2937] focus:outline-none"
                />
              </div>
            </div>

            {pinError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{pinError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isVerifyingPin}
              className="w-full py-3 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider cursor-pointer shadow-md transition-all"
            >
              {isVerifyingPin ? 'Verificando...' : 'Desbloquear Panel Maestro'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl bg-[#FFFFFF] border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-2xl text-[#1F2937] max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between pb-5 border-b border-gray-200">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#4A5D23] text-white flex items-center justify-center shadow-md">
              <Shield className="w-6 h-6 text-[#D97706]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30">
                  PROPIETARIO
                </span>
                <span className="text-xs font-bold text-gray-500">
                  Acceso Maestro
                </span>
              </div>
              <h2 className="text-xl font-black text-[#1F2937] tracking-tight mt-0.5">
                Panel Maestro del Propietario — Iván Muñoz
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-2xl bg-[#F8F9FA] hover:bg-gray-100 text-gray-500 hover:text-gray-900 border border-gray-200 transition-colors cursor-pointer"
            title="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Banner & 200 Codes CSV Button (Point 12) */}
        <div className="mt-4 p-4 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-[#1F2937] gap-3">
          <p className="font-medium text-gray-700">
            <strong className="text-[#4A5D23]">Control Maestro Multi-Local:</strong> Vista exclusiva e invisible para los clientes. Consulta ventas por establecimiento, credenciales de propietarios y genera códigos de licencia anuales en CSV.
          </p>

          <button
            type="button"
            onClick={handleDownloadCsv}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#D97706]" />
            Generar 200 Códigos de Licencia
          </button>
        </div>

        {downloadSuccess && (
          <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Archivo .CSV descargado con 200 códigos únicos alfanuméricos de 12 caracteres (sin secuencias).</span>
          </div>
        )}

        {creatorFeedback && (
          <div className="mt-3 p-3 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/40 text-[#4A5D23] text-xs font-bold flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#4A5D23] shrink-0" />
              <span>{creatorFeedback}</span>
            </div>
            <button
              type="button"
              onClick={() => setCreatorFeedback(null)}
              className="p-1 hover:bg-black/5 rounded-lg cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Stores list */}
        <div className="flex-1 overflow-y-auto mt-4 space-y-3.5 pr-1">
          <h3 className="text-xs font-black uppercase tracking-wider text-gray-500 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#4A5D23]" />
            Locales Registrados y Ventas ({registeredStores.length})
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {registeredStores.map((store) => {
              const storeOverride = overridesMap[store.id];
              return (
                <div
                  key={store.id}
                  className="p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200 flex flex-col justify-between hover:border-[#4A5D23] transition-all shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-black text-sm text-[#4A5D23] uppercase">
                        {store.name}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          store.licenseStatus === 'Activa'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-amber-100 text-[#D97706] border border-amber-300'
                        }`}
                      >
                        {store.licenseStatus}
                      </span>
                    </div>

                    <p className="text-xs font-bold text-gray-800">{store.branch}</p>
                    <p className="text-[11px] font-mono text-gray-500">RUC: {store.ruc}</p>

                    {storeOverride?.customTag && (
                      <div className="mt-2 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-900 truncate">
                        Aislado: {storeOverride.customTag}
                      </div>
                    )}

                    <div className="mt-3 pt-3 border-t border-gray-200 space-y-1 text-xs">
                      <div className="flex items-center justify-between text-gray-600">
                        <span>Ventas del Mes:</span>
                        <strong className="text-gray-900 font-bold">{store.salesMonth}</strong>
                      </div>
                      <div className="flex items-center justify-between text-gray-600">
                        <span>Ventas de Hoy:</span>
                        <strong className="text-emerald-700 font-bold">{store.salesToday}</strong>
                      </div>
                      <div className="flex items-center justify-between text-gray-600">
                        <span>Vigencia Licencia:</span>
                        <strong className="text-[#4A5D23] font-mono">{store.validUntil}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-200 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => openCredentials(store)}
                      className="w-full py-2 px-3 rounded-xl bg-white hover:bg-gray-100 border border-gray-200 text-[#4A5D23] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-[#D97706]" />
                      Ver credenciales del Propietario
                    </button>
                    <button
                      type="button"
                      onClick={() => openOverrideEditor(store)}
                      className="w-full py-2 px-3 rounded-xl bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white border border-[#4A5D23]/30 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      Personalizar Cliente (Aislado)
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-5 pt-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
          <span className="font-mono text-[11px]">
            GASTROLAB by Iván Muñoz · PROPIETARIO
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-bold text-xs cursor-pointer shadow-xs"
          >
            Cerrar Panel Maestro
          </button>
        </div>
      </div>

      {/* Submodal: Ver Credenciales del Propietario */}
      {showCredentialsModal && selectedStore && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="relative w-full max-w-md bg-white rounded-3xl p-6 border border-gray-200 shadow-2xl text-[#1F2937]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-[#4A5D23]/10 text-[#4A5D23] flex items-center justify-center">
                  <KeyRound className="w-5 h-5 text-[#4A5D23]" />
                </div>
                <div>
                  <h4 className="font-extrabold text-sm text-[#1F2937]">
                    Credenciales del Propietario
                  </h4>
                  <p className="text-xs text-gray-500">{selectedStore.name} · {selectedStore.branch}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCredentialsModal(false)}
                className="p-1.5 rounded-xl bg-gray-100 text-gray-500 hover:text-gray-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-[#F8F9FA] border border-gray-200">
                <span className="text-[10px] uppercase font-bold text-gray-400 block">Propietario / Titular</span>
                <span className="font-bold text-sm text-gray-900 block mt-0.5">{selectedStore.ownerName}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#F8F9FA] border border-gray-200">
                <span className="text-[10px] uppercase font-bold text-gray-400 block">Correo Electrónico</span>
                <span className="font-mono font-bold text-gray-900 block mt-0.5">{selectedStore.ownerEmail}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#F8F9FA] border border-gray-200">
                <span className="text-[10px] uppercase font-bold text-gray-400 block">Estado de Seguridad</span>
                <span className="font-mono text-xs font-bold text-[#4A5D23] block mt-1">
                  {selectedStore.authStatusNote}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#F8F9FA] border border-gray-200">
                <span className="text-[10px] uppercase font-bold text-gray-400 block">Código de Licencia Asignado (12 Caracteres)</span>
                <span className="font-mono font-black text-sm text-[#D97706] tracking-widest block mt-0.5">
                  {selectedStore.licenseKey}
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreatorFeedback(
                    `Acceso invisible activado para supervisión de ${selectedStore.name} (${selectedStore.branch}).`
                  );
                  setShowCredentialsModal(false);
                  if (timerRef.current) clearTimeout(timerRef.current);
                  timerRef.current = setTimeout(() => setCreatorFeedback(null), 5000);
                }}
                className="flex-1 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors text-center"
              >
                Entrar en Modo Invisible
              </button>
              <button
                type="button"
                onClick={() => setShowCredentialsModal(false)}
                className="py-2 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submodal: Personalización Aislada por Cliente (solo afecta este storeId) */}
      {editingOverrideStore && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
          onClick={() => setEditingOverrideStore(null)}
        >
          <form
            onSubmit={handleSaveClientOverride}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-3xl p-6 border border-gray-200 shadow-2xl text-[#1F2937] space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <div>
                <h4 className="font-extrabold text-sm text-[#1F2937]">
                  Actualización Aislada por Cliente
                </h4>
                <p className="text-xs text-[#4A5D23] font-bold">
                  {editingOverrideStore.name} · {editingOverrideStore.branch} ({editingOverrideStore.id})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingOverrideStore(null)}
                className="p-1.5 rounded-xl bg-gray-100 text-gray-500 hover:text-gray-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
              Los cambios aquí aplicados se guardan exclusivamente para <strong>{editingOverrideStore.branch}</strong> y NO modifican ni alteran la app de otros clientes o locales.
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Etiqueta / Versión Personalizada del Cliente
                </label>
                <input
                  type="text"
                  placeholder="Ej. Edición VIP · Menú Temporal"
                  value={ovTag}
                  onChange={(e) => setOvTag(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Mensaje / Banner Exclusivo en Panel
                </label>
                <input
                  type="text"
                  placeholder="Ej. Actualización especial aplicada para este local"
                  value={ovBannerText}
                  onChange={(e) => setOvBannerText(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  IVA % Personalizado (Opcional)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="30"
                  placeholder="Ej. 15 (dejar vacío para usar general)"
                  value={ovTaxRate}
                  onChange={(e) => setOvTaxRate(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs font-mono text-gray-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Notas Técnicas del Propietario
                </label>
                <textarea
                  rows={2}
                  placeholder="Registro de cambios hechos solo a este cliente..."
                  value={ovNotes}
                  onChange={(e) => setOvNotes(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none resize-none"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingOverrideStore(null)}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSavingOverride}
                className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {isSavingOverride ? 'Guardando...' : 'Guardar Solo Para Este Cliente'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
