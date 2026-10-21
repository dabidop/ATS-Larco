import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PaginaDetalleCandidato } from '../pages/candidatos/DetalleCandidato';
import {
  fixtureArchivoCv,
  fixtureCandidato,
  fixtureHistorial,
  instalarFetch,
  limpiarSesion,
  sembrarSesion,
} from './ayudantes';

const crearObjectUrlOriginal = URL.createObjectURL;
const revokeObjectUrlOriginal = URL.revokeObjectURL;
const clickOriginal = HTMLAnchorElement.prototype.click;

/** Pinta el detalle del candidato con la API mockeada. */
function pintarDetalle() {
  sembrarSesion('analista_seleccion', 'usuario-de-prueba');
  const fetchMock = instalarFetch((url, init) => {
    if (init?.method === 'POST' && url === '/api/candidatos/can-1/archivos') {
      return {
        status: 201,
        cuerpo: fixtureArchivoCv({ id: 'arc-2', filenameOriginal: 'cv-nuevo.pdf' }),
      };
    }
    if (url === '/api/candidatos/can-1/archivos' && init?.method !== 'POST') {
      return { cuerpo: [fixtureArchivoCv()] };
    }
    if (url.endsWith('/descarga')) {
      return { blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }) };
    }
    if (url === '/api/candidatos/can-1/historial') {
      return { cuerpo: [fixtureHistorial()] };
    }
    if (url === '/api/candidatos/can-1') {
      return { cuerpo: fixtureCandidato() };
    }
    return undefined;
  });

  render(
    <MemoryRouter initialEntries={['/candidatos/can-1']}>
      <Routes>
        <Route path="/candidatos/:id" element={<PaginaDetalleCandidato />} />
      </Routes>
    </MemoryRouter>,
  );
  return fetchMock;
}

function adjuntar(archivo: File): void {
  const input = screen.getByLabelText(/adjuntar cv/i) as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [archivo], configurable: true });
  fireEvent.change(input);
}

describe('archivos de CV del candidato', () => {
  beforeEach(() => {
    limpiarSesion();
  });

  afterEach(() => {
    URL.createObjectURL = crearObjectUrlOriginal;
    URL.revokeObjectURL = revokeObjectUrlOriginal;
    HTMLAnchorElement.prototype.click = clickOriginal;
  });

  it('rechaza en cliente un .txt sin enviar nada al servidor', async () => {
    const fetchMock = pintarDetalle();
    await screen.findByText('cv-maria.pdf');

    adjuntar(new File(['hola'], 'notas.txt', { type: 'text/plain' }));

    expect(await screen.findByText(/Formato no admitido/i)).toBeInTheDocument();
    const subidas = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(subidas).toHaveLength(0);
  });

  it('rechaza en cliente un PDF mayor de 5 MB sin enviar nada', async () => {
    const fetchMock = pintarDetalle();
    await screen.findByText('cv-maria.pdf');

    adjuntar(
      new File([new Uint8Array(6 * 1024 * 1024)], 'grande.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByText(/supera el límite de 5 MB/i)).toBeInTheDocument();
    const subidas = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(subidas).toHaveLength(0);
  });

  it('un CV válido se sube en multipart y refresca la lista', async () => {
    const fetchMock = pintarDetalle();
    await screen.findByText('cv-maria.pdf');

    adjuntar(new File(['%PDF-1.4'], 'cv-nuevo.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText(/CV adjuntado: cv-nuevo.pdf/i)).toBeInTheDocument();
    const subida = fetchMock.mock.calls.find(
      ([url, init]) => init?.method === 'POST' && url === '/api/candidatos/can-1/archivos',
    );
    expect(subida).toBeDefined();
    const [, opciones] = subida as [string, RequestInit];
    expect(opciones.body).toBeInstanceOf(FormData);
    // La lista de archivos se vuelve a pedir tras subir.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => url === '/api/candidatos/can-1/archivos').length,
      ).toBeGreaterThan(1),
    );
  });

  it('«Descargar» usa fetch→blob→objectURL con el nombre original (no un <a href> plano)', async () => {
    const capturaDescarga: { elemento: HTMLAnchorElement | null } = { elemento: null };
    const blobs: Blob[] = [];
    URL.createObjectURL = (objeto) => {
      blobs.push(objeto as Blob);
      return 'blob:de-prueba';
    };
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      capturaDescarga.elemento = this;
    };

    const fetchMock = pintarDetalle();
    await screen.findByText('cv-maria.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));

    await waitFor(() => expect(blobs).toHaveLength(1));
    const llamadaDescarga = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/archivos/arc-1/descarga'),
    );
    expect(llamadaDescarga).toBeDefined();
    const [, opciones] = llamadaDescarga as [string, RequestInit];
    expect(opciones.headers).toMatchObject({ Authorization: 'Bearer token-de-prueba' });
    expect(capturaDescarga.elemento?.download).toBe('cv-maria.pdf');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:de-prueba');
  });

  it('un rol sin permiso (líder de área) ve el aviso y no el input de subida', async () => {
    sembrarSesion('lider_area');
    instalarFetch((url) => {
      if (url === '/api/candidatos/can-1/archivos') return { cuerpo: [fixtureArchivoCv()] };
      if (url === '/api/candidatos/can-1/historial') return { cuerpo: [] };
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

    expect(await screen.findByText(/no adjuntar nuevos CVs/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/adjuntar cv/i)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Descargar' })).toBeInTheDocument();
  });
});
