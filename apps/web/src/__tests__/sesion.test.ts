import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLAVE_SESION } from '../store/sesion';
import type { useSesionStore } from '../store/sesion';

/**
 * Tests de persistencia de la sesión.
 *
 * El store se hidrata al IMPORTAR el módulo, así que cada caso reinicia los
 * módulos (`vi.resetModules`) y vuelve a importarlo para simular un arranque
 * de la aplicación.
 */
type SesionModulo = typeof useSesionStore;

async function cargarStore(): Promise<SesionModulo> {
  vi.resetModules();
  const modulo = await import('../store/sesion');
  return modulo.useSesionStore;
}

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('store de sesión (Zustand)', () => {
  it('arranca SIN sesión si no hay nada en localStorage', async () => {
    const store = await cargarStore();

    expect(store.getState().token).toBeNull();
    expect(store.getState().usuario).toBeNull();
  });

  it('iniciarSesion guarda token, usuario y el respaldo en localStorage', async () => {
    const store = await cargarStore();

    store.getState().iniciarSesion('jwt-123', {
      id: 'u-1',
      email: 'ana@larco.test',
      fullName: 'Ana',
      role: 'admin_rrhh',
    });

    expect(store.getState().token).toBe('jwt-123');
    expect(store.getState().usuario?.email).toBe('ana@larco.test');
    const respaldo = localStorage.getItem(CLAVE_SESION);
    expect(respaldo).not.toBeNull();
    expect(JSON.parse(respaldo ?? '{}')).toMatchObject({ token: 'jwt-123' });
  });

  it('cerrarSesion limpia el estado Y localStorage', async () => {
    const store = await cargarStore();
    store.getState().iniciarSesion('jwt-123', {
      id: 'u-1',
      email: 'ana@larco.test',
      fullName: 'Ana',
      role: 'analista_seleccion',
    });

    store.getState().cerrarSesion();

    expect(store.getState().token).toBeNull();
    expect(store.getState().usuario).toBeNull();
    expect(localStorage.getItem(CLAVE_SESION)).toBeNull();
  });

  it('hidrata la sesión desde localStorage al arrancar', async () => {
    localStorage.setItem(
      CLAVE_SESION,
      JSON.stringify({
        token: 'jwt-persistido',
        usuario: {
          id: 'u-2',
          email: 'luis@larco.test',
          fullName: 'Luis',
          role: 'lider_area',
        },
      }),
    );

    const store = await cargarStore();

    expect(store.getState().token).toBe('jwt-persistido');
    expect(store.getState().usuario?.role).toBe('lider_area');
  });

  it('ignora un respaldo corrupto o incompleto (se queda en /login)', async () => {
    localStorage.setItem(CLAVE_SESION, JSON.stringify({ token: 'solo-token' }));

    const store = await cargarStore();

    expect(store.getState().token).toBeNull();
    expect(store.getState().usuario).toBeNull();
  });
});
