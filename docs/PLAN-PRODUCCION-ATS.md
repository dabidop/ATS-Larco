# 🗺️ PLAN DE PRODUCCIÓN — ATS LARCO (Applicant Tracking System)

> Documento vivo · Rol: desarrollador/a único · Despliegue: local (on-prem) primero, nube después
> Fuente de requisitos: prueba de conocimiento LARCO (vacante Analista de Sistemas – Desarrollador de Software)

---

## 1. Contexto y decisión de producto

La prueba pedía un **piloto** de un ATS para el área de Gestión Humana. Ahora el sistema pasa a **producción**: se conserva el concepto y el stack del PDF, pero se aplica ingeniería de software real (alcance priorizado, migraciones, tests, seguridad, operación y cumplimiento normativo).

**Stack objetivo (confirmado por el requerimiento):**

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + Vite + Tailwind CSS + TypeScript estricto · Zustand · DnD Kit |
| Backend | NestJS 11 + Node.js 20+ · módulos: auth, candidatos, embudo, antecedentes, entrevistas, proveedor, historial, uploads, requerimientos, importacion |
| Persistencia | PostgreSQL 16 · pool `pg` para alta concurrencia + TypeORM en *requerimientos* (esquema híbrido) |
| Seguridad | JWT 24 h · RBAC (admin_rrhh, analista_seleccion, lider_area) · AES-256-CBC con IV aleatorio por registro para PII · auditoría por triggers |
| Async | Scrapers Playwright (antecedentes) · trabajos en cola |

**Stack de herramientas de ingeniería:**

- Monorepo `pnpm` (o npm workspaces): `apps/api`, `apps/web`, `packages/shared` (tipos y validaciones compartidas).
- ESLint + Prettier + TypeScript strict en ambos apps.
- Pruebas: **Vitest** (unitario, api y web) + **Playwright** (E2E del propio ATS).
- Docker: `docker-compose.dev.yml` (pg + api + web) y `docker-compose.prod.yml`.
- Git: trunk-based con ramas `feature/*` cortas; convención de commits (Conventional Commits).

---

## 2. Definición de alcance (MoSCoW)

### 🔴 Must — MVP productivo (fases 0–5)

1. **Auth + RBAC**: login JWT 24 h, 3 roles, guards por endpoint y por ruta del frontend.
2. **Requerimientos de personal**: formulario en 5 secciones (identificación/jefatura, perfil profesional, conocimientos/habilidades, condiciones salariales/contractuales, justificación); máquina de estados `pendiente → aprobado → en_proceso → cerrado | rechazado`; código atómico anual `REQ-YYYY-NNN`.
3. **Candidatos**: CRUD con PII cifrada (cédula, teléfono), carga **unitaria** de CV (PDF), almacenamiento con dedup por SHA-256.
4. **Embudo Kanban**: 5 fases (Preselección, Antecedentes, Entrevistas, Proveedor externo, Contratación), drag-and-drop, validación server-side de transiciones.
5. **Historial y rechazos**: trazabilidad completa de movimientos; motivo de rechazo **obligatorio garantizado en BD** (trigger), no solo en UI.
6. **Auditoría**: triggers que registran acciones críticas en tabla inmutable.
7. **Despliegue local**: Docker Compose, backups automáticos, runbook de operación.

### 🟡 Should — V1 completa (fases 6–8)

8. **Importación masiva** de CVs con cola de trabajos y reporte por archivo.
9. **Parsing de CVs**: extracción de nombres, correo, teléfono, ciudad y habilidades; presentación como *sugerencia confirmada por humano* (nunca confiar ciegamente al parser).
10. **Verificaciones de antecedentes asíncronas** con Playwright, resultados en JSONB, estados `pendiente | exitoso | fallido | no aplica`, evidencia adjunta.
11. **Reportes e indicadores**: tiempo promedio por fase, tasa de conversión por vacante, antigüedad de requerimientos, exportación CSV.

### 🟢 Could — Post-lanzamiento (backlog priorizado)

- Entrevistas: agenda, recordatorios, evaluaciones por entrevistador.
- Portal del candidato (autoservicio).
- Notificaciones por correo (SMTP interno).
- Tablero de indicadores ejecutivo para Dirección de GH.
- Migración a nube (contenedores ya portables; ver fase 11).

### ❌ Fuera de alcance por ahora

- App móvil. · Integración con payroll/ERP. · Multitenancy. · SSO corporativo (diseñar el auth para poder agregarlo después).

---

## 3. Riesgos y cómo los mitigamos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Parsing de CV impreciso | Alto | Extracción como sugerencia + confirmación humana; métrica de aciertos antes de confiar en automatización |
| Scrapers frágiles (antecedentes) | Medio | Arquitectura de "plugins" por fuente con interfaz estable, timeouts, reintentos y degradación elegante |
| Esquema híbrido TypeORM + pg | Medio | Límites estrictos: TypeORM solo en requerimientos; el resto acceso directo con query builder propio; migraciones SIEMPRE versionadas (nunca `synchronize` en prod) |
| PII sensible (Ley 1581 de 2012, Colombia) | Alto | Cifrado AES-256-CBC, minimización de datos, retención y supresión (habeas data), auditoría, y política de acceso por rol |
| Desarrollador único (factor bus) | Alto | Documentación viva (ADR + runbook), seeds reproducibles, backups probados con restore real |

---

## 4. La ruta de trabajo (fases del ciclo de vida)

### Fase 0 · Aterrizaje del alcance y andamiaje del repo (2–3 días)

- [ ] Crear repo nuevo `ats-larco` (monorepo) — el workspace actual (calculadora FinanzasPro) queda como referencia/archivo.
- [ ] Plantilla base: ESLint/Prettier/tsconfig estricto, scripts `dev`, `test`, `lint`, `build`.
- [ ] `docker-compose.dev.yml`: PostgreSQL 16 + API + web.
- [ ] ADR-001: decisiones de arquitectura (monorepo, esquema híbrido, crypto en app vs pgcrypto).
- [ ] Tablero Kanban real del proyecto (GitHub/Linear) con este plan descompuesto en tareas.
- **Salida:** repo cloneable que arranca con un solo comando y tiene CI verde (aunque vacío).

### Fase 1 · Fundación del backend y base de datos (3–4 días)

- [ ] NestJS 11 con los 10 módulos creados (aunque casi vacíos) + health endpoint.
- [ ] Config validada por variables de entorno (usar `zod` o `@nestjs/config` con validación).
- [ ] Sistema de migraciones versionadas desde el día 1 (TypeORM migrate o node-pg-migrate; decidir en ADR).
- [ ] Migración 001: `users`, `roles`, `audit_log`; seed de roles y usuario admin inicial (password obligatorio en primer arranque).
- [ ] Logging estructurado (pino) y manejo global de errores con formato consistente.
- **Salida:** API con auth simulada, migraciones aplicables y reversibles, seed determinista.

### Fase 2 · Seguridad transversal (3–4 días)

- [ ] Auth real: login/logout, JWT 24 h, refresh simple, guards de roles (`admin_rrhh`, `analista_seleccion`, `lider_area`).
- [ ] Servicio crypto: AES-256-CBC con IV aleatorio de 16 bytes por registro; helpers `encrypt/decrypt` para columnas PII; llave por variable de entorno con rotación planificada.
- [ ] Auditoría por triggers: quién, qué, cuándo, antes/después (JSONB); revista de que la tabla sea efectivamente inmutable.
- [ ] Rate limiting en login, helmet/CORS acotados, validación de payloads con class-validator.
- **Salida:** todo endpoint protegido por defecto; PII cifrada extremo a BD; auditoría funcionando.

### Fase 3 · Módulo Requerimientos (1 semana)

- [ ] Entidad + API CRUD con las 5 secciones del formulario.
- [ ] Máquina de estados del flujo con permisos por rol (quién aprueba, quién cierra).
- [ ] Generador atómico de código `REQ-YYYY-NNN` (sequence por tabla con transacción; test de concurrencia).
- [ ] Tests unitarios del flujo de estados y del generador de códigos.
- **Salida:** líderes registran y aprueban solicitudes; códigos únicos garantizados bajo concurrencia.

### Fase 4 · Candidatos + uploads (1 semana)

- [ ] CRUD candidatos con cédula/teléfono cifrados y búsqueda por hash de búsqueda si aplica.
- [ ] Upload de CV: multipart con límite de tamaño, validación real de tipo (magic bytes), almacenamiento con nombre = SHA-256 del contenido (dedup automático), metadatos en BD, descarga autorizada.
- [ ] Historial básico de cambios de candidato.
- **Salida:** un analista registra candidatos y adjunta CVs sin duplicar archivos idénticos.

### Fase 5 · Embudo Kanban + frontend (1.5–2 semanas)

- [ ] API de movimientos de fase con transiciones válidas y motivo obligatorio al descartar (trigger lo garantiza).
- [ ] React 19 + Vite + Tailwind + TS estricto: login, layout con RBAC, páginas de requerimientos y candidatos.
- [ ] Tablero DnD Kit con 5 columnas, actualización optimista + rollback, panel de historial por candidato.
- [ ] Zustand para sesión y estado del embudo.
- **Salida:** ⭐ **MVP demostrable**: flujo completo desde solicitud de plaza hasta contratación, con trazabilidad.

> 🎯 **Hito MVP:** con las fases 0–5 el sistema ya es utilizable en un piloto real con GH.

### Fase 6 · Importación masiva + parsing (1–1.5 semanas)

- [ ] Cola de trabajos simple (tabla `jobs` + worker in-process; escalable a BullMQ/Redis después).
- [ ] Endpoint de importación masiva (ZIP o múltiples PDF), progreso y reporte por archivo (éxito/error/motivo).
- [ ] Parser de CV (pdf-parse + extracción por patrones de correo/teléfono/ciudad + catálogo de habilidades); UI de "extraído – confirmar".
- **Salida:** 50 CVs en minutos, con datos prellenados y confirmados por una persona.

### Fase 7 · Verificaciones de antecedentes asíncronas (1 semana)

- [ ] Worker de antecedentes: cola, plugin por fuente oficial, timeouts, reintentos, captura de evidencia.
- [ ] Persistencia de resultados en JSONB + estado de la verificación; enlace con la fase 2 del embudo.
- [ ] Diseñar degradación: si la fuente cae, el proceso no se bloquea (revisión manual).
- **Salida:** antecedentes verificables sin trabajo manual repetitivo.

### Fase 8 · Reportes e indicadores (3–4 días)

- [ ] Endpoints + vistas: tiempo promedio por fase, conversión por vacante, carga por jefatura, antigüedad de requerimientos.
- [ ] Exportación CSV; vistas para Directores de GH.

### Fase 9 · Endurecimiento y calidad (1 semana, concentrado)

- [ ] E2E Playwright del flujo feliz y de seguridad (rol sin permiso no puede X).
- [ ] Coverage mínimo 80% en lógica crítica (estados, crypto, códigos, permisos).
- [ ] Revisión OWASP Top 10 + dependabot/audit.
- [ ] Rendimiento: índices, EXPLAIN en consultas del kanban, paginación obligatoria en listados.
- [ ] Prueba real de backup → restore en entorno limpio (runbook con evidencia).
- **Salida:** checklist de salida aprobado; sin hallazgos críticos de seguridad.

### Fase 10 · Despliegue local y puesta en marcha (3–4 días)

- [ ] `docker-compose.prod.yml`: postgres (con volumen y backup sidecar), API, web (nginx), usuarios de BD de mínimo privilegio.
- [ ] TLS interno (certificados de la empresa o Caddy con CA interna).
- [ ] Runbook de operación: arranque, backup/restore, actualización, alta de usuarios, rotación de llaves, qué hacer si el server cae.
- [ ] Carga de datos iniciales reales + capacitación corta a GH (guía de usuario de 4 páginas).
- [ ] Piloto monitoreado (1–2 semanas): canal de feedback y correcciones.

### Fase 11 · Estabilización y ruta a nube (continuo)

- [ ] Retrospectiva y backlog V2 con lo aprendido en el piloto.
- [ ] ADR-002: plan de nube (contenedores gestionados + RDS); el trabajo de las fases 0–10 con Docker lo hace casi trivial.
- [ ] CI/CD al repo remoto (GitHub Actions): lint → test → build → imagen Docker.

---

## 5. Estimación total (developer único, ritmo sostenible)

| Hito | Fases | Estimación |
|------|-------|-----------|
| ⭐ MVP utilizable (piloto interno) | 0–5 | **5–7 semanas** |
| V1 completa (masivo + antecedentes + reportes) | 6–8 | +3–4 semanas |
| Endurecimiento + despliegue local productivo | 9–10 | +2 semanas |
| **Total a producción local** | | **≈ 10–13 semanas** |

---

## 6. Reglas de la casa (definiciones de "hecho")

1. **La base de datos manda**: restricciones, triggers y estados viven en BD; la API no puede saltárselos.
2. **Sin migraciones no hay deploy**: `synchronize` prohibido fuera de desarrollo local.
3. **Sin test no hay merge**: cada feature entra con sus pruebas y CI verde.
4. **PII siempre cifrada** y solo las columnas sensibles; nada de datos personales en logs.
5. **Cada decisión no trivial se documenta** en un ADR de una página.
6. **El backup solo existe si el restore está probado.**
7. **Cumplimiento**: Ley 1581 de protección de datos (finalidad, minimización, retención, supresión bajo solicitud).

---

## Anexo · Requisitos originales (extraídos del PDF LARCO)

- **Empresa:** LARCO · **Departamento:** Gestión Humana · **Aplicativo:** ATS (seguimiento de candidatos) para 8 departamentos: Ofertas, Proyectos, Servicios, Prevención SST, Contabilidad, Abastecimiento, Gestión Humana y Sistemas.
- **Objetivo A — Requerimientos de personal:** solicitudes estructuradas en 5 secciones; estados pendiente/aprobado/en_proceso/cerrado/rechazado; códigos anuales consecutivos atómicos (ej. `REQ-2026-001`).
- **Objetivo B — Ingesta masiva de candidatos:** carga unitaria/masiva de CVs en PDF; extracción de nombres, teléfonos, correos, ciudades y habilidades; deduplicación por hash SHA-256.
- **Objetivo C — Embudo/Kanban:** tablero drag-and-drop con 5 fases (1 CV/Preselección · 2 Antecedentes · 3 Entrevistas · 4 Proveedor externo · 5 Contratación); historial cronológico; motivo de rechazo obligatorio por triggers.
- **Objetivo D — Verificaciones asincrónicas:** scrapers headless con Playwright en fuentes oficiales; resultados en JSONB.
- **Directrices técnicas:** backend NestJS 11 modular (10 módulos) con persistencia híbrida (pool `pg` + TypeORM en requerimientos); frontend React 19 + Vite + Tailwind, TS estricto, Zustand, DnD Kit; PII (cédula, teléfono, polígrafo) cifrada AES-256-CBC con IV de 16 bytes por registro; JWT 24 h + RBAC (admin_rrhh, analista_seleccion, lider_area); auditoría inmutable por triggers.
- **Nota del evaluador:** "puedes aplicar mejoras que consideres de aporte… no esperamos que esté 100% funcional" → este plan incorpora esas mejoras llevando el piloto a ingeniería de producción.
