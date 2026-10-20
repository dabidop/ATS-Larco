import { describe, expect, it } from 'vitest';

import type { RoleCode } from '../../common/decorators/roles.decorator';
import { EstadoRequerimiento } from './requerimiento.entity';
import {
  PERMISOS_TRANSICION,
  TRANSICIONES_VALIDAS,
  denegacionPermiso,
  esTransicionValida,
  puedeTransitar,
  transicionesPermitidas,
} from './requerimientos-flujo';

/**
 * Tests unitarios HERMÉTICOS de la máquina de estados del flujo de
 * requerimientos (Fase 3, parte 4): datos puros, cero BD.
 *
 * Cobertura: transiciones válidas/inválidas por estado, estados terminales sin
 * salida, la matriz de permisos COMPLETA (5 estados × 5 destinos × 3 roles ×
 * creador/no-creador = 150 combinaciones contra el contrato declarado) y las
 * reglas extra —`lider_area` solo retira SU solicitud—. Los errores HTTP que
 * la máquina produce (409/403/400) se verifican en
 * `test/requerimientos-flujo.e2e.test.ts` contra la BD dev.
 *
 * `E` es solo un alias corto del enum: los tests son la única zona donde se
 * repite tanto, el código fuente usa `EstadoRequerimiento` completo.
 */

const E = EstadoRequerimiento;
const TODOS_ESTADOS = Object.values(E);
const TODOS_ROLES: readonly RoleCode[] = ['admin_rrhh', 'analista_seleccion', 'lider_area'];

describe('TRANSICIONES_VALIDAS — transiciones por estado', () => {
  it('pendiente → [aprobado, rechazado] (única bifurcación del flujo)', () => {
    expect(TRANSICIONES_VALIDAS[E.Pendiente]).toEqual([E.Aprobado, E.Rechazado]);
  });

  it('aprobado → [en_proceso] y en_proceso → [cerrado] (lineal)', () => {
    expect(TRANSICIONES_VALIDAS[E.Aprobado]).toEqual([E.EnProceso]);
    expect(TRANSICIONES_VALIDAS[E.EnProceso]).toEqual([E.Cerrado]);
  });

  it('cerrado y rechazado son TERMINALES: sin destinos', () => {
    expect(TRANSICIONES_VALIDAS[E.Cerrado]).toEqual([]);
    expect(TRANSICIONES_VALIDAS[E.Rechazado]).toEqual([]);
  });

  it('cubre exactamente los 5 estados del enum (nada más, nada menos)', () => {
    expect(Object.keys(TRANSICIONES_VALIDAS).sort()).toEqual([...TODOS_ESTADOS].sort());
  });

  it('esTransicionValida: las 4 aristas del flujo sí, el resto no', () => {
    const validas: Array<[EstadoRequerimiento, EstadoRequerimiento]> = [
      [E.Pendiente, E.Aprobado],
      [E.Pendiente, E.Rechazado],
      [E.Aprobado, E.EnProceso],
      [E.EnProceso, E.Cerrado],
    ];
    for (const [origen, destino] of validas) {
      expect(esTransicionValida(origen, destino)).toBe(true);
    }

    // Saltos del lineal, retrocesos, auto-transiciones y todo lo que sale de
    // un estado terminal: inválido.
    expect(esTransicionValida(E.Pendiente, E.EnProceso)).toBe(false);
    expect(esTransicionValida(E.Pendiente, E.Cerrado)).toBe(false);
    expect(esTransicionValida(E.Aprobado, E.Cerrado)).toBe(false);
    expect(esTransicionValida(E.Aprobado, E.Rechazado)).toBe(false);
    expect(esTransicionValida(E.Aprobado, E.Pendiente)).toBe(false);
    expect(esTransicionValida(E.EnProceso, E.Aprobado)).toBe(false);
    expect(esTransicionValida(E.Pendiente, E.Pendiente)).toBe(false);
    expect(esTransicionValida(E.Cerrado, E.Aprobado)).toBe(false);
    expect(esTransicionValida(E.Rechazado, E.Pendiente)).toBe(false);
  });
});

describe('PERMISOS_TRANSICION — matriz por rol', () => {
  it('declara permisos SOLO para las 4 transiciones válidas', () => {
    expect(Object.keys(PERMISOS_TRANSICION).sort()).toEqual([
      'aprobado>en_proceso',
      'en_proceso>cerrado',
      'pendiente>aprobado',
      'pendiente>rechazado',
    ]);
  });

  it('aplica la matriz exacta del negocio', () => {
    expect(PERMISOS_TRANSICION['pendiente>aprobado']).toEqual(['admin_rrhh']);
    expect(PERMISOS_TRANSICION['pendiente>rechazado']).toEqual(['admin_rrhh', 'lider_area']);
    expect(PERMISOS_TRANSICION['aprobado>en_proceso']).toEqual([
      'admin_rrhh',
      'analista_seleccion',
    ]);
    expect(PERMISOS_TRANSICION['en_proceso>cerrado']).toEqual(['admin_rrhh']);
  });

  it('cada clave de permisos corresponde a una transición estructuralmente válida', () => {
    for (const clave of Object.keys(PERMISOS_TRANSICION)) {
      const partes = clave.split('>');
      expect(partes).toHaveLength(2);
      const origen = partes[0] as EstadoRequerimiento;
      const destino = partes[1] as EstadoRequerimiento;
      expect(esTransicionValida(origen, destino)).toBe(true);
    }
  });
});

describe('puedeTransitar — matriz COMPLETA (estados × destinos × roles × autoría)', () => {
  /**
   * Contrato declarado: TODAS las combinaciones permitidas. El test cruza el
   * producto cartesiano completo (150 combinaciones) contra este conjunto;
   * cualquier permiso que no esté declarado aquí abajo hace fallar la suite.
   *
   * Formato: `origen>destino>rol` — la dimensión creador/no-creador se expande
   * abajo: solo `pendiente>rechazado>lider_area` distingue autoría (y SOLO en
   * modo creador).
   */
  const PERMITIDAS = new Set([
    'pendiente>aprobado>admin_rrhh',
    'pendiente>rechazado>admin_rrhh',
    'pendiente>rechazado>lider_area',
    'aprobado>en_proceso>admin_rrhh',
    'aprobado>en_proceso>analista_seleccion',
    'en_proceso>cerrado>admin_rrhh',
  ]);

  /** La ÚNICA combinación restringida a ser el creador de la solicitud. */
  const EXIGE_CREADOR = new Set(['pendiente>rechazado>lider_area']);

  it('verifica las 150 combinaciones posibles contra el contrato', () => {
    for (const origen of TODOS_ESTADOS) {
      for (const destino of TODOS_ESTADOS) {
        for (const role of TODOS_ROLES) {
          for (const esCreador of [true, false]) {
            const clave = `${origen}>${destino}>${role}`;
            const esperado = PERMITIDAS.has(clave) && (!EXIGE_CREADOR.has(clave) || esCreador);

            expect(
              puedeTransitar(origen, destino, role, esCreador),
              `${clave} (creador=${esCreador}) debía dar ${esperado}`,
            ).toBe(esperado);
          }
        }
      }
    }
  });

  it('regla extra: lider_area NO rechaza una solicitud ajena, SÍ la suya', () => {
    expect(puedeTransitar(E.Pendiente, E.Rechazado, 'lider_area', true)).toBe(true);
    expect(puedeTransitar(E.Pendiente, E.Rechazado, 'lider_area', false)).toBe(false);
    // admin_rrhh no está sujeto a la regla del creador: rechaza cualquier fila.
    expect(puedeTransitar(E.Pendiente, E.Rechazado, 'admin_rrhh', false)).toBe(true);
  });

  it('quién aprueba y quién cierra es SOLO admin_rrhh', () => {
    for (const role of TODOS_ROLES) {
      expect(puedeTransitar(E.Pendiente, E.Aprobado, role, true)).toBe(role === 'admin_rrhh');
      expect(puedeTransitar(E.EnProceso, E.Cerrado, role, true)).toBe(role === 'admin_rrhh');
    }
  });

  it('una transición estructuralmente inválida NUNCA está permitida, ni siquiera para admin', () => {
    expect(puedeTransitar(E.Pendiente, E.EnProceso, 'admin_rrhh', true)).toBe(false);
    expect(puedeTransitar(E.Aprobado, E.Cerrado, 'admin_rrhh', true)).toBe(false);
    expect(puedeTransitar(E.Aprobado, E.Aprobado, 'admin_rrhh', true)).toBe(false);
  });
});

describe('transicionesPermitidas — opciones visibles por estado y rol', () => {
  it('pendiente + admin_rrhh → aprueba o rechaza (creador o no)', () => {
    expect(transicionesPermitidas(E.Pendiente, 'admin_rrhh', true)).toEqual([
      E.Aprobado,
      E.Rechazado,
    ]);
    expect(transicionesPermitidas(E.Pendiente, 'admin_rrhh', false)).toEqual([
      E.Aprobado,
      E.Rechazado,
    ]);
  });

  it('pendiente + analista_seleccion → ninguna opción (no administra el flujo)', () => {
    expect(transicionesPermitidas(E.Pendiente, 'analista_seleccion', true)).toEqual([]);
    expect(transicionesPermitidas(E.Pendiente, 'analista_seleccion', false)).toEqual([]);
  });

  it('pendiente + lider_area → solo rechazar, y solo si es el creador', () => {
    expect(transicionesPermitidas(E.Pendiente, 'lider_area', true)).toEqual([E.Rechazado]);
    expect(transicionesPermitidas(E.Pendiente, 'lider_area', false)).toEqual([]);
  });

  it('aprobado → en_proceso para admin y analista; nunca para líder', () => {
    expect(transicionesPermitidas(E.Aprobado, 'admin_rrhh', false)).toEqual([E.EnProceso]);
    expect(transicionesPermitidas(E.Aprobado, 'analista_seleccion', false)).toEqual([E.EnProceso]);
    expect(transicionesPermitidas(E.Aprobado, 'lider_area', false)).toEqual([]);
  });

  it('en_proceso → cerrado solo para admin_rrhh', () => {
    expect(transicionesPermitidas(E.EnProceso, 'admin_rrhh', false)).toEqual([E.Cerrado]);
    expect(transicionesPermitidas(E.EnProceso, 'analista_seleccion', false)).toEqual([]);
    expect(transicionesPermitidas(E.EnProceso, 'lider_area', false)).toEqual([]);
  });

  it('estados terminales → ninguna opción para NINGÚN rol', () => {
    for (const estado of [E.Cerrado, E.Rechazado]) {
      for (const role of TODOS_ROLES) {
        expect(transicionesPermitidas(estado, role, true)).toEqual([]);
        expect(transicionesPermitidas(estado, role, false)).toEqual([]);
      }
    }
  });
});

describe('denegacionPermiso — motivos de 403 en español', () => {
  it('devuelve null cuando la transición está permitida', () => {
    expect(denegacionPermiso(E.Pendiente, E.Aprobado, 'admin_rrhh', false)).toBeNull();
    expect(denegacionPermiso(E.Pendiente, E.Rechazado, 'lider_area', true)).toBeNull();
  });

  it('nombra el ROL y la TRANSICIÓN cuando el rol no está en la matriz', () => {
    const motivo = denegacionPermiso(E.Pendiente, E.Aprobado, 'analista_seleccion', false);
    expect(motivo).toContain('analista_seleccion');
    expect(motivo).toContain('pendiente → aprobado');
    expect(motivo).toContain('admin_rrhh'); // informa de quién SÍ puede
  });

  it('explica la regla del creador cuando un líder intenta rechazar lo ajeno', () => {
    const motivo = denegacionPermiso(E.Pendiente, E.Rechazado, 'lider_area', false);
    expect(motivo).toContain('creador');
    expect(motivo).toContain('lider_area');
    expect(motivo).toContain('pendiente → rechazado');
  });

  it('un rol desconocido tampoco puede transitar (queda fuera de la matriz)', () => {
    const motivo = denegacionPermiso(E.Pendiente, E.Aprobado, 'rol_inexistente', false);
    expect(motivo).toContain('rol_inexistente');
  });
});
