import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'test/**/*.test.ts'],
    // Los e2e corren contra la BD dev real de Docker (red compartida) y la
    // suite raíz los ejecuta EN PARALELO con la de web: los hooks `afterAll`
    // hacen varias consultas SQL secuenciales de limpieza y con el default
    // de Vitest (5 s) se observó UN fallo intermitente de archivo a nivel
    // de hook (con los 332 tests en verde). 30 s dan margen de sobra sin
    // enmascarar colgones reales (un hook que dure 30 s es un problema).
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
    },
  },
});
