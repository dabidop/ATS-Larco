import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { PaginaDetalleCandidato } from '../pages/candidatos/DetalleCandidato';
import { fechaHora } from '../lib/formato';
import {
  fixtureArchivoCv,
  fixtureCandidato,
  fixtureHistorial,
  instalarFetch,
  limpiarSesion,
  sembrarSesion,
} from './ayudantes';

describe('historial de auditoría del candidato', () => {
  beforeEach(() => {
    limpiarSesion();
    sembrarSesion('analista_seleccion');
  });

  it('pinta la entrada con usuario, acción, fecha y campos antes/después (PII enmascarada `***`)', async () => {
    const entrada = fixtureHistorial({
      campos: [
        // Así llega la PII cifrada desde la API: SIEMPRE enmascarada.
        { campo: 'cedula', antes: '***', despues: '***' },
        { campo: 'ciudad', antes: 'Maracay', despues: 'Valencia' },
        { campo: 'email', antes: null, despues: 'maria@example.com' },
      ],
    });

    instalarFetch((url) => {
      if (url === '/api/candidatos/can-1/historial') {
        return {
          cuerpo: [entrada],
        };
      }
      if (url === '/api/candidatos/can-1/archivos') return { cuerpo: [fixtureArchivoCv()] };
      if (url === '/api/candidatos/can-1') return { cuerpo: fixtureCandidato() };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/candidatos/can-1']}>
        <Routes>
          <Route path="/candidatos/:id" element={<PaginaDetalleCandidato />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Historial de cambios')).toBeInTheDocument();
    expect(await screen.findByText('Modificación')).toBeInTheDocument();
    expect(screen.getByText('ana@larco.test')).toBeInTheDocument();
    // La fecha se pinta en la HORA DEL SISTEMA (local), no en la UTC del ISO.
    expect(screen.getByText(fechaHora(entrada.fecha))).toBeInTheDocument();

    // La PII aparece TAL CUAL (`***`), sin descifrar nada en el cliente.
    expect(screen.getAllByText(/\*\*\*/)).toHaveLength(1);
    expect(screen.getByText(/Maracay → Valencia/)).toBeInTheDocument();
    expect(screen.getByText(/— → maria@example\.com/)).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay movimientos', async () => {
    instalarFetch((url) => {
      if (url === '/api/candidatos/can-1/historial') return { cuerpo: [] };
      if (url === '/api/candidatos/can-1/archivos') return { cuerpo: [] };
      if (url === '/api/candidatos/can-1') return { cuerpo: fixtureCandidato() };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/candidatos/can-1']}>
        <Routes>
          <Route path="/candidatos/:id" element={<PaginaDetalleCandidato />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Sin movimientos registrados/i)).toBeInTheDocument();
  });
});
