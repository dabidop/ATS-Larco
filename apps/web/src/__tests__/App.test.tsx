import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from '../App';
import {
  fixturePagina,
  fixtureRequerimiento,
  instalarFetch,
  limpiarSesion,
  sembrarSesion,
} from './ayudantes';

function irA(ruta: string): void {
  window.history.pushState({}, '', ruta);
}

describe('App (árbol de rutas completo)', () => {
  beforeEach(() => {
    limpiarSesion();
    irA('/');
  });

  it('sin sesión, cualquier ruta privada redirige a /login', () => {
    irA('/requerimientos');
    instalarFetch(() => ({ cuerpo: fixturePagina([]) }));

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(screen.getByRole('heading', { name: /ATS · Gestión Humana/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/correo electrónico/i)).toBeInTheDocument();
  });

  it('con sesión hidratada, la raíz redirige a /requerimientos y pinta el listado', async () => {
    irA('/');
    sembrarSesion('admin_rrhh');
    instalarFetch(() => ({
      cuerpo: fixturePagina([fixtureRequerimiento()], { total: 1, page: 1, limit: 10 }),
    }));

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(await screen.findByText('REQ-2026-001')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('ATS · Gestión Humana — LARCO');
  });

  it('una ruta desconocida muestra la página 404 dentro del layout', async () => {
    irA('/ruta-que-no-existe');
    sembrarSesion('lider_area');
    instalarFetch(() => ({ cuerpo: fixturePagina([]) }));

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(
      await screen.findByRole('heading', { name: /Página no encontrada/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Volver a Requerimientos' })).toHaveAttribute(
      'href',
      '/requerimientos',
    );
  });

  it('la ruta del tablero de selección protegida pinta el tablero con sesión', async () => {
    irA('/requerimientos/req-1/embudo');
    sembrarSesion('analista_seleccion');
    instalarFetch((url) => {
      if (url.startsWith('/api/requerimientos/req-1')) {
        return { cuerpo: fixtureRequerimiento({ estado: 'en_proceso' }) };
      }
      if (url.startsWith('/api/postulaciones?requerimientoId=req-1')) {
        return { cuerpo: fixturePagina([]) };
      }
      return undefined;
    });

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(
      await screen.findByRole('heading', { name: /Tablero de selección/i }),
    ).toBeInTheDocument();
  });
});
