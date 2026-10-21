import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { TableroEmbudo } from '../pages/embudo/TableroEmbudo';
import { useTableroStore } from '../store/tablero';
import type { ManejadorFetch } from './ayudantes';
import type { Postulacion } from '../tipos';
import {
  fixtureHistorialPostulacion,
  fixturePagina,
  fixturePostulacion,
  fixtureRequerimiento,
  instalarFetch,
  limpiarSesion,
  sembrarSesion,
} from './ayudantes';

/**
 * Tests del TABLERO Kanban (componentes): agrupación en 5 columnas, tarjetas
 * terminales sin acciones, diálogo de descarte, botones adyacentes, roles sin
 * permiso y panel de historial. `fetch` SIEMPRE mockeado (sin red).
 */

/** Fixture variada: una activa por fase + una contratada + una descartada. */
function fixtureTablero(): Postulacion[] {
  return [
    fixturePostulacion({
      id: 'p1',
      candidato: { id: 'c1', nombres: 'Ana', apellidos: 'García' },
      fase: 'preseleccion',
    }),
    fixturePostulacion({
      id: 'p2',
      candidato: { id: 'c2', nombres: 'Luis', apellidos: 'Martínez' },
      fase: 'antecedentes',
    }),
    fixturePostulacion({
      id: 'p3',
      candidato: { id: 'c3', nombres: 'Sofía', apellidos: 'Rivas' },
      fase: 'entrevistas',
    }),
    fixturePostulacion({
      id: 'p4',
      candidato: { id: 'c4', nombres: 'Pedro', apellidos: 'Sánchez' },
      fase: 'contratacion',
      estado: 'contratado',
    }),
    fixturePostulacion({
      id: 'p5',
      candidato: { id: 'c5', nombres: 'Laura', apellidos: 'Méndez' },
      fase: 'entrevistas',
      estado: 'descartado',
      motivoDescarte: 'No aprueba la prueba técnica',
    }),
  ];
}

/**
 * Pinta el tablero con la API mockeada. `adicional` permite preparar rutas
 * EXTRA (POST/PATCH/historial) además de las dos básicas (requerimiento y
 * listado de postulaciones), que siempre se sirven.
 */
function pintarTablero(
  role: string,
  opciones: {
    estadoRequerimiento?: string;
    items?: Postulacion[];
    adicional?: ManejadorFetch;
  } = {},
) {
  sembrarSesion(role);
  const items = opciones.items ?? fixtureTablero();
  const estadoRequerimiento = opciones.estadoRequerimiento ?? 'en_proceso';
  const fetchMock = instalarFetch((url, init) => {
    const extra = opciones.adicional?.(url, init);
    if (extra !== undefined) return extra;
    if (url.startsWith('/api/requerimientos/req-1')) {
      return { cuerpo: fixtureRequerimiento({ estado: estadoRequerimiento as 'en_proceso' }) };
    }
    if (url.startsWith('/api/postulaciones?requerimientoId=req-1')) {
      return { cuerpo: fixturePagina(items, { total: items.length, limit: 200 }) };
    }
    return undefined;
  });

  render(
    <MemoryRouter initialEntries={['/requerimientos/req-1/embudo']}>
      <Routes>
        <Route path="/requerimientos/:id/embudo" element={<TableroEmbudo />} />
      </Routes>
    </MemoryRouter>,
  );
  return fetchMock;
}

/** Vuelve el store del tablero a su estado inicial entre tests. */
function reiniciarStore(): void {
  useTableroStore.setState({
    postulaciones: [],
    requerimientoId: null,
    cargando: false,
    error: null,
    exito: null,
    guardando: [],
  });
}

describe('tablero Kanban (columnas y tarjetas)', () => {
  beforeEach(() => {
    limpiarSesion();
    reiniciarStore();
  });

  it('pinta las 5 columnas con sus contadores y agrupa las tarjetas por fase', async () => {
    pintarTablero('analista_seleccion');

    // Las 5 columnas, en orden.
    expect(await screen.findByRole('region', { name: 'Columna Preselección' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Columna Antecedentes' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Columna Entrevistas' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Columna Proveedor externo' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Columna Contratación' })).toBeInTheDocument();

    // Contadores por columna.
    expect(
      within(screen.getByRole('region', { name: 'Columna Entrevistas' })).getByText('2'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Columna Proveedor externo' })).getByText('0'),
    ).toBeInTheDocument();

    // Nombres en su columna.
    expect(
      within(screen.getByRole('region', { name: 'Columna Preselección' })).getByText('Ana García'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Columna Entrevistas' })).getByText('Sofía Rivas'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Columna Entrevistas' })).getByText('Laura Méndez'),
    ).toBeInTheDocument();
  });

  it('la tarjeta descartada muestra el motivo y su badge', async () => {
    pintarTablero('analista_seleccion');

    expect(await screen.findByText('Laura Méndez')).toBeInTheDocument();
    expect(screen.getByText('Descartado')).toBeInTheDocument();
    expect(screen.getByText(/No aprueba la prueba técnica/)).toBeInTheDocument();
  });

  it('las tarjetas TERMINALES (contratada y descartada) no tienen acciones de movimiento', async () => {
    pintarTablero('analista_seleccion');

    const contratada = await screen.findByText('Pedro Sánchez');
    const tarjeta = contratada.closest('article') as HTMLElement;
    // Sin ◀, ▶ ni «Descartar»: los terminales no se mueven ni se descartan.
    expect(within(tarjeta).queryByRole('button', { name: /Mover a/ })).not.toBeInTheDocument();
    expect(within(tarjeta).queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument();
    expect(within(tarjeta).getByRole('button', { name: 'Historial' })).toBeInTheDocument();
  });
});

describe('tablero Kanban (acciones de movimiento)', () => {
  beforeEach(() => {
    limpiarSesion();
    reiniciarStore();
  });

  it('los botones ◀ ▶ solo apuntan a fases adyacentes (extremos ocultos)', async () => {
    pintarTablero('analista_seleccion');

    // Ana en Preselección (índice 0): SOLO ▶ (a Antecedentes); sin ◀.
    const ana = (await screen.findByText('Ana García')).closest('article') as HTMLElement;
    expect(within(ana).getByRole('button', { name: 'Mover a Antecedentes' })).toBeInTheDocument();
    expect(within(ana).queryByRole('button', { name: /◀/ })).not.toBeInTheDocument();

    // Luis en Antecedentes (índice 1): ◀ a Preselección y ▶ a Entrevistas.
    const luis = screen.getByText('Luis Martínez').closest('article') as HTMLElement;
    expect(within(luis).getByRole('button', { name: 'Mover a Preselección' })).toBeInTheDocument();
    expect(within(luis).getByRole('button', { name: 'Mover a Entrevistas' })).toBeInTheDocument();
  });

  it('pulsar ▶ llama al store y el servidor recibe el PATCH con la fase destino', async () => {
    const fetchMock = pintarTablero('analista_seleccion', {
      items: [fixturePostulacion({ id: 'p1', fase: 'preseleccion' })],
      adicional: (url, init) => {
        if (url === '/api/postulaciones/p1/fase' && init?.method === 'PATCH') {
          return { cuerpo: fixturePostulacion({ id: 'p1', fase: 'antecedentes' }) };
        }
        return undefined;
      },
    });

    const ana = (await screen.findByText('María Pérez')).closest('article') as HTMLElement;
    fireEvent.click(within(ana).getByRole('button', { name: 'Mover a Antecedentes' }));

    await waitFor(() => {
      const llamada = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/fase') && init?.method === 'PATCH',
      );
      expect(llamada).toBeDefined();
      const [, opciones] = llamada as [string, RequestInit];
      expect(JSON.parse(String(opciones.body))).toEqual({ fase: 'antecedentes' });
    });
  });
});

describe('tablero Kanban (diálogo de descarte)', () => {
  beforeEach(() => {
    limpiarSesion();
    reiniciarStore();
  });

  it('el diálogo exige un motivo de al menos 5 caracteres antes de enviar', async () => {
    const fetchMock = pintarTablero('analista_seleccion', {
      items: [fixturePostulacion({ id: 'p1', fase: 'preseleccion' })],
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));

    const dialogo = screen.getByRole('dialog');
    const confirmar = within(dialogo).getByRole('button', { name: 'Aceptar' });
    // Motivo vacío: Aceptar deshabilitado.
    expect(confirmar).toBeDisabled();

    // Motivo demasiado corto (menos de 5 tras recortar): sigue deshabilitado.
    fireEvent.change(within(dialogo).getByRole('textbox'), { target: { value: ' abc ' } });
    expect(confirmar).toBeDisabled();

    // Motivo válido: habilita el envío.
    fireEvent.change(within(dialogo).getByRole('textbox'), {
      target: { value: 'No cumple el perfil' },
    });
    expect(confirmar).toBeEnabled();
    // Aún NO se ha enviado nada al servidor.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/descarte'))).toHaveLength(
      0,
    );
  });

  it('confirmar el descarte envía el POST con el motivo recortado', async () => {
    const fetchMock = pintarTablero('analista_seleccion', {
      items: [fixturePostulacion({ id: 'p1', fase: 'preseleccion' })],
      adicional: (url, init) => {
        if (url === '/api/postulaciones/p1/descarte' && init?.method === 'POST') {
          return {
            status: 200,
            cuerpo: fixturePostulacion({
              id: 'p1',
              estado: 'descartado',
              motivoDescarte: 'No cumple el perfil',
            }),
          };
        }
        return undefined;
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
    const dialogo = screen.getByRole('dialog');
    fireEvent.change(within(dialogo).getByRole('textbox'), {
      target: { value: '  No cumple el perfil  ' },
    });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Aceptar' }));

    await waitFor(() => {
      const llamada = fetchMock.mock.calls.find(([url]) => String(url).includes('/descarte'));
      expect(llamada).toBeDefined();
      const [, opciones] = llamada as [string, RequestInit];
      expect(JSON.parse(String(opciones.body))).toEqual({ motivo: 'No cumple el perfil' });
    });
  });
});

describe('tablero Kanban (permisos por rol y requerimiento)', () => {
  beforeEach(() => {
    limpiarSesion();
    reiniciarStore();
  });

  it('lider_area ve el tablero en SOLO LECTURA (sin acciones de movimiento)', async () => {
    pintarTablero('lider_area');

    expect(await screen.findByRole('region', { name: 'Columna Preselección' })).toBeInTheDocument();
    // Ni botones de movimiento/descarte ni «Agregar candidato».
    expect(screen.queryByRole('button', { name: 'Mover a Antecedentes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar candidato' })).not.toBeInTheDocument();
    // El aviso de solo lectura por rol es visible.
    expect(screen.getByText(/no mover postulaciones/i)).toBeInTheDocument();
  });

  it('con el requerimiento fuera de «en proceso» el tablero es de solo lectura con aviso', async () => {
    pintarTablero('analista_seleccion', { estadoRequerimiento: 'cerrado' });

    expect(await screen.findByText(/no está «En proceso»/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mover a Antecedentes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar candidato' })).not.toBeInTheDocument();
  });
});

describe('tablero Kanban (panel de historial)', () => {
  beforeEach(() => {
    limpiarSesion();
    reiniciarStore();
  });

  it('abrir el historial pinta las entradas del fixture con antes → después', async () => {
    pintarTablero('analista_seleccion', {
      items: [fixturePostulacion({ id: 'p1', fase: 'preseleccion' })],
      adicional: (url) => {
        if (url === '/api/postulaciones/p1/historial') {
          return {
            cuerpo: [
              fixtureHistorialPostulacion({
                accion: 'UPDATE',
                campos: [{ campo: 'fase', antes: 'preseleccion', despues: 'antecedentes' }],
              }),
            ],
          };
        }
        return undefined;
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Historial' }));

    const panel = await screen.findByRole('complementary', { name: /Historial de María Pérez/ });
    expect(within(panel).getByText('Cambio')).toBeInTheDocument();
    expect(within(panel).getByText(/preseleccion/)).toBeInTheDocument();
    expect(within(panel).getByText(/antecedentes/)).toBeInTheDocument();
    expect(within(panel).getByText('ana@larco.test')).toBeInTheDocument();
  });
});
