export type UserRole =
  | 'Owner'
  | 'Admin'
  | 'Cashier'
  | 'Kitchen Manager'
  | 'Kitchen Assistant'
  | 'Service Staff';

export type AppUnit = 'Grs.' | 'Ml.' | 'Unds.';
export const APP_UNITS: AppUnit[] = ['Grs.', 'Ml.', 'Unds.'];

export interface UserProfile {
  uid: string;
  name: string;
  lastName?: string;
  email: string;
  authEmail?: string;
  role: UserRole;
  authHash?: string;
  authSalt?: string;
  pin?: string;
  authorizedAreas?: string[];
  authorizedBranches?: string[];
  allowedModules?: string[];
  canDeleteWithPersonalPassword?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export type DeviceType = 'PC' | 'Mobile';

export interface DeviceSession {
  deviceId: string;
  deviceType: DeviceType;
  deviceName: string;
  userAgent: string;
  registeredAt: string;
  lastActive: string;
}

export interface LicenseRecord {
  code: string;
  isUsed: boolean;
  status: 'available' | 'used';
  usedAt?: string;
  usedBy?: string;
  activatedByEmail?: string;
  maxDevices: number;
  maxPcDevices: number;
  maxMobileDevices: number;
  connectedDevices: DeviceSession[];
  createdAt: string;
}

export interface SystemLicenseState {
  id: string;
  trialStartedAt: string;
  trialEndsAt: string;
  trialDurationDays: number;
  status: 'trial' | 'active' | 'expired';
  activeLicenseCode?: string;
  activatedAt?: string;
  activatedBy?: string;
  activatedByEmail?: string;
  licenseValidUntil?: string; // 1 year from activation
  ownerName?: string;
  restaurantName?: string;
  connectedDevices: DeviceSession[];
  updatedAt?: string;
}

export interface ProductComponentLink {
  id: string;
  name: string;
  type: 'ingrediente' | 'receta' | 'subreceta';
  quantity: number;
  unit: string;
}

export interface ComboIncludedProduct {
  productId: string;
  name: string;
  quantity: number;
  category?: string;
  unitPrice?: number;
}

export interface ProductCustomizationOption {
  id: string;
  name: string;
  extraPrice: number;
  available?: boolean;
}

export interface ProductCustomizationGroup {
  id: string;
  name: string;
  multiSelect?: boolean;
  required?: boolean;
  options: ProductCustomizationOption[];
}

export interface OrderItemCustomization {
  groupName: string;
  optionName: string;
  extraPrice: number;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  imageUrl?: string;
  available?: boolean;
  isCombo?: boolean;
  comboItems?: ComboIncludedProduct[];
  linkedRecipeId?: string;
  linkedRecipeName?: string;
  linkedRecipeType?: 'receta' | 'subreceta';
  linkedComponents?: ProductComponentLink[];
  customizations?: ProductCustomizationGroup[];
  createdAt: string;
  updatedAt?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedCustomizations?: OrderItemCustomization[];
  unitPrice?: number;
  cartKey?: string;
}

export type TableStatus = 'Libre' | 'Ocupada';

export type TableShape = 'cuadrada' | 'redonda' | 'rectangular' | 'barra';

export interface RestaurantTable {
  id: string;
  tableNumber: number;
  name: string;
  status: TableStatus;
  branch?: string;
  currentOrderId?: string;
  orderStatus?: string;
  lastDeliveredAt?: string;
  activeSince?: string;
  capacity?: number;
  total?: number;
  itemCount?: number;
  displayOrder?: number;
  // Floor-plan geometry, shape & merged tables
  shape?: TableShape;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  preMergeWidth?: number;
  preMergeHeight?: number;
  mergedTables?: string[];
  mergedMasterId?: string;
  mergedTableNumbers?: number[];
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  basePrice?: number;
  quantity: number;
  notes?: string;
  dinerName?: string;
  selectedCustomizations?: OrderItemCustomization[];
  imageUrl?: string;
}

export type OrderStatus = 'En Preparacion' | 'En Cocina' | 'Entregado' | 'Cobrado' | 'Anulado';

export interface KitchenBatch {
  batchNumber: number;
  sentAt: string;
  isUpdate: boolean;
  items: OrderItem[];
  notes?: string;
}

export interface Promotion {
  id: string;
  name: string;
  type: 'descuento' | 'multi_compra';
  grossPrice?: number;
  discountPercent?: number;
  deliverQty?: number;
  chargeQty?: number;
  promoPrice: number;
  productIds: string[];
  productNames: string[];
  categories?: string[];
  startDate?: string;
  endDate?: string;
  daysOfWeek: string[];
  active: boolean;
  branch?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CancelledOrderItem {
  name: string;
  quantity: number;
  dinerName?: string;
  reason?: string;
  authorizedBy?: string;
  cancelledAt: string;
}

export interface Order {
  id: string;
  tableNumber: number;
  tableId?: string;
  tableName?: string;
  mergedTableIds?: string[];
  mergedTableNumbers?: number[];
  branch?: string;
  isDomicilio?: boolean;
  orderType?: 'DOMICILIO' | 'MESA';
  items: OrderItem[];
  activeKitchenItems?: OrderItem[];
  dinersList?: string[];
  cancelledItems?: CancelledOrderItem[];
  total: number;
  status: OrderStatus;
  sentToKitchen: boolean;
  sentToKitchenAt?: string;
  deliveredAt?: string;
  latestKitchenBatch?: KitchenBatch;
  kitchenBatches?: KitchenBatch[];
  notes?: string;
  waiterName?: string;
  waiterUid?: string;
  waiterRole?: string;
  updatedBy?: string;
  collectedBy?: string;
  cancellationReason?: string;
  authorizedBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export type InventoryUnit = 'Grs.' | 'Ml.' | 'Unds.' | 'kg' | 'lt' | 'unidad';

export interface InventoryItem {
  id: string;
  name: string;
  unit: InventoryUnit;
  currentStock: number;
  minStock: number;
  cost: number; // cost per unit (exact base unit cost)
  totalCost?: number; // total batch/product cost entered
  costPerBaseUnit: number; // calculated cost per gram (g), milliliter (ml), or unit
  expiryDate?: string; // Fecha de Caducidad (YYYY-MM-DD)
  hasPendingWaste: boolean;
  pendingWasteQty?: number;
  category?: string;
  branch?: string;
  updatedAt?: string;
}

export type KardexMovementType = 'Entrada' | 'Salida' | 'Salida por Baja' | 'Ajuste';

export interface KardexEntry {
  id: string;
  itemId: string;
  itemName: string;
  movementType: KardexMovementType;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  balanceStock: number;
  reference: string;
  reason?: string;
  responsible?: string;
  branch?: string;
  createdAt: string;
}

export interface PurchaseItem {
  itemId: string;
  name: string;
  productName?: string;
  quantity: number;
  unit: InventoryUnit;
  totalCost: number;
  unitCost: number;
  costPerUnit?: number;
  expiryDate?: string;
  hasWaste: boolean;
  wasteStatus: 'none' | 'pending' | 'processed';
}

export interface PurchaseInvoice {
  id: string;
  invoiceNumber: string;
  provider: string;
  date: string;
  items: PurchaseItem[];
  totalAmount: number;
  hasWaste?: boolean;
  wasteStatus?: 'none' | 'pending' | 'processed';
  branch?: string;
  createdAt: string;
}

export interface WasteRecord {
  id: string;
  date: string; // Fecha
  itemId: string;
  productName: string; // Producto
  unit: string; // Unidad
  initialWeight: number; // Peso Inicial
  finalWeight: number; // Peso Final (input)
  wasteAmount: number; // Merma (Peso Inicial - Peso Final)
  wastePercentage: number; // Merma %
  usableQuantity: number; // Cantidad Útil
  responsible: string; // Responsable
  wasteReason: string; // Motivo de Merma
  status: 'pending' | 'processed'; // RED (pending) to GREEN (processed)
  invoiceId?: string;
  kardexEntryId?: string;
  branch?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface RecipeIngredient {
  type: 'inventory' | 'subrecipe';
  id: string;
  name: string;
  unit: 'Grs.' | 'Ml.' | 'Unds.' | 'g' | 'ml' | 'u' | 'kg' | 'lt' | 'unidad';
  quantity: number; // exact weight in grams or ml or units
  costPerBaseUnit: number; // cost per g, ml or unit
  totalCost: number;
}

export interface Subrecipe {
  id: string;
  name: string;
  category?: string;
  yieldWeight: number; // Total preparation yield in grams or ml
  yieldUnit: 'Grs.' | 'Ml.' | 'Unds.' | 'g' | 'ml';
  ingredients: RecipeIngredient[];
  totalCost: number;
  costPerGramOrMl: number; // System calculates cost per gram/ml of subrecipe
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Recipe {
  id: string;
  name: string; // Receta Madre
  category?: string;
  productId?: string; // Linked Menu Carta product ID
  portions: number;
  ingredients: RecipeIngredient[]; // Both ingredients and subrecipes
  realCost: number; // Real cost of the recipe
  suggestedPrice: number; // Suggested selling price based on Food Cost %
  targetFoodCostPercentage: number; // e.g. 28% or 30%
  instructions?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Supplier {
  id: string;
  name: string;
  category: string;
  phone?: string;
  email?: string;
  city?: string;
  taxId?: string; // RUC / NIT
  createdAt: string;
}

export interface CashRegister {
  id: string;
  name: string; // e.g. "Caja 1", "Caja 2"
  branch?: string;
  status: 'open' | 'closed';
  currentShiftId?: string | null;
  currentShiftNumber?: number;
  initialCash?: number | null;
  currentCash?: number;
  totalSales?: number;
  openedAt?: string | null;
  openedBy?: string | null;
  openedByEmail?: string;
  lastClosedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CashAudit {
  id: string;
  timestamp: string;
  auditedBy?: string;
  performedBy?: string;
  countedCash: number;
  expectedCash: number;
  difference: number;
  expectedTransfer?: number;
  countedTransfer?: number;
  transferDifference?: number;
  expectedDeUna?: number;
  countedDeUna?: number;
  deUnaDifference?: number;
  expectedCard?: number;
  countedCard?: number;
  cardDifference?: number;
  totalExpected?: number;
  totalCounted?: number;
  totalDifference?: number;
  notes?: string;
}

export interface CashMovement {
  id: string;
  registerId: string;
  shiftId: string;
  branch?: string;
  type: 'ingreso' | 'egreso' | 'in' | 'out';
  amount: number;
  reason: string;
  performedBy: string;
  createdAt: string;
}

export interface CashShift {
  id: string;
  shiftNumber?: number;
  registerId: string;
  registerName: string;
  branch?: string;
  cashierUid?: string;
  cashierName?: string;
  status: 'open' | 'closed';
  openedAt: string;
  openedBy?: string;
  openedByEmail?: string;
  initialCash: number; // Fondo de Caja
  closedAt?: string;
  closedBy?: string;
  closedByEmail?: string;
  expectedCash: number;
  actualCashCounted?: number;
  difference?: number;
  surplusAmount?: number;
  denominationBreakdown?: {
    bills20: number;
    bills10: number;
    bills5: number;
    coins1: number;
    coins050: number;
    coins025: number;
    coins010: number;
    coins005: number;
    coins001: number;
  };
  totalSales: number;
  cashSales: number;
  cardSales: number;
  transferSales?: number;
  deUnaSales?: number;
  otherSales?: number;
  cashIn?: number;
  cashOut?: number;
  cashIns?: number;
  cashOuts?: number;
  auditHistory?: CashAudit[];
  notes?: string;
  closingNotes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SystemSettings {
  id?: string;
  localName?: string;
  slogan: string;
  logoUrl?: string;
  ivaPercentage: number; // IVA % Sistema
  foodCostPercentage: number; // Food Cost %
  receiptPrinter?: string;
  kitchenPrinter?: string;
  reportsPrinter?: string;
  paperSize?: '58mm' | '80mm' | 'A4';
  autoCut?: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface PrinterDevice {
  id: string;
  name: string;
  type: 'thermal_receipt' | 'thermal_kitchen' | 'standard_office';
  connection: 'USB' | 'Red / Ethernet' | 'Bluetooth';
  status: 'online' | 'offline';
  paperSize: '58mm' | '80mm' | 'A4';
  isDefaultReceipt?: boolean;
  isDefaultReport?: boolean;
}

export interface ClientOverride {
  id: string;
  storeId: string;
  storeName?: string;
  customTag?: string;
  notes?: string;
  featureFlags?: {
    customPricingEnabled?: boolean;
    customTaxRate?: number | null;
    customBannerText?: string;
  };
  updatedBy?: string;
  updatedAt: string;
}

export type WhatsAppOrderStatus =
  | 'Pendiente de Pago'
  | 'Pagado'
  | 'Enviado a Sinqro'
  | 'Confirmado';

export interface WhatsAppMessage {
  id: string;
  sender: 'customer' | 'bot' | 'agent';
  senderName?: string;
  text: string;
  timestamp: string;
  attachmentUrl?: string;
  attachmentType?: 'image' | 'receipt';
}

export interface WhatsAppChat {
  id: string;
  customerName: string;
  phone: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  status: 'bot' | 'humano' | 'cerrado';
  linkedOrderId?: string;
  branch?: string;
  messages: WhatsAppMessage[];
  updatedAt?: string;
}

export interface WhatsAppOrderItemInput {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers?: Array<{
    modifierId: string;
    name: string;
    price: number;
  }>;
  ingredients?: string[];
  comment?: string;
}

export interface GastroLabOrderPayload {
  orderType: 'DELIVERY' | 'PICKUP';
  externalReference: string;
  customer: {
    firstName: string;
    lastName: string;
    taxId: string;
    email: string;
    phone: string;
    address: string;
    location: {
      lat: number;
      lng: number;
    };
  };
  items: Array<{
    menuItemId: string;
    quantity: number;
    modifiers: Array<{
      modifierId: string;
      name: string;
      price: number;
    }>;
    comment: string;
  }>;
  productos: Array<{
    id: string;
    cantidad: number;
    extras: Array<{
      id: string;
      nombre: string;
      precio: number;
    }>;
    ingredientes: string[];
    nota: string;
  }>;
  deliveryFee: number;
  paymentMethod: 'DEUNA' | 'TRANSFER' | 'CASH';
  paymentStatus: 'PENDING' | 'PAID';
  totals: {
    subtotal: number;
    tax: number;
    total: number;
  };
}

export interface WhatsAppOrderRecord {
  id: string;
  externalReference: string;
  customerFirstName: string;
  customerLastName: string;
  customerTaxId: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  location?: { lat: number; lng: number };
  items: WhatsAppOrderItemInput[];
  subtotal: number;
  tax: number;
  deliveryFee: number;
  total: number;
  paymentMethod: 'DEUNA' | 'TRANSFER' | 'CASH';
  paymentStatus: 'PENDING' | 'PAID';
  status: WhatsAppOrderStatus;
  transferReceiptUrl?: string;
  transferReference?: string;
  transferBank?: string;
  transferVerified?: boolean;
  verifiedBy?: string;
  verifiedAt?: string;
  sinqroTrackingId?: string;
  retryCount?: number;
  lastError?: string;
  lastSyncedAt?: string;
  branch?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface WhatsAppIntegrationConfig {
  WHATSAPP_TOKEN: string;
  WHATSAPP_PHONE_ID: string;
  SINQRO_API_KEY: string;
  SINQRO_WEBHOOK_SECRET: string;
  GASTROLAB_API_URL: string;
  GASTROLAB_CLIENT_ID: string;
  GASTROLAB_CLIENT_SECRET: string;
  GASTROLAB_HMAC_SECRET: string;
  DELIVERY_FEE: string;
  DEUNA_API_KEY: string;
}


