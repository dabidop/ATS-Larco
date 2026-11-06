
# AGENTS.md

## Objetivo
Desarrollar código limpio, eficiente y mantenible, minimizando el consumo de contexto y evitando trabajo innecesario.

## Reglas generales
- Analiza únicamente los archivos relacionados con la tarea.
- No inspecciones todo el proyecto sin necesidad.
- Reutiliza código, componentes y funciones existentes.
- Evita explicaciones extensas y análisis repetitivos.
- No repitas información que ya está disponible en el contexto.
- No realices cambios fuera del alcance solicitado.
- No hagas refactorizaciones innecesarias.
- No inventes requisitos ni funcionalidades.

## Gestión de contexto
- Mantén las respuestas breves y directas.
- Lee únicamente los fragmentos relevantes de cada archivo.
- Evita cargar archivos generados, dependencias y builds.
- No reproduzcas archivos completos en las respuestas.
- Resume los resultados importantes.
- Si falta información, solicita únicamente la necesaria.

## React
- Prioriza componentes reutilizables.
- Evita renders innecesarios.
- Mantén los componentes pequeños y organizados.
- Utiliza hooks correctamente.
- Sigue las convenciones existentes del proyecto.

## Next.js
- Respeta la arquitectura App Router o Pages Router existente.
- Prioriza Server Components cuando sea posible.
- Utiliza Client Components solamente cuando sean necesarios.
- Evita solicitudes duplicadas.
- Optimiza carga y renderizado.

## Node.js
- Mantén separadas las responsabilidades.
- Valida entradas y gestiona errores.
- Reutiliza servicios y utilidades existentes.
- No expongas credenciales ni variables de entorno.

## TypeScript
- Mantén tipado estricto.
- Evita utilizar `any`.
- Reutiliza interfaces y tipos existentes.
- No dupliques definiciones.

## Dependencias
- No instales paquetes innecesarios.
- Comprueba si existe una solución con las dependencias actuales.
- No cambies versiones sin autorización.

## Pruebas
- Ejecuta únicamente pruebas relacionadas con los cambios.
- No ejecutes builds completos por modificaciones menores.
- Ejecuta verificaciones completas cuando la tarea lo justifique.
- No repitas pruebas que ya pasaron sin motivo.

## Seguridad
- No elimines archivos sin autorización.
- No modifiques configuraciones sensibles sin autorización.
- No expongas secretos.
- No ejecutes comandos destructivos sin confirmación.

## Flujo de trabajo
1. Comprende la solicitud.
2. Identifica los archivos necesarios.
3. Implementa la solución más sencilla.
4. Verifica los cambios.
5. Informa brevemente el resultado.

## Respuesta final
Utiliza este formato:

- **Implementado:** resumen breve.
- **Archivos:** archivos modificados.
- **Pruebas:** verificaciones realizadas.
- **Pendiente:** problemas restantes, si existen.

## Regla principal
Prioriza soluciones simples, precisas y eficientes.
No gastes contexto ni recursos en tareas que no aporten valor.
