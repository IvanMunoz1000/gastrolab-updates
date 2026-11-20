import { OrderItemCustomization, Promotion } from '../types';

export const SPANISH_WEEKDAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

export interface GroupedCustomization {
  groupLabel: string;
  options: Array<{ optionName: string; extraPrice: number }>;
}

/**
 * Groups selected product customizations by groupName so each group title
 * (e.g., "Salsas a Elegir:") is printed/shown ONCE with its options listed underneath.
 */
export function groupOrderCustomizations(
  customizations?: OrderItemCustomization[]
): GroupedCustomization[] {
  if (!customizations || customizations.length === 0) return [];

  const groupsMap = new Map<string, GroupedCustomization>();

  for (const cust of customizations) {
    const rawGroup = (cust.groupName || 'Opciones').trim().replace(/:+$/, '');
    const key = rawGroup.toLowerCase();
    const optName = (cust.optionName || '').trim();
    if (!optName) continue;

    let entry = groupsMap.get(key);
    if (!entry) {
      entry = {
        groupLabel: `${rawGroup}:`,
        options: [],
      };
      groupsMap.set(key, entry);
    }

    const extra = Number(cust.extraPrice) || 0;
    const duplicate = entry.options.some(
      (o) => o.optionName.toLowerCase() === optName.toLowerCase()
    );
    if (!duplicate) {
      entry.options.push({ optionName: optName, extraPrice: extra });
    }
  }

  return Array.from(groupsMap.values());
}

/**
 * Formats YYYY-MM-DD in local time without UTC timezone drift.
 */
export function getLocalIsoDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns today's Spanish weekday name matching SPANISH_WEEKDAYS.
 */
export function getSpanishWeekday(date: Date = new Date()): string {
  const map = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return map[date.getDay()] || 'Lunes';
}

/**
 * Checks whether a Promotion is currently active, matches branch, date range, and weekday.
 */
export function isPromotionValidNow(
  promo: Promotion,
  activeBranch?: string,
  nowDate: Date = new Date()
): boolean {
  if (promo.active === false) return false;

  if (promo.branch && activeBranch && promo.branch !== activeBranch) {
    return false;
  }

  const todayStr = getLocalIsoDate(nowDate);
  if (promo.startDate && promo.startDate.trim() !== '' && todayStr < promo.startDate.trim()) {
    return false;
  }
  if (promo.endDate && promo.endDate.trim() !== '' && todayStr > promo.endDate.trim()) {
    return false;
  }

  if (Array.isArray(promo.daysOfWeek) && promo.daysOfWeek.length > 0) {
    const todayName = getSpanishWeekday(nowDate);
    if (!promo.daysOfWeek.includes(todayName)) {
      return false;
    }
  }

  return true;
}
