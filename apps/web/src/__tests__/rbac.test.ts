import { describe, expect, it } from 'vitest';

import {
  etiquetaRol,
  esRolDeLaMatriz,
  puedeConsultarCandidatos,
  puedeConsultarRequerimientos,
  puedeEditarCandidato,
  puedeEditarRequerimiento,
  puedeGestionarCandidatos,
  puedeGestionarRequerimientos,
  puedeTransicionarRequerimientos,
  puedeVerSeccionCandidatos,
  puedeVerSeccionRequerimientos,
} from '../lib/rbac';

describe('rbac — matriz real de la API', () => {
  it('reconoce solo los tres roles de la matriz', () => {
    expect(esRolDeLaMatriz('admin_rrhh')).toBe(true);
    expect(esRolDeLaMatriz('analista_seleccion')).toBe(true);
    expect(esRolDeLaMatriz('lider_area')).toBe(true);
    expect(esRolDeLaMatriz('becario')).toBe(false);
    expect(esRolDeLaMatriz(null)).toBe(false);
    expect(esRolDeLaMatriz(undefined)).toBe(false);
  });

  it('consultar es de cualquier rol autenticado', () => {
    for (const rol of ['admin_rrhh', 'analista_seleccion', 'lider_area']) {
      expect(puedeConsultarRequerimientos(rol)).toBe(true);
      expect(puedeConsultarCandidatos(rol)).toBe(true);
    }
    expect(puedeConsultarRequerimientos('becario')).toBe(false);
    expect(puedeConsultarCandidatos(null)).toBe(false);
  });

  it('crear requerimientos: admin_rrhh y lider_area (POST /requerimientos)', () => {
    expect(puedeGestionarRequerimientos('admin_rrhh')).toBe(true);
    expect(puedeGestionarRequerimientos('lider_area')).toBe(true);
    expect(puedeGestionarRequerimientos('analista_seleccion')).toBe(false);
    expect(puedeGestionarRequerimientos(null)).toBe(false);
  });

  it('transicionar: los 3 roles llegan a la puerta @Roles del controlador', () => {
    expect(puedeTransicionarRequerimientos('admin_rrhh')).toBe(true);
    expect(puedeTransicionarRequerimientos('analista_seleccion')).toBe(true);
    expect(puedeTransicionarRequerimientos('lider_area')).toBe(true);
    expect(puedeTransicionarRequerimientos('becario')).toBe(false);
  });

  it('editar requerimiento: creador o admin_rrhh', () => {
    expect(puedeEditarRequerimiento('admin_rrhh', false)).toBe(true);
    expect(puedeEditarRequerimiento('lider_area', true)).toBe(true);
    expect(puedeEditarRequerimiento('lider_area', false)).toBe(false);
    expect(puedeEditarRequerimiento('analista_seleccion', true)).toBe(true);
    expect(puedeEditarRequerimiento(null, false)).toBe(false);
  });

  it('gestionar candidatos y subir CVs: analista_seleccion y admin_rrhh', () => {
    expect(puedeGestionarCandidatos('analista_seleccion')).toBe(true);
    expect(puedeGestionarCandidatos('admin_rrhh')).toBe(true);
    expect(puedeGestionarCandidatos('lider_area')).toBe(false);
    expect(puedeGestionarCandidatos(null)).toBe(false);
  });

  it('editar candidato: creador o admin_rrhh', () => {
    expect(puedeEditarCandidato('admin_rrhh', false)).toBe(true);
    expect(puedeEditarCandidato('analista_seleccion', true)).toBe(true);
    expect(puedeEditarCandidato('analista_seleccion', false)).toBe(false);
    // Inalcanzable en la práctica (lider_area no crea candidatos), pero
    // replica la regla del servidor: el CREADOR siempre puede editar.
    expect(puedeEditarCandidato('lider_area', true)).toBe(true);
    expect(puedeEditarCandidato('lider_area', false)).toBe(false);
  });

  it('la navegación oculta secciones a un rol fuera de la matriz (sin inventar permisos)', () => {
    expect(puedeVerSeccionRequerimientos('admin_rrhh')).toBe(true);
    expect(puedeVerSeccionCandidatos('analista_seleccion')).toBe(true);
    expect(puedeVerSeccionRequerimientos('becario')).toBe(false);
    expect(puedeVerSeccionCandidatos('becario')).toBe(false);
  });

  it('muestra una etiqueta legible por rol (y el código si es desconocido)', () => {
    expect(etiquetaRol('admin_rrhh')).toBe('Administración RRHH');
    expect(etiquetaRol('analista_seleccion')).toBe('Analista de Selección');
    expect(etiquetaRol('lider_area')).toBe('Líder de Área');
    expect(etiquetaRol('becario')).toBe('becario');
    expect(etiquetaRol(null)).toBe('');
  });
});
