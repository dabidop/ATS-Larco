import type { CryptoService } from '../../common/crypto/crypto.service';
import type { Candidato } from './candidato.entity';
import type { CreateCandidatoDto } from './dto/create-candidato.dto';
import type { CandidatoResponseDto } from './dto/candidato.response';
import type { UpdateCandidatoDto } from './dto/update-candidato.dto';

/**
 * Mapeo EXPLÍCITO DTO ↔ entidad del módulo de candidatos.
 *
 * La API habla camelCase (`cargoActual`, `expectativaSalarial`), la entidad
 * también en propiedades pero con columnas snake_case (`cargo_actual`,
 * `expectativa_salarial`) y la BD añade sus propios nombres. Este fichero es el
 * ÚNICO punto donde esas vistas se cruzan.
 *
 * Es distinto al de requerimientos en un punto clave: la PII. Aquí el mapper
 * además DESCIFRA (`toResponse`) y RECIBE ya cifrados/hash (`buildCreateData`)
 * los campos sensibles; nunca ve ni expone `cedulaHash` en la respuesta.
 */

/** Mínimo del descifrado que necesita el mapper (permite dobles en tests). */
export type Descifrador = Pick<CryptoService, 'decrypt'>;

/**
 * Campos de `Candidato` que la API gestiona en la creación. Excluye los que
 * decide el sistema: `id`, timestamps (BD) y `createdBy` (llega del JWT en el
 * servicio, no del mapper).
 */
export type CandidatoEditable = Omit<Candidato, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

/** PII ya preparada por el servicio (cifrada) + hash de búsqueda, para el INSERT. */
export interface PiiPreparada {
  cedulaCifrada: string;
  telefonoCifrada: string | null;
  cedulaHash: string;
}

/**
 * DTO de creación → datos de la entidad.
 *
 * Los opcionales del DTO (`undefined`) se traducen a `null`: las columnas son
 * `NULL` en BD y la entidad declara `string | null`, no `string | undefined`.
 * Los campos PII (`cedula`, `telefono`) NO aparecen aquí en claro: el servicio
 * los pasa ya cifrados en `pii`.
 */
export function buildCreateData(dto: CreateCandidatoDto, pii: PiiPreparada): CandidatoEditable {
  return {
    nombres: dto.nombres.trim(),
    apellidos: dto.apellidos.trim(),
    email: normalizarCadena(dto.email),
    cedulaCifrada: pii.cedulaCifrada,
    telefonoCifrada: pii.telefonoCifrada,
    cedulaHash: pii.cedulaHash,
    ciudad: normalizarCadena(dto.ciudad),
    cargoActual: normalizarCadena(dto.cargoActual),
    expectativaSalarial: dto.expectativaSalarial ?? null,
    disponibilidad: normalizarCadena(dto.disponibilidad),
    notas: normalizarCadena(dto.notas),
  };
}

/**
 * DTO de actualización → PARCIAL de la entidad: solo los campos presentes.
 *
 * `undefined` significa "no viene en el cuerpo" y por tanto "sin cambios"; los
 * campos ausentes NO aparecen en el resultado, de modo que `save()` no los
 * pisa. Un `null` explícito sí viaja (permite vaciar una columna nullable).
 *
 * La cédula y el teléfono NO se manejan aquí: el servicio los re-cifra y
 * re-hashea aparte (requiere `CryptoService` + `SearchHashService`).
 */
export function buildUpdateData(dto: UpdateCandidatoDto): Partial<CandidatoEditable> {
  const cambios: Partial<CandidatoEditable> = {};

  if (dto.nombres !== undefined) cambios.nombres = dto.nombres.trim();
  if (dto.apellidos !== undefined) cambios.apellidos = dto.apellidos.trim();
  if (dto.email !== undefined) cambios.email = normalizarCadena(dto.email);
  if (dto.ciudad !== undefined) cambios.ciudad = normalizarCadena(dto.ciudad);
  if (dto.cargoActual !== undefined) cambios.cargoActual = normalizarCadena(dto.cargoActual);
  if (dto.expectativaSalarial !== undefined) {
    cambios.expectativaSalarial = dto.expectativaSalarial;
  }
  if (dto.disponibilidad !== undefined) {
    cambios.disponibilidad = normalizarCadena(dto.disponibilidad);
  }
  if (dto.notas !== undefined) cambios.notas = normalizarCadena(dto.notas);

  return cambios;
}

/**
 * Entidad → respuesta HTTP (camelCase, fechas en ISO 8601).
 *
 * AQUÍ se descifra la PII: `cedula`/`telefono` salen en claro para el cliente
 * autenticado. El hash interno (`cedulaHash`) y las columnas cifradas NO se
 * incluyen nunca en la respuesta.
 */
export function toResponse(entidad: Candidato, descifrador: Descifrador): CandidatoResponseDto {
  const telefonoDescifrado = descifrador.decrypt(entidad.telefonoCifrada);
  const cedulaDescifrada = descifrador.decrypt(entidad.cedulaCifrada) ?? '';

  return {
    id: entidad.id,
    nombres: entidad.nombres,
    apellidos: entidad.apellidos,
    email: entidad.email,
    cedula: cedulaDescifrada,
    telefono: telefonoDescifrado,
    ciudad: entidad.ciudad,
    cargoActual: entidad.cargoActual,
    expectativaSalarial: entidad.expectativaSalarial,
    disponibilidad: entidad.disponibilidad,
    notas: entidad.notas,
    createdBy: entidad.createdBy,
    createdAt: entidad.createdAt.toISOString(),
    updatedAt: entidad.updatedAt.toISOString(),
  };
}

/**
 * `undefined` → `null` (columna vacía); el texto se recorta para no guardar
 * solo espacios como si fuera un valor. Un string vacío tras recortar también
 * queda `null`.
 */
function normalizarCadena(valor: string | undefined): string | null {
  if (valor === undefined) {
    return null;
  }
  const recortado = valor.trim();
  return recortado === '' ? null : recortado;
}
