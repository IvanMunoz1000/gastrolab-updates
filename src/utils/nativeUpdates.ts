import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { version } from '../../package.json';
import firebaseConfig from '../../firebase-applet-config.json';

type DesktopUpdates = {
  check: () => Promise<'current' | 'downloaded' | 'disabled' | 'busy'>;
  install: () => Promise<void>;
};

export const desktopUpdates = (window as Window & {
  gastrolabUpdates?: DesktopUpdates;
}).gastrolabUpdates;

const feed = new URL(
  '/actualizaciones/android/',
  `https://${firebaseConfig.projectId}.web.app`,
);
const versionFormat = /^\d+\.\d+\.\d+$/;

function isNewer(candidate: string, installed: string): boolean {
  const parts = candidate.split('.').map(Number);
  const current = installed.split('.').map(Number);
  const index = parts.findIndex((part, i) => part !== current[i]);
  return index >= 0 && parts[index] > current[index];
}

export async function downloadAndroidUpdate() {
  if (Capacitor.getPlatform() !== 'android') throw new Error('Plataforma incompatible.');
  const native = await App.getInfo();
  if (!versionFormat.test(native.version)) throw new Error('Versión nativa inválida.');
  const response = await fetch(new URL(`${native.version}/latest.json`, feed), {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('El servidor de actualizaciones no está disponible.');
  const release = await response.json();
  if (release.nativeVersion !== native.version || typeof release.version !== 'string' ||
      !versionFormat.test(release.version) || typeof release.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(release.sha256)) {
    throw new Error('El manifiesto de actualización es inválido.');
  }
  if (!isNewer(release.version, version)) return null;
  const archive = new URL(`${native.version}/GASTROLAB-${release.version}.zip`, feed);
  return CapacitorUpdater.download({
    url: archive.href,
    version: release.version,
    checksum: release.sha256,
  });
}
