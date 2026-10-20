import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Trozo del DTO que contiene los dos límites salariales (sección 4). */
interface CondicionesSalariales {
  salarioMin?: number;
  salarioMax?: number;
}

/** Mensaje único (en español) para cualquier violación del rango salarial. */
const MENSAJE_RANGO_SALARIAL = 'El salario mínimo no puede ser mayor que el salario máximo';

/**
 * Validación cruzada `salarioMin <= salarioMax` entre dos propiedades HERMANAS
 * de un mismo objeto — algo que los decoradores de campo de class-validator no
 * cubren, de ahí un validador propio registrado con `registerDecorator`.
 *
 * Se aplica sobre la propiedad `condiciones` de los DTO de creación y de
 * actualización (ambos comparten la forma `{ salarioMin?, salarioMax? }`).
 *
 * Por qué no dejarlo solo en la BD: el CHECK `requerimientos_salario_rango_check`
 * (migración 003) rechazaría la fila y el filtro global devolvería un 500
 * genérico. Aquí se responde con un 400 y un mensaje claro.
 *
 * El registro "en frío" (sin módulo de Nest ni inyección) es la forma estándar
 * de crear validadores reutilizables con class-validator.
 */
export function IsSalarioRangoValido(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isSalarioRangoValido',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'object' || value === null) {
            // No es un objeto: lo resuelve la validación de tipos/nested.
            return true;
          }
          const { salarioMin, salarioMax } = value as CondicionesSalariales;
          if (typeof salarioMin !== 'number' || typeof salarioMax !== 'number') {
            // Sin los dos valores no hay rango que comparar (la BD admite nulos).
            return true;
          }
          return salarioMin <= salarioMax;
        },
        defaultMessage(): string {
          return MENSAJE_RANGO_SALARIAL;
        },
      },
    });
  };
}
