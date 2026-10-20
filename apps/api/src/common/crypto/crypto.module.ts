import { Global, Module } from '@nestjs/common';

import { CryptoService } from './crypto.service';

/**
 * Módulo global de cifrado de PII (Fase 2, parte 3).
 *
 * `@Global` + exportación de `CryptoService` hace que el servicio sea
 * inyectable en cualquier módulo sin importarlo (mismo patrón que
 * `DatabaseModule`). Como todo módulo global, se registra UNA sola vez en el
 * `AppModule` (el decorador `@Global` solo elimina la necesidad de importarlo
 * en los demás módulos; no lo auto-registra).
 *
 * Las llaves NO se leen aquí: `CryptoService` inyecta `ConfigService` y
 * decodifica `CRYPTO_KEY_BASE64`/`CRYPTO_KEY_PREVIOUS_BASE64` ya validadas
 * por zod en el arranque (fallo temprano si la configuración es incorrecta).
 */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
