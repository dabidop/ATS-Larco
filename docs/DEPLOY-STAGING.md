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

Antes de ejecutar Compose, el operador debe suministrar `BACKUP_DIR_HOST` como
una ruta absoluta del servidor (no se inventa ni se asume una ruta productiva),
crear ese directorio y dejarlo accesible para el proceso que ejecuta Docker:

```bash
: "${BACKUP_DIR_HOST:?El operador debe suministrar BACKUP_DIR_HOST}"
case "$BACKUP_DIR_HOST" in /*) ;; *) echo "BACKUP_DIR_HOST debe ser absoluta" >&2; exit 1 ;; esac
export BACKUP_DIR_HOST
install -d -m 750 "$BACKUP_DIR_HOST"
```

El `env_file` del servicio solo configura el contenedor; no participa en la
interpolación de `${BACKUP_DIR_HOST}` del archivo Compose. Por eso la variable
debe estar exportada en el shell (o incluirse explícitamente en el archivo
pasado con `--env-file`) antes de **cada** comando Compose. El operador debe
confirmar además que el usuario de Docker puede atravesar los directorios padre
y escribir los artefactos en esa ruta; la cuenta del contenedor debe conservar
permiso de lectura para el montaje de solo lectura.

```bash
BACKUP_DIR_HOST="$BACKUP_DIR_HOST" docker compose --env-file .env.staging -f docker-compose.staging.yml config
BACKUP_DIR_HOST="$BACKUP_DIR_HOST" docker compose --env-file .env.staging -f docker-compose.staging.yml build --pull
BACKUP_DIR_HOST="$BACKUP_DIR_HOST" docker compose --env-file .env.staging -f docker-compose.staging.yml --profile migration run --rm migrate
BACKUP_DIR_HOST="$BACKUP_DIR_HOST" docker compose --env-file .env.staging -f docker-compose.staging.yml up -d db api web
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
set -euo pipefail
BACKUP_TS="$(date -u +%Y%m%d-%H%M%S)"
DUMP_FILE="$BACKUP_DIR_HOST/staging-$BACKUP_TS.dump"
CVS_FILE="$BACKUP_DIR_HOST/cvs-$BACKUP_TS.tar.gz"
CHECKSUM_FILE="$BACKUP_DIR_HOST/staging-$BACKUP_TS.sha256"

# POSTGRES_* pertenece al contenedor (env_file), no al shell del host.
docker compose --env-file .env.staging -f docker-compose.staging.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DUMP_FILE"
docker compose --env-file .env.staging -f docker-compose.staging.yml exec -T api \
  tar -czf - -C /app/storage/CVs . > "$CVS_FILE"
sha256sum "$DUMP_FILE" "$CVS_FILE" > "$CHECKSUM_FILE"
sha256sum -c "$CHECKSUM_FILE"
```

El mismo `BACKUP_TS` se usa para ambos artefactos. `pg_dump` y `tar` no son un
snapshot atómico: tomar ambos durante una ventana de consistencia acordada,
evitar escrituras concurrentes cuando la operación lo requiera y verificar un
restore antes de declarar válido el backup. La fecha de modificación por sí
sola no demuestra validez.

**Punto de parada obligatorio:** después de tomar los artefactos y comprobar el
checksum anterior, detenerse y ejecutar la sección 4. No ejecutar la migración
ni levantar la nueva API hasta que esa sección termine correctamente. Solo
después de un restore validado, continuar manualmente:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml --profile migration run --rm migrate
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d api web
```

## 4. Verificar restore sin tocar la base activa

Crear una base temporal en la misma instancia PostgreSQL, restaurar allí el
dump y validar conteos, migración `020` y SHA-256 de los CV. Después eliminar
únicamente esa base temporal y el directorio temporal de archivos:

```bash
set -euo pipefail
BACKUP_TS="<timestamp>"
DUMP_FILE="$BACKUP_DIR_HOST/staging-$BACKUP_TS.dump"
CVS_FILE="$BACKUP_DIR_HOST/cvs-$BACKUP_TS.tar.gz"
CHECKSUM_FILE="$BACKUP_DIR_HOST/staging-$BACKUP_TS.sha256"
: "${RESTORE_TMP_ROOT:?El operador debe suministrar un directorio temporal aprobado}"
case "$RESTORE_TMP_ROOT" in /*) ;; *) echo "RESTORE_TMP_ROOT debe ser absoluta" >&2; exit 1 ;; esac

# Verifica el par dump/CV del mismo BACKUP_TS antes de abrirlo.
sha256sum -c "$CHECKSUM_FILE"

RESTORE_DB="ats_restore_check_$(date -u +%Y%m%d-%H%M%S)-$$"
RESTORE_DB_CREATED=0
CV_TMP=''
cleanup_restore_db() {
  if [ "$RESTORE_DB_CREATED" -eq 1 ]; then
    docker compose --env-file .env.staging -f docker-compose.staging.yml exec -T db \
      sh -c 'dropdb -U "$POSTGRES_USER" "$1"' sh "$RESTORE_DB" || true
  fi
  if [ -n "$CV_TMP" ] && [ -d "$CV_TMP" ]; then
    rm -rf -- "$CV_TMP"
  fi
}
trap cleanup_restore_db EXIT

# createdb falla si el nombre ya existe; el flag evita borrarlo en el trap.
docker compose --env-file .env.staging -f docker-compose.staging.yml exec -T db \
  sh -c 'createdb -U "$POSTGRES_USER" "$1"' sh "$RESTORE_DB"
RESTORE_DB_CREATED=1
docker compose --env-file .env.staging -f docker-compose.staging.yml exec -T db \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1"' sh "$RESTORE_DB" < "$DUMP_FILE"
docker compose --env-file .env.staging -f docker-compose.staging.yml exec -T db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$1" -c "SELECT name FROM pgmigrations ORDER BY run_on DESC LIMIT 1"' sh "$RESTORE_DB"

# El directorio es nuevo, exclusivo y está fuera del storage real. RESTORE_TMP_ROOT
# debe ser un directorio temporal aprobado por el operador, no BACKUP_DIR_HOST ni
# el volumen de la aplicación. Se usa el tar del mismo BACKUP_TS, nunca uno
# recibido de una fuente no confiable.
CV_TMP="$(mktemp -d "$RESTORE_TMP_ROOT/ats-cv-restore.XXXXXX")"

# Inspeccionar primero las entradas con el tar del sistema (no ejecutar nada
# contenido en el archivo). Deben ser únicamente ./<SHA256> o el directorio ./;
# se rechazan rutas absolutas, componentes .. y cualquier subdirectorio.
while IFS= read -r entry; do
  case "$entry" in
    ./) ;;
    ./*)
      name="${entry#./}"
      [[ "$name" != */* && "$name" =~ ^[0-9a-fA-F]{64}$ ]] || {
        echo "Entrada inesperada o potencialmente insegura: $entry" >&2
        exit 1
      }
      ;;
    *)
      echo "Entrada absoluta o fuera de ./ en CVS_FILE: $entry" >&2
      exit 1
      ;;
  esac
done < <(tar -tzf "$CVS_FILE")
# El listado detallado debe contener solo directorios o archivos regulares:
# rechazar symlinks, hardlinks, dispositivos y otros tipos antes de extraer.
if tar -tvzf "$CVS_FILE" | awk 'substr($1,1,1) != "d" && substr($1,1,1) != "-" { exit 1 }'; then
  :
else
  echo "CVS_FILE contiene tipos de entrada no permitidos" >&2
  exit 1
fi

# Usar el tar confiable instalado por el operador; no sustituirlo por un archivo
# del backup. No se preservan propietarios ni permisos del archivo.
tar --extract --gzip --file "$CVS_FILE" --directory "$CV_TMP" \
  --no-same-owner --no-same-permissions

# Cada blob debe llamarse exactamente con su SHA-256. No se acepta ningún otro
# archivo; sha256sum -c recibe una lista generada solo desde nombres locales.
mapfile -t CV_BLOBS < <(find "$CV_TMP" -type f -printf '%P\n')
if [ "${#CV_BLOBS[@]}" -eq 0 ]; then
  echo "El restore de CV no contiene blobs" >&2
  exit 1
fi
for blob in "${CV_BLOBS[@]}"; do
  name="${blob##*/}"
  [[ "$blob" == "$name" && "$name" =~ ^[0-9a-fA-F]{64}$ ]] || {
    echo "Blob CV con nombre no SHA-256: $blob" >&2
    exit 1
  }
  printf '%s  %s\n' "$name" "$blob"
done | (cd "$CV_TMP" && sha256sum -c -)
```

El restore nunca se ejecuta sobre `POSTGRES_DB` activa. Los artefactos se
conservan en `BACKUP_DIR_HOST`; la extracción de CV ocurre únicamente en el
directorio temporal exclusivo recién creado y no modifica el volumen real.
Ambos artefactos deben quedar incluidos en la política de backup cifrado del
servidor. `RESTORE_DB` debe ser un nombre único autorizado para cada ejecución;
el bloque aborta si ya existe y solo elimina la base que creó mediante el
`trap`. El mismo `trap` elimina únicamente `CV_TMP`, que fue creado por esa
ejecución. Si se interrumpe antes de crear alguno de ellos, cualquier limpieza
posterior debe ser manual y confirmar primero que no pertenece a otra ejecución.

## 5. Criterios de aceptación

- `docker compose ... config` no muestra errores ni secretos literales.
- Instalación limpia y actualización requieren la migración explícita, no
  `db:migrate:down`.
- `/api/health/live` y `/api/health/ready` responden por HTTPS.
- El login y una descarga de PDF sintético funcionan mediante el gateway.
- Si se ejecuta la sección 4, el restore se prueba en una base temporal única y
  los blobs CV se verifican por su SHA-256; se elimina solo la base y el
  directorio temporal creados por esa ejecución.
