import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { PaginaImportarHVs } from '../pages/importacion/PaginaImportarHVs';
import { instalarFetch, limpiarSesion, sembrarSesion } from './ayudantes';

describe('importación de HVs', () => {
  beforeEach(() => {
    limpiarSesion();
    sembrarSesion('admin_rrhh');
  });

  it('bloquea el destino mientras existe una previsualización', async () => {
    instalarFetch((url) => {
      if (url.endsWith('/departamentos')) {
        return { cuerpo: [{ id: 'd-1', nombre: 'Sistemas', candidatoCount: 0 }] };
      }
      if (url.endsWith('/importacion/hvs/previsualizar')) {
        return {
          cuerpo: {
            procesados: 1,
            resultados: [
              {
                archivo: 'hv-sintetica.pdf',
                indice: 0,
                ok: true,
                sugerencias: {
                  nombres: 'Ana',
                  apellidos: 'Prueba',
                  email: 'ana@example.test',
                  telefono: null,
                  ciudad: 'Bogota',
                  habilidades: [],
                },
              },
            ],
          },
        };
      }
      throw new Error(`ruta no preparada: ${url}`);
    });

    render(<PaginaImportarHVs />);
    const archivo = new File(['%PDF-sintetico'], 'hv-sintetica.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/hojas de vida/i), { target: { files: [archivo] } });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Sistemas' })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/departamento destino/i), { target: { value: 'd-1' } });
    fireEvent.click(screen.getByRole('button', { name: /previsualizar/i }));

    await waitFor(() =>
      expect(screen.getByText(/revisa los datos extraídos/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/departamento destino/i)).toBeDisabled();
  });
});
