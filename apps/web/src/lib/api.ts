import { estadoSesion, useSesionStore } from '../store/sesion';

/**
 * Cliente HTTP mínimo de la SPA: `fetch` nativo, SIN axios.
 *
 * Rutas relativas a `/api` (el proxy de Vite ya resuelve `/api` → la API
 * NestJS, que además fija `setGlobalPrefix('api')`). Todo se habla en JSON;
 * las descargas usan `descargar()` (fetch → blob → objectURL), porque el
 * endpoint de CV exige `Authorization` y un `<a href>` plano NO sirve.
 *
 * ERRORES: la API responde siempre `{ statusCode, message, error?, timestamp,
 * path }` (filtro global `AllExceptionsFilter`), pero `message` es un string
 * (excepciones lanzadas) o un ARRAY de strings (ValidationPipe de Nest). Ambos
 * casos se normalizan a un único texto en `ApiError`.
 *
 * SESIÓN: si el backend responde 401 (token caducado o inválido), se descarta
 * la sesión local; el guard `RutaProtegida` redirige a `/login` conservando la
 * ruta original en `location.state`. En `/login` no hay token en el store, así
 * que el 401 de credenciales incorrectas NO cierra nada (solo muestra el
 * mensaje). Los guards de la API son la verdad: aquí solo se adjunta el token.
 */

/** Base común de todas las rutas de la API. */
const BASE_API = '/api';

/** Error normalizado de una respuesta HTTP fallida (o de red). */
export class ApiError extends Error {
  /** `0` indica fallo de red (no hubo respuesta HTTP). */
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

export interface OpcionesSolicitud {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Cuerpo JSON (se serializa automáticamente; su presencia añade el header). */
  cuerpo?: unknown;
}

/** `/requerimientos?x=1` → `/api/requerimientos?x=1` (sin doble prefijo). */
function rutaAbsoluta(ruta: string): string {
  if (ruta.startsWith('http') || ruta.startsWith(BASE_API)) return ruta;
  return `${BASE_API}${ruta}`;
}

/** Cabeceras: JSON cuando hay cuerpo y `Bearer` cuando existe sesión. */
function cabeceras(incluirJson: boolean): Record<string, string> {
  const cabecerasFinales: Record<string, string> = { Accept: 'application/json' };
  if (incluirJson) cabecerasFinales['Content-Type'] = 'application/json';
  const { token } = estadoSesion();
  if (token !== null) cabecerasFinales.Authorization = `Bearer ${token}`;
  return cabecerasFinales;
}

/** `message: string | string[]` → un único texto (los arrays se unen con ', ').`. */
function mensajeUnico(message: unknown): string | null {
  if (typeof message === 'string' && message.length > 0) return message;
  if (Array.isArray(message)) {
    const partes = message.filter((parte): parte is string => typeof parte === 'string');
    if (partes.length > 0) return partes.join(', ');
  }
  return null;
}

/** Mensaje de respaldo cuando el cuerpo no trae `message` legible. */
function mensajePorDefecto(statusCode: number): string {
  if (statusCode === 400) return 'Petición inválida: revisa los datos enviados';
  if (statusCode === 401) return 'No autenticado';
  if (statusCode === 403) return 'No tienes permisos para realizar esta acción';
  if (statusCode === 404) return 'No se encontró el recurso solicitado';
  if (statusCode === 409) return 'La operación entra en conflicto con el estado actual';
  if (statusCode === 413) return 'El archivo supera el tamaño permitido (5 MB)';
  if (statusCode === 429) return 'Demasiados intentos: espera un minuto y prueba de nuevo';
  if (statusCode >= 500) return 'Error interno del servidor';
  return `Error inesperado del servidor (${statusCode})`;
}

/**
 * Cierra la sesión local si había una. Solo se actúa con un token presente: un
 * 401 en el propio login (credenciales mal) no debe tocar nada.
 */
function descartarSesionCaducada(): void {
  const { token, cerrarSesion } = useSesionStore.getState();
  if (token !== null) cerrarSesion();
}

/** Convierte una respuesta fallida en `ApiError` (y descarta la sesión en 401). */
async function errorDesdeRespuesta(respuesta: Response): Promise<ApiError> {
  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    cuerpo = null;
  }
  const objeto =
    typeof cuerpo === 'object' && cuerpo !== null ? (cuerpo as Record<string, unknown>) : null;
  const texto =
    (objeto === null ? null : mensajeUnico(objeto.message)) ?? mensajePorDefecto(respuesta.status);
  if (respuesta.status === 401) descartarSesionCaducada();
  return new ApiError(respuesta.status, texto);
}

/** Texto legible de cualquier error capturado en la UI. */
export function mensajeDeError(error: unknown, porDefecto = 'Se produjo un error'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return porDefecto;
}

/** Lanza `fetch` tratando cualquier `!ok` como `ApiError`. */
async function lanzarFetch(ruta: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(ruta, init);
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Comprueba tu conexión.');
  }
}

/** GET/POST/PATCH genérico en JSON. `ruta` es relativa a `/api`. */
export async function solicitud<T>(ruta: string, opciones: OpcionesSolicitud = {}): Promise<T> {
  const metodo = opciones.metodo ?? 'GET';
  const hayCuerpo = opciones.cuerpo !== undefined;
  const respuesta = await lanzarFetch(rutaAbsoluta(ruta), {
    method: metodo,
    headers: cabeceras(hayCuerpo),
    body: hayCuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });

  if (!respuesta.ok) throw await errorDesdeRespuesta(respuesta);
  if (respuesta.status === 204) return undefined as T;

  try {
    return (await respuesta.json()) as T;
  } catch {
    throw new ApiError(respuesta.status, 'El servidor devolvió una respuesta ilegible');
  }
}

/**
 * Sube un archivo en `multipart/form-data` (campo `file`, como espera
 * `POST /api/candidatos/:id/archivos`). NO se fija `Content-Type`: el navegador
 * debe añadir él solo el `boundary` del multipart.
 */
export async function subirArchivo<T>(ruta: string, archivo: File): Promise<T> {
  const datos = new FormData();
  datos.append('file', archivo);
  return subirFormulario<T>(ruta, datos);
}

/**
 * Sube un `multipart/form-data` YA CONSTRUIDO (Etapa 9: la importación de HVs
 * lleva varios `archivos` + el campo texto `departamentoId`). Igual que
 * `subirArchivo`, NO se fija `Content-Type`: el navegador añade el boundary.
 */
export async function subirFormulario<T>(ruta: string, datos: FormData): Promise<T> {
  const respuesta = await lanzarFetch(rutaAbsoluta(ruta), {
    method: 'POST',
    headers: cabeceras(false),
    body: datos,
  });
  if (!respuesta.ok) throw await errorDesdeRespuesta(respuesta);
  try {
    return (await respuesta.json()) as T;
  } catch {
    throw new ApiError(respuesta.status, 'El servidor devolvió una respuesta ilegible');
  }
}

/**
 * Descarga autorizada de un fichero.
 *
 * El endpoint exige `Authorization`, así que NO sirve un `<a href>` plano:
 * se hace `fetch` con el token, el binario se convierte en `blob` y se
 * dispara la descarga con el nombre original del archivo mediante un `<a
 * download>` temporal.
 */
export async function descargar(ruta: string, nombreFichero: string): Promise<void> {
  const respuesta = await lanzarFetch(rutaAbsoluta(ruta), {
    method: 'GET',
    headers: cabeceras(false),
  });
  if (!respuesta.ok) throw await errorDesdeRespuesta(respuesta);

  const blob = await respuesta.blob();
  const url = URL.createObjectURL(blob);
  try {
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreFichero;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Best-effort de `POST /api/auth/logout` (la API solo registra el evento: el
 * JWT es stateless). El cierre local NO depende de esta llamada.
 */
export async function cerrarSesionEnServidor(): Promise<void> {
  try {
    await solicitud<void>('/auth/logout', { metodo: 'POST' });
  } catch {
    // Sin conexión o sin token válido: la sesión local se descarta de todos modos.
  }
}
