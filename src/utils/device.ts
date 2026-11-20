import { DeviceSession, DeviceType } from '../types';

const DEVICE_ID_KEY = 'gastrolab_device_id';

/**
 * Returns or generates a unique, persistent hardware/client ID for this browser instance.
 */
export function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/**
 * Detects whether the current device is a PC (Desktop/Laptop) or Mobile (Phone/Tablet).
 */
export function detectDeviceType(): DeviceType {
  const ua = navigator.userAgent.toLowerCase();
  const isMobileUa = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
  const isSmallScreen = window.innerWidth <= 768;
  const hasTouchOnly = navigator.maxTouchPoints > 1 && isSmallScreen;

  if (isMobileUa || hasTouchOnly) {
    return 'Mobile';
  }
  return 'PC';
}

/**
 * Formats a user-friendly name for this device (e.g., "Chrome on Windows (PC)").
 */
export function getDeviceDisplayName(type: DeviceType): string {
  const ua = navigator.userAgent;
  let browser = 'Browser';
  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';

  let os = 'Device';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone')) os = 'iPhone';
  else if (ua.includes('iPad')) os = 'iPad';
  else if (ua.includes('Linux')) os = 'Linux';

  return `${browser} on ${os} (${type})`;
}

/**
 * Creates a current DeviceSession descriptor.
 */
export function getCurrentDeviceSession(): DeviceSession {
  const type = detectDeviceType();
  return {
    deviceId: getOrCreateDeviceId(),
    deviceType: type,
    deviceName: getDeviceDisplayName(type),
    userAgent: navigator.userAgent.substring(0, 150),
    registeredAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
  };
}
