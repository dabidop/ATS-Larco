import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import type { Env } from '../../config/env.validation';
import { CodigoGeneratorService } from './codigo-generator.service';
import { Requerimiento } from './requerimiento.entity';
import { RequerimientosController } from './requerimientos.controller';
import { RequerimientosStoreService } from './requerimientos-store.service';

/**
 * Módulo de requerimientos de personal (Fase 3).
 *
 * Persistencia híbrida del proyecto: el resto de la API consulta con el pool
 * `pg` de `DatabaseService`; SOLO este módulo usa TypeORM.
 *
 * El `DataSource` se CONSTRUYE aquí pero NO se inicializa (`useFactory` sin
 * `.initialize()`): la conexión se abre de forma perezosa desde
 * `RequerimientosStoreService` cuando el módulo se usa por primera vez.
 * Motivos dobles: (1) el arranque de la API no depende de que PostgreSQL esté
 * disponible y no se abre una segunda conexión sin necesidad; (2) los tests
 * e2e siguen siendo herméticos — `AppModule` arranca sin tocar la BD.
 * Por eso NO se usa `TypeORMModule.forRootAsync`, que inicializa en el
 * bootstrap. `synchronize: false` es innegociable: el esquema lo dictan las
 * migraciones de `apps/api/db/migrations`.
 */
@Module({
  controllers: [RequerimientosController],
  providers: [
    RequerimientosStoreService,
    // Generador atómico de códigos REQ-YYYY-NNN (parte 2): consumido por la
    // capa CRUD de la parte 3, que llegará como provider de ESTE módulo.
    CodigoGeneratorService,
    {
      provide: DataSource,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DataSource =>
        new DataSource({
          type: 'postgres',
          url: config.getOrThrow('DATABASE_URL'),
          entities: [Requerimiento],
          synchronize: false,
        }),
    },
  ],
  exports: [RequerimientosStoreService, CodigoGeneratorService],
})
export class RequerimientosModule {}
