import { Global, Module } from '@nestjs/common';

import { DatabaseService } from './database.service';

/**
 * Módulo global de base de datos. Provee `DatabaseService` (pool `pg`
 * singleton) a todos los módulos de negocio sin que tengan que importarlo.
 *
 * Sin TypeORM en esta fase: acceso directo con `pg`. Las migraciones viven en
 * `apps/api/db/` (fuera del typecheck de la API a propósito).
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
