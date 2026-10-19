import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE, healthcheckLabel } from '../src/index';

describe('healthcheckLabel', () => {
  it('devuelve la etiqueta de estado por defecto', () => {
    expect(healthcheckLabel()).toBe('api: desconectado');
  });
});

describe('SHARED_PACKAGE', () => {
  it('expone el nombre del paquete', () => {
    expect(SHARED_PACKAGE).toBe('@ats/shared');
  });
});
