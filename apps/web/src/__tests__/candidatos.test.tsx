import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { MENSAJE_CEDULA } from '../components/candidatos/FormularioCandidato';
import { PaginaCandidatos } from '../pages/candidatos/ListaCandidatos';
import {
  fixtureCandidato,
  fixturePagina,
  instalarFetch,
  limpiarSesion,
  sembrarSesion,
} from './ayudantes';

function pintar() {
  render(
    <MemoryRouter initialEntries={['/candidatos']}>
      <PaginaCandidatos />
    </MemoryRouter>,
  );
}

describe('listado y búsqueda de candidatos', () => {
  beforeEach(() => {
    limpiarSesion();
    sembrarSesion('analista_seleccion');
  });

  it('renderiza los candidatos que devuelve la API', async () => {
    instalarFetch(() => ({
      cuerpo: fixturePagina([fixtureCandidato()], { total: 1, page: 1, limit: 10 }),
    }));

    pintar();

    expect(await screen.findByRole('link', { name: 'María Pérez' })).toBeInTheDocument();
    expect(screen.getByText('20123456')).toBeInTheDocument();
    expect(screen.getByText('maria@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nuevo candidato' })).toBeInTheDocument();
  });

  it('la búsqueda por nombre viaja como query `q`', async () => {
    const fetchMock = instalarFetch(() => ({
      cuerpo: fixturePagina([fixtureCandidato()], { total: 1, page: 1, limit: 10 }),
    }));

    pintar();
    await screen.findByRole('link', { name: 'María Pérez' });
    const llamadasIniciales = fetchMock.mock.calls.length;

    fireEvent.change(screen.getByLabelText(/buscar por nombre/i), {
      target: { value: 'maría' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls
          .slice(llamadasIniciales)
          .some(([url]) => String(url).includes('q=mar%C3%ADa')),
      ).toBe(true),
    );
  });

  it('actualiza la búsqueda por nombre mientras se escribe, sin pulsar Buscar', async () => {
    const fetchMock = instalarFetch(() => ({
      cuerpo: fixturePagina([fixtureCandidato()], { total: 1, page: 1, limit: 10 }),
    }));

    pintar();
    await screen.findByRole('link', { name: 'María Pérez' });
    const llamadasIniciales = fetchMock.mock.calls.length;

    fireEvent.change(screen.getByLabelText(/buscar por nombre/i), {
      target: { value: 'mar' },
    });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls
          .slice(llamadasIniciales)
          .some(([url]) => String(url).includes('q=mar')),
      ).toBe(true),
    );
  });

  it('una cédula mal formada avisa en cliente y NO consulta a la API', async () => {
    const fetchMock = instalarFetch(() => ({
      cuerpo: fixturePagina([fixtureCandidato()], { total: 1, page: 1, limit: 10 }),
    }));

    pintar();
    await screen.findByRole('link', { name: 'María Pérez' });
    const llamadasIniciales = fetchMock.mock.calls.length;

    fireEvent.change(screen.getByLabelText(/cédula \(exacta\)/i), { target: { value: '12a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText(MENSAJE_CEDULA)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(llamadasIniciales);
  });

  it('lider_area no ve «Nuevo candidato» (no puede registrar candidatos)', async () => {
    sembrarSesion('lider_area');
    instalarFetch(() => ({
      cuerpo: fixturePagina([fixtureCandidato()], { total: 1, page: 1, limit: 10 }),
    }));

    pintar();

    expect(await screen.findByRole('link', { name: 'María Pérez' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nuevo candidato' })).not.toBeInTheDocument();
  });
});
