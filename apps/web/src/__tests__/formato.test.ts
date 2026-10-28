import { describe, expect, it } from 'vitest';

import { fechaCorta, fechaHora } from '../lib/formato';

/**
 * `fechaHora` es el formateador de la BITÁCORA y del historial: desde la
 * corrección posterior a la Etapa 9 pinta la HORA DEL SISTEMA (local), no la
 * UTC incrustada en el ISO que devuelve la API.
 */
describe('fechaHora', () => {
  const iso = '2026-10-27T18:30:00.000Z';

  it('devuelve dd/mm/aaaa HH:MM calculado con las partes LOCALES de la fecha', () => {
    const fecha = new Date(iso);
    const relleno = (valor: number): string => String(valor).padStart(2, '0');
    const esperado =
      `${relleno(fecha.getDate())}/${relleno(fecha.getMonth() + 1)}/${fecha.getFullYear()} ` +
      `${relleno(fecha.getHours())}:${relleno(fecha.getMinutes())}`;

    expect(fechaHora(iso)).toBe(esperado);
  });

  it('NO hace slice sobre el texto UTC (el bug de la bitácora)', () => {
    // Fuera del huso UTC la hora local NO puede coincidir con la del texto.
    if (new Date(iso).getTimezoneOffset() !== 0) {
      expect(fechaHora(iso)).not.toContain('18:30');
      expect(fechaHora(iso)).not.toBe('27/10/2026 18:30');
    }
  });

  it('acepta null/undefined y textos inválidos como «sin dato»', () => {
    expect(fechaHora(null)).toBe('—');
    expect(fechaHora(undefined)).toBe('—');
    expect(fechaHora('no-es-una-fecha')).toBe('—');
  });
});

describe('fechaCorta', () => {
  it('lee el texto YYYY-MM-DD sin desplazar el día (es fecha sin hora)', () => {
    expect(fechaCorta('2026-02-01')).toBe('01/02/2026');
    expect(fechaCorta(null)).toBe('—');
    expect(fechaCorta('abc')).toBe('—');
  });
});
