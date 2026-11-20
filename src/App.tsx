import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { Dashboard } from './components/Dashboard';
import { LicenseBlockScreen } from './components/LicenseBlockScreen';
import { OfflineIndicator } from './components/PWAInstallButton';
import { PrinterProvider } from './context/PrinterContext';
import { BranchProvider } from './context/BranchContext';
import { useFormKeyboardNavigation } from './utils/keyboardNav';
import { PantallaCliente } from './components/PantallaCliente';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMsg: error?.message || 'Error inesperado en la interfaz.' };
  }

  componentDidCatch(error: Error) {
    console.error('GASTROLAB UI ErrorBoundary:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center text-[#1F2937]">
          <div className="max-w-md w-full bg-[#F8F9FA] border border-gray-200 rounded-3xl p-6 shadow-sm space-y-4">
            <img
              src="/assets/gastrolab_fhd.jpg"
              alt="GASTROLAB by Iván Muñoz"
              className="h-20 w-20 object-contain rounded-2xl mx-auto border border-gray-200 bg-white p-1"
            />
            <h2 className="text-lg font-black text-[#4A5D23]">Recuperación Rápida</h2>
            <p className="text-xs text-gray-600">{this.state.errorMsg}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, errorMsg: '' })}
              className="px-5 py-2.5 rounded-xl bg-[#4A5D23] hover:bg-[#3d4d1d] text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
            >
              Continuar sin recargar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const MainApp: React.FC = () => {
  const { currentUser, isLoading, isBlockedByLicense } = useAuth();

  useFormKeyboardNavigation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4 text-[#1F2937]">
        <div className="p-3 rounded-3xl bg-white border border-gray-200 mb-4 shadow-sm">
          <img
            src="/assets/gastrolab_fhd.jpg"
            alt="GASTROLAB by Iván Muñoz"
            className="h-24 w-24 object-contain rounded-2xl"
          />
        </div>
        <p className="text-xs uppercase tracking-widest text-[#4A5D23] font-extrabold mt-1">
          Cargando GASTROLAB by Iván Muñoz...
        </p>
      </div>
    );
  }

  // Not signed in -> show Login & User Selection screen
  if (!currentUser) {
    return (
      <>
        <LoginScreen />
        <OfflineIndicator />
      </>
    );
  }

  // Signed in but 15-day trial or annual license expired -> block access until renewed with 12-char code
  if (isBlockedByLicense) {
    return (
      <>
        <LicenseBlockScreen />
        <OfflineIndicator />
      </>
    );
  }

  return (
    <>
      <Dashboard />
      <OfflineIndicator />
    </>
  );
};

export default function App() {
  const isCustomerDisplayMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('pantalla') === 'cliente';

  if (isCustomerDisplayMode) {
    return (
      <AppErrorBoundary>
        <PrinterProvider>
          <PantallaCliente />
        </PrinterProvider>
      </AppErrorBoundary>
    );
  }

  return (
    <AppErrorBoundary>
      <AuthProvider>
        <BranchProvider>
          <PrinterProvider>
            <MainApp />
          </PrinterProvider>
        </BranchProvider>
      </AuthProvider>
    </AppErrorBoundary>
  );
}
