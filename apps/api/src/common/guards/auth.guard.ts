import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Usuario verificado que `AuthGuard` inyecta en `request.user`. */
export interface AuthenticatedUser {
  sub: string;
  email: string;
  /** Código de rol (`roles.code`); puede no estar contemplado en el RBAC actual. */
  role: string;
}

/** Request de Express ampliado con el usuario verificado por `AuthGuard`. */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/** Extrae el token de `Authorization: Bearer <jwt>` (prefijo "Bearer" sin distinguir mayúsculas). */
function extraerTokenBearer(authorization: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  return match?.[1];
}

/** Comprueba que el payload decodificado tiene los tres claims de negocio. */
function esPayloadValido(payload: Partial<AuthenticatedUser> | null): payload is AuthenticatedUser {
  return (
    payload !== null &&
    typeof payload.sub === 'string' &&
    typeof payload.email === 'string' &&
    typeof payload.role === 'string'
  );
}

/**
 * Guard global de AUTENTICACIÓN (registrado con `APP_GUARD` en `AppModule`,
 * ANTES que `RolesGuard`: sin identidad no tiene sentido autorizar).
 *
 * Comportamiento:
 * - Ruta con `@Public()` → pasa sin mirar el token.
 * - Sin header `Authorization` (o sin el prefijo Bearer) → 401.
 * - Token firmado con `JWT_SECRET` y no expirado → `request.user = { sub, email, role }`.
 * - Token inválido, con firma ajena o expirado → 401 (mismo 401 genérico en
 *   los tres casos: no se distingue el motivo al cliente).
 *
 * DECISIÓN: guard ESTADO SIN consulta a la base de datos. El JWT es firmado
 * (HS256) y con TTL corto (`JWT_TTL_HOURS`, 24 h), así que verificar firma +
 * exp es suficiente para las rutas: cero latencia de BD y los guards siguen
 * funcionando si la BD está caída. Implicación (revocación diferida): un
 * token emitido sigue siendo válido hasta `exp` aunque el usuario se desactive
 * o se borre; la revocación efectiva es diferida (máximo 24 h). Por eso
 * `refresh`/`me` SÍ releen la BD (comprueban que el usuario sigue activo) y
 * el logout solo emite el evento: el cliente descarta su token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Rutas públicas (@Public): pasan sin verificar nada.
    const esPublica =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    if (esPublica) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const token = extraerTokenBearer(request.headers.authorization);
    if (token === undefined) {
      throw new UnauthorizedException('No autenticado: se requiere un token Bearer válido');
    }

    let payload: Partial<AuthenticatedUser>;
    try {
      payload = this.jwtService.verify<Partial<AuthenticatedUser>>(token);
    } catch {
      // Firma incorrecta, token expirado o malformado: 401 genérico.
      throw new UnauthorizedException('No autenticado: token inválido o expirado');
    }

    if (!esPayloadValido(payload)) {
      // Firma correcta pero claims inesperados: no se puede identificar al usuario.
      throw new UnauthorizedException('No autenticado: token inválido o expirado');
    }

    request.user = { sub: payload.sub, email: payload.email, role: payload.role };
    return true;
  }
}
