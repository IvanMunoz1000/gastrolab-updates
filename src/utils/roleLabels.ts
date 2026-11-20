export function translateRoleToSpanish(role?: string | null): string {
  if (!role) return 'Personal';
  const normalized = role.trim().toLowerCase();
  switch (normalized) {
    case 'owner':
    case 'propietario':
      return 'Propietario';
    case 'admin':
    case 'administrator':
    case 'administrador':
      return 'Administrador';
    case 'cashier':
    case 'cajero':
      return 'Cajero';
    case 'kitchen manager':
    case 'jefe de cocina':
      return 'Jefe de Cocina';
    case 'kitchen assistant':
    case 'asistente de cocina':
      return 'Asistente de Cocina';
    case 'service staff':
    case 'waiter':
    case 'personal de servicio':
    case 'mesero':
      return 'Mesero / Personal de Servicio';
    default:
      return role;
  }
}
