import React from 'react';
import { OrderItem } from '../types';
import { ElectronicInvoiceRecord, getSriPaymentMethodLabel } from '../utils/sriHelpers';
import { PaperFormat, StorePrintSettings } from '../utils/printerService';

interface RidePrintDocumentProps {
  invoice: ElectronicInvoiceRecord;
  store: StorePrintSettings;
  format: PaperFormat;
  isReprint?: boolean;
  autoCut?: boolean;
}

/**
 * Generates deterministic high-contrast barcode bars from the 49-digit SRI Clave de Acceso.
 */
const AccessKeyBarcode: React.FC<{ clave: string; height?: number }> = ({
  clave,
  height = 38,
}) => {
  const digits = (clave || '0'.repeat(49)).slice(0, 49);
  const bars: Array<{ x: number; w: number }> = [];
  let cursor = 2;
  for (let i = 0; i < digits.length; i++) {
    const code = digits.charCodeAt(i);
    const barW = ((code + i) % 3) + 1;
    const gapW = ((code * 2 + i) % 2) + 1;
    bars.push({ x: cursor, w: barW });
    cursor += barW + gapW;
  }
  const totalWidth = Math.max(cursor + 2, 180);

  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${height}`}
      className="w-full"
      style={{ height: `${height}px`, display: 'block' }}
      preserveAspectRatio="none"
      aria-label="Código de barras Clave de Acceso"
    >
      <rect x="0" y="0" width={totalWidth} height={height} fill="#FFFFFF" />
      {bars.map((b, idx) => (
        <rect key={idx} x={b.x} y={0} width={b.w} height={height} fill="#000000" />
      ))}
    </svg>
  );
};

export const RidePrintDocument: React.FC<RidePrintDocumentProps> = ({
  invoice,
  store,
  format,
  isReprint = false,
  autoCut = true,
}) => {
  const isInternal = invoice.status === 'TICKET_INTERNO' || invoice.isInternalTicket === true;
  const ivaRate = invoice.ivaRate ?? store.ivaPercentage ?? 15;
  const subtotal = Number(invoice.subtotal) || 0;
  const ivaAmount = Number(invoice.ivaAmount) || 0;
  const total = Number(invoice.total) || 0;
  const discountAmount = Number(invoice.discountAmount) || 0;
  const dateObj = new Date(invoice.date || invoice.createdAt || Date.now());
  const dateFormatted = dateObj.toLocaleDateString('es-EC');
  const authDateFormatted = invoice.sriAuthorizationDate
    ? new Date(invoice.sriAuthorizationDate).toLocaleString('es-EC')
    : dateObj.toLocaleString('es-EC');

  const items = invoice.items || [];
  const clientName = invoice.client?.name || 'CONSUMIDOR FINAL';
  const clientDocNumber = invoice.client?.docNumber || '9999999999999';
  const clientDocType = invoice.client?.docType || 'RUC/CI';

  // THERMAL FORMAT: 58mm or 80mm
  if (format === '58mm' || format === '80mm') {
    const widthStyle = format === '58mm' ? '52mm' : '74mm';
    const fontSizeClass = format === '58mm' ? 'text-[10px]' : 'text-[11px]';

    return (
      <div
        data-auto-cut={autoCut ? 'true' : 'false'}
        className={`bg-white text-black font-mono ${fontSizeClass} leading-snug mx-auto p-2 space-y-2 ${
          autoCut ? 'gastrolab-thermal-autocut' : ''
        }`}
        style={{ width: widthStyle, maxWidth: '100%' }}
      >
        <div className="text-center space-y-0.5">
          {store.logoUrl && (
            <img
              src={store.logoUrl}
              alt={store.localName || 'Logo'}
              className="h-10 w-auto object-contain mx-auto mb-1"
            />
          )}
          <div className="font-black text-xs uppercase tracking-tight">
            {store.localName}
          </div>
          {store.ruc && <div>RUC: {store.ruc}</div>}
          {store.address && <div className="text-[9px]">{store.address}</div>}
          <div className="text-[9px]">OBLIGADO A LLEVAR CONTABILIDAD</div>
        </div>

        <div className="border-y border-dashed border-black py-1 text-center">
          <div className="font-black text-xs">
            {isInternal ? 'TICKET DE VENTA INTERNO' : 'FACTURA ELECTRÓNICA (RIDE)'}
          </div>
          <div className="font-bold">No. {invoice.invoiceNumber}</div>
          <div className="text-[9px]">
            {isInternal
              ? 'CONSUMIDOR FINAL · DOCUMENTO INTERNO SIN ENVÍO SRI'
              : 'AMBIENTE: PRODUCCIÓN · EMISIÓN: NORMAL'}
          </div>
          {isReprint && (
            <div className="mt-1 border border-black font-black text-[9px] py-0.5 uppercase">
              REIMPRESIÓN — COPIA FÍSICA
              <br />
              {isInternal ? '(TICKET INTERNO DE VENTA)' : '(YA AUTORIZADA EN EL SRI)'}
            </div>
          )}
        </div>

        <div className="space-y-0.5 text-[10px]">
          <div>
            <strong>FECHA:</strong> {dateObj.toLocaleString('es-EC')}
          </div>
          <div>
            <strong>CLIENTE:</strong> {clientName}
          </div>
          <div>
            <strong>{clientDocType}:</strong> {clientDocNumber}
          </div>
          {invoice.client?.email && (
            <div className="break-all">
              <strong>EMAIL:</strong> {invoice.client.email}
            </div>
          )}
          {invoice.client?.address && (
            <div>
              <strong>DIR:</strong> {invoice.client.address}
            </div>
          )}
          {invoice.reference && (
            <div>
              <strong>REF:</strong> {invoice.reference}
            </div>
          )}
        </div>

        <div className="border-t border-b border-dashed border-black py-1 space-y-1">
          <div className="flex justify-between font-black border-b border-dotted border-black pb-0.5">
            <span>CANT / DESCRIPCIÓN</span>
            <span>TOTAL</span>
          </div>
          {items.length === 0 ? (
            <div className="flex justify-between">
              <span>1x Consumo General</span>
              <span>${total.toFixed(2)}</span>
            </div>
          ) : (
            items.map((it, idx) => {
              const qty = Number(it.quantity) || 1;
              const unitPrice = Number(it.price) || 0;
              const orderIt = it as OrderItem;
              return (
                <div key={idx} className="space-y-0.5">
                  <div className="flex justify-between items-start gap-1">
                    <span className="flex-1">
                      {qty}x {it.name}
                    </span>
                    <span className="font-bold shrink-0">${(qty * unitPrice).toFixed(2)}</span>
                  </div>
                  {orderIt.selectedCustomizations && orderIt.selectedCustomizations.length > 0 && (
                    <div className="text-[9px] pl-2">
                      {orderIt.selectedCustomizations.map((c, cIdx) => (
                        <div key={cIdx}>
                          + {c.groupName}: {c.optionName}
                          {c.extraPrice > 0 ? ` (+$${c.extraPrice.toFixed(2)})` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-0.5">
          <div className="flex justify-between">
            <span>SUBTOTAL ({ivaRate}%):</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between">
              <span>DESCUENTO:</span>
              <span>-${discountAmount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>IVA {ivaRate}%:</span>
            <span>${ivaAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-black text-xs border-t border-black pt-1">
            <span>VALOR TOTAL:</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>

        <div className="border-t border-dashed border-black pt-1 text-[9px] space-y-0.5">
          <div>
            <strong>FORMA DE PAGO:</strong> {getSriPaymentMethodLabel(invoice.paymentMethod)}
          </div>
          <div>
            <strong>ESTADO SRI:</strong>{' '}
            {isInternal
              ? 'DOCUMENTO INTERNO (SIN ENVÍO SRI)'
              : invoice.status === 'PENDIENTE_ENVIO_OFFLINE'
              ? <span className="text-rose-700 font-black">Pendiente SRI</span>
              : 'AUTORIZADO'}
          </div>
          {!isInternal && (
            <>
              <div className="pt-1 font-bold text-center">CLAVE DE ACCESO / AUTORIZACIÓN</div>
              <AccessKeyBarcode clave={invoice.claveAcceso} height={26} />
              <div className="text-[8px] break-all text-center font-mono leading-tight">
                {invoice.claveAcceso}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-dashed border-black pt-1.5 text-center text-[9px]">
          <div>*** GRACIAS POR SU PREFERENCIA ***</div>
          <div>
            {isInternal ? 'Ticket Interno Local — GASTROLAB' : 'Documento Físico RIDE — GASTROLAB'}
          </div>
        </div>
        {autoCut && <div className="gastrolab-cut-feed-line">--- ✂ CORTE AUTOMÁTICO ---</div>}
      </div>
    );
  }

  // STANDARD A4 / CARTA FORMAT (Epson normal, HP, Canon, Laser, Office printers)
  return (
    <div
      data-auto-cut={autoCut ? 'true' : 'false'}
      className={`bg-white text-black font-sans text-[11px] leading-snug mx-auto p-4 space-y-3 ${
        autoCut ? 'gastrolab-thermal-autocut' : ''
      }`}
      style={{ width: '100%', maxWidth: '195mm' }}
    >
      {/* Copy / Reprint Header Badge */}
      {isReprint && (
        <div className="border-2 border-black bg-gray-100 px-3 py-1.5 text-center font-black text-[11px] uppercase tracking-wider">
          {isInternal
            ? 'REIMPRESIÓN — TICKET INTERNO DE VENTA (CONSUMIDOR FINAL · NO ENVIADO AL SRI)'
            : 'REIMPRESIÓN — COPIA DE DOCUMENTO FÍSICO · COMPROBANTE YA AUTORIZADO ELECTRÓNICAMENTE EN EL SRI'}
        </div>
      )}

      {/* Top SRI Two-Column Header */}
      <div className="grid grid-cols-12 gap-3 items-stretch">
        {/* Left Emisor Info Box */}
        <div className="col-span-6 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-center p-2 border border-gray-300 rounded-lg min-h-[76px]">
            {store.logoUrl ? (
              <img
                src={store.logoUrl}
                alt={store.localName || 'Logo'}
                className="max-h-16 w-auto object-contain"
              />
            ) : (
              <span className="text-lg font-black uppercase tracking-tight">
                {store.localName || 'GASTROLAB'}
              </span>
            )}
          </div>

          <div className="border border-black rounded-lg p-3 space-y-1">
            <div className="font-black text-sm uppercase">
              {store.localName}
            </div>
            {store.slogan && <div className="text-[10px] italic">{store.slogan}</div>}
            <div>
              <strong>Dir. Matriz:</strong> {store.address || 'Matriz Principal'}
            </div>
            {store.establishment && (
              <div>
                <strong>Dir. Sucursal:</strong> {store.establishment}
              </div>
            )}
            <div>
              <strong>OBLIGADO A LLEVAR CONTABILIDAD:</strong> SI
            </div>
          </div>
        </div>

        {/* Right SRI Authorization Box / Internal Ticket Box */}
        <div className="col-span-6 border border-black rounded-lg p-3 space-y-1.5 flex flex-col justify-between">
          <div>
            <div className="text-xs">
              <strong>R.U.C.:</strong> <span className="font-mono font-bold">{store.ruc}</span>
            </div>
            <div className="text-base font-black tracking-wide uppercase mt-1">
              {isInternal ? 'TICKET INTERNO DE VENTA' : 'FACTURA'}
            </div>
            <div className="text-xs font-mono font-bold">No. {invoice.invoiceNumber}</div>
          </div>

          {isInternal ? (
            <div className="space-y-1 pt-2 border-t border-gray-300 text-[10px]">
              <div className="font-bold uppercase">CONSUMIDOR FINAL — DOCUMENTO DEL LOCAL</div>
              <p className="text-gray-700">
                Comprobante interno registrado en Facturación. No se transmite electrónicamente al SRI.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1 pt-1 border-t border-gray-300">
                <div className="text-[10px] font-bold uppercase">Número de Autorización:</div>
                <div className="font-mono text-[9px] break-all">
                  {invoice.sriAuthorizationNumber || invoice.claveAcceso}
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>
                    <strong>Fecha Autorización:</strong> {authDateFormatted}
                  </span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>
                    <strong>Ambiente:</strong> PRODUCCIÓN
                  </span>
                  <span>
                    <strong>Emisión:</strong> NORMAL
                  </span>
                </div>
              </div>

              <div className="pt-1 border-t border-gray-300">
                <div className="text-[10px] font-bold uppercase mb-1">Clave de Acceso:</div>
                <AccessKeyBarcode clave={invoice.claveAcceso} height={34} />
                <div className="font-mono text-[9px] text-center break-all mt-1">
                  {invoice.claveAcceso}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Client Box */}
      <div className="border border-black rounded-lg p-3 grid grid-cols-12 gap-y-1.5 gap-x-3 text-[11px]">
        <div className="col-span-8">
          <strong>Razón Social / Nombres y Apellidos:</strong> {clientName}
        </div>
        <div className="col-span-4 font-mono">
          <strong>{clientDocType}:</strong> {clientDocNumber}
        </div>
        <div className="col-span-4">
          <strong>Fecha Emisión:</strong> {dateFormatted}
        </div>
        <div className="col-span-4">
          <strong>Correo:</strong> {invoice.client?.email || 'No registrado'}
        </div>
        <div className="col-span-4">
          <strong>Referencia:</strong> {invoice.reference || 'Venta Directa'}
        </div>
        <div className="col-span-12">
          <strong>Dirección:</strong> {invoice.client?.address || 'Ciudad / Local'}
          {invoice.client?.phone ? ` · Tel: ${invoice.client.phone}` : ''}
        </div>
      </div>

      {/* Items Table */}
      <table className="w-full border-collapse border border-black text-[11px]">
        <thead>
          <tr className="bg-gray-100 border-b border-black font-bold text-left">
            <th className="p-2 border-r border-black w-16 text-center">Cant.</th>
            <th className="p-2 border-r border-black">Descripción</th>
            <th className="p-2 border-r border-black w-24 text-right">P. Unitario</th>
            <th className="p-2 border-r border-black w-20 text-right">Descuento</th>
            <th className="p-2 w-24 text-right">Precio Total</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr className="border-b border-gray-300">
              <td className="p-2 border-r border-black text-center font-mono">1</td>
              <td className="p-2 border-r border-black">Consumo de Alimentos y Bebidas</td>
              <td className="p-2 border-r border-black text-right font-mono">${subtotal.toFixed(2)}</td>
              <td className="p-2 border-r border-black text-right font-mono">$0.00</td>
              <td className="p-2 text-right font-mono font-bold">${subtotal.toFixed(2)}</td>
            </tr>
          ) : (
            items.map((it, idx) => {
              const qty = Number(it.quantity) || 1;
              const pvp = Number(it.price) || 0;
              const orderIt = it as OrderItem;
              // Prices stored in orders/invoices are tax-inclusive PVP; compute pre-IVA line display for RIDE consistency
              const unitNet = pvp / (1 + ivaRate / 100);
              const lineNet = unitNet * qty;
              return (
                <tr key={idx} className="border-b border-gray-300">
                  <td className="p-2 border-r border-black text-center font-mono">{qty}</td>
                  <td className="p-2 border-r border-black font-medium">
                    <div>{it.name}</div>
                    {orderIt.selectedCustomizations && orderIt.selectedCustomizations.length > 0 && (
                      <div className="text-[10px] text-gray-600 pl-2">
                        {orderIt.selectedCustomizations.map((c) => `${c.groupName}: ${c.optionName}`).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="p-2 border-r border-black text-right font-mono">
                    ${unitNet.toFixed(2)}
                  </td>
                  <td className="p-2 border-r border-black text-right font-mono">$0.00</td>
                  <td className="p-2 text-right font-mono font-bold">${lineNet.toFixed(2)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* Bottom Info & Totals */}
      <div className="grid grid-cols-12 gap-3 items-start">
        {/* Additional Info + Payment */}
        <div className="col-span-7 space-y-2">
          <div className="border border-black rounded-lg p-3 space-y-1">
            <div className="font-bold uppercase text-[10px] border-b border-gray-300 pb-1">
              Forma de Pago SRI
            </div>
            <div className="flex justify-between">
              <span>{getSriPaymentMethodLabel(invoice.paymentMethod)}</span>
              <span className="font-mono font-bold">${total.toFixed(2)}</span>
            </div>
          </div>

          <div className="border border-black rounded-lg p-3 space-y-1 text-[10px]">
            <div className="font-bold uppercase border-b border-gray-300 pb-1">
              Información Adicional
            </div>
            <div>
              <strong>Estado Comprobante SRI:</strong>{' '}
              {invoice.status === 'PENDIENTE_ENVIO_OFFLINE' ? (
                <span className="text-rose-700 font-black">Pendiente SRI</span>
              ) : (
                'AUTORIZADO'
              )}
            </div>
            {invoice.client?.email && (
              <div>
                <strong>Email de Envío XML/RIDE:</strong> {invoice.client.email}
              </div>
            )}
            {isReprint && (
              <div>
                <strong>Nota de Impresión:</strong> Duplicado físico impreso sin re-emisión al SRI.
              </div>
            )}
          </div>
        </div>

        {/* Totals Breakdown */}
        <div className="col-span-5 border border-black rounded-lg overflow-hidden">
          <table className="w-full text-[11px]">
            <tbody className="divide-y divide-gray-300">
              <tr>
                <td className="p-1.5 font-semibold">SUBTOTAL {ivaRate}%</td>
                <td className="p-1.5 text-right font-mono">${subtotal.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="p-1.5 font-semibold">SUBTOTAL 0%</td>
                <td className="p-1.5 text-right font-mono">$0.00</td>
              </tr>
              <tr>
                <td className="p-1.5 font-semibold">DESCUENTO</td>
                <td className="p-1.5 text-right font-mono">${discountAmount.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="p-1.5 font-semibold">IVA {ivaRate}%</td>
                <td className="p-1.5 text-right font-mono">${ivaAmount.toFixed(2)}</td>
              </tr>
              <tr className="bg-gray-100 font-black text-xs border-t-2 border-black">
                <td className="p-2">VALOR TOTAL</td>
                <td className="p-2 text-right font-mono">${total.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-center text-[9px] text-gray-600 pt-2 border-t border-gray-300">
        {isInternal
          ? `Ticket Interno de Consumidor Final · ${store.localName || 'GASTROLAB'} · Documento válido del local`
          : `Representación Impresa de Comprobante Electrónico (RIDE) · ${store.localName || 'GASTROLAB'} · Documento válido físico`}
      </div>
    </div>
  );
};
