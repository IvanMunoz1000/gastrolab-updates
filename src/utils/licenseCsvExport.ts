/**
 * Utility to generate and download a CSV file with exactly 200 unique 12-character
 * non-sequential alphanumeric license codes for GASTROLAB POS.
 */

function hasSequentialPattern(code: string): boolean {
  for (let i = 0; i < code.length - 2; i++) {
    const a = code.charCodeAt(i);
    const b = code.charCodeAt(i + 1);
    const c = code.charCodeAt(i + 2);
    if (b === a + 1 && c === b + 1) return true; // e.g., ABC, 123
    if (a === b && b === c) return true; // e.g., AAA, 777
  }
  return false;
}

export function generate200Unique12CharCodes(): string[] {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude ambiguous chars (0, 1, I, O)
  const codesSet = new Set<string>();

  const randomBuffer = new Uint32Array(12);

  while (codesSet.size < 200) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(randomBuffer);
    } else {
      for (let i = 0; i < 12; i++) {
        randomBuffer[i] = Math.floor(Math.random() * 0xffffffff);
      }
    }

    let code = 'GL';
    for (let i = 0; i < 10; i++) {
      code += chars[randomBuffer[i] % chars.length];
    }

    if (code.length === 12 && !hasSequentialPattern(code)) {
      codesSet.add(code);
    }
  }

  return Array.from(codesSet);
}

export function download200LicensesCsv(): void {
  const codes = generate200Unique12CharCodes();

  const headers = [
    'No.',
    'Codigo de Licencia (12 Caracteres)',
    'Tipo de Licencia',
    'Vigencia',
    'Dispositivos Permitidos',
    'Estado',
    'Software',
    'Fecha de Generacion',
  ];

  const now = new Date().toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const rows = codes.map((code, index) => [
    index + 1,
    code,
    'Licencia Anual Propietario',
    '365 Dias (1 Ano)',
    '4 Terminales (1 PC Central + 3 Moviles)',
    'Disponible para Activacion',
    'GASTROLAB by Iván Muñoz',
    now,
  ]);

  const csvContent =
    '\uFEFF' + // UTF-8 BOM for Microsoft Excel
    [headers.join(','), ...rows.map((r) => r.map((val) => `"${val}"`).join(','))].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Codigos_Licencia_GASTROLAB_200_Anuales_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
