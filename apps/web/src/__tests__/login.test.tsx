import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { RutasAplicacion } from '../App';
import {
  fixtureLogin,
  fixturePagina,
  fixtureRequerimiento,
  instalarFetch,
  limpiarSesion,
} from './ayudantes';

function pintarEn(ruta: string) {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <RutasAplicacion />
    </MemoryRouter>,
  );
}

function completarFormulario() {
  fireEvent.change(screen.getByLabelText(/correo electrónico/i), {
    target: { value: 'ana@larco.test' },
  });
  fireEvent.change(screen.getByLabelText(/^contraseña$/i), {
    target: { value: 'secreta' },
  });
}

describe('página de login', () => {
  beforeEach(() => {
    limpiarSesion();
  });

  it('al iniciar sesión vuelve a la ruta original solicitada', async () => {
    instalarFetch((url, init) => {
      if (url === '/api/auth/login' && init?.method === 'POST') {
        return { cuerpo: fixtureLogin() };
      }
      if (url.startsWith('/api/requerimientos')) {
        return { cuerpo: fixturePagina([fixtureRequerimiento()]) };
      }
      return undefined;
    });

    // El usuario intentó entrar directo a /requerimientos sin sesión.
    pintarEn('/requerimientos');
    expect(await screen.findByLabelText(/correo electrónico/i)).toBeInTheDocument();

    completarFormulario();
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    // Volvió al listado original (no a la raíz por defecto).
    expect(await screen.findByText('REQ-2026-001')).toBeInTheDocument();
    expect(screen.queryByLabelText(/correo electrónico/i)).not.toBeInTheDocument();
  });

  it('con credenciales inválidas (401) muestra el error y sigue en el formulario', async () => {
    const fetchMock = instalarFetch((url) =>
      url === '/api/auth/login'
        ? { status: 401, cuerpo: { statusCode: 401, message: 'Credenciales inválidas' } }
        : undefined,
    );

    pintarEn('/login');
    completarFormulario();
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas');
    expect(screen.getByRole('button', { name: /ingresar/i })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Sin token no se redirige: el formulario sigue a la vista.
    expect(screen.getByLabelText(/correo electrónico/i)).toBeInTheDocument();
  });
});
