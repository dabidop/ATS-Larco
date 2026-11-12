import { describe, expect, it } from 'vitest';

import { validarRevisiones } from './importacion.service';

const revision = (indice: number) => ({
  indice,
  nombres: 'Ana',
  apellidos: 'Prueba',
  email: 'ana@example.test',
  telefono: null,
  ciudad: 'Bogota',
  habilidades: ['TypeScript'],
});

describe('validación runtime de revisiones de importación', () => {
  it('rechaza índices repetidos o fuera del lote con 400 controlado', () => {
    expect(() => validarRevisiones([revision(0), revision(0)], 2)).toThrow(
      'Los índices de revisión deben ser únicos y estar dentro del lote',
    );
    expect(() => validarRevisiones([revision(2)], 1)).toThrow(
      'Los índices de revisión deben ser únicos y estar dentro del lote',
    );
  });

  it('rechaza campos editados que incumplen límites o formato', () => {
    expect(() => validarRevisiones([{ ...revision(0), email: 'no-es-email' }], 1)).toThrow(
      'email inválido en la revisión 1',
    );
    expect(() => validarRevisiones([{ ...revision(0), ciudad: 'x'.repeat(81) }], 1)).toThrow(
      'ciudad inválido en la revisión 1',
    );
  });

  it('distingue JSON válido con forma inválida de JSON mal formado', () => {
    expect(() => validarRevisiones({ indice: 0 }, 1)).toThrow(
      'revisiones debe contener una revisión por cada archivo',
    );
    expect(() => validarRevisiones([{ ...revision(0), nombres: '' }], 1)).toThrow(
      'nombres y apellidos inválidos en la revisión 1',
    );
    expect(() => validarRevisiones([{ ...revision(0), campoExtra: 'no permitido' }], 1)).toThrow(
      'La revisión contiene campos no permitidos',
    );
  });

  it('conserva edición y habilidades solo como sugerencia de la revisión', () => {
    expect(validarRevisiones([revision(0)], 1)[0]).toMatchObject({
      nombres: 'Ana',
      apellidos: 'Prueba',
      habilidades: ['TypeScript'],
    });
  });
});
