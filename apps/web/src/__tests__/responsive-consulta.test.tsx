import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ContenedorDesplazable, Paginacion } from '../components/ui/datos';

describe('responsive de consulta', () => {
  it('expone las tablas anchas como regiones enfocables con pista móvil', () => {
    render(
      <ContenedorDesplazable etiqueta="Tabla de usuarios y acciones">
        <table>
          <tbody>
            <tr>
              <td>Dato</td>
            </tr>
          </tbody>
        </table>
      </ContenedorDesplazable>,
    );

    const region = screen.getByRole('region', { name: 'Tabla de usuarios y acciones' });
    const pista = screen.getByText('Desliza horizontalmente para ver más información');
    expect(region).toHaveAttribute('tabindex', '0');
    expect(pista).toBeInTheDocument();
    expect(pista).not.toBe(region);
    expect(pista.parentElement).toBe(region.parentElement);
    expect(region).toHaveClass('overflow-x-auto');
  });

  it('no pasa clases CSS como atributos booleanos a los botones de paginación', () => {
    render(<Paginacion pagina={1} total={20} limit={10} onCambio={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Anterior' })).not.toHaveAttribute('cursor-pointer');
    expect(screen.getByRole('button', { name: 'Siguiente' })).not.toHaveAttribute('cursor-pointer');
  });
});
