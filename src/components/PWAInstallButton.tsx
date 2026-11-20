import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export const PWAInstallButton: React.FC = () => {
  return null;
};

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [bannerMode, setBannerMode] = useState<'offline' | 'reconnected' | null>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : null
  );
  const prevOnlineRef = React.useRef<boolean>(isOnline);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (!isOnline) {
      setBannerMode('offline');
      timer = setTimeout(() => {
        setBannerMode(null);
      }, 2000);
    } else if (prevOnlineRef.current === false && isOnline) {
      setBannerMode('reconnected');
      timer = setTimeout(() => {
        setBannerMode(null);
      }, 2000);
    }

    prevOnlineRef.current = isOnline;

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isOnline]);

  if (!bannerMode) return null;

  return (
    <div
      className={`fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-bold text-white shadow-lg border transition-all ${
        bannerMode === 'offline'
          ? 'bg-rose-600 border-rose-300'
          : 'bg-emerald-600 border-emerald-300'
      }`}
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>
        {bannerMode === 'offline'
          ? 'Sin Conexión a Internet — Guardado local activo'
          : 'Conexión Restablecida — Sincronizando datos'}
      </span>
    </div>
  );
};

