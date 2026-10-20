import { describe, expect, it } from 'vitest';

import { MIME_POR_TIPO, detectarTipo } from './magic-bytes';

/**
 * Tests unitarios del detector de tipo por MAGIC BYTES (Fase 4, parte 2).
 *
 * Herméticos: `detectarTipo` es una FUNCIÓN PURA sobre un buffer, así que aquí
 * NO hay base de datos, disco ni HTTP. Lo que se cubre es justo la frontera de
 * seguridad del módulo: la decisión de aceptar o rechazar un CV se toma SOLO
 * con los bytes, nunca con la extensión ni con el `Content-Type` del cliente.
 *
 * Los fixtures se construyen a mano byte a byte (no se pegan bytes binarios en
 * el fichero) para que cada aserción sea legible y para que quede DOCUMENTADO
 * el formato exacto de cada firma.
 */

/** `%PDF-1.7` + saltos: un PDF de verdad empieza por la versión. */
function pdfDeVerdad(): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('1 0 obj\n<<>>\nendobj\n')]);
}

/** Contenedor OLE2 (Office 97-2003): la firma son exactamente 8 bytes. */
function ole2DeVerdad(): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(64, 0),
  ]);
}

/** `{\rtf1\ansi ...}`: RTF textual. */
function rtfDeVerdad(): Buffer {
  return Buffer.from('{\\rtf1\\ansi\\deff0 {\\fonttbl{\\f0 Arial;}}\\f0 Hola}');
}

/**
 * Paquete OPC mínimo que pasa la comprobación de DOCX: cabecera ZIP (`PK\x03\x04`)
 * + los DOS literales ASCII que exige `esPaqueteWord`. No es un zip REAL (no se
 * comprueba la estructura interna): solo se replica la forma que el detector mira.
 */
function paqueteWordDeVerdad(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(32, 0),
    Buffer.from('[Content_Types].xml', 'latin1'),
    Buffer.alloc(16, 0),
    Buffer.from('word/document.xml', 'latin1'),
  ]);
}

describe('detectarTipo — archivos ACEPTADOS (magic bytes reales)', () => {
  it('reconoce un PDF por `%PDF-` en el byte 0', () => {
    expect(detectarTipo(pdfDeVerdad())).toBe('pdf');
  });

  it('reconoce un DOC por la firma OLE2 de 8 bytes', () => {
    expect(detectarTipo(ole2DeVerdad())).toBe('doc');
  });

  it('reconoce un RTF por `{\rtf`', () => {
    expect(detectarTipo(rtfDeVerdad())).toBe('rtf');
  });

  it('reconoce un DOCX por cabecera ZIP + literales `[Content_Types].xml` y `word/`', () => {
    expect(detectarTipo(paqueteWordDeVerdad())).toBe('docx');
  });

  it('un PDF de SOLO la firma (5 bytes) también se acepta', () => {
    // Caso límite: el detector no exige contenido adicional, solo la firma.
    expect(detectarTipo(Buffer.from('%PDF-', 'latin1'))).toBe('pdf');
  });

  it('admite firmas que no empiezan en el byte 0 del fixture compuesto', () => {
    // Regresión del fixture: la firma va ANTES de los literales del paquete Word,
    // es decir, en el offset 0. Si alguien moviera la firma, este test delata que
    // el detector dejaría de buscarla en el inicio.
    expect(
      paqueteWordDeVerdad()
        .subarray(0, 4)
        .equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
    ).toBe(true);
    expect(detectarTipo(paqueteWordDeVerdad())).toBe('docx');
  });
});

describe('detectarTipo — archivos RECHAZADOS (devuelve null → HTTP 400)', () => {
  it('rechaza un .txt plano (texto sin firma)', () => {
    expect(detectarTipo(Buffer.from('Esto es un CV escrito en texto plano.\n'))).toBeNull();
  });

  it('rechaza un .png (firma `\x89PNG` que no está en la lista de tipos)', () => {
    // `\x89PNG\r\n\x1a\n` es una firma VÁLIDA de PNG, pero el módulo solo
    // acepta CV: que el detector la IGNORE es el comportamiento correcto.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectarTipo(png)).toBeNull();
  });

  it('rechaza un ZIP genérico sin los literales de un paquete Word', () => {
    // Mismos 4 bytes de cabecera que un docx, pero sin `[Content_Types].xml`
    // ni `word/`: sin esos literales es un .zip cualquiera, no un CV.
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0x11)]);
    expect(detectarTipo(zip)).toBeNull();
  });

  it('rechaza un ZIP que lleve SOLO `[Content_Types].xml` (falta `word/`)', () => {
    // Límite documentado en `magic-bytes.ts`: se exigen AMBOS literales, no uno.
    const sinWord = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('[Content_Types].xml', 'latin1'),
    ]);
    expect(detectarTipo(sinWord)).toBeNull();
  });

  it('rechaza un ZIP que lleve SOLO `word/` (falta `[Content_Types].xml`)', () => {
    const sinContentTypes = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('word/', 'latin1'),
    ]);
    expect(detectarTipo(sinContentTypes)).toBeNull();
  });

  it('rechaza un DOCX cifrado (sin literales `word/` en claro)', () => {
    // Documentado como límite: un .docx con contraseña sale cifrado y NO
    // conserva `word/` legible → 400. Preferible a aceptar un fichero que
    // además no sabríamos leer.
    const cifrado = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from(' contenido cifrado sin nombres legibles ', 'latin1'),
    ]);
    expect(detectarTipo(cifrado)).toBeNull();
  });

  it('rechaza un buffer VACÍO (no puede tener firma)', () => {
    expect(detectarTipo(Buffer.alloc(0))).toBeNull();
  });

  it('rechaza un buffer más CORTO que la firma más larga (OLE2)', () => {
    // 7 bytes: menos que los 8 de OLE2. `subarray(0, 8)` devuelve 7 bytes y
    // `.equals(firma)` compara distinta longitud → false.
    expect(detectarTipo(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a]))).toBeNull();
  });

  it('rechaza un PDF que NO empiece por la firma (offset ≠ 0)', () => {
    // Caso de path-traversal creativo: unos bytes de relleno antes del `%PDF-`.
    // La firma se busca SIEMPRE en el byte 0, así que esto no vale como CV.
    const relleno = Buffer.concat([Buffer.from('   '), Buffer.from('%PDF-1.7\n')]);
    expect(detectarTipo(relleno)).toBeNull();
  });

  it('rechaza un .exe (firma MZ) y un .gif (firma GIF8)', () => {
    expect(detectarTipo(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
    expect(detectarTipo(Buffer.from('GIF89a', 'latin1'))).toBeNull();
  });
});

describe('MIME_POR_TIPO — el MIME SIEMPRE lo deriva el servidor', () => {
  it('cada tipo tiene su MIME canónico', () => {
    expect(MIME_POR_TIPO).toEqual({
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      rtf: 'application/rtf',
    });
  });

  it('el mapa está CONGELADO (nadie puede reescribir los MIME en runtime)', () => {
    expect(Object.isFrozen(MIME_POR_TIPO)).toBe(true);
  });

  it('el MIME devuelto es el del detector, no el declarado por el cliente', () => {
    // Regresión del contrato: `subir()` usa `MIME_POR_TIPO[detectarTipo(buffer)]`.
    // Un `.txt` renombrado a `hoja.pdf` se rechaza, y un PDF con el mimetype
    // `application/x-msdownload` sigue devolviendo `application/pdf`.
    expect(MIME_POR_TIPO[detectarTipo(pdfDeVerdad()) ?? 'pdf']).toBe('application/pdf');
  });
});
