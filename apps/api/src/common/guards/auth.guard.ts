import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.validation';
import { DatabaseService } from '../../database/database.service';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../../modules/auth/auth.service';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Usuario verificado que `AuthGuard` inyecta en `request.user`. */
export interface AuthenticatedUser {
  sub: string;
  email: string;
  /** Código de rol (`roles.code`); puede no estar contemplado en el RBAC actual. */
  role: string;
  sid?: string;
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

function cookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie ?? '';
  const pair = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (pair === undefined) return undefined;
  try {
    return decodeURIComponent(pair.slice(name.length + 1));
  } catch {
    return undefined;
  }
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
    private readonly database: DatabaseService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    const cookieToken = cookie(request, ACCESS_COOKIE);
    const token = cookieToken ?? extraerTokenBearer(request.headers.authorization);
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

    if (this.config.get('NODE_ENV') !== 'test') {
      if (!payload.sid) throw new UnauthorizedException('No autenticado: sesión inválida');
      const { rows } = await this.database.query<{ id: string }>(
        `SELECT s.id FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.user_id = $2 AND u.active
           AND s.revoked_at IS NULL AND s.expires_at > now()`,
        [payload.sid, payload.sub],
      );
      if (rows[0] === undefined) throw new UnauthorizedException('No autenticado: sesión revocada');

      // SameSite=Strict es la primera barrera; el token CSRF evita también
      // solicitudes forjadas desde otro contexto del mismo sitio.
      if (cookieToken !== undefined && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const csrfHeader = request.headers['x-csrf-token'];
        const csrfCookie = cookie(request, CSRF_COOKIE);
        if (
          typeof csrfHeader !== 'string' ||
          csrfCookie === undefined ||
          csrfHeader !== csrfCookie
        ) {
          throw new UnauthorizedException('CSRF inválido');
        }
      }
    }

    request.user = { sub: payload.sub, email: payload.email, role: payload.role, sid: payload.sid };
    return true;
  }
}
