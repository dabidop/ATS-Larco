# db/ — Migraciones versionadas (node-pg-migrate)

Este directorio **no** forma parte del `tsconfig.json` de la API a propósito: las
migraciones no se compilan ni se empaquetan con el `dist` de Nest. Se escriben en
TypeScript y las transpila [jiti](https://github.com/unjs/jiti) en tiempo de
ejecución (node-pg-migrate ≥ 9 soporta `.ts` de forma nativa), por lo que no hace
falta ts-node/tsx ni un runner propio.

## Uso

```bash
# Aplica todas las migraciones pendientes
pnpm --filter @ats/api db:migrate

# Revierte la última migración aplicada (repetir hasta llegar a 0)
pnpm --filter @ats/api db:migrate:down

# Crea una plantilla nueva
pnpm --filter @ats/api db:migrate:create nombre_de_la_migracion
```

Los scripts cargan el `.env` de la **raíz** del repo con
`node --env-file-if-exists=../../.env` (Node ≥ 22.9), así que funcionan igual en
PowerShell/Windows y en Linux/macOS. La conexión sale de `DATABASE_URL`.

## Convenciones

- Prefijo numérico obligatorio (`001_`, `002_`, ...): node-pg-migrate ordena por
  ese prefijo y lo registra en la tabla `public.pgmigrations`.
- Cada migración exporta `up(pgm)` y `down(pgm)`; **todo es reversible** (los
  `down` se prueban, no se improvisan).
- Nombres en inglés (tablas, columnas, funciones, triggers); comentarios en español.
- Semilla determinista: la migración `002` inserta los roles base y el usuario
  admin inicial (`admin@larco.co`), cuyo hash se genera con
  `hashPassword(process.env.ADMIN_INITIAL_PASSWORD)` (scrypt, módulo
  `apps/api/src/common/crypto/password.util.ts`). Sin esa variable de entorno la
  migración falla con un mensaje accionable y no aplica nada.

## Regla dura del proyecto: "la base de datos manda"

`audit_log` es **inmutable**: los triggers `BEFORE UPDATE` y `BEFORE DELETE`
(`audit_log_no_mutation`) lanzan excepción. Ningún cliente puede modificar ni
borrar registros de auditoría; solo se crean mediante `INSERT` desde los
triggers de la propia BD.
