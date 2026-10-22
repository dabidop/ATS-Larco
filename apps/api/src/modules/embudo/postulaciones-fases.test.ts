import { describe, expect, it } from 'vitest';

import {
  ESTADOS,
  ESTADOS_TERMINALES,
  FASES,
  FASE_CONTRATACION,
  esRetroceso,
  esSiguiente,
  esTerminal,
  estadoTrasMover,
  faseSiguiente,
  mensajeFaseActual,
  mensajeNoAdyacente,
  mensajeRetroceso,
  mensajeTerminal,
  type Fase,
} from './postulaciones-fases';

/**
 * Tests unitarios HERMÉTICOS de las reglas del embudo (Fase 5 + Etapa 9):
 * datos puros, cero BD y cero Nest. Los errores HTTP que estas reglas producen
 * (409/400) se verifican en `test/postulaciones.e2e.test.ts` contra la BD dev
 * real.
 *
 * Etapa 9 (retroalimentación, regla 11): el embudo SOLO AVANZA un paso. Antes
 * la adyacencia era ±1 (se podía regresar); ahora `esSiguiente` solo admite el
 * paso hacia DELANTE y `esRetroceso` existe para el mensaje específico.
 *
 * `P` es un alias corto de la fase `preseleccion`: los tests son la única zona
 * donde se repite tanto, el código fuente usa los nombres completos.
 */

/** Los 4 pasos hacia ADELANTE del embudo (el único tipo de movimiento válido). */
const AVANCES: ReadonlyArray<[Fase, Fase]> = [
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

describe('esSiguiente — SOLO un paso hacia ADELANTE (Etapa 9: no retrocede)', () => {
  it('los 4 pasos hacia ADELANTE son válidos', () => {
    for (const [origen, destino] of AVANCES) {
      expect(esSiguiente(origen, destino)).toBe(true);
    }
  });

  it('los pasos hacia ATRÁS NO son válidos (el embudo no retrocede)', () => {
    for (const [origen, destino] of AVANCES) {
      expect(esSiguiente(destino, origen)).toBe(false);
    }
  });

  it('la MISMA fase nunca es un avance (no hay nada que mover)', () => {
    for (const fase of FASES) {
      expect(esSiguiente(fase, fase)).toBe(false);
    }
  });

  it('los SALTOS de fase NO son válidos (2, 3 y 4 pasos)', () => {
    expect(esSiguiente('preseleccion', 'entrevistas')).toBe(false); // 2 pasos
    expect(esSiguiente('preseleccion', 'proveedor_externo')).toBe(false); // 3 pasos
    expect(esSiguiente('preseleccion', 'contratacion')).toBe(false); // 4 pasos
  });

  it('cubre EXACTAMENTE los 4 pares válidos de las 5 fases', () => {
    const pares: string[] = [];
    for (const origen of FASES) {
      for (const destino of FASES) {
        if (esSiguiente(origen, destino)) {
          pares.push(`${origen}>${destino}`);
        }
      }
    }
    expect(pares).toHaveLength(4);
  });
});

describe('esRetroceso — detecta el intento de devolver (para el mensaje 409)', () => {
  it('los 4 pasos hacia ATRÁS son retrocesos', () => {
    for (const [origen, destino] of AVANCES) {
      expect(esRetroceso(destino, origen)).toBe(true);
    }
  });

  it('los avances, la misma fase y los saltos NO son retrocesos', () => {
    for (const [origen, destino] of AVANCES) {
      expect(esRetroceso(origen, destino)).toBe(false);
    }
    expect(esRetroceso('entrevistas', 'entrevistas')).toBe(false);
    expect(esRetroceso('preseleccion', 'contratacion')).toBe(false); // salto
  });
});

describe('faseSiguiente — el ÚNICO destino válido desde cada fase', () => {
  it('cada fase tiene UNA siguiente; contratación no tiene (es la última)', () => {
    expect(faseSiguiente('preseleccion')).toBe('antecedentes');
    expect(faseSiguiente('antecedentes')).toBe('entrevistas');
    expect(faseSiguiente('entrevistas')).toBe('proveedor_externo');
    expect(faseSiguiente('proveedor_externo')).toBe('contratacion');
    expect(faseSiguiente('contratacion')).toBeUndefined();
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
  it('mensajeNoAdyacente nombra el origen, el destino y la ÚNICA fase válida', () => {
    const mensaje = mensajeNoAdyacente('preseleccion', 'entrevistas');
    expect(mensaje).toContain('El embudo solo avanza UN paso');
    expect(mensaje).toContain("'preseleccion'");
    expect(mensaje).toContain("'entrevistas'");
    expect(mensaje).toContain("'antecedentes'");
    expect(mensaje).not.toContain("'contratacion'");
  });

  it('mensajeNoAdyacente, desde la última fase, dice que no hay adónde ir', () => {
    const mensaje = mensajeNoAdyacente('contratacion', 'antecedentes');
    // contratacion no tiene siguiente: el servicio responde antes (estado terminal),
    // pero el texto queda cubierto por si acaso.
    expect(mensaje).toContain('ninguna');
  });

  it('mensajeRetroceso explica que el embudo no devuelve candidatos', () => {
    const mensaje = mensajeRetroceso('entrevistas', 'antecedentes');
    expect(mensaje).toContain('solo avanza');
    expect(mensaje).toContain("'entrevistas'");
    expect(mensaje).toContain("'antecedentes'");
    expect(mensaje).toContain('descarte');
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
