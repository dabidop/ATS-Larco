import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.validation';

/**
 * Hash de BÚSQUEDA de la cédula por HMAC-SHA-256 (Fase 4, parte 1).
 *
 * Problema que resuelve: la cédula se guarda CIFRADA (`cedula_cifrada`,
 * AES-256-CBC con IV aleatorio), y dos cifrados del mismo dato son DISTINTOS
 * (IV distinto), así que NO se puede buscar "el candidato con cédula X" con un
 * `WHERE cedula_cifrada = ...` sin descifrar toda la tabla.
 *
 * Solución: junto a la cédula cifrada se guarda `cedula_hash`, el HMAC-SHA-256
 * (hex) de la cédula NORMALIZADA calculado con una llave secreta dedicada
 * (`CEDULA_SEARCH_KEY`). El hash es DETERMINISTA para la misma cédula, de modo
 * que `WHERE cedula_hash = <hash(X)>` localiza al candidato SIN descifrar nada.
 *
 * Por qué HMAC y no un hash simple (SHA-256 a secas): el espacio de cédulas es
 * PEQUEÑO (~10^8), por lo que un hash simple sería reversible por fuerza bruta
 * precalculando todos los hashes. El HMAC introduce la llave secreta en el
 * cómputo, así que quien no conoce `CEDULA_SEARCH_KEY` no puede generar
 * candidatos de hash ni verificar suposiciones. El hash NO es reversible en
 * ninguno de los dos sentidos; el HMAC solo añade resistencia a diccionario.
 *
 * Normalización: la cédula se reduce a SOLO DÍGITOS antes de hashear (quita
 * puntos, guiones y espacios), de modo que "1.234.567-8" y "12345678" producen
 * el MISMO hash y la búsqueda exacta es insensible al formato de entrada.
 *
 * Ubicación: vive en `candidatos/` porque por ahora es específico de la cédula.
 * `common/crypto/**` queda intacto (solo lo consume `CryptoService`); si otro
 * módulo necesita hashear PII para búsqueda, se promoverá allí sin cambiar la
 * firma.
 *
 * La llave se decodifica UNA sola vez en el constructor (fallo temprano si la
 * configuración es incorrecta), igual que `CryptoService`. Es unit-testeable:
 * el constructor inyecta `ConfigService` y los tests lo sustituyen por un doble.
 */

/** Longitud en bytes de una llave HMAC-SHA-256 (32 B = 256 bits). */
const KEY_BYTES = 32;

@Injectable()
export class SearchHashService {
  /** Llave HMAC ya decodificada, lista para hashear. */
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    // `get` (no `getOrThrow`) + comprobación manual: la clave es OPCIONAL en zod
    // (ver `env.validation.ts`), así que el "falta aquí" se traduce en este
    // error claro de arranque en lugar de un `undefined` silencioso.
    const keyBase64 = config.get<string | undefined>('CEDULA_SEARCH_KEY');
    if (keyBase64 === undefined || keyBase64.trim() === '') {
      throw new Error(
        'CEDULA_SEARCH_KEY es requerida para calcular el hash de búsqueda de cédulas (32 bytes en base64)',
      );
    }
    this.key = SearchHashService.decodeKey(keyBase64, 'CEDULA_SEARCH_KEY');
  }

  /**
   * Devuelve el HMAC-SHA-256 (hex, 64 caracteres) de la cédula NORMALIZADA
   * (solo dígitos).
   *
   * Lanza un Error con mensaje claro si la cédula, tras normalizar, no queda
   * con ningún dígito (vacío o solo separadores): no tiene sentido guardar un
   * hash de un candidato sin cédula.
   */
  hashCedula(plain: string): string {
    const normalizada = SearchHashService.normalizarCedula(plain);
    if (normalizada === '') {
      throw new Error(
        'La cédula debe contener al menos un dígito para calcular su hash de búsqueda',
      );
    }
    return createHmac('sha256', this.key).update(normalizada, 'utf8').digest('hex');
  }

  /** Reduce una cédula a SOLO dígitos (quita puntos, guiones y espacios). */
  static normalizarCedula(plain: string): string {
    return plain.replace(/\D/g, '');
  }

  /** Decodifica y valida una llave base64 (32 bytes) con mensaje claro. */
  private static decodeKey(base64: string, name: string): Buffer {
    const key = Buffer.from(base64, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(`${name} debe decodificar a exactamente 32 bytes en base64`);
    }
    return key;
  }
}
