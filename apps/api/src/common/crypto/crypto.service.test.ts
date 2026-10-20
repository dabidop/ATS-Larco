import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../config/env.validation';
import { CryptoService } from './crypto.service';

/**
 * Tests unitarios del servicio de cifrado de PII (Fase 2, parte 3).
 *
 * El servicio inyecta `ConfigService` (config YA validada por zod); aquí se
 * sustituye por un doble mínimo que expone solo las dos llaves CRYPTO_*,
 * lo que permite simular la rotación (vigente + anterior) sin tocar process.env.
 */

/** Llave A: 32 bytes (0x07) en base64. */
const KEY_A = Buffer.alloc(32, 7).toString('base64');
/** Llave B: 32 bytes (0x09) en base64. */
const KEY_B = Buffer.alloc(32, 9).toString('base64');

/** Texto PII de prueba (acentos y dígitos). */
const PII = 'María Pérez 1234567890';

/** Crea un servicio con las llaves indicadas (doble de ConfigService). */
function createService(currentKey: string, previousKey?: string): CryptoService {
  const config = {
    getOrThrow: (key: string): string => {
      if (key === 'CRYPTO_KEY_BASE64') {
        return currentKey;
      }
      throw new Error(`doble de config: clave inesperada ${key}`);
    },
    get: (key: string): string | undefined =>
      key === 'CRYPTO_KEY_PREVIOUS_BASE64' ? previousKey : undefined,
  };
  return new CryptoService(config as unknown as ConfigService<Env, true>);
}

describe('CryptoService', () => {
  it('roundtrip: descifra exactamente lo que cifra (PII con acentos y dígitos)', () => {
    const service = createService(KEY_A);

    expect(service.decrypt(service.encrypt(PII))).toBe(PII);
  });

  it('roundtrip conserva caracteres UTF-8 no ASCII (eñes y emoji)', () => {
    const service = createService(KEY_A);
    const texto = 'Ñandú 👨‍💻 «comillas»';

    expect(service.decrypt(service.encrypt(texto))).toBe(texto);
  });

  it('IV único: dos cifrados consecutivos del mismo texto son distintos', () => {
    const service = createService(KEY_A);
    const primero = service.encrypt('mismo texto');
    const segundo = service.encrypt('mismo texto');

    expect(primero).not.toBe(segundo);

    // Y la diferencia está en el IV aleatorio por registro (16 bytes distintos).
    const ivPrimero = Buffer.from(primero.split(':')[1] ?? '', 'base64');
    const ivSegundo = Buffer.from(segundo.split(':')[1] ?? '', 'base64');
    expect(ivPrimero).toHaveLength(16);
    expect(ivSegundo).toHaveLength(16);
    expect(ivPrimero.equals(ivSegundo)).toBe(false);
  });

  it('formato versionado: "v1:<iv_b64>:<cipher_b64>" con IV de 16 bytes', () => {
    const service = createService(KEY_A);
    const value = service.encrypt(PII);

    expect(value.startsWith('v1:')).toBe(true);
    expect(value).not.toContain('María'); // el texto claro no aparece en la salida

    const parts = value.split(':');
    expect(parts).toHaveLength(3);

    const [version, ivB64, cipherB64] = parts;
    expect(version).toBe('v1');
    expect(Buffer.from(ivB64 ?? '', 'base64')).toHaveLength(16);

    // El texto cifrado es múltiplo del bloque AES (16 B) y no está vacío.
    const ciphertext = Buffer.from(cipherB64 ?? '', 'base64');
    expect(ciphertext.length).toBeGreaterThan(0);
    expect(ciphertext.length % 16).toBe(0);
  });

  it('vacío: encrypt("") devuelve "" sin cifrar y decrypt("")/null/undefined → null', () => {
    const service = createService(KEY_A);

    expect(service.encrypt('')).toBe('');
    expect(service.decrypt('')).toBeNull();
    expect(service.decrypt(null)).toBeNull();
    expect(service.decrypt(undefined)).toBeNull();
  });

  it('rotación: descifra datos de la llave anterior con B vigente y A previous', () => {
    const cifradoConA = createService(KEY_A).encrypt(PII);

    // Rotación planificada: A pasa a previous y B queda vigente.
    const rotado = createService(KEY_B, KEY_A);
    expect(rotado.decrypt(cifradoConA)).toBe(PII);

    // Los datos nuevos se cifran con la vigente (B) y también se descifran.
    const nuevo = rotado.encrypt('dato nuevo');
    expect(rotado.decrypt(nuevo)).toBe('dato nuevo');
  });

  it('previous vacía (fallback de process.env en Docker/compose) se trata como ausente', () => {
    // Regresión: una variable opcional sin definir llega como '' desde el
    // compose y ConfigService cae a process.env; el servicio NO debe tratarla
    // como llave (bug de arranque del contenedor detectado por smoke test).
    const soloVigente = createService(KEY_A, '');
    expect(soloVigente.decrypt(soloVigente.encrypt(PII))).toBe(PII);

    const conEspacios = createService(KEY_A, '   ');
    expect(conEspacios.decrypt(conEspacios.encrypt(PII))).toBe(PII);

    // Y una llave previous real sigue funcionando (rotación intacta).
    const cifradoConA = createService(KEY_A).encrypt(PII);
    expect(createService(KEY_B, KEY_A).decrypt(cifradoConA)).toBe(PII);
  });

  it.each(['basura', 'v1:xx:yy', 'v2:a:b'])(
    'corrupto: decrypt(%s) lanza Error con mensaje claro',
    (value) => {
      const service = createService(KEY_A);

      expect(() => service.decrypt(value)).toThrow(Error);
      expect(() => service.decrypt(value)).toThrow(/Formato de valor cifrado/);
    },
  );

  it('wrong key: con solo la llave B no se descifran datos cifrados con A', () => {
    const cifradoConA = createService(KEY_A).encrypt(PII);
    const soloB = createService(KEY_B);

    expect(() => soloB.decrypt(cifradoConA)).toThrow(
      'No se pudo descifrar el valor: clave incorrecta o datos corruptos',
    );
  });

  it('llave mal configurada (no 32 bytes) falla en el constructor con mensaje claro', () => {
    expect(() => createService('cortita')).toThrow(
      'CRYPTO_KEY_BASE64 debe decodificar a exactamente 32 bytes en base64',
    );
    expect(() => createService(KEY_A, 'también-corta')).toThrow(
      'CRYPTO_KEY_PREVIOUS_BASE64 debe decodificar a exactamente 32 bytes en base64',
    );
  });
});
