import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { verifyPassword } from '../../common/crypto/password.util';
import type { Env } from '../../config/env.validation';
import { DatabaseService } from '../../database/database.service';

/**
 * Servicio de autenticación (Fase 2, parte 1): login, refresh y consulta del
 * usuario actual mediante JWT firmados con `JWT_SECRET` y vigencia
 * `JWT_TTL_HOURS` (por defecto 24 h).
 *
 * Los guards de protección de rutas NO están aquí: llegan en la parte 2.
 */

/** Único mensaje de fallo de login (anti user-enumeration: nunca se revela si el usuario existe). */
const LOGIN_FAILED_MESSAGE = 'Credenciales inválidas';

/**
 * Único mensaje para cualquier fallo de sesión en `refresh`/`me`: token
 * ausente, malformado, firmado con otra clave, expirado o usuario borrado/
 * desactivado. Genérico a propósito: no se filtra el estado de la cuenta.
 */
const NOT_AUTHENTICATED_MESSAGE = 'No autenticado';

/**
 * Hash ficticio (contraseña que nadie conoce) usado cuando el usuario NO
 * existe o está inactivo, para que el coste de `scrypt` —y por tanto el tiempo
 * de respuesta— sea el MISMO que en un fallo de contraseña correcta. Sin esto,
 * un atacante podría distinguir usuarios existentes por la latencia.
 * Formato: scrypt$N$r$p$salt_b64$hash_b64 (ver `password.util`).
 */
const TIMING_DECOY_HASH =
  'scrypt$16384$8$1$Nt9wqPDRYBml3M/c0jaJuA==$wexKhoe5aOxye3Yp79yZONKftNFfEhWbFgKCwWYSG1psA3/piyrYaJFwZyhr+qZDWD9er0GXHf7m8igQLyVKag==';

/**
 * Claims de negocio del JWT: `sub` + lo imprescindible, sin más PII.
 * A estos claims jsonwebtoken añade `iat`/`exp` y el `jti` de emisión.
 */
export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

/** Usuario autenticado que se expone en login, refresh y me. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  /** Jefatura asignada; se usa para precargar requerimientos de líderes. */
  jefatura: string | null;
}

/** Respuesta de `POST /auth/login` y `POST /auth/refresh`. */
export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  /** Segundos que quedan hasta que el access token expire. */
  expiresIn: number;
  user: AuthUser;
}

/** Fila de `users` JOIN `roles` tal y como sale del SELECT. */
interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  active: boolean;
  /** `roles.code` (p. ej. admin_rrhh). */
  role: string;
  jefatura: string | null;
}

/** Búsqueda por email sin distinguir mayúsculas de minúsculas. */
const SELECT_BY_EMAIL = `
  SELECT u.id, u.email, u.password_hash, u.full_name, u.active, r.code AS role, u.jefatura
  FROM users u
  JOIN roles r ON r.id = u.role_id
  WHERE LOWER(u.email) = LOWER($1)
`;

/** Búsqueda por id (refresh y me: el usuario debe seguir activo). */
const SELECT_BY_ID = `
  SELECT u.id, u.email, u.password_hash, u.full_name, u.active, r.code AS role, u.jefatura
  FROM users u
  JOIN roles r ON r.id = u.role_id
  WHERE u.id = $1
`;

/** Convierte la fila de BD en el usuario público de la API. */
function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    jefatura: user.jefatura,
  };
}

/** Comprueba que el payload decodificado tiene los tres campos esperados. */
function isJwtPayload(payload: Partial<JwtPayload>): payload is JwtPayload {
  return (
    typeof payload.sub === 'string' &&
    typeof payload.email === 'string' &&
    typeof payload.role === 'string'
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Valida credenciales y emite un access token.
   *
   * Anti user-enumeration: usuario inexistente, usuario inactivo y contraseña
   * incorrecta producen SIEMPRE el mismo 401 (`Credenciales inválidas`, mismo
   * cuerpo), de modo que la respuesta no revela si el email está registrado.
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    const { rows } = await this.database.query<UserRow>(SELECT_BY_EMAIL, [email]);
    const user = rows[0];

    if (user === undefined || !user.active) {
      // Usuario inexistente o inactivo: se verifica contra el hash ficticio
      // para que la latencia (scrypt) sea IGUAL que en un fallo de contraseña.
      // Así la respuesta no revela, ni por el mensaje ni por el tiempo, si el
      // email está registrado.
      await verifyPassword(password, TIMING_DECOY_HASH);
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE);
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      throw new UnauthorizedException(LOGIN_FAILED_MESSAGE);
    }

    return this.issueLoginResponse(user);
  }

  /**
   * Intercambia un Bearer válido por uno nuevo con `exp` renovado y el mismo
   * usuario (releído de la base de datos para comprobar que sigue activo).
   */
  async refresh(authorization: string | undefined): Promise<LoginResponse> {
    const payload = this.verifyBearerToken(authorization);
    const user = await this.findActiveUser(payload.sub);
    return this.issueLoginResponse(user);
  }

  /** Usuario del token actual (401 si el token no vale o el usuario ya no está activo). */
  async me(authorization: string | undefined): Promise<AuthUser> {
    const payload = this.verifyBearerToken(authorization);
    const user = await this.findActiveUser(payload.sub);
    return toAuthUser(user);
  }

  /**
   * Lee y verifica el header `Authorization: Bearer <jwt>` directamente con
   * `JwtService.verify` (sin guards: esa capa llega en la parte 2).
   * Cualquier problema → 401 con mensaje genérico.
   */
  private verifyBearerToken(authorization: string | undefined): JwtPayload {
    const match = /^Bearer\s+(\S+)$/.exec(authorization ?? '');
    const token = match?.[1];
    if (token === undefined) {
      throw new UnauthorizedException(NOT_AUTHENTICATED_MESSAGE);
    }

    let payload: Partial<JwtPayload>;
    try {
      payload = this.jwtService.verify<Partial<JwtPayload>>(token);
    } catch {
      // Firma incorrecta, token expirado o malformado: mismo 401 genérico.
      throw new UnauthorizedException(NOT_AUTHENTICATED_MESSAGE);
    }

    if (!isJwtPayload(payload)) {
      throw new UnauthorizedException(NOT_AUTHENTICATED_MESSAGE);
    }
    return payload;
  }

  /** Carga el usuario por `sub` y exige que siga `active`. */
  private async findActiveUser(id: string): Promise<UserRow> {
    const { rows } = await this.database.query<UserRow>(SELECT_BY_ID, [id]);
    const user = rows[0];
    if (user === undefined || !user.active) {
      throw new UnauthorizedException(NOT_AUTHENTICATED_MESSAGE);
    }
    return user;
  }

  /** Firma el payload mínimo y construye la respuesta estándar de sesión. */
  private issueLoginResponse(user: UserRow): LoginResponse {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };

    // `jwtid` añade un `jti` (UUID) único POR EMISIÓN: sin un claim variable,
    // dos tokens emitidos en el mismo segundo (login y refresh casi seguidos)
    // serían idénticos byte a byte, y refresh debe devolver SIEMPRE un token
    // nuevo. El `jti` es un identificador de token, no PII.
    const accessToken = this.jwtService.sign(payload, { jwtid: randomUUID() });

    return {
      accessToken,
      tokenType: 'Bearer',
      // Misma configuración que `signOptions.expiresIn` del JwtModule (h → s).
      expiresIn: this.config.getOrThrow('JWT_TTL_HOURS') * 3600,
      user: toAuthUser(user),
    };
  }
}
