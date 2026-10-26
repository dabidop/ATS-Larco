/**
 * Extracción de TEXTO de un PDF con `pdfjs-dist` (build legacy de Node, CJS).
 *
 * POR QUÉ `pdfjs-dist` Y NO `pdf-parse`: la v1.1.1 de `pdf-parse` empaqueta el
 * pdf.js v1.10.100 (2018) con un bug determinista en procesos que ya cargaron
 * express/supertest/multer (cualquier API Nest real): la lectura del xref
 * revienta con «bad XRef entry» o extrae texto vacío, según el estado global
 * del proceso. Verificado empíricamente con el mismo buffer en proceso limpio
 * (funciona) vs. proceso con express cargado (falla). `pdfjs-dist` es el motor
 * mantenido que pdf-parse envolvía; aquí se usa DIRECTAMENTE.
 *
 * `canvas` (dependencia OPCIONAL de pdfjs-dist) NO se compila en este workspace
 * (ver `ignoredBuiltDependencies` de `pnpm-workspace.yaml`): solo hace falta
 * para RENDERIZAR páginas a imagen, nunca para extraer texto. El build legacy
 * avisa por consola al cargar porque intenta polyfillar `DOMMatrix`/`Path2D`
 * con ese `canvas` ausente; el ruido se silencia SOLO durante el `require`
 * (son warnings de render que no afectan a este uso).
 */

import path from 'node:path';

/** Superficie mínima del API de pdf.js que usa este módulo (tipada a mano). */
interface PdfjsModulo {
  getDocument(origen: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    standardFontDataUrl?: string;
  }): { promise: Promise<PdfDocumento> };
}

interface PdfDocumento {
  numPages: number;
  getPage(numero: number): Promise<PdfPagina>;
  getMetadata(): Promise<{ info: { Title?: unknown } }>;
  destroy(): Promise<void>;
}

interface PdfPagina {
  getTextContent(): Promise<{
    items: Array<{ str?: unknown; transform?: unknown }>;
  }>;
}

/** Texto plano extraído del HV + el título de metadatos (si el PDF lo trae). */
export interface TextoPdf {
  texto: string;
  titulo: string | undefined;
}

/** Módulo cargado una sola vez por proceso (el require es caro). */
let moduloPdfjs: PdfjsModulo | null = null;

/** Ruta (con `/` final) a las fuentes estándar que trae `pdfjs-dist`. */
let rutaFuentesEstandar: string | null = null;

/** Carga perezosa del build legacy, silenciando SOLO sus warnings de render. */
function cargarPdfjs(): PdfjsModulo {
  if (moduloPdfjs === null) {
    const advertenciaOriginal = console.warn;
    try {
      console.warn = () => undefined;
      // El build legacy es CommonJS (el único compatible con Node sin canvas).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      moduloPdfjs = require('pdfjs-dist/legacy/build/pdf.js') as PdfjsModulo;
    } finally {
      console.warn = advertenciaOriginal;
    }
  }
  if (rutaFuentesEstandar === null) {
    // `standard_fonts/` viene con el paquete: sin esta ruta pdf.js avisa en
    // CADA parseo que no sabe resolver las fuentes base-14 (Helvetica, Times)
    // de los HVs exportados desde Word.
    const raizPaquete = path.dirname(require.resolve('pdfjs-dist/package.json') as string);
    rutaFuentesEstandar = `${path.join(raizPaquete, 'standard_fonts').replace(/\\/g, '/')}/`;
  }
  return moduloPdfjs;
}

/**
 * Extrae el texto de TODAS las páginas del PDF, reconstruyendo las líneas por
 * la coordenada Y de cada fragmento (mismo criterio que pdf-parse: ítems en la
 * misma Y = misma línea). Un PDF cifrado o dañado RECHAZA la promesa y el
 * llamador decide el mensaje de negocio.
 */
export async function extraerTextoPdf(buffer: Buffer): Promise<TextoPdf> {
  const pdfjs = cargarPdfjs();
  // `isEvalSupported: false`: el PDF no debe poder ejecutar eval; la extracción
  // de texto no lo necesita (defensa en profundidad con HVs de terceros).
  const documento = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    standardFontDataUrl: rutaFuentesEstandar ?? undefined,
  }).promise;

  try {
    const lineas: string[] = [];
    for (let numero = 1; numero <= documento.numPages; numero++) {
      const pagina = await documento.getPage(numero);
      const contenido = await pagina.getTextContent();

      let ultimaY: number | undefined;
      let lineaActual = '';
      for (const item of contenido.items) {
        if (typeof item.str !== 'string') continue;
        const y = Array.isArray(item.transform) ? (item.transform[5] as number) : undefined;
        // Cambió la Y ⇒ empezamos una línea nueva (los ítems de una línea
        // comparten la coordenada vertical del texto).
        if (ultimaY !== undefined && y !== undefined && y !== ultimaY && lineaActual !== '') {
          lineas.push(lineaActual);
          lineaActual = '';
        }
        lineaActual += item.str;
        ultimaY = y;
      }
      if (lineaActual !== '') lineas.push(lineaActual);
    }

    const metadata = await documento.getMetadata();
    const tituloCrudo = metadata.info?.Title;
    const titulo =
      typeof tituloCrudo === 'string' && tituloCrudo.trim() !== '' ? tituloCrudo : undefined;

    return { texto: lineas.join('\n'), titulo };
  } finally {
    await documento.destroy().catch(() => undefined);
  }
}
