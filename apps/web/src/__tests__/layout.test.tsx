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

  it('muestra las secciones, el email del usuario y el botón Salir', async () => {
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
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument();
  });

  it('Salir cierra la sesión y devuelve al login', async () => {
    sembrarSesion('analista_seleccion');
    instalarFetch(() => ({ cuerpo: fixturePagina([]) }));

    render(
      <MemoryRouter initialEntries={['/requerimientos']}>
        <RutasAplicacion />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Salir' }));

    expect(useSesionStore.getState().token).toBeNull();
    expect(await screen.findByLabelText(/correo electrónico/i)).toBeInTheDocument();
  });

  it('un rol fuera de la matriz no ve ninguna sección (no se le inventan permisos)', async () => {
    sembrarSesion('becario');
    instalarFetch(() => ({ cuerpo: fixturePagina([]) }));

    render(
      <MemoryRouter initialEntries={['/requerimientos']}>
        <RutasAplicacion />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Salir' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Requerimientos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Candidatos' })).not.toBeInTheDocument();
    expect(screen.getByText(/no tiene secciones habilitadas/i)).toBeInTheDocument();
  });
});
