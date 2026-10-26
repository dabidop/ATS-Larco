import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '../../database/database.service';
import { type ArchivoSubido, ArchivosCvService } from '../uploads/archivos-cv.service';
import type { ImportarHvsResponseDto, ResultadoArchivoDto } from './dto/importar-hvs.response';
import { extraerTextoPdf } from './pdf-texto';

/** Códigos que `node-postgres` copia del ErrorResponse de PostgreSQL. */
interface ErrorDePostgres {
  code?: string;
  constraint?: string;
  message?: string;
}

/**
 * ¿El error es una violación de UNICIDAD (23505) del índice de email único
 * (`candidatos_email_unique`)? Dos HVs con el mismo correo no crean dos
 * candidatos: el segundo se reporta como fallo de SU archivo.
 */
function esEmailDuplicado(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as ErrorDePostgres;
  return e.code === '23505' && (e.constraint ?? '').includes('email');
}

/** Texto amigable de un error para el resultado por archivo. */
function mensajeDeError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'Error desconocido';
}

/** ¿El buffer empieza (o contiene en su cabecera) con la firma `%PDF-`? */
function esPdf(buffer: Buffer): boolean {
  const cabecera = buffer.subarray(0, 1024).toString('latin1');
  return cabecera.includes('%PDF-');
}

/** Palabras que NO pueden ser nombre propio (cabeceras típicas de un HV). */
const PALABRAS_CABECERA = new Set([
  'curriculum',
  'curriculo',
  'hoja',
  'vida',
  'cv',
  'hv',
  'perfil',
  'contacto',
  'experiencia',
  'educación',
  'educacion',
  'formación',
  'formacion',
  'idiomas',
  'teléfono',
  'telefono',
  'email',
  'correo',
  'dirección',
  'direccion',
  'fecha',
  'nacimiento',
  'referencias',
  'objetivos',
  'competencias',
  'resumen',
  'datos',
  'personales',
  'nacionalidad',
  'cédula',
  'cedula',
  'profesional',
  'laboral',
  'proyectos',
  'certificaciones',
]);

/**
 * ¿La línea es un NOMBRE propio plausible? Reglas heurísticas (Etapa 9): 2–6
 * palabras, todas con inicial mayúscula (con acentos), sin dígitos ni
 * palabras-cabecera de CV. Devuelve nombres + apellidos o `null`.
 */
function interpretarNombre(cadena: string): { nombres: string; apellidos: string } | null {
  const limpia = cadena
    .replace(/[^\p{L}\p{M}.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (limpia.length === 0 || limpia.length > 120) return null;

  const palabras = limpia.split(' ');
  if (palabras.length < 2 || palabras.length > 6) return null;

  for (const palabra of palabras) {
    if (palabra.length < 2) return null;
    if (PALABRAS_CABECERA.has(palabra.toLowerCase())) return null;
    if (!/^\p{Lu}/u.test(palabra)) return null;
  }

  const [primera, ...resto] = palabras;
  if (primera === undefined) return null; // Imposible: ya se validó length >= 2.
  return { nombres: primera, apellidos: resto.join(' ') };
}

/**
 * Extrae el nombre del candidato del HV con tres fuentes, en orden: (1) el
 * título del PDF (muchos editores guardan allí el nombre del titular), (2) las
 * primeras líneas del texto extraído y (3) el nombre del fichero sin extensión
 * ni prefijos tipo «CV_»/«HV_». Devuelve `null` si ninguna fuente produce un
 * nombre plausible (el archivo se reporta como fallo, sin candidato a medias).
 */
function extraerNombres(
  texto: string,
  titulo: string | undefined,
  nombreArchivo: string,
): { nombres: string; apellidos: string } | null {
  if (titulo !== undefined) {
    const desdeTitulo = interpretarNombre(titulo);
    if (desdeTitulo !== null) return desdeTitulo;
  }

  const lineas = texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '')
    .slice(0, 20);
  for (const linea of lineas) {
    const desdeLinea = interpretarNombre(linea);
    if (desdeLinea !== null) return desdeLinea;
  }

  const stem = nombreArchivo.replace(/\.[^.]+$/, '');
  const sinPrefijo = stem
    .replace(/[_\-.]+/g, ' ')
    .replace(/^(cv|hv|hoja de vida|curriculum|curriculo)\s+/i, '')
    .trim();
  return interpretarNombre(sinPrefijo);
}

/** Primer correo encontrado en el texto (o `null`: el email es opcional). */
function extraerEmail(texto: string): string | null {
  const coincidencia = texto.match(/[\w.%+-]+@[\w.-]+\.[\p{L}]{2,}/u);
  return coincidencia === null ? null : coincidencia[0].toLowerCase();
}

/**
 * Casos de uso de la IMPORTACIÓN MASIVA de HVs (Etapa 9, retroalimentación).
 *
 * `POST /api/importacion/hvs` recibe hasta 50 PDFs y crea UN candidato por
 * archivo, etiquetado con el `departamentoId` de destino, SIN cédula (la
 * migración 010 la hizo opcional: el CV rara vez la trae; el analista la
 * completa luego desde la ficha) y con el PDF adjunto como CV.
 *
 * Heurística de extracción (sin OCR): nombre del candidato desde el título del
 * PDF, las primeras líneas de texto o el nombre del fichero; email opcional por
 * expresión regular. Un archivo ilegible NO cancela el lote: cada fila del
 * resultado dice qué pasó con SU archivo (todo-o-nada POR ARCHIVO: si el
 * adjunto del CV falla, se deshace el candidato creado en ese archivo).
 */
@Injectable()
export class ImportacionService {
  /** Log server-side de los fallos de parse (el cliente ve el mensaje genérico). */
  private readonly logger = new Logger(ImportacionService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly archivosCv: ArchivosCvService,
  ) {}

  /** Importa el lote de HVs → resumen con un resultado por archivo. */
  async importar(
    archivos: ArchivoSubido[],
    departamentoId: string,
    actor: string,
  ): Promise<ImportarHvsResponseDto> {
    if (archivos.length === 0) {
      throw new BadRequestException('Adjunta al menos un archivo PDF del HV');
    }
    // El destino se valida ANTES de crear nada: un destino inválido no puede
    // dejar candidatos a medias del lote.
    await this.assertDepartamentoExiste(departamentoId);

    const resultados: ResultadoArchivoDto[] = [];
    // Secuencial a propósito: `pdf-parse` es CPU-intensivo y el orden del
    // resultado debe coincidir con el orden de los archivos del multipart.
    for (const archivo of archivos) {
      resultados.push(await this.importarUno(archivo, departamentoId, actor));
    }

    const creados = resultados.filter((resultado) => resultado.ok).length;
    return {
      procesados: archivos.length,
      creados,
      fallidos: resultados.length - creados,
      resultados,
    };
  }

  /** Importa UN archivo (todo-o-nada dentro de él; aislado del resto del lote). */
  private async importarUno(
    archivo: ArchivoSubido,
    departamentoId: string,
    actor: string,
  ): Promise<ResultadoArchivoDto> {
    if (!esPdf(archivo.buffer)) {
      return {
        archivo: archivo.originalname,
        ok: false,
        motivo: 'El archivo no es un PDF válido (se importan solo HV en PDF)',
      };
    }

    let texto: string;
    let titulo: string | undefined;
    try {
      const extraido = await extraerTextoPdf(archivo.buffer);
      texto = extraido.texto;
      titulo = extraido.titulo;
    } catch (error) {
      // El detalle REAL va al log del servidor (diagnóstico); el cliente ve un
      // mensaje genérico en español sin filtros internos de pdf.js.
      this.logger.warn(
        `No se pudo leer el PDF «${archivo.originalname}»: ${mensajeDeError(error)}`,
      );
      return {
        archivo: archivo.originalname,
        ok: false,
        motivo: 'No se pudo leer el texto del PDF (¿está protegido o dañado?)',
      };
    }

    const nombres = extraerNombres(texto, titulo, archivo.originalname);
    if (nombres === null) {
      return {
        archivo: archivo.originalname,
        ok: false,
        motivo: 'No se pudo extraer el nombre del candidato del PDF',
      };
    }
    const email = extraerEmail(texto);

    let candidatoId: string;
    try {
      const insert = await this.database.query<{ id: string }>(
        `INSERT INTO candidatos (nombres, apellidos, email, departamento_id, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [nombres.nombres, nombres.apellidos, email, departamentoId, actor],
      );
      const fila = insert.rows[0];
      if (fila === undefined) {
        throw new Error('El INSERT sobre candidatos no devolvió ninguna fila');
      }
      candidatoId = fila.id;
    } catch (error) {
      if (esEmailDuplicado(error)) {
        return {
          archivo: archivo.originalname,
          ok: false,
          motivo: `Ya existe un candidato con el email ${email ?? ''}`.trim(),
        };
      }
      throw error;
    }

    try {
      await this.archivosCv.subir(candidatoId, archivo, actor);
    } catch (error) {
      // Todo-o-nada POR ARCHIVO: sin CV adjunto no hay candidato importado.
      await this.database
        .query('DELETE FROM candidatos WHERE id = $1', [candidatoId])
        .catch(() => undefined);
      return {
        archivo: archivo.originalname,
        ok: false,
        motivo: `No se pudo adjuntar el CV al candidato: ${mensajeDeError(error)}`,
      };
    }

    return { archivo: archivo.originalname, ok: true, candidatoId };
  }

  /** **404** si el departamento de destino no existe (antes de tocar nada). */
  private async assertDepartamentoExiste(departamentoId: string): Promise<void> {
    const resultado = await this.database.query<unknown[]>(
      'SELECT 1 FROM departamentos WHERE id = $1',
      [departamentoId],
    );
    if (resultado.rows.length === 0) {
      throw new NotFoundException(`No existe un departamento con id ${departamentoId}`);
    }
  }
}
