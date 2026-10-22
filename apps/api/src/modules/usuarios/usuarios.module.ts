import { Module } from '@nestjs/common';

import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

/**
 * Módulo de USUARIOS — gestión de cuentas, roles y contraseñas (Etapa 8B).
 *
 * EXCLUSIVO del `superusuario` (IT, migración 008): RRHH NO gestiona usuarios,
 * el 4.º rol hereda todo el poder de `admin_rrhh` sobre el negocio pero la
 * administración de cuentas es suya en exclusiva.
 *
 * Persistencia con el pool `pg` GLOBAL (`DatabaseService`), igual que `embudo`,
 * y NO con TypeORM: `users`/`roles` son tablas autocontenidas de la migración
 * 001, así que el módulo no necesita DataSource propio ni importar otros
 * módulos de negocio (sin ciclos).
 */
@Module({
  controllers: [UsuariosController],
  providers: [UsuariosService],
})
export class UsuariosModule {}
