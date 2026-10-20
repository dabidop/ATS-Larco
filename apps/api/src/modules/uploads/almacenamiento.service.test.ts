import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../config/env.validation';
import { AlmacenamientoService } from './almacenamiento.service';

/**
 * Tests unitarios del almacén por CONTENIDO (Fase 4, parte 2).
 *
 * Sobre disco REAL, pero en un directorio temporal creado con `mkdtemp` (uno
 * por test, borrado en `afterEach`): así se verifica el comportamiento de
 * escritura/dedup/anti-path-traversal SIN tocar `UPLOAD_DIR` de desarrollo ni
 * dejar restos. NO hay base de datos: esta capa no conoce SQL.
 *
 * El `ConfigService` se SUSTITUYE por un doble mínimo que solo implementa
 * `getOrThrow('UPLOAD_DIR')` (lo único que consume el servicio).
 */

/** SHA-256 (hex) de un contenido cualquiera: es el nombre del fichero en disco. */
function sha256De(contenido: Buffer | string): string {
  return createHash('sha256').update(contenido).digest('hex');
}

/** Doble mínimo de `ConfigService<Env, true>`: solo fija `UPLOAD_DIR`. */
function configDoble(directorio: string): ConfigService<Env, true> {
  return {
    getOrThrow: (clave: string): string => {
      if (clave !== 'UPLOAD_DIR') {
        throw new Error(`Clave inesperada: ${clave}`);
      }
      return directorio;
    },
  } as unknown as ConfigService<Env, true>;
}

describe('AlmacenamientoService', () => {
  let directorio: string;
  let servicio: AlmacenamientoService;

  beforeEach(async () => {
    // Directorio temporal NUEVO por test: los tests no se pisan entre sí.
    directorio = await mkdtemp(join(tmpdir(), 'ats-uploads-'));
    servicio = new AlmacenamientoService(configDoble(directorio));
  });

  afterEach(async () => {
    // `force: true` + `recursive: true` borra aunque el test haya dejado ficheros.
    await rm(directorio, { recursive: true, force: true });
  });

  // ───────────────────────── guardar() ─────────────────────────

  describe('guardar', () => {
    it('escribe el contenido en `<UPLOAD_DIR>/<sha256>` y reporta `deduplicado: false`', async () => {
      const contenido = Buffer.from('%PDF-1.7\ncontenido de un cv\n', 'latin1');

      const resultado = await servicio.guardar(contenido);

      expect(resultado).toEqual({ sha256: sha256De(contenido), deduplicado: false });
      // El nombre del fichero ES el hash: la integridad queda garantizada por construcción.
      expect(await readFile(join(directorio, resultado.sha256))).toEqual(contenido);
    });

    it('NO reescribe el fichero si el mismo contenido ya existía (dedup idempotente)', async () => {
      const contenido = Buffer.from('%PDF-1.7\nmismo bytes\n', 'latin1');
      const primero = await servicio.guardar(contenido);

      // Se re-escribe con el MISMO contenido: `writeFile(flag: 'wx')` debe
      // fallar con EEXIST y el servicio debe devolver `deduplicado: true`…
      const segundo = await servicio.guardar(contenido);
      expect(segundo).toEqual({ sha256: primero.sha256, deduplicado: true });

      // …y, sobre todo, el fichero NO se toca: se comprueba con el tiempo de
      // modificación, que se fuerza a un valor antiguo ANTES de la segunda
      // escritura. Si `guardar` reescribiera, `mtime` volvería a "ahora".
      const ruta = join(directorio, primero.sha256);
      const viejo = new Date('2000-01-01T00:00:00Z');
      await utimes(ruta, viejo, viejo);

      await servicio.guardar(contenido);

      const info = await stat(ruta);
      expect(info.mtime.getTime()).toBe(viejo.getTime());
      expect(await readFile(ruta)).toEqual(contenido);
    });

    it('contenidos DISTINTOS producen ficheros distintos (sin dedup)', async () => {
      const a = await servicio.guardar(Buffer.from('%PDF-1.7\naaaa', 'latin1'));
      const b = await servicio.guardar(Buffer.from('%PDF-1.7\nbbbb', 'latin1'));

      expect(a.sha256).not.toBe(b.sha256);
      expect(a.deduplicado).toBe(false);
      expect(b.deduplicado).toBe(false);
      expect(await readdir(directorio)).toHaveLength(2);
    });

    it('crea el directorio en el primer uso (no hace falta existir antes)', async () => {
      // `servicio` se construyó sobre un directorio que YA existe (mkdtemp);
      // este segundo servicio apunta a un subdirectorio que NO existe todavía.
      const anidado = join(directorio, 'aun-no-existe', 'tampoco');
      const servicioNuevo = new AlmacenamientoService(configDoble(anidado));

      const resultado = await servicioNuevo.guardar(Buffer.from('%PDF-1.7\nx', 'latin1'));

      expect(await readFile(join(anidado, resultado.sha256))).toEqual(
        Buffer.from('%PDF-1.7\nx', 'latin1'),
      );
    });
  });

  // ───────────────────────── ruta() ─────────────────────────

  describe('ruta', () => {
    it('devuelve `<UPLOAD_DIR>/<sha256>` para un hash válido', () => {
      const sha = sha256De('cualquier cosa');
      expect(servicio.ruta(sha)).toBe(join(directorio, sha));
    });

    it('RECHAZA rutas con `..`, absolutas o vacías (anti path-traversal)', () => {
      // Es la protección de seguridad de esta capa: `ruta()` solo acepta un
      // hash bien formado, así que jamás se puede salir del directorio de subidas.
      expect(() => servicio.ruta('../etc/passwd')).toThrow(/sha256 inválido/);
      expect(() => servicio.ruta('/etc/passwd')).toThrow(/sha256 inválido/);
      expect(() => servicio.ruta('')).toThrow(/sha256 inválido/);
      expect(() => servicio.ruta('..')).toThrow(/sha256 inválido/);
      expect(() => servicio.ruta(`${sha256De('x')}/../..`)).toThrow(/sha256 inválido/);
    });

    it('RECHAZA un hash con MAYÚSCULAS (el nombre en disco es hex en minúscula)', () => {
      expect(() => servicio.ruta(sha256De('x').toUpperCase())).toThrow(/sha256 inválido/);
    });

    it('RECHAZA un hash de longitud incorrecta o no hex', () => {
      expect(() => servicio.ruta('a'.repeat(63))).toThrow(/sha256 inválido/);
      expect(() => servicio.ruta('a'.repeat(65))).toThrow(/sha256 inválido/);
      expect(() => servicio.ruta('z'.repeat(64))).toThrow(/sha256 inválido/);
    });
  });

  // ───────────────────────── existe() y leer() ─────────────────────────

  describe('existe y leer', () => {
    it('existe() es `false` si el fichero no está y NO crea el directorio', async () => {
      const servicioNuevo = new AlmacenamientoService(configDoble(join(directorio, 'no-existe')));

      await expect(servicioNuevo.existe(sha256De('faltante'))).resolves.toBe(false);
      // La comprobación es de SOLO LECTURA: no debe crear nada en disco.
      await expect(stat(join(directorio, 'no-existe'))).rejects.toThrow(/ENOENT/);
    });

    it('existe() es `true` tras guardar y leer() devuelve los bytes EXACTOS', async () => {
      const contenido = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0x7f]);
      const { sha256 } = await servicio.guardar(contenido);

      await expect(servicio.existe(sha256)).resolves.toBe(true);
      await expect(servicio.leer(sha256)).resolves.toEqual(contenido);
    });

    it('leer() propaga el ENOENT de `fs` si el fichero no existe (500 arriba)', async () => {
      // No se traduce a una excepción de Nest aquí: el servicio de archivos es
      // quien decide que eso es una inconsistencia del servidor (500), no 404.
      await expect(servicio.leer(sha256De('nunca-escrito'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });
  });
});
