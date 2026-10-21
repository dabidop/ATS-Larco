import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { PaginaRequerimientos } from '../pages/requerimientos/ListaRequerimientos';
import {
  fixturePagina,
  fixtureRequerimiento,
  instalarFetch,
  limpiarSesion,
  sembrarSesion,
} from './ayudantes';

function pintar() {
  render(
    <MemoryRouter initialEntries={['/requerimientos']}>
      <PaginaRequerimientos />
    </MemoryRouter>,
  );
}

describe('listado de requerimientos', () => {
  beforeEach(() => {
    limpiarSesion();
    sembrarSesion('admin_rrhh');
  });

  it('renderiza los requerimientos de la API con su estado y paginación', async () => {
    instalarFetch(() => ({
      cuerpo: fixturePagina(
        [
          fixtureRequerimiento(),
          fixtureRequerimiento({
            id: 'req-2',
            code: 'REQ-2026-002',
            estado: 'en_proceso',
            titulo: 'Contador Público',
          }),
        ],
        { total: 25, page: 1, limit: 10 },
      ),
    }));

    pintar();

    expect(await screen.findByText('REQ-2026-001')).toBeInTheDocument();
    expect(screen.getByText('REQ-2026-002')).toBeInTheDocument();
    expect(screen.getByText('Analista de Selección')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText('En proceso')).toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 3 · 25 registros/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nuevo requerimiento' })).toBeInTheDocument();
  });

  it('«Siguiente» pide la página 2 y la pinta', async () => {
    const fetchMock = instalarFetch((url) =>
      url.includes('page=2')
        ? {
            cuerpo: fixturePagina([fixtureRequerimiento({ id: 'req-11', code: 'REQ-2026-011' })], {
              total: 25,
              page: 2,
              limit: 10,
            }),
          }
        : {
            cuerpo: fixturePagina([fixtureRequerimiento()], { total: 25, page: 1, limit: 10 }),
          },
    );

    pintar();
    expect(await screen.findByText('REQ-2026-001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(await screen.findByText('REQ-2026-011')).toBeInTheDocument();
    expect(screen.getByText(/Página 2 de 3/)).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(true),
    );
  });

  it('el filtro por estado viaja en la query string', async () => {
    const fetchMock = instalarFetch(() => ({
      cuerpo: fixturePagina([fixtureRequerimiento()], { total: 1, page: 1, limit: 10 }),
    }));

    pintar();
    await screen.findByText('REQ-2026-001');

    fireEvent.change(screen.getByLabelText(/filtrar por estado/i), {
      target: { value: 'aprobado' },
    });

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('estado=aprobado'))).toBe(
        true,
      ),
    );
  });

  it('el analista de selección NO ve el botón de crear (RBAC de la UI)', async () => {
    sembrarSesion('analista_seleccion');
    instalarFetch(() => ({
      cuerpo: fixturePagina([fixtureRequerimiento()], { total: 1, page: 1, limit: 10 }),
    }));

    pintar();

    expect(await screen.findByText('REQ-2026-001')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nuevo requerimiento' })).not.toBeInTheDocument();
  });

  it('muestra «sin resultados» cuando la API devuelve la lista vacía', async () => {
    instalarFetch(() => ({ cuerpo: fixturePagina([], { total: 0, page: 1, limit: 10 }) }));

    pintar();

    expect(await screen.findByText(/Sin resultados/i)).toBeInTheDocument();
  });
});
