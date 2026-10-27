import { beforeEach, describe, expect, it } from 'vitest';

import { interpretarSoltar } from '../lib/embudo';
import { useTableroStore } from '../store/tablero';
import type { Postulacion } from '../tipos';
import { fixturePagina, fixturePostulacion, instalarFetch } from './ayudantes';

/**
 * Tests del store del tablero Kanban: carga, movimiento optimista + rollback,
 * descarte y alta. `fetch` SIEMPRE mockeado (sin red).
 */

describe('lógica del drop del Kanban (interpretarSoltar)', () => {
  it('con tablero editable y columna válida, decide mover a esa fase', () => {
    expect(interpretarSoltar(true, 'pos-1', 'entrevistas')).toEqual({
      procede: true,
      id: 'pos-1',
      fase: 'entrevistas',
    });
  });

  it('si el tablero NO es editable, ignora el drop (solo lectura)', () => {
    expect(interpretarSoltar(false, 'pos-1', 'entrevistas').procede).toBe(false);
  });

  it('si el drop no cayó sobre una columna (over nulo o id desconocido), no mueve', () => {
    expect(interpretarSoltar(true, 'pos-1', null).procede).toBe(false);
    expect(interpretarSoltar(true, 'pos-1', 'columna-inexistente').procede).toBe(false);
    expect(interpretarSoltar(true, 'pos-1', 42).procede).toBe(false);
  });

  it('si el id activo no es un string válido, no mueve', () => {
    expect(interpretarSoltar(true, undefined, 'entrevistas').procede).toBe(false);
    expect(interpretarSoltar(true, '', 'entrevistas').procede).toBe(false);
  });
});

/** Vuelve el store a su estado inicial entre tests (es un singleton). */
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

/** Lee el estado actual del store SIN suscripción. */
function estado() {
  return useTableroStore.getState();
}

/** Postulación mutada por referencia segura (para comparar). */
function buscar(id: string): Postulacion | undefined {
  return estado().postulaciones.find((postulacion) => postulacion.id === id);
}

describe('store del tablero (carga)', () => {
  beforeEach(() => {
    reiniciarStore();
  });

  it('cargar trae las postulaciones del requerimiento y fija el id', async () => {
    const items = [fixturePostulacion(), fixturePostulacion({ id: 'pos-2' })];
    const fetchMock = instalarFetch((url) => {
      if (url.includes('/api/postulaciones?requerimientoId=req-1'))
        return { cuerpo: fixturePagina(items) };
      return undefined;
    });

    await estado().cargar('req-1');

    expect(estado().postulaciones).toHaveLength(2);
    expect(estado().requerimientoId).toBe('req-1');
    expect(estado().cargando).toBe(false);
    expect(estado().error).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('cargar con fallo deja error en español y lista vacía', async () => {
    instalarFetch(() => ({ status: 500, cuerpo: { statusCode: 500, message: 'boom' } }));

    await estado().cargar('req-1');

    expect(estado().postulaciones).toEqual([]);
    expect(estado().error).toContain('boom');
  });
});

describe('store del tablero (mover: optimista + rollback)', () => {
  beforeEach(() => {
    reiniciarStore();
  });

  it('mover aplica el cambio AL INSTANTE antes de la respuesta del servidor', async () => {
    const original = fixturePostulacion();
    instalarFetch((url, init) => {
      if (url === '/api/postulaciones/pos-1/fase' && init?.method === 'PATCH') {
        return {
          cuerpo: { ...original, fase: 'antecedentes', updatedAt: '2026-02-11T10:00:00.000Z' },
        };
      }
      return undefined;
    });
    useTableroStore.setState({ postulaciones: [original], requerimientoId: 'req-1' });

    // `mover` ejecuta su `set` optimista de forma SÍNCRONA (antes del primer
    // `await`), así que justo tras lanzarlo —sin esperar— la tarjeta YA está
    // en la fase destino: esa es la esencia del patrón optimista.
    const promesa = estado().mover('pos-1', 'antecedentes', null);
    expect(buscar('pos-1')?.fase).toBe('antecedentes');
    expect(estado().guardando).toContain('pos-1');

    await expect(promesa).resolves.toBe(true);
    // Reconciliado con la respuesta del servidor (updatedAt real).
    expect(buscar('pos-1')?.fase).toBe('antecedentes');
    expect(buscar('pos-1')?.updatedAt).toBe('2026-02-11T10:00:00.000Z');
    expect(estado().guardando).toEqual([]);
    expect(estado().error).toBeNull();
  });

  it('mover a contratacion marca el estado como contratado (optimista)', async () => {
    const original = fixturePostulacion({ fase: 'proveedor_externo' });
    instalarFetch((url, init) => {
      if (url === '/api/postulaciones/pos-1/fase' && init?.method === 'PATCH') {
        return { cuerpo: { ...original, fase: 'contratacion', estado: 'contratado' } };
      }
      return undefined;
    });
    useTableroStore.setState({ postulaciones: [original], requerimientoId: 'req-1' });

    await estado().mover('pos-1', 'contratacion', null);

    expect(buscar('pos-1')?.fase).toBe('contratacion');
    expect(buscar('pos-1')?.estado).toBe('contratado');
  });

  it('mover con 409 hace ROLLBACK a la fase previa y deja el error visible', async () => {
    const original = fixturePostulacion({ fase: 'antecedentes', estado: 'activa' });
    instalarFetch((url, init) => {
      if (url === '/api/postulaciones/pos-1/fase' && init?.method === 'PATCH') {
        return {
          status: 409,
          cuerpo: { statusCode: 409, message: 'Conflicto: la postulación cambió' },
        };
      }
      return undefined;
    });
    useTableroStore.setState({ postulaciones: [original], requerimientoId: 'req-1' });

    const resultado = await estado().mover('pos-1', 'entrevistas', null);

    expect(resultado).toBe(false);
    // ROLLBACK: la tarjeta vuelve exactamente a su estado previo.
    expect(buscar('pos-1')?.fase).toBe('antecedentes');
    expect(buscar('pos-1')?.estado).toBe('activa');
    expect(estado().error).toContain('Conflicto');
    expect(estado().guardando).toEqual([]);
  });

  it('mover a una fase NO siguiente NO llama al servidor y no mueve nada', async () => {
    const original = fixturePostulacion({ fase: 'preseleccion' });
    const fetchMock = instalarFetch(() => undefined);
    useTableroStore.setState({ postulaciones: [original], requerimientoId: 'req-1' });

    const resultado = await estado().mover('pos-1', 'entrevistas', null);

    expect(resultado).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buscar('pos-1')?.fase).toBe('preseleccion');
    expect(estado().error).toContain('El embudo solo avanza');
  });

  it('RETROCEDER una fase NO se admite: el embudo solo avanza (sin fetch)', async () => {
    const original = fixturePostulacion({ fase: 'entrevistas', estado: 'activa' });
    const fetchMock = instalarFetch(() => undefined);
    useTableroStore.setState({ postulaciones: [original], requerimientoId: 'req-1' });

    const resultado = await estado().mover('pos-1', 'antecedentes', null);

    expect(resultado).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buscar('pos-1')?.fase).toBe('entrevistas');
    expect(estado().error).toContain('El embudo solo avanza');
  });

  it('con el CUPO lleno, avanzar a contratacion NO llama al servidor (regla 4)', async () => {
    // 1 plaza; ya hay UN contratado → el cupo está completo.
    const activa = fixturePostulacion({ id: 'pos-1', fase: 'proveedor_externo' });
    const contratada = fixturePostulacion({
      id: 'pos-2',
      fase: 'contratacion',
      estado: 'contratado',
    });
    const fetchMock = instalarFetch(() => undefined);
    useTableroStore.setState({
      postulaciones: [activa, contratada],
      requerimientoId: 'req-1',
    });

    const resultado = await estado().mover('pos-1', 'contratacion', 1);

    expect(resultado).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buscar('pos-1')?.fase).toBe('proveedor_externo');
    expect(estado().error).toContain('cubiertas');
  });

  it('mover un estado terminal ni siquiera consulta el servidor', async () => {
    const original = fixturePostulacion({ fase: 'entrevistas', estado: 'contratado' });
    const fetchMock = instalarFetch(() => undefined);
    useTableroStore.setState({ postulaciones: [original], requerimientoId: 'req-1' });

    const resultado = await estado().mover('pos-1', 'antecedentes', null);

    expect(resultado).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buscar('pos-1')?.fase).toBe('entrevistas');
    expect(estado().error).toContain('terminal');
  });
});

describe('store del tablero (descartar)', () => {
  beforeEach(() => {
    reiniciarStore();
  });

  it('descartar con éxito marca el estado y el motivo conservando la fase', async () => {
    const original = fixturePostulacion({ fase: 'entrevistas' });
    instalarFetch((url, init) => {
      if (url === '/api/postulaciones/pos-1/descarte' && init?.method === 'POST') {
        return {
          cuerpo: {
            ...original,
            estado: 'descartado',
            motivoDescarte: 'No aprueba la prueba técnica',
          },
        };
      }
      return undefined;
    });
    useTableroStore.setState({ postulaciones: [original], requerimientoId: 'req-1' });

    const resultado = await estado().descartar('pos-1', 'No aprueba la prueba técnica');

    expect(resultado).toBe(true);
    expect(buscar('pos-1')?.estado).toBe('descartado');
    expect(buscar('pos-1')?.motivoDescarte).toBe('No aprueba la prueba técnica');
    expect(buscar('pos-1')?.fase).toBe('entrevistas');
    expect(estado().error).toBeNull();
  });

  it('descartar sin motivo (vacío tras recortar) NO llama al servidor', async () => {
    const original = fixturePostulacion();
    const fetchMock = instalarFetch(() => undefined);
    useTableroStore.setState({ postulaciones: [original], requerimientoId: 'req-1' });

    const resultado = await estado().descartar('pos-1', '   ');

    expect(resultado).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(estado().error).toContain('obligatorio');
  });

  it('descartar con 409 (terminal) deja el error y NO cambia la tarjeta', async () => {
    const original = fixturePostulacion({ estado: 'contratado' });
    instalarFetch((url) => {
      if (url === '/api/postulaciones/pos-1/descarte') {
        return { status: 409, cuerpo: { statusCode: 409, message: 'Estado terminal' } };
      }
      return undefined;
    });
    useTableroStore.setState({ postulaciones: [original], requerimientoId: 'req-1' });

    const resultado = await estado().descartar('pos-1', 'Motivo suficientemente largo');

    expect(resultado).toBe(false);
    expect(buscar('pos-1')?.estado).toBe('contratado');
    expect(estado().error).toContain('terminal');
  });
});

describe('store del tablero (agregar)', () => {
  beforeEach(() => {
    reiniciarStore();
  });

  it('agregar con éxito añade la tarjeta al tablero', async () => {
    const creada = fixturePostulacion({ id: 'pos-nueva', fase: 'preseleccion', estado: 'activa' });
    instalarFetch((url, init) => {
      if (url === '/api/postulaciones' && init?.method === 'POST')
        return { status: 201, cuerpo: creada };
      return undefined;
    });
    useTableroStore.setState({ postulaciones: [], requerimientoId: 'req-1' });

    const resultado = await estado().agregar('can-1');

    expect(resultado).not.toBeNull();
    expect(estado().postulaciones).toHaveLength(1);
    expect(buscar('pos-nueva')?.candidato.nombres).toBe('María');
    expect(estado().error).toBeNull();
  });

  it('agregar un duplicado (409) deja el mensaje del servidor y NO añade nada', async () => {
    instalarFetch((url) => {
      if (url === '/api/postulaciones') {
        return {
          status: 409,
          cuerpo: {
            statusCode: 409,
            message: 'El candidato can-1 ya tiene una postulación para el requerimiento req-1',
          },
        };
      }
      return undefined;
    });
    useTableroStore.setState({ postulaciones: [], requerimientoId: 'req-1' });

    const resultado = await estado().agregar('can-1');

    expect(resultado).toBeNull();
    expect(estado().postulaciones).toEqual([]);
    expect(estado().error).toContain('ya tiene una postulación');
  });

  it('agregar sin requerimiento abierto no hace fetch', async () => {
    const fetchMock = instalarFetch(() => undefined);
    useTableroStore.setState({ requerimientoId: null });

    const resultado = await estado().agregar('can-1');

    expect(resultado).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(estado().error).toContain('requerimiento');
  });
});
