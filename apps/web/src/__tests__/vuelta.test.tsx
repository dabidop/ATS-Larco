import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { PaginaNuevoCandidato } from '../pages/candidatos/NuevoCandidato';
import { PaginaNuevoRequerimiento } from '../pages/requerimientos/NuevoRequerimiento';
import { limpiarSesion, sembrarSesion } from './ayudantes';

/**
 * Etapa 8C — navegación con vuelta VISIBLE: las páginas de creación (que antes
 * no tenían ninguna) muestran «← Volver» junto al título. Sigue siendo un
 * `<Link>` de react-router: solo cambia el texto y la visibilidad.
 */
describe('enlaces de vuelta «← Volver» en los formularios de alta', () => {
  beforeEach(() => {
    limpiarSesion();
  });

  it('«Nuevo requerimiento» muestra «← Volver» a /requerimientos', async () => {
    sembrarSesion('admin_rrhh');

    render(
      <MemoryRouter initialEntries={['/requerimientos/nuevo']}>
        <Routes>
          <Route path="/requerimientos/nuevo" element={<PaginaNuevoRequerimiento />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Nuevo requerimiento' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Volver' })).toHaveAttribute(
      'href',
      '/requerimientos',
    );
  });

  it('«Nuevo candidato» muestra «← Volver» a /candidatos', async () => {
    sembrarSesion('analista_seleccion');

    render(
      <MemoryRouter initialEntries={['/candidatos/nuevo']}>
        <Routes>
          <Route path="/candidatos/nuevo" element={<PaginaNuevoCandidato />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Nuevo candidato' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Volver' })).toHaveAttribute('href', '/candidatos');
  });
});
