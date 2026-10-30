import { afterEach, describe, expect, it } from 'vitest';

import { solicitud } from '../lib/api';
import { limpiarSesion, instalarFetch, sembrarSesion } from './ayudantes';

describe('cliente API — renovación automática de sesión', () => {
  afterEach(() => {
    limpiarSesion();
    document.cookie = 'ats_csrf=; Max-Age=0; Path=/';
  });

  it('ante 401 renueva con refresh + CSRF y repite la petición una sola vez', async () => {
    sembrarSesion('admin_rrhh');
    document.cookie = 'ats_csrf=csrf-de-prueba; Path=/';
    let llamadasRecurso = 0;
    const fetchMock = instalarFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) {
        expect(init?.method).toBe('POST');
        expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-de-prueba');
        return {
          cuerpo: {
            user: {
              id: 'usuario-renovado',
              email: 'renovado@larco.test',
              fullName: 'Usuario Renovado',
              role: 'admin_rrhh',
            },
          },
        };
      }
      llamadasRecurso += 1;
      return llamadasRecurso === 1
        ? { status: 401, cuerpo: { message: 'No autenticado' } }
        : { cuerpo: { ok: true } };
    });

    await expect(solicitud<{ ok: boolean }>('/requerimientos')).resolves.toEqual({ ok: true });
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh')),
    ).toHaveLength(1);
    expect(llamadasRecurso).toBe(2);
  });
});
