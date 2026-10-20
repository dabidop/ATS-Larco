import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AppLoggerModule } from './logging/logger.module';
import { AntecedentesModule } from './modules/antecedentes/antecedentes.module';
import { AuthModule } from './modules/auth/auth.module';
import { CandidatosModule } from './modules/candidatos/candidatos.module';
import { EmbudoModule } from './modules/embudo/embudo.module';
import { EntrevistasModule } from './modules/entrevistas/entrevistas.module';
import { HistorialModule } from './modules/historial/historial.module';
import { ImportacionModule } from './modules/importacion/importacion.module';
import { ProveedorModule } from './modules/proveedor/proveedor.module';
import { RequerimientosModule } from './modules/requerimientos/requerimientos.module';
import { UploadsModule } from './modules/uploads/uploads.module';

/**
 * Módulo raíz de la API (Fase 1).
 *
 * Orden de los imports: primero la infraestructura (configuración validada,
 * logging, base de datos), después los módulos de negocio.
 *
 * Guards globales (Fase 2, parte 2) — orden del array `providers` IMPORTA:
 * `AuthGuard` (autenticación) PRIMERO y `RolesGuard` (autorización/RBAC)
 * DESPUÉS, porque sin identidad no se puede autorizar.
 *
 * Matriz RBAC inicial:
 * | Ruta                                  | Acceso                                |
 * |---------------------------------------|---------------------------------------|
 * | GET /api/health                       | @Public()                             |
 * | POST /api/auth/login                  | @Public()                             |
 * | GET /api/auth/ping                    | @Public()                             |
 * | POST /api/auth/logout                 | autenticado (cualquier rol)           |
 * | POST /api/auth/refresh                | autenticado (cualquier rol)           |
 * | GET /api/auth/me                      | autenticado (cualquier rol)           |
 * | GET /api/auth|candidatos|embudo|antecedentes|entrevistas|proveedor|historial/ping | autenticado (sin @Roles) |
 * | GET /api/requerimientos/ping          | @Roles('admin_rrhh', 'lider_area')    |
 * | GET /api/importacion/ping             | @Roles('admin_rrhh', 'analista_seleccion') |
 * | GET /api/uploads/ping                 | @Roles('admin_rrhh', 'analista_seleccion') |
 *
 * Toda ruta NO marcada con `@Public()` exige JWT válido; sin `@Roles(...)`
 * basta con estar autenticado.
 */
@Module({
  imports: [
    // Infraestructura
    AppConfigModule,
    AppLoggerModule,
    DatabaseModule,
    // Salud
    HealthModule,
    // Módulos de negocio (andamiaje Fase 1)
    AuthModule,
    CandidatosModule,
    EmbudoModule,
    AntecedentesModule,
    EntrevistasModule,
    ProveedorModule,
    HistorialModule,
    UploadsModule,
    RequerimientosModule,
    ImportacionModule,
  ],
  providers: [
    // Todas las respuestas de error usan el mismo formato JSON.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Guards globales: PRIMERO autenticación, DESPUÉS autorización (el orden
    // del array determina el orden de ejecución de los APP_GUARD).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
