import ExcelJS from 'exceljs';
import { collection, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { belongsToBranch, normalizeBranchName } from '../context/BranchContext';
import { getDocsOfflineSafe } from './offlineFirestore';
import {
  Order,
  Product,
  InventoryItem,
  KardexEntry,
  PurchaseInvoice,
  WasteRecord,
  CashShift,
  CashMovement,
} from '../types';

export type ExecutiveReportId =
  | 'mesas_pedidos'
  | 'reservas'
  | 'carta_rotacion'
  | 'menaje_conteo'
  | 'caja_turnos'
  | 'facturacion'
  | 'facturas_compras'
  | 'kardex'
  | 'control_mermas';

export interface StoreReportMeta {
  localName?: string;
  ruc?: string;
  address?: string;
  logoUrl?: string;
  branch?: string;
}

export interface ReportDateRange {
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}

export interface ExecutivePreviewColumn {
  header: string;
  key: string;
  width: number;
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
}

export interface ExecutivePreviewTable {
  sheetName: string;
  title: string;
  subtitle: string;
  columns: ExecutivePreviewColumn[];
  rows: Record<string, any>[];
  totalsRow?: Record<string, any>;
  highlightRowFn?: (row: Record<string, any>) => 'warn' | 'danger' | 'ok' | null;
}

export interface ExecutiveReportPreviewData {
  reportId: ExecutiveReportId;
  filename: string;
  sheets: ExecutivePreviewTable[];
}

const OLIVE_HEX = 'FF4A5D23';
const LIGHT_OLIVE_HEX = 'FFEAF5F0';
const ZEBRA_HEX = 'FFF9FAFB';
const BORDER_HEX = 'FFD1D5DB';

/**
 * Fetches or rasterizes any logo URL / DataURL into a crisp PNG ArrayBuffer for ExcelJS.
 */
async function loadLogoPngBuffer(logoUrl?: string): Promise<ArrayBuffer | null> {
  const candidates = [
    logoUrl,
    '/assets/gastrolab_fhd.jpg',
    '/assets/gastrolab_fhd.jpg',
  ].filter(Boolean) as string[];

  for (const src of candidates) {
    try {
      const pngBuffer = await new Promise<ArrayBuffer | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const size = 200;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, size, size);
            const ratio = Math.min(size / img.width, size / img.height);
            const w = img.width * ratio;
            const h = img.height * ratio;
            ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
            canvas.toBlob(
              (blob) => {
                if (!blob) {
                  resolve(null);
                  return;
                }
                blob.arrayBuffer().then(resolve).catch(() => resolve(null));
              },
              'image/png',
              0.95
            );
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
      if (pngBuffer) return pngBuffer;
    } catch {
      // Try next fallback candidate
    }
  }
  return null;
}

function triggerExcelDownload(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDateOnly(iso?: string): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return iso.split('T')[0];
}

function isWithinRange(dateStr: string | undefined, range: ReportDateRange): boolean {
  if (!range.startDate && !range.endDate) return true;
  const d = formatDateOnly(dateStr);
  if (!d) return true;
  if (range.startDate && d < range.startDate) return false;
  if (range.endDate && d > range.endDate) return false;
  return true;
}

function safeFileSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
}

function styleSheetHeaderWithLogo(
  sheet: ExcelJS.Worksheet,
  imageId: number | null,
  meta: StoreReportMeta,
  reportTitle: string,
  subtitle: string,
  totalCols: number
): number {
  const safeCols = Math.max(4, totalCols);
  sheet.views = [{ showGridLines: true }];

  sheet.getRow(1).height = 24;
  sheet.getRow(2).height = 18;
  sheet.getRow(3).height = 18;
  sheet.getRow(4).height = 18;
  sheet.getRow(5).height = 10;

  if (imageId !== null) {
    sheet.addImage(imageId, {
      tl: { col: 0.15, row: 0.15 },
      ext: { width: 82, height: 82 },
    });
  }

  const startColLetter = 'B';
  const endColLetter = sheet.getColumn(safeCols).letter;

  sheet.mergeCells(`${startColLetter}1:${endColLetter}1`);
  const titleCell = sheet.getCell(`${startColLetter}1`);
  titleCell.value = `${(meta.localName || '').toUpperCase()} · GASTROLAB by Iván Muñoz`;
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: OLIVE_HEX } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

  sheet.mergeCells(`${startColLetter}2:${endColLetter}2`);
  const repCell = sheet.getCell(`${startColLetter}2`);
  repCell.value = reportTitle;
  repCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1F2937' } };
  repCell.alignment = { vertical: 'middle', horizontal: 'left' };

  sheet.mergeCells(`${startColLetter}3:${endColLetter}3`);
  const infoCell = sheet.getCell(`${startColLetter}3`);
  infoCell.value = [
    `Sucursal: ${normalizeBranchName(meta.branch)}`,
    meta.ruc ? `RUC: ${meta.ruc}` : null,
    meta.address || null,
    subtitle,
  ]
    .filter(Boolean)
    .join('  |  ');
  infoCell.font = { name: 'Calibri', size: 9, color: { argb: 'FF4B5563' } };
  infoCell.alignment = { vertical: 'middle', horizontal: 'left' };

  sheet.mergeCells(`${startColLetter}4:${endColLetter}4`);
  const genCell = sheet.getCell(`${startColLetter}4`);
  genCell.value = `Fecha de generación: ${new Date().toLocaleString('es-EC')}`;
  genCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B7280' } };
  genCell.alignment = { vertical: 'middle', horizontal: 'left' };

  // Row 6 will be the table header
  return 6;
}

function writeStyledTable(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  columns: ExecutivePreviewColumn[],
  rows: Record<string, any>[],
  totalsRow?: Record<string, any>,
  highlightRowFn?: (row: Record<string, any>) => 'warn' | 'danger' | 'ok' | null
) {
  columns.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width;
  });

  const headerRow = sheet.getRow(startRow);
  headerRow.height = 24;
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OLIVE_HEX } };
    cell.alignment = { vertical: 'middle', horizontal: col.align || 'left', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: OLIVE_HEX } },
      bottom: { style: 'thin', color: { argb: OLIVE_HEX } },
      left: { style: 'thin', color: { argb: BORDER_HEX } },
      right: { style: 'thin', color: { argb: BORDER_HEX } },
    };
  });

  let currentRowIdx = startRow + 1;

  if (rows.length === 0) {
    const emptyRow = sheet.getRow(currentRowIdx);
    sheet.mergeCells(currentRowIdx, 1, currentRowIdx, columns.length);
    const cell = emptyRow.getCell(1);
    cell.value = 'Sin registros disponibles para el criterio o rango de fechas seleccionado.';
    cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF6B7280' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    emptyRow.height = 24;
    currentRowIdx++;
  } else {
    rows.forEach((data, rIdx) => {
      const row = sheet.getRow(currentRowIdx);
      row.height = 20;
      const highlight = highlightRowFn ? highlightRowFn(data) : null;
      const bgArgb =
        highlight === 'danger'
          ? 'FFFEE2E2'
          : highlight === 'warn'
          ? 'FFFEF3C7'
          : highlight === 'ok'
          ? LIGHT_OLIVE_HEX
          : rIdx % 2 === 1
          ? ZEBRA_HEX
          : 'FFFFFFFF';

      columns.forEach((col, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        const val = data[col.key];
        cell.value = val !== undefined && val !== null ? val : '';
        cell.font = {
          name: 'Calibri',
          size: 10,
          bold: highlight === 'danger',
          color: { argb: highlight === 'danger' ? 'FF991B1B' : 'FF111827' },
        };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
        cell.alignment = { vertical: 'middle', horizontal: col.align || 'left', wrapText: true };
        if (col.numFmt && typeof val === 'number') {
          cell.numFmt = col.numFmt;
        }
        cell.border = {
          top: { style: 'thin', color: { argb: BORDER_HEX } },
          bottom: { style: 'thin', color: { argb: BORDER_HEX } },
          left: { style: 'thin', color: { argb: BORDER_HEX } },
          right: { style: 'thin', color: { argb: BORDER_HEX } },
        };
      });
      currentRowIdx++;
    });
  }

  if (totalsRow) {
    const tRow = sheet.getRow(currentRowIdx);
    tRow.height = 23;
    columns.forEach((col, cIdx) => {
      const cell = tRow.getCell(cIdx + 1);
      const val = totalsRow[col.key];
      cell.value = val !== undefined && val !== null ? val : '';
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: OLIVE_HEX } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_OLIVE_HEX } };
      cell.alignment = { vertical: 'middle', horizontal: col.align || 'left' };
      if (col.numFmt && typeof val === 'number') {
        cell.numFmt = col.numFmt;
      }
      cell.border = {
        top: { style: 'medium', color: { argb: OLIVE_HEX } },
        bottom: { style: 'medium', color: { argb: OLIVE_HEX } },
        left: { style: 'thin', color: { argb: BORDER_HEX } },
        right: { style: 'thin', color: { argb: BORDER_HEX } },
      };
    });
  }
}

/**
 * Shared report payload builder used by both in-app preview ("Visualizar Informe")
 * and Excel workbook export ("Descargar Excel").
 */
async function buildExecutiveReportData(
  reportId: ExecutiveReportId,
  meta: StoreReportMeta,
  range: ReportDateRange
): Promise<ExecutiveReportPreviewData> {
  const targetBranch = normalizeBranchName(meta.branch);
  const rangeLabel =
    range.startDate || range.endDate
      ? `Sucursal: ${targetBranch} · Periodo: ${range.startDate || 'Inicio'} al ${range.endDate || 'Hoy'}`
      : `Sucursal: ${targetBranch} · Periodo: Todo el historial`;
  const todayStr = new Date().toISOString().split('T')[0];
  const localSlug = `${safeFileSlug(meta.localName || 'GASTROLAB')}_${safeFileSlug(targetBranch)}`;

  let filename = `${localSlug}_REPORTE_${todayStr}.xlsx`;
  const sheets: ExecutivePreviewTable[] = [];

  // -------------------------------------------------------------------------
  // 1. MESAS Y PEDIDOS: Platos más vendidos, Ticket Promedio y Rendimiento Personal
  // -------------------------------------------------------------------------
  if (reportId === 'mesas_pedidos') {
    const [ordersSnap, productsSnap] = await Promise.all([
      getDocsOfflineSafe(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))),
      getDocsOfflineSafe(collection(db, 'products')),
    ]);

    const productCategories = new Map<string, string>();
    productsSnap.forEach((d) => {
      const p = d.data() as Product;
      productCategories.set(d.id, p.category || 'Sin categoría');
    });

    const allOrders: Order[] = [];
    ordersSnap.forEach((d) => {
      const data = d.data() as Omit<Order, 'id'>;
      if (belongsToBranch(data.branch, targetBranch)) {
        allOrders.push({ id: d.id, ...data });
      }
    });

    const filteredOrders = allOrders.filter(
      (o) => o.status !== 'Anulado' && isWithinRange(o.createdAt, range)
    );

    const totalSales = filteredOrders.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
    const totalOrders = filteredOrders.length;
    const avgTicket = totalOrders > 0 ? totalSales / totalOrders : 0;
    const salonSales = filteredOrders
      .filter((o) => !o.isDomicilio && o.tableNumber !== 0)
      .reduce((acc, o) => acc + (Number(o.total) || 0), 0);
    const domicilioSales = filteredOrders
      .filter((o) => o.isDomicilio || o.tableNumber === 0)
      .reduce((acc, o) => acc + (Number(o.total) || 0), 0);

    const dishStats = new Map<
      string,
      { name: string; category: string; qty: number; revenue: number }
    >();
    const waiterStats = new Map<
      string,
      { waiter: string; ordersCount: number; dishesCount: number; totalSales: number }
    >();

    filteredOrders.forEach((o) => {
      const waiterKey = (o.waiterName || o.collectedBy || o.authorizedBy || 'Personal General').trim();
      const prevW = waiterStats.get(waiterKey) || {
        waiter: waiterKey,
        ordersCount: 0,
        dishesCount: 0,
        totalSales: 0,
      };
      const orderQtySum = (o.items || []).reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);
      prevW.ordersCount += 1;
      prevW.dishesCount += orderQtySum;
      prevW.totalSales += Number(o.total) || 0;
      waiterStats.set(waiterKey, prevW);

      (o.items || []).forEach((item) => {
        const key = item.productId || item.name;
        const prev = dishStats.get(key) || {
          name: item.name,
          category: productCategories.get(item.productId) || 'Carta',
          qty: 0,
          revenue: 0,
        };
        const q = Number(item.quantity) || 1;
        const lineRev = (Number(item.price) || 0) * q;
        prev.qty += q;
        prev.revenue += lineRev;
        dishStats.set(key, prev);
      });
    });

    sheets.push({
      sheetName: 'Resumen y Ticket Promedio',
      title: 'INFORME DE MESAS Y PEDIDOS — KPIs Y TICKET PROMEDIO',
      subtitle: rangeLabel,
      columns: [
        { header: 'Indicador Clave (KPI)', key: 'kpi', width: 38 },
        { header: 'Valor', key: 'value', width: 22, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Detalle / Referencia', key: 'detail', width: 42 },
      ],
      rows: [
        { kpi: 'Total Ventas Brutas', value: totalSales, detail: `${totalOrders} comandas válidas` },
        { kpi: 'Ticket Promedio por Pedido', value: avgTicket, detail: 'Total Ventas / Total Pedidos' },
        { kpi: 'Ventas en Salón (Mesas)', value: salonSales, detail: 'Consumo presencial en mesas' },
        { kpi: 'Ventas a Domicilio', value: domicilioSales, detail: 'Pedidos canal Domicilio' },
      ],
    });

    const sortedDishes = Array.from(dishStats.values()).sort((a, b) => b.qty - a.qty);
    const totalDishRevenue = sortedDishes.reduce((a, b) => a + b.revenue, 0);
    const totalDishUnits = sortedDishes.reduce((a, b) => a + b.qty, 0);

    sheets.push({
      sheetName: 'Platos Más Vendidos',
      title: 'INFORME DE MESAS Y PEDIDOS — PLATOS MÁS VENDIDOS',
      subtitle: rangeLabel,
      columns: [
        { header: 'Top #', key: 'rank', width: 10, align: 'center' },
        { header: 'Plato / Bebida / Combo', key: 'name', width: 36 },
        { header: 'Categoría', key: 'category', width: 20 },
        { header: 'Unidades Vendidas', key: 'qty', width: 18, numFmt: '#,##0', align: 'right' },
        { header: 'Ingreso Generado ($)', key: 'revenue', width: 22, numFmt: '$#,##0.00', align: 'right' },
        { header: '% Participación', key: 'share', width: 18, numFmt: '0.0%', align: 'right' },
      ],
      rows: sortedDishes.map((d, idx) => ({
        rank: idx + 1,
        name: d.name,
        category: d.category,
        qty: d.qty,
        revenue: Number(d.revenue.toFixed(2)),
        share: totalDishRevenue > 0 ? d.revenue / totalDishRevenue : 0,
      })),
      totalsRow: {
        rank: '',
        name: 'TOTALES GENERALES',
        category: `${sortedDishes.length} platos`,
        qty: totalDishUnits,
        revenue: Number(totalDishRevenue.toFixed(2)),
        share: totalDishRevenue > 0 ? 1 : 0,
      },
    });

    const sortedWaiters = Array.from(waiterStats.values()).sort(
      (a, b) => b.totalSales - a.totalSales
    );

    sheets.push({
      sheetName: 'Rendimiento Personal (KPI)',
      title: 'RENDIMIENTO DEL PERSONAL — KPI DE VENTAS POR MESERO',
      subtitle: rangeLabel,
      columns: [
        { header: 'Ranking', key: 'rank', width: 10, align: 'center' },
        { header: 'Colaborador / Mesero', key: 'waiter', width: 32 },
        { header: 'Pedidos Atendidos', key: 'ordersCount', width: 18, numFmt: '#,##0', align: 'right' },
        { header: 'Platos Vendidos', key: 'dishesCount', width: 18, numFmt: '#,##0', align: 'right' },
        { header: 'Total Vendido ($)', key: 'totalSales', width: 22, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Ticket Promedio ($)', key: 'avgTicket', width: 22, numFmt: '$#,##0.00', align: 'right' },
      ],
      rows: sortedWaiters.map((w, idx) => ({
        rank: idx + 1,
        waiter: w.waiter,
        ordersCount: w.ordersCount,
        dishesCount: w.dishesCount,
        totalSales: Number(w.totalSales.toFixed(2)),
        avgTicket: w.ordersCount > 0 ? Number((w.totalSales / w.ordersCount).toFixed(2)) : 0,
      })),
      totalsRow: {
        rank: '',
        waiter: 'TOTAL EQUIPO',
        ordersCount: totalOrders,
        dishesCount: sortedWaiters.reduce((a, b) => a + b.dishesCount, 0),
        totalSales: Number(totalSales.toFixed(2)),
        avgTicket: Number(avgTicket.toFixed(2)),
      },
    });

    filename = `${localSlug}_MESAS_Y_PEDIDOS_${todayStr}.xlsx`;
  }

  // -------------------------------------------------------------------------
  // 2. RESERVAS: Cantidad al mes y valor total consumido
  // -------------------------------------------------------------------------
  else if (reportId === 'reservas') {
    const [resSnap, ordersSnap] = await Promise.all([
      getDocsOfflineSafe(query(collection(db, 'reservations'), orderBy('date', 'desc'))),
      getDocsOfflineSafe(collection(db, 'orders')),
    ]);

    const ordersList: Order[] = [];
    ordersSnap.forEach((d) => {
      const data = d.data() as Omit<Order, 'id'>;
      if (belongsToBranch(data.branch, targetBranch)) {
        ordersList.push({ id: d.id, ...data });
      }
    });

    const reservations: any[] = [];
    resSnap.forEach((d) => {
      const data = d.data() as any;
      if (belongsToBranch(data.branch, targetBranch)) {
        reservations.push({ id: d.id, ...data });
      }
    });

    const filteredRes = reservations.filter((r) => isWithinRange(r.date || r.createdAt, range));

    const enrichedRes = filteredRes.map((r) => {
      const rDate = formatDateOnly(r.date);
      let consumed = Number(r.consumedAmount) || 0;
      if (consumed === 0 && r.status !== 'Cancelada' && r.tableNumber) {
        consumed = ordersList
          .filter(
            (o) =>
              o.status !== 'Anulado' &&
              o.tableNumber === Number(r.tableNumber) &&
              formatDateOnly(o.createdAt) === rDate
          )
          .reduce((acc, o) => acc + (Number(o.total) || 0), 0);
      }
      return { ...r, consumedValue: consumed };
    });

    const monthlyMap = new Map<
      string,
      {
        month: string;
        total: number;
        confirmed: number;
        completed: number;
        cancelled: number;
        pax: number;
        consumed: number;
      }
    >();

    enrichedRes.forEach((r) => {
      const mKey = (formatDateOnly(r.date) || todayStr).slice(0, 7);
      const prev = monthlyMap.get(mKey) || {
        month: mKey,
        total: 0,
        confirmed: 0,
        completed: 0,
        cancelled: 0,
        pax: 0,
        consumed: 0,
      };
      prev.total += 1;
      if (r.status === 'Confirmada') prev.confirmed += 1;
      if (r.status === 'Completada') prev.completed += 1;
      if (r.status === 'Cancelada') prev.cancelled += 1;
      prev.pax += Number(r.pax) || 0;
      prev.consumed += r.consumedValue || 0;
      monthlyMap.set(mKey, prev);
    });

    const monthlyRows = Array.from(monthlyMap.values()).sort((a, b) =>
      b.month.localeCompare(a.month)
    );

    sheets.push({
      sheetName: 'Resumen Mensual Reservas',
      title: 'INFORME DE RESERVAS — CANTIDAD MENSUAL Y VALOR CONSUMIDO',
      subtitle: rangeLabel,
      columns: [
        { header: 'Mes (AAAA-MM)', key: 'month', width: 16, align: 'center' },
        { header: 'Total Reservas', key: 'total', width: 16, numFmt: '#,##0', align: 'right' },
        { header: 'Confirmadas', key: 'confirmed', width: 15, numFmt: '#,##0', align: 'right' },
        { header: 'Completadas', key: 'completed', width: 15, numFmt: '#,##0', align: 'right' },
        { header: 'Canceladas', key: 'cancelled', width: 15, numFmt: '#,##0', align: 'right' },
        { header: 'Total Personas (PAX)', key: 'pax', width: 20, numFmt: '#,##0', align: 'right' },
        { header: 'Valor Consumido ($)', key: 'consumed', width: 22, numFmt: '$#,##0.00', align: 'right' },
      ],
      rows: monthlyRows,
      totalsRow: {
        month: 'TOTAL GENERAL',
        total: monthlyRows.reduce((a, b) => a + b.total, 0),
        confirmed: monthlyRows.reduce((a, b) => a + b.confirmed, 0),
        completed: monthlyRows.reduce((a, b) => a + b.completed, 0),
        cancelled: monthlyRows.reduce((a, b) => a + b.cancelled, 0),
        pax: monthlyRows.reduce((a, b) => a + b.pax, 0),
        consumed: Number(monthlyRows.reduce((a, b) => a + b.consumed, 0).toFixed(2)),
      },
    });

    sheets.push({
      sheetName: 'Detalle de Reservas',
      title: 'DETALLE INDIVIDUAL DE RESERVACIONES',
      subtitle: rangeLabel,
      columns: [
        { header: 'Fecha', key: 'date', width: 14, align: 'center' },
        { header: 'Hora', key: 'time', width: 12, align: 'center' },
        { header: 'Cliente', key: 'customerName', width: 28 },
        { header: 'Teléfono', key: 'phone', width: 16 },
        { header: 'PAX', key: 'pax', width: 10, numFmt: '#,##0', align: 'right' },
        { header: 'Mesa', key: 'tableNumber', width: 10, align: 'center' },
        { header: 'Estado', key: 'status', width: 15, align: 'center' },
        { header: 'Valor Consumido ($)', key: 'consumedValue', width: 20, numFmt: '$#,##0.00', align: 'right' },
      ],
      rows: enrichedRes.map((r) => ({
        date: formatDateOnly(r.date),
        time: r.time || '',
        customerName: r.customerName || '',
        phone: r.phone || '',
        pax: Number(r.pax) || 0,
        tableNumber: r.tableNumber ? `Mesa ${r.tableNumber}` : '-',
        status: r.status || 'Pendiente',
        consumedValue: Number((r.consumedValue || 0).toFixed(2)),
      })),
    });

    filename = `${localSlug}_RESERVAS_MENSUAL_${todayStr}.xlsx`;
  }

  // -------------------------------------------------------------------------
  // 3. CARTA: Platos con menor rotación (menos vendidos)
  // -------------------------------------------------------------------------
  else if (reportId === 'carta_rotacion') {
    const [productsSnap, ordersSnap] = await Promise.all([
      getDocsOfflineSafe(collection(db, 'products')),
      getDocsOfflineSafe(collection(db, 'orders')),
    ]);

    const products: Product[] = [];
    productsSnap.forEach((d) => products.push({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }));

    const salesCount = new Map<string, { qty: number; rev: number }>();
    ordersSnap.forEach((d) => {
      const o = d.data() as Order;
      if (!belongsToBranch(o.branch, targetBranch)) return;
      if (o.status === 'Anulado' || !isWithinRange(o.createdAt, range)) return;
      (o.items || []).forEach((item) => {
        const key = item.productId || item.name;
        const prev = salesCount.get(key) || { qty: 0, rev: 0 };
        const q = Number(item.quantity) || 1;
        prev.qty += q;
        prev.rev += (Number(item.price) || 0) * q;
        salesCount.set(key, prev);
      });
    });

    const rotationRows = products
      .map((p) => {
        const stat = salesCount.get(p.id) || salesCount.get(p.name) || { qty: 0, rev: 0 };
        return {
          name: p.name,
          tipo: p.isCombo ? 'Combo' : 'Platillo / Bebida',
          category: p.category || 'Sin categoría',
          price: Number(p.price) || 0,
          qty: stat.qty,
          revenue: Number(stat.rev.toFixed(2)),
          diag:
            stat.qty === 0
              ? 'SIN VENTAS (Rotación Nula)'
              : stat.qty <= 5
              ? 'BAJA ROTACIÓN'
              : 'Rotación Activa',
        };
      })
      .sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name));

    sheets.push({
      sheetName: 'Menor Rotación Carta',
      title: 'INFORME DE CARTA — PLATOS CON MENOR ROTACIÓN',
      subtitle: `${rangeLabel} · Ordenado de menor a mayor venta`,
      columns: [
        { header: 'Posición', key: 'rank', width: 11, align: 'center' },
        { header: 'Producto / Plato', key: 'name', width: 34 },
        { header: 'Tipo', key: 'tipo', width: 16, align: 'center' },
        { header: 'Categoría', key: 'category', width: 20 },
        { header: 'Precio Carta ($)', key: 'price', width: 16, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Uds. Vendidas', key: 'qty', width: 16, numFmt: '#,##0', align: 'right' },
        { header: 'Ingreso ($)', key: 'revenue', width: 18, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Diagnóstico', key: 'diag', width: 26, align: 'center' },
      ],
      rows: rotationRows.map((row, i) => ({ rank: i + 1, ...row })),
      highlightRowFn: (row) => (row.qty === 0 ? 'danger' : row.qty <= 5 ? 'warn' : null),
    });

    filename = `${localSlug}_CARTA_MENOR_ROTACION_${todayStr}.xlsx`;
  }

  // -------------------------------------------------------------------------
  // 4. MENAJE Y EQUIPOS: Inventario completo con cantidades para conteo físico
  // -------------------------------------------------------------------------
  else if (reportId === 'menaje_conteo') {
    const eqSnap = await getDocsOfflineSafe(collection(db, 'equipment'));
    const eqList: any[] = [];
    eqSnap.forEach((d) => {
      const data = d.data() as any;
      if (belongsToBranch(data.branch, targetBranch)) {
        eqList.push({ id: d.id, ...data });
      }
    });
    eqList.sort(
      (a, b) =>
        (a.category || '').localeCompare(b.category || '') ||
        (a.name || '').localeCompare(b.name || '')
    );

    const startRow = 6;
    const rows = eqList.map((e, idx) => {
      const excelRow = startRow + 1 + idx;
      const qty = Number(e.quantity) || 0;
      const uCost = Number(e.unitCost) || 0;
      return {
        code: e.code || `EQ-${idx + 1}`,
        name: e.name || '',
        category: e.category || 'Menaje',
        location: e.location || 'Matriz',
        condition: e.condition || 'Óptimo',
        quantity: qty,
        unitCost: uCost,
        totalValue: Number((qty * uCost).toFixed(2)),
        physicalCount: '',
        diff: { formula: `IF(ISBLANK(I${excelRow}),"",I${excelRow}-F${excelRow})` },
      };
    });

    sheets.push({
      sheetName: 'Conteo Físico Menaje',
      title: 'INVENTARIO DE MENAJE Y EQUIPOS — PLANILLA PARA CONTEO FÍSICO',
      subtitle: `Total de ítems registrados: ${eqList.length}`,
      columns: [
        { header: 'Código', key: 'code', width: 12, align: 'center' },
        { header: 'Artículo / Equipo', key: 'name', width: 34 },
        { header: 'Categoría', key: 'category', width: 20 },
        { header: 'Ubicación', key: 'location', width: 20 },
        { header: 'Estado', key: 'condition', width: 15, align: 'center' },
        { header: 'Cant. Sistema', key: 'quantity', width: 15, numFmt: '#,##0', align: 'right' },
        { header: 'Costo Unit. ($)', key: 'unitCost', width: 15, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Valor Total ($)', key: 'totalValue', width: 16, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Conteo Físico', key: 'physicalCount', width: 16, align: 'center' },
        { header: 'Diferencia', key: 'diff', width: 14, align: 'right' },
      ],
      rows,
      totalsRow: {
        code: '',
        name: 'TOTAL INVENTARIO MENAJE',
        category: `${eqList.length} ítems`,
        location: '',
        condition: '',
        quantity: eqList.reduce((a, b) => a + (Number(b.quantity) || 0), 0),
        unitCost: '',
        totalValue: Number(
          eqList
            .reduce((a, b) => a + (Number(b.quantity) || 0) * (Number(b.unitCost) || 0), 0)
            .toFixed(2)
        ),
        physicalCount: '',
        diff: '',
      },
    });

    filename = `${localSlug}_MENAJE_CONTEO_FISICO_${todayStr}.xlsx`;
  }

  // -------------------------------------------------------------------------
  // 5. CAJA Y TURNOS: Historial de cierres detallando Efectivo, Transferencia, De Una, Tarjeta, Ingresos y Egresos
  // -------------------------------------------------------------------------
  else if (reportId === 'caja_turnos') {
    const [shiftsSnap, movSnap] = await Promise.all([
      getDocsOfflineSafe(query(collection(db, 'cash_shifts'), orderBy('openedAt', 'desc'))),
      getDocsOfflineSafe(query(collection(db, 'cash_movements'), orderBy('createdAt', 'desc'))),
    ]);

    const shifts: CashShift[] = [];
    shiftsSnap.forEach((d) => {
      const data = d.data() as Omit<CashShift, 'id'>;
      if (belongsToBranch(data.branch, targetBranch)) {
        shifts.push({ id: d.id, ...data });
      }
    });
    const filteredShifts = shifts.filter((s) => isWithinRange(s.closedAt || s.openedAt, range));

    const movements: CashMovement[] = [];
    movSnap.forEach((d) => {
      const data = d.data() as Omit<CashMovement, 'id'>;
      if (belongsToBranch(data.branch, targetBranch)) {
        movements.push({ id: d.id, ...data });
      }
    });
    const filteredMovements = movements.filter((m) => isWithinRange(m.createdAt, range));

    const rows = filteredShifts.map((sh) => {
      const cashIn = Number(sh.cashIns ?? sh.cashIn ?? 0);
      const cashOut = Number(sh.cashOuts ?? sh.cashOut ?? 0);
      return {
        shiftNumber: sh.shiftNumber ? `#${sh.shiftNumber}` : sh.id.slice(0, 6),
        registerName: sh.registerName || 'Caja Principal',
        cashierName: sh.cashierName || sh.openedBy || '-',
        openedAt: sh.openedAt ? new Date(sh.openedAt).toLocaleString('es-EC') : '-',
        closedAt: sh.closedAt ? new Date(sh.closedAt).toLocaleString('es-EC') : 'Abierta',
        status: sh.status === 'closed' ? 'Cerrada' : 'Abierta',
        initialCash: Number(sh.initialCash || 0),
        cashSales: Number(sh.cashSales || 0),
        transferSales: Number(sh.transferSales || 0),
        deUnaSales: Number(sh.deUnaSales || 0),
        cardSales: Number(sh.cardSales || 0),
        cashIn,
        cashOut,
        totalSales: Number(sh.totalSales || 0),
        difference: Number(sh.difference || 0),
      };
    });

    sheets.push({
      sheetName: 'Cierres de Caja',
      title: 'HISTORIAL DE CAJA Y TURNOS — DESGLOSE POR MÉTODO DE PAGO',
      subtitle: rangeLabel,
      columns: [
        { header: 'Turno', key: 'shiftNumber', width: 10, align: 'center' },
        { header: 'Caja', key: 'registerName', width: 18 },
        { header: 'Cajero', key: 'cashierName', width: 20 },
        { header: 'Apertura', key: 'openedAt', width: 20 },
        { header: 'Cierre', key: 'closedAt', width: 20 },
        { header: 'Estado', key: 'status', width: 12, align: 'center' },
        { header: 'Fondo Inicial', key: 'initialCash', width: 15, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Efectivo ($)', key: 'cashSales', width: 15, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Transferencia ($)', key: 'transferSales', width: 17, numFmt: '$#,##0.00', align: 'right' },
        { header: 'De Una ($)', key: 'deUnaSales', width: 15, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Tarjeta ($)', key: 'cardSales', width: 15, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Ingresos Caja ($)', key: 'cashIn', width: 16, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Egresos Caja ($)', key: 'cashOut', width: 16, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Total Ventas ($)', key: 'totalSales', width: 17, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Diferencia ($)', key: 'difference', width: 15, numFmt: '$#,##0.00', align: 'right' },
      ],
      rows,
      totalsRow: {
        shiftNumber: '',
        registerName: 'TOTALES TURNOS',
        cashierName: `${rows.length} turnos`,
        openedAt: '',
        closedAt: '',
        status: '',
        initialCash: Number(rows.reduce((a, b) => a + b.initialCash, 0).toFixed(2)),
        cashSales: Number(rows.reduce((a, b) => a + b.cashSales, 0).toFixed(2)),
        transferSales: Number(rows.reduce((a, b) => a + b.transferSales, 0).toFixed(2)),
        deUnaSales: Number(rows.reduce((a, b) => a + b.deUnaSales, 0).toFixed(2)),
        cardSales: Number(rows.reduce((a, b) => a + b.cardSales, 0).toFixed(2)),
        cashIn: Number(rows.reduce((a, b) => a + b.cashIn, 0).toFixed(2)),
        cashOut: Number(rows.reduce((a, b) => a + b.cashOut, 0).toFixed(2)),
        totalSales: Number(rows.reduce((a, b) => a + b.totalSales, 0).toFixed(2)),
        difference: Number(rows.reduce((a, b) => a + b.difference, 0).toFixed(2)),
      },
    });

    sheets.push({
      sheetName: 'Ingresos y Egresos Caja',
      title: 'DETALLE DE INGRESOS Y EGRESOS MANUALES DE CAJA',
      subtitle: rangeLabel,
      columns: [
        { header: 'Fecha / Hora', key: 'createdAt', width: 22 },
        { header: 'Tipo', key: 'type', width: 14, align: 'center' },
        { header: 'Monto ($)', key: 'amount', width: 16, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Motivo', key: 'reason', width: 40 },
        { header: 'Responsable', key: 'performedBy', width: 22 },
      ],
      rows: filteredMovements.map((m) => ({
        createdAt: m.createdAt ? new Date(m.createdAt).toLocaleString('es-EC') : '',
        type: m.type === 'in' || m.type === 'ingreso' ? 'INGRESO' : 'EGRESO',
        amount: Number(m.amount || 0),
        reason: m.reason || '',
        performedBy: m.performedBy || '',
      })),
    });

    filename = `${localSlug}_CAJA_Y_TURNOS_${todayStr}.xlsx`;
  }

  // -------------------------------------------------------------------------
  // 6. FACTURACIÓN: Facturas emitidas en rango de fechas para auditoría
  // -------------------------------------------------------------------------
  else if (reportId === 'facturacion') {
    const invSnap = await getDocsOfflineSafe(
      query(collection(db, 'electronic_invoices'), orderBy('createdAt', 'desc'))
    );
    const invoices: any[] = [];
    invSnap.forEach((d) => {
      const data = d.data() as any;
      if (belongsToBranch(data.branch, targetBranch)) {
        invoices.push({ id: d.id, ...data });
      }
    });

    const filtered = invoices.filter((inv) => isWithinRange(inv.date || inv.createdAt, range));

    const rows = filtered.map((inv) => {
      const itemsText = Array.isArray(inv.items)
        ? inv.items
            .map((it: any) => `${it.quantity || 1}x ${it.name || it.description || 'Consumo'}`)
            .join(', ')
        : inv.description || 'Consumo Restaurante';
      return {
        date:
          inv.date || inv.createdAt
            ? new Date(inv.date || inv.createdAt).toLocaleString('es-EC')
            : '',
        invoiceNumber: inv.invoiceNumber || '',
        status: inv.status || 'AUTORIZADO',
        docNumber: inv.client?.docNumber || '9999999999999',
        clientName: inv.client?.name || 'Consumidor Final',
        reference: inv.reference || '-',
        paymentMethod: inv.paymentMethod || 'Efectivo',
        itemsText,
        subtotal: Number((inv.subtotal || 0).toFixed(2)),
        ivaAmount: Number((inv.ivaAmount || 0).toFixed(2)),
        total: Number((inv.total || 0).toFixed(2)),
        claveAcceso: inv.claveAcceso || '',
      };
    });

    sheets.push({
      sheetName: 'Auditoría Facturación',
      title: 'REPORTE DE FACTURACIÓN ELECTRÓNICA — AUDITORÍA',
      subtitle: rangeLabel,
      columns: [
        { header: 'Fecha / Hora', key: 'date', width: 20 },
        { header: 'Nº Factura', key: 'invoiceNumber', width: 18 },
        { header: 'Estado SRI', key: 'status', width: 18, align: 'center' },
        { header: 'RUC / Cédula', key: 'docNumber', width: 16 },
        { header: 'Cliente', key: 'clientName', width: 28 },
        { header: 'Referencia', key: 'reference', width: 14 },
        { header: 'Forma Pago', key: 'paymentMethod', width: 15 },
        { header: 'Consumos / Detalle', key: 'itemsText', width: 42 },
        { header: 'Subtotal ($)', key: 'subtotal', width: 14, numFmt: '$#,##0.00', align: 'right' },
        { header: 'IVA ($)', key: 'ivaAmount', width: 13, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Total ($)', key: 'total', width: 15, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Clave de Acceso SRI', key: 'claveAcceso', width: 32 },
      ],
      rows,
      totalsRow: {
        date: '',
        invoiceNumber: 'TOTAL FACTURADO',
        status: `${rows.length} facturas`,
        docNumber: '',
        clientName: '',
        reference: '',
        paymentMethod: '',
        itemsText: '',
        subtotal: Number(rows.reduce((a, b) => a + b.subtotal, 0).toFixed(2)),
        ivaAmount: Number(rows.reduce((a, b) => a + b.ivaAmount, 0).toFixed(2)),
        total: Number(rows.reduce((a, b) => a + b.total, 0).toFixed(2)),
        claveAcceso: '',
      },
    });

    filename = `${localSlug}_FACTURACION_AUDITORIA_${todayStr}.xlsx`;
  }

  // -------------------------------------------------------------------------
  // 7. FACTURAS DE COMPRAS: Listado de compras a proveedores detallado por fechas
  // -------------------------------------------------------------------------
  else if (reportId === 'facturas_compras') {
    const purSnap = await getDocsOfflineSafe(
      query(collection(db, 'purchases'), orderBy('createdAt', 'desc'))
    );
    const purchases: PurchaseInvoice[] = [];
    purSnap.forEach((d) => {
      const data = d.data() as Omit<PurchaseInvoice, 'id'>;
      if (belongsToBranch(data.branch, targetBranch)) {
        purchases.push({ id: d.id, ...data });
      }
    });

    const filtered = purchases.filter((p) => isWithinRange(p.date || p.createdAt, range));

    const summaryRows = filtered.map((p) => ({
      date: formatDateOnly(p.date || p.createdAt),
      invoiceNumber: p.invoiceNumber || '-',
      provider: p.provider || 'Proveedor General',
      itemCount: Array.isArray(p.items) ? p.items.length : 0,
      itemsDetail: Array.isArray(p.items)
        ? p.items.map((i) => `${i.name || i.productName} (${i.quantity} ${i.unit})`).join(', ')
        : '',
      wasteStatus:
        p.wasteStatus === 'pending'
          ? 'Con Merma Pendiente'
          : p.wasteStatus === 'processed'
          ? 'Merma Procesada'
          : 'Sin Merma',
      totalAmount: Number((p.totalAmount || 0).toFixed(2)),
    }));

    sheets.push({
      sheetName: 'Facturas de Compras',
      title: 'INFORME DE FACTURAS DE COMPRAS A PROVEEDORES (COTEJO FÍSICO)',
      subtitle: rangeLabel,
      columns: [
        { header: 'Fecha Factura', key: 'date', width: 15, align: 'center' },
        { header: 'Nº Factura Física', key: 'invoiceNumber', width: 20 },
        { header: 'Proveedor', key: 'provider', width: 28 },
        { header: 'Ítems', key: 'itemCount', width: 10, numFmt: '#,##0', align: 'right' },
        { header: 'Detalle de Productos Comprados', key: 'itemsDetail', width: 46 },
        { header: 'Estado Merma', key: 'wasteStatus', width: 20, align: 'center' },
        { header: 'Total Factura ($)', key: 'totalAmount', width: 18, numFmt: '$#,##0.00', align: 'right' },
      ],
      rows: summaryRows,
      totalsRow: {
        date: '',
        invoiceNumber: 'TOTAL COMPRAS',
        provider: `${summaryRows.length} facturas`,
        itemCount: summaryRows.reduce((a, b) => a + b.itemCount, 0),
        itemsDetail: '',
        wasteStatus: '',
        totalAmount: Number(summaryRows.reduce((a, b) => a + b.totalAmount, 0).toFixed(2)),
      },
    });

    const detailRows: Record<string, any>[] = [];
    filtered.forEach((p) => {
      (p.items || []).forEach((it) => {
        detailRows.push({
          date: formatDateOnly(p.date || p.createdAt),
          invoiceNumber: p.invoiceNumber || '-',
          provider: p.provider || '',
          product: it.name || it.productName || '',
          quantity: Number(it.quantity || 0),
          unit: it.unit || '',
          unitCost: Number((it.unitCost ?? it.costPerUnit ?? 0).toFixed(4)),
          totalCost: Number((it.totalCost || 0).toFixed(2)),
          expiryDate: it.expiryDate || '-',
        });
      });
    });

    sheets.push({
      sheetName: 'Detalle Productos Comprados',
      title: 'DETALLE ÍTEM POR ÍTEM DE COMPRAS A PROVEEDORES',
      subtitle: rangeLabel,
      columns: [
        { header: 'Fecha', key: 'date', width: 14, align: 'center' },
        { header: 'Nº Factura', key: 'invoiceNumber', width: 18 },
        { header: 'Proveedor', key: 'provider', width: 26 },
        { header: 'Producto', key: 'product', width: 30 },
        { header: 'Cantidad', key: 'quantity', width: 14, numFmt: '#,##0.##', align: 'right' },
        { header: 'Unidad', key: 'unit', width: 10, align: 'center' },
        { header: 'Costo Unit. ($)', key: 'unitCost', width: 15, numFmt: '$#,##0.0000', align: 'right' },
        { header: 'Total Ítem ($)', key: 'totalCost', width: 16, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Fecha Caducidad', key: 'expiryDate', width: 16, align: 'center' },
      ],
      rows: detailRows,
    });

    filename = `${localSlug}_FACTURAS_COMPRAS_${todayStr}.xlsx`;
  }

  // -------------------------------------------------------------------------
  // 8. KARDEX: Entradas y Salidas alertando desperdicios o bajas
  // -------------------------------------------------------------------------
  else if (reportId === 'kardex') {
    const [kSnap, invSnap] = await Promise.all([
      getDocsOfflineSafe(query(collection(db, 'kardex'), orderBy('createdAt', 'desc'))),
      getDocsOfflineSafe(collection(db, 'inventory')),
    ]);

    const entries: KardexEntry[] = [];
    kSnap.forEach((d) => {
      const data = d.data() as Omit<KardexEntry, 'id'>;
      if (belongsToBranch(data.branch, targetBranch)) {
        entries.push({ id: d.id, ...data });
      }
    });
    const filtered = entries.filter((e) => isWithinRange(e.createdAt, range));

    const inventoryItems: InventoryItem[] = [];
    invSnap.forEach((d) => {
      const data = d.data() as Omit<InventoryItem, 'id'>;
      if (belongsToBranch(data.branch, targetBranch)) {
        inventoryItems.push({ id: d.id, ...data });
      }
    });

    const rows = filtered.map((e) => {
      const refLower = (e.reference || '').toLowerCase();
      let alerta = 'Normal';
      if (
        refLower.includes('merma') ||
        refLower.includes('desperd') ||
        refLower.includes('dañ') ||
        refLower.includes('podrid')
      ) {
        alerta = 'ALERTA: DESPERDICIO / MERMA';
      } else if (
        e.movementType === 'Salida por Baja' ||
        refLower.includes('baja') ||
        refLower.includes('caduc') ||
        refLower.includes('vencid') ||
        e.movementType === 'Ajuste'
      ) {
        alerta = 'ALERTA: BAJA / AJUSTE';
      }

      return {
        createdAt: e.createdAt ? new Date(e.createdAt).toLocaleString('es-EC') : '',
        itemName: e.itemName || '',
        movementType: e.movementType,
        quantity: Number(e.quantity || 0),
        unit: e.unit || '',
        unitCost: Number((e.unitCost || 0).toFixed(4)),
        totalCost: Number((e.totalCost || 0).toFixed(2)),
        balanceStock: Number((e.balanceStock || 0).toFixed(2)),
        reference: e.reference || '',
        alerta,
      };
    });

    sheets.push({
      sheetName: 'Movimientos Kardex',
      title: 'INFORME KARDEX — ENTRADAS, SALIDAS Y ALERTAS DE DESPERDICIO / BAJAS',
      subtitle: rangeLabel,
      columns: [
        { header: 'Fecha / Hora', key: 'createdAt', width: 20 },
        { header: 'Producto / Insumo', key: 'itemName', width: 28 },
        { header: 'Tipo', key: 'movementType', width: 12, align: 'center' },
        { header: 'Cantidad', key: 'quantity', width: 14, numFmt: '#,##0.##', align: 'right' },
        { header: 'Unidad', key: 'unit', width: 10, align: 'center' },
        { header: 'Costo Unit. ($)', key: 'unitCost', width: 15, numFmt: '$#,##0.0000', align: 'right' },
        { header: 'Costo Total ($)', key: 'totalCost', width: 15, numFmt: '$#,##0.00', align: 'right' },
        { header: 'Saldo Stock', key: 'balanceStock', width: 14, numFmt: '#,##0.##', align: 'right' },
        { header: 'Referencia / Motivo', key: 'reference', width: 38 },
        { header: 'Alerta Auditoría', key: 'alerta', width: 26, align: 'center' },
      ],
      rows,
      highlightRowFn: (row) =>
        String(row.alerta).includes('DESPERDICIO')
          ? 'danger'
          : String(row.alerta).includes('BAJA')
          ? 'warn'
          : null,
    });

    sheets.push({
      sheetName: 'Alertas Stock y Caducidad',
      title: 'ALERTAS DE INVENTARIO ACTUAL (STOCK MÍNIMO Y CADUCIDAD)',
      subtitle: `Total productos en inventario: ${inventoryItems.length}`,
      columns: [
        { header: 'Producto', key: 'name', width: 32 },
        { header: 'Stock Actual', key: 'currentStock', width: 15, numFmt: '#,##0.##', align: 'right' },
        { header: 'Stock Mínimo', key: 'minStock', width: 15, numFmt: '#,##0.##', align: 'right' },
        { header: 'Unidad', key: 'unit', width: 10, align: 'center' },
        { header: 'Fecha Caducidad', key: 'expiryDate', width: 16, align: 'center' },
        { header: 'Estado', key: 'status', width: 24, align: 'center' },
      ],
      rows: inventoryItems.map((it) => {
        const low = (it.currentStock || 0) <= (it.minStock || 0);
        const expired = it.expiryDate && it.expiryDate <= todayStr;
        return {
          name: it.name,
          currentStock: Number(it.currentStock || 0),
          minStock: Number(it.minStock || 0),
          unit: it.unit,
          expiryDate: it.expiryDate || '-',
          status: expired ? 'CADUCADO / VENCIDO' : low ? 'STOCK BAJO MÍNIMO' : 'Óptimo',
        };
      }),
      highlightRowFn: (row) =>
        row.status === 'CADUCADO / VENCIDO'
          ? 'danger'
          : row.status === 'STOCK BAJO MÍNIMO'
          ? 'warn'
          : null,
    });

    filename = `${localSlug}_KARDEX_AUDITORIA_${todayStr}.xlsx`;
  }

  // -------------------------------------------------------------------------
  // 9. CONTROL DE MERMAS: Histórico acumulado por producto para evaluar proveedores
  // -------------------------------------------------------------------------
  else if (reportId === 'control_mermas') {
    const [wasteSnap, purSnap] = await Promise.all([
      getDocsOfflineSafe(query(collection(db, 'waste_records'), orderBy('date', 'desc'))),
      getDocsOfflineSafe(collection(db, 'purchases')),
    ]);

    const invoiceProviderMap = new Map<string, string>();
    purSnap.forEach((d) => {
      const p = d.data() as PurchaseInvoice;
      if (belongsToBranch(p.branch, targetBranch)) {
        invoiceProviderMap.set(d.id, p.provider || 'Sin especificar');
      }
    });

    const records: WasteRecord[] = [];
    wasteSnap.forEach((d) => {
      const data = d.data() as Omit<WasteRecord, 'id'>;
      if (belongsToBranch(data.branch, targetBranch)) {
        records.push({ id: d.id, ...data });
      }
    });
    const filtered = records.filter((w) => isWithinRange(w.date || w.createdAt, range));

    const accByProduct = new Map<
      string,
      {
        productName: string;
        unit: string;
        count: number;
        initialSum: number;
        usableSum: number;
        wasteSum: number;
        providers: Set<string>;
      }
    >();

    filtered.forEach((w) => {
      const key = (w.productName || w.itemId).trim().toUpperCase();
      const prev = accByProduct.get(key) || {
        productName: w.productName,
        unit: w.unit || '',
        count: 0,
        initialSum: 0,
        usableSum: 0,
        wasteSum: 0,
        providers: new Set<string>(),
      };
      prev.count += 1;
      prev.initialSum += Number(w.initialWeight) || 0;
      prev.usableSum += Number(w.usableQuantity ?? w.finalWeight ?? 0);
      prev.wasteSum += Number(w.wasteAmount) || 0;
      if (w.invoiceId && invoiceProviderMap.has(w.invoiceId)) {
        prev.providers.add(invoiceProviderMap.get(w.invoiceId)!);
      }
      accByProduct.set(key, prev);
    });

    const accRows = Array.from(accByProduct.values())
      .map((item) => {
        const wastePct = item.initialSum > 0 ? item.wasteSum / item.initialSum : 0;
        const yieldPct = item.initialSum > 0 ? item.usableSum / item.initialSum : 0;
        const evalLabel =
          wastePct >= 0.35
            ? 'CRÍTICO — Revisar Proveedor'
            : wastePct >= 0.2
            ? 'ATENCIÓN — Merma Elevada'
            : 'Rendimiento Óptimo';
        return {
          productName: item.productName,
          unit: item.unit,
          providers: Array.from(item.providers).join(', ') || 'Registro Manual / General',
          count: item.count,
          initialSum: Number(item.initialSum.toFixed(2)),
          usableSum: Number(item.usableSum.toFixed(2)),
          wasteSum: Number(item.wasteSum.toFixed(2)),
          wastePct,
          yieldPct,
          evalLabel,
        };
      })
      .sort((a, b) => b.wastePct - a.wastePct);

    sheets.push({
      sheetName: 'Acumulado por Producto',
      title: 'CONTROL DE MERMAS — HISTÓRICO ACUMULADO PARA EVALUACIÓN DE PROVEEDORES',
      subtitle: rangeLabel,
      columns: [
        { header: 'Producto', key: 'productName', width: 28 },
        { header: 'Unidad', key: 'unit', width: 10, align: 'center' },
        { header: 'Proveedor(es) Asociado(s)', key: 'providers', width: 28 },
        { header: 'Registros', key: 'count', width: 12, numFmt: '#,##0', align: 'right' },
        { header: 'Peso Bruto Acum.', key: 'initialSum', width: 16, numFmt: '#,##0.##', align: 'right' },
        { header: 'Peso Útil Acum.', key: 'usableSum', width: 16, numFmt: '#,##0.##', align: 'right' },
        { header: 'Merma Acum.', key: 'wasteSum', width: 15, numFmt: '#,##0.##', align: 'right' },
        { header: '% Merma Prom.', key: 'wastePct', width: 15, numFmt: '0.0%', align: 'right' },
        { header: '% Rendimiento', key: 'yieldPct', width: 15, numFmt: '0.0%', align: 'right' },
        { header: 'Evaluación Proveedor', key: 'evalLabel', width: 26, align: 'center' },
      ],
      rows: accRows,
      highlightRowFn: (row) =>
        row.wastePct >= 0.35 ? 'danger' : row.wastePct >= 0.2 ? 'warn' : 'ok',
    });

    sheets.push({
      sheetName: 'Histórico Detallado',
      title: 'DETALLE HISTÓRICO DE MERMAS Y DESPOSTE',
      subtitle: rangeLabel,
      columns: [
        { header: 'Fecha', key: 'date', width: 14, align: 'center' },
        { header: 'Producto', key: 'productName', width: 28 },
        { header: 'Unidad', key: 'unit', width: 10, align: 'center' },
        { header: 'Peso Inicial', key: 'initialWeight', width: 14, numFmt: '#,##0.##', align: 'right' },
        { header: 'Peso Final Útil', key: 'finalWeight', width: 15, numFmt: '#,##0.##', align: 'right' },
        { header: 'Merma', key: 'wasteAmount', width: 13, numFmt: '#,##0.##', align: 'right' },
        { header: '% Merma', key: 'wastePct', width: 12, numFmt: '0.0%', align: 'right' },
        { header: 'Motivo / Responsable', key: 'reason', width: 32 },
        { header: 'Estado', key: 'status', width: 14, align: 'center' },
      ],
      rows: filtered.map((w) => ({
        date: formatDateOnly(w.date || w.createdAt),
        productName: w.productName,
        unit: w.unit,
        initialWeight: Number(w.initialWeight || 0),
        finalWeight: Number(w.finalWeight || 0),
        wasteAmount: Number(w.wasteAmount || 0),
        wastePct: (Number(w.wastePercentage) || 0) / 100,
        reason: `${w.wasteReason || '-'} (${w.responsible || '-'})`,
        status: w.status === 'processed' ? 'Procesado' : 'Pendiente',
      })),
    });

    filename = `${localSlug}_CONTROL_MERMAS_PROVEEDORES_${todayStr}.xlsx`;
  }

  return { reportId, filename, sheets };
}

/**
 * Returns structured preview data ("Visualizar Informe") before Excel download.
 */
export async function getExecutiveReportPreview(
  reportId: ExecutiveReportId,
  meta: StoreReportMeta,
  range: ReportDateRange
): Promise<ExecutiveReportPreviewData> {
  const payload = await buildExecutiveReportData(reportId, meta, range);
  return {
    ...payload,
    sheets: payload.sheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => {
        const cleanRow: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          cleanRow[k] = v && typeof v === 'object' && 'formula' in v ? '' : v;
        }
        return cleanRow;
      }),
    })),
  };
}

/**
 * Generates and downloads a formatted Excel (.xlsx) workbook with store logo.
 */
export async function generateExecutiveExcelReport(
  reportId: ExecutiveReportId,
  meta: StoreReportMeta,
  range: ReportDateRange
): Promise<string> {
  const payload = await buildExecutiveReportData(reportId, meta, range);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GASTROLAB by Iván Muñoz';
  workbook.created = new Date();

  const logoBuffer = await loadLogoPngBuffer(meta.logoUrl);
  const imageId = logoBuffer
    ? workbook.addImage({ buffer: logoBuffer, extension: 'png' })
    : null;

  for (const sheetSpec of payload.sheets) {
    const ws = workbook.addWorksheet(sheetSpec.sheetName);
    const startRow = styleSheetHeaderWithLogo(
      ws,
      imageId,
      meta,
      sheetSpec.title,
      sheetSpec.subtitle,
      sheetSpec.columns.length
    );
    writeStyledTable(
      ws,
      startRow,
      sheetSpec.columns,
      sheetSpec.rows,
      sheetSpec.totalsRow,
      sheetSpec.highlightRowFn
    );
  }

  const outBuffer = await workbook.xlsx.writeBuffer();
  triggerExcelDownload(outBuffer as ArrayBuffer, payload.filename);
  return payload.filename;
}
