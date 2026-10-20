import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Env } from '../../config/env.validation';

/** Un SHA-256 válido es exactamente 64 dígitos hex en minúscula. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** ¿Es un `ENOENT`/`EEXIST` de Node (comparación por código, no por mensaje)? */
function esErrorDeFs(error: unknown, codigo: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return (error as NodeJS.ErrnoException).code === codigo;
}

/**
 * Almacenamiento de archivos por CONTENIDO (Fase 4, parte 2).
 *
 * Modelo: el nombre de cada fichero en disco es su SHA-256 en hex dentro de
 * `UPLOAD_DIR` (`<UPLOAD_DIR>/<sha256>`). Consecuencias:
 *
 *  - INTEGRIDAD: el nombre coincide SIEMPRE con el contenido; si alguien toca
 *    el fichero, la comprobación del hash delata la alteración.
 *  - DEDUP DE ALMACENAMIENTO: dos candidatos que adjuntan el mismo bytes
 *    comparten UN SOLO fichero en disco (una fila por subida en `archivos_cv`,
 *    ver la migración 006). `guardar()` es idempotente.
 *  - SEGURIDAD: nunca hay nombre de origen del usuario en el sistema de
 *    archivos (imposible de hacer path-traversal) y `ruta()` solo acepta un
 *    hash bien formado. Las rutas NUNCA se devuelven al cliente: la API solo
 *    expone metadatos y el hash.
 *
 * RETENCIÓN (decisión de diseño): el candidato NO tiene endpoint `DELETE`
 * (trazabilidad, ver `CandidatosController`) y, cuando lo tenga, esta capa
 * TAMPOCO borra ficheros: los bytes subidos se CONSERVAN de forma
 * independiente de las filas. Motivo: varios candidatos pueden compartir el
 * mismo fichero (dedup), así que un borrado por fila pondría en riesgo los
 * archivos de OTROS candidatos; además `audit_log` (inmutable) conserva los
 * metadatos históricos. La limpieza de huérfanos, si algún día hace falta, será
 * un proceso explícito de mantenimiento (barre ficheros sin fila asociada), no
 * un borrado en caliente dentro de la API.
 *
 * El directorio NO se crea en el arranque: se crea en el primer uso (así un
 * arranque sin BD o una suite de tests no deja restos en disco).
 */
@Injectable()
export class AlmacenamientoService {
  /** Directorio absoluto de subidas (`UPLOAD_DIR`, ya validado por zod). */
  readonly directorio: string;

  /** Marca de directorio creado: `mkdir({ recursive })` es idempotente. */
  private directorioListo = false;

  constructor(config: ConfigService<Env, true>) {
    // `resolve` fija la ruta absoluta AHORA (contra el CWD del proceso), de
    // modo que un cambio posterior de CWD no desvía las escrituras.
    this.directorio = resolve(config.getOrThrow('UPLOAD_DIR'));
  }

  /**
   * Guarda el buffer en `<UPLOAD_DIR>/<sha256>` si aún no existe.
   *
   * Dedup ATÓMICO: se escribe con la bandera `wx` («falla si ya existe»), así
   * que dos peticiones concurrentes con el mismo contenido no se pisan ni
   * reescriben: la primera crea el fichero (`deduplicado: false`) y las demás
   * reciben `EEXIST` → `deduplicado: true`. NO se comprueba antes con `existe()`
   * precisamente para evitar la carrera entre comprobación y escritura.
   */
  async guardar(buffer: Buffer): Promise<{ sha256: string; deduplicado: boolean }> {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    await this.preparar();

    try {
      await writeFile(this.ruta(sha256), buffer, { flag: 'wx' });
      return { sha256, deduplicado: false };
    } catch (error) {
      if (esErrorDeFs(error, 'EEXIST')) {
        // Ya estaba: NO se reescribe, el contenido es idéntico por definición.
        return { sha256, deduplicado: true };
      }
      throw error;
    }
  }

  /**
   * Ruta absoluta de un fichero por su hash.
   *
   * Anti path-traversal POR CONSTRUCCIÓN: solo se admite un hash de 64 dígitos
   * hex en minúscula; cualquier otra cosa (`../`, rutas absolutas, mayúsculas,
   * string vacío) lanza un `Error` de programación. Protege también si el
   * valor viniera de una fila corrupta de la base de datos.
   */
  ruta(sha256: string): string {
    if (!SHA256_HEX.test(sha256)) {
      throw new Error('sha256 inválido: se esperaban 64 dígitos hex en minúscula');
    }
    return join(this.directorio, sha256);
  }

  /** ¿Existe el fichero en disco? (Solo consulta: NO crea el directorio.) */
  async existe(sha256: string): Promise<boolean> {
    try {
      await stat(this.ruta(sha256));
      return true;
    } catch (error) {
      if (esErrorDeFs(error, 'ENOENT')) {
        return false;
      }
      throw error;
    }
  }

  /** Lee el fichero completo. Si no está, `fs` lanza `ENOENT` (→ 500 arriba). */
  async leer(sha256: string): Promise<Buffer> {
    return readFile(this.ruta(sha256));
  }

  /**
   * Crea `UPLOAD_DIR` en el primer uso. `recursive: true` no falla si el
   * directorio ya existe y admite llamadas concurrentes, así que no hace falta
   * deduplicar: si FALLA, la marca no se pone y el siguiente uso reintenta.
   */
  private async preparar(): Promise<void> {
    if (this.directorioListo) {
      return;
    }
    await mkdir(this.directorio, { recursive: true });
    this.directorioListo = true;
  }
}
