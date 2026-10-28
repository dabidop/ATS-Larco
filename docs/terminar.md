# ATS LARCO — Qué falta para producción

**Fecha de revisión:** 28/10/2026  
**Alcance:** auditoría estática del repositorio, documentación, configuración, pruebas y build.  
**Conclusión:** después de esta ronda, el producto sigue en estado **MVP/piloto avanzado**, no en estado de producción. No se deben cargar datos reales ni exponerlo a Internet hasta cerrar los bloqueadores P0.

## 1. Estado verificado

### Fortalezas existentes

- Monorepo pnpm con NestJS, React/Vite, PostgreSQL y TypeScript estricto.
- Migraciones versionadas hasta la `012`, restricciones y triggers de negocio, generador atómico de códigos, RBAC y auditoría.
- Cifrado de cédula/teléfono, HMAC para búsqueda exacta y validación de magic bytes para archivos.
- Flujo principal implementado: requerimiento → candidato → postulación → Kanban → contratación/descarte.
- Módulos ya disponibles: dashboard, departamentos, entrevistas, importación masiva y bitácora.
- Ejecución actual: **401 pruebas API, 116 web y 2 shared aprobadas**; typecheck, lint y build aprobados.

### Hallazgos inmediatos

1. El gate de formato ya fue corregido y pasa localmente; todavía no existe CI que lo haga obligatorio.
2. No existe `docker-compose.prod.yml`, pipeline CI/CD, gestión de secretos, TLS, estrategia de backup/restore ni runbook operativo.
3. La documentación técnica y el plan dicen que la migración llega a 010 y describen algunos estados/limitaciones anteriores; el código ya tiene la 011 y el resultado de pruebas actual es distinto. Debe existir una única fuente de verdad.
4. La sesión web guarda el JWT en `localStorage` (`apps/web/src/store/sesion.ts`). Un XSS permitiría exfiltrarlo.
5. `AuthGuard` valida firma y expiración sin consultar BD: una cuenta desactivada conserva acceso hasta la expiración del token (por defecto 24 h). `refresh` sí consulta BD, pero no existe revocación, rotación ni lista de sesiones.
6. El logger HTTP debe comprobarse y configurarse para **no registrar `Authorization`, cookies, PII ni cuerpos**. En la salida de pruebas se observan cabeceras de autorización en el objeto de request del log de error; esto es un riesgo crítico si ocurre en producción.
7. La importación crea candidato y archivo en operaciones separadas; si falla el segundo paso puede quedar archivo huérfano o una eliminación compensatoria incompleta. Debe hacerse idempotente y con estado de job/reconciliación.
8. Ya existen endpoints separados de liveness/readiness, pero aún no hay métricas ni alertas.
9. Los módulos de antecedentes y proveedor externo siguen siendo andamiaje sin lógica funcional; no deben presentarse como capacidades disponibles.
10. La migración inicial tenía correos y nombres de cuenta configurados para la demostración. Ahora son parametrizables y producción rechaza los valores por defecto; los coordinadores personales de la muestra fueron eliminados mediante la migración 012.
11. Todos los campos funcionales de un requerimiento ya son obligatorios en DTO, frontend y nuevas escrituras de BD. Los 67 registros históricos incompletos de la BD de desarrollo no fueron rellenados con datos falsos; deben completarse o eliminarse mediante un proceso aprobado antes de validar la restricción `013`.
12. La edición de requerimientos queda restringida al creador y solo durante `pendiente`; administración RRHH e IT pueden aprobar/cerrar, pero no modificar solicitudes ajenas.

## 2. Bloqueadores P0 — obligatorios antes de producción

### P0.1 Seguridad de autenticación y sesión

- Sustituir el JWT en `localStorage` por cookie `HttpOnly`, `Secure`, `SameSite` apropiada y protección CSRF; o documentar/aprobar formalmente una alternativa equivalente.
- Implementar access token corto (5–15 min), refresh token opaco en BD, rotación, revocación por logout, usuario, dispositivo y cambio de contraseña, detección de reutilización y límite de sesiones.
- Validar el usuario activo y una versión de sesión en cada request sensible, o reducir explícitamente la ventana de revocación a minutos.
- Restringir algoritmo/issuer/audience del JWT y separar secretos por ambiente. Planificar rotación de `JWT_SECRET`, `CRYPTO_KEY` y `CEDULA_SEARCH_KEY` con procedimiento probado.
- Aplicar política de contraseña robusta, expiración/recuperación segura, bloqueo progresivo y registro de eventos de autenticación sin secretos.
- Añadir MFA para `superusuario` y, como mínimo, para cuentas administrativas.

### P0.2 Protección de datos personales

- Formalizar responsable, finalidades, base legal/autorización, aviso de privacidad, derechos de consulta/rectificación/supresión, retención y eliminación conforme a la Ley 1581 de Colombia.
- Definir matriz de acceso a PII y CV por rol, jefatura y necesidad de negocio. El servidor debe ser la autoridad; la UI nunca es control de seguridad.
- Eliminar PII y tokens de logs, trazas, errores, nombres de archivos y métricas. Añadir pruebas que fallen si aparece `Authorization`, cédula, teléfono o CV en logs.
- Cifrar backups y el volumen de uploads; restringir permisos del directorio y verificar integridad/restauración de CV deduplicados.
- Implementar retención configurable, anonimización y borrado lógico/legal de candidato, CV, entrevistas y auditoría, con excepciones documentadas de conservación.
- Revisar la decisión actual de permitir `DELETE /candidatos/:id`: preferir anonimización/soft delete para no romper trazabilidad ni referencias.

### P0.3 Producción reproducible y recuperación

- Crear `docker-compose.prod.yml` o definir la plataforma objetivo: API, web/nginx, PostgreSQL administrado o endurecido, volumen de CV, red privada, límites de CPU/memoria y usuario no privilegiado.
- No usar credenciales por defecto ni valores de desarrollo; secretos fuera de Git y fuera de imágenes. Prohibir el arranque productivo con `ADMIN_INITIAL_PASSWORD` reutilizable.
- Incorporar migración como paso controlado de release, backup previo, verificación de versión y rollback documentado. Nunca `synchronize`.
- Automatizar backup PostgreSQL cifrado, retención, copia fuera del host, monitoreo y **restore periódico en entorno limpio**. Respaldar también CV y probar consistencia BD–archivos.
- Configurar TLS, HSTS, firewall, reverse proxy, límites de tamaño/tiempo, headers de seguridad, compresión segura y trusted proxy.
- Añadir CI/CD: lockfile inmutable, lint, formato, typecheck, unit/e2e, coverage, build, escaneo de dependencias e imagen, migraciones en staging y aprobación manual a producción.
- Fijar imágenes por versión/digest, actualizar Node/Postgres/nginx con calendario de parches y generar SBOM.

### P0.4 Cierre de calidad y aceptación

- Corregir los cinco archivos que fallan en Prettier y hacer que todos los gates sean obligatorios.
- Ejecutar E2E Playwright en navegador real para login, RBAC, flujo feliz, descarte, concurrencia, uploads, importación y fallo de red; el drag-and-drop hoy solo está verificado manualmente.
- Prueba de carga con volumen esperado y picos: login, dashboard, búsquedas, Kanban, descargas y 50 PDFs concurrentes. Medir p95/p99 y errores.
- Revisión OWASP ASVS/Top 10, SAST, DAST, dependency audit, secretos y permisos de base de datos.
- Prueba manual firmada por Gestión Humana usando `docs/PRUEBA-MANUAL-ATS.txt`, con datos de prueba separados de producción.
- UAT, criterios de aceptación, plan de reversa, ventana de despliegue y aprobación del propietario del producto.

## 3. P1 — necesario para un ATS profesional y operación estable

### Producto ATS / proceso de selección

- Completar antecedentes y proveedor externo: modelo de verificaciones, consentimiento, fuentes oficiales, evidencias, estados, timeout, reintentos, cola, revisión manual y trazabilidad.
- Implementar cola persistente y workers para importación, parsing y verificaciones; reintentos con backoff, idempotencia, dead-letter y panel de jobs. No depender de un worker in-process.
- Añadir parser de CV como **sugerencia editable y confirmada por humano**: nombre, correo, teléfono, ciudad, habilidades, experiencia, educación y confianza por campo. Soportar PDFs escaneados mediante OCR o indicar claramente que requieren carga manual.
- Incorporar catálogo versionado de habilidades, cargos, fuentes, motivos de descarte, tipos de entrevista y modalidades; evitar texto libre donde se necesitan informes.
- Permitir que un candidato tenga varias postulaciones visibles desde su ficha, respetando permisos y evitando duplicados.
- Añadir score configurable y explicable por requerimiento (sin decisiones automatizadas discriminatorias), matching de habilidades y revisión humana.
- Diseñar plantillas de vacante, aprobación multinivel, SLA por etapa, tareas, notas internas, evaluaciones estructuradas y recordatorios de entrevistas.
- Completar reportes: tiempo por etapa, conversión, fuente, aging, carga por jefatura, diversidad/no discriminación con datos mínimos y exportación CSV auditada.
- Añadir zona horaria, formato de fechas, estados de entrevista completos, asistentes, disponibilidad y notificaciones por correo.

### Datos, concurrencia y API

- Revisar transacciones de todos los flujos que cambian varias tablas: alta/postulación/contratación, cupo de plazas, cierre automático, importación y archivos. Usar el mismo cliente de BD y `SELECT ... FOR UPDATE` donde corresponda.
- Garantizar que no existan dos contrataciones que excedan el cupo bajo concurrencia, ni candidatos duplicados por carreras de importación.
- Añadir índices y `EXPLAIN ANALYZE` para búsquedas, Kanban, auditoría, entrevistas y dashboard; paginar también entrevistas/auditoría y limitar ordenación/filtros.
- Versionar OpenAPI, DTOs y tipos compartidos en `packages/shared`; eliminar enums duplicados entre API y web y generar cliente tipado.
- Normalizar errores con `requestId`, códigos estables y mensajes seguros. El frontend debe manejar 401/403/409/429/5xx, expiración y reintentos sin duplicar operaciones.
- Validar `x-request-id` (longitud/caracteres), no confiar ciegamente en `X-Forwarded-*` y configurar `trust proxy` solo detrás del proxy controlado.
- Separar readiness de liveness, añadir `/metrics` protegido, logs JSON con redacción, trazas y dashboards/alertas de errores, latencia, pool, disco, uploads, jobs y backups.

### Operación y gobierno

- Runbook: instalación, variables, migraciones, despliegue, rollback, backup/restore, rotación de llaves, caída de BD, pérdida de disco, CV corrupto, incidentes y contacto de guardia.
- ADRs para sesión, cifrado/rotación, almacenamiento de CV, auditoría, borrado, cola, proveedor de antecedentes y despliegue.
- Separar ambientes dev/staging/prod, bases y cuentas; mínimo privilegio para la aplicación y usuario exclusivo de migraciones.
- Gestión de releases, changelog, versionado, revisión de código, branch protection, CODEOWNERS y control de acceso al repositorio.
- Capacitación y manual de usuario de RRHH; definir soporte, SLA, canal de incidentes y procedimiento de reporte de vulnerabilidades.

## 4. P2 — evolución posterior al lanzamiento

- Portal del candidato, consentimiento/autoservicio y actualización de datos.
- SSO corporativo/OIDC, SCIM y MFA centralizado.
- Integración con correo/calendario, ERP/payroll y proveedores externos mediante contratos versionados.
- Multiempresa/multitenancy solo si aparece el requisito; no introducirlo prematuramente.
- Alta disponibilidad, PostgreSQL administrado, almacenamiento de objetos con antivirus y CDN solo cuando la escala lo justifique.
- Analítica avanzada y evaluación de sesgo, con revisión legal y de Gestión Humana antes de automatizar decisiones.

## 5. Orden recomendado de ejecución

1. Congelar alcance, corregir documentación y crear staging con datos sintéticos.
2. Cerrar P0.1 y P0.2: sesión, secretos, logs, PII, retención y permisos.
3. Cerrar P0.3: producción reproducible, TLS, backups/restore y runbook.
4. Corregir formato, ampliar pruebas, Playwright, seguridad y carga; poner CI obligatorio.
5. UAT manual y aprobación de Gestión Humana.
6. Piloto controlado de 1–2 semanas con monitoreo, soporte y plan de reversa.
7. Cerrar P1 por iteraciones, empezando por jobs/antecedentes, parser asistido, reportes y notificaciones.

## 6. Criterio de salida a producción

El sistema solo se declara productivo cuando:

- todos los gates de CI están verdes y las vulnerabilidades críticas/altas tienen tratamiento aprobado;
- existe staging reproducible y el despliegue fue ensayado desde cero;
- UAT está firmado y no hay defectos bloqueantes o de seguridad;
- sesión, revocación, MFA administrativo, privacidad y redacción de logs están verificadas;
- backup y restore de PostgreSQL **y CV** fueron ejecutados con evidencia, cumpliendo RPO/RTO acordados;
- TLS, monitoreo, alertas, runbook, soporte y reversa están disponibles;
- las migraciones, seeds, secretos y datos reales están separados por ambiente;
- el propietario del producto acepta explícitamente las funcionalidades que siguen fuera del alcance (por ejemplo, portal candidato o integraciones).

## 7. Referencias del repositorio

- Arquitectura y estado declarado: `docs/PLAN-PRODUCCION-ATS.md`.
- API, tablas y limitaciones: `docs/DOCUMENTACION-TECNICA-ATS.txt`.
- Guion UAT: `docs/PRUEBA-MANUAL-ATS.txt`.
- Configuración: `.env.example`, `docker-compose.dev.yml`.
- Seguridad principal: `apps/api/src/main.ts`, `apps/api/src/common/guards/auth.guard.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/web/src/store/sesion.ts`.
- Persistencia/migraciones: `apps/api/db/migrations/001...011`.

**Resultado de esta revisión:** el repositorio puede continuar como piloto interno, pero la etiqueta “listo para producción” queda bloqueada hasta completar P0 y obtener la aprobación de UAT/operaciones.
