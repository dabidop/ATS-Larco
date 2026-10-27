import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { RutasAplicacion } from '../App';
import { PaginaNuevoUsuario } from '../pages/usuarios/NuevoUsuario';
import { PaginaUsuarios } from '../pages/usuarios/ListaUsuarios';
import {
  fixtureDashboard,
  fixturePagina,
  fixtureUsuario,
  instalarFetch,
  limpiarSesion,
  sembrarSesion,
} from './ayudantes';

/** Pinta SOLO la página de listado (sin el árbol de rutas completo). */
function pintarListado() {
  render(
    <MemoryRouter initialEntries={['/usuarios']}>
      <PaginaUsuarios />
    </MemoryRouter>,
  );
}

/** Servidor de mentira para `/api/usuarios`: lista siempre y PATCH/POST OK. */
function prepararApiUsuarios() {
  return instalarFetch((url, init) => {
    if (init?.method !== undefined && init.method !== 'GET') {
      return { cuerpo: fixtureUsuario() };
    }
    if (url.startsWith('/api/usuarios?')) {
      return { cuerpo: fixturePagina([fixtureUsuario()], { total: 1, page: 1, limit: 20 }) };
    }
    return undefined;
  });
}

describe('listado de usuarios (gestión exclusiva del superusuario)', () => {
  beforeEach(() => {
    limpiarSesion();
  });

  it('el superusuario ve la tabla, la paginación y el botón «Nuevo usuario»', async () => {
    sembrarSesion('superusuario');
    instalarFetch(() => ({
      cuerpo: fixturePagina(
        [
          fixtureUsuario(),
          fixtureUsuario({
            id: 'usr-2',
            nombre: 'Luis Gómez',
            email: 'luis@larco.test',
            rol: 'superusuario',
            rolNombre: 'Superusuario (IT)',
            activo: false,
            creadoEn: '2026-02-05T12:00:00.000Z',
          }),
        ],
        { total: 2, page: 1, limit: 20 },
      ),
    }));

    pintarListado();

    expect(await screen.findByText('Ana Torres')).toBeInTheDocument();
    expect(screen.getByText('ana@larco.test')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Administrador RRHH' })).toBeInTheDocument();
    expect(screen.getByText('Luis Gómez')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Superusuario (IT)' })).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByText('10/01/2026')).toBeInTheDocument();
    expect(screen.getByText('05/02/2026')).toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 1 · 2 registros/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nuevo usuario' })).toBeInTheDocument();
  });

  it('los filtros viajan en la query string (q y rol) con limit=20', async () => {
    sembrarSesion('superusuario');
    const fetchMock = instalarFetch(() => ({
      cuerpo: fixturePagina([fixtureUsuario()], { total: 1, page: 1, limit: 20 }),
    }));

    pintarListado();
    await screen.findByText('Ana Torres');

    fireEvent.change(screen.getByLabelText(/buscar por nombre o correo/i), {
      target: { value: 'ana' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => String(url).includes('q=ana') && String(url).includes('limit=20'),
        ),
      ).toBe(true),
    );

    fireEvent.change(screen.getByLabelText(/filtrar por rol/i), {
      target: { value: 'superusuario' },
    });

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('rol=superusuario'))).toBe(
        true,
      ),
    );
  });

  it('en la fila del propio usuario se bloquean el cambio de rol y la desactivación', async () => {
    // El id de la sesión COINCIDE con el id del usuario listado (autoprotección).
    sembrarSesion('superusuario', 'usr-1');
    prepararApiUsuarios();

    pintarListado();
    await screen.findByText('Ana Torres');

    expect(screen.getByLabelText('Nuevo rol de Ana Torres')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardar rol de Ana Torres' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Desactivar a Ana Torres' })).toBeDisabled();
    // La restablecer contraseña NO está vetada por el servidor: sigue activa.
    expect(
      screen.getByRole('button', { name: 'Restablecer contraseña de Ana Torres' }),
    ).toBeEnabled();
    expect(screen.getByText(/eres tú/i)).toBeInTheDocument();
  });

  it('cambiar el rol de otro usuario envía PATCH al endpoint correcto y avisa', async () => {
    sembrarSesion('superusuario', 'usr-9');
    const captura: { url: string | null; cuerpo: unknown } = { url: null, cuerpo: null };
    instalarFetch((url, init) => {
      if (init?.method === 'PATCH') {
        captura.url = url;
        captura.cuerpo = init.body === undefined ? null : JSON.parse(String(init.body));
        return { cuerpo: fixtureUsuario({ rol: 'superusuario' }) };
      }
      return { cuerpo: fixturePagina([fixtureUsuario()], { total: 1, page: 1, limit: 20 }) };
    });

    pintarListado();
    await screen.findByText('Ana Torres');

    fireEvent.change(screen.getByLabelText('Nuevo rol de Ana Torres'), {
      target: { value: 'superusuario' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar rol de Ana Torres' }));

    await waitFor(() => expect(captura.url).toBe('/api/usuarios/usr-1'));
    expect(captura.cuerpo).toEqual({ rol: 'superusuario' });
    expect(await screen.findByRole('status')).toHaveTextContent(/rol de ana torres actualizado/i);
  });

  it('un 409 del servidor se muestra con MensajeError (mensaje en español)', async () => {
    sembrarSesion('superusuario', 'usr-9');
    instalarFetch((_url, init) => {
      if (init?.method === 'PATCH') {
        return {
          status: 409,
          cuerpo: {
            statusCode: 409,
            message: 'Debe permanecer al menos un superusuario activo',
            error: 'Conflict',
          },
        };
      }
      return { cuerpo: fixturePagina([fixtureUsuario()], { total: 1, page: 1, limit: 20 }) };
    });

    pintarListado();
    await screen.findByText('Ana Torres');

    fireEvent.click(screen.getByRole('button', { name: 'Desactivar a Ana Torres' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Debe permanecer al menos un superusuario activo',
    );
  });

  it('una contraseña corta no se envía: aviso local de mínimo 8 caracteres', async () => {
    sembrarSesion('superusuario', 'usr-9');
    const captura: { huboPatch: boolean } = { huboPatch: false };
    instalarFetch((_url, init) => {
      if (init?.method === 'PATCH') {
        captura.huboPatch = true;
        return { cuerpo: fixtureUsuario() };
      }
      return { cuerpo: fixturePagina([fixtureUsuario()], { total: 1, page: 1, limit: 20 }) };
    });

    pintarListado();
    await screen.findByText('Ana Torres');

    fireEvent.change(screen.getByLabelText('Nueva contraseña de Ana Torres'), {
      target: { value: '1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña de Ana Torres' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'password debe tener al menos 8 caracteres',
    );
    expect(captura.huboPatch).toBe(false);
  });

  it('admin_rrhh NO gestionaría usuarios: aviso de rol, sin lista ni «Nuevo usuario»', async () => {
    sembrarSesion('admin_rrhh');
    const fetchMock = instalarFetch(() => undefined);

    pintarListado();

    expect(await screen.findByText(/exclusiva del superusuario/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nuevo usuario' })).not.toBeInTheDocument();
    // Ni siquiera se lanza la petición (la API respondería 403).
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('la ruta /usuarios redirige a /dashboard a un rol distinto del superusuario', async () => {
    sembrarSesion('admin_rrhh');
    instalarFetch((url) => {
      if (url.startsWith('/api/dashboard')) return { cuerpo: fixtureDashboard() };
      return { cuerpo: fixturePagina([]) };
    });

    render(
      <MemoryRouter initialEntries={['/usuarios']}>
        <RutasAplicacion />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nuevo usuario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();
  });

  it('con sesión de superusuario, /usuarios pinta la sección y el enlace del menú', async () => {
    sembrarSesion('superusuario');
    instalarFetch(() => ({
      cuerpo: fixturePagina([fixtureUsuario()], { total: 1, page: 1, limit: 20 }),
    }));

    render(
      <MemoryRouter initialEntries={['/usuarios']}>
        <RutasAplicacion />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'Nuevo usuario' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Usuarios' })).toBeInTheDocument();
    expect(screen.getByText('Ana Torres')).toBeInTheDocument();
  });
});

describe('alta de usuarios (/usuarios/nuevo)', () => {
  beforeEach(() => {
    limpiarSesion();
  });

  it('muestra «← Volver» al listado y valida los campos obligatorios', async () => {
    sembrarSesion('superusuario');
    instalarFetch(() => undefined);

    render(
      <MemoryRouter initialEntries={['/usuarios/nuevo']}>
        <PaginaNuevoUsuario />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: '← Volver' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));

    expect(await screen.findByText('nombre es obligatorio')).toBeInTheDocument();
    expect(screen.getByText('email debe ser un correo electrónico válido')).toBeInTheDocument();
    expect(screen.getByText('password debe tener al menos 8 caracteres')).toBeInTheDocument();
    expect(screen.getByText('rol es obligatorio')).toBeInTheDocument();
  });

  it('crea el usuario con POST y vuelve al listado con aviso de éxito', async () => {
    sembrarSesion('superusuario');
    const captura: { url: string | null; cuerpo: unknown } = { url: null, cuerpo: null };
    instalarFetch((url, init) => {
      if (init?.method === 'POST') {
        captura.url = url;
        captura.cuerpo = init.body === undefined ? null : JSON.parse(String(init.body));
        return {
          status: 201,
          cuerpo: fixtureUsuario({
            id: 'usr-9',
            nombre: 'Nuevo Usuario',
            email: 'nuevo@larco.test',
            rol: 'superusuario',
            rolNombre: 'Superusuario (IT)',
          }),
        };
      }
      return { cuerpo: fixturePagina([fixtureUsuario()], { total: 1, page: 1, limit: 20 }) };
    });

    render(
      <MemoryRouter initialEntries={['/usuarios/nuevo']}>
        <RutasAplicacion />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: '← Volver' });
    fireEvent.change(screen.getByLabelText(/nombre completo/i), {
      target: { value: 'Nuevo Usuario' },
    });
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), {
      target: { value: 'nuevo@larco.test' },
    });
    fireEvent.change(screen.getByLabelText(/contraseña/i), {
      target: { value: 'secreta123' },
    });
    fireEvent.change(screen.getByLabelText(/^rol/i), { target: { value: 'superusuario' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }));

    await waitFor(() => expect(captura.url).toBe('/api/usuarios'));
    expect(captura.cuerpo).toEqual({
      nombre: 'Nuevo Usuario',
      email: 'nuevo@larco.test',
      password: 'secreta123',
      rol: 'superusuario',
    });

    // Tras crear vuelve a /usuarios con el aviso en location.state.
    expect(await screen.findByRole('heading', { name: 'Usuarios' })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(/creado correctamente/i);
  });
});
