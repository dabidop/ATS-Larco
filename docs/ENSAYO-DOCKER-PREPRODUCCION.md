# Ensayo integral Docker (efímero)

Fecha: 2026-11-12

## Aislamiento

Se ejecutó exclusivamente un Compose temporal con nombre de proyecto único
`ats-ensayo-20261112122637-6628`, copiado a un directorio temporal aprobado.
El contexto de build apuntó de forma absoluta a este repositorio y se usó un
`env_file` temporal con secretos sintéticos. La topología fue PostgreSQL 16,
`migrate`, API y web, unidos únicamente por la red temporal
`ats-ensayo-20261112122637-6628_net`.

No se publicaron puertos al host. Las comprobaciones se hicieron mediante
`docker compose exec` dentro de la red propia. La configuración verificada no
compartió volúmenes ni contenedores con `ats-dev`, `ats-staging` u otros
proyectos.

## Evidencia

- Build de API, migración y web: correcto.
- Migraciones aplicadas: 22/22; máxima `pgmigrations.id`: 22.
- API: `GET /api/health` devolvió `status=ok`, `db=up`.
- Web: nginx sirvió `index.html` y `/api/health` a través del proxy.
- Login sintético del administrador: HTTP 200.
- Flujo HTTP sintético de CV: se creó el candidato mediante `POST
/api/candidatos` (HTTP 201) y se subió el archivo mediante `POST
/api/candidatos/:id/archivos` como `multipart/form-data`, campo `file` (HTTP
  201). No se insertó manualmente la fila de `archivos_cv` ni se copiaron sus
  bytes directamente al volumen: ambos fueron escritos por el endpoint HTTP.
  El fixture enviado tenía 14 bytes (`%PDF-1.4\\n%EOF\\n`) y solo se usó como
  blob con cabecera PDF mínima; no se verificó que fuera un PDF semánticamente
  válido mediante un lector PDF. No se ejecutó el endpoint de descarga
  (`GET /api/candidatos/:id/archivos/:archivoId/descarga`), ni se verificó el
  flujo UI/browser. Hash SHA-256 del fichero: `f246a0043abad99c6fe9964c6dbd54b20a506bdd2720b0bf7b14a21f9bc4aa61`.
- Backup PostgreSQL: SHA-256
  `2EB30B7D16FEF2EF824E5B0491C3FDC3204EAA595E6E62355C0C75A31DE8F930`.
- Backup tar de CV: SHA-256
  `16E7B4758BE14EFE8F4A084C90D8433CC96686E5F91B6DA41AF22C32B940DD2A`.
- PG dump y tar de CV coexistieron y se capturaron después de la subida HTTP,
  desde la misma ejecución aislada. Restore en una base y volumen nuevos:
  correcto; `archivos_cv=1`, `pgmigrations=22`, máxima migración 22, y hash
  del CV restaurado igual al original. Esto verifica la integridad de los
  artefactos y la fila restaurada, pero no verifica descarga HTTP ni apertura
  del fixture como PDF.

## Limpieza y límites

Se eliminaron únicamente los contenedores, imágenes, red y volúmenes creados
por este ensayo, incluidos los recursos temporales de restore. No se tocaron
recursos de desarrollo/staging ni bases de datos ajenas.

El ensayo no cubre TLS/reverse proxy externo, GitHub, malware, cifrado de
archivos ni alertas. No se ejecutó prueba de navegador.

## Nueva prueba automatizada opt-in (2026-11-12)

Se añadió `apps/api/test/docker-preproduccion.browser.e2e.test.ts`. Por diseño
queda omitida salvo `ATS_DOCKER_SMOKE=1` y exige `E2E_WEB_URL`,
`E2E_WEB_PORT`, `E2E_API_PORT`, `E2E_DB_PORT` (puertos loopback explícitos y no
compartidos). No carga `.env`, `DATABASE_URL` ni las suites browser existentes.

La prueba crea un Compose con proyecto, BD, usuario PostgreSQL y fixtures
identificados por `randomUUID`, comprueba `current_database`, `current_user` y
PG16 antes de insertar el usuario analista, inicia API/web en contenedores y
usa un ejecutable Chromium local. Cubre login de admin y analista,
autorización, importación revisada, comparación byte-a-byte de la descarga y
validación estructural y lectura obligatoria con `pdfjs-dist` instalado; el
recorrido de cinco fases con DnD está preparado pero pendiente y no validado
(el test está `it.skip`), al igual que descarte/historial dependientes de ese
recorrido. `down -v --remove-orphans` y la eliminación del directorio temporal
se ejecutan solo para el proyecto creado.

Invocación segura, sin cargar `.env` de desarrollo (los puertos deben estar
libres y ser distintos de 3000/5173/5432):

```powershell
$env:ATS_DOCKER_SMOKE='1'; $env:E2E_WEB_PORT='38170'; $env:E2E_API_PORT='38171'; $env:E2E_DB_PORT='38172'; $env:E2E_WEB_URL='http://127.0.0.1:38170'; pnpm -C apps/api exec vitest run test/docker-preproduccion.browser.e2e.test.ts
```

```bash
ATS_DOCKER_SMOKE=1 E2E_WEB_PORT=38170 E2E_API_PORT=38171 E2E_DB_PORT=38172 E2E_WEB_URL=http://127.0.0.1:38170 pnpm -C apps/api exec vitest run test/docker-preproduccion.browser.e2e.test.ts
```

Comprobar previamente los tres puertos en loopback; no ejecutar con el
`DATABASE_URL` ni el Compose de dev/staging activos como destino del ensayo.

Ejecución real opt-in realizada una vez tras esta corrección con
`pnpm -C apps/api exec vitest run`, Chrome local y puertos loopback libres
38156–38158. La construcción, migración, health gates, login/autorización e
importación/PDF avanzaron; se midió `lista=200`, `descarga=200`, `bytes=686`.
El diálogo `Confirmar movimiento` apareció, pero la confirmación no cerró en
el tiempo límite; el flujo completo no pasó y no se declara como aprobado.
El lector `pdfjs-dist` emitió advertencias de `canvas.node` ausente, sin
convertir el resultado HTTP en un falso positivo. Se eliminaron los
contenedores, volúmenes y red del proyecto `ats-smoke-c245fe95a34e42a1`;
no se tocaron `ats-dev` ni `ats-staging`.

En la ejecución diagnóstica posterior, el capturador registró tres `PATCH
/api/postulaciones/:id/fase` con HTTP 200. En el cuarto movimiento (a
`Contratación`) no se observó ningún PATCH; la UI mantuvo abierto
`Confirmar movimiento` y la BD permaneció en `fase=proveedor_externo,
estado=activa`. Esto demuestra que el fallo observado en esa corrida está en
la interacción/estado del test o frontend antes de alcanzar la API; no se
modificó la implementación productiva. La corrida quedó fallida y sus recursos
efímeros propios fueron eliminados.

Tras separar importación/PDF del recorrido DnD y añadir diagnóstico selectivo
(page errors, console errors, request failures, estado del botón y screenshot
temporal en fallo), se ejecutó una única corrida nueva con el proyecto
`ats-smoke-45db5816cec04f59` y puertos 38162–38164. Resultado: **2 passed, 1
skipped**. Importación/PDF y autorización pasaron; el DnD quedó explícitamente
omitido por la evidencia anterior de que la confirmación final no emite PATCH.
Se retiraron contenedores, volúmenes y red del proyecto propio. No se tocaron
dev/staging ni se modificó código productivo.
