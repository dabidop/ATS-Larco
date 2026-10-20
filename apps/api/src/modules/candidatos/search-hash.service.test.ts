import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../config/env.validation';
import { SearchHashService } from './search-hash.service';

/**
 * Tests unitarios del hash de búsqueda HMAC-SHA-256 de la cédula (Fase 4,
 * parte 1). Herméticos: el `ConfigService` se SUSTITUYE por un doble mínimo que
 * expone solo `CEDULA_SEARCH_KEY`, así que NINGUNA aserción toca la BD ni el
 * `process.env`.
 */

/** Llave A: 32 bytes (0x0b) en base64. */
const KEY_A = Buffer.alloc(32, 11).toString('base64');
/** Llave B: 32 bytes (0x0d) en base64 (distinta de A). */
const KEY_B = Buffer.alloc(32, 13).toString('base64');

/** Crea el servicio con la llave indicada (doble de ConfigService). */
function createService(key: string | undefined): SearchHashService {
  const config = {
    get: (clave: string): string | undefined => (clave === 'CEDULA_SEARCH_KEY' ? key : undefined),
  };
  return new SearchHashService(config as unknown as ConfigService<Env, true>);
}

/** HMAC-SHA-256 (hex) calculado AQUÍ a mano: sirve de oráculo independiente. */
function hmacEsperado(llave: string, cedulaNormalizada: string): string {
  return createHmac('sha256', Buffer.from(llave, 'base64'))
    .update(cedulaNormalizada, 'utf8')
    .digest('hex');
}

describe('SearchHashService — determinismo y normalización', () => {
  it('la MISMA cédula produce SIEMPRE el mismo hash', () => {
    const service = createService(KEY_A);
    const primero = service.hashCedula('12345678');
    const segundo = service.hashCedula('12345678');

    expect(primero).toBe(segundo);
  });

  it('cédulas DISTINTAS producen hashes distintos', () => {
    const service = createService(KEY_A);

    expect(service.hashCedula('12345678')).not.toBe(service.hashCedula('12345679'));
    expect(service.hashCedula('87654321')).not.toBe(service.hashCedula('12345678'));
  });

  it('normaliza puntos, guiones y espacios: "1.234.567-8" == "12345678"', () => {
    const service = createService(KEY_A);

    expect(service.hashCedula('1.234.567-8')).toBe(service.hashCedula('12345678'));
    expect(service.hashCedula('  1 2 3 4 5 6 7 8  ')).toBe(service.hashCedula('12345678'));
    expect(service.hashCedula('1-2-3-4-5-6-7-8')).toBe(service.hashCedula('12345678'));
  });

  it('el hash coincide con el HMAC-SHA-256 (hex) de la cédula normalizada', () => {
    const service = createService(KEY_A);
    const cedula = '1.234.567-8';

    expect(service.hashCedula(cedula)).toBe(hmacEsperado(KEY_A, '12345678'));
    // Y es un hex de 64 caracteres (SHA-256 en hex), como exige el CHECK de BD.
    expect(service.hashCedula(cedula)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el hash NO contiene el texto plano de la cédula (no es reversible a simple vista)', () => {
    const service = createService(KEY_A);
    const hash = service.hashCedula('12345678');

    expect(hash).not.toContain('12345678');
  });
});

describe('SearchHashService — sensibilidad a la llave', () => {
  it('con llaves distintas, la misma cédula produce hashes distintos', () => {
    expect(createService(KEY_A).hashCedula('12345678')).not.toBe(
      createService(KEY_B).hashCedula('12345678'),
    );
  });

  it('un SHA-256 simple (sin llave) NO coincide: el HMAC aporta el secreto', () => {
    const service = createService(KEY_A);
    // Fuerza bruta sobre el pequeño espacio de cédulas: quien no tiene la llave
    // no puede precalcular el hash correcto.
    expect(service.hashCedula('12345678')).not.toBe(
      createHmac('sha256', '').update('12345678', 'utf8').digest('hex'),
    );
  });
});

describe('SearchHashService — errores y configuración', () => {
  it('cédula vacía o sin dígitos lanza Error con mensaje claro', () => {
    const service = createService(KEY_A);

    expect(() => service.hashCedula('')).toThrow(Error);
    expect(() => service.hashCedula('')).toThrow(/al menos un dígito/);
    expect(() => service.hashCedula('   ')).toThrow(/al menos un dígito/);
    expect(() => service.hashCedula('...---')).toThrow(/al menos un dígito/);
    expect(() => service.hashCedula('abc')).toThrow(/al menos un dígito/);
  });

  it('sin CEDULA_SEARCH_KEY (undefined) falla en el constructor con mensaje claro', () => {
    expect(() => createService(undefined)).toThrow(
      'CEDULA_SEARCH_KEY es requerida para calcular el hash de búsqueda de cédulas (32 bytes en base64)',
    );
  });

  it('con CEDULA_SEARCH_KEY vacía o en blanco falla en el constructor', () => {
    expect(() => createService('')).toThrow(/CEDULA_SEARCH_KEY es requerida/);
    expect(() => createService('   ')).toThrow(/CEDULA_SEARCH_KEY es requerida/);
  });

  it('con llave que no son 32 bytes falla en el constructor con mensaje claro', () => {
    expect(() => createService('cortita')).toThrow(
      'CEDULA_SEARCH_KEY debe decodificar a exactamente 32 bytes en base64',
    );
  });
});
