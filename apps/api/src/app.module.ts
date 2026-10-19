import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
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
  ],
})
export class AppModule {}
