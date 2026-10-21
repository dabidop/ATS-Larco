import { Module } from '@nestjs/common';

import { EmbudoController } from './embudo.controller';
import { PostulacionesController } from './postulaciones.controller';
import { PostulacionesService } from './postulaciones.service';

/**
 * Módulo del embudo de selección (Fase 5, parte backend).
 *
 * Dos controladores con responsabilidades separadas:
 *
 *  - `EmbudoController` (`GET /api/embudo/ping`): andamiaje de la Fase 1, SIN
 *    cambios, porque lo consume `modules.e2e.test.ts`.
 *  - `PostulacionesController` (`/api/postulaciones`): el API REAL del embudo
 *    — crear, listar, detalle, mover de fase (un paso adyacente), descartar con
 *    motivo obligatorio e historial desde `audit_log`.
 *
 * Persistencia con el pool `pg` GLOBAL (`DatabaseService`) y la transacción
 * con GUC `app.current_user_id` de `PostulacionesService`: `postulaciones` es
 * una tabla AUTOCONTENIDA (dos FK + estado del embudo), así que el módulo NO
 * importa a `CandidatosModule` ni a `RequerimientosModule` —evita ciclos— y
 * no necesita DataSource de TypeORM propio.
 */
@Module({
  controllers: [EmbudoController, PostulacionesController],
  providers: [PostulacionesService],
})
export class EmbudoModule {}
