import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AuthService, type AuthUser, type LoginResponse } from './auth.service';
import { LoginRequestDto } from './dto/login.request';

/**
 * Endpoints de autenticación (Fase 2, parte 1): login, logout, refresh y me.
 *
 * ATENCIÓN: todavía NO hay guards de protección (llegan en la parte 2), así
 * que estos endpoints —y el resto de rutas— están abiertos hasta ese commit.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly logger: Logger,
  ) {}

  /** `POST /api/auth/login` — credenciales → JWT de `JWT_TTL_HOURS` horas. */
  @Post('login')
  @HttpCode(HttpStatus.OK) // Un POST respondería 201 por defecto; login debe devolver 200.
  login(@Body() dto: LoginRequestDto): Promise<LoginResponse> {
    return this.authService.login(dto.email, dto.password);
  }

  /**
   * `POST /api/auth/logout` → 204.
   *
   * JWT stateless: no hay sesión en el servidor que invalidar. El cliente es
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

  /** `POST /api/auth/refresh` — Bearer válido → token nuevo con exp renovado. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Headers('authorization') authorization?: string): Promise<LoginResponse> {
    return this.authService.refresh(authorization);
  }

  /** `GET /api/auth/me` — usuario del token actual (401 si no hay sesión válida). */
  @Get('me')
  me(@Headers('authorization') authorization?: string): Promise<AuthUser> {
    return this.authService.me(authorization);
  }

  /** Ruta de andamiaje de la Fase 1: se mantiene sin cambios. */
  @Get('ping')
  ping() {
    return { modulo: 'auth', status: 'placeholder' } as const;
  }
}
