import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { RutasAplicacion } from '../App';
import { useSesionStore } from '../store/sesion';
import { fixturePagina, instalarFetch, limpiarSesion, sembrarSesion } from './ayudantes';

describe('layout autenticado (header con navegación por rol)', () => {
  beforeEach(() => {
    limpiarSesion();
  });

  it('muestra las secciones, el email del usuario y el botón Cerrar sesión', async () => {
    sembrarSesion('admin_rrhh');
    instalarFetch(() => ({ cuerpo: fixturePagina([]) }));

    render(
      <MemoryRouter initialEntries={['/requerimientos']}>
        <RutasAplicacion />
      </MemoryRouter>,
    );

    // Wordmark de LARCO arriba-izquierda (Etapa 9) + secciones del menú.
    expect(screen.getByRole('banner')).toHaveTextContent('Applicant Tracking System');
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Requerimientos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Candidatos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Importar HVs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Departamentos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrevistas' })).toBeInTheDocument();
    // Bitácora y Usuarios son EXCLUSIVOS del superusuario (regla 7).
    expect(screen.queryByRole('link', { name: 'Bitácora' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();
    expect(screen.getByText(/usuario@larco\.test/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('Cerrar sesión cierra la sesión y devuelve al login', async () => {
    sembrarSesion('analista_seleccion');
    instalarFetch(() => ({ cuerpo: fixturePagina([]) }));

    render(
      <MemoryRouter initialEntries={['/requerimientos']}>
        <RutasAplicacion />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar salida' }));

    expect(useSesionStore.getState().token).toBeNull();
    expect(await screen.findByLabelText(/correo electrónico/i)).toBeInTheDocument();
  });

  it('redirige al login cuando la API rechaza una sesión caducada con 401', async () => {
    sembrarSesion('admin_rrhh');
    instalarFetch((url) =>
      url.startsWith('/api/candidatos?')
        ? { status: 401, cuerpo: { statusCode: 401, message: 'No autenticado' } }
        : undefined,
    );

    render(
      <MemoryRouter initialEntries={['/candidatos']}>
        <RutasAplicacion />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText(/correo electrónico/i)).toBeInTheDocument();
    expect(useSesionStore.getState().token).toBeNull();
  });

  it('abre el menú móvil, conserva permisos por rol y lo cierra al navegar', async () => {
    sembrarSesion('analista_seleccion');
    instalarFetch(() => ({ cuerpo: fixturePagina([]) }));

    render(
      <MemoryRouter initialEntries={['/requerimientos']}>
        <RutasAplicacion />
      </MemoryRouter>,
    );

    const menu = screen.getByRole('button', { name: 'Menú' });
    const navegacion = screen.getByRole('navigation', { name: 'Secciones principales' });
    expect(menu).toHaveClass('lg:hidden');
    expect(navegacion).toHaveClass('lg:flex');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(navegacion).toHaveClass('hidden');
    fireEvent.click(menu);
    expect(screen.getByRole('button', { name: 'Cerrar menú' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(navegacion).toHaveClass('flex');
    expect(screen.queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Candidatos' }));
    expect(navegacion).toHaveClass('hidden');
    expect(screen.getByRole('button', { name: 'Menú' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('un rol fuera de la matriz no ve ninguna sección (no se le inventan permisos)', async () => {
    sembrarSesion('becario');
    instalarFetch(() => ({ cuerpo: fixturePagina([]) }));

    render(
      <MemoryRouter initialEntries={['/requerimientos']}>
        <RutasAplicacion />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Requerimientos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Candidatos' })).not.toBeInTheDocument();
    expect(screen.getByText(/no tiene secciones habilitadas/i)).toBeInTheDocument();
  });
});
