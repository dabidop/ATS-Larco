# Staging y despliegue del ATS

Este procedimiento usa `docker-compose.staging.yml`, separado de
`docker-compose.dev.yml`. El compose de staging no publica puertos: un reverse
proxy/gateway existente termina TLS y reenvía HTTPS a `web:80` dentro de la red
de Compose. No se deben poner secretos en el repositorio.

## 1. Preparar secretos

Crear `.env.staging` en el servidor, con permisos restringidos (`chmod 600`), a
partir de `.env.example`. Debe contener, como mínimo:

```dotenv
POSTGRES_USER=ats_staging
POSTGRES_PASSWORD=<secreto-largo>
POSTGRES_DB=ats_staging
DATABASE_URL=postgres://ats_staging:<secreto-largo>@db:5432/ats_staging
CORS_ORIGIN=https://ats-staging.example.com
JWT_SECRET=<secreto-aleatorio-de-32-o-mas-caracteres>
CRYPTO_KEY_BASE64=<32-bytes-en-base64>
CEDULA_SEARCH_KEY=<32-bytes-en-base64>
ADMIN_INITIAL_EMAIL=<correo-no-predeterminado>
ADMIN_INITIAL_PASSWORD=<secreto-inicial>
SUPER_INITIAL_EMAIL=<correo-no-predeterminado>
SUPER_INITIAL_PASSWORD=<secreto-inicial>
ACCESS_TOKEN_TTL_MINUTES=15
UPLOAD_DIR=/app/storage/CVs
```

`CORS_ORIGIN` debe coincidir exactamente con el origen HTTPS público. Las
cookies de sesión se emiten `Secure`, `HttpOnly` y `SameSite=Strict` cuando
`NODE_ENV=production`; el gateway debe conservar `Host` y
`X-Forwarded-Proto: https`.

## 2. Instalación limpia

Desde una copia con el lockfile versionado:

```bash
docker compose -f docker-compose.staging.yml config
docker compose -f docker-compose.staging.yml build --pull
docker compose -f docker-compose.staging.yml --profile migration run --rm migrate
docker compose -f docker-compose.staging.yml up -d db api web
```

El gateway HTTPS debe apuntar a `ats-staging-web-1:80`. Validar desde el
gateway, no desde un puerto nuevo del host:

```bash
curl --fail https://ats-staging.example.com/api/health/live
curl --fail https://ats-staging.example.com/api/health/ready
```

`ready` solo es exitoso cuando PostgreSQL responde. La API y web tienen
healthchecks propios; no continuar si alguno está `unhealthy`.

La imagen de API prepara `/app/storage/CVs` para el usuario no root `node`;
no se debe resolver permisos ejecutando el proceso como `root`.

## 3. Actualización segura

1. Tomar backup de PostgreSQL y de `storage/CVs` antes de cambiar la imagen.
2. Construir la nueva imagen con el mismo lockfile y ejecutar el perfil
   `migration` una sola vez.
3. Levantar los servicios y comprobar ambos healthchecks y el login sintético.
4. Si falla la migración, detener el despliegue y restaurar el backup en una
   base temporal para diagnosticar; no ejecutar migraciones `down` en la base
   activa.

```bash
docker compose -f docker-compose.staging.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > storage/backups/staging-$(date +%Y%m%d-%H%M%S).dump
docker run --rm -v ats-staging_cv_staging:/src:ro -v "$PWD/storage/backups:/dst" \
  alpine tar -czf /dst/cvs-$(date +%Y%m%d-%H%M%S).tar.gz -C /src .
docker compose -f docker-compose.staging.yml --profile migration run --rm migrate
docker compose -f docker-compose.staging.yml up -d api web
```

## 4. Verificar restore sin tocar la base activa

Crear una base temporal en la misma instancia PostgreSQL, restaurar allí el
dump y validar conteos, migración `020` y SHA-256 de los CV. Después eliminar
únicamente esa base temporal y el directorio temporal de archivos:

```bash
docker compose -f docker-compose.staging.yml exec db createdb -U "$POSTGRES_USER" ats_restore_check
docker compose -f docker-compose.staging.yml exec -T db pg_restore \
  -U "$POSTGRES_USER" -d ats_restore_check < storage/backups/<backup>.dump
docker compose -f docker-compose.staging.yml exec db psql -U "$POSTGRES_USER" \
  -d ats_restore_check -c "SELECT version FROM pgmigrations ORDER BY run_on DESC LIMIT 1"
docker compose -f docker-compose.staging.yml exec db dropdb -U "$POSTGRES_USER" ats_restore_check
```

El restore nunca se ejecuta sobre `POSTGRES_DB` activa. Los backups se
conservan en `storage/backups` y los CV en el volumen `cv_staging`; ambos deben
quedar incluidos en la política de backup cifrado del servidor.

## 5. Criterios de aceptación

- `docker compose ... config` no muestra errores ni secretos literales.
- Instalación limpia y actualización requieren la migración explícita, no
  `db:migrate:down`.
- `/api/health/live` y `/api/health/ready` responden por HTTPS.
- El login y una descarga de PDF sintético funcionan mediante el gateway.
- El restore se prueba en `ats_restore_check` y se elimina solo después de la
  verificación.
