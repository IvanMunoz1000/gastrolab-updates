import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  query,
  doc,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe, getDocOfflineSafe, getDocsOfflineSafe } from '../utils/offlineFirestore';
import { usePrinter } from '../context/PrinterContext';
import {
  Product,
  Promotion,
  RestaurantTable,
  Order,
  OrderItem,
  KitchenBatch,
  OrderItemCustomization,
  CancelledOrderItem,
  OrderStatus,
} from '../types';
import { AdminAuthModal } from './AdminAuthModal';
import { CobroModal } from './CobroModal';
import { ElectronicInvoiceRecord, generateClaveDeAcceso } from '../utils/sriHelpers';
import {
  deductRecipeIngredientsFromInventory,
  deductDeliverySuppliesFromInventory,
} from '../utils/recipeInventoryDeduction';
import { groupOrderCustomizations, isPromotionValidNow } from '../utils/customizationFormatters';
import { broadcastCustomerDisplay } from '../utils/customerDisplayChannel';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  X,
  Plus,
  Minus,
  Trash2,
  UtensilsCrossed,
  ChefHat,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  MessageSquare,
  Search,
  Receipt,
  Clock,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Printer,
  Users,
  SlidersHorizontal,
  Maximize2,
  Minimize2,
  Tag,
  Pencil,
  Layers,
} from 'lucide-react';

const getItemSignature = (it: OrderItem): string => {
  const custSig = (it.selectedCustomizations || [])
    .map((c) => `${c.groupName}:${c.optionName}:${Number(c.extraPrice) || 0}`)
    .sort()
    .join('|');
  return `${it.productId}__${(it.notes || '').trim().toLowerCase()}__${(it.dinerName || '').trim().toLowerCase()}__${custSig}`;
};

const DEFAULT_DINERS = ['Cliente 1', 'Cliente 2', 'Cliente 3', 'Cliente 4', 'Cliente 5'];

const mergeOrderItemLists = (base: OrderItem[], additions: OrderItem[]): OrderItem[] => {
  const merged = base.map((i) => ({ ...i }));
  additions.forEach((add) => {
    const sig = getItemSignature(add);
    const idx = merged.findIndex((m) => getItemSignature(m) === sig);
    if (idx > -1) {
      merged[idx] = {
        ...merged[idx],
        quantity: (Number(merged[idx].quantity) || 0) + (Number(add.quantity) || 0),
      };
    } else {
      merged.push({ ...add });
    }
  });
  return merged;
};

interface Props {
  table: RestaurantTable;
  isOpen: boolean;
  onClose: () => void;
  onTableUpdated?: (message?: string) => void;
}

export const TableOrderModal: React.FC<Props> = ({
  table,
  isOpen,
  onClose,
  onTableUpdated,
}) => {
  const { userProfile } = useAuth();
  const { activeBranch } = useBranch();
  const { storeSettings, printKitchenComanda, printThermalReceipt, isPrinting } = usePrinter();
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Current Order Ticket state
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [sentItemsSnapshot, setSentItemsSnapshot] = useState<OrderItem[]>([]);
  const [existingKitchenBatches, setExistingKitchenBatches] = useState<KitchenBatch[]>([]);
  const [existingActiveKitchenItems, setExistingActiveKitchenItems] = useState<OrderItem[]>([]);
  const [existingOrderStatus, setExistingOrderStatus] = useState<OrderStatus | null>(null);
  const [existingSentToKitchenAt, setExistingSentToKitchenAt] = useState<string | null>(null);
  const [existingCancelledItems, setExistingCancelledItems] = useState<CancelledOrderItem[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(table.currentOrderId || null);
  const [isSentToKitchen, setIsSentToKitchen] = useState<boolean>(false);
  const [generalOrderNotes, setGeneralOrderNotes] = useState<string>('');

  // Mobile Collapsible Drawer state (Requirement 1: Collapsible on mobile)
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState<boolean>(false);

  // Custom item note & dynamic diner assignment state (5 default + "+" to add more + editable names)
  const [editingNoteItemIndex, setEditingNoteItemIndex] = useState<number | null>(null);
  const [noteInputText, setNoteInputText] = useState<string>('');
  const [dinersList, setDinersList] = useState<string[]>(DEFAULT_DINERS);
  const [activeDiner, setActiveDiner] = useState<string>('');
  const [editingDinerSlotIdx, setEditingDinerSlotIdx] = useState<number | null>(null);
  const [dinerSlotRenameText, setDinerSlotRenameText] = useState<string>('');
  const [editingDinerItemIndex, setEditingDinerItemIndex] = useState<number | null>(null);
  const [dinerInputText, setDinerInputText] = useState<string>('');

  // Customization / Extras selector & pre-kitchen edit modal state
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);
  const [editingCartItemIndex, setEditingCartItemIndex] = useState<number | null>(null);
  const [selectedOptionsByGroup, setSelectedOptionsByGroup] = useState<Record<string, string[]>>({});
  const [customModalDiner, setCustomModalDiner] = useState<string>('');
  const [customModalNote, setCustomModalNote] = useState<string>('');
  const [customModalError, setCustomModalError] = useState<string | null>(null);

  // Admin Auth state for kitchen-locked orders
  const [isAdminAuthOpen, setIsAdminAuthOpen] = useState(false);
  const [pendingAuthAction, setPendingAuthAction] = useState<
    ((reason?: string, authorizedBy?: string) => void) | null
  >(null);
  const [authDescription, setAuthDescription] = useState<string>('');

  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const categoryStripRef = useRef<HTMLDivElement>(null);
  const sentItemsSnapshotRef = useRef<OrderItem[]>([]);
  const activeOrderIdRef = useRef<string | null>(table.currentOrderId || null);
  const savingLockRef = useRef<boolean>(false);
  const fullSettlementDoneRef = useRef<boolean>(false);
  const justPaidBroadcastRef = useRef<boolean>(false);
  const lastAddedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 150);

  // Unified tables helpers (recepciones grandes -> una sola cuenta maestra)
  const unifiedTableIds = useMemo(
    () =>
      table.tableNumber === 0
        ? [table.id]
        : Array.from(new Set([table.id, ...(table.mergedTables || [])].filter(Boolean))),
    [table.id, table.tableNumber, table.mergedTables]
  );
  const unifiedTableNumbers = useMemo(() => {
    if (table.tableNumber === 0) return [0];
    const nums =
      table.mergedTableNumbers && table.mergedTableNumbers.length > 0
        ? table.mergedTableNumbers
        : [table.tableNumber];
    return Array.from(new Set(nums)).sort((a, b) => a - b);
  }, [table.tableNumber, table.mergedTableNumbers]);
  const isUnifiedGroup = table.tableNumber > 0 && unifiedTableIds.length > 1;
  const displayTableTitle =
    table.tableNumber === 0
      ? 'DOMICILIO'
      : isUnifiedGroup
      ? `Mesas ${unifiedTableNumbers.join(' + ')}`
      : `Mesa ${table.tableNumber}`;

  useEffect(() => {
    activeOrderIdRef.current = activeOrderId;
  }, [activeOrderId]);

  useEffect(() => {
    return () => {
      if (lastAddedTimerRef.current) clearTimeout(lastAddedTimerRef.current);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!feedback) return;
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 4500);
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, [feedback]);

  // Load Menu (Carta) products & active Promotions from Firestore
  useEffect(() => {
    if (!isOpen) return;

    const q = query(collection(db, 'products'));
    const unsubscribeProducts = onSnapshot(
      q,
      (snap) => {
        const list: Product[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }));
        setProducts(list);
      },
      (err) => console.warn('TableOrder products listener notice:', err)
    );

    const qPromos = query(collection(db, 'promotions'));
    const unsubscribePromos = onSnapshot(
      qPromos,
      (snap) => {
        const promoList: Promotion[] = [];
        snap.forEach((d) => promoList.push({ id: d.id, ...(d.data() as Omit<Promotion, 'id'>) }));
        setPromotions(promoList);
      },
      (err) => console.warn('TableOrder promotions listener notice:', err)
    );

    return () => {
      unsubscribeProducts();
      unsubscribePromos();
    };
  }, [isOpen]);

  // Real-time listener for active order (syncs immediately across tablet/mobile and PC matrix)
  useEffect(() => {
    if (!isOpen) return;

    const applyRemoteOrder = (orderId: string, data: Order) => {
      const loadedItems = (data.items || []).map((i) => ({ ...i }));
      activeOrderIdRef.current = orderId;
      setActiveOrderId((prev) => (prev === orderId ? prev : orderId));
      setOrderItems((prevItems) => {
        // Keep any locally added unsent items if the user was mid-edit while another device sent items
        const unsentLocal = computeDeltaItems(prevItems, sentItemsSnapshotRef.current);
        let nextItems = loadedItems;
        if (unsentLocal.length > 0 && prevItems.length > 0) {
          const merged = loadedItems.map((i) => ({ ...i }));
          unsentLocal.forEach((u) => {
            const uSig = getItemSignature(u);
            const matchIdx = merged.findIndex((m) => getItemSignature(m) === uSig);
            if (matchIdx > -1) {
              merged[matchIdx].quantity += u.quantity;
            } else {
              merged.push({ ...u });
            }
          });
          nextItems = merged;
        }
        if (
          prevItems.length === nextItems.length &&
          prevItems.every(
            (p, idx) =>
              p.quantity === nextItems[idx].quantity &&
              getItemSignature(p) === getItemSignature(nextItems[idx])
          )
        ) {
          return prevItems;
        }
        return nextItems;
      });
      const nextSent = data.sentToKitchen ? loadedItems.map((i) => ({ ...i })) : [];
      sentItemsSnapshotRef.current = nextSent;
      setSentItemsSnapshot(nextSent);
      setExistingKitchenBatches(data.kitchenBatches || []);
      setExistingOrderStatus(data.status || null);
      setExistingSentToKitchenAt(data.sentToKitchenAt || null);
      setExistingCancelledItems(Array.isArray(data.cancelledItems) ? data.cancelledItems : []);
      setExistingActiveKitchenItems(
        Array.isArray(data.activeKitchenItems)
          ? data.activeKitchenItems.map((i) => ({ ...i }))
          : data.status === 'En Cocina'
          ? loadedItems.map((i) => ({ ...i }))
          : []
      );
      if (Array.isArray(data.dinersList) && data.dinersList.length > 0) {
        setDinersList(data.dinersList);
      }
      setIsSentToKitchen(!!data.sentToKitchen);
      setGeneralOrderNotes((prev) => (prev === (data.notes || '') ? prev : data.notes || ''));
    };

    if (table.currentOrderId) {
      const unsubOrder = onSnapshot(
        doc(db, 'orders', table.currentOrderId),
        (orderSnap) => {
          if (orderSnap.exists()) {
            const data = orderSnap.data() as Order;
            if (data.status === 'Cobrado' || data.status === 'Anulado') {
              setActiveOrderId(null);
              sentItemsSnapshotRef.current = [];
              setSentItemsSnapshot([]);
              setExistingKitchenBatches([]);
              setExistingActiveKitchenItems([]);
              setExistingOrderStatus(null);
              setExistingSentToKitchenAt(null);
              setExistingCancelledItems([]);
              setDinersList(DEFAULT_DINERS);
              setOrderItems([]);
              setGeneralOrderNotes('');
              setIsSentToKitchen(false);
            } else {
              applyRemoteOrder(orderSnap.id, data);
            }
          }
        },
        (err) => console.warn('TableOrder real-time order listener notice:', err)
      );
      return () => unsubOrder();
    }

    // No currentOrderId yet: listen for any active order created for this table from another device + load local draft
    setActiveOrderId(null);
    sentItemsSnapshotRef.current = [];
    setSentItemsSnapshot([]);
    setExistingKitchenBatches([]);
    setExistingActiveKitchenItems([]);
    setExistingOrderStatus(null);
    setExistingSentToKitchenAt(null);
    setExistingCancelledItems([]);
    setDinersList(DEFAULT_DINERS);
    setIsSentToKitchen(false);
    try {
      const branchDraftKey = `gastrolab_draft_${activeBranch}_${table.id}`;
      const legacyDraftKey = `gastrolab_draft_${table.id}`;
      const savedDraftRaw =
        localStorage.getItem(branchDraftKey) ||
        (activeBranch === 'Matriz' ? localStorage.getItem(legacyDraftKey) : null);
      if (savedDraftRaw) {
        const parsed = JSON.parse(savedDraftRaw);
        setOrderItems(Array.isArray(parsed.items) ? parsed.items : []);
        setGeneralOrderNotes(parsed.notes || '');
        if (Array.isArray(parsed.dinersList) && parsed.dinersList.length > 0) {
          setDinersList(parsed.dinersList);
        }
      } else {
        setOrderItems([]);
        setGeneralOrderNotes('');
      }
    } catch {
      setOrderItems([]);
      setGeneralOrderNotes('');
    }

    if (table.tableNumber > 0) {
      const qTableOrders = query(
        collection(db, 'orders'),
        where('tableNumber', '==', table.tableNumber)
      );
      const unsubTableOrders = onSnapshot(
        qTableOrders,
        (snap) => {
          const activeDoc = snap.docs.find((d) => {
            const ord = d.data() as Order;
            const st = ord.status;
            return st !== 'Cobrado' && st !== 'Anulado' && belongsToBranch(ord.branch, activeBranch);
          });
          if (activeDoc) {
            applyRemoteOrder(activeDoc.id, activeDoc.data() as Order);
          }
        },
        (err) => console.warn('TableOrder table-orders listener notice:', err)
      );
      return () => unsubTableOrders();
    }
  }, [table.id, table.currentOrderId, table.tableNumber, isOpen, activeBranch]);

  // Auto-save order draft synchronously to localStorage on every modification (resilience against power cuts)
  useEffect(() => {
    if (!isOpen || isSentToKitchen) return;
    try {
      const key = `gastrolab_draft_${activeBranch}_${table.id}`;
      if (orderItems.length > 0 || generalOrderNotes.trim()) {
        localStorage.setItem(
          key,
          JSON.stringify({
            items: orderItems,
            notes: generalOrderNotes,
            dinersList,
            updatedAt: new Date().toISOString(),
          })
        );
      } else {
        localStorage.removeItem(key);
        localStorage.removeItem(`gastrolab_draft_${table.id}`);
      }
    } catch {
      // Ignore storage quota issues
    }
  }, [orderItems, generalOrderNotes, dinersList, isOpen, isSentToKitchen, table.id, activeBranch]);

  const activePromotions = useMemo(
    () => promotions.filter((promo) => isPromotionValidNow(promo, activeBranch)),
    [promotions, activeBranch]
  );

  // Map product IDs to active promotions for quick badge indicators
  const promoByProductId = useMemo(() => {
    const map = new Map<string, Promotion>();
    activePromotions.forEach((promo) => {
      (promo.productIds || []).forEach((pid) => {
        if (!map.has(pid)) map.set(pid, promo);
      });
    });
    return map;
  }, [activePromotions]);

  // Memoized catalog categories (excludes Promociones & Combos from top strip; quick buttons below remain intact)
  const categories = useMemo(() => {
    const baseCats = Array.from(new Set(products.map((p) => p.category || 'General'))).filter(
      (cat) => {
        const norm = cat.trim().toLowerCase();
        return norm !== 'promociones' && norm !== 'combos';
      }
    );
    return ['Todos', ...baseCats];
  }, [products]);

  const filteredPromotions = useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase();
    return activePromotions.filter((promo) => {
      const promoCats =
        promo.categories && promo.categories.length > 0
          ? promo.categories
          : products
              .filter((p) => (promo.productIds || []).includes(p.id))
              .map((p) => p.category || 'General');
      const matchesCat =
        selectedCategory === 'Todos' ||
        selectedCategory === 'Promociones' ||
        promoCats.includes(selectedCategory);
      if (!matchesCat) return false;
      if (!q) return true;
      return (
        (promo.name || '').toLowerCase().includes(q) ||
        (promo.productNames || []).some((n) => n.toLowerCase().includes(q))
      );
    });
  }, [activePromotions, products, selectedCategory, debouncedSearchQuery]);

  const comboProductsCount = useMemo(
    () =>
      products.filter(
        (p) => p.isCombo === true || (p.category || '').toLowerCase().includes('combo')
      ).length,
    [products]
  );

  const filteredProducts = useMemo(() => {
    if (selectedCategory === 'Promociones') return [];
    const q = debouncedSearchQuery.trim().toLowerCase();
    return products.filter((p) => {
      const cat = p.category || 'General';
      const matchesCat =
        selectedCategory === 'Todos'
          ? true
          : selectedCategory === 'Combos'
          ? p.isCombo === true || cat.toLowerCase().includes('combo')
          : cat === selectedCategory;
      if (!matchesCat) return false;
      if (!q) return true;
      return (p.name || '').toLowerCase().includes(q) || cat.toLowerCase().includes(q);
    });
  }, [products, selectedCategory, debouncedSearchQuery]);

  const { ticketSubtotal, totalDishCount, inTicketCountMap } = useMemo(() => {
    let subtotal = 0;
    let dishes = 0;
    const counts = new Map<string, number>();
    for (const item of orderItems) {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.price) || 0;
      subtotal += price * qty;
      dishes += qty;
      counts.set(item.productId, (counts.get(item.productId) || 0) + qty);
    }
    return { ticketSubtotal: subtotal, totalDishCount: dishes, inTicketCountMap: counts };
  }, [orderItems]);

  // Pre-kitchen editable check: all items editable before kitchen, or newly added unsent items before updating kitchen
  const unsentEditableIndices = useMemo(() => {
    const editable = new Set<number>();
    if (!isSentToKitchen) {
      orderItems.forEach((_, idx) => editable.add(idx));
      return editable;
    }
    const sentPool = new Map<string, number>();
    sentItemsSnapshot.forEach((s) => {
      const key = getItemSignature(s);
      sentPool.set(key, (sentPool.get(key) || 0) + (Number(s.quantity) || 0));
    });
    orderItems.forEach((item, idx) => {
      const key = getItemSignature(item);
      const sentQty = sentPool.get(key) || 0;
      if (item.quantity > sentQty) {
        editable.add(idx);
      }
      if (sentQty > 0) {
        sentPool.set(key, Math.max(0, sentQty - item.quantity));
      }
    });
    return editable;
  }, [isSentToKitchen, orderItems, sentItemsSnapshot]);

  // Dual Display: live CART sync while order modal is open (never mutates state -> zero render loops)
  useEffect(() => {
    if (!isOpen) {
      justPaidBroadcastRef.current = false;
      return;
    }
    if (justPaidBroadcastRef.current) return;
    broadcastCustomerDisplay({
      type: 'CART',
      tableLabel: displayTableTitle,
      items: orderItems,
      subtotal: ticketSubtotal,
      total: ticketSubtotal,
      storeName: storeSettings.localName,
      localLogoUrl: storeSettings.logoUrl,
      slogan: storeSettings.slogan,
      timestamp: Date.now(),
    });
  }, [
    isOpen,
    displayTableTitle,
    orderItems,
    ticketSubtotal,
    storeSettings.localName,
    storeSettings.logoUrl,
    storeSettings.slogan,
  ]);

  const addItem = useCallback(
    (
      product: Product,
      options?: {
        selectedCustomizations?: OrderItemCustomization[];
        notes?: string;
        dinerName?: string;
      }
    ) => {
      const basePrice = Number(product.price) || 0;
      const customizations = options?.selectedCustomizations || [];
      const extrasTotal = customizations.reduce((sum, c) => sum + (Number(c.extraPrice) || 0), 0);
      const unitPrice = basePrice + extrasTotal;
      const resolvedNote = (options?.notes || '').trim();
      const resolvedDiner = (
        options?.dinerName !== undefined ? options.dinerName : activeDiner
      ).trim();

      const newCandidate: OrderItem = {
        productId: product.id,
        name: product.name,
        basePrice,
        price: unitPrice,
        quantity: 1,
        imageUrl: product.imageUrl,
        notes: resolvedNote,
        ...(resolvedDiner ? { dinerName: resolvedDiner } : {}),
        ...(customizations.length > 0 ? { selectedCustomizations: customizations } : {}),
      };
      const targetSig = getItemSignature(newCandidate);

      setOrderItems((prev) => {
        const existingIndex = prev.findIndex((item) => getItemSignature(item) === targetSig);
        if (existingIndex > -1) {
          return prev.map((item, idx) =>
            idx === existingIndex ? { ...item, quantity: (Number(item.quantity) || 0) + 1 } : item
          );
        }
        return [...prev, newCandidate];
      });

      setLastAddedId(product.id);
      if (lastAddedTimerRef.current) clearTimeout(lastAddedTimerRef.current);
      lastAddedTimerRef.current = setTimeout(() => setLastAddedId(null), 500);
    },
    [activeDiner]
  );

  const liveCustomizingProduct = useMemo(
    () =>
      customizingProduct
        ? products.find((p) => p.id === customizingProduct.id) || customizingProduct
        : null,
    [customizingProduct, products]
  );

  const handleAddProductToTicket = useCallback(
    (product: Product) => {
      if (product.available === false) {
        setFeedback({
          type: 'error',
          message: `"${product.name}" está marcado como No disponible / Agotado en Mesas.`,
        });
        return;
      }
      if (product.customizations && product.customizations.length > 0) {
        setEditingCartItemIndex(null);
        setCustomizingProduct(product);
        setSelectedOptionsByGroup({});
        setCustomModalDiner('');
        setCustomModalNote('');
        setCustomModalError(null);
        return;
      }
      addItem(product);
    },
    [addItem]
  );

  const handleAddPromotionToTicket = useCallback(
    (promo: Promotion) => {
      const promoLabel =
        promo.type === 'descuento'
          ? `${promo.name} (-${promo.discountPercent || 0}%)`
          : `${promo.name} (${promo.deliverQty || 2}x${promo.chargeQty || 1})`;
      const includedNote =
        promo.productNames && promo.productNames.length > 0
          ? `Incluye: ${promo.productNames.join(', ')}`
          : '';
      const resolvedDiner = activeDiner.trim();
      const promoItem: OrderItem = {
        productId: `promo_${promo.id}`,
        name: `[PROMO] ${promoLabel}`,
        basePrice: Number(promo.promoPrice) || 0,
        price: Number(promo.promoPrice) || 0,
        quantity: 1,
        notes: includedNote,
        ...(resolvedDiner ? { dinerName: resolvedDiner } : {}),
      };
      const targetSig = getItemSignature(promoItem);
      setOrderItems((prev) => {
        const idx = prev.findIndex((i) => getItemSignature(i) === targetSig);
        if (idx > -1) {
          return prev.map((it, i) =>
            i === idx ? { ...it, quantity: (Number(it.quantity) || 0) + 1 } : it
          );
        }
        return [...prev, promoItem];
      });
      setLastAddedId(`promo_${promo.id}`);
      if (lastAddedTimerRef.current) clearTimeout(lastAddedTimerRef.current);
      lastAddedTimerRef.current = setTimeout(() => setLastAddedId(null), 500);
    },
    [activeDiner]
  );

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      const next = !prev;
      if (typeof document !== 'undefined') {
        if (next) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        } else if (document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => {});
        }
      }
      return next;
    });
  }, []);

  const handleAddDinerSlot = useCallback(() => {
    setDinersList((prev) => {
      const nextNum = prev.length + 1;
      const newLabel = `Cliente ${nextNum}`;
      setActiveDiner(newLabel);
      return [...prev, newLabel];
    });
  }, []);

  const handleRenameDinerSlot = useCallback((slotIdx: number, newName: string) => {
    const clean = newName.trim();
    if (!clean) {
      setEditingDinerSlotIdx(null);
      return;
    }
    setDinersList((prev) => {
      const oldName = prev[slotIdx];
      const updated = prev.map((d, idx) => (idx === slotIdx ? clean : d));
      if (activeDiner === oldName) {
        setActiveDiner(clean);
      }
      setOrderItems((items) =>
        items.map((it) => (it.dinerName === oldName ? { ...it, dinerName: clean } : it))
      );
      return updated;
    });
    setEditingDinerSlotIdx(null);
    setDinerSlotRenameText('');
  }, [activeDiner]);

  const scrollCategoriesBy = (delta: number) => {
    if (categoryStripRef.current) {
      categoryStripRef.current.scrollBy({ left: delta, behavior: 'smooth' });
    }
  };

  if (!isOpen) return null;

  const persistCancellationToOrder = async (
    nextItems: OrderItem[],
    cancelledEntry: CancelledOrderItem
  ) => {
    const targetOrderId = activeOrderIdRef.current || activeOrderId;
    if (!targetOrderId) return;
    const now = new Date().toISOString();
    const updatedCancelled = [...existingCancelledItems, cancelledEntry];
    setExistingCancelledItems(updatedCancelled);

    // Also remove cancelled quantity from activeKitchenItems if present
    const updatedActiveKitchen = subtractChargedItems(existingActiveKitchenItems, [
      {
        productId: '',
        name: cancelledEntry.name,
        price: 0,
        quantity: cancelledEntry.quantity,
        dinerName: cancelledEntry.dinerName,
      },
    ]);
    // Fallback removal by name when productId isn't tracked on CancelledOrderItem
    let qtyToRemove = cancelledEntry.quantity;
    const prunedActiveKitchen: OrderItem[] = [];
    for (const kItem of existingActiveKitchenItems) {
      if (qtyToRemove > 0 && kItem.name === cancelledEntry.name) {
        const left = kItem.quantity - qtyToRemove;
        qtyToRemove = Math.max(0, qtyToRemove - kItem.quantity);
        if (left > 0) prunedActiveKitchen.push({ ...kItem, quantity: left });
      } else {
        prunedActiveKitchen.push(kItem);
      }
    }
    const finalActiveKitchen =
      updatedActiveKitchen.length < existingActiveKitchenItems.length
        ? updatedActiveKitchen
        : prunedActiveKitchen;
    setExistingActiveKitchenItems(finalActiveKitchen);

    const nextTotal = nextItems.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
    const isFullVoid = nextItems.length === 0;
    const isDomicilio = table.tableNumber === 0 || table.name === 'DOMICILIO';

    try {
      await commitOfflineSafe(
        updateDoc(doc(db, 'orders', targetOrderId), {
          items: nextItems,
          activeKitchenItems: isFullVoid ? [] : finalActiveKitchen,
          total: nextTotal,
          cancelledItems: updatedCancelled,
          cancellationReason: cancelledEntry.reason || '',
          authorizedBy: cancelledEntry.authorizedBy || '',
          ...(isFullVoid ? { status: 'Anulado' } : {}),
          updatedAt: now,
        }),
        'record_cancelled_item'
      );

      if (isFullVoid && !isDomicilio) {
        await commitOfflineSafe(
          Promise.all(
            unifiedTableIds.map((tid) =>
              setDoc(
                doc(db, 'tables', tid),
                {
                  status: 'Libre',
                  orderStatus: null,
                  currentOrderId: '',
                  total: 0,
                  itemCount: 0,
                  activeSince: '',
                  updatedAt: now,
                },
                { merge: true }
              )
            )
          ),
          'free_voided_table'
        );
      }
    } catch (e) {
      console.warn('Could not sync cancellation log:', e);
    }
  };

  const handleUpdateQuantity = (index: number, delta: number) => {
    // Aumentar cantidad está permitido libremente para agregar más platos a la mesa; solo reducir requiere autorización si ya se envió
    if (isSentToKitchen && delta < 0) {
      setAuthDescription(
        `La comanda de ${
          table.tableNumber === 0 ? 'DOMICILIO' : `la Mesa ${table.tableNumber}`
        } ya fue registrada. Reducir cantidades requiere clave de autorización y motivo.`
      );
      setPendingAuthAction(() => (reason?: string, authorizedBy?: string) => {
        performQuantityUpdate(index, delta, reason, authorizedBy);
      });
      setIsAdminAuthOpen(true);
      return;
    }

    performQuantityUpdate(index, delta);
  };

  const performQuantityUpdate = (
    index: number,
    delta: number,
    reason?: string,
    authorizedBy?: string
  ) => {
    const targetItem = orderItems[index];
    const nextItems = orderItems.map((item, idx) => {
      if (idx !== index) return item;
      const newQty = (Number(item.quantity) || 0) + delta;
      return newQty > 0 ? { ...item, quantity: newQty } : item;
    });
    setOrderItems(nextItems);

    if (isSentToKitchen && delta < 0 && targetItem) {
      void persistCancellationToOrder(nextItems, {
        name: targetItem.name,
        quantity: Math.abs(delta),
        dinerName: targetItem.dinerName,
        reason,
        authorizedBy,
        cancelledAt: new Date().toISOString(),
      });
    }
  };

  const handleDeleteItem = (index: number) => {
    if (isSentToKitchen) {
      setAuthDescription(
        `La comanda de la Mesa ${table.tableNumber} ya fue enviada a cocina. Eliminar el platillo "${orderItems[index]?.name}" requiere contraseña y motivo.`
      );
      setPendingAuthAction(() => (reason?: string, authorizedBy?: string) => {
        performDeleteItem(index, reason, authorizedBy);
      });
      setIsAdminAuthOpen(true);
      return;
    }

    performDeleteItem(index);
  };

  const performDeleteItem = (index: number, reason?: string, authorizedBy?: string) => {
    const removedItem = orderItems[index];
    const nextItems = orderItems.filter((_, i) => i !== index);
    setOrderItems(nextItems);

    if (isSentToKitchen && removedItem) {
      void persistCancellationToOrder(nextItems, {
        name: removedItem.name,
        quantity: Number(removedItem.quantity) || 1,
        dinerName: removedItem.dinerName,
        reason,
        authorizedBy,
        cancelledAt: new Date().toISOString(),
      });
    }
  };

  const handleOpenNoteEditor = (index: number) => {
    setEditingNoteItemIndex(index);
    setNoteInputText(orderItems[index]?.notes || '');
  };

  const handleSaveItemNote = () => {
    if (editingNoteItemIndex === null) return;
    const cleanNote = noteInputText.trim();
    const targetIdx = editingNoteItemIndex;
    setOrderItems((prev) =>
      prev.map((item, idx) => (idx === targetIdx ? { ...item, notes: cleanNote } : item))
    );
    setEditingNoteItemIndex(null);
    setNoteInputText('');
  };

  const handleOpenDinerEditor = (index: number) => {
    setEditingDinerItemIndex(index);
    setDinerInputText(orderItems[index]?.dinerName || '');
  };

  const handleSaveItemDiner = (customValue?: string) => {
    if (editingDinerItemIndex === null) return;
    const cleanDiner = (customValue !== undefined ? customValue : dinerInputText).trim();
    const targetIdx = editingDinerItemIndex;
    setOrderItems((prev) =>
      prev.map((item, idx) => (idx === targetIdx ? { ...item, dinerName: cleanDiner } : item))
    );
    setEditingDinerItemIndex(null);
    setDinerInputText('');
  };

  const handleToggleCustomOption = (
    groupId: string,
    optionName: string,
    allowMultiple?: boolean,
    isRequired?: boolean,
    isUnavailable?: boolean
  ) => {
    if (isUnavailable) {
      setCustomModalError(`La opción "${optionName}" está agotada / no disponible.`);
      return;
    }
    setCustomModalError(null);
    setSelectedOptionsByGroup((prev) => {
      const current = prev[groupId] || [];
      if (allowMultiple) {
        const exists = current.includes(optionName);
        return {
          ...prev,
          [groupId]: exists ? current.filter((n) => n !== optionName) : [...current, optionName],
        };
      }
      const already = current.includes(optionName);
      return {
        ...prev,
        [groupId]: already ? (isRequired ? [optionName] : []) : [optionName],
      };
    });
  };

  const handleOpenEditCartItem = (index: number) => {
    const item = orderItems[index];
    if (!item) return;
    const matchedProd = products.find((p) => p.id === item.productId);
    const resolvedProduct: Product = matchedProd || {
      id: item.productId,
      name: item.name,
      category: 'General',
      price: Number(item.basePrice ?? item.price) || 0,
      customizations: [],
      createdAt: '',
    };
    const initialMap: Record<string, string[]> = {};
    (resolvedProduct.customizations || []).forEach((grp) => {
      const picked = (item.selectedCustomizations || [])
        .filter((c) => c.groupName === grp.name)
        .map((c) => c.optionName);
      if (picked.length > 0) {
        initialMap[grp.id] = picked;
      }
    });
    setSelectedOptionsByGroup(initialMap);
    setCustomModalDiner(item.dinerName || '');
    setCustomModalNote(item.notes || '');
    setCustomModalError(null);
    setEditingCartItemIndex(index);
    setCustomizingProduct(resolvedProduct);
  };

  const handleConfirmCustomizedProduct = () => {
    const targetProduct = liveCustomizingProduct;
    if (!targetProduct) return;
    if (targetProduct.available === false && editingCartItemIndex === null) {
      setCustomModalError(`"${targetProduct.name}" fue marcado como Agotado / No disponible.`);
      return;
    }
    const missingRequired = (targetProduct.customizations || []).find(
      (group) => group.required && (selectedOptionsByGroup[group.id] || []).length === 0
    );
    if (missingRequired) {
      setCustomModalError(
        `Debes elegir al menos una opción en "${missingRequired.name}" (Obligatorio).`
      );
      return;
    }

    const chosen: OrderItemCustomization[] = [];
    for (const group of targetProduct.customizations || []) {
      const pickedNames = selectedOptionsByGroup[group.id] || [];
      for (const optName of pickedNames) {
        const optObj = (group.options || []).find((o) => o.name === optName);
        if (optObj) {
          if (optObj.available === false) {
            setCustomModalError(`La opción "${optObj.name}" está marcada como Agotada.`);
            return;
          }
          chosen.push({
            groupName: group.name,
            optionName: optObj.name,
            extraPrice: Number(optObj.extraPrice) || 0,
          });
        }
      }
    }

    if (editingCartItemIndex !== null) {
      const editIdx = editingCartItemIndex;
      const resolvedNote = customModalNote.trim();
      const resolvedDiner = customModalDiner.trim();
      const basePrice = Number(targetProduct.price) || 0;
      const extrasTotal = chosen.reduce((sum, c) => sum + (Number(c.extraPrice) || 0), 0);
      const unitPrice = basePrice + extrasTotal;

      setOrderItems((prev) =>
        prev.map((it, idx) => {
          if (idx !== editIdx) return it;
          const nextItem: OrderItem = {
            ...it,
            basePrice,
            price: unitPrice,
            notes: resolvedNote,
          };
          if (resolvedDiner) {
            nextItem.dinerName = resolvedDiner;
          } else {
            delete nextItem.dinerName;
          }
          if (chosen.length > 0) {
            nextItem.selectedCustomizations = chosen;
          } else {
            delete nextItem.selectedCustomizations;
          }
          return nextItem;
        })
      );
    } else {
      addItem(targetProduct, {
        selectedCustomizations: chosen,
        notes: customModalNote.trim(),
        dinerName: customModalDiner.trim() || activeDiner,
      });
    }

    setEditingCartItemIndex(null);
    setCustomizingProduct(null);
    setSelectedOptionsByGroup({});
    setCustomModalDiner('');
    setCustomModalNote('');
    setCustomModalError(null);
  };

  // Compute ONLY newly added products/quantities when updating an already-sent order
  const computeDeltaItems = (current: OrderItem[], previous: OrderItem[]): OrderItem[] => {
    const prevPool = new Map<string, number>();
    previous.forEach((item) => {
      const key = getItemSignature(item);
      prevPool.set(key, (prevPool.get(key) || 0) + item.quantity);
    });

    const deltas: OrderItem[] = [];
    current.forEach((item) => {
      const key = getItemSignature(item);
      const prevQty = prevPool.get(key) || 0;
      if (prevQty > 0) {
        if (item.quantity > prevQty) {
          deltas.push({ ...item, quantity: item.quantity - prevQty });
        }
        prevPool.set(key, Math.max(0, prevQty - item.quantity));
      } else {
        deltas.push({ ...item });
      }
    });
    return deltas;
  };

  // SEND TO KITCHEN (OPTIMISTIC UI — 0ms instant response): updates local state & closes modal immediately,
  // while Firestore persistence, recipe deduction, and kitchen printing run asynchronously in background.
  const handleSendToKitchen = () => {
    if (savingLockRef.current || isSaving) return;
    if (orderItems.length === 0) {
      setFeedback({ type: 'error', message: 'No hay productos en la comanda para enviar a cocina.' });
      return;
    }

    savingLockRef.current = true;
    setFeedback(null);

    const now = new Date().toISOString();
    const isDomicilio = table.tableNumber === 0 || table.name === 'DOMICILIO';
    const isUpdateBatch = isSentToKitchen;

    const currentItemsCopy = orderItems.map((i) => ({ ...i }));
    const deltaItems = isUpdateBatch
      ? computeDeltaItems(currentItemsCopy, sentItemsSnapshot)
      : currentItemsCopy.map((i) => ({ ...i }));
    const itemsToPrint = isUpdateBatch ? deltaItems : currentItemsCopy.map((i) => ({ ...i }));

    if (isUpdateBatch && deltaItems.length === 0) {
      savingLockRef.current = false;
      setFeedback({
        type: 'error',
        message: 'No hay platos nuevos agregados para reenviar a cocina.',
      });
      return;
    }

    // SOLO NUEVOS en Cocina: si el pedido anterior ya fue Entregado (o no quedan platos activos),
    // activeKitchenItems solo contiene los platos nuevos y reinicia el cronómetro; si aún está En Cocina, acumula solo los nuevos.
    const nextActiveKitchenItems = !isUpdateBatch
      ? currentItemsCopy.map((i) => ({ ...i }))
      : existingOrderStatus === 'Entregado' || existingActiveKitchenItems.length === 0
      ? deltaItems.map((i) => ({ ...i }))
      : mergeOrderItemLists(existingActiveKitchenItems, deltaItems);

    const kdsStartedAt =
      !isUpdateBatch || existingOrderStatus === 'Entregado' || existingActiveKitchenItems.length === 0
        ? now
        : existingSentToKitchenAt || now;

    const latestBatch: KitchenBatch = {
      batchNumber: existingKitchenBatches.length + 1,
      sentAt: now,
      isUpdate: isUpdateBatch,
      items: itemsToPrint,
      notes: generalOrderNotes.trim(),
    };
    const updatedBatches = [...existingKitchenBatches, latestBatch];

    const orderData: any = {
      tableNumber: table.tableNumber,
      tableId: table.id,
      tableName: displayTableTitle,
      ...(isUnifiedGroup
        ? {
            mergedTableIds: unifiedTableIds,
            mergedTableNumbers: unifiedTableNumbers,
          }
        : {}),
      branch: activeBranch,
      isDomicilio,
      orderType: isDomicilio ? 'DOMICILIO' : 'MESA',
      items: currentItemsCopy,
      activeKitchenItems: nextActiveKitchenItems,
      dinersList,
      total: ticketSubtotal,
      status: 'En Cocina',
      sentToKitchen: true,
      sentToKitchenAt: kdsStartedAt,
      latestKitchenBatch: latestBatch,
      kitchenBatches: updatedBatches,
      notes: generalOrderNotes,
      ...(isUpdateBatch
        ? { updatedBy: userProfile?.name || 'Personal' }
        : {
            waiterName: userProfile?.name || 'Personal',
            waiterUid: userProfile?.uid || '',
            waiterRole: userProfile?.role || 'Service Staff',
            updatedBy: userProfile?.name || 'Personal',
          }),
      createdAt: table.activeSince || now,
      updatedAt: now,
    };

    const existingId = activeOrderIdRef.current || activeOrderId || table.currentOrderId || null;
    const orderRef = existingId
      ? doc(db, 'orders', existingId)
      : doc(collection(db, 'orders'));
    const currentId = orderRef.id;
    activeOrderIdRef.current = currentId;

    // 1. Trigger Firestore optimistic writes synchronously (SDK updates onSnapshot cache immediately)
    const writes: Promise<any>[] = [setDoc(orderRef, orderData, { merge: true })];

    if (!isDomicilio) {
      unifiedTableIds.forEach((tid) => {
        writes.push(
          setDoc(
            doc(db, 'tables', tid),
            {
              branch: activeBranch,
              status: 'Ocupada',
              orderStatus: 'En Cocina',
              currentOrderId: currentId,
              total: ticketSubtotal,
              itemCount: totalDishCount,
              activeSince: table.activeSince || now,
              updatedAt: now,
            },
            { merge: true }
          )
        );
      });
    }

    // 2. Clear draft & close modal IMMEDIATELY for zero-lag Optimistic UI
    sentItemsSnapshotRef.current = currentItemsCopy;
    try {
      localStorage.removeItem(`gastrolab_draft_${activeBranch}_${table.id}`);
      localStorage.removeItem(`gastrolab_draft_${table.id}`);
    } catch {
      // Ignore
    }

    setIsMobileDrawerOpen(false);
    if (onTableUpdated) {
      onTableUpdated(
        isDomicilio
          ? isUpdateBatch
            ? 'Pedido a Domicilio actualizado en Cocina.'
            : 'Pedido a Domicilio enviado a Cocina.'
          : isUpdateBatch
          ? `${displayTableTitle} actualizada en Cocina.`
          : `Comanda de ${displayTableTitle} enviada a Cocina.`
      );
    }
    onClose();

    // 3. Complete persistence, inventory deduction & thermal print asynchronously in background
    const trimmedNotes = generalOrderNotes.trim();
    const targetTableLabel = displayTableTitle;
    const targetTableRefNum = isDomicilio ? 'DOMICILIO' : isUnifiedGroup ? displayTableTitle : table.tableNumber;

    void (async () => {
      try {
        await commitOfflineSafe(Promise.all(writes), 'send_to_kitchen');

        if (itemsToPrint.length > 0) {
          deductRecipeIngredientsFromInventory(itemsToPrint, targetTableRefNum, activeBranch).catch((deductErr) => {
            console.warn('Nota sobre deducción automática de recetas:', deductErr);
          });
        }

        if (itemsToPrint.length > 0 || trimmedNotes !== '') {
          printKitchenComanda({
            isDomicilio,
            tableLabel: targetTableLabel,
            isUpdate: isUpdateBatch,
            items: itemsToPrint,
            generalNotes: trimmedNotes,
            sentAt: now,
          }).catch(() => {});
        }
      } catch (err) {
        console.error('Error al sincronizar comanda en segundo plano:', err);
      } finally {
        savingLockRef.current = false;
      }
    })();
  };

  // Cobro and Precuenta modal states
  const [isCobroModalOpen, setIsCobroModalOpen] = useState(false);
  const [isPrecuentaOpen, setIsPrecuentaOpen] = useState(false);

  // PC/Laptop keyboard shortcuts for TableOrderModal
  useEffect(() => {
    if (!isOpen) return;
    const handleModalKeys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (customizingProduct) {
          setCustomizingProduct(null);
          setEditingCartItemIndex(null);
          return;
        }
        if (editingDinerItemIndex !== null) {
          setEditingDinerItemIndex(null);
          return;
        }
        if (editingNoteItemIndex !== null) {
          setEditingNoteItemIndex(null);
          return;
        }
        if (isPrecuentaOpen) {
          setIsPrecuentaOpen(false);
          return;
        }
        if (!isCobroModalOpen && !isAdminAuthOpen) {
          onClose();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === '/') {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleModalKeys);
    return () => window.removeEventListener('keydown', handleModalKeys);
  }, [
    isOpen,
    customizingProduct,
    editingDinerItemIndex,
    editingNoteItemIndex,
    isPrecuentaOpen,
    isCobroModalOpen,
    isAdminAuthOpen,
    onClose,
  ]);

  // Increment open CashShift & CashRegister counters accurately by payment method (branch-scoped + offline-safe)
  const recordSaleInOpenCashShift = async (
    method: 'Efectivo' | 'Tarjeta' | 'Transferencia' | 'De Una',
    amount: number,
    now: string
  ) => {
    try {
      const openShiftsSnap = await getDocsOfflineSafe(
        query(collection(db, 'cash_shifts'), where('status', '==', 'open'))
      );
      const branchShiftDoc = openShiftsSnap.docs.find((d) =>
        belongsToBranch((d.data() as any).branch, activeBranch)
      );
      if (!branchShiftDoc) return;

      const shiftData = branchShiftDoc.data() as any;

      const nextTotalSales = (shiftData.totalSales || 0) + amount;
      const nextCashSales =
        method === 'Efectivo' ? (shiftData.cashSales || 0) + amount : shiftData.cashSales || 0;
      const nextCardSales =
        method === 'Tarjeta' ? (shiftData.cardSales || 0) + amount : shiftData.cardSales || 0;
      const nextTransferSales =
        method === 'Transferencia'
          ? (shiftData.transferSales || 0) + amount
          : shiftData.transferSales || 0;
      const nextDeUnaSales =
        method === 'De Una' ? (shiftData.deUnaSales || 0) + amount : shiftData.deUnaSales || 0;
      const nextExpectedCash =
        method === 'Efectivo'
          ? (shiftData.expectedCash ?? shiftData.initialCash ?? 0) + amount
          : shiftData.expectedCash ?? shiftData.initialCash ?? 0;

      await commitOfflineSafe(
        updateDoc(doc(db, 'cash_shifts', branchShiftDoc.id), {
          totalSales: nextTotalSales,
          cashSales: nextCashSales,
          cardSales: nextCardSales,
          transferSales: nextTransferSales,
          deUnaSales: nextDeUnaSales,
          expectedCash: nextExpectedCash,
          updatedAt: now,
        }),
        'update_shift_sale'
      );

      if (shiftData.registerId) {
        const regRef = doc(db, 'cash_registers', shiftData.registerId);
        const regSnap = await getDocOfflineSafe(regRef);
        if (regSnap && regSnap.exists()) {
          const regTotal = (regSnap.data().totalSales || 0) + amount;
          await commitOfflineSafe(
            updateDoc(regRef, { totalSales: regTotal, updatedAt: now }),
            'update_register_sale'
          );
        }
      }
    } catch (shiftErr) {
      console.warn('Nota al actualizar turno de caja activo:', shiftErr);
    }
  };

  // Subtract paid items for Cobro Personalizado partial payments
  const subtractChargedItems = (allItems: OrderItem[], paidItems: OrderItem[]): OrderItem[] => {
    const paidPool = new Map<string, number>();
    paidItems.forEach((p) => {
      const key = getItemSignature(p);
      paidPool.set(key, (paidPool.get(key) || 0) + p.quantity);
    });

    const remaining: OrderItem[] = [];
    allItems.forEach((item) => {
      const key = getItemSignature(item);
      const toDeduct = paidPool.get(key) || 0;
      if (toDeduct > 0) {
        const left = item.quantity - toDeduct;
        paidPool.set(key, Math.max(0, toDeduct - item.quantity));
        if (left > 0) {
          remaining.push({ ...item, quantity: left });
        }
      } else {
        remaining.push({ ...item });
      }
    });
    return remaining;
  };

  // Cobrar y Liberar Mesa (o Cobro Personalizado Parcial) con confirmación
  const handleConfirmPayment = async (paymentData: {
    method: 'Efectivo' | 'Tarjeta' | 'Transferencia' | 'De Una';
    receivedAmount: number;
    changeAmount: number;
    clientName: string;
    clientId: string;
    clientEmail?: string;
    clientAddress?: string;
    clientPhone?: string;
    discountPercent?: number;
    isCourtesy?: boolean;
    tipAmount?: number;
    splitParts?: number;
    chargedItems?: OrderItem[];
    chargedTotal?: number;
    isCustomPartial?: boolean;
  }): Promise<{ invoice: ElectronicInvoiceRecord; isFullSettlement: boolean }> => {
    if (savingLockRef.current) {
      throw new Error('Operación de cobro en curso, espera un momento.');
    }
    savingLockRef.current = true;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const isDomicilio = table.tableNumber === 0 || table.name === 'DOMICILIO';
      const itemsPaid =
        paymentData.chargedItems && paymentData.chargedItems.length > 0
          ? paymentData.chargedItems
          : orderItems;

      const discountPct = paymentData.discountPercent || 0;
      const grossPaid = itemsPaid.reduce((acc, i) => acc + i.price * i.quantity, 0);
      const fallbackFinalTotal = paymentData.isCourtesy
        ? 0
        : Math.max(0, grossPaid * (1 - discountPct / 100));
      const finalTotal =
        paymentData.chargedTotal !== undefined ? paymentData.chargedTotal : fallbackFinalTotal;
      const tipAmt = paymentData.isCourtesy ? 0 : Math.max(0, Number(paymentData.tipAmount) || 0);

      const safeIva =
        Number.isFinite(storeSettings.ivaPercentage) && storeSettings.ivaPercentage >= 0
          ? storeSettings.ivaPercentage
          : 15;

      // Build invoice payload upfront so order, table, and invoice writes run concurrently
      const buildInvoiceEntry = (): { docRef: ReturnType<typeof doc>; record: ElectronicInvoiceRecord } => {
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        const subtotalNet = finalTotal / (1 + safeIva / 100);
        const ivaAmt = finalTotal - subtotalNet;
        const discountAmt = paymentData.isCourtesy
          ? grossPaid
          : Math.max(0, (grossPaid * discountPct) / 100);
        const secStr = String(Date.now()).slice(-9).padStart(9, '0');
        const isConsumidorFinal =
          paymentData.clientId === '9999999999999' ||
          paymentData.clientName.trim().toUpperCase() === 'CONSUMIDOR FINAL';

        const claveAcceso = isConsumidorFinal
          ? `TICKET-INTERNO-${secStr}`
          : generateClaveDeAcceso(
              secStr,
              storeSettings.ruc,
              new Date(now)
            );
        const invoiceNumber = `001-001-${secStr}`;

        const invoicePayload: ElectronicInvoiceRecord & { branch: string } = {
          invoiceNumber,
          claveAcceso,
          date: now,
          status: isConsumidorFinal
            ? 'TICKET_INTERNO'
            : isOnline
            ? 'AUTORIZADO'
            : 'PENDIENTE_ENVIO_OFFLINE',
          isInternalTicket: isConsumidorFinal,
          sriAuthorizationNumber: isConsumidorFinal ? '' : claveAcceso,
          sriAuthorizationDate: isConsumidorFinal ? null : isOnline ? now : null,
          client: {
            docType: isConsumidorFinal
              ? 'Consumidor Final'
              : paymentData.clientId.length === 13
              ? 'RUC'
              : 'Cédula',
            docNumber: isConsumidorFinal ? '9999999999999' : paymentData.clientId,
            name: isConsumidorFinal ? 'CONSUMIDOR FINAL' : paymentData.clientName,
            email: paymentData.clientEmail || '',
            address: paymentData.clientAddress || '',
            phone: paymentData.clientPhone || '',
          },
          reference: displayTableTitle,
          paymentMethod: paymentData.method,
          subtotal: subtotalNet,
          ivaRate: safeIva,
          ivaAmount: ivaAmt,
          discountAmount: discountAmt,
          total: finalTotal,
          items: itemsPaid,
          branch: activeBranch,
          createdAt: now,
        };

        const docRef = doc(collection(db, 'electronic_invoices'));
        return { docRef, record: { id: docRef.id, ...invoicePayload } };
      };

      // Check if Cobro Personalizado leaves unpaid items remaining on the table
      if (paymentData.isCustomPartial && paymentData.chargedItems?.length) {
        const remainingItems = subtractChargedItems(orderItems, paymentData.chargedItems);
        if (remainingItems.length > 0) {
          const remainingTotal = remainingItems.reduce((acc, i) => acc + i.price * i.quantity, 0);
          const { docRef: invRef, record: issuedInvoice } = buildInvoiceEntry();

          const partialWrites: Promise<any>[] = [setDoc(invRef, issuedInvoice)];
          if (activeOrderId) {
            partialWrites.push(
              updateDoc(doc(db, 'orders', activeOrderId), {
                items: remainingItems,
                total: remainingTotal,
                updatedAt: now,
              })
            );
          }
          if (!isDomicilio) {
            const remCount = remainingItems.reduce((acc, i) => acc + i.quantity, 0);
            unifiedTableIds.forEach((tid) => {
              partialWrites.push(
                setDoc(
                  doc(db, 'tables', tid),
                  {
                    branch: activeBranch,
                    status: 'Ocupada',
                    currentOrderId: activeOrderId || '',
                    total: remainingTotal,
                    itemCount: remCount,
                    updatedAt: now,
                  },
                  { merge: true }
                )
              );
            });
          }

          await Promise.all([
            commitOfflineSafe(Promise.all(partialWrites), 'partial_checkout_batch'),
            recordSaleInOpenCashShift(paymentData.method, finalTotal + tipAmt, now),
          ]);

          setOrderItems(remainingItems);
          setSentItemsSnapshot(remainingItems.map((i) => ({ ...i })));
          setFeedback({
            type: 'success',
            message: `Cobro personalizado por $${(finalTotal + tipAmt).toFixed(2)} (${paymentData.method}) registrado. Saldo pendiente en mesa: $${remainingTotal.toFixed(2)}.`,
          });
          fullSettlementDoneRef.current = false;
          justPaidBroadcastRef.current = true;
          if (onTableUpdated) onTableUpdated();
          return { invoice: issuedInvoice, isFullSettlement: false };
        }
      }

      // Full payment or final remaining payment: close order & free ALL unified tables concurrently
      const targetOrderId = activeOrderIdRef.current || activeOrderId;
      const { docRef: invRef, record: issuedInvoice } = buildInvoiceEntry();
      const fullWrites: Promise<any>[] = [setDoc(invRef, issuedInvoice)];

      if (targetOrderId) {
        fullWrites.push(
          updateDoc(doc(db, 'orders', targetOrderId), {
            status: 'Cobrado',
            paymentMethod: paymentData.method,
            receivedAmount: paymentData.receivedAmount,
            changeAmount: paymentData.changeAmount,
            tipAmount: tipAmt,
            clientName: paymentData.clientName,
            clientId: paymentData.clientId,
            collectedBy: userProfile?.name || 'Cajero',
            paidAt: now,
            updatedAt: now,
          })
        );
      }

      if (!isDomicilio) {
        unifiedTableIds.forEach((tid) => {
          fullWrites.push(
            setDoc(
              doc(db, 'tables', tid),
              {
                branch: activeBranch,
                status: 'Libre',
                orderStatus: null,
                currentOrderId: '',
                total: 0,
                itemCount: 0,
                activeSince: '',
                updatedAt: now,
              },
              { merge: true }
            )
          );
        });
      }

      await commitOfflineSafe(Promise.all(fullWrites), 'full_checkout_batch');
      void recordSaleInOpenCashShift(paymentData.method, finalTotal + tipAmt, now);

      // If Domicilio order: deduct delivery packing supplies in background
      if (isDomicilio) {
        void deductDeliverySuppliesFromInventory(itemsPaid, activeBranch).catch((suppliesErr) => {
          console.warn('Error al descontar insumos de empaque de domicilio:', suppliesErr);
        });
      }

      try {
        localStorage.removeItem(`gastrolab_draft_${activeBranch}_${table.id}`);
        localStorage.removeItem(`gastrolab_draft_${table.id}`);
      } catch {
        // Ignore
      }

      // Reset all modal/ticket state cleanly so reopening any table never shows stale data
      setOrderItems([]);
      setSentItemsSnapshot([]);
      sentItemsSnapshotRef.current = [];
      setExistingKitchenBatches([]);
      setActiveOrderId(null);
      activeOrderIdRef.current = null;
      setIsSentToKitchen(false);
      setGeneralOrderNotes('');
      setIsMobileDrawerOpen(false);

      fullSettlementDoneRef.current = true;
      justPaidBroadcastRef.current = true;
      if (onTableUpdated) onTableUpdated();
      return { invoice: issuedInvoice, isFullSettlement: true };
    } catch (err: any) {
      console.error('Error al liberar mesa con cobro:', err);
      setFeedback({ type: 'error', message: err?.message || 'No se pudo registrar el cobro y liberar la mesa.' });
      throw err;
    } finally {
      savingLockRef.current = false;
      setIsSaving(false);
    }
  };

  const handleAdminAuthorized = async (reason: string, authorizedByEmail: string) => {
    if (activeOrderId) {
      try {
        await updateDoc(doc(db, 'orders', activeOrderId), {
          cancellationReason: reason,
          authorizedBy: authorizedByEmail,
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('Could not log auth reason:', e);
      }
    }

    if (pendingAuthAction) {
      pendingAuthAction(reason, authorizedByEmail);
      setPendingAuthAction(null);
    }
    setFeedback({
      type: 'success',
      message: `Autorización concedida por ${authorizedByEmail}.`,
    });
  };

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-[80] bg-white flex flex-col overflow-hidden text-gray-900'
          : 'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 lg:p-6 overflow-hidden text-gray-900'
      }
    >
      {/* Central Modal Container in Light Theme (expands 100% when Ver Pantalla Completa is active) */}
      <div
        className={
          isFullscreen
            ? 'w-full h-full bg-white flex flex-col overflow-hidden relative'
            : 'w-full max-w-6xl h-[94vh] sm:h-[92vh] bg-white border border-gray-200 rounded-3xl shadow-2xl flex flex-col overflow-hidden relative'
        }
      >
        {/* Modal Top Header */}
        <div className="px-3.5 sm:px-5 py-3 sm:py-4 border-b border-gray-200 bg-gray-50/80 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23] font-mono font-black text-base sm:text-lg shadow-xs shrink-0">
              {table.tableNumber === 0 ? '🛵' : table.tableNumber}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-extrabold text-gray-900 truncate">
                  {displayTableTitle}
                </h3>
                {isUnifiedGroup && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300">
                    Unificadas ({unifiedTableNumbers.length})
                  </span>
                )}
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                    table.status === 'Ocupada'
                      ? 'bg-rose-50 text-rose-700 border-rose-300'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  }`}
                >
                  {table.status}
                </span>
              </div>
              <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5 truncate">
                <Clock className="w-3 h-3 text-[#4A5D23] shrink-0" />
                {table.activeSince
                  ? `Comanda abierta hace ${Math.max(
                      1,
                      Math.round((Date.now() - new Date(table.activeSince).getTime()) / 60000)
                    )} min`
                  : 'Mesa lista para nueva orden'}
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-1.5 sm:gap-2 ml-auto">
            {(orderItems.length > 0 || table.status === 'Ocupada') && (
              <>
                <button
                  type="button"
                  onClick={() => setIsPrecuentaOpen(true)}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-[#D97706]/50 text-amber-900 text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-xs"
                  title="Imprimir precuenta para solicitar datos al cliente"
                >
                  <Printer className="w-3 h-3 text-[#D97706]" />
                  <span>Precuenta</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsCobroModalOpen(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                >
                  <Receipt className="w-3.5 h-3.5 text-[#E89E2D]" />
                  Cobrar
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              title="Cerrar ventana"
              className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Feedback Alert Bar */}
        {feedback && (
          <div
            className={`px-5 py-2.5 text-xs flex items-center justify-between border-b ${
              feedback.type === 'success'
                ? 'bg-[#EAF5F0] border-[#4A5D23]/30 text-[#4A5D23]'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600" />
              )}
              <span className="font-semibold">{feedback.message}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="font-bold hover:underline cursor-pointer ml-3"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Modal Main Body: 2 Columns */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* LEFT: Menu (Carta) Products Catalog */}
          <div className="flex-1 min-w-0 flex flex-col p-4 sm:p-5 overflow-hidden border-b lg:border-b-0 lg:border-r border-gray-200">
            {/* Catalog controls: Ver Pantalla Completa + Search bar on top, Categorías con scroll horizontal debajo */}
            <div className="space-y-2.5 mb-3 shrink-0">
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full">
                <button
                  type="button"
                  onClick={handleToggleFullscreen}
                  className={`px-3 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shrink-0 border transition-all cursor-pointer shadow-xs ${
                    isFullscreen
                      ? 'bg-[#E89E2D] text-slate-950 border-[#D97706]'
                      : 'bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white border-[#4A5D23]/30'
                  }`}
                  title={isFullscreen ? 'Salir de Pantalla Completa' : 'Ver Pantalla Completa'}
                >
                  {isFullscreen ? (
                    <>
                      <Minimize2 className="w-4 h-4 shrink-0" />
                      <span>Salir de Pantalla Completa</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-4 h-4 shrink-0" />
                      <span>Ver Pantalla Completa</span>
                    </>
                  )}
                </button>

                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    data-enter-action="custom"
                    placeholder="Buscar en la Carta... (Ctrl+K o / · Enter para agregar)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchQuery.trim() && filteredProducts.length > 0) {
                        e.preventDefault();
                        handleAddProductToTicket(filteredProducts[0]);
                      }
                    }}
                    className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl pl-10 pr-9 py-2.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none transition-colors"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer"
                      title="Limpiar búsqueda"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Categorías with horizontal scroll & left/right scroll buttons so text never clips */}
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 shrink-0">
                  Categorías:
                </span>
                <button
                  type="button"
                  onClick={() => scrollCategoriesBy(-180)}
                  className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 shrink-0 cursor-pointer"
                  title="Desplazar categorías a la izquierda"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <div
                  ref={categoryStripRef}
                  className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto py-0.5 scroll-smooth"
                  style={{ scrollbarWidth: 'thin' }}
                >
                  {categories.map((cat) => (
                    <button
                      type="button"
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1 ${
                        selectedCategory === cat
                          ? cat === 'Promociones'
                            ? 'bg-[#E89E2D] text-slate-950 shadow-xs'
                            : 'bg-[#4A5D23] text-white shadow-xs'
                          : cat === 'Promociones'
                          ? 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {cat === 'Promociones' && <Tag className="w-3 h-3" />}
                      {cat}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => scrollCategoriesBy(180)}
                  className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 shrink-0 cursor-pointer"
                  title="Desplazar categorías a la derecha"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Accesos Rápidos PROMOCIONES y COMBOS directamente debajo de las categorías */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCategory(
                      selectedCategory === 'Promociones' ? 'Todos' : 'Promociones'
                    )
                  }
                  className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-xs cursor-pointer border ${
                    selectedCategory === 'Promociones'
                      ? 'bg-[#E89E2D] text-slate-950 border-[#D97706] ring-2 ring-[#E89E2D]/40'
                      : 'bg-amber-50 hover:bg-amber-100 text-amber-950 border-[#E89E2D]/60'
                  }`}
                >
                  <Tag className="w-3.5 h-3.5 shrink-0" />
                  <span>PROMOCIONES</span>
                  <span className="px-1.5 py-0.5 rounded-md bg-white/80 text-[10px] font-mono font-black text-amber-950">
                    {activePromotions.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setSelectedCategory(selectedCategory === 'Combos' ? 'Todos' : 'Combos')
                  }
                  className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-xs cursor-pointer border ${
                    selectedCategory === 'Combos'
                      ? 'bg-[#4A5D23] text-white border-[#3a4a1a] ring-2 ring-[#4A5D23]/30'
                      : 'bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white border-[#4A5D23]/40'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>COMBOS</span>
                  <span className="px-1.5 py-0.5 rounded-md bg-white/90 text-[10px] font-mono font-black text-[#4A5D23]">
                    {comboProductsCount}
                  </span>
                </button>
              </div>

              {/* Quick Comensal Bar on Mobile / Tablet directly above product grid */}
              <div className="lg:hidden flex flex-wrap items-center gap-1.5 p-2 rounded-xl bg-[#F8F9FA] border border-gray-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#4A5D23] flex items-center gap-1 shrink-0">
                  <Users className="w-3 h-3" />
                  Comensal:
                </span>
                {dinersList.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setActiveDiner(activeDiner === preset ? '' : preset)}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border cursor-pointer ${
                      activeDiner === preset
                        ? 'bg-[#4A5D23] text-white border-[#4A5D23]'
                        : 'bg-white text-gray-700 border-gray-200'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleAddDinerSlot}
                  className="px-2 py-0.5 rounded-lg text-[10px] font-black border border-[#4A5D23]/40 bg-[#EAF5F0] text-[#4A5D23] cursor-pointer"
                  title="Añadir otro comensal"
                >
                  +
                </button>
                <input
                  type="text"
                  placeholder="Nombre comensal..."
                  value={activeDiner}
                  onChange={(e) => setActiveDiner(e.target.value)}
                  className="flex-1 min-w-[90px] bg-white border border-gray-200 focus:border-[#4A5D23] rounded-lg px-2 py-0.5 text-[11px] text-gray-900 placeholder-gray-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Products & Active Promotions Grid */}
            <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 pr-1 pb-16 lg:pb-0 content-start">
              {/* Active Promotions from Carta -> Promociones */}
              {filteredPromotions.map((promo) => {
                const promoKey = `promo_${promo.id}`;
                const isJustAdded = lastAddedId === promoKey;
                const inTicketCount = inTicketCountMap.get(promoKey) || 0;
                return (
                  <div
                    key={promoKey}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleAddPromotionToTicket(promo)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleAddPromotionToTicket(promo);
                      }
                    }}
                    className={`p-3 rounded-2xl border-2 transition-all duration-150 flex flex-col justify-between group relative shadow-xs cursor-pointer active:scale-95 hover:shadow-md ${
                      isJustAdded
                        ? 'bg-amber-50 border-[#E89E2D] ring-2 ring-[#E89E2D]/50'
                        : 'bg-gradient-to-br from-amber-50/90 to-white border-[#E89E2D]/70 hover:border-[#E89E2D]'
                    }`}
                  >
                    {inTicketCount > 0 && (
                      <span className="absolute top-2 right-2 z-10 bg-[#4A5D23] text-white font-black text-[10px] px-2 py-0.5 rounded-full shadow-xs">
                        x{inTicketCount}
                      </span>
                    )}
                    <div>
                      <div className="flex items-center gap-1 flex-wrap mb-1">
                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-[#E89E2D] text-slate-950 flex items-center gap-0.5">
                          <Tag className="w-2.5 h-2.5" />
                          {promo.type === 'descuento'
                            ? `PROMO -${promo.discountPercent || 0}%`
                            : `PROMO ${promo.deliverQty || 2}x${promo.chargeQty || 1}`}
                        </span>
                      </div>
                      <h5 className="font-extrabold text-xs text-gray-900 line-clamp-2 leading-tight">
                        {promo.name}
                      </h5>
                      {promo.productNames && promo.productNames.length > 0 && (
                        <p className="text-[10px] text-gray-600 mt-1 line-clamp-2">
                          {promo.productNames.join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="mt-2 pt-2 border-t border-amber-200/70 flex items-center justify-between gap-1">
                      <div>
                        {promo.type === 'descuento' && promo.grossPrice !== undefined && (
                          <span className="text-[10px] text-gray-400 line-through font-mono mr-1">
                            ${Number(promo.grossPrice).toFixed(2)}
                          </span>
                        )}
                        <span className="font-mono font-black text-sm text-[#D97706]">
                          ${Number(promo.promoPrice || 0).toFixed(2)}
                        </span>
                      </div>
                      <span className="text-[10px] bg-[#4A5D23] text-white px-2 py-0.5 rounded flex items-center gap-0.5 font-bold">
                        <Plus className="w-3 h-3 text-[#E89E2D]" />
                        Promo
                      </span>
                    </div>
                  </div>
                );
              })}

              {filteredProducts.map((prod) => {
                const isJustAdded = lastAddedId === prod.id;
                const isUnavailable = prod.available === false;
                const inTicketCount = inTicketCountMap.get(prod.id) || 0;
                const linkedPromo = promoByProductId.get(prod.id);

                return (
                  <div
                    key={prod.id}
                    role="button"
                    aria-disabled={isUnavailable}
                    tabIndex={isUnavailable ? -1 : 0}
                    onClick={() => handleAddProductToTicket(prod)}
                    onKeyDown={(e) => {
                      if (!isUnavailable && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        handleAddProductToTicket(prod);
                      }
                    }}
                    className={`p-3 rounded-2xl border transition-all duration-150 flex flex-col justify-between group relative shadow-xs focus:outline-none ${
                      isUnavailable
                        ? 'bg-rose-50/50 border-rose-200 opacity-65 cursor-not-allowed'
                        : isJustAdded
                        ? 'bg-amber-50/20 border-[#E89E2D] ring-2 ring-[#E89E2D]/50 cursor-pointer active:scale-95 hover:shadow-md focus:ring-2 focus:ring-[#4A5D23]'
                        : inTicketCount > 0
                        ? 'bg-white border-[#4A5D23] ring-1 ring-[#4A5D23] cursor-pointer active:scale-95 hover:shadow-md focus:ring-2 focus:ring-[#4A5D23]'
                        : 'bg-white border-gray-200 hover:border-[#4A5D23] cursor-pointer active:scale-95 hover:shadow-md focus:ring-2 focus:ring-[#4A5D23]'
                    }`}
                  >
                    {isUnavailable ? (
                      <span className="absolute top-2 right-2 z-10 bg-rose-600 text-white font-black text-[9px] uppercase px-2 py-0.5 rounded-full shadow-xs">
                        Agotado
                      </span>
                    ) : (
                      inTicketCount > 0 && (
                        <span className="absolute top-2 right-2 z-10 bg-[#E89E2D] text-slate-950 font-black text-[10px] px-2 py-0.5 rounded-full shadow-xs">
                          x{inTicketCount}
                        </span>
                      )
                    )}

                    {prod.imageUrl && (
                      <div className="w-full h-24 rounded-xl overflow-hidden mb-2 bg-gray-100 border border-gray-100">
                        <img
                          src={prod.imageUrl}
                          alt={prod.name}
                          className={`w-full h-full object-cover transition-transform ${
                            isUnavailable ? 'grayscale' : 'group-hover:scale-105'
                          }`}
                        />
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[9px] uppercase font-bold text-[#4A5D23] tracking-wider block truncate">
                          {prod.category}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {linkedPromo && (
                            <span className="text-[8px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded">
                              Promo
                            </span>
                          )}
                          {prod.customizations && prod.customizations.length > 0 && (
                            <span className="text-[8px] font-black uppercase bg-[#EAF5F0] text-[#4A5D23] border border-[#4A5D23]/30 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                              <SlidersHorizontal className="w-2.5 h-2.5 text-[#E89E2D]" />
                              Opciones
                            </span>
                          )}
                          {prod.isCombo && (
                            <span className="text-[8px] font-black uppercase bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded shrink-0">
                              Combo
                            </span>
                          )}
                        </div>
                      </div>
                      <h5
                        className={`font-bold text-xs line-clamp-2 leading-tight mt-0.5 ${
                          isUnavailable ? 'text-rose-900 line-through' : 'text-gray-900'
                        }`}
                      >
                        {prod.name}
                      </h5>
                    </div>

                    <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
                      <span className="font-mono font-black text-sm text-[#E89E2D]">
                        ${prod.price.toFixed(2)}
                      </span>
                      {isUnavailable ? (
                        <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded font-bold uppercase">
                          No disp.
                        </span>
                      ) : (
                        <span className="text-[10px] bg-[#EAF5F0] group-hover:bg-[#4A5D23] text-[#4A5D23] group-hover:text-white px-2 py-0.5 rounded transition-colors flex items-center gap-0.5 font-bold">
                          <Plus className="w-3 h-3 text-[#E89E2D]" />
                          {prod.customizations && prod.customizations.length > 0 ? 'Elegir' : 'Agregar'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DESKTOP TICKET: Visible on lg screens */}
          <div className="hidden lg:flex lg:w-96 flex-col p-4 sm:p-5 bg-gray-50/70 overflow-hidden shrink-0">
            <div className="flex items-center justify-between pb-2.5 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <ChefHat className="w-5 h-5 text-[#E89E2D]" />
                <h4 className="font-bold text-gray-900 text-sm">Ticket de Comanda</h4>
              </div>
              <span className="font-mono text-xs text-gray-600 font-bold">
                {totalDishCount} platillos
              </span>
            </div>

            {/* Asignar a Comensal Activo (5 presets + botón '+' para añadir + edición de nombres) */}
            <div className="mt-2.5 p-2.5 rounded-2xl bg-white border border-gray-200 space-y-1.5 shrink-0">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-gray-600">
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3 text-[#4A5D23]" />
                  Comensales ({dinersList.length}):
                </span>
                <div className="flex items-center gap-2">
                  {activeDiner && (
                    <button
                      type="button"
                      onClick={() => setActiveDiner('')}
                      className="text-rose-600 hover:underline font-bold cursor-pointer"
                    >
                      Quitar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleAddDinerSlot}
                    className="px-1.5 py-0.5 rounded-md bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white border border-[#4A5D23]/30 font-black cursor-pointer"
                    title="Añadir nuevo comensal"
                  >
                    + Comensal
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {dinersList.map((preset, sIdx) => (
                  <div key={`${preset}_${sIdx}`} className="inline-flex items-center">
                    {editingDinerSlotIdx === sIdx ? (
                      <div className="inline-flex items-center gap-1 bg-amber-50 border border-[#E89E2D] rounded-lg px-1.5 py-0.5">
                        <input
                          type="text"
                          value={dinerSlotRenameText}
                          onChange={(e) => setDinerSlotRenameText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleRenameDinerSlot(sIdx, dinerSlotRenameText);
                            } else if (e.key === 'Escape') {
                              setEditingDinerSlotIdx(null);
                            }
                          }}
                          autoFocus
                          placeholder="Nombre..."
                          className="w-20 text-[10px] font-bold bg-white border border-gray-200 rounded px-1 py-0.5 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleRenameDinerSlot(sIdx, dinerSlotRenameText)}
                          className="text-[10px] font-black text-[#4A5D23] cursor-pointer"
                        >
                          OK
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`inline-flex items-center rounded-lg border overflow-hidden ${
                          activeDiner === preset
                            ? 'bg-[#4A5D23] text-white border-[#4A5D23]'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveDiner(activeDiner === preset ? '' : preset)}
                          className="px-2 py-0.5 text-[10px] font-bold cursor-pointer"
                        >
                          {preset}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDinerSlotIdx(sIdx);
                            setDinerSlotRenameText(preset);
                          }}
                          className={`pr-1.5 pl-0.5 py-0.5 cursor-pointer ${
                            activeDiner === preset ? 'text-[#E89E2D]' : 'text-gray-400 hover:text-[#4A5D23]'
                          }`}
                          title="Editar nombre del comensal"
                        >
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <input
                type="text"
                placeholder="Escribir nombre personalizado (vacío = general)"
                value={activeDiner}
                onChange={(e) => setActiveDiner(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] focus:bg-white rounded-xl px-2.5 py-1 text-[11px] text-gray-900 placeholder-gray-400 focus:outline-none"
              />
            </div>

            {/* Ticket Items List */}
            <div className="flex-1 overflow-y-auto my-2.5 space-y-2.5 pr-1">
              {orderItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-400">
                  <UtensilsCrossed className="w-10 h-10 text-[#4A5D23]/30 mb-2" />
                  <p className="text-xs font-semibold text-gray-700">Comanda vacía</p>
                  <p className="text-[11px] text-gray-500 mt-1 max-w-[200px]">
                    Toca los productos de la Carta para agregarlos {table.tableNumber === 0 ? 'al pedido de DOMICILIO' : `a la Mesa ${table.tableNumber}`}.
                  </p>
                </div>
              ) : (
                orderItems.map((item, index) => (
                  <div
                    key={`${item.productId}_${index}`}
                    className="p-3 rounded-2xl bg-white border border-gray-200 flex flex-col gap-1.5 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h6 className="font-bold text-xs text-gray-900 truncate">{item.name}</h6>
                          {item.dinerName && (
                            <span className="px-1.5 py-0.5 rounded-md bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-[9px] font-black uppercase">
                              {item.dinerName}
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[11px] font-bold text-[#E89E2D]">
                          ${(item.price * item.quantity).toFixed(2)}{' '}
                          <span className="text-[10px] text-gray-500 font-normal">
                            (${item.price.toFixed(2)} c/u)
                          </span>
                        </span>

                        {item.selectedCustomizations && item.selectedCustomizations.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.selectedCustomizations.map((c, cIdx) => (
                              <span
                                key={cIdx}
                                className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[9px] font-bold text-amber-900"
                              >
                                {c.optionName}
                                {c.extraPrice > 0 ? ` (+$${Number(c.extraPrice).toFixed(2)})` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Quantity Controls & Delete */}
                      <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-200 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(index, -1)}
                          className="w-6 h-6 rounded-lg bg-white text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-5 text-center font-mono font-bold text-xs text-gray-900">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(index, 1)}
                          className="w-6 h-6 rounded-lg bg-[#4A5D23] hover:bg-[#3d4d1d] text-white flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteItem(index)}
                          className="w-6 h-6 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition-colors ml-1 cursor-pointer"
                          title={isSentToKitchen ? 'Requiere clave para anular plato' : 'Eliminar plato'}
                        >
                          <Trash2 className="w-3 h-3 text-rose-600" />
                        </button>
                      </div>
                    </div>

                    {/* Custom Note & Assign Diner Display / Edit */}
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] pt-1.5 border-t border-gray-100">
                      <div className="min-w-0 flex-1">
                        {item.notes ? (
                          <span className="text-amber-800 italic flex items-center gap-1 truncate font-medium">
                            <MessageSquare className="w-3 h-3 shrink-0 text-[#E89E2D]" />
                            "{item.notes}"
                          </span>
                        ) : (
                          <span className="text-gray-400 text-[10px]">Sin notas</span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {unsentEditableIndices.has(index) && !item.productId.startsWith('promo_') && (
                          <button
                            type="button"
                            onClick={() => handleOpenEditCartItem(index)}
                            className="text-[10px] text-[#4A5D23] bg-[#EAF5F0] hover:bg-[#4A5D23] hover:text-white px-2 py-0.5 rounded-md font-bold cursor-pointer flex items-center gap-1 transition-colors"
                            title="Editar salsas, extras, comensal o nota antes de enviar a cocina"
                          >
                            <SlidersHorizontal className="w-3 h-3" />
                            Editar Extras
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenDinerEditor(index)}
                          className="text-[10px] text-amber-800 hover:underline font-bold cursor-pointer flex items-center gap-0.5"
                        >
                          <Users className="w-3 h-3 text-[#E89E2D]" />
                          {item.dinerName ? 'Cambiar Comensal' : 'Asignar a Comensal'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenNoteEditor(index)}
                          className="text-[10px] text-[#4A5D23] hover:underline font-bold cursor-pointer"
                        >
                          {item.notes ? 'Editar Nota' : '+ Nota'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Inline Note Editor */}
            {editingNoteItemIndex !== null && (
              <div className="p-3 mb-3 bg-white border-2 border-[#E89E2D] rounded-2xl shadow-md animate-scale-in">
                <div className="flex items-center justify-between mb-1.5 text-xs font-bold text-gray-900">
                  <span>Nota para: {orderItems[editingNoteItemIndex]?.name}</span>
                  <button onClick={() => setEditingNoteItemIndex(null)} className="text-gray-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Ej. Sin cebolla, término medio, salsa aparte..."
                  value={noteInputText}
                  onChange={(e) => setNoteInputText(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingNoteItemIndex(null)}
                    className="px-2.5 py-1 rounded-lg bg-gray-100 text-[10px] text-gray-600 font-bold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveItemNote}
                    className="px-3 py-1 rounded-lg bg-[#4A5D23] text-[10px] font-bold text-white"
                  >
                    Guardar Nota
                  </button>
                </div>
              </div>
            )}

            {/* General Order Notes section before Enviar a Cocina (Requirement: nota general antes de enviar comanda) */}
            <div className="pt-2 border-t border-gray-200">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-1 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-[#4A5D23]" />
                Nota General de la Comanda (Cocina):
              </label>
              <textarea
                rows={2}
                placeholder="Ej. Servir todo junto, cliente alérgico al marisco, mesa de cumpleaños..."
                value={generalOrderNotes}
                onChange={(e) => setGeneralOrderNotes(e.target.value)}
                className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl p-2 text-xs text-gray-900 focus:outline-none resize-none shadow-xs"
              />
            </div>

            {/* Bottom Total & "Enviar a Cocina" Action */}
            <div className="pt-2 border-t border-gray-200 space-y-2">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>Total de la Comanda:</span>
                <span className="font-mono text-base font-black text-[#E89E2D]">
                  ${ticketSubtotal.toFixed(2)}
                </span>
              </div>

              <button
                type="button"
                disabled={orderItems.length === 0 || isSaving}
                onClick={handleSendToKitchen}
                className="w-full py-3.5 rounded-2xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 cursor-pointer bg-[#4A5D23] hover:bg-[#3d4d1d] text-white border border-[#4A5D23] disabled:opacity-50"
              >
                <ChefHat className="w-4 h-4 text-[#E89E2D]" />
                {isSentToKitchen ? 'Actualizar en Cocina' : 'Enviar a Cocina'}
              </button>
            </div>
          </div>

          {/* MOBILE COLLAPSIBLE DRAWER (Requirement 1: Collapsible on mobile) */}
          {/* 1. Minimized Sticky Bottom Bar on Mobile */}
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t-2 border-[#4A5D23] px-4 py-3 shadow-2xl flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setIsMobileDrawerOpen(true)}
              className="flex items-center gap-2.5 text-left cursor-pointer"
            >
              <div className="w-10 h-10 rounded-2xl bg-[#EAF5F0] text-[#4A5D23] flex items-center justify-center shrink-0 border border-[#4A5D23]/30">
                <ChevronUp className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                  <span>Comanda ({totalDishCount})</span>
                  <span className="text-[10px] text-[#4A5D23] font-bold underline">Ver detalle</span>
                </div>
                <div className="text-base font-black font-mono text-[#E89E2D] leading-tight">
                  ${ticketSubtotal.toFixed(2)}
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={orderItems.length === 0 || isSaving}
              onClick={handleSendToKitchen}
              className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer shrink-0 bg-[#4A5D23] hover:bg-[#3d4d1d] text-white border border-[#4A5D23] disabled:opacity-50"
            >
              <ChefHat className="w-4 h-4 text-[#E89E2D]" />
              <span>{isSentToKitchen ? 'Actualizar en Cocina' : 'Enviar a Cocina'}</span>
            </button>
          </div>

          {/* 2. Expanded Mobile Bottom Sheet */}
          {isMobileDrawerOpen && (
            <div className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex flex-col justify-end animate-in fade-in duration-150">
              <div
                className="w-full bg-white border-t-2 border-[#E89E2D] rounded-t-3xl max-h-[82vh] flex flex-col p-4 shadow-2xl animate-in slide-in-from-bottom duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-col items-center mb-3">
                  <div className="w-12 h-1.5 rounded-full bg-gray-300 mb-3" />
                  <div className="w-full flex items-center justify-between pb-2 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                      <ChefHat className="w-5 h-5 text-[#E89E2D]" />
                      <h4 className="font-bold text-gray-900 text-sm">
                        Ticket de Comanda · {displayTableTitle}
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsMobileDrawerOpen(false)}
                      className="px-3 py-1 rounded-xl bg-gray-100 text-gray-600 hover:text-gray-900 border border-gray-200 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronDown className="w-4 h-4" />
                      Minimizar
                    </button>
                  </div>
                </div>

                <div className="mb-2 p-2 rounded-xl bg-gray-50 border border-gray-200 space-y-1.5 shrink-0">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase text-gray-600">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3 text-[#4A5D23]" />
                      Comensal activo:
                    </span>
                    {activeDiner && (
                      <button
                        type="button"
                        onClick={() => setActiveDiner('')}
                        className="text-rose-600 font-bold"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {dinersList.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setActiveDiner(activeDiner === preset ? '' : preset)}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                          activeDiner === preset
                            ? 'bg-[#4A5D23] text-white border-[#4A5D23]'
                            : 'bg-white text-gray-700 border-gray-200'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddDinerSlot}
                      className="px-2 py-0.5 rounded-lg text-[10px] font-black border border-[#4A5D23]/40 bg-[#EAF5F0] text-[#4A5D23]"
                    >
                      +
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Nombre del comensal..."
                    value={activeDiner}
                    onChange={(e) => setActiveDiner(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1 text-[11px] text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>

                <div className="flex-1 overflow-y-auto space-y-2.5 my-2 max-h-[44vh] pr-1">
                  {orderItems.length === 0 ? (
                    <div className="py-8 text-center text-gray-400 text-xs">
                      No hay productos agregados en la comanda.
                    </div>
                  ) : (
                    orderItems.map((item, index) => (
                      <div
                        key={`mob_${item.productId}_${index}`}
                        className="p-3 rounded-2xl bg-gray-50 border border-gray-200 flex flex-col gap-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1">
                              <h6 className="font-bold text-xs text-gray-900 truncate">{item.name}</h6>
                              {item.dinerName && (
                                <span className="px-1.5 py-0.5 rounded bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-[9px] font-black uppercase">
                                  {item.dinerName}
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-[11px] font-bold text-[#E89E2D]">
                              ${(item.price * item.quantity).toFixed(2)}{' '}
                              <span className="text-[10px] text-gray-500 font-normal">
                                (${item.price.toFixed(2)} c/u)
                              </span>
                            </span>
                            {item.selectedCustomizations && item.selectedCustomizations.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {item.selectedCustomizations.map((c, cIdx) => (
                                  <span
                                    key={cIdx}
                                    className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[9px] font-bold text-amber-900"
                                  >
                                    {c.optionName}
                                    {c.extraPrice > 0 ? ` (+$${Number(c.extraPrice).toFixed(2)})` : ''}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-gray-200 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleUpdateQuantity(index, -1)}
                              className="w-6 h-6 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-5 text-center font-mono font-bold text-xs text-gray-900">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateQuantity(index, 1)}
                              className="w-6 h-6 rounded-lg bg-[#4A5D23] text-white flex items-center justify-center cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteItem(index)}
                              className="w-6 h-6 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center ml-1 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3 text-rose-600" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] pt-1.5 border-t border-gray-200">
                          {item.notes ? (
                            <span className="text-amber-800 italic flex items-center gap-1 truncate max-w-[160px] font-medium">
                              <MessageSquare className="w-3 h-3 shrink-0 text-[#E89E2D]" />
                              "{item.notes}"
                            </span>
                          ) : (
                            <span className="text-gray-400 text-[10px]">Sin notas</span>
                          )}

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {unsentEditableIndices.has(index) && !item.productId.startsWith('promo_') && (
                              <button
                                type="button"
                                onClick={() => handleOpenEditCartItem(index)}
                                className="text-[10px] text-[#4A5D23] bg-[#EAF5F0] px-2 py-0.5 rounded-md font-bold cursor-pointer flex items-center gap-1"
                              >
                                <SlidersHorizontal className="w-3 h-3" />
                                Editar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenDinerEditor(index)}
                              className="text-[10px] text-amber-800 font-bold underline cursor-pointer"
                            >
                              {item.dinerName ? 'Comensal' : '+ Comensal'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenNoteEditor(index)}
                              className="text-[10px] text-[#4A5D23] font-bold underline cursor-pointer"
                            >
                              {item.notes ? 'Editar Nota' : '+ Nota'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Mobile general order note */}
                <div className="py-2 border-t border-gray-200">
                  <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-[#4A5D23]" />
                    Nota General para Cocina:
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Servir todo junto, salsa aparte..."
                    value={generalOrderNotes}
                    onChange={(e) => setGeneralOrderNotes(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>

                <div className="pt-2 border-t border-gray-200 space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-600">
                    <span>Total Comanda:</span>
                    <span className="font-mono text-lg font-black text-[#E89E2D]">
                      ${ticketSubtotal.toFixed(2)}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={orderItems.length === 0 || isSaving}
                    onClick={handleSendToKitchen}
                    className="w-full py-3 rounded-2xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer bg-[#4A5D23] hover:bg-[#3d4d1d] text-white border border-[#4A5D23] disabled:opacity-50"
                  >
                    <ChefHat className="w-4 h-4 text-[#E89E2D]" />
                    {isSentToKitchen ? 'Actualizar en Cocina' : 'Enviar a Cocina'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Admin Auth Modal */}
      <AdminAuthModal
        isOpen={isAdminAuthOpen}
        onClose={() => {
          setIsAdminAuthOpen(false);
          setPendingAuthAction(null);
        }}
        description={authDescription}
        onAuthorized={handleAdminAuthorized}
      />

      {/* Cobro and Checkout Thermal Receipt Modal */}
      <CobroModal
        isOpen={isCobroModalOpen}
        onClose={() => {
          setIsCobroModalOpen(false);
          if (fullSettlementDoneRef.current) {
            fullSettlementDoneRef.current = false;
            onClose();
          }
        }}
        table={table}
        items={orderItems}
        total={ticketSubtotal}
        onConfirmPayment={handleConfirmPayment}
      />

      {/* Precuenta (Pre-Check) 80mm Thermal Preview Modal */}
      {isPrecuentaOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setIsPrecuentaOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-white border border-gray-200 rounded-3xl p-5 shadow-2xl text-gray-900 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-[#4A5D23]" />
                <div>
                  <h4 className="font-black text-sm text-gray-900 leading-tight">Precuenta</h4>
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#4A5D23]">
                    SIN VALIDEZ TRIBUTARIA
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPrecuentaOpen(false)}
                className="p-1 rounded-xl text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-[#F8F9FA] border border-dashed border-gray-300 rounded-2xl p-4 font-mono text-[11px] text-gray-900 space-y-2 max-h-[65vh] overflow-y-auto">
              <div className="text-center font-black text-xs uppercase text-[#4A5D23]">
                PRECUENTA — SIN VALIDEZ TRIBUTARIA
              </div>
              <div className="text-center text-[10px] text-gray-500">
                {storeSettings.localName || 'GASTROLAB by Iván Muñoz'}
              </div>
              <div className="border-b border-dashed border-gray-300" />
              <div className="flex justify-between text-[10px] font-bold">
                <span>{table.tableNumber === 0 ? 'ORDEN: DOMICILIO' : displayTableTitle.toUpperCase()}</span>
                <span>{new Date().toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <div className="border-b border-dashed border-gray-300" />
              <div className="space-y-1">
                {orderItems.map((it, idx) => (
                  <div key={idx} className="text-[11px]">
                    <div className="flex justify-between">
                      <span className="truncate pr-2">
                        {it.quantity}x {it.name}
                        {it.dinerName ? ` [${it.dinerName}]` : ''}
                      </span>
                      <span className="font-bold shrink-0">${(it.price * it.quantity).toFixed(2)}</span>
                    </div>
                    {it.selectedCustomizations && it.selectedCustomizations.length > 0 && (
                      <div className="text-[9px] text-gray-600 pl-3 space-y-0.5">
                        {groupOrderCustomizations(it.selectedCustomizations).map((grp, gIdx) => (
                          <div key={gIdx}>
                            <span className="font-bold">{grp.groupLabel}</span>{' '}
                            {grp.options.map((o) => o.optionName).join(', ')}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-gray-300 pt-2 space-y-0.5 text-[10px]">
                {(() => {
                  const safeIva = Number.isFinite(storeSettings.ivaPercentage) ? storeSettings.ivaPercentage : 15;
                  const sub = ticketSubtotal / (1 + safeIva / 100);
                  const ivaVal = ticketSubtotal - sub;
                  return (
                    <>
                      <div className="flex justify-between text-gray-600">
                        <span>Subtotal (Base {safeIva}%):</span>
                        <span>${sub.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>IVA ({safeIva}%):</span>
                        <span>${ivaVal.toFixed(2)}</span>
                      </div>
                    </>
                  );
                })()}
                <div className="flex justify-between font-black text-xs text-[#4A5D23] pt-1 border-t border-gray-300">
                  <span>TOTAL PRECUENTA:</span>
                  <span>${ticketSubtotal.toFixed(2)}</span>
                </div>
              </div>

              {/* Espacios en blanco para que el cliente escriba sus datos de factura */}
              <div className="border-t border-dashed border-gray-400 pt-2.5 mt-2 space-y-2 text-[10px] text-gray-800">
                <div className="text-center font-black uppercase text-[10px] text-gray-700">
                  DATOS PARA FACTURA (LLENAR)
                </div>
                <div className="flex items-center justify-between font-bold">
                  <span>CONSUMIDOR FINAL:</span>
                  <span>(   )</span>
                </div>
                <div className="pt-1">
                  <div className="text-[9px] font-bold uppercase text-gray-600">Nombre / Razón Social:</div>
                  <div className="border-b border-gray-500 h-4 w-full" />
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase text-gray-600">RUC / Cédula:</div>
                  <div className="border-b border-gray-500 h-4 w-full" />
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase text-gray-600">Correo Electrónico:</div>
                  <div className="border-b border-gray-500 h-4 w-full" />
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase text-gray-600">Dirección:</div>
                  <div className="border-b border-gray-500 h-4 w-full" />
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase text-gray-600">Teléfono:</div>
                  <div className="border-b border-gray-500 h-4 w-full" />
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase text-gray-600">Propina ($):</div>
                  <div className="border-b border-gray-500 h-4 w-full" />
                </div>
              </div>

              <div className="text-center pt-2 text-[9px] text-gray-500">
                ¡Gracias por su visita!
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsPrecuentaOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                disabled={isPrinting}
                onClick={() => {
                  const safeIva = Number.isFinite(storeSettings.ivaPercentage) ? storeSettings.ivaPercentage : 15;
                  const sub = ticketSubtotal / (1 + safeIva / 100);
                  const ivaVal = ticketSubtotal - sub;
                  printThermalReceipt({
                    title: 'PRECUENTA — SIN VALIDEZ TRIBUTARIA',
                    tableLabel: table.tableNumber === 0 ? 'ORDEN: DOMICILIO' : displayTableTitle.toUpperCase(),
                    isDomicilio: table.tableNumber === 0,
                    isPrecuenta: true,
                    clientName: 'CONSUMIDOR FINAL / POR LLENAR',
                    clientId: '---',
                    items: orderItems,
                    subtotal: sub,
                    ivaRate: safeIva,
                    ivaAmount: ivaVal,
                    total: ticketSubtotal,
                  });
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Printer className="w-4 h-4 text-[#D97706]" />
                {isPrinting ? 'Imprimiendo...' : 'Imprimir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-modal: Asignar plato a Comensal (Desktop y Móvil) */}
      {editingDinerItemIndex !== null && (
        <div
          className="fixed inset-0 z-[65] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setEditingDinerItemIndex(null)}
        >
          <div
            className="w-full max-w-sm bg-white border border-gray-200 rounded-3xl p-5 shadow-2xl text-gray-900 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 pb-2.5">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#E89E2D]" />
                <h4 className="font-bold text-sm text-gray-900">
                  Asignar a Comensal · {orderItems[editingDinerItemIndex]?.name}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setEditingDinerItemIndex(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {dinersList.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleSaveItemDiner(preset)}
                  className="px-3 py-1 rounded-xl bg-[#EAF5F0] hover:bg-[#4A5D23] text-[#4A5D23] hover:text-white border border-[#4A5D23]/30 text-xs font-bold cursor-pointer transition-colors"
                >
                  {preset}
                </button>
              ))}
              <button
                type="button"
                onClick={handleAddDinerSlot}
                className="px-3 py-1 rounded-xl bg-amber-50 hover:bg-[#E89E2D] text-amber-900 border border-[#E89E2D]/40 text-xs font-black cursor-pointer transition-colors"
              >
                + Añadir
              </button>
            </div>

            <input
              type="text"
              placeholder="Ej. Juan, María, Invitado..."
              value={dinerInputText}
              onChange={(e) => setDinerInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveItemDiner();
                }
              }}
              className="w-full bg-gray-50 border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
            />

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleSaveItemDiner('')}
                className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer"
              >
                Quitar Comensal
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingDinerItemIndex(null)}
                  className="px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-xs font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveItemDiner()}
                  className="px-4 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold cursor-pointer"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-modal: Selector / Editor de Personalización y Extras del Producto */}
      {liveCustomizingProduct && (
        <div
          className="fixed inset-0 z-[65] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => {
            setCustomizingProduct(null);
            setEditingCartItemIndex(null);
          }}
        >
          <div
            className="w-full max-w-md bg-white border border-gray-200 rounded-3xl p-5 shadow-2xl text-gray-900 space-y-4 max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <SlidersHorizontal className="w-4 h-4 text-[#E89E2D]" />
                </div>
                <div>
                  <h4 className="font-black text-sm text-gray-900 leading-tight">
                    {editingCartItemIndex !== null ? 'Editar:' : 'Personalizar:'} {liveCustomizingProduct.name}
                  </h4>
                  <span className="text-[11px] font-mono font-bold text-[#4A5D23]">
                    Precio base: ${(Number(liveCustomizingProduct.price) || 0).toFixed(2)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCustomizingProduct(null);
                  setEditingCartItemIndex(null);
                }}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {customModalError && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{customModalError}</span>
                </div>
              )}

              {(liveCustomizingProduct.customizations || []).map((group) => {
                const picked = selectedOptionsByGroup[group.id] || [];
                return (
                  <div
                    key={group.id}
                    className={`p-3 rounded-2xl border space-y-2 ${
                      group.required && picked.length === 0 && customModalError
                        ? 'bg-rose-50/40 border-rose-300'
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-extrabold text-gray-900">{group.name}</span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                            group.required
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-gray-200/80 text-gray-700'
                          }`}
                        >
                          {group.required ? 'Obligatorio' : 'Opcional'}
                        </span>
                        <span className="text-[10px] font-bold text-[#4A5D23]">
                          {group.multiSelect ? 'Selección múltiple' : 'Elige 1 opción'}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {(group.options || []).map((opt) => {
                        const isOptUnavailable = opt.available === false;
                        const isSelected = !isOptUnavailable && picked.includes(opt.name);
                        const extra = Number(opt.extraPrice) || 0;
                        return (
                          <label
                            key={opt.name}
                            onClick={(e) => {
                              if (isOptUnavailable) {
                                e.preventDefault();
                                setCustomModalError(`La opción "${opt.name}" está agotada / no disponible.`);
                                return;
                              }
                              if (!group.multiSelect && !group.required && isSelected) {
                                e.preventDefault();
                                handleToggleCustomOption(
                                  group.id,
                                  opt.name,
                                  group.multiSelect,
                                  group.required,
                                  isOptUnavailable
                                );
                              }
                            }}
                            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all select-none ${
                              isOptUnavailable
                                ? 'bg-rose-50/70 text-rose-800 border-rose-200 opacity-65 cursor-not-allowed'
                                : isSelected
                                ? 'bg-[#4A5D23] text-white border-[#4A5D23] shadow-xs cursor-pointer'
                                : 'bg-white text-gray-700 border-gray-200 hover:border-[#4A5D23] cursor-pointer'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type={group.multiSelect ? 'checkbox' : 'radio'}
                                name={`table_cust_${group.id}`}
                                disabled={isOptUnavailable}
                                checked={isSelected}
                                onChange={() =>
                                  handleToggleCustomOption(
                                    group.id,
                                    opt.name,
                                    group.multiSelect,
                                    group.required,
                                    isOptUnavailable
                                  )
                                }
                                className={`shrink-0 ${
                                  isOptUnavailable
                                    ? 'cursor-not-allowed'
                                    : isSelected
                                    ? 'accent-[#E89E2D] cursor-pointer'
                                    : 'accent-[#4A5D23] cursor-pointer'
                                }`}
                              />
                              <span className={`truncate ${isOptUnavailable ? 'line-through' : ''}`}>
                                {opt.name}
                              </span>
                            </span>
                            {isOptUnavailable ? (
                              <span className="text-[9px] font-black uppercase bg-rose-600 text-white px-1.5 py-0.5 rounded shrink-0">
                                Agotado
                              </span>
                            ) : (
                              extra > 0 && (
                                <span
                                  className={`font-mono text-[11px] shrink-0 ${
                                    isSelected ? 'text-[#E89E2D]' : 'text-[#D97706]'
                                  }`}
                                >
                                  +${extra.toFixed(2)}
                                </span>
                              )
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="space-y-2.5 pt-1">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-600 mb-1">
                    Asignar a Comensal (Opcional)
                  </label>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {dinersList.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          setCustomModalDiner(customModalDiner === preset ? '' : preset)
                        }
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border cursor-pointer ${
                          customModalDiner === preset
                            ? 'bg-[#4A5D23] text-white border-[#4A5D23]'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Ej. Cliente 1, Juan..."
                    value={customModalDiner}
                    onChange={(e) => setCustomModalDiner(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-600 mb-1">
                    Nota adicional (Opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Término 3/4, bien cocido..."
                    value={customModalNote}
                    onChange={(e) => setCustomModalNote(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                  />
                </div>
              </div>
            </div>

            {(() => {
              const base = Number(liveCustomizingProduct.price) || 0;
              const extras = (liveCustomizingProduct.customizations || []).reduce((sum, g) => {
                const picked = selectedOptionsByGroup[g.id] || [];
                return (
                  sum +
                  picked.reduce((s, name) => {
                    const opt = (g.options || []).find((o) => o.name === name && o.available !== false);
                    return s + (Number(opt?.extraPrice) || 0);
                  }, 0)
                );
              }, 0);
              const totalItem = base + extras;
              return (
                <div className="pt-3 border-t border-gray-200 flex items-center justify-between gap-3 shrink-0">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-gray-500 block">
                      Precio Final Plato
                    </span>
                    <span className="font-mono font-black text-lg text-[#E89E2D]">
                      ${totalItem.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCustomizingProduct(null);
                        setEditingCartItemIndex(null);
                      }}
                      className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmCustomizedProduct}
                      className="px-5 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      {editingCartItemIndex !== null ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-[#E89E2D]" />
                          Guardar Cambios
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 text-[#E89E2D]" />
                          Agregar al Pedido
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
