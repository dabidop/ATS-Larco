import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Limpieza común a TODOS los tests de la SPA: desmonta los árboles de React,
 * deshace los globals fijados (`fetch` falso) y vacía `localStorage` para que
 * la sesión hidratada por `store/sesion.ts` no se cuelen entre tests.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
