# Checklist técnico T17 (sin datos reales)

| Control                                        | Estado verificable                 | Evidencia / bloqueo                         |
| ---------------------------------------------- | ---------------------------------- | ------------------------------------------- |
| API/BD health con exit code                    | Verificado sintéticamente          | `ops:availability`, éxito/fallo de fixtures |
| Espacio de CV y frescura de backup             | Verificado sintéticamente          | parámetros sin secretos                     |
| Inventario de huérfanos y descartados >6 meses | Verificado en fixture              | dry-run; no borra                           |
| CV compartido, contratado y activo             | Verificado por regla SQL existente | no se incluye en inventario elegible        |
| Backup + restore PG/CV simultáneos             | Parcial                            | runbook listo; repetir en destino aprobado  |
| TLS gateway/certificado                        | No verificado aquí                 | requiere gateway y certificado gestionados  |
| Malware scanner                                | No verificado                      | no fingir integración antivirus             |
| Cifrado de CV                                  | No verificado                      | disco actual sin cifrado demostrado         |
| Entrega de alertas                             | No verificado                      | requiere monitor/canal externo              |
| Branch protection                              | No verificado                      | revisar configuración del repositorio       |
| Restore en destino                             | No verificado                      | solo base/volumen sintético desechable      |

**Bloqueo antes de datos reales:** no habilitar producción hasta verificar los
controles externos pendientes, restauración en destino limpio con claves
versionadas, permisos de secretos y recepción de alertas. No desplegar ni
marcar producción operativa como consecuencia de esta preparación.
