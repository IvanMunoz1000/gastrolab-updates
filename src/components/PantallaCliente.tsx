import React, { useEffect, useState, useRef } from 'react';
import { usePrinter } from '../context/PrinterContext';
import {
  CUSTOMER_DISPLAY_CHANNEL,
  CUSTOMER_DISPLAY_STORAGE_KEY,
  CustomerDisplayMessage,
} from '../utils/customerDisplayChannel';
import { Receipt, CheckCircle2, Clock, Sparkles, UtensilsCrossed } from 'lucide-react';

export const PantallaCliente: React.FC = () => {
  const { storeSettings } = usePrinter();
  const [displayState, setDisplayState] = useState<CustomerDisplayMessage>(() => {
    try {
      const saved = localStorage.getItem(CUSTOMER_DISPLAY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as CustomerDisplayMessage;
        if (parsed && parsed.type) return parsed;
      }
    } catch {
      // Ignore
    }
    return { type: 'IDLE', timestamp: Date.now() };
  });
  const [nowStr, setNowStr] = useState<string>(() =>
    new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
  );
  const itemsEndRef = useRef<HTMLDivElement>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clockInterval = setInterval(() => {
      setNowStr(new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }));
    }, 15000);
    return () => clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    const applyMessage = (msg: CustomerDisplayMessage) => {
      if (!msg || !msg.type) return;
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      setDisplayState(msg);

      // Phase 3 & 4: After showing the final paid ticket for 10s, cleanly return to Phase 1 Idle
      if (msg.type === 'PAID') {
        resetTimerRef.current = setTimeout(() => {
          setDisplayState({
            type: 'IDLE',
            storeName: msg.storeName,
            localLogoUrl: msg.localLogoUrl,
            slogan: msg.slogan,
            timestamp: Date.now(),
          });
        }, 10000);
      }
    };

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
        bc.onmessage = (event) => {
          applyMessage(event.data as CustomerDisplayMessage);
        };
      } catch {
        // Fallback to storage events
      }
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === CUSTOMER_DISPLAY_STORAGE_KEY && e.newValue) {
        try {
          applyMessage(JSON.parse(e.newValue) as CustomerDisplayMessage);
        } catch {
          // Ignore parse error
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      if (bc) bc.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (displayState.type === 'CART') {
      itemsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [displayState]);

  const localName =
    ('storeName' in displayState && displayState.storeName) || storeSettings.localName || '';
  const localLogo =
    ('localLogoUrl' in displayState && displayState.localLogoUrl) ||
    storeSettings.logoUrl ||
    '/assets/gastrolab_fhd.jpg';
  const localSlogan =
    ('slogan' in displayState && displayState.slogan) ||
    storeSettings.slogan ;

  // FASE 1: LOGO EN REPOSO (IDLE)
  if (displayState.type === 'IDLE') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#2A3D12] via-[#4A5D23] to-[#23320F] text-white flex flex-col justify-between p-6 sm:p-10 select-none">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 bg-white/10 border border-white/20 px-4 py-2 rounded-2xl">
            <img
              src="/assets/gastrolab_fhd.jpg"
              alt="GASTROLAB"
              className="w-8 h-8 rounded-lg object-contain bg-white p-0.5"
            />
            <span className="font-black text-sm tracking-tight text-white">
              GASTRO<span className="text-[#E89E2D]">LAB</span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm font-mono font-bold text-lime-100 bg-black/20 px-4 py-2 rounded-2xl border border-white/10">
            <Clock className="w-4 h-4 text-[#E89E2D]" />
            <span>{nowStr}</span>
          </div>
        </div>

        <div className="flex flex-col items-center text-center my-auto space-y-6 max-w-2xl mx-auto">
          <div className="w-44 h-44 sm:w-56 sm:h-56 rounded-[2.5rem] bg-white p-5 shadow-2xl border-4 border-[#E89E2D]/60 flex items-center justify-center overflow-hidden">
            <img
              src={localLogo}
              alt={localName}
              className="w-full h-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/assets/gastrolab_fhd.jpg';
              }}
            />
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl sm:text-5xl font-black tracking-tight uppercase text-white">
              {localName}
            </h1>
            <p className="text-base sm:text-xl font-semibold text-lime-100/90">{localSlogan}</p>
          </div>
          <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-white/15 border border-white/25 text-sm font-bold text-amber-200">
            <Sparkles className="w-4 h-4 text-[#E89E2D]" />
            <span>¡Bienvenido! Tu orden y ticket virtual aparecerán aquí en tiempo real</span>
          </div>
        </div>

        <div className="text-center text-xs text-lime-200/75 font-semibold tracking-wider uppercase">
          Ticket Virtual · Pantalla del Cliente · GASTROLAB POS
        </div>
      </div>
    );
  }

  // FASE 3 & 4: TICKET FINAL PAGADO Y CIERRE DE AGRADECIMIENTO
  if (displayState.type === 'PAID') {
    return (
      <div className="min-h-screen bg-[#F6F8F5] text-[#1F2937] flex flex-col justify-between p-5 sm:p-8 select-none">
        <div className="bg-[#4A5D23] text-white rounded-3xl p-5 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white p-1.5 flex items-center justify-center shrink-0">
              <img
                src={localLogo}
                alt={localName}
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/assets/gastrolab_fhd.jpg';
                }}
              />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight">{localName}</h2>
              <p className="text-xs sm:text-sm text-lime-100 font-semibold">
                {displayState.tableLabel} · Ticket Virtual Final
              </p>
            </div>
          </div>
          <span className="font-mono text-sm font-bold bg-black/25 px-3.5 py-1.5 rounded-xl">
            {nowStr}
          </span>
        </div>

        <div className="max-w-3xl w-full mx-auto my-auto bg-white border-2 border-emerald-300 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-emerald-900">
              ¡Gracias por tu compra!
            </h1>
            <p className="text-sm font-semibold text-gray-600">
              Cliente: <strong className="text-gray-900">{displayState.clientName}</strong>
              {displayState.invoiceNumber ? ` · Comprobante ${displayState.invoiceNumber}` : ''}
            </p>
          </div>

          <div className="border-y border-dashed border-gray-300 py-4 max-h-56 overflow-y-auto space-y-2">
            {displayState.items.map((it, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm">
                <span className="font-bold text-gray-800">
                  {it.quantity}x {it.name}
                </span>
                <span className="font-mono font-bold text-gray-900">
                  ${((Number(it.price) || 0) * (Number(it.quantity) || 1)).toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30">
              <span className="text-xs font-bold uppercase text-[#4A5D23] block">
                Total Pagado ({displayState.paymentMethod})
              </span>
              <span className="text-3xl font-mono font-black text-[#4A5D23]">
                ${Number(displayState.total || 0).toFixed(2)}
              </span>
            </div>
            {displayState.paymentMethod === 'Efectivo' &&
            Number(displayState.changeAmount || 0) > 0 ? (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300">
                <span className="text-xs font-bold uppercase text-amber-900 block">
                  Tu Cambio / Vuelto
                </span>
                <span className="text-3xl font-mono font-black text-[#D97706]">
                  ${Number(displayState.changeAmount || 0).toFixed(2)}
                </span>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center text-sm font-bold text-gray-600">
                ¡Que disfrutes tu pedido!
              </div>
            )}
          </div>
        </div>

        <div className="text-center text-xs text-gray-500 font-semibold">
          Esta pantalla regresará automáticamente al inicio en unos segundos · GASTROLAB POS
        </div>
      </div>
    );
  }

  // FASE 2: TICKET VIRTUAL EN VIVO (CART)
  return (
    <div className="min-h-screen bg-[#F6F8F5] text-[#1F2937] flex flex-col p-4 sm:p-6 gap-4 select-none">
      {/* Store Header */}
      <div className="bg-[#4A5D23] text-white rounded-3xl p-4 sm:p-5 flex items-center justify-between shadow-md shrink-0">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white p-1.5 flex items-center justify-center shrink-0">
            <img
              src={localLogo}
              alt={localName}
              className="w-full h-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/assets/gastrolab_fhd.jpg';
              }}
            />
          </div>
          <div>
            <h1 className="text-lg sm:text-2xl font-black uppercase tracking-tight leading-none">
              {localName}
            </h1>
            <p className="text-xs sm:text-sm text-lime-100 font-semibold mt-1">
              {displayState.tableLabel} · Ticket Virtual en Vivo
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-black/20 px-3.5 py-2 rounded-2xl font-mono text-sm font-bold">
          <Clock className="w-4 h-4 text-[#E89E2D]" />
          <span>{nowStr}</span>
        </div>
      </div>

      {/* Live Order Items List */}
      <div className="flex-1 bg-white border border-gray-200 rounded-3xl p-5 shadow-sm flex flex-col overflow-hidden">
        <div className="flex items-center justify-between pb-3 border-b border-gray-200 mb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-[#4A5D23]" />
            <h2 className="text-base sm:text-lg font-black text-gray-900">Detalle de tu Pedido</h2>
          </div>
          <span className="px-3 py-1 rounded-full bg-[#EAF5F0] text-[#4A5D23] text-xs font-black">
            {displayState.items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0)} artículos
          </span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {displayState.items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 py-12">
              <UtensilsCrossed className="w-12 h-12 text-[#4A5D23]/30 mb-2" />
              <p className="text-sm font-bold text-gray-600">Esperando productos de tu orden...</p>
            </div>
          ) : (
            displayState.items.map((item, idx) => (
              <div
                key={`${item.productId}_${idx}`}
                className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-lg bg-[#4A5D23] text-white font-mono font-black text-sm">
                      {item.quantity}x
                    </span>
                    <span className="font-extrabold text-base text-gray-900">{item.name}</span>
                    {item.dinerName && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-xs font-bold">
                        {item.dinerName}
                      </span>
                    )}
                  </div>
                  {item.selectedCustomizations && item.selectedCustomizations.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
                      {item.selectedCustomizations.map((c, cIdx) => (
                        <span
                          key={cIdx}
                          className="px-2 py-0.5 rounded bg-white border border-amber-200 text-xs font-bold text-amber-900"
                        >
                          + {c.optionName}
                          {c.extraPrice > 0 ? ` (+$${Number(c.extraPrice).toFixed(2)})` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.notes && (
                    <p className="text-xs text-gray-500 italic mt-1 pl-1">Nota: {item.notes}</p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <div className="font-mono font-black text-lg text-[#4A5D23]">
                    ${((Number(item.price) || 0) * (Number(item.quantity) || 1)).toFixed(2)}
                  </div>
                  <div className="text-xs font-mono text-gray-500">
                    ${(Number(item.price) || 0).toFixed(2)} c/u
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={itemsEndRef} />
        </div>
      </div>

      {/* Live Total Bar */}
      <div className="bg-[#2A3D12] text-white rounded-3xl p-5 sm:p-6 shadow-lg flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-lime-200 block">
            Subtotal / Total Estimado
          </span>
          <span className="text-xs text-white/75">
            Incluye impuestos de ley aplicables · Solo lectura
          </span>
        </div>
        <div className="text-right">
          <span className="font-mono font-black text-4xl sm:text-5xl text-[#E89E2D]">
            ${Number(displayState.total || 0).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
};
