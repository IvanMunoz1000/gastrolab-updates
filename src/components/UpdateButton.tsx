import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { desktopUpdates, downloadAndroidUpdate } from '../utils/nativeUpdates';

let updateInProgress = false;

export function UpdateButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const platform = Capacitor.getPlatform();
  if (!desktopUpdates && platform === 'web') return null;

  const check = async () => {
    if (platform === 'ios') {
      setStatus('Consulta las nuevas versiones en el canal donde instalaste GASTROLAB.');
      return;
    }
    if (!navigator.onLine) {
      setStatus('Conéctate a Internet para buscar actualizaciones.');
      return;
    }
    if (updateInProgress) {
      setStatus('Ya hay una actualización en curso.');
      return;
    }
    updateInProgress = true;
    setBusy(true);
    setStatus('Buscando actualizaciones…');
    try {
      if (desktopUpdates) {
        const result = await desktopUpdates.check();
        if (result === 'downloaded') {
          setStatus('Instalando la actualización. GASTROLAB se reiniciará.');
          await desktopUpdates.install();
        } else if (result === 'current') {
          setStatus('Ya tienes la versión más reciente.');
        } else {
          setStatus('El actualizador no está disponible en esta sesión.');
        }
      } else {
        const bundle = await downloadAndroidUpdate();
        if (!bundle) {
          setStatus('Ya tienes la versión más reciente para esta instalación.');
        } else {
          setStatus('Instalando la actualización. GASTROLAB se reiniciará.');
          await CapacitorUpdater.set({ id: bundle.id });
        }
      }
    } catch (error) {
      console.warn('GASTROLAB update:', error);
      setStatus('No se pudo completar la actualización. Inténtalo más tarde.');
    } finally {
      updateInProgress = false;
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" disabled={busy} onClick={() => void check()}
        title="Buscar Actualizaciones" aria-label="Buscar Actualizaciones"
        className="rounded-xl bg-[#4A5D23] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {compact ? <RefreshCw className="h-4 w-4" /> : 'Buscar Actualizaciones'}
      </button>
      {status && <p role="status" className="mt-2 text-xs rounded-md bg-white p-1 text-gray-800">{status}</p>}
    </div>
  );
}
