import { describe, expect, it } from 'vitest';

import type { PostulacionRow } from './dto/postulacion.response';
import {
  calcularCambiosHistorial,
  mapearEntradaHistorial,
  toResponse,
  type DatosAuditoria,
  type FilaAuditoriaPostulacion,
} from './postulaciones.mapper';

/**
 * Tests unitarios HERMÉTICOS del mapper de postulaciones (Fase 5): filas de
 * `pg`/`audit_log` en crudo → respuestas públicas de la API. Cero BD: lo que
 * se verifica aquí es el puente snake_case ↔ camelCase y el FILTRO del
 * historial (qué columnas de los jsonb se exponen y cuáles se descartan).
 */

const UNA_HORA_MS = 3_600_000;
const FECHA = new Date('2026-10-21T12:00:00.000Z');
const FECHA_POSTERIOR = new Date(FECHA.getTime() + UNA_HORA_MS);

/** Fila `postulaciones` de LECTURA (con resumen del candidato), como la da `pg`. */
function filaBase(): PostulacionRow {
  return {
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    candidato_id: 'bbbbbbbb-2222-4222-8222-222222222222',
    requerimiento_id: 'cccccccc-3333-4333-8333-333333333333',
    fase: 'antecedentes',
    estado: 'activa',
    motivo_descarte: null,
    created_by: 'dddddddd-4444-4444-8444-444444444444',
    created_at: FECHA,
    updated_at: FECHA_POSTERIOR,
    nombres_candidato: 'Ana María',
    apellidos_candidato: 'Pérez López',
  };
}

/** Entrada `audit_log` completa, como la entrega el SQL del servicio. */
function entradaBase(nuevos: DatosAuditoria, antiguos: DatosAuditoria): FilaAuditoriaPostulacion {
  return {
    id: '12345',
    action: 'UPDATE',
    old_data: antiguos,
    new_data: nuevos,
    changed_by: 'dddddddd-4444-4444-8444-444444444444',
    usuario_email: 'analista@larco.test',
    created_at: FECHA_POSTERIOR,
  };
}

describe('toResponse — fila BD → DTO público (camelCase)', () => {
  it('traduce snake_case a camelCase y las fechas a ISO 8601', () => {
    expect(toResponse(filaBase())).toEqual({
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      candidatoId: 'bbbbbbbb-2222-4222-8222-222222222222',
      candidato: {
        id: 'bbbbbbbb-2222-4222-8222-222222222222',
        nombres: 'Ana María',
        apellidos: 'Pérez López',
      },
      requerimientoId: 'cccccccc-3333-4333-8333-333333333333',
      fase: 'antecedentes',
      estado: 'activa',
      motivoDescarte: null,
      createdBy: 'dddddddd-4444-4444-8444-444444444444',
      createdAt: '2026-10-21T12:00:00.000Z',
      updatedAt: '2026-10-21T13:00:00.000Z',
    });
  });

  it('el resumen del candidato repite el candidatoId y SOLO expone nombre y apellidos', () => {
    const respuesta = toResponse(filaBase());
    // El `id` del resumen es el MISMO enlace que ya viaja en `candidatoId`
    // (el tablero usa uno u otro para poblar la tarjeta).
    expect(respuesta.candidato.id).toBe(respuesta.candidatoId);
    // Ni una clave de más: sin cédula, email, teléfono u otras PII que el
    // JOIN a `candidatos` podría traer en el futuro.
    expect(Object.keys(respuesta.candidato).sort()).toEqual(['apellidos', 'id', 'nombres']);
  });

  it('no se cuela NINGUNA clave interna en la respuesta', () => {
    const claves = Object.keys(toResponse(filaBase())).sort();
    expect(claves).toEqual([
      'candidato',
      'candidatoId',
      'createdAt',
      'createdBy',
      'estado',
      'fase',
      'id',
      'motivoDescarte',
      'requerimientoId',
      'updatedAt',
    ]);
  });

  it('conserva el motivo de descarte cuando la fila está descartada', () => {
    const fila = { ...filaBase(), estado: 'descartado', motivo_descarte: 'No cubre el perfil' };
    expect(toResponse(fila)).toMatchObject({
      estado: 'descartado',
      motivoDescarte: 'No cubre el perfil',
    });
  });
});

describe('calcularCambiosHistorial — solo los 3 campos de negocio', () => {
  it('lista SOLO fase/estado/motivo_descarte aunque los jsonb traigan las columnas internas', () => {
    const antes: DatosAuditoria = {
      id: 'aaaa',
      candidato_id: 'bbbb',
      requerimiento_id: 'cccc',
      fase: 'preseleccion',
      estado: 'activa',
      motivo_descarte: null,
      created_by: 'dddd',
      created_at: '2026-10-21T12:00:00Z',
      updated_at: '2026-10-21T12:00:00Z',
    };
    const despues: DatosAuditoria = { ...antes, fase: 'antecedentes' };

    // El CAMBIO de fase se lista; el resto de columnas del jsonb se ignora.
    expect(calcularCambiosHistorial(antes, despues)).toEqual([
      { campo: 'fase', antes: 'preseleccion', despues: 'antecedentes' },
    ]);
  });

  it('un descarte lista estado y motivo juntos, en el orden del whitelist', () => {
    const antes: DatosAuditoria = { fase: 'entrevistas', estado: 'activa', motivo_descarte: null };
    const despues: DatosAuditoria = {
      fase: 'entrevistas',
      estado: 'descartado',
      motivo_descarte: 'Renunció a otro proceso',
    };

    expect(calcularCambiosHistorial(antes, despues)).toEqual([
      { campo: 'estado', antes: 'activa', despues: 'descartado' },
      { campo: 'motivoDescarte', antes: null, despues: 'Renunció a otro proceso' },
    ]);
  });

  it('los valores SIN cambios no aparecen', () => {
    const datos: DatosAuditoria = {
      fase: 'antecedentes',
      estado: 'activa',
      motivo_descarte: null,
    };
    expect(calcularCambiosHistorial(datos, { ...datos })).toEqual([]);
  });

  it('un jsonb ausente (null) se trata como "sin campos" (nunca revienta)', () => {
    expect(calcularCambiosHistorial(null, null)).toEqual([]);
  });
});

describe('mapearEntradaHistorial — acción, actor, fecha y campos', () => {
  it('un UPDATE expone el diff de los 3 campos, el uuid del actor y su email', () => {
    const entrada = mapearEntradaHistorial(
      entradaBase(
        { fase: 'antecedentes', estado: 'activa', motivo_descarte: null },
        { fase: 'preseleccion', estado: 'activa', motivo_descarte: null },
      ),
    );

    expect(entrada).toEqual({
      id: '12345',
      accion: 'UPDATE',
      fecha: '2026-10-21T13:00:00.000Z',
      usuario: 'dddddddd-4444-4444-8444-444444444444',
      usuarioEmail: 'analista@larco.test',
      campos: [{ campo: 'fase', antes: 'preseleccion', despues: 'antecedentes' }],
    });
  });

  it('un INSERT informa el alta con `antes: null` y OMITE el motivo vacío', () => {
    const entrada = mapearEntradaHistorial({
      ...entradaBase(
        {
          id: 'aaaa',
          candidato_id: 'bbbb',
          requerimiento_id: 'cccc',
          fase: 'preseleccion',
          estado: 'activa',
          motivo_descarte: null,
          created_by: 'dddd',
          created_at: 'x',
          updated_at: 'x',
        },
        null,
      ),
      action: 'INSERT',
    });

    expect(entrada.accion).toBe('INSERT');
    expect(entrada.campos).toEqual([
      { campo: 'fase', antes: null, despues: 'preseleccion' },
      { campo: 'estado', antes: null, despues: 'activa' },
    ]);
  });

  it('un DELETE (inalcanzable hoy) pondría `despues: null` en los campos poblados', () => {
    // En un borrado el trigger guarda la fila en `old_data` (NEW es NULL): los
    // argumentos de `entradaBase` son (new_data, old_data).
    const entrada = mapearEntradaHistorial({
      ...entradaBase(null, {
        fase: 'entrevistas',
        estado: 'descartado',
        motivo_descarte: 'Sin presupuesto',
      }),
      action: 'DELETE',
    });

    expect(entrada.accion).toBe('DELETE');
    expect(entrada.campos).toEqual([
      { campo: 'fase', antes: 'entrevistas', despues: null },
      { campo: 'estado', antes: 'descartado', despues: null },
      { campo: 'motivoDescarte', antes: 'Sin presupuesto', despues: null },
    ]);
  });

  it('una acción inesperada degrada a UPDATE sin perder la entrada', () => {
    const entrada = mapearEntradaHistorial({
      ...entradaBase(
        { fase: 'entrevistas', estado: 'activa', motivo_descarte: null },
        { fase: 'antecedentes', estado: 'activa', motivo_descarte: null },
      ),
      action: 'TRUNCATE',
    });
    expect(entrada.accion).toBe('UPDATE');
    expect(entrada.campos).toEqual([
      { campo: 'fase', antes: 'antecedentes', despues: 'entrevistas' },
    ]);
  });

  it('normaliza la fecha a ISO 8601 aunque `pg` la entregue como texto', () => {
    const entrada = mapearEntradaHistorial({
      ...entradaBase(null, null),
      created_at: '2026-10-21 08:00:00-05',
    });
    expect(entrada.fecha).toBe('2026-10-21T13:00:00.000Z');
    expect(new Date(entrada.fecha).toISOString()).toBe(entrada.fecha);
  });

  it('sin actor (changed_by NULL) devuelve `usuario`/`usuarioEmail` en null', () => {
    const entrada = mapearEntradaHistorial({
      ...entradaBase(null, null),
      changed_by: null,
      usuario_email: null,
    });
    expect(entrada.usuario).toBeNull();
    expect(entrada.usuarioEmail).toBeNull();
  });
});
