import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { BadRequestException } from '@nestjs/common';

import { CandidatosService } from '../src/modules/candidatos/candidatos.service';
import { CreateCandidatoDto } from '../src/modules/candidatos/dto/create-candidato.dto';
import { UpdateCandidatoDto } from '../src/modules/candidatos/dto/update-candidato.dto';

const DEPARTAMENTO_ID = '11111111-1111-4111-8111-111111111111';

async function erroresDe<T extends object>(tipo: new () => T, departamentoId: unknown) {
  return validate(plainToInstance(tipo, { departamentoId }));
}

describe('contrato de departamento de candidatos', () => {
  it('rechaza null en PATCH antes de llegar a TypeORM', async () => {
    const errores = await erroresDe(UpdateCandidatoDto, null);
    expect(errores.some((error) => error.property === 'departamentoId')).toBe(true);
  });

  it('defiende null en el servicio sin depender de una base de datos', async () => {
    const user = {
      sub: '22222222-2222-4222-8222-222222222222',
      email: 'test@local',
      role: 'analista_seleccion',
    };
    const repo = {
      findOneBy: async () => ({ createdBy: user.sub }),
    };
    const servicio = new CandidatosService(
      { repo: async () => repo } as never,
      {} as never,
      {} as never,
    );

    await expect(
      servicio.update(
        '33333333-3333-4333-8333-333333333333',
        { departamentoId: null } as never,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta un departamento válido en PATCH', async () => {
    expect(await erroresDe(UpdateCandidatoDto, DEPARTAMENTO_ID)).toHaveLength(0);
  });

  it('mantiene opcional el departamento ausente en creación para que lo resuelva el líder', async () => {
    const dto = plainToInstance(CreateCandidatoDto, {
      nombres: 'Ana',
      apellidos: 'Lopez',
      cedula: '123456789',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza null en creación en vez de dejar que la FK produzca un 500', async () => {
    const errores = await erroresDe(CreateCandidatoDto, null);
    expect(errores.some((error) => error.property === 'departamentoId')).toBe(true);
  });
});
