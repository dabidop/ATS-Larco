import { describe, expect, it } from 'vitest';

import {
  ESTADOS,
  ESTADOS_TERMINALES,
  FASES,
  FASE_CONTRATACION,
  esAdyacente,
  esTerminal,
  estadoTrasMover,
  fasesAdyacentes,
  mensajeFaseActual,
  mensajeNoAdyacente,
  mensajeTerminal,
  type Fase,
} from './postulaciones-fases';

/**
 * Tests unitarios HERMÉTICOS de las reglas del embudo (Fase 5): datos puros,
 * cero BD y cero Nest. Los errores HTTP que estas reglas producen (409/400)
 * se verifican en `test/postulaciones.e2e.test.ts` contra la BD dev real.
 *
 * `P` es un alias corto de la fase `preseleccion`: los tests son la única zona
 * donde se repite tanto, el código fuente usa los nombres completos.
 */

/** Pares de fases que están a UN paso (los 4 saltos del embudo, en ambos sentidos). */
const ADYACENCIAS: ReadonlyArray<[Fase, Fase]> = [
  ['preseleccion', 'antecedentes'],
  ['antecedentes', 'entrevistas'],
  ['entrevistas', 'proveedor_externo'],
  ['proveedor_externo', 'contratacion'],
];

describe('FASES / ESTADOS — el orden del tablero', () => {
  it('las 5 fases, EN ORDEN de avance', () => {
    expect(FASES).toEqual([
      'preseleccion',
      'antecedentes',
      'entrevistas',
      'proveedor_externo',
      'contratacion',
    ]);
  });

  it('los 3 estados: 1 activa + 2 terminales', () => {
    expect(ESTADOS).toEqual(['activa', 'contratado', 'descartado']);
  });

  it('contratado y descartado son los ÚNICOS estados terminales', () => {
    expect(ESTADOS_TERMINALES).toEqual(['contratado', 'descartado']);
    expect(esTerminal('contratado')).toBe(true);
    expect(esTerminal('descartado')).toBe(true);
    expect(esTerminal('activa')).toBe(false);
  });

  it('la fase de contratación es la ÚLTIMA del embudo', () => {
    expect(FASE_CONTRATACION).toBe('contratacion');
    expect(FASES[FASES.length - 1]).toBe(FASE_CONTRATACION);
  });
});

describe('esAdyacente — solo un paso, en AMBAS direcciones', () => {
  it('las 4 adyacencias hacia ADELANTE son válidas', () => {
    for (const [origen, destino] of ADYACENCIAS) {
      expect(esAdyacente(origen, destino)).toBe(true);
    }
  });

  it('las 4 adyacencias hacia ATRÁS también son válidas (el Kanban permite regresar)', () => {
    for (const [origen, destino] of ADYACENCIAS) {
      expect(esAdyacente(destino, origen)).toBe(true);
    }
  });

  it('la MISMA fase nunca es adyacente (no hay nada que mover)', () => {
    for (const fase of FASES) {
      expect(esAdyacente(fase, fase)).toBe(false);
    }
  });

  it('los SALTOS de fase NO son adyacentes (2, 3 y 4 pasos)', () => {
    expect(esAdyacente('preseleccion', 'entrevistas')).toBe(false); // 2 pasos
    expect(esAdyacente('preseleccion', 'proveedor_externo')).toBe(false); // 3 pasos
    expect(esAdyacente('preseleccion', 'contratacion')).toBe(false); // 4 pasos
    expect(esAdyacente('contratacion', 'antecedentes')).toBe(false); // 3 pasos atrás
  });

  it('cubre exactamente los 8 pares adyacentes de las 5 fases (5 × 4 = 20 pares directos)', () => {
    const pares: string[] = [];
    for (const origen of FASES) {
      for (const destino of FASES) {
        if (esAdyacente(origen, destino)) {
          pares.push(`${origen}>${destino}`);
        }
      }
    }
    expect(pares).toHaveLength(8);
  });
});

describe('fasesAdyacentes — los destinos válidos desde cada fase', () => {
  it('los extremos tienen UN destino; el centro, DOS', () => {
    expect(fasesAdyacentes('preseleccion')).toEqual(['antecedentes']);
    expect(fasesAdyacentes('contratacion')).toEqual(['proveedor_externo']);
    expect(fasesAdyacentes('antecedentes')).toEqual(['preseleccion', 'entrevistas']);
    expect(fasesAdyacentes('entrevistas')).toEqual(['antecedentes', 'proveedor_externo']);
    expect(fasesAdyacentes('proveedor_externo')).toEqual(['entrevistas', 'contratacion']);
  });
});

describe('estadoTrasMover — llegar a contratación ES contratar', () => {
  it('contratacion ⇒ contratado (estado terminal)', () => {
    expect(estadoTrasMover('contratacion')).toBe('contratado');
  });

  it('cualquier otra fase ⇒ sigue activa', () => {
    for (const fase of FASES) {
      if (fase !== FASE_CONTRATACION) {
        expect(estadoTrasMover(fase)).toBe('activa');
      }
    }
  });
});

describe('mensajes de error (los testea el e2e, aquí se fija el texto)', () => {
  it('mensajeNoAdyacente nombra el origen, el destino y las fases válidas', () => {
    const mensaje = mensajeNoAdyacente('preseleccion', 'entrevistas');
    expect(mensaje).toContain('Solo se puede mover un paso');
    expect(mensaje).toContain("'preseleccion'");
    expect(mensaje).toContain("'entrevistas'");
    expect(mensaje).toContain("'antecedentes'");
    expect(mensaje).not.toContain("'contratacion'");
  });

  it('mensajeFaseActual explica que ya está en esa fase', () => {
    expect(mensajeFaseActual('entrevistas')).toBe(
      "La postulación ya está en la fase 'entrevistas': elige una fase distinta",
    );
  });

  it('mensajeTerminal nombra el estado y la acción denegada', () => {
    const mensaje = mensajeTerminal('contratado', 'nuevos movimientos de fase');
    expect(mensaje).toContain('Estado terminal');
    expect(mensaje).toContain("'contratado'");
    expect(mensaje).toContain('nuevos movimientos de fase');
  });
});
