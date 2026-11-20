import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBranch, belongsToBranch } from '../context/BranchContext';
import { commitOfflineSafe } from '../utils/offlineFirestore';
import { translateRoleToSpanish } from '../utils/roleLabels';
import {
  CashRegister,
  CashShift,
  CashMovement,
  CashAudit,
} from '../types';
import {
  DollarSign,
  Lock,
  Unlock,
  Plus,
  Calculator,
  History,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Clock,
  User,
  ArrowDownRight,
  ArrowUpRight,
  FileSpreadsheet,
  Coins,
  Shield,
  Trash2,
  X,
  Banknote,
  Printer,
} from 'lucide-react';

export const CajaModule: React.FC = () => {
  const { userProfile } = useAuth();
  const { activeBranch } = useBranch();
  const [rawRegisters, setRawRegisters] = useState<CashRegister[]>([]);
  const [rawShifts, setRawShifts] = useState<CashShift[]>([]);
  const [rawMovements, setRawMovements] = useState<CashMovement[]>([]);
  const [activeTab, setActiveTab] = useState<'cajas' | 'historial' | 'movimientos'>('cajas');

  const registers = useMemo(
    () => rawRegisters.filter((r) => belongsToBranch(r.branch, activeBranch)),
    [rawRegisters, activeBranch]
  );
  const shifts = useMemo(
    () => rawShifts.filter((s) => belongsToBranch(s.branch, activeBranch)),
    [rawShifts, activeBranch]
  );
  const movements = useMemo(
    () => rawMovements.filter((m) => belongsToBranch(m.branch, activeBranch)),
    [rawMovements, activeBranch]
  );

  // Modals state
  const [isOpenRegisterModalOpen, setIsOpenRegisterModalOpen] = useState(false);
  const [isCloseRegisterModalOpen, setIsCloseRegisterModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isNewRegisterModalOpen, setIsNewRegisterModalOpen] = useState(false);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);

  // Active register being operated
  const [selectedRegister, setSelectedRegister] = useState<CashRegister | null>(null);

  // Form states - UX: Completely empty by default with placeholders
  const [initialCashInput, setInitialCashInput] = useState('');
  const [countedCashInput, setCountedCashInput] = useState('');
  const [countedTransferInput, setCountedTransferInput] = useState('');
  const [countedDeUnaInput, setCountedDeUnaInput] = useState('');
  const [countedCardInput, setCountedCardInput] = useState('');
  const [closeNotesInput, setCloseNotesInput] = useState('');
  const [auditNotesInput, setAuditNotesInput] = useState('');
  const [showDenominationCalculator, setShowDenominationCalculator] = useState(false);
  const [denominations, setDenominations] = useState({
    b20: '',
    b10: '',
    b5: '',
    c1: '',
    c050: '',
    c025: '',
    c010: '',
    c005: '',
    c001: '',
  });

  // New register form
  const [newRegisterName, setNewRegisterName] = useState('');

  // Cash movement form
  const [movementType, setMovementType] = useState<'in' | 'out'>('out');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showAllClosedShifts, setShowAllClosedShifts] = useState(false);
  const [showAllMovements, setShowAllMovements] = useState(false);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<{
    type: 'register' | 'shift' | 'movement';
    id: string;
    label: string;
  } | null>(null);
  const [shiftToPrint, setShiftToPrint] = useState<CashShift | null>(null);
  const [lastClosedShift, setLastClosedShift] = useState<CashShift | null>(null);
  const [isCloseSummaryOpen, setIsCloseSummaryOpen] = useState(false);

  const submittingRef = useRef(false);
  const printTimerRef = useRef<number | null>(null);
  const printCleanupTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (printTimerRef.current) window.clearTimeout(printTimerRef.current);
      if (printCleanupTimerRef.current) window.clearTimeout(printCleanupTimerRef.current);
    };
  }, []);

  // Role check: Only Owner, Admin, Cashier are authorized
  const userRole = userProfile?.role || 'Service Staff';
  const isAuthorized = userRole === 'Owner' || userRole === 'Admin' || userRole === 'Cashier';

  // Listen to cash registers in real time
  useEffect(() => {
    const q = query(collection(db, 'cash_registers'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: CashRegister[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as CashRegister);
        });
        setRawRegisters(list);
      },
      (err) => {
        console.error('Error al escuchar cajas registradoras:', err);
        setErrorMsg('No se pudieron sincronizar las cajas registradoras en tiempo real.');
      }
    );

    return () => unsubscribe();
  }, []);

  // Listen to cash shifts in real time
  useEffect(() => {
    const q = query(collection(db, 'cash_shifts'), orderBy('openedAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: CashShift[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as CashShift);
        });
        setRawShifts(list);
      },
      (err) => {
        console.error('Error al escuchar turnos de caja:', err);
        setErrorMsg('No se pudieron sincronizar los turnos de caja en tiempo real.');
      }
    );

    return () => unsubscribe();
  }, []);

  // Listen to cash movements in real time
  useEffect(() => {
    const q = query(collection(db, 'cash_movements'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: CashMovement[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as CashMovement);
        });
        setRawMovements(list);
      },
      (err) => {
        console.error('Error al escuchar movimientos de caja:', err);
        setErrorMsg('No se pudieron sincronizar los movimientos de caja.');
      }
    );

    return () => unsubscribe();
  }, []);

  // Initialize sample cash registers atomically if empty
  const handleSeedRegisters = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();
      const defaultRegisters = [
        { name: 'Caja 1 - Principal', status: 'closed' },
        { name: 'Caja 2 - Barra & Bebidas', status: 'closed' },
      ];

      for (const reg of defaultRegisters) {
        const newRef = doc(collection(db, 'cash_registers'));
        batch.set(newRef, {
          ...reg,
          branch: activeBranch,
          createdAt: now,
          updatedAt: now,
        });
      }
      await commitOfflineSafe(batch.commit(), 'seed_cash_registers');
    } catch (e: any) {
      console.error('Error al crear cajas iniciales:', e);
      setErrorMsg(e?.message || 'Error al crear las cajas iniciales.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // 1. OPEN CASH REGISTER
  const handleOpenRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRegister || submittingRef.current) return;
    setErrorMsg(null);

    const initialAmount = parseFloat(initialCashInput);
    if (isNaN(initialAmount) || initialAmount < 0) {
      setErrorMsg('Por favor ingresa un fondo de caja inicial válido.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const cashierName = `${userProfile?.name || 'Usuario'} ${userProfile?.lastName || ''}`.trim();

      // Pre-allocate shift doc ID so offline mode works instantaneously
      const newShiftRef = doc(collection(db, 'cash_shifts'));
      await commitOfflineSafe(
        setDoc(newShiftRef, {
          registerId: selectedRegister.id,
          registerName: selectedRegister.name,
          branch: activeBranch,
          cashierUid: userProfile?.uid || 'user-id',
          cashierName: cashierName,
          openedAt: now,
          initialCash: initialAmount,
          cashSales: 0,
          cardSales: 0,
          transferSales: 0,
          deUnaSales: 0,
          otherSales: 0,
          totalSales: 0,
          cashIn: 0,
          cashOut: 0,
          expectedCash: initialAmount,
          status: 'open',
          auditHistory: [],
          createdAt: now,
        }),
        'open_cash_shift'
      );

      // Update register status to 'open'
      await commitOfflineSafe(
        updateDoc(doc(db, 'cash_registers', selectedRegister.id), {
          status: 'open',
          currentShiftId: newShiftRef.id,
          openedBy: cashierName,
          openedAt: now,
          initialCash: initialAmount,
          totalSales: 0,
          updatedAt: now,
        }),
        'open_cash_register'
      );

      setSuccessMsg(`¡${selectedRegister.name} abierta con fondo de $${initialAmount.toFixed(2)}!`);
      setInitialCashInput('');
      setIsOpenRegisterModalOpen(false);
      setSelectedRegister(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al abrir la caja.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Memoized O(1) shift lookup maps & partitions
  const { openShifts, closedShifts, openShiftById, openShiftByRegisterId } = useMemo(() => {
    const open: CashShift[] = [];
    const closed: CashShift[] = [];
    const byId = new Map<string, CashShift>();
    const byRegId = new Map<string, CashShift>();
    for (const s of shifts) {
      if (s.status === 'open') {
        open.push(s);
        byId.set(s.id, s);
        if (s.registerId && !byRegId.has(s.registerId)) {
          byRegId.set(s.registerId, s);
        }
      } else if (s.status === 'closed') {
        closed.push(s);
      }
    }
    return {
      openShifts: open,
      closedShifts: closed,
      openShiftById: byId,
      openShiftByRegisterId: byRegId,
    };
  }, [shifts]);

  const visibleClosedShifts = useMemo(
    () => (showAllClosedShifts ? closedShifts : closedShifts.slice(0, 50)),
    [closedShifts, showAllClosedShifts]
  );

  const visibleMovements = useMemo(
    () => (showAllMovements ? movements : movements.slice(0, 50)),
    [movements, showAllMovements]
  );

  // Find active shift for a register in O(1)
  const getActiveShiftForRegister = useCallback(
    (register: CashRegister): CashShift | undefined => {
      if (register.currentShiftId) {
        const byId = openShiftById.get(register.currentShiftId);
        if (byId) return byId;
      }
      return openShiftByRegisterId.get(register.id);
    },
    [openShiftById, openShiftByRegisterId]
  );

  const consolidatedStats = useMemo(() => {
    let totalCashInDrawers = 0;
    let openRegistersCount = 0;
    for (const reg of registers) {
      if (reg.status === 'open') openRegistersCount += 1;
      const shift = getActiveShiftForRegister(reg);
      if (shift) {
        totalCashInDrawers +=
          (shift.initialCash || 0) + (shift.cashSales || 0) + (shift.cashIn || 0) - (shift.cashOut || 0);
      }
    }

    let openTurnTotalSales = 0;
    let sumCash = 0;
    let sumCard = 0;
    let sumTransfer = 0;
    let sumDeUna = 0;
    let sumIn = 0;
    let sumOut = 0;

    for (const s of openShifts) {
      openTurnTotalSales += s.totalSales || 0;
      sumCash += s.cashSales || 0;
      sumCard += s.cardSales || 0;
      sumTransfer += s.transferSales || 0;
      sumDeUna += s.deUnaSales || 0;
      sumIn += s.cashIn || 0;
      sumOut += s.cashOut || 0;
    }

    return {
      totalCashInDrawers,
      openRegistersCount,
      openTurnTotalSales,
      sumCash,
      sumCard,
      sumTransfer,
      sumDeUna,
      sumIn,
      sumOut,
    };
  }, [registers, openShifts, getActiveShiftForRegister]);

  // 2. PARTIAL AUDIT (ARQUEO SIN CERRAR CAJA — FÍSICO + DIGITAL)
  const handleSaveAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRegister || submittingRef.current) return;
    setErrorMsg(null);
    const shift = getActiveShiftForRegister(selectedRegister);
    if (!shift) {
      setErrorMsg('No se encontró el turno activo de esta caja.');
      return;
    }

    const counted = parseFloat(countedCashInput);
    if (isNaN(counted) || counted < 0) {
      setErrorMsg('Por favor ingresa el monto de efectivo físico contado en caja.');
      return;
    }

    const countedTransfer = countedTransferInput.trim() === '' ? 0 : parseFloat(countedTransferInput);
    const countedDeUna = countedDeUnaInput.trim() === '' ? 0 : parseFloat(countedDeUnaInput);
    const countedCard = countedCardInput.trim() === '' ? 0 : parseFloat(countedCardInput);

    if (
      isNaN(countedTransfer) ||
      countedTransfer < 0 ||
      isNaN(countedDeUna) ||
      countedDeUna < 0 ||
      isNaN(countedCard) ||
      countedCard < 0
    ) {
      setErrorMsg('Por favor verifica que los valores digitales ingresados sean válidos (mayor o igual a 0).');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const cashierName = `${userProfile?.name || 'Usuario'} ${userProfile?.lastName || ''}`.trim();
      const expectedCash =
        shift.initialCash + (shift.cashSales || 0) + (shift.cashIn || 0) - (shift.cashOut || 0);
      const diffCash = counted - expectedCash;

      const expectedTransfer = shift.transferSales || 0;
      const diffTransfer = countedTransfer - expectedTransfer;

      const expectedDeUna = shift.deUnaSales || 0;
      const diffDeUna = countedDeUna - expectedDeUna;

      const expectedCard = shift.cardSales || 0;
      const diffCard = countedCard - expectedCard;

      const totalExpected = expectedCash + expectedTransfer + expectedDeUna + expectedCard;
      const totalCounted = counted + countedTransfer + countedDeUna + countedCard;
      const totalDiff = totalCounted - totalExpected;

      const newAudit: CashAudit = {
        id: `audit-${Date.now()}`,
        timestamp: now,
        performedBy: cashierName,
        expectedCash,
        countedCash: counted,
        difference: diffCash,
        expectedTransfer,
        countedTransfer,
        transferDifference: diffTransfer,
        expectedDeUna,
        countedDeUna,
        deUnaDifference: diffDeUna,
        expectedCard,
        countedCard,
        cardDifference: diffCard,
        totalExpected,
        totalCounted,
        totalDifference: totalDiff,
        notes: auditNotesInput.trim() || 'Arqueo parcial físico y digital',
      };

      const updatedHistory = [...(shift.auditHistory || []), newAudit];

      await commitOfflineSafe(
        updateDoc(doc(db, 'cash_shifts', shift.id), {
          auditHistory: updatedHistory,
          updatedAt: now,
        }),
        'save_cash_audit'
      );

      setSuccessMsg(
        `Arqueo parcial registrado. Efectivo dif: ${
          diffCash >= 0 ? `+$${diffCash.toFixed(2)}` : `-$${Math.abs(diffCash).toFixed(2)}`
        } · Dif. Global (Físico+Digital): ${
          totalDiff >= 0 ? `+$${totalDiff.toFixed(2)}` : `-$${Math.abs(totalDiff).toFixed(2)}`
        }`
      );
      setCountedCashInput('');
      setCountedTransferInput('');
      setCountedDeUnaInput('');
      setCountedCardInput('');
      setAuditNotesInput('');
      setIsAuditModalOpen(false);
      setSelectedRegister(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al guardar el arqueo.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // 3. CLOSE REGISTER (ARQUEO Y CIERRE DEFINITIVO)
  const handleCloseRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRegister || submittingRef.current) return;
    setErrorMsg(null);

    const counted = parseFloat(countedCashInput);
    if (isNaN(counted) || counted < 0) {
      setErrorMsg('Por favor ingresa el monto total de efectivo contado para el cierre.');
      return;
    }

    const shift = getActiveShiftForRegister(selectedRegister);
    const expectedCheck = shift
      ? shift.expectedCash !== undefined
        ? shift.expectedCash
        : (shift.initialCash || 0) + (shift.cashSales || 0) + (shift.cashIn || 0) - (shift.cashOut || 0)
      : (selectedRegister.initialCash || 0) + (selectedRegister.totalSales || 0);

    if (counted < expectedCheck - 0.005) {
      setErrorMsg(
        `Faltante de efectivo (-$${(expectedCheck - counted).toFixed(2)}). No se puede cerrar la caja hasta cuadrar el monto contado con el esperado.`
      );
      return;
    }

    const hasAnyDenom = Object.values(denominations).some((v) => v.trim() !== '');
    const denomPayload = hasAnyDenom
      ? {
          bills20: parseInt(denominations.b20, 10) || 0,
          bills10: parseInt(denominations.b10, 10) || 0,
          bills5: parseInt(denominations.b5, 10) || 0,
          coins1: parseInt(denominations.c1, 10) || 0,
          coins050: parseInt(denominations.c050, 10) || 0,
          coins025: parseInt(denominations.c025, 10) || 0,
          coins010: parseInt(denominations.c010, 10) || 0,
          coins005: parseInt(denominations.c005, 10) || 0,
          coins001: parseInt(denominations.c001, 10) || 0,
        }
      : undefined;

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const cashierName = `${userProfile?.name || 'Usuario'} ${userProfile?.lastName || ''}`.trim();
      const notesText = closeNotesInput.trim();

      let closedShiftRecord: CashShift;

      if (shift) {
        const expected =
          shift.expectedCash !== undefined
            ? shift.expectedCash
            : (shift.initialCash || 0) + (shift.cashSales || 0) + (shift.cashIn || 0) - (shift.cashOut || 0);
        const diff = counted - expected;
        const surplusAmount = diff > 0.005 ? Number(diff.toFixed(2)) : 0;

        const closingAudit: CashAudit = {
          id: `audit-close-${Date.now()}`,
          timestamp: now,
          performedBy: cashierName,
          auditedBy: cashierName,
          expectedCash: expected,
          countedCash: counted,
          difference: diff,
          notes: notesText || 'Cierre definitivo de turno',
        };

        const updatedAudits = [...(shift.auditHistory || []), closingAudit];

        const shiftUpdateData: Record<string, any> = {
          status: 'closed',
          closedAt: now,
          closedBy: cashierName,
          closedByEmail: userProfile?.email || '',
          expectedCash: expected,
          actualCashCounted: counted,
          difference: diff,
          surplusAmount,
          notes: notesText || '',
          closingNotes: notesText || '',
          auditHistory: updatedAudits,
          updatedAt: now,
        };
        if (denomPayload) {
          shiftUpdateData.denominationBreakdown = denomPayload;
        }

        await commitOfflineSafe(
          updateDoc(doc(db, 'cash_shifts', shift.id), shiftUpdateData),
          'close_cash_shift'
        );

        closedShiftRecord = {
          ...shift,
          status: 'closed',
          closedAt: now,
          closedBy: cashierName,
          expectedCash: expected,
          actualCashCounted: counted,
          difference: diff,
          surplusAmount,
          ...(denomPayload ? { denominationBreakdown: denomPayload } : {}),
          closingNotes: notesText || '',
          auditHistory: updatedAudits,
        };
      } else {
        // Fallback: if register was open without an active shift document, record closed shift
        const initial = selectedRegister.initialCash || 0;
        const expected = initial + (selectedRegister.totalSales || 0);
        const diff = counted - expected;
        const surplusAmount = diff > 0.005 ? Number(diff.toFixed(2)) : 0;
        const closingAudit: CashAudit = {
          id: `audit-close-${Date.now()}`,
          timestamp: now,
          performedBy: cashierName,
          auditedBy: cashierName,
          expectedCash: expected,
          countedCash: counted,
          difference: diff,
          notes: notesText || 'Cierre definitivo de turno',
        };

        const createdRef = doc(collection(db, 'cash_shifts'));
        await commitOfflineSafe(
          setDoc(createdRef, {
            registerId: selectedRegister.id,
            registerName: selectedRegister.name,
            branch: activeBranch,
            cashierUid: userProfile?.uid || 'user-id',
            cashierName,
            openedAt: selectedRegister.openedAt || now,
            closedAt: now,
            closedBy: cashierName,
            closedByEmail: userProfile?.email || '',
            initialCash: initial,
            cashSales: selectedRegister.totalSales || 0,
            cardSales: 0,
            transferSales: 0,
            deUnaSales: 0,
            otherSales: 0,
            totalSales: selectedRegister.totalSales || 0,
            cashIn: 0,
            cashOut: 0,
            expectedCash: expected,
            actualCashCounted: counted,
            difference: diff,
            surplusAmount,
            ...(denomPayload ? { denominationBreakdown: denomPayload } : {}),
            status: 'closed',
            closingNotes: notesText || '',
            auditHistory: [closingAudit],
            createdAt: now,
            updatedAt: now,
          }),
          'close_cash_shift_fallback'
        );

        closedShiftRecord = {
          id: createdRef.id,
          registerId: selectedRegister.id,
          registerName: selectedRegister.name,
          openedBy: cashierName,
          cashierName,
          openedAt: selectedRegister.openedAt || now,
          closedAt: now,
          closedBy: cashierName,
          initialCash: initial,
          cashSales: selectedRegister.totalSales || 0,
          cardSales: 0,
          transferSales: 0,
          deUnaSales: 0,
          totalSales: selectedRegister.totalSales || 0,
          cashIn: 0,
          cashOut: 0,
          expectedCash: expected,
          actualCashCounted: counted,
          difference: diff,
          surplusAmount,
          ...(denomPayload ? { denominationBreakdown: denomPayload } : {}),
          status: 'closed',
          closingNotes: notesText || '',
          auditHistory: [closingAudit],
          createdAt: now,
        };
      }

      // Update register status to 'closed' and reset all daily/shift counters for next day
      await commitOfflineSafe(
        updateDoc(doc(db, 'cash_registers', selectedRegister.id), {
          status: 'closed',
          currentShiftId: null,
          openedBy: null,
          openedAt: null,
          initialCash: 0,
          currentCash: 0,
          totalSales: 0,
          lastClosedAt: now,
          updatedAt: now,
        }),
        'close_cash_register'
      );

      setLastClosedShift(closedShiftRecord);
      setIsCloseSummaryOpen(true);
      setSuccessMsg(`¡${selectedRegister.name} cerrada exitosamente! Arqueo guardado ($${counted.toFixed(2)}) y contadores reiniciados.`);
      setCountedCashInput('');
      setCloseNotesInput('');
      setIsCloseRegisterModalOpen(false);
      setSelectedRegister(null);
    } catch (err: any) {
      console.error('Error al cerrar caja:', err);
      setErrorMsg(err.message || 'Error al cerrar la caja.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // 4. CASH IN/OUT MOVEMENT
  const handleSaveMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRegister || submittingRef.current) return;
    setErrorMsg(null);
    const shift = getActiveShiftForRegister(selectedRegister);
    if (!shift) {
      setErrorMsg('Debes tener un turno abierto en esta caja para registrar movimientos.');
      return;
    }

    const amount = parseFloat(movementAmount);
    if (isNaN(amount) || amount <= 0) {
      setErrorMsg('Por favor ingresa un monto válido mayor a 0.');
      return;
    }

    if (!movementReason.trim()) {
      setErrorMsg('El motivo del movimiento es obligatorio.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const cashierName = `${userProfile?.name || 'Usuario'} ${userProfile?.lastName || ''}`.trim();

      // Add movement doc
      const movementRef = doc(collection(db, 'cash_movements'));
      await commitOfflineSafe(
        setDoc(movementRef, {
          registerId: selectedRegister.id,
          shiftId: shift.id,
          branch: activeBranch,
          type: movementType,
          amount: amount,
          reason: movementReason.trim(),
          performedBy: cashierName,
          createdAt: now,
        }),
        'create_cash_movement'
      );

      // Update shift expected cash
      const newCashIn = movementType === 'in' ? (shift.cashIn || 0) + amount : (shift.cashIn || 0);
      const newCashOut = movementType === 'out' ? (shift.cashOut || 0) + amount : (shift.cashOut || 0);
      const updatedExpected = shift.initialCash + (shift.cashSales || 0) + newCashIn - newCashOut;

      await commitOfflineSafe(
        updateDoc(doc(db, 'cash_shifts', shift.id), {
          cashIn: newCashIn,
          cashOut: newCashOut,
          expectedCash: updatedExpected,
          updatedAt: now,
        }),
        'update_shift_movement'
      );

      setSuccessMsg(`Movimiento de ${movementType === 'in' ? 'Ingreso' : 'Retiro'} por $${amount.toFixed(2)} registrado.`);
      setMovementAmount('');
      setMovementReason('');
      setIsMovementModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al registrar movimiento.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // 5. CREATE NEW REGISTER
  const handleCreateRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setErrorMsg(null);
    if (!newRegisterName.trim()) {
      setErrorMsg('El nombre de la caja es obligatorio.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const regRef = doc(collection(db, 'cash_registers'));
      await commitOfflineSafe(
        setDoc(regRef, {
          name: newRegisterName.trim(),
          status: 'closed',
          branch: activeBranch,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        'create_cash_register'
      );

      setNewRegisterName('');
      setIsNewRegisterModalOpen(false);
      setSuccessMsg('Nueva caja registradora agregada al sistema.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al crear caja registradora.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // 6. DELETE REGISTER / SHIFT / MOVEMENT (React confirmation modal instead of window.confirm)
  const handleDeleteRegister = (registerId: string, name: string) => {
    setConfirmDeleteTarget({
      type: 'register',
      id: registerId,
      label: `la caja "${name}"`,
    });
  };

  const handleDeleteShift = (shiftId: string) => {
    setConfirmDeleteTarget({
      type: 'shift',
      id: shiftId,
      label: 'este registro de turno del historial',
    });
  };

  const handleDeleteMovement = (movementId: string) => {
    setConfirmDeleteTarget({
      type: 'movement',
      id: movementId,
      label: 'este movimiento de caja',
    });
  };

  const handleExecuteDeleteTarget = async () => {
    if (!confirmDeleteTarget) return;
    const { type, id } = confirmDeleteTarget;
    try {
      const colName =
        type === 'register'
          ? 'cash_registers'
          : type === 'shift'
          ? 'cash_shifts'
          : 'cash_movements';
      await commitOfflineSafe(deleteDoc(doc(db, colName, id)), 'delete_cash_doc');
      setSuccessMsg('Registro eliminado correctamente.');
    } catch (err: any) {
      console.error('Error al eliminar registro:', err);
      setErrorMsg(err?.message || 'Error al eliminar el registro.');
    } finally {
      setConfirmDeleteTarget(null);
    }
  };

  const dayTotalSalesMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of shifts) {
      const dateStr = new Date(s.closedAt || s.openedAt).toDateString();
      const shiftSales = Math.max(
        s.totalSales || 0,
        (s.cashSales || 0) + (s.cardSales || 0) + (s.transferSales || 0) + (s.deUnaSales || 0)
      );
      map.set(dateStr, (map.get(dateStr) || 0) + shiftSales);
    }
    return map;
  }, [shifts]);

  const getDayTotalSales = useCallback(
    (refShift: CashShift): number => {
      const refDate = new Date(refShift.closedAt || refShift.openedAt).toDateString();
      const currentShiftSales = Math.max(
        refShift.totalSales || 0,
        (refShift.cashSales || 0) +
          (refShift.cardSales || 0) +
          (refShift.transferSales || 0) +
          (refShift.deUnaSales || 0)
      );
      const mapTotal = dayTotalSalesMap.get(refDate) || 0;
      return Math.max(mapTotal, currentShiftSales);
    },
    [dayTotalSalesMap]
  );

  const handlePrintShiftReport = useCallback((shift: CashShift) => {
    if (printTimerRef.current) window.clearTimeout(printTimerRef.current);
    if (printCleanupTimerRef.current) window.clearTimeout(printCleanupTimerRef.current);
    setShiftToPrint(shift);
    printTimerRef.current = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        // Ignore print error
      }
      printCleanupTimerRef.current = window.setTimeout(() => setShiftToPrint(null), 1200);
    }, 180);
  }, []);

  return (
    <div className="space-y-6 text-gray-900">
      {/* Top Header / Sub-tabs bar without bulky banner (Requirement 10) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-3xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
            <DollarSign className="w-5 h-5 text-[#E89E2D]" />
          </div>
          <div>
            <h2 className="text-lg font-black text-gray-900 tracking-tight">Caja y Turnos</h2>
            <p className="text-xs text-gray-500">Terminales de punto de venta y arqueos</p>
          </div>
        </div>

        {/* Sub-tabs: Terminales, Historial, Movimientos */}
        <div className="flex items-center gap-1.5 bg-gray-100 p-1.5 rounded-2xl border border-gray-200">
          <button
            type="button"
            onClick={() => setActiveTab('cajas')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'cajas'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Terminales ({registers.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('historial')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'historial'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Historial ({shifts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('movimientos')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'movimientos'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Movimientos ({movements.length})
          </button>
        </div>
      </div>

      {/* Permission warning if user role is not authorized */}
      {!isAuthorized && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-3">
          <Shield className="w-5 h-5 text-[#E89E2D] shrink-0" />
          <div>
            <span className="font-bold">Permiso Restringido:</span> Tu rol actual ({translateRoleToSpanish(userRole)}) no tiene privilegios para abrir, arquear o cerrar cajas.
          </div>
        </div>
      )}

      {/* Alerts */}
      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-gray-400 hover:text-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 text-[#4A5D23] text-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{successMsg}</span>
          </div>
          <div className="flex items-center gap-2">
            {lastClosedShift && (
              <button
                type="button"
                onClick={() => handlePrintShiftReport(lastClosedShift)}
                className="px-3.5 py-1.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-[#E89E2D]" />
                Imprimir Cierre de Caja
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSuccessMsg(null);
                setLastClosedShift(null);
              }}
              className="text-gray-400 hover:text-gray-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* TAB 1: TERMINALES Y CAJAS - AT THE TOP (Requirement 10) */}
      {activeTab === 'cajas' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Terminales Registradas ({registers.length})
            </div>
            <div className="flex items-center gap-2">
              {registers.length === 0 && (
                <button
                  type="button"
                  onClick={handleSeedRegisters}
                  className="px-3.5 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Coins className="w-4 h-4 text-[#E89E2D]" />
                  Crear Cajas Demo
                </button>
              )}
              {isAuthorized && (
                <button
                  type="button"
                  onClick={() => {
                    setNewRegisterName('');
                    setErrorMsg(null);
                    setIsNewRegisterModalOpen(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-[#E89E2D]" />
                  + Nueva Caja
                </button>
              )}
            </div>
          </div>

          {registers.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-gray-200">
              <Coins className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <h3 className="text-base font-bold text-gray-900">No hay cajas registradas</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Crea tu primera caja registradora para aperturar turnos y registrar fondos.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {registers.map((reg) => {
                const isOpen = reg.status === 'open';
                const activeShift = getActiveShiftForRegister(reg);
                const currentCashInDrawer = activeShift
                  ? (activeShift.initialCash || 0) + (activeShift.cashSales || 0) + (activeShift.cashIn || 0) - (activeShift.cashOut || 0)
                  : 0;

                return (
                  <div
                    key={reg.id}
                    className={`p-6 rounded-3xl border shadow-xs hover:shadow-md flex flex-col justify-between transition-all relative overflow-hidden bg-white ${
                      isOpen
                        ? 'border-emerald-300 ring-2 ring-emerald-500/10'
                        : 'border-gray-200'
                    }`}
                  >
                    <div>
                      {/* Header with status badge & delete button */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <span
                          className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border flex items-center gap-1.5 ${
                            isOpen
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : 'bg-gray-100 text-gray-600 border-gray-200'
                          }`}
                        >
                          {isOpen ? (
                            <>
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                              Abierta (Turno Activo)
                            </>
                          ) : (
                            <>
                              <Lock className="w-3 h-3 text-gray-400" />
                              Cerrada
                            </>
                          )}
                        </span>

                        <div className="flex items-center gap-1">
                          {!isOpen && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRegister(reg.id, reg.name)}
                              className="p-1 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-gray-100 transition-colors cursor-pointer"
                              title="Eliminar caja"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <h3 className="text-lg font-black text-gray-900 mb-2">{reg.name}</h3>

                      {isOpen && activeShift ? (
                        <div className="space-y-3 mb-4">
                          {/* Shift metadata */}
                          <div className="p-3 rounded-2xl bg-gray-50 border border-gray-200 space-y-1.5 text-xs">
                            <div className="flex items-center justify-between text-gray-700">
                              <span className="font-semibold text-gray-500 flex items-center gap-1">
                                <User className="w-3.5 h-3.5 text-[#4A5D23]" />
                                Cajero:
                              </span>
                              <span className="font-bold text-gray-900 truncate max-w-[150px]">
                                {activeShift.cashierName || activeShift.openedBy || 'Cajero'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-gray-700">
                              <span className="text-gray-500 flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                Abierta:
                              </span>
                              <span className="font-mono text-gray-700 text-[11px]">
                                {new Date(activeShift.openedAt).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-gray-700">
                              <span className="text-gray-500">Fondo Inicial:</span>
                              <span className="font-mono font-bold text-gray-900">
                                ${(activeShift.initialCash || 0).toFixed(2)}
                              </span>
                            </div>
                          </div>

                          {/* Live Drawer Balance */}
                          <div className="p-4 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/20 flex items-center justify-between">
                            <div>
                              <div className="text-[10px] uppercase font-bold text-[#4A5D23]">
                                EFECTIVO EN CAJA
                              </div>
                              <div className="text-xs text-gray-500">Fondo + Ventas + Ingresos - Retiros</div>
                            </div>
                            <div className="text-2xl font-mono font-black text-[#E89E2D]">
                              ${currentCashInDrawer.toFixed(2)}
                            </div>
                          </div>

                          {/* Audit history count */}
                          <div className="text-[11px] text-gray-600 flex items-center justify-between px-1">
                            <span>Arqueos parciales realizados:</span>
                            <span className="font-mono font-bold text-gray-900">
                              {activeShift.auditHistory?.length || 0}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="p-6 rounded-2xl bg-gray-50 border border-gray-200 text-center my-4">
                          <Lock className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                          <div className="text-xs font-bold text-gray-700">
                            Caja cerrada y bloqueada para cobros
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            Requiere ingresar fondo de caja para operar
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="pt-3 border-t border-gray-100">
                      {isOpen ? (
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            disabled={!isAuthorized}
                            onClick={() => {
                              setSelectedRegister(reg);
                              setMovementAmount('');
                              setMovementReason('');
                              setErrorMsg(null);
                              setIsMovementModalOpen(true);
                            }}
                            className="py-2 px-1 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 text-[11px] font-bold text-center transition-colors cursor-pointer disabled:opacity-40"
                            title="Ingreso o retiro de efectivo"
                          >
                            +/- Movimiento
                          </button>

                          <button
                            type="button"
                            disabled={!isAuthorized}
                            onClick={() => {
                              setSelectedRegister(reg);
                              setErrorMsg(null);
                              setCountedCashInput('');
                              setCountedTransferInput('');
                              setCountedDeUnaInput('');
                              setCountedCardInput('');
                              setAuditNotesInput('');
                              setIsAuditModalOpen(true);
                            }}
                            className="py-2 px-1 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-[11px] font-bold text-center transition-colors cursor-pointer shadow-xs disabled:opacity-40"
                            title="Contar efectivo y métodos digitales sin cerrar turno"
                          >
                            Arqueo
                          </button>

                          <button
                            type="button"
                            disabled={!isAuthorized}
                            onClick={() => {
                              setSelectedRegister(reg);
                              setErrorMsg(null);
                              setCountedCashInput('');
                              setCloseNotesInput('');
                              setShowDenominationCalculator(false);
                              setDenominations({
                                b20: '',
                                b10: '',
                                b5: '',
                                c1: '',
                                c050: '',
                                c025: '',
                                c010: '',
                                c005: '',
                                c001: '',
                              });
                              setIsCloseRegisterModalOpen(true);
                            }}
                            className="py-2 px-1 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold text-center transition-colors cursor-pointer shadow-xs disabled:opacity-40"
                            title="Cierre definitivo y balance"
                          >
                            Cerrar Caja
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!isAuthorized}
                          onClick={() => {
                            setSelectedRegister(reg);
                            setErrorMsg(null);
                            setInitialCashInput('');
                            setIsOpenRegisterModalOpen(true);
                          }}
                          className="w-full py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40"
                        >
                          <Unlock className="w-4 h-4 text-[#E89E2D]" />
                          Abrir Caja (Ingresar Fondo)
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* SUMMARY PLACED DOWN BELOW CAJA 2 (Requirement 10 & Screenshot 3) */}
          <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <Coins className="w-5 h-5 text-[#E89E2D]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-gray-900">Resumen General de Turno Activo</h3>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#4A5D23] text-white">
                      Consolidado
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    Control financiero consolidado de todas las terminales y cajas activas.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">
                  EFECTIVO EN CAJA
                </span>
                <span className="text-2xl font-mono font-black text-[#4A5D23] block mt-1">
                  ${consolidatedStats.totalCashInDrawers.toFixed(2)}
                </span>
                <span className="text-[11px] text-gray-500 mt-0.5 block">
                  {consolidatedStats.openRegistersCount} cajas abiertas actualmente
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">
                  Ventas Cobradas en Turno
                </span>
                <span className="text-2xl font-mono font-black text-[#E89E2D] block mt-1">
                  ${consolidatedStats.openTurnTotalSales.toFixed(2)}
                </span>
                <span className="text-[11px] text-gray-500 mt-0.5 block">
                  Facturación registrada en vivo
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-[#F8F9FA] border border-gray-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">
                  Movimientos (+ Ingresos / - Egresos)
                </span>
                <span className="text-2xl font-mono font-black text-gray-800 block mt-1">
                  {movements.length} ops
                </span>
                <span className="text-[11px] text-gray-500 mt-0.5 block">
                  Flujo de caja menor y gastos
                </span>
              </div>
            </div>

            {/* 6-Field Shift Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-gray-100">
              <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200">
                <span className="text-[10px] font-bold uppercase text-emerald-800 block">Total Efectivo</span>
                <span className="text-sm font-mono font-black text-emerald-900">${consolidatedStats.sumCash.toFixed(2)}</span>
              </div>
              <div className="p-3 rounded-2xl bg-blue-50/70 border border-blue-200">
                <span className="text-[10px] font-bold uppercase text-blue-800 block">Total Tarjeta</span>
                <span className="text-sm font-mono font-black text-blue-900">${consolidatedStats.sumCard.toFixed(2)}</span>
              </div>
              <div className="p-3 rounded-2xl bg-indigo-50/70 border border-indigo-200">
                <span className="text-[10px] font-bold uppercase text-indigo-800 block">Total Transferencia</span>
                <span className="text-sm font-mono font-black text-indigo-900">${consolidatedStats.sumTransfer.toFixed(2)}</span>
              </div>
              <div className="p-3 rounded-2xl bg-purple-50/70 border border-purple-200">
                <span className="text-[10px] font-bold uppercase text-purple-800 block">Total De Una</span>
                <span className="text-sm font-mono font-black text-purple-900">${consolidatedStats.sumDeUna.toFixed(2)}</span>
              </div>
              <div className="p-3 rounded-2xl bg-[#EAF5F0] border border-[#4A5D23]/30">
                <span className="text-[10px] font-bold uppercase text-[#4A5D23] block">Ingresos de caja</span>
                <span className="text-sm font-mono font-black text-[#4A5D23]">+${consolidatedStats.sumIn.toFixed(2)}</span>
              </div>
              <div className="p-3 rounded-2xl bg-rose-50/70 border border-rose-200">
                <span className="text-[10px] font-bold uppercase text-rose-800 block">Egresos de caja</span>
                <span className="text-sm font-mono font-black text-rose-800">-${consolidatedStats.sumOut.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* TAB 2: HISTORIAL DE CIERRES */}
      {activeTab === 'historial' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Turnos de Caja Finalizados ({closedShifts.length})
            </div>
            {closedShifts.length > 50 && (
              <button
                type="button"
                onClick={() => setShowAllClosedShifts((prev) => !prev)}
                className="px-3 py-1.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-xs font-bold text-[#4A5D23] cursor-pointer"
              >
                {showAllClosedShifts ? 'Mostrar últimos 50' : `Ver todos (${closedShifts.length})`}
              </button>
            )}
          </div>

          {closedShifts.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-gray-200">
              <History className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <h3 className="text-base font-bold text-gray-900">No hay cierres registrados aún</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Los turnos cerrados aparecerán aquí con su balance de efectivo esperado vs contado y diferencias.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F8F9FA] text-gray-700 uppercase tracking-wider border-b border-gray-200 font-bold text-[11px]">
                    <tr>
                      <th className="p-3.5">Caja / Cajero</th>
                      <th className="p-3.5">Apertura / Cierre</th>
                      <th className="p-3.5 text-right">Efectivo</th>
                      <th className="p-3.5 text-right">Tarjeta</th>
                      <th className="p-3.5 text-right">Transf.</th>
                      <th className="p-3.5 text-right">De Una</th>
                      <th className="p-3.5 text-right">Ingresos / Egresos</th>
                      <th className="p-3.5 text-right">Esperado / Contado</th>
                      <th className="p-3.5 text-right">Diferencia</th>
                      <th className="p-3.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleClosedShifts.map((shift) => {
                        const diff = shift.difference || 0;
                        const isMatch = Math.abs(diff) < 0.01;
                        const isSurplus = diff > 0.01;

                        return (
                          <tr key={shift.id} className="hover:bg-gray-50/70 transition-colors">
                            <td className="p-3.5">
                              <div className="font-bold text-gray-900">{shift.registerName}</div>
                              <div className="text-[11px] text-gray-500">{shift.cashierName || shift.openedBy || 'Cajero'}</div>
                            </td>
                            <td className="p-3.5 text-gray-500 font-mono text-[11px]">
                              <div>Ap: {new Date(shift.openedAt).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })}</div>
                              <div>Ci: {shift.closedAt ? new Date(shift.closedAt).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</div>
                            </td>
                            <td className="p-3.5 text-right font-mono font-bold text-emerald-700">
                              ${(shift.cashSales || 0).toFixed(2)}
                            </td>
                            <td className="p-3.5 text-right font-mono font-bold text-gray-800">
                              ${(shift.cardSales || 0).toFixed(2)}
                            </td>
                            <td className="p-3.5 text-right font-mono font-bold text-gray-800">
                              ${(shift.transferSales || 0).toFixed(2)}
                            </td>
                            <td className="p-3.5 text-right font-mono font-bold text-gray-800">
                              ${(shift.deUnaSales || 0).toFixed(2)}
                            </td>
                            <td className="p-3.5 text-right font-mono text-[11px]">
                              <div className="text-emerald-700 font-bold">+${(shift.cashIn || 0).toFixed(2)}</div>
                              <div className="text-rose-600 font-bold">-${(shift.cashOut || 0).toFixed(2)}</div>
                            </td>
                            <td className="p-3.5 text-right font-mono text-[11px]">
                              <div className="text-[#4A5D23] font-bold">Esp: ${(shift.expectedCash || 0).toFixed(2)}</div>
                              <div className="text-gray-900 font-black">Cont: ${(shift.actualCashCounted || 0).toFixed(2)}</div>
                            </td>
                            <td className="p-3.5 text-right font-mono font-bold">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isMatch
                                    ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                    : isSurplus
                                    ? 'text-[#D97706] bg-amber-50 border border-amber-200'
                                    : 'text-rose-700 bg-rose-50 border border-rose-200'
                                }`}
                              >
                                {diff >= 0 ? `+$${diff.toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`}
                              </span>
                            </td>
                            <td className="p-3.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => handlePrintShiftReport(shift)}
                                  className="px-2.5 py-1 rounded-lg text-[#4A5D23] bg-[#EAF5F0] hover:bg-[#dceee5] transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-bold"
                                  title="Imprimir Cierre de Caja"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                  <span className="hidden xl:inline">Imprimir Cierre</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteShift(shift.id)}
                                  className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Eliminar registro"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MOVIMIENTOS DE EFECTIVO */}
      {activeTab === 'movimientos' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Entradas y Salidas de Efectivo ({movements.length})
            </div>
            {movements.length > 50 && (
              <button
                type="button"
                onClick={() => setShowAllMovements((prev) => !prev)}
                className="px-3 py-1.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-xs font-bold text-[#4A5D23] cursor-pointer"
              >
                {showAllMovements ? 'Mostrar últimos 50' : `Ver todos (${movements.length})`}
              </button>
            )}
          </div>

          {movements.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-gray-200">
              <FileSpreadsheet className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <h3 className="text-base font-bold text-gray-900">No hay movimientos registrados</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                Los retiros para compras menores o ingresos extras de efectivo en caja se listarán aquí.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F8F9FA] text-gray-700 uppercase tracking-wider border-b border-gray-200 font-bold text-[11px]">
                    <tr>
                      <th className="p-4">Fecha</th>
                      <th className="p-4">Tipo</th>
                      <th className="p-4">Monto</th>
                      <th className="p-4">Motivo / Concepto</th>
                      <th className="p-4">Responsable</th>
                      <th className="p-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleMovements.map((m) => {
                      const isIn = m.type === 'in' || (m.type as string) === 'ingreso';
                      return (
                        <tr key={m.id} className="hover:bg-gray-50/70 transition-colors">
                          <td className="p-4 text-gray-500 font-mono text-[11px]">
                            {new Date(m.createdAt).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                          <td className="p-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                isIn
                                  ? 'bg-[#EAF5F0] text-[#4A5D23] border-[#4A5D23]/30'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}
                            >
                              {isIn ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                              {isIn ? 'Ingreso Extra' : 'Retiro de Caja'}
                            </span>
                          </td>
                          <td className="p-4 font-mono font-black text-sm text-gray-900">
                            {isIn ? `+$${m.amount.toFixed(2)}` : `-$${m.amount.toFixed(2)}`}
                          </td>
                          <td className="p-4 font-bold text-gray-900">{m.reason}</td>
                          <td className="p-4 text-gray-600">{m.performedBy}</td>
                          <td className="p-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteMovement(m.id)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Eliminar movimiento"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: ABRIR CAJA (FONDO DE CAJA INICIAL) */}
      {isOpenRegisterModalOpen && selectedRegister && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 relative">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <Unlock className="w-5 h-5 text-[#D97706]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Abrir {selectedRegister.name}</h3>
                  <p className="text-xs text-gray-500">Ingresa el fondo de cambio inicial</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpenRegisterModalOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form noValidate onSubmit={handleOpenRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                  Fondo de Caja Inicial ($) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    value={initialCashInput}
                    onChange={(e) => setInitialCashInput(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl pl-10 pr-4 py-2.5 text-base font-mono font-bold text-gray-900 focus:outline-none"
                    autoFocus
                  />
                </div>
                <p className="text-[11px] text-gray-500 mt-1.5">
                  Monto en monedas y billetes entregado al cajero para comenzar el turno.
                </p>
              </div>

              {/* Cashier attribution */}
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between text-xs text-gray-700">
                <span className="flex items-center gap-1.5 font-semibold">
                  <User className="w-3.5 h-3.5 text-[#4A5D23]" />
                  Cajero Responsable:
                </span>
                <span className="font-bold text-gray-900">
                  {userProfile?.name} {userProfile?.lastName || ''} ({translateRoleToSpanish(userRole)})
                </span>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setIsOpenRegisterModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs border border-gray-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !initialCashInput}
                  className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all disabled:opacity-40 cursor-pointer shadow-xs"
                >
                  {isSubmitting ? 'Abriendo...' : 'Confirmar Apertura'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ARQUEO PARCIAL (SIN CERRAR CAJA — FÍSICO Y DIGITAL) */}
      {isAuditModalOpen && selectedRegister && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto text-gray-900">
          <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-3xl shadow-2xl p-5 sm:p-7 relative max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 mb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <Calculator className="w-5 h-5 text-[#D97706]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Arqueo Parcial de Caja</h3>
                  <p className="text-xs text-gray-500">
                    {selectedRegister.name} (El turno sigue abierto — Comparativa Físico y Digital)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAuditModalOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 shrink-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {(() => {
              const shift = getActiveShiftForRegister(selectedRegister);
              const expectedCash = shift
                ? (shift.initialCash || 0) + (shift.cashSales || 0) + (shift.cashIn || 0) - (shift.cashOut || 0)
                : 0;
              const expectedTransfer = shift?.transferSales || 0;
              const expectedDeUna = shift?.deUnaSales || 0;
              const expectedCard = shift?.cardSales || 0;

              const countedCash = parseFloat(countedCashInput) || 0;
              const countedTransfer = parseFloat(countedTransferInput) || 0;
              const countedDeUna = parseFloat(countedDeUnaInput) || 0;
              const countedCard = parseFloat(countedCardInput) || 0;

              const diffCash = countedCashInput !== '' ? countedCash - expectedCash : 0;
              const diffTransfer = countedTransferInput !== '' ? countedTransfer - expectedTransfer : 0;
              const diffDeUna = countedDeUnaInput !== '' ? countedDeUna - expectedDeUna : 0;
              const diffCard = countedCardInput !== '' ? countedCard - expectedCard : 0;

              const totalExpectedAll = expectedCash + expectedTransfer + expectedDeUna + expectedCard;
              const totalCountedAll = countedCash + countedTransfer + countedDeUna + countedCard;
              const hasAnyInput =
                countedCashInput !== '' ||
                countedTransferInput !== '' ||
                countedDeUnaInput !== '' ||
                countedCardInput !== '';
              const totalDiffAll = hasAnyInput ? totalCountedAll - totalExpectedAll : 0;

              const renderDiffPill = (entered: boolean, diffVal: number) => {
                if (!entered) {
                  return <span className="text-[11px] text-gray-400 italic">Ingresa monto para comparar</span>;
                }
                if (Math.abs(diffVal) < 0.01) {
                  return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold font-mono">
                      ✓ Cuadrado ($0.00)
                    </span>
                  );
                }
                if (diffVal > 0) {
                  return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold font-mono">
                      +${diffVal.toFixed(2)} Sobrante
                    </span>
                  );
                }
                return (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold font-mono">
                    -${Math.abs(diffVal).toFixed(2)} Faltante
                  </span>
                );
              };

              return (
                <form noValidate onSubmit={handleSaveAudit} className="space-y-4 overflow-y-auto pr-1">
                  {/* Resumen Sistema de Todos los Métodos de Pago */}
                  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2 text-xs">
                    <div className="text-[11px] font-black uppercase tracking-wider text-[#4A5D23] mb-1">
                      Resumen Registrado en Sistema hasta el Momento
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="p-2.5 rounded-xl bg-white border border-emerald-200">
                        <span className="text-[10px] font-bold uppercase text-emerald-700 block">Efectivo Esperado</span>
                        <span className="font-mono font-black text-sm text-gray-900">${expectedCash.toFixed(2)}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-white border border-indigo-200">
                        <span className="text-[10px] font-bold uppercase text-indigo-700 block">Transferencia</span>
                        <span className="font-mono font-black text-sm text-gray-900">${expectedTransfer.toFixed(2)}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-white border border-purple-200">
                        <span className="text-[10px] font-bold uppercase text-purple-700 block">De Una</span>
                        <span className="font-mono font-black text-sm text-gray-900">${expectedDeUna.toFixed(2)}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-white border border-blue-200">
                        <span className="text-[10px] font-bold uppercase text-blue-700 block">Tarjeta Crédito</span>
                        <span className="font-mono font-black text-sm text-gray-900">${expectedCard.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-gray-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-600">
                      <span>
                        Fondo Inicial: <strong className="font-mono text-gray-900">${(shift?.initialCash || 0).toFixed(2)}</strong>
                      </span>
                      <span>
                        Ventas Efectivo: <strong className="font-mono text-emerald-700">+${(shift?.cashSales || 0).toFixed(2)}</strong>
                      </span>
                      <span>
                        Ingresos/Egresos:{' '}
                        <strong className="font-mono text-gray-800">
                          +${(shift?.cashIn || 0).toFixed(2)} / -${(shift?.cashOut || 0).toFixed(2)}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Campos de Conteo Físico y Digital para Comparar */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* 1. Efectivo Físico */}
                    <div className="p-3.5 rounded-2xl border border-gray-200 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-gray-800">
                          1. Efectivo Físico ($) <span className="text-rose-500">*</span>
                        </label>
                        <span className="text-[11px] font-mono text-gray-500">Esp: ${expectedCash.toFixed(2)}</span>
                      </div>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          placeholder="0.00"
                          value={countedCashInput}
                          onChange={(e) => setCountedCashInput(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl pl-9 pr-3 py-2 text-sm font-mono font-bold text-gray-900 focus:outline-none"
                          autoFocus
                        />
                      </div>
                      <div>{renderDiffPill(countedCashInput !== '', diffCash)}</div>
                    </div>

                    {/* 2. Transferencia */}
                    <div className="p-3.5 rounded-2xl border border-gray-200 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-gray-800">
                          2. Transferencias ($)
                        </label>
                        <span className="text-[11px] font-mono text-gray-500">Esp: ${expectedTransfer.toFixed(2)}</span>
                      </div>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={countedTransferInput}
                          onChange={(e) => setCountedTransferInput(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl pl-9 pr-3 py-2 text-sm font-mono font-bold text-gray-900 focus:outline-none"
                        />
                      </div>
                      <div>{renderDiffPill(countedTransferInput !== '', diffTransfer)}</div>
                    </div>

                    {/* 3. De Una */}
                    <div className="p-3.5 rounded-2xl border border-gray-200 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-gray-800">
                          3. De Una ($)
                        </label>
                        <span className="text-[11px] font-mono text-gray-500">Esp: ${expectedDeUna.toFixed(2)}</span>
                      </div>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={countedDeUnaInput}
                          onChange={(e) => setCountedDeUnaInput(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl pl-9 pr-3 py-2 text-sm font-mono font-bold text-gray-900 focus:outline-none"
                        />
                      </div>
                      <div>{renderDiffPill(countedDeUnaInput !== '', diffDeUna)}</div>
                    </div>

                    {/* 4. Tarjeta de Crédito */}
                    <div className="p-3.5 rounded-2xl border border-gray-200 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-gray-800">
                          4. Tarjeta de Crédito ($)
                        </label>
                        <span className="text-[11px] font-mono text-gray-500">Esp: ${expectedCard.toFixed(2)}</span>
                      </div>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={countedCardInput}
                          onChange={(e) => setCountedCardInput(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl pl-9 pr-3 py-2 text-sm font-mono font-bold text-gray-900 focus:outline-none"
                        />
                      </div>
                      <div>{renderDiffPill(countedCardInput !== '', diffCard)}</div>
                    </div>
                  </div>

                  {/* Comparativa Global Físico + Digital */}
                  <div
                    className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-bold ${
                      !hasAnyInput
                        ? 'bg-gray-50 border-gray-200 text-gray-700'
                        : Math.abs(totalDiffAll) < 0.01
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : totalDiffAll > 0
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase font-black tracking-wider">
                        Comparativa General (Físico + Digital)
                      </div>
                      <div className="text-xs font-semibold">
                        Esperado Total: <span className="font-mono">${totalExpectedAll.toFixed(2)}</span> · Contado:{' '}
                        <span className="font-mono">${totalCountedAll.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="font-mono text-base font-black">
                      {!hasAnyInput
                        ? 'Pendiente de conteo'
                        : Math.abs(totalDiffAll) < 0.01
                        ? 'Cuadrado ($0.00)'
                        : totalDiffAll > 0
                        ? `+$${totalDiffAll.toFixed(2)} (Sobrante)`
                        : `-$${Math.abs(totalDiffAll).toFixed(2)} (Faltante)`}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                      Observación / Nota del Arqueo
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Arqueo de cambio de guardia, vouchers verificados..."
                      value={auditNotesInput}
                      onChange={(e) => setAuditNotesInput(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => setIsAuditModalOpen(false)}
                      className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs border border-gray-200 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !countedCashInput}
                      className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all disabled:opacity-40 cursor-pointer shadow-xs"
                    >
                      {isSubmitting ? 'Guardando...' : 'Registrar Arqueo'}
                    </button>
                  </div>
                </form>
              );
            })()}
          </div>
        </div>
      )}

      {/* MODAL 3: ARQUEO Y CIERRE DE CAJA DEFINITIVO */}
      {isCloseRegisterModalOpen && selectedRegister && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
          <div className="w-full max-w-lg bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 relative">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Cierre Definitivo de Turno</h3>
                  <p className="text-xs text-gray-500">{selectedRegister.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCloseRegisterModalOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {(() => {
              const shift = getActiveShiftForRegister(selectedRegister);
              const expected = shift
                ? (shift.initialCash || 0) + (shift.cashSales || 0) + (shift.cashIn || 0) - (shift.cashOut || 0)
                : (selectedRegister.initialCash || 0) + (selectedRegister.totalSales || 0);
              const hasCountedInput = countedCashInput.trim() !== '' && !isNaN(parseFloat(countedCashInput));
              const counted = hasCountedInput ? parseFloat(countedCashInput) : 0;
              const diff = hasCountedInput ? counted - expected : 0;
              const hasFaltante = hasCountedInput && diff < -0.005;
              const hasSobrante = hasCountedInput && diff > 0.005;

              const totalGeneralCaja =
                (shift?.initialCash || 0) +
                (shift?.cashSales || 0) +
                (shift?.transferSales || 0) +
                (shift?.deUnaSales || 0) +
                (shift?.cardSales || 0) +
                (shift?.cashIn || 0) -
                (shift?.cashOut || 0);

              const handleDenomChange = (key: keyof typeof denominations, rawVal: string) => {
                const updated = { ...denominations, [key]: rawVal };
                setDenominations(updated);
                const anyFilled = Object.values(updated).some((v) => v.trim() !== '');
                if (anyFilled) {
                  const sum =
                    (parseInt(updated.b20, 10) || 0) * 20 +
                    (parseInt(updated.b10, 10) || 0) * 10 +
                    (parseInt(updated.b5, 10) || 0) * 5 +
                    (parseInt(updated.c1, 10) || 0) * 1 +
                    (parseInt(updated.c050, 10) || 0) * 0.5 +
                    (parseInt(updated.c025, 10) || 0) * 0.25 +
                    (parseInt(updated.c010, 10) || 0) * 0.1 +
                    (parseInt(updated.c005, 10) || 0) * 0.05 +
                    (parseInt(updated.c001, 10) || 0) * 0.01;
                  setCountedCashInput(sum.toFixed(2));
                } else {
                  setCountedCashInput('');
                }
              };

              const denomSum =
                (parseInt(denominations.b20, 10) || 0) * 20 +
                (parseInt(denominations.b10, 10) || 0) * 10 +
                (parseInt(denominations.b5, 10) || 0) * 5 +
                (parseInt(denominations.c1, 10) || 0) * 1 +
                (parseInt(denominations.c050, 10) || 0) * 0.5 +
                (parseInt(denominations.c025, 10) || 0) * 0.25 +
                (parseInt(denominations.c010, 10) || 0) * 0.1 +
                (parseInt(denominations.c005, 10) || 0) * 0.05 +
                (parseInt(denominations.c001, 10) || 0) * 0.01;

              return (
                <form noValidate onSubmit={handleCloseRegister} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
                  {/* Financial breakdown (6 explicit totals required on Shift Close) */}
                  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-1.5 text-xs">
                    <div className="flex justify-between text-gray-600">
                      <span>Fondo de Caja Inicial:</span>
                      <span className="font-mono font-bold text-gray-900">${(shift?.initialCash || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-700">
                      <span>Total vendido en Efectivo:</span>
                      <span className="font-mono font-bold text-emerald-700">+${(shift?.cashSales || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-700">
                      <span>Total vendido en Transferencia:</span>
                      <span className="font-mono font-bold text-gray-900">${(shift?.transferSales || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-700">
                      <span>Total vendido en De Una:</span>
                      <span className="font-mono font-bold text-gray-900">${(shift?.deUnaSales || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-700">
                      <span>Total vendido en Tarjeta de Crédito:</span>
                      <span className="font-mono font-bold text-gray-900">${(shift?.cardSales || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-700">
                      <span>Total de Ingresos de caja:</span>
                      <span className="font-mono font-bold text-[#4A5D23]">+${(shift?.cashIn || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-gray-700">
                      <span>Total de Egresos de caja:</span>
                      <span className="font-mono font-bold text-rose-600">-${(shift?.cashOut || 0).toFixed(2)}</span>
                    </div>
                    <div className="pt-2 border-t border-gray-200 flex justify-between font-bold text-xs">
                      <span className="text-gray-900">Total Ventas del Turno / Día:</span>
                      <span className="font-mono font-black text-[#4A5D23]">
                        ${(shift ? getDayTotalSales(shift) : selectedRegister.totalSales || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between font-black text-xs bg-[#EAF5F0] px-2.5 py-1.5 rounded-xl border border-[#4A5D23]/20">
                      <span className="text-[#4A5D23]">TOTAL GENERAL DE LA CAJA:</span>
                      <span className="font-mono text-sm text-[#4A5D23]">${totalGeneralCaja.toFixed(2)}</span>
                    </div>
                    <div className="pt-1 flex justify-between font-bold text-sm">
                      <span className="text-gray-800">Efectivo Teórico Esperado en Caja:</span>
                      <span className="font-mono text-base text-[#D97706]">${expected.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Optional Billetes & Monedas Calculator */}
                  <div className="border border-gray-200 rounded-2xl bg-[#F8F9FA] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowDenominationCalculator((prev) => !prev)}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-bold text-[#4A5D23] hover:bg-gray-100/70 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Coins className="w-4 h-4 text-[#E89E2D]" />
                        Desglose de Billetes y Monedas (Opcional)
                      </span>
                      <span className="text-[11px] font-mono font-bold text-gray-600">
                        {showDenominationCalculator ? 'Ocultar ▲' : `Total contado: $${denomSum.toFixed(2)} ▼`}
                      </span>
                    </button>

                    {showDenominationCalculator && (
                      <div className="p-3.5 pt-1 border-t border-gray-200 space-y-3 bg-white">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1.5">
                            Billetes (Cantidad)
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { key: 'b20' as const, label: '$20' },
                              { key: 'b10' as const, label: '$10' },
                              { key: 'b5' as const, label: '$5' },
                            ].map((d) => (
                              <div key={d.key} className="bg-gray-50 border border-gray-200 rounded-xl p-2 flex items-center justify-between gap-1.5">
                                <span className="text-xs font-black text-[#4A5D23]">{d.label}</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  placeholder="0"
                                  value={denominations[d.key]}
                                  onChange={(e) => handleDenomChange(d.key, e.target.value)}
                                  className="w-14 bg-white border border-gray-200 rounded-lg px-2 py-1 text-right text-xs font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1.5">
                            Monedas (Cantidad)
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { key: 'c1' as const, label: '$1' },
                              { key: 'c050' as const, label: '$0.50' },
                              { key: 'c025' as const, label: '$0.25' },
                              { key: 'c010' as const, label: '$0.10' },
                              { key: 'c005' as const, label: '$0.05' },
                              { key: 'c001' as const, label: '$0.01' },
                            ].map((d) => (
                              <div key={d.key} className="bg-gray-50 border border-gray-200 rounded-xl p-2 flex items-center justify-between gap-1.5">
                                <span className="text-xs font-bold text-gray-700">{d.label}</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  placeholder="0"
                                  value={denominations[d.key]}
                                  onChange={(e) => handleDenomChange(d.key, e.target.value)}
                                  className="w-14 bg-white border border-gray-200 rounded-lg px-2 py-1 text-right text-xs font-mono font-bold text-gray-900 focus:outline-none focus:border-[#4A5D23]"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                      EFECTIVO EN CAJA Contado ($) <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        placeholder="0.00"
                        value={countedCashInput}
                        onChange={(e) => setCountedCashInput(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl pl-10 pr-4 py-2.5 text-base font-mono font-bold text-gray-900 focus:outline-none"
                        autoFocus
                      />
                    </div>
                  </div>

                  {/* Shortage Red Lock Alert */}
                  {hasFaltante && (
                    <div className="p-3.5 rounded-2xl bg-rose-50 border-2 border-rose-400 text-rose-800 space-y-1 text-xs">
                      <div className="flex items-center justify-between font-black">
                        <span className="flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                          FALTANTE DETECTADO — CIERRE BLOQUEADO
                        </span>
                        <span className="font-mono text-base">-${Math.abs(diff).toFixed(2)}</span>
                      </div>
                      <p className="font-semibold text-rose-700 leading-relaxed">
                        El efectivo contado (${counted.toFixed(2)}) es menor al esperado (${expected.toFixed(2)}). No se puede cerrar la caja hasta cuadrar el efectivo.
                      </p>
                    </div>
                  )}

                  {/* Separate Sobrante Field (Not added to sales) */}
                  {hasSobrante && (
                    <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <label className="font-black uppercase tracking-wider text-amber-900">
                          Sobrante
                        </label>
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                          Registro independiente
                        </span>
                      </div>
                      <input
                        type="text"
                        readOnly
                        value={`$${diff.toFixed(2)}`}
                        className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 font-mono text-base font-black text-amber-800 focus:outline-none"
                      />
                      <p className="text-[11px] text-amber-800 font-medium">
                        Este valor se registra como sobrante y NO se suma al total de ventas del día.
                      </p>
                    </div>
                  )}

                  {/* Balanced indicator */}
                  {hasCountedInput && !hasFaltante && !hasSobrante && (
                    <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs font-bold text-emerald-800">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Caja cuadrada exactamente con el esperado
                      </span>
                      <span className="font-mono text-sm font-black">$0.00</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1">
                      Observaciones de Cierre (Opcional)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Notas sobre el turno, justificación de diferencia o entrega de remesa..."
                      value={closeNotesInput}
                      onChange={(e) => setCloseNotesInput(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-xl p-3 text-xs text-gray-900 focus:outline-none resize-none"
                    />
                  </div>

                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => {
                        if (shift) {
                          handlePrintShiftReport({
                            ...shift,
                            actualCashCounted: counted,
                            expectedCash: expected,
                            difference: counted - expected,
                            surplusAmount: diff > 0.005 ? Number(diff.toFixed(2)) : 0,
                            closingNotes: closeNotesInput.trim(),
                          });
                        }
                      }}
                      className="px-3.5 py-2.5 rounded-xl bg-[#EAF5F0] hover:bg-[#dceee5] text-[#4A5D23] border border-[#4A5D23]/30 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Imprimir Cierre de Caja
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsCloseRegisterModalOpen(false)}
                        className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-xs border border-gray-200 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmitting || !hasCountedInput || hasFaltante}
                        className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs"
                      >
                        {isSubmitting ? 'Cerrando Turno...' : 'Cerrar Caja'}
                      </button>
                    </div>
                  </div>
                </form>
              );
            })()}
          </div>
        </div>
      )}

      {/* MODAL 4: INGRESO / RETIRO DE EFECTIVO */}
      {isMovementModalOpen && selectedRegister && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 relative">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <Banknote className="w-5 h-5 text-[#D97706]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Movimiento de Caja</h3>
                  <p className="text-xs text-gray-500">{selectedRegister.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMovementModalOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form noValidate onSubmit={handleSaveMovement} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-2">
                  Tipo de Movimiento <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMovementType('out')}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                      movementType === 'out'
                        ? 'bg-rose-50 border-rose-400 text-rose-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4 text-rose-500" />
                    Retiro de Caja
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovementType('in')}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                      movementType === 'in'
                        ? 'bg-[#4A5D23] border-[#4A5D23] text-white shadow-xs'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <ArrowDownRight className="w-4 h-4 text-[#D97706]" />
                    Ingreso Extra
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                  Monto ($) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={movementAmount}
                    onChange={(e) => setMovementAmount(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl pl-10 pr-4 py-2.5 text-base font-mono font-bold text-gray-900 focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                  Motivo / Justificación <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Compra de insumos, cambio o pago a proveedor..."
                  value={movementReason}
                  onChange={(e) => setMovementReason(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:bg-white rounded-xl px-3 py-2 text-xs text-gray-900 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setIsMovementModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs border border-gray-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !movementAmount || !movementReason}
                  className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all disabled:opacity-40 cursor-pointer shadow-xs"
                >
                  {isSubmitting ? 'Registrando...' : 'Registrar Movimiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: NUEVA CAJA REGISTRADORA */}
      {isNewRegisterModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 relative">
            <div className="flex items-center justify-between pb-4 border-b border-gray-200 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <Coins className="w-5 h-5 text-[#D97706]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Nueva Caja Registradora</h3>
                  <p className="text-xs text-gray-500">Agrega un punto de cobro independiente</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewRegisterModalOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form noValidate onSubmit={handleCreateRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                  Nombre de la Caja <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Caja 3 - Terraza VIP"
                  value={newRegisterName}
                  onChange={(e) => setNewRegisterName(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-[#4A5D23] rounded-xl px-3 py-2.5 text-xs text-gray-900 focus:outline-none"
                  autoFocus
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setIsNewRegisterModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs border border-gray-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newRegisterName.trim()}
                  className="px-5 py-2 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold transition-all disabled:opacity-40 cursor-pointer shadow-xs"
                >
                  {isSubmitting ? 'Guardando...' : 'Crear Caja'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Delete Modal (replaces window.confirm) */}
      {confirmDeleteTarget && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-black text-gray-900">Confirmar Eliminación</h4>
                <p className="text-xs text-gray-500">Esta acción no se puede deshacer.</p>
              </div>
            </div>
            <p className="text-xs text-gray-700">
              ¿Deseas eliminar <strong className="text-gray-900">{confirmDeleteTarget.label}</strong>?
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setConfirmDeleteTarget(null)}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteDeleteTarget}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                Sí, Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-Close Summary & Direct Print Modal */}
      {isCloseSummaryOpen && lastClosedShift && (
        <div className="fixed inset-0 z-[65] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto text-gray-900">
          <div className="w-full max-w-lg bg-white border border-gray-200 rounded-3xl shadow-2xl p-6 sm:p-7 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#EAF5F0] border border-[#4A5D23]/30 flex items-center justify-center text-[#4A5D23]">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900">Cierre de Caja Completado</h3>
                  <p className="text-xs text-gray-500">
                    {lastClosedShift.registerName} · Cajero: {lastClosedShift.closedBy || lastClosedShift.cashierName || 'Cajero'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCloseSummaryOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(() => {
              const totalSales = Math.max(
                lastClosedShift.totalSales || 0,
                (lastClosedShift.cashSales || 0) +
                  (lastClosedShift.transferSales || 0) +
                  (lastClosedShift.deUnaSales || 0) +
                  (lastClosedShift.cardSales || 0)
              );
              const totalGeneral =
                (lastClosedShift.initialCash || 0) +
                (lastClosedShift.cashSales || 0) +
                (lastClosedShift.transferSales || 0) +
                (lastClosedShift.deUnaSales || 0) +
                (lastClosedShift.cardSales || 0) +
                (lastClosedShift.cashIn || 0) -
                (lastClosedShift.cashOut || 0);

              return (
                <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total vendido en Efectivo:</span>
                    <span className="font-mono font-bold text-emerald-700">${(lastClosedShift.cashSales || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total vendido en Transferencia:</span>
                    <span className="font-mono font-bold text-gray-900">${(lastClosedShift.transferSales || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total vendido en De Una:</span>
                    <span className="font-mono font-bold text-gray-900">${(lastClosedShift.deUnaSales || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total vendido en Tarjeta de Crédito:</span>
                    <span className="font-mono font-bold text-gray-900">${(lastClosedShift.cardSales || 0).toFixed(2)}</span>
                  </div>
                  <div className="pt-2 border-t border-gray-200 flex justify-between">
                    <span className="text-gray-600">Fondo Inicial de Caja:</span>
                    <span className="font-mono font-bold text-gray-900">${(lastClosedShift.initialCash || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Ingresos / Egresos de Caja:</span>
                    <span className="font-mono font-bold">
                      <span className="text-[#4A5D23]">+${(lastClosedShift.cashIn || 0).toFixed(2)}</span> /{' '}
                      <span className="text-rose-600">-${(lastClosedShift.cashOut || 0).toFixed(2)}</span>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Ventas del Turno:</span>
                    <span className="font-mono font-bold text-gray-900">${totalSales.toFixed(2)}</span>
                  </div>
                  {(lastClosedShift.surplusAmount || 0) > 0 && (
                    <div className="flex justify-between text-amber-800 bg-amber-50 px-2.5 py-1.5 rounded-xl border border-amber-200">
                      <span className="font-bold">Sobrante Registrado (No suma a ventas):</span>
                      <span className="font-mono font-black">+${(lastClosedShift.surplusAmount || 0).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-gray-200 flex justify-between items-center bg-[#EAF5F0] p-2.5 rounded-xl border border-[#4A5D23]/20">
                    <span className="font-black text-[#4A5D23] uppercase">Total General de la Caja:</span>
                    <span className="font-mono text-base font-black text-[#4A5D23]">${totalGeneral.toFixed(2)}</span>
                  </div>
                </div>
              );
            })()}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsCloseSummaryOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold cursor-pointer"
              >
                Cerrar Ventana
              </button>
              <button
                type="button"
                onClick={() => handlePrintShiftReport(lastClosedShift)}
                className="px-5 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold flex items-center gap-2 shadow-xs cursor-pointer"
              >
                <Printer className="w-4 h-4 text-[#E89E2D]" />
                Imprimir Reporte de Cierre
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Shift Report (.sheet-print-area) */}
      {shiftToPrint && (
        <div className="hidden print:block sheet-print-area bg-white text-black p-6 space-y-4 font-mono text-xs">
          {(() => {
            const cashSales = shiftToPrint.cashSales || 0;
            const transferSales = shiftToPrint.transferSales || 0;
            const deUnaSales = shiftToPrint.deUnaSales || 0;
            const cardSales = shiftToPrint.cardSales || 0;
            const initialCash = shiftToPrint.initialCash || 0;
            const cashIn = shiftToPrint.cashIn || 0;
            const cashOut = shiftToPrint.cashOut || 0;
            const netMovements = cashIn - cashOut;
            const totalTurnSales = Math.max(
              shiftToPrint.totalSales || 0,
              cashSales + transferSales + deUnaSales + cardSales
            );
            const totalGeneralCaja =
              initialCash + cashSales + transferSales + deUnaSales + cardSales + cashIn - cashOut;
            const shiftMovements = movements.filter((m) => m.shiftId === shiftToPrint.id);

            return (
              <>
                <div className="border-b-2 border-black pb-2 flex justify-between items-center">
                  <div>
                    <h1 className="text-base font-black uppercase">
                      GASTROLAB by Iván Muñoz — CIERRE DE CAJA DETALLADO
                    </h1>
                    <p>
                      Terminal: {shiftToPrint.registerName} · Cajero:{' '}
                      {shiftToPrint.cashierName || shiftToPrint.openedBy || 'Cajero'}
                    </p>
                    {shiftToPrint.closedBy && <p>Cerrado por: {shiftToPrint.closedBy}</p>}
                  </div>
                  <div className="text-right">
                    <div>Apertura: {new Date(shiftToPrint.openedAt).toLocaleString('es-EC')}</div>
                    <div>
                      Cierre:{' '}
                      {shiftToPrint.closedAt
                        ? new Date(shiftToPrint.closedAt).toLocaleString('es-EC')
                        : new Date().toLocaleString('es-EC')}
                    </div>
                  </div>
                </div>

                {/* 1. Desglose de Ventas por Método de Pago */}
                <div className="border-2 border-black p-3 space-y-1.5">
                  <div className="font-black uppercase border-b border-black pb-1 mb-1">
                    Desglose Exacto de Ventas por Método de Pago
                  </div>
                  <div className="flex justify-between">
                    <span>Total vendido en Efectivo:</span>
                    <span className="font-bold">${cashSales.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total vendido en Transferencia:</span>
                    <span className="font-bold">${transferSales.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total vendido en De Una:</span>
                    <span className="font-bold">${deUnaSales.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total vendido en Tarjeta de Crédito:</span>
                    <span className="font-bold">${cardSales.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-black pt-1.5 mt-1.5 flex justify-between font-black">
                    <span>Total Ventas del Turno:</span>
                    <span>${totalTurnSales.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-dashed border-black pt-1">
                    <span>Total Ventas Acumuladas del Día:</span>
                    <span>${getDayTotalSales(shiftToPrint).toFixed(2)}</span>
                  </div>
                </div>

                {/* 2. Ingresos y Egresos de Caja */}
                <div className="border border-black p-3 space-y-1.5">
                  <div className="font-black uppercase border-b border-black pb-1 mb-1">
                    Ingresos y Egresos de Caja
                  </div>
                  <div className="flex justify-between">
                    <span>Total Ingresos Extra de Caja (+):</span>
                    <span className="font-bold">+${cashIn.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Egresos / Retiros de Caja (-):</span>
                    <span className="font-bold">-${cashOut.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-dashed border-black pt-1">
                    <span>Neto Movimientos de Caja (Ingresos - Egresos):</span>
                    <span>
                      {netMovements >= 0
                        ? `+$${netMovements.toFixed(2)}`
                        : `-$${Math.abs(netMovements).toFixed(2)}`}
                    </span>
                  </div>

                  {shiftMovements.length > 0 && (
                    <div className="pt-2 mt-1 border-t border-black space-y-1">
                      <div className="font-bold uppercase text-[10px]">Detalle de Movimientos Registrados:</div>
                      {shiftMovements.map((m) => {
                        const isIn = m.type === 'in' || (m.type as string) === 'ingreso';
                        return (
                          <div key={m.id} className="flex justify-between text-[11px]">
                            <span>
                              • [{isIn ? 'INGRESO' : 'EGRESO'}] {m.reason} ({m.performedBy})
                            </span>
                            <span className="font-bold">
                              {isIn ? `+$${m.amount.toFixed(2)}` : `-$${m.amount.toFixed(2)}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 3. Arqueo de Efectivo Físico en Caja */}
                <div className="border border-black p-3 space-y-1.5">
                  <div className="font-black uppercase border-b border-black pb-1 mb-1">
                    Arqueo de Efectivo Físico en Caja
                  </div>
                  <div className="flex justify-between">
                    <span>Fondo Inicial de Caja:</span>
                    <span className="font-bold">${initialCash.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Ventas en Efectivo (+):</span>
                    <span className="font-bold">+${cashSales.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Ingresos de Caja (+):</span>
                    <span className="font-bold">+${cashIn.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Egresos / Retiros de Caja (-):</span>
                    <span className="font-bold">-${cashOut.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-black pt-1.5 mt-1.5 flex justify-between font-bold">
                    <span>Efectivo Teórico Esperado en Caja:</span>
                    <span>${(shiftToPrint.expectedCash || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Efectivo Real Contado en Caja:</span>
                    <span>${(shiftToPrint.actualCashCounted || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-black">
                    <span>Diferencia de Efectivo (Sobrante / Faltante):</span>
                    <span>
                      {(shiftToPrint.difference || 0) >= 0
                        ? `+$${(shiftToPrint.difference || 0).toFixed(2)}`
                        : `-$${Math.abs(shiftToPrint.difference || 0).toFixed(2)}`}
                    </span>
                  </div>
                  {((shiftToPrint.surplusAmount || 0) > 0 || (shiftToPrint.difference || 0) > 0.005) && (
                    <div className="flex justify-between font-bold border-t border-dashed border-black pt-1">
                      <span>Sobrante Registrado (Excluido del Total de Ventas):</span>
                      <span>+${(shiftToPrint.surplusAmount ?? Math.max(0, shiftToPrint.difference || 0)).toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {/* 4. Total General de la Caja */}
                <div className="border-2 border-black p-3 bg-gray-100 space-y-1">
                  <div className="flex justify-between font-black text-sm">
                    <span>TOTAL GENERAL DE LA CAJA:</span>
                    <span>${totalGeneralCaja.toFixed(2)}</span>
                  </div>
                  <div className="text-[10px]">
                    (Fondo Inicial + Total Ventas Efectivo, Transferencia, De Una y Tarjeta + Ingresos - Egresos)
                  </div>
                </div>

                {shiftToPrint.closingNotes && (
                  <div className="border border-gray-400 p-2">
                    <strong>Observaciones:</strong> {shiftToPrint.closingNotes}
                  </div>
                )}

                <div className="pt-6 grid grid-cols-2 gap-8 text-center text-[11px]">
                  <div className="border-t border-black pt-1">Firma Cajero Responsable</div>
                  <div className="border-t border-black pt-1">Firma Propietario / Supervisor</div>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
};
