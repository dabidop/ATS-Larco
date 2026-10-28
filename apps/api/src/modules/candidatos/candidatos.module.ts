import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import type { Env } from '../../config/env.validation';
import { UploadsModule } from '../uploads/uploads.module';
import { Candidato } from './candidato.entity';
import { CandidatosController } from './candidatos.controller';
import { CandidatosService } from './candidatos.service';
import { CandidatosStoreService } from './candidatos-store.service';
import { SearchHashService } from './search-hash.service';

/**
 * Módulo de gestión de candidatos con PII cifrada (Fase 4, parte 1).
 *
 * Mismo patrón de persistencia híbrida que `RequerimientosModule`: el resto de
 * la API consulta con el pool `pg` de `DatabaseService`; SOLO este módulo (y el
 * de requerimientos) usa TypeORM, cada uno con SU PROPIO `DataSource`.
 *
 * El `DataSource` se CONSTRUYE aquí pero NO se inicializa (`useFactory` sin
 * `.initialize()`): la conexión se abre de forma perezosa desde
 * `CandidatosStoreService` cuando el módulo se usa por primera vez. Motivos
 * dobles: (1) el arranque de la API no depende de que PostgreSQL esté disponible
 * y no se abre una segunda conexión sin necesidad; (2) los tests e2e siguen
 * siendo herméticos — `AppModule` arranca sin tocar la BD. Por eso NO se usa
 * `TypeORMModule.forRootAsync`, que inicializa en el bootstrap.
 * `synchronize: false` es innegociable: el esquema lo dictan las migraciones de
 * `apps/api/db/migrations` (la 005 crea `candidatos`).
 *
 * `CryptoService` (cifrado AES-256-CBC) y `DatabaseService`/`ConfigService` son
 * globales, así que se inyectan aquí sin importar sus módulos.
 * `SearchHashService` es específico de este módulo y se declara como provider.
 *
 * `UploadsModule` (Fase 4, parte 2) se IMPORTA para que el controlador pueda
 * inyectar `ArchivosCvService` y servir los endpoints de archivos del candidato
 * (`POST/GET /:id/archivos/...`). La dependencia es UNIDIRECCIONAL
 * (candidatos → uploads): `UploadsModule` NO importa este módulo porque
 * `archivos_cv` se gestiona con el pool `pg` global (`DatabaseService`) y no
 * con este `DataSource`, de forma que no hay ciclo de módulos.
 */
@Module({
  imports: [UploadsModule],
  controllers: [CandidatosController],
  providers: [
    CandidatosStoreService,
    // Hash de búsqueda HMAC-SHA-256 de la cédula (permite filtrar SIN descifrar).
    SearchHashService,
    // Capa CRUD: orquesta store + cifrado + hash y expone los casos de uso.
    CandidatosService,
    {
      provide: DataSource,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DataSource =>
        new DataSource({
          type: 'postgres',
          url: config.getOrThrow('DATABASE_URL'),
          entities: [Candidato],
          synchronize: false,
        }),
    },
  ],
  exports: [CandidatosStoreService, SearchHashService],
})
export class CandidatosModule {}
