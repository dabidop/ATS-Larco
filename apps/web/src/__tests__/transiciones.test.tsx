import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { PaginaDetalleRequerimiento } from '../pages/requerimientos/DetalleRequerimiento';
import { fixtureRequerimiento, instalarFetch, limpiarSesion, sembrarSesion } from './ayudantes';
import type { EstadoRequerimiento } from '../tipos';

/** Pinta el detalle con la API mockeada y devuelve el mock de fetch. */
function pintarDetalle(role: string, estado: EstadoRequerimiento, createdBy = 'usuario-de-prueba') {
  sembrarSesion(role, 'usuario-de-prueba');
  const requerimiento = fixtureRequerimiento({ estado, createdBy });
  const fetchMock = instalarFetch((url, init) => {
    if (url === '/api/requerimientos/req-1' && init?.method === 'GET') {
      return { cuerpo: requerimiento };
    }
    if (url === '/api/requerimientos/req-1/transiciones' && init?.method === 'POST') {
      return {
        cuerpo: { ...requerimiento, estado: 'rechazado', motivoRechazo: 'No cubre el perfil' },
      };
    }
    return undefined;
  });

  render(
    <MemoryRouter initialEntries={['/requerimientos/req-1']}>
      <Routes>
        <Route path="/requerimientos/:id" element={<PaginaDetalleRequerimiento />} />
      </Routes>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe('transiciones de estado del requerimiento (botones según estado y rol)', () => {
  beforeEach(() => {
    limpiarSesion();
  });

  it('admin_rrhh en pendiente ve Aprobar y Rechazar', async () => {
    pintarDetalle('admin_rrhh', 'pendiente');

    expect(await screen.findByRole('button', { name: 'Aprobar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar proceso' })).not.toBeInTheDocument();
    // Vuelta visible con la flecha ← (Etapa 8C), sigue siendo un <Link>.
    expect(screen.getByRole('link', { name: '← Volver' })).toHaveAttribute(
      'href',
      '/requerimientos',
    );
  });

  it('analista_seleccion en pendiente NO ve ninguna transición', async () => {
    pintarDetalle('analista_seleccion', 'pendiente');

    expect(await screen.findByText('REQ-2026-001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument();
  });

  it('analista_seleccion en aprobado ve «Iniciar proceso»', async () => {
    pintarDetalle('analista_seleccion', 'aprobado');

    expect(await screen.findByRole('button', { name: 'Iniciar proceso' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cerrar requerimiento' })).not.toBeInTheDocument();
  });

  it('lider_area solo retira SU propia solicitud (regla del creador)', async () => {
    pintarDetalle('lider_area', 'pendiente', 'otro-lider');

    expect(await screen.findByText('REQ-2026-001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument();
  });

  it('lider_area creador sí ve «Rechazar»', async () => {
    pintarDetalle('lider_area', 'pendiente', 'usuario-de-prueba');

    expect(await screen.findByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
  });

  it('en un estado terminal no hay transiciones para nadie', async () => {
    pintarDetalle('admin_rrhh', 'cerrado');

    expect(await screen.findByText('Cerrado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument();
  });

  it('rechazar pide el motivo obligatorio y lo envía en el cuerpo del POST', async () => {
    const fetchMock = pintarDetalle('admin_rrhh', 'pendiente');

    fireEvent.click(await screen.findByRole('button', { name: 'Rechazar' }));

    const confirmar = screen.getByRole('button', { name: 'Confirmar rechazo' });
    expect(confirmar).toBeDisabled();
    expect(screen.getByLabelText(/motivo del rechazo/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/motivo del rechazo/i), {
      target: { value: 'No hay presupuesto aprobado' },
    });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    expect(await screen.findByRole('status')).toHaveTextContent('Rechazado');

    await waitFor(() => {
      const transicion = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/transiciones'),
      );
      expect(transicion).toBeDefined();
      const [, opciones] = transicion as [string, RequestInit];
      expect(JSON.parse(String(opciones.body))).toEqual({
        destino: 'rechazado',
        motivo: 'No hay presupuesto aprobado',
      });
    });
  });
});
