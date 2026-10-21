import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError, descargar, solicitud, subirArchivo } from '../lib/api';
import { CLAVE_SESION, useSesionStore } from '../store/sesion';
import { instalarFetch, limpiarSesion, sembrarSesion } from './ayudantes';

describe('cliente de la API (lib/api.ts)', () => {
  beforeEach(() => {
    limpiarSesion();
  });

  it('resuelve el JSON y antepone /api a la ruta', async () => {
    const fetchMock = instalarFetch((url) =>
      url === '/api/ping' ? { cuerpo: { ok: true } } : undefined,
    );

    const respuesta = await solicitud<{ ok: boolean }>('/ping');

    expect(respuesta.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/ping', expect.objectContaining({ method: 'GET' }));
  });

  it('envía el token como Authorization Bearer cuando hay sesión', async () => {
    sembrarSesion('admin_rrhh');
    const fetchMock = instalarFetch(() => ({ cuerpo: {} }));

    await solicitud('/requerimientos');

    const [, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(opciones.headers).toMatchObject({ Authorization: 'Bearer token-de-prueba' });
  });

  it('NO envía Authorization si no hay sesión', async () => {
    const fetchMock = instalarFetch(() => ({ cuerpo: {} }));

    await solicitud('/auth/login', { metodo: 'POST', cuerpo: { email: 'a@b.c', password: 'x' } });

    const [, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(opciones.headers).not.toHaveProperty('Authorization');
  });

  it('normaliza un message de tipo array (errores de validación) a un solo texto', async () => {
    instalarFetch(() => ({
      status: 400,
      cuerpo: {
        statusCode: 400,
        message: ['titulo es obligatorio', 'jefatura es obligatoria'],
        error: 'Bad Request',
        timestamp: '2026-01-01T00:00:00.000Z',
        path: '/api/requerimientos',
      },
    }));

    await expect(solicitud('/requerimientos', { metodo: 'POST', cuerpo: {} })).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: 'titulo es obligatorio, jefatura es obligatoria',
      }),
    );
  });

  it('un 401 descarta la sesión local (token caducado)', async () => {
    sembrarSesion('admin_rrhh');
    instalarFetch(() => ({ status: 401, cuerpo: { statusCode: 401, message: 'No autenticado' } }));

    await expect(solicitud('/requerimientos')).rejects.toBeInstanceOf(ApiError);

    expect(useSesionStore.getState().token).toBeNull();
    expect(localStorage.getItem(CLAVE_SESION)).toBeNull();
  });

  it('un 401 en el login NO toca la sesión (aún no hay token)', async () => {
    instalarFetch(() => ({
      status: 401,
      cuerpo: { statusCode: 401, message: 'Credenciales inválidas' },
    }));

    await expect(
      solicitud('/auth/login', { metodo: 'POST', cuerpo: { email: 'a@b.c', password: 'mala' } }),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Credenciales inválidas' });

    expect(useSesionStore.getState().token).toBeNull();
  });

  it('sube archivos en multipart con el campo "file" y sin Content-Type fijo', async () => {
    const fetchMock = instalarFetch(() => ({ status: 201, cuerpo: { id: 'arc-9' } }));

    await subirArchivo<{ id: string }>('/candidatos/can-1/archivos', new File(['x'], 'cv.pdf'));

    const [, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(opciones.method).toBe('POST');
    expect(opciones.body).toBeInstanceOf(FormData);
    expect(opciones.headers).not.toHaveProperty('Content-Type');
  });

  it('descarga autorizada: fetch con token → blob → objectURL + nombre original', async () => {
    sembrarSesion('analista_seleccion');
    const pdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const fetchMock = instalarFetch((url) =>
      url.endsWith('/descarga') ? { blob: pdf } : undefined,
    );

    const blobs: Blob[] = [];
    const capturaDescarga: { elemento: HTMLAnchorElement | null } = { elemento: null };
    URL.createObjectURL = (objeto) => {
      blobs.push(objeto as Blob);
      return 'blob:de-prueba';
    };
    URL.revokeObjectURL = () => undefined;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      capturaDescarga.elemento = this;
    };

    await descargar('/candidatos/can-1/archivos/arc-1/descarga', 'cv de María.pdf');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/candidatos/can-1/archivos/arc-1/descarga');
    const [, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(opciones.headers).toMatchObject({ Authorization: 'Bearer token-de-prueba' });
    expect(blobs[0]).toBeInstanceOf(Blob);
    expect(capturaDescarga.elemento?.download).toBe('cv de María.pdf');
  });
});
