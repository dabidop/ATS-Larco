# Operación básica y CI

Este documento describe verificaciones reproducibles para staging/desarrollo. No
crea un despliegue de producción ni contiene credenciales.

## CI

`.github/workflows/ci.yml` usa Node 24, pnpm 12.14.0 y
`pnpm install --frozen-lockfile`. Levanta PostgreSQL 16 como servicio efímero,
aplica las migraciones 001–022 en una base y usuario sintéticos con nombres
`ats_pg16_test_<run>` y `ats_test_<run>`, y usa únicamente valores sintéticos.
`UPLOAD_DIR` apunta a un directorio temporal del runner.

El pipeline ejecuta build de `@ats/shared`, typecheck, lint, formato, tests y
build. El E2E de navegador no se ejecuta porque requiere un navegador y
servicios HTTP; queda pendiente de un runner/entorno explícito. Los demás tests
de API reciben `DATABASE_URL` del job, por lo que no cargan ni modifican la BD
de desarrollo. El job independiente `integration-pg16` ejecuta de verdad
`apps/api/test/postgres16-concurrencia.e2e.test.ts` contra PostgreSQL 16 y valida
las carreras C4/C9 (5/5); sus variables de activación solo existen en ese job.
El workflow no contiene pasos de release o publicación.

Para comprobar el bloqueo sin publicar nada, ejecutar el workflow manualmente
con `prove_failure_gate=true`; el job `failure-gate` debe quedar rojo. No se
debe usar esa entrada como una ejecución normal.

## Arranque y migración de staging

Desde el servidor, con `.env.staging` fuera del repositorio y permisos
restringidos, validar y migrar antes de levantar API/web:

El operador debe exportar `BACKUP_DIR_HOST` con la ruta absoluta suministrada
para los backups y preparar sus permisos (`install -d -m 750
"$BACKUP_DIR_HOST"`). El `env_file` del servicio no sirve para interpolar esa
variable en Compose; debe estar en el entorno del shell o en el archivo pasado
con `--env-file`. Repetir la asignación explícita en cada comando:

```bash
BACKUP_DIR_HOST="$BACKUP_DIR_HOST" docker compose --env-file .env.staging -f docker-compose.staging.yml config --quiet
BACKUP_DIR_HOST="$BACKUP_DIR_HOST" docker compose --env-file .env.staging -f docker-compose.staging.yml build --pull
BACKUP_DIR_HOST="$BACKUP_DIR_HOST" docker compose --env-file .env.staging -f docker-compose.staging.yml --profile migration run --rm migrate
BACKUP_DIR_HOST="$BACKUP_DIR_HOST" docker compose --env-file .env.staging -f docker-compose.staging.yml up -d db api web
curl --fail https://<gateway>/api/health/live
curl --fail https://<gateway>/api/health/ready
```

`live` comprueba el proceso; `ready` comprueba PostgreSQL y devuelve error 503
si la base no responde. No continuar si un healthcheck está `unhealthy`.

## CV, backups y límites

Antes de una actualización, revisar el volumen de CV y tomar backup según la
política del servidor. Preparar previamente `BACKUP_DIR_HOST` como ruta absoluta
del operador, con permisos restringidos. Comandos de observación (no incluyen
secretos):

```bash
docker system df
BACKUP_DIR_HOST="$BACKUP_DIR_HOST" docker compose --env-file .env.staging -f docker-compose.staging.yml exec api df -h /app/storage/CVs
find "$BACKUP_DIR_HOST" -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort | tail -1
```

La última orden solo permite observar mtime local; no declara válido un backup.
La consistencia requiere una ventana coordinada para `pg_dump` y tar, y la
validez requiere verificar un restore. El umbral y la alerta deben definirse en
la monitorización existente del servidor. Sin un gateway/monitor externo no se
afirma entrega de alertas. Para restore, usar una base temporal y nunca la
activa; el procedimiento detallado está en
`docs/DEPLOY-STAGING.md`.

No se comprobó externamente GitHub branch protection, recepción de alertas,
disponibilidad del gateway ni un navegador en CI. Tampoco se guardan ni se
inventan secretos para esas verificaciones.
