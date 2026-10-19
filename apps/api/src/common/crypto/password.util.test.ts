import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('hashea y verifica una contraseña válida', async () => {
    const hash = await hashPassword('Secreta123!');
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[\w+/=]+\$[\w+/=]+$/);
    await expect(verifyPassword('Secreta123!', hash)).resolves.toBe(true);
  });

  it('rechaza una contraseña incorrecta', async () => {
    const hash = await hashPassword('Secreta123!');
    await expect(verifyPassword('otra-cosa', hash)).resolves.toBe(false);
  });

  it('genera hashes distintos para la misma contraseña (salt aleatorio)', async () => {
    const [a, b] = [await hashPassword('Secreta123!'), await hashPassword('Secreta123!')];
    expect(a).not.toBe(b);
  });

  it('devuelve false (no lanza) ante un hash malformado', async () => {
    await expect(verifyPassword('x', 'no-es-un-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$a$b$c$bad')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
  });
});
