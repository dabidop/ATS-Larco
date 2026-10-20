import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.validation';

/**
 * Cifrado de PII con AES-256-CBC (Fase 2, parte 3).
 *
 * Formato de salida VERSIONADO (permite rotar el esquema sin romper lecturas):
 *
 *   v1:<iv_b64>:<cipher_b64>
 *
 * - `v1`      → versión del esquema (rotaciones futuras usarán otra, p. ej. v2 con AEAD).
 * - `iv_b64`  → IV aleatorio de 16 bytes generado EN CADA llamada a `encrypt`.
 * - `cipher_b64` → texto cifrado (PKCS#7), sin el IV: se concatena en el mismo registro.
 *
 * Cadena vacía: `encrypt('')` devuelve `''` sin cifrar para que las columnas
 * PII vacías queden vacías (y `decrypt('')` → null); no tiene sentido guardar
 * texto cifrado de un campo opcional que no contiene datos.
 *
 * Rotación de llaves: `CRYPTO_KEY_BASE64` es la llave vigente (la que cifra)
 * y `CRYPTO_KEY_PREVIOUS_BASE64` (opcional) la anterior: al descifrar se
 * intenta primero con la vigente y, si falla, con la anterior, de modo que la
 * migración de datos puede hacerse de forma progresiva.
 *
 * NOTA (solo decisión, no acción): se usa AES-256-CBC por requerimiento
 * explícito del proyecto (IV aleatorio de 16 bytes por registro). Un AEAD
 * (AES-256-GCM) o un HMAC encrypt-then-MAC añadiría integridad AUTENTICADA:
 * con CBC basta detectar la corrupción a posterior (formato, IV, UTF-8), pero
 * no está garantizada criptográficamente. Mejora futura natural: v2 del formato.
 */

/** Algoritmo y tamaños fijos: AES-256 (llave de 32 B) + IV de 16 B (bloque). */
const ALGORITHM = 'aes-256-cbc';
const KEY_BYTES = 32;
const IV_BYTES = 16;

/** Versión del formato de salida (`v1:<iv_b64>:<cipher_b64>`). */
const FORMAT_VERSION = 'v1';

/** Valor con estructura desconocida o no parseable. */
const INVALID_FORMAT_ERROR =
  'Formato de valor cifrado inválido: se esperaba "v1:<iv_b64>:<cipher_b64>"';

/** Parsea, pero el IV o el texto cifrado no tienen la forma válida. */
const CORRUPT_FORMAT_ERROR = 'Formato de valor cifrado corrupto (IV o texto cifrado inválidos)';

/** Estructura correcta, pero ninguna llave descifra (clave ajena o datos alterados). */
const DECRYPT_FAILED_ERROR = 'No se pudo descifrar el valor: clave incorrecta o datos corruptos';

/**
 * Servicio (singleton) de cifrado/descifrado de PII.
 *
 * La llave vigente y la anterior se leen de la configuración YA validada por
 * zod (`CRYPTO_KEY_BASE64` garantiza 32 bytes) y se decodifican UNA sola vez
 * en el constructor: si la configuración es incorrecta, el fallo ocurre en el
 * arranque y no a mitad de una operación. Nunca se relee `process.env`.
 */
@Injectable()
export class CryptoService {
  /** Llave vigente: la que usan todas las escrituras nuevas. */
  private readonly currentKey: Buffer;

  /** Llave anterior (rotación): solo se usa para descifrar datos antiguos. */
  private readonly previousKey: Buffer | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.currentKey = CryptoService.decodeKey(
      config.getOrThrow<string>('CRYPTO_KEY_BASE64'),
      'CRYPTO_KEY_BASE64',
    );
    const previousKeyBase64 = config.get<string | undefined>('CRYPTO_KEY_PREVIOUS_BASE64');
    this.previousKey =
      previousKeyBase64 === undefined
        ? undefined
        : CryptoService.decodeKey(previousKeyBase64, 'CRYPTO_KEY_PREVIOUS_BASE64');
  }

  /**
   * Cifra un valor con la llave vigente y un IV ALEATORIO nuevo por llamada.
   * Devuelve `v1:<iv_b64>:<cipher_b64>`; la cadena vacía se devuelve tal cual
   * (las columnas PII vacías quedan vacías, ver nota del archivo).
   */
  encrypt(plain: string): string {
    if (plain === '') {
      return '';
    }

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.currentKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

    return `${FORMAT_VERSION}:${iv.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  /**
   * Descifra un valor producido por `encrypt`.
   *
   * - `''`, `null` o `undefined` → `null` (columna vacía: nada que descifrar).
   * - Intenta con la llave vigente y, si falla, con la anterior (rotación).
   * - Formato desconocido/corrupto o llaves que no descifran → LANZA Error:
   *   los datos corruptos deben ser ruidosos, nunca devolver silenciosamente
   *   texto erróneo (el PII degradado es peor que un fallo explícito).
   *
   * El padding PKCS#7 lo elimina `createDecipheriv().final()` automáticamente.
   */
  decrypt(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parts = value.split(':');
    if (parts.length !== 3) {
      throw new Error(INVALID_FORMAT_ERROR);
    }
    const [version, ivB64, cipherB64] = parts;
    if (version !== FORMAT_VERSION || !ivB64 || !cipherB64) {
      throw new Error(INVALID_FORMAT_ERROR);
    }

    const iv = Buffer.from(ivB64, 'base64');
    const ciphertext = Buffer.from(cipherB64, 'base64');
    if (iv.length !== IV_BYTES || ciphertext.length === 0 || ciphertext.length % IV_BYTES !== 0) {
      throw new Error(CORRUPT_FORMAT_ERROR);
    }

    // Rotación: primero la llave vigente y, si no descifra, la anterior.
    const keys = this.previousKey ? [this.currentKey, this.previousKey] : [this.currentKey];
    for (const key of keys) {
      try {
        return this.decipherWith(key, iv, ciphertext);
      } catch {
        // Clave incorrecta o datos corruptos: se prueba la siguiente llave.
      }
    }
    throw new Error(DECRYPT_FAILED_ERROR);
  }

  /** Decodifica y valida una llave base64 (32 bytes) con mensaje claro. */
  private static decodeKey(base64: string, name: string): Buffer {
    const key = Buffer.from(base64, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(`${name} debe decodificar a exactamente 32 bytes en base64`);
    }
    return key;
  }

  /**
   * Descifra con una llave concreta y valida que el resultado sea UTF-8
   * válido: CBC no autentica, así que una llave incorrecta podría devolver
   * «padding correcto por casualidad» + bytes basura; esos bytes casi nunca
   * son UTF-8 válido, y en ese caso ruidosamente lanzamos en vez de devolver
   * texto corrupto.
   */
  private decipherWith(key: Buffer, iv: Buffer, ciphertext: Buffer): string {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    const text = decrypted.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(decrypted)) {
      throw new Error(DECRYPT_FAILED_ERROR);
    }
    return text;
  }
}
