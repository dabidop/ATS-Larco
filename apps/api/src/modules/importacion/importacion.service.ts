import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isEmail } from 'class-validator';

import { DatabaseService } from '../../database/database.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SearchHashService } from '../candidatos/search-hash.service';
import { type ArchivoSubido, ArchivosCvService } from '../uploads/archivos-cv.service';
import type { RevisionImportacionDto } from './dto/confirmar-hvs.dto';
import type {
  ImportarHvsResponseDto,
  PrevisualizacionArchivoDto,
  PrevisualizacionHvsResponseDto,
  ResultadoArchivoDto,
} from './dto/importar-hvs.response';
import { extraerTextoPdf } from './pdf-texto';
import { LIMITES_CANDIDATO } from '../candidatos/dto/create-candidato.dto';

/** Códigos que `node-postgres` copia del ErrorResponse de PostgreSQL. */
interface ErrorDePostgres {
  code?: string;
  constraint?: string;
  message?: string;
}

/** Identificador no reversible para diagnosticar un archivo sin registrar su nombre. */
function identificadorArchivoSeguro(nombre: string): string {
  return createHash('sha256').update(nombre).digest('hex').slice(0, 16);
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

function esCedulaDuplicada(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as ErrorDePostgres;
  return e.code === '23505' && (e.constraint ?? '').includes('cedula_hash');
}

/** Detalle técnico reducido: nunca incluye el mensaje (puede contener PII/SQL). */
function tipoDeError(error: unknown): string {
  return error instanceof Error && error.name.trim() !== '' ? error.name : 'Error';
}

function esTexto(valor: unknown): valor is string {
  return typeof valor === 'string';
}

/** Valida el JSON controlado por el cliente antes de usarlo como datos de candidato. */
export function validarRevisiones(
  valor: unknown,
  cantidadArchivos: number,
): RevisionImportacionDto[] {
  if (!Array.isArray(valor) || valor.length !== cantidadArchivos) {
    throw new BadRequestException('revisiones debe contener una revisión por cada archivo');
  }

  const indices = new Set<number>();
  return valor.map((item, posicion) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new BadRequestException('Cada revisión debe ser un objeto válido');
    }
    const revision = item as Record<string, unknown>;
    const camposPermitidos = new Set([
      'indice',
      'nombres',
      'apellidos',
      'email',
      'telefono',
      'ciudad',
      'habilidades',
    ]);
    if (Object.keys(revision).some((campo) => !camposPermitidos.has(campo))) {
      throw new BadRequestException('La revisión contiene campos no permitidos');
    }
    const indice = revision.indice;
    if (
      typeof indice !== 'number' ||
      !Number.isInteger(indice) ||
      indice < 0 ||
      indice >= cantidadArchivos ||
      indices.has(indice)
    ) {
      throw new BadRequestException(
        'Los índices de revisión deben ser únicos y estar dentro del lote',
      );
    }
    indices.add(indice);

    const nombres = revision.nombres;
    const apellidos = revision.apellidos;
    if (
      !esTexto(nombres) ||
      !esTexto(apellidos) ||
      nombres.trim().length < 3 ||
      nombres.trim().length > LIMITES_CANDIDATO.nombres ||
      apellidos.trim().length < 3 ||
      apellidos.trim().length > LIMITES_CANDIDATO.apellidos
    ) {
      throw new BadRequestException(`nombres y apellidos inválidos en la revisión ${posicion + 1}`);
    }

    const opcionales = [
      ['email', LIMITES_CANDIDATO.email],
      ['telefono', LIMITES_CANDIDATO.telefono],
      ['ciudad', LIMITES_CANDIDATO.ciudad],
    ] as const;
    for (const [campo, limite] of opcionales) {
      const dato = revision[campo];
      if (dato !== undefined && dato !== null && (!esTexto(dato) || dato.trim().length > limite)) {
        throw new BadRequestException(`${campo} inválido en la revisión ${posicion + 1}`);
      }
    }
    const email = revision.email;
    if (email !== undefined && email !== null && email !== '' && !isEmail(String(email).trim())) {
      throw new BadRequestException(`email inválido en la revisión ${posicion + 1}`);
    }
    const habilidades = revision.habilidades;
    if (habilidades !== undefined && (!Array.isArray(habilidades) || !habilidades.every(esTexto))) {
      throw new BadRequestException(`habilidades inválidas en la revisión ${posicion + 1}`);
    }

    return {
      indice,
      nombres: nombres.trim(),
      apellidos: apellidos.trim(),
      email: email === null || email === undefined ? null : String(email).trim(),
      telefono:
        revision.telefono === null || revision.telefono === undefined
          ? null
          : String(revision.telefono).trim(),
      ciudad:
        revision.ciudad === null || revision.ciudad === undefined
          ? null
          : String(revision.ciudad).trim(),
      habilidades: habilidades as string[] | undefined,
    };
  });
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
  'técnico',
  'tecnico',
  'asistente',
  'administrativa',
  'administrativo',
  'bachiller',
  'ingeniería',
  'ingenieria',
  'tecnólogo',
  'tecnologo',
  'sistemas',
  'estudios',
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

/** Convierte títulos de Canva exportados como letras separadas: `D A V I D`. */
function compactarTextoCanva(linea: string): string {
  const tokens = linea.trim().split(/\s+/);
  if (tokens.length < 4 || !tokens.every((token) => /^\p{L}$/u.test(token))) return linea;
  return tokens.join('');
}

/**
 * Extrae el nombre del candidato del HV con tres fuentes, en orden: (1) el
 * título del PDF (muchos editores guardan allí el nombre del titular), (2) las
 * primeras líneas del texto extraído y (3) el nombre del fichero sin extensión
 * ni prefijos tipo «CV_»/«HV_». Devuelve `null` si ninguna fuente produce un
 * nombre plausible (el archivo se reporta como fallo, sin candidato a medias).
 */
export function extraerNombres(
  texto: string,
  titulo: string | undefined,
  _nombreArchivo: string,
): { nombres: string; apellidos: string } | null {
  if (titulo !== undefined) {
    const desdeTitulo = interpretarNombre(titulo);
    if (desdeTitulo !== null) return desdeTitulo;
  }

  const lineas = texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '')
    // Canva suele ubicar el nombre después de varias secciones visuales; no
    // limitar la búsqueda a las primeras líneas evita perderlo.
    .slice(0, 200);
  for (const linea of lineas) {
    const desdeLinea = interpretarNombre(compactarTextoCanva(linea));
    if (desdeLinea !== null) return desdeLinea;
  }

  // En plantillas Canva el nombre puede salir como dos líneas de letras
  // separadas. Nunca se usa el nombre del fichero como identidad.
  for (let i = 0; i < lineas.length - 1; i++) {
    const actual = compactarTextoCanva(lineas[i] ?? '');
    const siguiente = compactarTextoCanva(lineas[i + 1] ?? '');
    const esTextoDeSeccion = [...PALABRAS_CABECERA].some((palabra) =>
      actual.toLowerCase().includes(palabra.replaceAll(' ', '')),
    );
    if (esTextoDeSeccion) continue;
    if (/^[\p{Lu}]{8,}$/u.test(actual) && /^[\p{Lu}]{5,}$/u.test(siguiente)) {
      const corte = Math.floor(actual.length / 2);
      return { nombres: `${actual.slice(0, corte)} ${actual.slice(corte)}`, apellidos: siguiente };
    }
  }
  return null;
}

/** Primer correo encontrado en el texto (o `null`: el email es opcional). */
export function extraerEmail(texto: string): string | null {
  const coincidencia = texto.match(/[\w.%+-]+@[\w.-]+\.[\p{L}]{2,}/u);
  return coincidencia === null ? null : coincidencia[0].toLowerCase();
}

export function extraerCedula(texto: string): string | null {
  const coincidencia = texto.match(
    /(?:c\.?\s*c\.?|c[eé]dula)(?:\s*(?:no\.?|n[uú]mero))?\s*[:#.-]*\s*([\d .-]{6,18})/i,
  );
  if (coincidencia === null) return null;
  const cedula = coincidencia[1]?.replace(/\D/g, '') ?? '';
  return /^\d{6,10}$/.test(cedula) ? cedula : null;
}

export function extraerTelefono(texto: string): string | null {
  const coincidencia = texto.match(/(?:\+?57[\s.-]*)?(?:3\d{2}[\s.-]*\d{3}[\s.-]*\d{4})\b/);
  return coincidencia?.[0]?.trim() ?? null;
}

const CIUDADES_COLOMBIA = [
  'Medellín',
  'Bogotá',
  'Cali',
  'Barranquilla',
  'Cartagena',
  'Sabaneta',
  'Envigado',
  'Itagüí',
  'Bello',
  'Rionegro',
  'Manizales',
  'Pereira',
  'Armenia',
  'Santa Marta',
  'Villavicencio',
  'Bucaramanga',
  'Ibagué',
];

export function extraerCiudad(texto: string): string | null {
  const conEtiqueta = texto.match(
    /(?:ciudad|ubicaci[oó]n|residencia)\s*[:-]?\s*([\p{L} .'-]{3,60})/iu,
  );
  if (conEtiqueta?.[1]) return conEtiqueta[1].trim().split(/[,\n]/)[0]?.trim() ?? null;
  const normalizado = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return (
    CIUDADES_COLOMBIA.find((ciudad) =>
      normalizado.includes(
        ciudad
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase(),
      ),
    ) ?? null
  );
}

/** Habilidades que se pueden afirmar solo cuando aparecen literalmente en el texto. */
const HABILIDADES_CONTRASTABLES: readonly [RegExp, string][] = [
  [/\btypescript\b/i, 'TypeScript'],
  [/\bjavascript\b/i, 'JavaScript'],
  [/\breact(?:\.js)?\b/i, 'React'],
  [/\bnode(?:\.js)?\b/i, 'Node.js'],
  [/\bpostgres(?:ql)?\b/i, 'PostgreSQL'],
  [/\bsql\b/i, 'SQL'],
  [/\bpython\b/i, 'Python'],
  [/\bexcel\b/i, 'Excel'],
  [/\bliderazgo\b/i, 'Liderazgo'],
  [/\bcomunicaci[oó]n\b/i, 'Comunicación'],
  [/\btrabajo en equipo\b/i, 'Trabajo en equipo'],
  [/\ban[aá]lisis de datos\b/i, 'Análisis de datos'],
  [/\bgesti[oó]n de proyectos\b/i, 'Gestión de proyectos'],
];

export function extraerHabilidades(texto: string): string[] {
  return HABILIDADES_CONTRASTABLES.filter(([patron]) => patron.test(texto)).map(
    ([, nombre]) => nombre,
  );
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
    private readonly crypto: CryptoService,
    private readonly searchHash: SearchHashService,
  ) {}

  /** Previsualiza sin crear candidatos ni guardar archivos. */
  async previsualizar(archivos: ArchivoSubido[]): Promise<PrevisualizacionHvsResponseDto> {
    const resultados: PrevisualizacionArchivoDto[] = [];
    for (const [indice, archivo] of archivos.entries()) {
      if (!esPdf(archivo.buffer)) {
        resultados.push({
          archivo: archivo.originalname,
          indice,
          ok: false,
          motivo: 'El archivo no es un PDF válido (se importan solo HV en PDF)',
        });
        continue;
      }
      try {
        const extraido = await extraerTextoPdf(archivo.buffer);
        const nombres = extraerNombres(extraido.texto, extraido.titulo, archivo.originalname);
        if (nombres === null) {
          resultados.push({
            archivo: archivo.originalname,
            indice,
            ok: false,
            motivo: 'No se pudieron sugerir nombre y apellidos; corrige los datos manualmente',
          });
          continue;
        }
        resultados.push({
          archivo: archivo.originalname,
          indice,
          ok: true,
          sugerencias: {
            ...nombres,
            email: extraerEmail(extraido.texto),
            telefono: extraerTelefono(extraido.texto),
            ciudad: extraerCiudad(extraido.texto),
            habilidades: extraerHabilidades(extraido.texto),
          },
        });
      } catch (error) {
        this.logger.warn(
          `No se pudo previsualizar un PDF (archivo ${identificadorArchivoSeguro(archivo.originalname)}; tipo ${tipoDeError(error)})`,
        );
        resultados.push({
          archivo: archivo.originalname,
          indice,
          ok: false,
          motivo: 'No se pudo leer el texto del PDF (¿está protegido o dañado?)',
        });
      }
    }
    return { procesados: archivos.length, resultados };
  }

  /** Confirma el lote usando únicamente los valores editados por el usuario. */
  async confirmar(
    archivos: ArchivoSubido[],
    departamentoId: string,
    revisionesJson: string,
    actor: string,
  ): Promise<ImportarHvsResponseDto> {
    let parseado: unknown;
    try {
      parseado = JSON.parse(revisionesJson);
    } catch {
      throw new BadRequestException('revisiones debe ser una lista JSON válida');
    }
    // La sintaxis JSON y la forma del contrato son errores distintos: conservar
    // el diagnóstico de validación evita responder "JSON inválido" a un objeto
    // válido pero incompleto, sin incluir valores sensibles en el mensaje.
    const revisiones = validarRevisiones(parseado, archivos.length);
    await this.assertDepartamentoExiste(departamentoId);
    const revisionesPorIndice = new Map(revisiones.map((revision) => [revision.indice, revision]));
    const resultados: ResultadoArchivoDto[] = [];
    for (const [indice, archivo] of archivos.entries()) {
      const revision = revisionesPorIndice.get(indice);
      if (revision === undefined) {
        resultados.push({
          archivo: archivo.originalname,
          ok: false,
          motivo: 'La revisión debe confirmar nombres y apellidos',
        });
        continue;
      }
      resultados.push(await this.importarUno(archivo, departamentoId, actor, revision));
    }
    const creados = resultados.filter((resultado) => resultado.ok).length;
    return {
      procesados: archivos.length,
      creados,
      fallidos: archivos.length - creados,
      resultados,
    };
  }

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
    revision?: RevisionImportacionDto,
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
        `No se pudo leer un PDF (archivo ${identificadorArchivoSeguro(archivo.originalname)}; tipo ${tipoDeError(error)})`,
      );
      return {
        archivo: archivo.originalname,
        ok: false,
        motivo: 'No se pudo leer el texto del PDF (¿está protegido o dañado?)',
      };
    }

    const nombresExtraidos = extraerNombres(texto, titulo, archivo.originalname);
    const nombres =
      revision === undefined
        ? nombresExtraidos
        : {
            nombres: revision.nombres.trim(),
            apellidos: revision.apellidos.trim(),
          };
    const email = revision === undefined ? extraerEmail(texto) : revision.email?.trim() || null;
    const cedula = extraerCedula(texto);
    const telefono =
      revision === undefined ? extraerTelefono(texto) : revision.telefono?.trim() || null;
    const ciudad = revision === undefined ? extraerCiudad(texto) : revision.ciudad?.trim() || null;
    const faltantes = [nombres === null ? 'nombre y apellidos' : null].filter(
      (campo): campo is string => campo !== null,
    );
    if (faltantes.length > 0) {
      return {
        archivo: archivo.originalname,
        ok: false,
        motivo:
          `No se pudieron extraer los campos obligatorios: ${faltantes.join(', ')}. ` +
          'Verifica que el PDF contenga texto seleccionable o realiza una carga manual.',
      };
    }

    let candidatoId: string;
    try {
      candidatoId = await this.database.withTransaction(async (cliente) => {
        const insert = await cliente.query<{ id: string }>(
          `INSERT INTO candidatos
            (nombres, apellidos, email, cedula_cifrada, cedula_hash,
             telefono_cifrada, ciudad, departamento_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            nombres!.nombres,
            nombres!.apellidos,
            email,
            cedula === null ? null : this.crypto.encrypt(cedula),
            cedula === null ? null : this.searchHash.hashCedula(cedula),
            telefono === null ? null : this.crypto.encrypt(telefono),
            ciudad,
            departamentoId,
            actor,
          ],
        );
        const fila = insert.rows[0];
        if (fila === undefined) {
          throw new Error('El INSERT sobre candidatos no devolvió ninguna fila');
        }
        await this.archivosCv.subirEnTransaccion(cliente, fila.id, archivo, actor);
        return fila.id;
      });
    } catch (error) {
      if (esEmailDuplicado(error)) {
        return {
          archivo: archivo.originalname,
          ok: false,
          motivo: 'No se pudo crear el candidato porque el email ya está registrado',
        };
      }
      if (esCedulaDuplicada(error)) {
        return {
          archivo: archivo.originalname,
          ok: false,
          motivo: 'No se pudo crear el candidato porque la cédula ya está registrada',
        };
      }
      return {
        archivo: archivo.originalname,
        ok: false,
        motivo: 'No se pudo completar el registro del candidato y su CV',
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
