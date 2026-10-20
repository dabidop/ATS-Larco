import { describe, expect, it } from 'vitest';

import {
  calcularCambiosHistorial,
  mapearEntradaHistorial,
  type FilaAuditoriaCruda,
} from './candidatos.service';

/**
 * Tests unitarios del mapper del HISTORIAL de auditoría (Fase 4, parte 3).
 * Herméticos: las funciones son PURAS (`calcularCambiosHistorial` y
 * `mapearEntradaHistorial`) —ni DataSource, ni BD, ni `process.env`—, así que
 * se prueban con snapshots jsonb simuladas, con la misma forma que entrega
 * `pg` para `old_data`/`new_data`.
 *
 * Tres invariantes sostienen aquí:
 *  - El diff solo lista los campos que CAMBIARON (los intactos no aparecen).
 *  - La PII cifrada (`cedula_cifrada`/`telefono_cifrada`) sale como `'***'`:
 *    el historial jamás descifra ni expone el cifrado `v1:...`.
 *  - `cedula_hash` y cualquier columna no pública se OMITEN del todo.
 */

const UUID_CANDIDATO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const UUID_USUARIO = 'ffffffff-0000-1111-2222-333333333333';

/** Cifrado simulado (formato `v1:<iv>:<cipher>`; el contenido es irrelevante). */
const CIFRADO_CEDULA = 'v1:aXZCYW5zZQ==:Y2lmaXJhZG9jZW50ZQ==';
const CIFRADO_TELEFONO = 'v1:bXZCYW5zZQ==:dGVsZWZvbm9jaWZyaWRh';
const HASH_CEDULA = 'a1b2c3d4e5f6'.repeat(6).slice(0, 64);

/** Snapshot COMPLETA de `new_data` (como `to_jsonb(NEW)` en el trigger). */
const NUEVOS_DATOS: Record<string, unknown> = {
  id: UUID_CANDIDATO,
  nombres: 'Zoraida',
  apellidos: 'Prueba',
  email: 'zoraida@mail.test',
  cedula_cifrada: CIFRADO_CEDULA,
  telefono_cifrada: CIFRADO_TELEFONO,
  cedula_hash: HASH_CEDULA,
  ciudad: 'Bogota',
  cargo_actual: 'Ingeniera de Datos',
  expectativa_salarial: 4_500_000,
  disponibilidad: null,
  notas: null,
  created_by: UUID_USUARIO,
  created_at: '2026-10-20T12:00:00.123+00:00',
  updated_at: '2026-10-20T12:00:00.123+00:00',
};

/** Fila cruda de `audit_log` con valores por defecto editables por test. */
function fila(overrides: Partial<FilaAuditoriaCruda> = {}): FilaAuditoriaCruda {
  return {
    id: '42',
    action: 'INSERT',
    old_data: null,
    new_data: NUEVOS_DATOS,
    changed_by: UUID_USUARIO,
    usuario_email: 'creador@larco.test',
    created_at: new Date('2026-10-20T12:00:00.123Z'),
    ...overrides,
  };
}

describe('mapearEntradaHistorial — entrada (id, accion, fecha, usuario)', () => {
  it('mapea los metadatos: id crudo, accion, fecha ISO 8601 y usuario + email', () => {
    const entrada = mapearEntradaHistorial(fila());

    expect(entrada.id).toBe('42');
    expect(entrada.accion).toBe('INSERT');
    expect(entrada.fecha).toBe('2026-10-20T12:00:00.123Z');
    expect(entrada.usuario).toBe(UUID_USUARIO);
    expect(entrada.usuarioEmail).toBe('creador@larco.test');
  });

  it('una fecha que llegue como texto también se normaliza a ISO 8601', () => {
    const entrada = mapearEntradaHistorial(fila({ created_at: '2026-10-20 14:00:00.5+00' }));

    expect(entrada.fecha).toBe(new Date('2026-10-20T14:00:00.500Z').toISOString());
  });

  it('un actor sin resolver (changed_by/email NULL) queda en null, no se inventa', () => {
    const entrada = mapearEntradaHistorial(fila({ changed_by: null, usuario_email: null }));

    expect(entrada.usuario).toBeNull();
    expect(entrada.usuarioEmail).toBeNull();
  });
});

describe('mapearEntradaHistorial — INSERT (alta)', () => {
  it('lista los campos dados de alta con antes: null y omite los vacíos', () => {
    const entrada = mapearEntradaHistorial(fila());

    expect(entrada.campos).toEqual([
      { campo: 'nombres', antes: null, despues: 'Zoraida' },
      { campo: 'apellidos', antes: null, despues: 'Prueba' },
      { campo: 'email', antes: null, despues: 'zoraida@mail.test' },
      { campo: 'cedula', antes: null, despues: '***' },
      { campo: 'telefono', antes: null, despues: '***' },
      { campo: 'ciudad', antes: null, despues: 'Bogota' },
      { campo: 'cargoActual', antes: null, despues: 'Ingeniera de Datos' },
      { campo: 'expectativaSalarial', antes: null, despues: 4_500_000 },
    ]);
  });

  it('NUNCA expone el cifrado, el hash ni los campos internos del sistema', () => {
    const entrada = mapearEntradaHistorial(fila());
    const texto = JSON.stringify(entrada);

    // Ni la PII cifrada…
    expect(texto).not.toContain('v1:');
    expect(texto).not.toContain(CIFRADO_CEDULA);
    expect(texto).not.toContain(CIFRADO_TELEFONO);
    // …ni el hash de búsqueda, ni columnas de control del sistema.
    expect(texto).not.toContain(HASH_CEDULA);
    expect(entrada.campos.map((c) => c.campo)).not.toContain('cedulaHash');
    expect(entrada.campos.map((c) => c.campo)).not.toContain('cedula_hash');
    expect(entrada.campos.map((c) => c.campo)).not.toEqual(
      expect.arrayContaining(['id', 'createdBy', 'createdAt', 'updatedAt']),
    );
  });
});

describe('calcularCambiosHistorial — UPDATE (diff)', () => {
  it('solo lista los campos que CAMBIARON; los intactos no aparecen', () => {
    const despues = { ...NUEVOS_DATOS, ciudad: 'Medellin' };

    const cambios = calcularCambiosHistorial(NUEVOS_DATOS, despues);

    expect(cambios).toEqual([{ campo: 'ciudad', antes: 'Bogota', despues: 'Medellin' }]);
  });

  it('cambios simultáneos: cada campo con su antes/despues, en orden del whitelist', () => {
    const despues = {
      ...NUEVOS_DATOS,
      ciudad: 'Medellin',
      expectativa_salarial: 5_000_000,
      notas: 'Referido por Ana',
    };

    const cambios = calcularCambiosHistorial(NUEVOS_DATOS, despues);

    expect(cambios).toEqual([
      { campo: 'ciudad', antes: 'Bogota', despues: 'Medellin' },
      { campo: 'expectativaSalarial', antes: 4_500_000, despues: 5_000_000 },
      { campo: 'notas', antes: null, despues: 'Referido por Ana' },
    ]);
  });

  it('la PII re-cifrada se COMPARA pero sale MASCARADA en ambos lados', () => {
    // Reenviar la MISMA cédula/teléfono genera un cifrado nuevo (IV aleatorio):
    // el diff detecta el cambio de bytes, pero jamás publica ni claro ni cifrado.
    const despues = {
      ...NUEVOS_DATOS,
      cedula_cifrada: 'v1:elOtroIV:cifradoDistinto',
      telefono_cifrada: 'v1:masIv:otroCifrado',
    };

    const cambios = calcularCambiosHistorial(NUEVOS_DATOS, despues);
    const texto = JSON.stringify(cambios);

    expect(cambios).toEqual([
      { campo: 'cedula', antes: '***', despues: '***' },
      { campo: 'telefono', antes: '***', despues: '***' },
    ]);
    expect(texto).not.toContain('v1:');
  });

  it('una PII que se VACÍA muestra el cambio sin filtrar dato: null → valor', () => {
    const despues = { ...NUEVOS_DATOS, telefono_cifrada: null };

    const cambios = calcularCambiosHistorial(NUEVOS_DATOS, despues);

    expect(cambios).toEqual([{ campo: 'telefono', antes: '***', despues: null }]);
  });

  it('una columna NO pública (cedula_hash) o desconocida jamás aparece', () => {
    const despues = {
      ...NUEVOS_DATOS,
      cedula_hash: 'f'.repeat(64),
      columna_futura_pii: 'secreto',
    };

    const cambios = calcularCambiosHistorial(NUEVOS_DATOS, despues);

    expect(cambios).toEqual([]);
    expect(JSON.stringify(cambios)).not.toContain('secreto');
    expect(JSON.stringify(cambios)).not.toContain('f'.repeat(64));
  });

  it('un UPDATE sin cambios de fondo (p. ej. solo updated_at) → lista vacía', () => {
    const despues = { ...NUEVOS_DATOS, updated_at: '2026-10-20T13:00:00.000+00:00' };

    expect(calcularCambiosHistorial(NUEVOS_DATOS, despues)).toEqual([]);
  });
});

describe('mapearEntradaHistorial — UPDATE y DELETE completos', () => {
  it('una fila UPDATE mapea con accion UPDATE y el diff calculado', () => {
    const despues = { ...NUEVOS_DATOS, ciudad: 'Medellin' };
    const entrada = mapearEntradaHistorial(
      fila({ action: 'UPDATE', old_data: NUEVOS_DATOS, new_data: despues }),
    );

    expect(entrada.accion).toBe('UPDATE');
    expect(entrada.campos).toEqual([{ campo: 'ciudad', antes: 'Bogota', despues: 'Medellin' }]);
  });

  it('una acción desconocida (imposible: el CHECK la acota) degrada a UPDATE', () => {
    const entrada = mapearEntradaHistorial(
      fila({ action: 'UPSERT', old_data: NUEVOS_DATOS, new_data: NUEVOS_DATOS }),
    );

    expect(entrada.accion).toBe('UPDATE');
    expect(entrada.campos).toEqual([]);
  });

  it('una fila DELETE (inalcanzable hoy en candidatos) lista antes con despues: null', () => {
    const entrada = mapearEntradaHistorial(
      fila({ action: 'DELETE', old_data: NUEVOS_DATOS, new_data: null }),
    );

    expect(entrada.accion).toBe('DELETE');
    expect(entrada.campos).toEqual([
      { campo: 'nombres', antes: 'Zoraida', despues: null },
      { campo: 'apellidos', antes: 'Prueba', despues: null },
      { campo: 'email', antes: 'zoraida@mail.test', despues: null },
      { campo: 'cedula', antes: '***', despues: null },
      { campo: 'telefono', antes: '***', despues: null },
      { campo: 'ciudad', antes: 'Bogota', despues: null },
      { campo: 'cargoActual', antes: 'Ingeniera de Datos', despues: null },
      { campo: 'expectativaSalarial', antes: 4_500_000, despues: null },
    ]);
  });
});
