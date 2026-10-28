import { describe, expect, it } from 'vitest';

import {
  ROLES_MATRIZ,
  etiquetaRol,
  esRolDeLaMatriz,
  puedeAgregarPostulaciones,
  puedeConsultarCandidatos,
  puedeConsultarRequerimientos,
  puedeEditarCandidato,
  puedeEditarRequerimiento,
  puedeGestionarCandidatos,
  puedeGestionarRequerimientos,
  puedeGestionarUsuarios,
  puedeMoverPostulaciones,
  puedeTransicionarRequerimientos,
  puedeVerSeccionCandidatos,
  puedeVerSeccionRequerimientos,
  puedeVerSeccionUsuarios,
} from '../lib/rbac';

describe('rbac — matriz real de la API', () => {
  it('reconoce los cuatro roles de la matriz (Etapa 8B)', () => {
    expect(esRolDeLaMatriz('admin_rrhh')).toBe(true);
    expect(esRolDeLaMatriz('analista_seleccion')).toBe(true);
    expect(esRolDeLaMatriz('lider_area')).toBe(true);
    expect(esRolDeLaMatriz('superusuario')).toBe(true);
    expect(esRolDeLaMatriz('becario')).toBe(false);
    expect(esRolDeLaMatriz(null)).toBe(false);
    expect(esRolDeLaMatriz(undefined)).toBe(false);
    expect(ROLES_MATRIZ).toEqual([
      'admin_rrhh',
      'analista_seleccion',
      'lider_area',
      'superusuario',
    ]);
  });

  it('consultar es de cualquier rol autenticado', () => {
    for (const rol of ['admin_rrhh', 'analista_seleccion', 'lider_area', 'superusuario']) {
      expect(puedeConsultarRequerimientos(rol)).toBe(true);
      expect(puedeConsultarCandidatos(rol)).toBe(true);
    }
    expect(puedeConsultarRequerimientos('becario')).toBe(false);
    expect(puedeConsultarCandidatos(null)).toBe(false);
  });

  it('crear requerimientos: admin_rrhh, superusuario y lider_area (POST /requerimientos)', () => {
    expect(puedeGestionarRequerimientos('admin_rrhh')).toBe(true);
    expect(puedeGestionarRequerimientos('superusuario')).toBe(true);
    expect(puedeGestionarRequerimientos('lider_area')).toBe(true);
    expect(puedeGestionarRequerimientos('analista_seleccion')).toBe(false);
    expect(puedeGestionarRequerimientos(null)).toBe(false);
  });

  it('transicionar: los 4 roles llegan a la puerta @Roles del controlador', () => {
    expect(puedeTransicionarRequerimientos('admin_rrhh')).toBe(true);
    expect(puedeTransicionarRequerimientos('analista_seleccion')).toBe(true);
    expect(puedeTransicionarRequerimientos('lider_area')).toBe(true);
    expect(puedeTransicionarRequerimientos('superusuario')).toBe(true);
    expect(puedeTransicionarRequerimientos('becario')).toBe(false);
  });

  it('editar requerimiento: únicamente el creador', () => {
    expect(puedeEditarRequerimiento('admin_rrhh', false)).toBe(false);
    expect(puedeEditarRequerimiento('superusuario', false)).toBe(false);
    expect(puedeEditarRequerimiento('lider_area', true)).toBe(true);
    expect(puedeEditarRequerimiento('lider_area', false)).toBe(false);
    expect(puedeEditarRequerimiento('analista_seleccion', true)).toBe(true);
    expect(puedeEditarRequerimiento(null, false)).toBe(false);
  });

  it('gestionar candidatos y subir CVs: analista_seleccion, admin_rrhh y superusuario', () => {
    expect(puedeGestionarCandidatos('analista_seleccion')).toBe(true);
    expect(puedeGestionarCandidatos('admin_rrhh')).toBe(true);
    expect(puedeGestionarCandidatos('superusuario')).toBe(true);
    expect(puedeGestionarCandidatos('lider_area')).toBe(false);
    expect(puedeGestionarCandidatos(null)).toBe(false);
  });

  it('editar candidato: creador, admin_rrhh o superusuario', () => {
    expect(puedeEditarCandidato('admin_rrhh', false)).toBe(true);
    expect(puedeEditarCandidato('superusuario', false)).toBe(true);
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
    expect(etiquetaRol('superusuario')).toBe('Superusuario (IT)');
    expect(etiquetaRol('becario')).toBe('becario');
    expect(etiquetaRol(null)).toBe('');
  });

  // ──────────────────────── Etapa 8B: superusuario (IT) ────────────────────────

  it('gestionar usuarios: EXCLUSIVO del superusuario (no de admin_rrhh)', () => {
    expect(puedeGestionarUsuarios('superusuario')).toBe(true);
    expect(puedeGestionarUsuarios('admin_rrhh')).toBe(false);
    expect(puedeGestionarUsuarios('analista_seleccion')).toBe(false);
    expect(puedeGestionarUsuarios('lider_area')).toBe(false);
    expect(puedeGestionarUsuarios('becario')).toBe(false);
    expect(puedeGestionarUsuarios(null)).toBe(false);
    expect(puedeGestionarUsuarios(undefined)).toBe(false);
  });

  it('el superusuario hereda el negocio, excepto la edición de solicitudes ajenas', () => {
    const roles = ['admin_rrhh', 'superusuario'] as const;
    for (const rol of roles) {
      expect(puedeGestionarRequerimientos(rol)).toBe(true);
      expect(puedeEditarRequerimiento(rol, false)).toBe(false);
      expect(puedeGestionarCandidatos(rol)).toBe(true);
      expect(puedeEditarCandidato(rol, false)).toBe(true);
      expect(puedeMoverPostulaciones(rol)).toBe(true);
      expect(puedeAgregarPostulaciones(rol)).toBe(true);
      expect(puedeTransicionarRequerimientos(rol)).toBe(true);
    }
    // Y el resto de roles NO gana permisos de administrador por efecto colateral.
    expect(puedeGestionarRequerimientos('analista_seleccion')).toBe(false);
    expect(puedeEditarRequerimiento('analista_seleccion', false)).toBe(false);
    expect(puedeMoverPostulaciones('lider_area')).toBe(false);
  });

  it('la navegación: el enlace «Usuarios» solo lo ve el superusuario', () => {
    expect(puedeVerSeccionUsuarios('superusuario')).toBe(true);
    expect(puedeVerSeccionUsuarios('admin_rrhh')).toBe(false);
    expect(puedeVerSeccionUsuarios('analista_seleccion')).toBe(false);
    expect(puedeVerSeccionUsuarios('lider_area')).toBe(false);
    expect(puedeVerSeccionUsuarios('becario')).toBe(false);
    expect(puedeVerSeccionUsuarios(null)).toBe(false);
    // Las secciones de negocio siguen visibles para los 4 roles de la matriz.
    expect(puedeVerSeccionRequerimientos('superusuario')).toBe(true);
    expect(puedeVerSeccionCandidatos('superusuario')).toBe(true);
  });
});
