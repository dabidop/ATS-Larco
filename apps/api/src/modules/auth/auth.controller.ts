import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';

import { Public } from '../../common/decorators/public.decorator';
import { AuthService, type AuthUser, type LoginResponse } from './auth.service';
import { LoginRequestDto } from './dto/login.request';

/**
 * Endpoints de autenticación (Fase 2): login, logout, refresh y me.
 *
 * Protección (matriz RBAC): `login` y `ping` son `@Public()`; `logout`,
 * `refresh` y `me` están protegidos por el guard global `AuthGuard` (sin
 * `@Roles(...)`: basta con estar autenticado). `refresh`/`me` además RE-LEEN
 * el header y la base de datos (comprueban que el usuario sigue activo),
 * porque el guard es stateless y no puede detectar cuentas desactivadas.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly logger: Logger,
  ) {}

  /**
   * `POST /api/auth/login` — credenciales → JWT de `JWT_TTL_HOURS` horas.
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
  login(@Body() dto: LoginRequestDto): Promise<LoginResponse> {
    return this.authService.login(dto.email, dto.password);
  }

  /**
   * `POST /api/auth/logout` → 204 (requiere JWT: guard global `AuthGuard`).
   *
   * JWT stateless: no hay sesión en servidor que invalidar. El cliente es
   * quien descarta el accessToken (y el refresh token si lo guarda); aquí solo
   * se registra el evento para observabilidad/auditoría. Nunca se loguea el
   * token, solo si venía incluido en la petición.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Headers('authorization') authorization?: string): void {
    // `log` de LoggerService (nestjs-pino) equivale al nivel info de pino.
    this.logger.log(
      { tokenPresent: /^Bearer\s+\S+$/.test(authorization ?? '') },
      'Logout: el cliente descarta su JWT (sesión stateless)',
      'AuthController',
    );
  }

  /**
   * `POST /api/auth/refresh` — Bearer válido → token nuevo con exp renovado.
   * Protegido por `AuthGuard` y además revalidado contra la BD (usuario activo).
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Headers('authorization') authorization?: string): Promise<LoginResponse> {
    return this.authService.refresh(authorization);
  }

  /**
   * `GET /api/auth/me` — usuario del token actual (401 si no hay sesión válida).
   * Protegido por `AuthGuard` y además revalidado contra la BD (usuario activo).
   */
  @Get('me')
  me(@Headers('authorization') authorization?: string): Promise<AuthUser> {
    return this.authService.me(authorization);
  }

  /** Ruta de andamiaje de la Fase 1: se mantiene PÚBLICA (prueba de vida del módulo). */
  @Public()
  @Get('ping')
  ping() {
    return { modulo: 'auth', status: 'placeholder' } as const;
  }
}
