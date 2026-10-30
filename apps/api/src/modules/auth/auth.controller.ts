import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';

import { Public } from '../../common/decorators/public.decorator';
import {
  AuthService,
  ACCESS_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  type AuthUser,
  type AuthSessionCookies,
  type LoginResponse,
} from './auth.service';
import { LoginRequestDto } from './dto/login.request';
import type { Env } from '../../config/env.validation';

/**
 * Endpoints de autenticación (Fase 2): login, logout, refresh y me.
 *
 * Protección (matriz RBAC): `login` y `ping` son `@Public()`; `logout`,
 * `logout` y `me` están protegidos por el guard global. `refresh` es público
 * para permitir que funcione después de expirar el access token, pero exige
 * el refresh cookie opaco y la prueba CSRF.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly logger: Logger,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * `POST /api/auth/login` — credenciales → cookies HttpOnly de sesión.
   * Ruta PÚBLICA: el guard no exige token (lo que se pide son credenciales).
   *
   * Rate limiting anti fuerza bruta (Fase 2, parte 4): máx. 5 intentos por
   * minuto por IP, más estricto que el límite global (100/min). El decorator
   * `@Throttle` prevalece sobre la config del módulo para ESTE handler.
   * `ttl` en milisegundos: throttler v6 solo acepta números (no '1m').
   * Sin `skipSuccessfulRequests`: se cuenta también el éxito, para no abrir
   * una ventana de fuerza bruta tras cada login correcto (simplicidad).
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK) // Un POST respondería 201 por defecto; login debe devolver 200.
  async login(
    @Body() dto: LoginRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(dto.email, dto.password);
    this.setCookies(response, result.cookies);
    return this.publicResponse(result);
  }

  /**
   * `POST /api/auth/logout` → 204 (requiere JWT: guard global `AuthGuard`).
   *
   * Revoca la sesión en servidor y limpia las cookies. Nunca se loguea ningún
   * token, solo si venía incluido en la petición.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Headers('authorization') authorization: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(
      authorization ?? this.bearerFromCookie(request, ACCESS_COOKIE),
      this.cookie(request, REFRESH_COOKIE),
    );
    this.clearCookies(response);
    // `log` de LoggerService (nestjs-pino) equivale al nivel info de pino.
    this.logger.log(
      { tokenPresent: /^Bearer\s+\S+$/.test(authorization ?? '') },
      'Logout: sesión revocada',
      'AuthController',
    );
  }

  /**
   * `POST /api/auth/refresh` — refresh cookie válido → pareja de cookies nueva.
   * No necesita access token vigente; la sesión y el usuario se validan dentro
   * de una transacción en `AuthService`.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    this.assertCsrf(request);
    const result = await this.authService.refresh(this.cookie(request, REFRESH_COOKIE));
    this.setCookies(response, result.cookies);
    return this.publicResponse(result);
  }

  /**
   * `GET /api/auth/me` — usuario del token actual (401 si no hay sesión válida).
   * Protegido por `AuthGuard` y además revalidado contra la BD (usuario activo).
   */
  @Get('me')
  me(
    @Headers('authorization') authorization: string | undefined,
    @Req() request: Request,
  ): Promise<AuthUser> {
    return this.authService.me(authorization ?? this.bearerFromCookie(request, ACCESS_COOKIE));
  }

  /** Ruta de andamiaje de la Fase 1: se mantiene PÚBLICA (prueba de vida del módulo). */
  @Public()
  @Get('ping')
  ping() {
    return { modulo: 'auth', status: 'placeholder' } as const;
  }

  private publicResponse(result: LoginResponse & { cookies: AuthSessionCookies }): LoginResponse {
    const { cookies: _cookies, ...body } = result;
    return body;
  }

  private setCookies(response: Response, cookies: AuthSessionCookies): void {
    const secure = this.config.get('NODE_ENV') === 'production';
    const base = { httpOnly: true, secure, sameSite: 'strict' as const };
    response.cookie(ACCESS_COOKIE, cookies.accessToken, {
      ...base,
      maxAge: this.config.getOrThrow('ACCESS_TOKEN_TTL_MINUTES') * 60 * 1000,
      path: '/',
    });
    response.cookie(REFRESH_COOKIE, cookies.refreshToken, {
      ...base,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });
    // CSRF no es HttpOnly: el cliente solo lo copia a X-CSRF-Token y no es un
    // secreto de autenticación.
    response.cookie(CSRF_COOKIE, cookies.csrfToken, {
      httpOnly: false,
      secure,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  private clearCookies(response: Response): void {
    response.clearCookie(ACCESS_COOKIE, { path: '/' });
    response.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    response.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  private cookie(request: Request, name: string): string | undefined {
    const pair = (request.headers.cookie ?? '')
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

  private bearerFromCookie(request: Request, name: string): string | undefined {
    const value = this.cookie(request, name);
    return value === undefined ? undefined : `Bearer ${value}`;
  }

  private assertCsrf(request: Request): void {
    const header = request.headers['x-csrf-token'];
    const cookie = this.cookie(request, CSRF_COOKIE);
    if (typeof header !== 'string' || cookie === undefined || header !== cookie) {
      throw new UnauthorizedException('CSRF inválido');
    }
  }
}
