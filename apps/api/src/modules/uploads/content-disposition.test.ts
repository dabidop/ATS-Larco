import { describe, expect, it } from 'vitest';

import { attachmentContentDisposition } from './content-disposition';

/**
 * Tests unitarios de la cabecera `Content-Disposition` de descarga (Fase 4,
 * parte 2).
 *
 * Herméticos: es una función pura de string → string. Lo que se verifica es el
 * contrato RFC 6266/8187 que consumen los navegantes:
 *
 *  - `filename="…"` ASCII como FALLA para clientes viejos.
 *  - `filename*=UTF-8''…` percent-encoded, que es el que conserva tildes y ñ.
 *
 * Cada caso deja documentado el valor ESPERADO byte a byte, para que una
 * regresión en el encoding se vea de inmediato.
 */

describe('attachmentContentDisposition', () => {
  it('para un nombre ASCII simple emite ambas declaraciones iguales', () => {
    expect(attachmentContentDisposition('cv.pdf')).toBe(
      `attachment; filename="cv.pdf"; filename*=UTF-8''cv.pdf`,
    );
  });

  it('conserva ESPACIOS en el fallback (son ASCII imprimible)', () => {
    // El rango de fallback es ` `(0x20) a `~`(0x7E): los espacios se quedan.
    expect(attachmentContentDisposition('CV Juan Perez.pdf')).toBe(
      `attachment; filename="CV Juan Perez.pdf"; filename*=UTF-8''CV%20Juan%20Perez.pdf`,
    );
  });

  it('sustituye tildes y ñ por `_` en el fallback y las conserva en UTF-8', () => {
    // Caso principal del módulo: un CV con nombre colombiano típico.
    expect(attachmentContentDisposition('CV Andrés Peña.pdf')).toBe(
      `attachment; filename="CV Andr_s Pe_a.pdf"; ` +
        `filename*=UTF-8''CV%20Andr%C3%A9s%20Pe%C3%B1a.pdf`,
    );
  });

  it('codifica comilla y barra invertida en AMBAS partes (no rompen la cabecera)', () => {
    // `"` cerraría la cadena entre comillas y `\` la escaparía: ambas → `_`
    // en el fallback y percent-encoded en UTF-8.
    expect(attachmentContentDisposition('mi"cv\\otro.pdf')).toBe(
      `attachment; filename="mi_cv_otro.pdf"; filename*=UTF-8''mi%22cv%5Cotro.pdf`,
    );
  });

  it("percent-encodea además `*'()`, que RFC 8187 no admite como attr-char", () => {
    // `encodeURIComponent` deja `*'()` tal cual, pero el attr-char de RFC 8187
    // solo incluye letras, dígitos y `!#$&+-.^_`|~`: hay que codificarlos a mano.
    expect(attachmentContentDisposition("a*b(c)d'e.pdf")).toBe(
      `attachment; filename="a*b(c)d'e.pdf"; filename*=UTF-8''a%2Ab%28c%29d%27e.pdf`,
    );
  });

  it('sustituye caracteres de control por `_` en el fallback', () => {
    // Un `\x01` (SOH) en el nombre literalmente rompería la cabecera HTTP.
    expect(attachmentContentDisposition('cv\x01final.pdf')).toBe(
      `attachment; filename="cv_final.pdf"; filename*=UTF-8''cv%01final.pdf`,
    );
  });

  it('un emoji (no-BMP) ocupa DOS `_` en el fallback y se codifica en 4 bytes UTF-8', () => {
    // Un emoji son DOS unidades UTF-16 (surrogates): la regex `[^ -~]`
    // sustituye cada una, por eso salen dos guiones bajos.
    expect(attachmentContentDisposition('CV \u{1F600}.pdf')).toBe(
      `attachment; filename="CV __.pdf"; filename*=UTF-8''CV%20%F0%9F%98%80.pdf`,
    );
  });

  it('usa SIEMPRE el prefijo `attachment` (descarga, no visualización en línea)', () => {
    expect(attachmentContentDisposition('cualquier.pdf').startsWith('attachment; ')).toBe(true);
  });
});
