# Runbook T16/T17 — operación sintética

Este runbook prepara operación sin desplegar y sin usar datos reales. No contiene
credenciales; `DATABASE_URL` y las claves se inyectan por el gestor de secretos.

## Inventario de CV (dry-run)

Compilar primero (`pnpm --filter @ats/api build`). Desde el contenedor/servidor
de staging, con una base desechable identificada y un `UPLOAD_DIR` aislado:

Para el check dentro del contenedor, configurar `BACKUP_DIR_HOST` en el entorno
del host (ruta absoluta suministrada explícitamente por el operador al
directorio de backups versionados) y preparar permisos (`install -d -m 700
"$BACKUP_DIR_HOST"`). Compose lo monta en su punto interno de solo lectura; no
se asume que el volumen de CV contenga backups. El `env_file` del servicio no
interpela `${BACKUP_DIR_HOST}`: exportar la variable o pasarla explícitamente
con `--env-file` al ejecutar cada comando Compose. Alternativamente ejecutar el
check en el host, usando las rutas reales del host para `UPLOAD_DIR` y
`BACKUP_DIR`, siempre con variables ya inyectadas.

```bash
DATABASE_URL="$STAGING_DATABASE_URL" UPLOAD_DIR=/app/storage/CVs \
  node dist/operacion/cv-inventory.js
```

El comando solo lee PostgreSQL y el directorio de CV e informa: blobs sin fila
con mtime anterior a seis meses, referencias, y filas/candidatos cuyas
postulaciones están descartadas y superan seis meses. Conserva contratados,
postulaciones activas y blobs compartidos por diseño. `--delete` falla
deliberadamente: no existe todavía un borrado operativo aprobado. No ejecutar
contra producción ni contra `ats_dev`; el comando no carga `.env` y por defecto
no imprime hashes. Solo `CV_INVENTORY_SHOW_HASHES=true` en una ejecución
autorizada permite mostrarlos.

En PowerShell para una fixture local, asignar las variables al proceso (sin
cargar `.env`) y ejecutar `pnpm --filter @ats/api ops:cv-inventory`; el script
resuelve `dist/operacion/cv-inventory.js` desde `apps/api`.

## Disponibilidad para monitor externo

```bash
API_URL="$STAGING_API_URL" DATABASE_URL="$STAGING_DATABASE_URL" \
UPLOAD_DIR=/app/storage/CVs BACKUP_DIR=/app/storage/backups \
MAX_BACKUP_AGE_HOURS=24 BACKUP_MAX_SKEW_HOURS=1 MIN_CV_FREE_BYTES=1073741824 \
  node dist/operacion/availability-check.js
```

Salida JSON y código 0 solo si API `/api/health/ready`, BD (`SELECT 1`), espacio
libre de CV y frescura de ambos artefactos (dump PostgreSQL y tar de CV, con
antigüedad y ventana coherentes) cumplen. Esto no verifica contenido, integridad,
versión ni correspondencia criptográfica entre ambos artefactos. Cualquier fallo devuelve 1; una
configuración ausente o inválida devuelve 2. La entrega de alertas debe
configurarse en el monitor, no se simula aquí.

## Backup y restore PostgreSQL + CV

1. Registrar versión de aplicación, migración actual, nombre del entorno y
   `sha256sum` de cada artefacto.
2. Tomar `pg_dump -Fc` y un tar/backup del volumen de CV en la misma ventana,
   usando un timestamp UTC común para ambos nombres; no escribir claves en
   shell history. `pg_dump` y tar no son un snapshot atómico: coordinar la
   consistencia y la ventana operativa.
3. Preservar por separado las claves de `CRYPTO_KEY_BASE64`,
   `CRYPTO_KEY_PREVIOUS_BASE64` y `CEDULA_SEARCH_KEY`, con versionado del gestor
   de secretos. Sin esas claves no se declara restore válido de PII.
4. Restaurar siempre en una base y volumen nuevos, identificados como
   `*_restore_<fecha>`, nunca en la base activa. Restaurar el dump y CV de la
   misma versión, comprobar conteos, hashes de blobs y descarga sintética; no
   declarar válido el backup solo por su mtime.
5. Ejecutar el inventario, registrar resultados, y eliminar la base/volumen
   desechables al terminar. La restauración productiva requiere aprobación y
   ventana operativa independiente.

No se declara antivirus, cifrado de CV en reposo, TLS/certificado de gateway ni
entrega de alertas por estos scripts: son controles externos aún pendientes.
