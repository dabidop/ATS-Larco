import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from './auth.guard';

/**
 * Guard global de AUTORIZACIÓN (RBAC), registrado con `APP_GUARD` en
 * `AppModule` DESPUÉS de `AuthGuard`: primero se identifica al usuario,
 * después se comprueba si su rol puede acceder.
 *
 * Comportamiento:
 * - Sin `@Roles(...)` → pasa (la ruta solo exigía estar autenticado, ya
 *   garantizado por `AuthGuard`).
 * - Con `@Roles(...)`: `request.user.role` en la lista → pasa; fuera → 403.
 * - Sin `request.user` (no debería ocurrir: `AuthGuard` corre primero) → 401.
 *
 * Como `AuthGuard` es stateless (sin consulta a BD), este guard tampoco la
 * consulta: decide sobre el claim `role` del JWT vigente.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Los roles pueden declararse en el handler o en la clase controlador;
    // el handler manda (getAllAndOverride: handler → clase).
    const rolesPermitidos = this.reflector.getAllAndOverride<readonly string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Sin @Roles la ruta solo requiere autenticación → ya pasó AuthGuard.
    if (rolesPermitidos === undefined || rolesPermitidos.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user === undefined) {
      // Fallo interno: AuthGuard debió fijar el usuario antes de llegar aquí.
      throw new UnauthorizedException('No autenticado: se requiere un token Bearer válido');
    }

    if (!rolesPermitidos.includes(user.role)) {
      throw new ForbiddenException('No tienes permiso para realizar esta acción');
    }

    return true;
  }
}
