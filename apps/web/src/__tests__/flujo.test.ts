import { describe, expect, it } from 'vitest';

import {
  PERMISOS_TRANSICION,
  TRANSICIONES_VALIDAS,
  esTransicionValida,
  requiereMotivo,
  transicionesPermitidas,
} from '../lib/flujo';
import type { EstadoRequerimiento } from '../tipos';

/**
 * Tests del espejo cliente de `requerimientos-flujo.ts` (la API no expone un
 * endpoint de transiciones disponibles).
 */
describe('flujo de requerimientos — matriz de transiciones (espejo del backend)', () => {
  it('declara las transiciones estructuralmente válidas de cada estado', () => {
    expect(TRANSICIONES_VALIDAS.pendiente).toEqual(['aprobado', 'rechazado']);
    expect(TRANSICIONES_VALIDAS.aprobado).toEqual(['en_proceso']);
    expect(TRANSICIONES_VALIDAS.en_proceso).toEqual(['cerrado']);
    expect(TRANSICIONES_VALIDAS.cerrado).toEqual([]);
    expect(TRANSICIONES_VALIDAS.rechazado).toEqual([]);
  });

  it('solo declara permisos para las 4 transiciones válidas', () => {
    expect(Object.keys(PERMISOS_TRANSICION).sort()).toEqual([
      'aprobado>en_proceso',
      'en_proceso>cerrado',
      'pendiente>aprobado',
      'pendiente>rechazado',
    ]);
  });

  it('rechazar exige motivo; el resto de destinos no', () => {
    expect(requiereMotivo('rechazado')).toBe(true);
    expect(requiereMotivo('aprobado')).toBe(false);
    expect(requiereMotivo('en_proceso')).toBe(false);
    expect(requiereMotivo('cerrado')).toBe(false);
  });

  it('rechaza transiciones estructuralmente imposibles', () => {
    expect(esTransicionValida('pendiente', 'cerrado')).toBe(false);
    expect(esTransicionValida('cerrado', 'aprobado')).toBe(false);
    expect(esTransicionValida('aprobado', 'en_proceso')).toBe(true);
  });

  it('admin_rrhh puede transitar todo el flujo', () => {
    expect(transicionesPermitidas('pendiente', 'admin_rrhh', false)).toEqual([
      'aprobado',
      'rechazado',
    ]);
    expect(transicionesPermitidas('aprobado', 'admin_rrhh', false)).toEqual(['en_proceso']);
    expect(transicionesPermitidas('en_proceso', 'admin_rrhh', false)).toEqual(['cerrado']);
    expect(transicionesPermitidas('cerrado', 'admin_rrhh', true)).toEqual([]);
  });

  it('analista_seleccion solo inicia el proceso desde aprobado', () => {
    expect(transicionesPermitidas('pendiente', 'analista_seleccion', true)).toEqual([]);
    expect(transicionesPermitidas('aprobado', 'analista_seleccion', false)).toEqual(['en_proceso']);
    expect(transicionesPermitidas('en_proceso', 'analista_seleccion', false)).toEqual([]);
  });

  it('lider_area solo retira SU propia solicitud (regla del creador)', () => {
    expect(transicionesPermitidas('pendiente', 'lider_area', true)).toEqual(['rechazado']);
    expect(transicionesPermitidas('pendiente', 'lider_area', false)).toEqual([]);
    expect(transicionesPermitidas('aprobado', 'lider_area', false)).toEqual([]);
  });

  it('sin rol o con rol desconocido no hay transiciones disponibles', () => {
    expect(transicionesPermitidas('pendiente', 'becario', true)).toEqual([]);
    expect(transicionesPermitidas('pendiente', null, true)).toEqual([]);
    expect(transicionesPermitidas('pendiente', undefined, false)).toEqual([]);
  });

  // ──────────────────────── Etapa 8B: superusuario (IT) ────────────────────────

  it('la matriz declara admin_rrhh Y superusuario en las 4 transiciones (espejo exacto)', () => {
    expect(PERMISOS_TRANSICION['pendiente>aprobado']).toEqual(['admin_rrhh', 'superusuario']);
    expect(PERMISOS_TRANSICION['pendiente>rechazado']).toEqual([
      'admin_rrhh',
      'superusuario',
      'lider_area',
    ]);
    expect(PERMISOS_TRANSICION['aprobado>en_proceso']).toEqual([
      'admin_rrhh',
      'superusuario',
      'analista_seleccion',
    ]);
    expect(PERMISOS_TRANSICION['en_proceso>cerrado']).toEqual(['admin_rrhh', 'superusuario']);
  });

  it('superusuario ve EXACTAMENTE los mismos botones que admin_rrhh en todo el flujo', () => {
    expect(transicionesPermitidas('pendiente', 'superusuario', false)).toEqual([
      'aprobado',
      'rechazado',
    ]);
    expect(transicionesPermitidas('aprobado', 'superusuario', false)).toEqual(['en_proceso']);
    expect(transicionesPermitidas('en_proceso', 'superusuario', false)).toEqual(['cerrado']);
    expect(transicionesPermitidas('cerrado', 'superusuario', true)).toEqual([]);
    // Igual que admin_rrhh, NO está sujeto a la regla del creador.
    expect(transicionesPermitidas('pendiente', 'superusuario', false)).toEqual(
      transicionesPermitidas('pendiente', 'admin_rrhh', false),
    );

    for (const estado of Object.keys(TRANSICIONES_VALIDAS) as EstadoRequerimiento[]) {
      for (const esCreador of [true, false]) {
        expect(transicionesPermitidas(estado, 'superusuario', esCreador)).toEqual(
          transicionesPermitidas(estado, 'admin_rrhh', esCreador),
        );
      }
    }
  });

  it('el superusuario no altera los permisos de los demás roles', () => {
    expect(transicionesPermitidas('pendiente', 'analista_seleccion', true)).toEqual([]);
    expect(transicionesPermitidas('pendiente', 'lider_area', false)).toEqual([]);
    expect(transicionesPermitidas('pendiente', 'lider_area', true)).toEqual(['rechazado']);
    expect(transicionesPermitidas('en_proceso', 'analista_seleccion', false)).toEqual([]);
  });
});
