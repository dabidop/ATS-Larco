import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';
import { DataSource } from 'typeorm';

import { Requerimiento } from './requerimiento.entity';

/**
 * Acceso a la persistencia de `requerimientos` (patrón "store").
 *
 * Inicialización LAZY a propósito:
 *  - El `DataSource` que registra `RequerimientosModule` solo se CONSTRUYE al
 *    arrancar (sin `.initialize()`), así que no se abre una SEGUNDA conexión a
 *    PostgreSQL hasta que alguien usa este módulo por primera vez.
 *  - Los tests e2e siguen siendo herméticos: `AppModule` arranca sin tocar
 *    ninguna base de datos (los tests sustituyen el `DataSource` por un doble y
 *    los que no lo sustituyen no llegan a inicializarlo, porque nada lo usa).
 *  - `TypeORMModule.forRootAsync` se descartó precisamente porque inicializa
 *    la conexión durante el bootstrap.
 *
 * El esquema lo dictan las migraciones de `apps/api/db/migrations`
 * (`synchronize: false`): TypeORM solo lee y escribe, nunca altera el esquema.
 *
 * Esta clase SOLO encapsula el acceso —repositorio y transacciones—; la lógica
 * de CRUD vive en la capa de servicio (parte 2 de la Fase 3).
 */
@Injectable()
export class RequerimientosStoreService implements OnModuleDestroy {
  /**
   * Inicialización en curso. Evita que dos peticiones concurrentes entren a la
   * vez en `initialize()`: TypeORM lanza `CannotConnectAlreadyConnectedError`
   * (o duplicaría el pool) si se llama dos veces.
   */
  private initEnCurso: Promise<unknown> | null = null;

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Repositorio de `requerimientos` con inicialización perezosa.
   *
   * PÚBLICO a propósito: es el acceso que consumirá la capa CRUD (parte 2) y
   * el que usan los tests para comprobar el arranque lazy, sin exponer el
   * `DataSource` fuera de esta clase.
   */
  async repo(): Promise<Repository<Requerimiento>> {
    await this.inicializar();
    return this.dataSource.getRepository(Requerimiento);
  }

  /**
   * Ejecuta `fn` dentro de una transacción de TypeORM: el `EntityManager` que
   * recibe `fn` es el de la transacción (rollback automático si `fn` rechaza).
   */
  async withTransaction<T>(fn: (em: EntityManager) => Promise<T>): Promise<T> {
    await this.inicializar();
    return this.dataSource.transaction(fn);
  }

  /**
   * Cierra la conexión SOLO si alguien la abrió: `destroy()` lanza
   * `CannotExecuteNotConnectedError` sobre un DataSource no inicializado y, en
   * un arranque en el que el módulo no se ha usado, no hay nada que cerrar.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  /** Inicializa el `DataSource` una sola vez, también ante llamadas concurrentes. */
  private async inicializar(): Promise<void> {
    if (this.dataSource.isInitialized) {
      return;
    }
    if (!this.initEnCurso) {
      // `finally` limpia el estado tanto si conecta como si falla, para poder
      // reintentar en el siguiente uso.
      this.initEnCurso = this.dataSource.initialize().finally(() => {
        this.initEnCurso = null;
      });
    }
    await this.initEnCurso;
  }
}
