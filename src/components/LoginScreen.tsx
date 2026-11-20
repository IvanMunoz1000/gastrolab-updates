import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { useAuth, mapAuthErrorToSpanish, deduplicateUserProfiles } from '../context/AuthContext';
import { UserProfile, UserRole } from '../types';
import { CreatorMasterModal } from './CreatorMasterModal';
import { isValidCreatorCode } from '../utils/cryptoAuth';
import {
  Eye,
  EyeOff,
  Lock,
  User,
  Shield,
  ChefHat,
  UtensilsCrossed,
  AlertCircle,
  ArrowRight,
  ChevronRight,
  Coffee,
  DollarSign,
  Flame,
  ArrowLeft,
  KeyRound,
  LogIn,
  Users,
  CheckCircle2,
  ShieldCheck,
  Mail,
} from 'lucide-react';

const ROLE_SPANISH: Record<UserRole, { title: string; badge: string; color: string; icon: any }> = {
  Owner: {
    title: 'Propietario',
    badge: 'bg-[#6B8E23]/15 text-[#4A5D23] border-[#6B8E23]/40',
    color: 'text-[#4A5D23]',
    icon: Flame,
  },
  Admin: {
    title: 'Administrador',
    badge: 'bg-[#4A5D23]/10 text-[#4A5D23] border-[#4A5D23]/30',
    color: 'text-[#4A5D23]',
    icon: Shield,
  },
  Cashier: {
    title: 'Cajero',
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    color: 'text-emerald-700',
    icon: DollarSign,
  },
  'Kitchen Manager': {
    title: 'Jefe de Cocina',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    color: 'text-[#D97706]',
    icon: ChefHat,
  },
  'Kitchen Assistant': {
    title: 'Asistente de Cocina',
    badge: 'bg-gray-100 text-gray-700 border-gray-200',
    color: 'text-gray-600',
    icon: UtensilsCrossed,
  },
  'Service Staff': {
    title: 'Personal de Servicio',
    badge: 'bg-blue-50 text-blue-800 border-blue-200',
    color: 'text-blue-600',
    icon: Coffee,
  },
};

export const LoginScreen: React.FC = () => {
  const {
    loginWithEmail,
    registerUser,
    lookupRecoveryAccountByEmail,
    resetPasswordWithEmailCode,
  } = useAuth();

  const [usersList, setUsersList] = useState<UserProfile[]>(() => {
    try {
      const cached = localStorage.getItem('gastrolab_cached_users');
      const parsed = cached ? (JSON.parse(cached) as UserProfile[]) : [];
      return deduplicateUserProfiles(parsed).uniqueProfiles;
    } catch {
      return [];
    }
  });

  const [authMode, setAuthMode] = useState<'select' | 'login' | 'setup' | 'forgot'>(() => {
    try {
      const cached = localStorage.getItem('gastrolab_cached_users');
      const parsed = cached ? JSON.parse(cached) : [];
      return Array.isArray(parsed) && parsed.length > 0 ? 'select' : 'login';
    } catch {
      return 'login';
    }
  });

  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Direct username login state (STRICTLY EMPTY BY DEFAULT)
  const [directIdentifier, setDirectIdentifier] = useState('');
  const [directPassword, setDirectPassword] = useState('');
  const [showDirectPassword, setShowDirectPassword] = useState(false);

  // Initial setup state if database has no owner yet (always empty by default)
  const [initialStoreName, setInitialStoreName] = useState('');
  const [initialOwnerName, setInitialOwnerName] = useState('');
  const [initialOwnerEmail, setInitialOwnerEmail] = useState('');
  const [initialOwnerPass, setInitialOwnerPass] = useState('');
  const [showInitialOwnerPass, setShowInitialOwnerPass] = useState(false);

  // Forgot password state (3-step Email + 8-digit code verification)
  const [forgotStep, setForgotStep] = useState<'email' | 'code' | 'new_password'>('email');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMatchedUser, setForgotMatchedUser] = useState<UserProfile | null>(null);
  const [generatedRecoveryCode, setGeneratedRecoveryCode] = useState('');
  const [forgotCodeInput, setForgotCodeInput] = useState('');
  const [forgotNewPass, setForgotNewPass] = useState('');
  const [forgotConfirmPass, setForgotConfirmPass] = useState('');
  const [showForgotNewPass, setShowForgotNewPass] = useState(false);

  // Detect post-factory-reset flag cleanly even under StrictMode
  const [factoryResetNotice] = useState<string | null>(() => {
    try {
      return localStorage.getItem('gastrolab_factory_reset_success');
    } catch {
      return null;
    }
  });

  // Status & Feedback
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(() => factoryResetNotice || null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Hidden Creator Master Panel trigger (strictly URL code or login code)
  const [isCreatorModalOpen, setIsCreatorModalOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (factoryResetNotice) {
      setUsersList([]);
      setSelectedUser(null);
      setAuthMode('login');
      setSuccessMsg(factoryResetNotice);
      try {
        localStorage.removeItem('gastrolab_factory_reset_success');
      } catch {
        // Ignore storage errors
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [factoryResetNotice]);

  // Check URL query/hash code for invisible Creator / Soporte access
  useEffect(() => {
    const checkUrlCode = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const candidate =
          params.get('acceso') ||
          params.get('soporte') ||
          params.get('creator') ||
          hashParams.get('acceso') ||
          hashParams.get('soporte') ||
          '';
        if (candidate && (await isValidCreatorCode(candidate))) {
          setIsCreatorModalOpen(true);
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch {
        // Ignore URL parse error
      }
    };
    checkUrlCode();
  }, []);

  // Subscribe to non-PII public login_profiles in Firestore + strictly deduplicate (1 Owner + unique staff)
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    auth.authStateReady().then(() => {
      if (cancelled) return;
      const q = query(collection(db, 'login_profiles'));
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const rawList: UserProfile[] = [];
          snapshot.forEach((docSnap) => {
            rawList.push({ uid: docSnap.id, ...(docSnap.data() as Omit<UserProfile, 'uid'>) });
          });

          if (rawList.length > 0) {
            const { uniqueProfiles } = deduplicateUserProfiles(rawList);
            uniqueProfiles.sort((a, b) => {
              if (a.role === 'Owner') return -1;
              if (b.role === 'Owner') return 1;
              return (a.name || '').localeCompare(b.name || '');
            });
            const safeProfiles = uniqueProfiles.map(({ pin: _p, authHash: _h, authSalt: _s, ...rest }) => rest);
            setUsersList(safeProfiles);
            try {
              localStorage.setItem('gastrolab_cached_users', JSON.stringify(safeProfiles));
            } catch {
              // Ignore quota errors
            }
            setAuthMode((prev) => (prev === 'setup' ? 'select' : prev));
          } else if (!snapshot.metadata.fromCache) {
            setUsersList([]);
            setSelectedUser(null);
            try {
              localStorage.removeItem('gastrolab_cached_users');
            } catch {
              // Ignore storage error
            }
          }
        },
        (err) => {
          console.warn('Login profiles notice:', err);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleSelectUser = (user: UserProfile) => {
    setSelectedUser(user);
    setPassword('');
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleBackToUserList = () => {
    setSelectedUser(null);
    setPassword('');
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleOpenForgot = (presetEmail = '') => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setForgotStep('email');
    setForgotEmail(presetEmail && !presetEmail.endsWith('@gastrolab.pos') ? presetEmail : '');
    setForgotMatchedUser(null);
    setGeneratedRecoveryCode('');
    setForgotCodeInput('');
    setForgotNewPass('');
    setForgotConfirmPass('');
    setAuthMode('forgot');
  };

  const handleSelectedUserLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanPass = password.trim();
    if (!cleanPass) {
      setErrorMsg('Por favor ingresa tu contraseña.');
      return;
    }

    if (cleanPass.length < 4) {
      setErrorMsg('La contraseña debe tener al menos 4 caracteres.');
      return;
    }

    setIsSubmitting(true);
    try {
      await loginWithEmail(selectedUser.email || selectedUser.name, cleanPass);
    } catch (err: any) {
      setErrorMsg(mapAuthErrorToSpanish(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDirectLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanId = directIdentifier.trim();
    const cleanPass = directPassword.trim();

    if ((await isValidCreatorCode(cleanId)) || (await isValidCreatorCode(cleanPass))) {
      setDirectIdentifier('');
      setDirectPassword('');
      setIsCreatorModalOpen(true);
      return;
    }

    if (!cleanId) {
      setErrorMsg('Por favor ingresa tu nombre de usuario.');
      return;
    }

    if (cleanPass.length < 4) {
      setErrorMsg('La contraseña debe tener al menos 4 caracteres.');
      return;
    }

    setIsSubmitting(true);
    try {
      await loginWithEmail(cleanId, cleanPass);
    } catch (err: any) {
      setErrorMsg(mapAuthErrorToSpanish(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendRecoveryCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanEmail = forgotEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Ingresa un correo electrónico válido registrado en el sistema.');
      return;
    }

    setIsSubmitting(true);
    try {
      const matched = await lookupRecoveryAccountByEmail(cleanEmail);
      if (!matched) {
        setErrorMsg('No encontramos una cuenta registrada con ese correo electrónico.');
        return;
      }

      const code8 = Math.floor(10000000 + Math.random() * 90000000).toString();
      setForgotMatchedUser(matched);
      setGeneratedRecoveryCode(code8);
      setForgotCodeInput('');
      setForgotStep('code');
      setSuccessMsg(
        `Código de 8 dígitos enviado a ${cleanEmail}. (Modo simulación para pruebas: ${code8})`
      );
    } catch (err: any) {
      setErrorMsg(mapAuthErrorToSpanish(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyRecoveryCode = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const entered = forgotCodeInput.replace(/\D/g, '').trim();
    if (entered.length !== 8) {
      setErrorMsg('El código de verificación debe tener exactamente 8 dígitos numéricos.');
      return;
    }
    if (entered !== generatedRecoveryCode) {
      setErrorMsg('El código de 8 dígitos ingresado es incorrecto. Verifica e intenta de nuevo.');
      return;
    }

    setForgotStep('new_password');
    setSuccessMsg('Código verificado correctamente. Ahora ingresa tu nueva contraseña.');
  };

  const handleCompleteEmailPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanNew = forgotNewPass.trim();
    if (cleanNew.length < 4) {
      setErrorMsg('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }
    if (cleanNew !== forgotConfirmPass.trim()) {
      setErrorMsg('La nueva contraseña y su confirmación no coinciden.');
      return;
    }

    setIsSubmitting(true);
    try {
      const updatedUser = await resetPasswordWithEmailCode(forgotEmail, cleanNew);
      setUsersList((prev) => {
        const filtered = prev.filter((u) => u.email.toLowerCase() !== updatedUser.email.toLowerCase());
        return [updatedUser, ...filtered];
      });
      setSuccessMsg(
        `¡Contraseña actualizada para ${updatedUser.name}! Ya puedes iniciar sesión con tu nueva clave.`
      );
      setForgotNewPass('');
      setForgotConfirmPass('');
      setForgotCodeInput('');
      setGeneratedRecoveryCode('');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setSelectedUser(null);
        setDirectIdentifier(updatedUser.email);
        setDirectPassword('');
        setAuthMode(usersList.length > 0 ? 'select' : 'login');
      }, 1500);
    } catch (err: any) {
      setErrorMsg(mapAuthErrorToSpanish(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInitialOwnerSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const storeName = initialStoreName.trim();
    const cleanName = initialOwnerName.trim();
    const cleanEmail = initialOwnerEmail.trim().toLowerCase();
    const cleanPass = initialOwnerPass.trim();

    if (!storeName) {
      setErrorMsg('Ingresa el nombre del establecimiento.');
      return;
    }

    if (!cleanName) {
      setErrorMsg('Por favor ingresa el nombre del Propietario.');
      return;
    }

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Por favor ingresa un correo electrónico válido para el Propietario.');
      return;
    }

    if (cleanPass.length < 6) {
      setErrorMsg('La contraseña inicial debe tener al menos 6 caracteres.');
      return;
    }

    setIsSubmitting(true);
    try {
      await registerUser(cleanName, '', cleanEmail, cleanPass, 'Owner', storeName);
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        setErrorMsg('La cuenta principal ya existe. Ingresa tu correo/usuario y contraseña en "Iniciar Sesión".');
        setDirectIdentifier('');
        setAuthMode('login');
      } else {
        setErrorMsg(mapAuthErrorToSpanish(err));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col justify-center items-center p-4 sm:p-6 text-[#1F2937] relative overflow-hidden font-sans">
      {/* Background soft ambient accents in Olive Green palette */}
      <div className="absolute -top-32 -left-32 w-80 h-80 bg-[#4A5D23]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-[#6B8E23]/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main card */}
      <div className="w-full max-w-xl bg-white border border-gray-200/90 rounded-3xl shadow-lg p-6 sm:p-8 z-10">
        {/* Brand Header with GASTROLAB FHD Logo */}
        <div className="flex flex-col items-center text-center mb-5">
          <div className="relative mb-3 flex items-center justify-center p-2 rounded-3xl bg-[#F6F6EE] border border-gray-200 shadow-sm">
            <img
              src="/assets/gastrolab_fhd.jpg"
              alt="GASTROLAB by Iván Muñoz"
              className="h-28 w-28 sm:h-32 sm:w-32 object-contain mx-auto rounded-2xl"
            />
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-[#4A5D23]">
            GASTRO<span className="text-[#6B8E23]">LAB</span>{' '}
            <span className="text-sm sm:text-base font-extrabold text-gray-600">by Iván Muñoz</span>
          </h1>
          <p className="text-[11px] tracking-widest uppercase font-extrabold text-[#4A5D23] mt-1">
            CONTROL TOTAL DE TU NEGOCIO
          </p>
        </div>

        {/* Always-Visible Mode Switcher: Seleccionar Usuario vs Iniciar Sesión */}
        <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-white border border-gray-200 mb-5 shadow-2xs">
          <button
            type="button"
            onClick={() => {
              setAuthMode('select');
              setSelectedUser(null);
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              authMode === 'select'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-[#4B5563] hover:text-[#1F2937] hover:bg-gray-50'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Cambiar / Elegir Usuario</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAuthMode('login');
              setSelectedUser(null);
              setDirectIdentifier('');
              setDirectPassword('');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              authMode === 'login'
                ? 'bg-[#4A5D23] text-white shadow-xs'
                : 'text-[#4B5563] hover:text-[#1F2937] hover:bg-gray-50'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Iniciar Sesión</span>
          </button>
        </div>

        {/* Visible Alerts */}
        {errorMsg && (
          <div className="mb-5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3 text-rose-700 text-xs shadow-xs animate-in fade-in duration-200">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1 font-semibold">{errorMsg}</div>
          </div>
        )}

        {successMsg && (
          <div className="mb-5 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3 text-emerald-800 text-xs shadow-xs animate-in fade-in duration-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1 font-bold">{successMsg}</div>
          </div>
        )}

        {/* MODE 1: USER SELECTION GRID */}
        {authMode === 'select' && !selectedUser && (
          <div className="space-y-4">
            {usersList.length > 0 ? (
              <>
                <div className="text-center pb-1">
                  <h2 className="text-base font-extrabold text-[#1F2937]">Selecciona tu Usuario</h2>
                  <p className="text-xs text-[#4B5563] mt-0.5">
                    Toca tu perfil para iniciar sesión o cambiar de turno
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                  {usersList.map((user) => {
                    const roleInfo = ROLE_SPANISH[user.role] || ROLE_SPANISH['Service Staff'];
                    const IconComponent = roleInfo.icon;
                    const initials = user.name
                      ? user.name
                          .split(' ')
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()
                      : 'US';

                    return (
                      <button
                        type="button"
                        key={user.uid}
                        onClick={() => handleSelectUser(user)}
                        className="p-3.5 rounded-2xl bg-white border border-gray-200 hover:border-[#4A5D23] hover:shadow-md transition-all text-left flex items-center justify-between group cursor-pointer active:scale-98"
                      >
                        <div className="flex items-center gap-3 truncate">
                          <div className="w-10 h-10 rounded-xl bg-[#4A5D23]/10 text-[#4A5D23] font-black text-sm flex items-center justify-center shrink-0 border border-[#4A5D23]/20 group-hover:bg-[#4A5D23] group-hover:text-white transition-colors">
                            {initials}
                          </div>
                          <div className="truncate">
                            <div className="text-xs font-bold text-[#1F2937] truncate group-hover:text-[#4A5D23]">
                              {user.name} {user.lastName || ''}
                            </div>
                            <div className="text-[10px] font-semibold text-[#4B5563] flex items-center gap-1 mt-0.5">
                              <IconComponent className={`w-3 h-3 ${roleInfo.color}`} />
                              <span>{roleInfo.title}</span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-[#4A5D23] group-hover:translate-x-0.5 transition-all shrink-0 ml-1" />
                      </button>
                    );
                  })}
                </div>

                <div className="pt-2 text-center border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => handleOpenForgot('')}
                    className="text-xs font-bold text-[#4A5D23] hover:underline inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-[#D97706]" />
                    Olvidé mi contraseña
                  </button>
                </div>
              </>
            ) : (
              <div className="p-5 rounded-2xl bg-white border border-gray-200 text-center space-y-3">
                <p className="text-xs text-[#4B5563]">
                  Aún no hay perfiles guardados en este dispositivo. Usa <strong>Iniciar Sesión</strong> con tu usuario y contraseña.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => setAuthMode('login')}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <LogIn className="w-4 h-4" />
                    Iniciar Sesión
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMode('setup')}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-[#1F2937] text-xs font-bold cursor-pointer"
                  >
                    Configurar Local Nuevo
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MODE 1B: SELECTED USER PASSWORD INPUT */}
        {authMode === 'select' && selectedUser && (
          <form onSubmit={handleSelectedUserLogin} className="space-y-4 animate-in fade-in duration-200" autoComplete="off">
            <div className="p-4 rounded-2xl bg-white border border-gray-200 flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-[#4A5D23] text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                  {selectedUser.name
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#1F2937]">
                    {selectedUser.name} {selectedUser.lastName || ''}
                  </h3>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border mt-0.5 ${ROLE_SPANISH[selectedUser.role]?.badge || 'bg-gray-100 text-gray-700'}`}>
                    {ROLE_SPANISH[selectedUser.role]?.title || selectedUser.role}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleBackToUserList}
                className="text-xs font-bold text-[#4A5D23] hover:text-[#3d4d1d] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Cambiar Usuario
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-1.5">
                Contraseña (4+ caracteres)
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  autoComplete="new-password"
                  placeholder="Ingresa tu contraseña..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-2xl pl-10 pr-10 py-3 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors font-mono font-bold"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  data-skip-enter="true"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
              <button
                type="button"
                onClick={handleBackToUserList}
                className="w-full sm:w-auto px-4 py-3 rounded-2xl bg-gray-100 hover:bg-gray-200 text-[#4B5563] text-xs font-bold transition-colors cursor-pointer"
              >
                ← Cambiar Usuario
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 w-full py-3 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4 text-[#D97706]" />
                <span>{isSubmitting ? 'Verificando...' : 'Iniciar Sesión'}</span>
              </button>
            </div>

            <div className="text-center pt-2 border-t border-gray-200">
              <button
                type="button"
                onClick={() => handleOpenForgot(selectedUser.email || '')}
                className="text-xs font-bold text-[#4A5D23] hover:underline inline-flex items-center gap-1.5 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#D97706]" />
                Olvidé mi contraseña
              </button>
            </div>
          </form>
        )}

        {/* MODE 2: DIRECT USERNAME LOGIN (ALWAYS EMPTY INPUTS, NO EMAIL REFERENCES) */}
        {authMode === 'login' && (
          <form onSubmit={handleDirectLoginSubmit} className="space-y-4 animate-in fade-in duration-200" autoComplete="off">
            <div>
              <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-1.5">
                Usuario
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  required
                  autoFocus
                  autoComplete="off"
                  placeholder="Ingresa tu nombre de usuario..."
                  value={directIdentifier}
                  onChange={(e) => setDirectIdentifier(e.target.value)}
                  className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-2xl pl-10 pr-4 py-3 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showDirectPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Ingresa tu contraseña..."
                  value={directPassword}
                  onChange={(e) => setDirectPassword(e.target.value)}
                  className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-2xl pl-10 pr-10 py-3 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none transition-colors font-mono font-bold"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  data-skip-enter="true"
                  onClick={() => setShowDirectPassword(!showDirectPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
                >
                  {showDirectPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
            >
              <LogIn className="w-4 h-4 text-[#D97706]" />
              <span>{isSubmitting ? 'Iniciando sesión...' : 'Iniciar Sesión'}</span>
            </button>

            <div className="pt-2 text-center border-t border-gray-200 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleOpenForgot('')}
                className="text-xs font-bold text-[#4A5D23] hover:underline inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#D97706]" />
                Olvidé mi contraseña
              </button>

              {usersList.length === 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setAuthMode('setup');
                  }}
                  className="text-xs font-bold text-[#4B5563] hover:text-[#4A5D23] hover:underline cursor-pointer"
                >
                  ¿Primer uso del sistema? Configurar Propietario Inicial
                </button>
              )}
            </div>
          </form>
        )}

        {/* MODE 3: FORGOT PASSWORD — 3-STEP EMAIL + 8-DIGIT CODE RECOVERY */}
        {authMode === 'forgot' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="p-3.5 rounded-2xl bg-white border border-[#4A5D23]/30 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-[#4A5D23] shrink-0 mt-0.5" />
              <div className="text-xs flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-black text-[#1F2937]">Recuperación por Correo</h3>
                  <span className="px-2 py-0.5 rounded-full bg-[#EAF5F0] text-[#4A5D23] text-[10px] font-black">
                    Paso {forgotStep === 'email' ? '1' : forgotStep === 'code' ? '2' : '3'} de 3
                  </span>
                </div>
                <p className="text-[11px] text-[#4B5563] mt-0.5">
                  {forgotStep === 'email' &&
                    'Ingresa tu correo registrado para recibir un código de verificación de 8 dígitos.'}
                  {forgotStep === 'code' &&
                    'Ingresa el código numérico de 8 dígitos enviado a tu correo electrónico.'}
                  {forgotStep === 'new_password' &&
                    `Define la nueva contraseña para ${forgotMatchedUser?.name || forgotEmail}.`}
                </p>
              </div>
            </div>

            {forgotStep === 'email' && (
              <form onSubmit={handleSendRecoveryCode} className="space-y-3.5" autoComplete="off">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#4B5563] mb-1">
                    Correo Electrónico Registrado
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="email"
                      required
                      autoFocus
                      autoComplete="off"
                      placeholder="correo@ejemplo.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-2xl pl-10 pr-4 py-3 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setSuccessMsg(null);
                      setAuthMode(usersList.length > 0 ? 'select' : 'login');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-[#4B5563] text-xs font-bold cursor-pointer"
                  >
                    Volver
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md"
                  >
                    <Mail className="w-4 h-4 text-[#D97706]" />
                    <span>{isSubmitting ? 'Buscando cuenta...' : 'Enviar Código (8 Dígitos)'}</span>
                  </button>
                </div>
              </form>
            )}

            {forgotStep === 'code' && (
              <form onSubmit={handleVerifyRecoveryCode} className="space-y-3.5" autoComplete="off">
                {generatedRecoveryCode && (
                  <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-center justify-between gap-2">
                    <div>
                      <span className="font-black block text-[11px] uppercase tracking-wider text-amber-800">
                        Código de Verificación Simulado (Correo)
                      </span>
                      <span className="text-[11px] text-amber-900">
                        Destinatario: <strong>{forgotEmail}</strong>
                      </span>
                    </div>
                    <span className="font-mono font-black text-base tracking-widest px-3 py-1 rounded-xl bg-white border border-amber-300 text-[#4A5D23] select-all">
                      {generatedRecoveryCode}
                    </span>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#4B5563] mb-1">
                    Código Numérico de 8 Dígitos
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={8}
                      required
                      autoFocus
                      autoComplete="off"
                      placeholder="Ingresa los 8 dígitos..."
                      value={forgotCodeInput}
                      onChange={(e) => setForgotCodeInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-2xl pl-10 pr-4 py-3 text-sm font-mono font-black tracking-widest text-[#1F2937] placeholder-gray-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setSuccessMsg(null);
                      setForgotStep('email');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-[#4B5563] text-xs font-bold cursor-pointer"
                  >
                    Cambiar Correo
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md"
                  >
                    <CheckCircle2 className="w-4 h-4 text-[#D97706]" />
                    <span>Verificar Código</span>
                  </button>
                </div>
              </form>
            )}

            {forgotStep === 'new_password' && (
              <form onSubmit={handleCompleteEmailPasswordReset} className="space-y-3.5" autoComplete="off">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#4B5563] mb-1">
                      Nueva Contraseña
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input
                        type={showForgotNewPass ? 'text' : 'password'}
                        required
                        autoFocus
                        autoComplete="new-password"
                        placeholder="Mínimo 4 caracteres..."
                        value={forgotNewPass}
                        onChange={(e) => setForgotNewPass(e.target.value)}
                        className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl pl-9 pr-9 py-2.5 text-xs font-mono font-bold text-[#1F2937] placeholder-gray-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowForgotNewPass((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
                      >
                        {showForgotNewPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#4B5563] mb-1">
                      Confirmar Contraseña
                    </label>
                    <input
                      type={showForgotNewPass ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      placeholder="Repite la contraseña..."
                      value={forgotConfirmPass}
                      onChange={(e) => setForgotConfirmPass(e.target.value)}
                      className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-xl px-3 py-2.5 text-xs font-mono font-bold text-[#1F2937] placeholder-gray-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setSuccessMsg(null);
                      setAuthMode(usersList.length > 0 ? 'select' : 'login');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-[#4B5563] text-xs font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md"
                  >
                    <CheckCircle2 className="w-4 h-4 text-[#D97706]" />
                    <span>{isSubmitting ? 'Guardando...' : 'Guardar Nueva Contraseña'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* MODE 4: INITIAL OWNER SETUP (ONLY WHEN DATABASE HAS NO USERS) */}
        {authMode === 'setup' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="p-4 rounded-2xl bg-white border border-gray-200 text-center">
              <h3 className="font-bold text-sm text-[#1F2937]">Configuración Inicial del Propietario</h3>
              <p className="text-xs text-[#4B5563] mt-1">
                Crea la cuenta principal del Propietario con su nombre, correo electrónico y contraseña.
              </p>
            </div>

            <form onSubmit={handleInitialOwnerSetup} className="space-y-3.5" autoComplete="off">
              <div>
                <label htmlFor="initial-store-name" className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-1">
                  Nombre del establecimiento
                </label>
                <input id="initial-store-name" type="text" required autoComplete="organization"
                  value={initialStoreName} onChange={(e) => setInitialStoreName(e.target.value)}
                  className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-2xl px-4 py-2.5 text-xs text-[#1F2937] focus:outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-1">
                  Nombre Propietario
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    required
                    autoComplete="off"
                    placeholder="Nombre completo del propietario..."
                    value={initialOwnerName}
                    onChange={(e) => setInitialOwnerName(e.target.value)}
                    className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-2xl pl-10 pr-4 py-2.5 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-1">
                  Correo
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    required
                    autoComplete="off"
                    placeholder="correo@negocio.com"
                    value={initialOwnerEmail}
                    onChange={(e) => setInitialOwnerEmail(e.target.value)}
                    className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-2xl pl-10 pr-4 py-2.5 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#4B5563] uppercase tracking-wider mb-1">
                  Contraseña (mínimo 6 caracteres)
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showInitialOwnerPass ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={initialOwnerPass}
                    onChange={(e) => setInitialOwnerPass(e.target.value)}
                    className="w-full bg-white border border-gray-200 focus:border-[#4A5D23] rounded-2xl pl-10 pr-10 py-2.5 text-xs text-[#1F2937] placeholder-gray-400 focus:outline-none font-mono"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowInitialOwnerPass((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
                  >
                    {showInitialOwnerPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 rounded-2xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 mt-4"
              >
                <span>Configurar Cuenta Principal</span>
                <ArrowRight className="w-4 h-4 text-[#D97706]" />
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setAuthMode('login');
                  }}
                  className="text-xs font-bold text-[#4A5D23] hover:underline cursor-pointer"
                >
                  ← Volver a Iniciar Sesión
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      <div className="mt-6 text-center text-xs text-[#4B5563] select-none">
        GASTROLAB POS • Licencia Anual Autorizada
      </div>

      {/* Hidden Creator Master Panel (Iván Muñoz) */}
      <CreatorMasterModal
        isOpen={isCreatorModalOpen}
        onClose={() => setIsCreatorModalOpen(false)}
      />
    </div>
  );
};
