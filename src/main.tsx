import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { desktopUpdates } from './utils/nativeUpdates';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if ('serviceWorker' in navigator && !Capacitor.isNativePlatform() && !desktopUpdates) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service Worker registration notice:', err);
    });
  });
}

function NativeApp() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      void CapacitorUpdater.notifyAppReady().catch((error) => {
        console.warn('Capacitor update readiness:', error);
      });
    }
  }, []);
  return <App />;
}

createRoot(document.getElementById('root')!).render(<NativeApp />);
