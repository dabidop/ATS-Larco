/* eslint-disable @typescript-eslint/no-require-imports */
// Prueba aislada: ¿qué devuelve em.query con DELETE...RETURNING en TypeORM/pg?
require('dotenv').config({ path: '../../.env' });
const { DataSource } = require('typeorm');

(async () => {
  const ds = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL });
  await ds.initialize();
  const em = ds.manager;
  try {
    await em.transaction(async (trx) => {
      const cand = await trx.query(
        `INSERT INTO candidatos (nombres, apellidos, ciudad, created_by)
         SELECT 'DbgEm', 'Rows', 'DbgEmCiudad', u.id FROM users u WHERE u.email='it@larco.co'
         RETURNING id`,
      );
      console.log('INSERT RETURNING typeof:', typeof cand, Array.isArray(cand), JSON.stringify(cand).slice(0, 200));
      const id = cand[0].id;

      const borrado = await trx.query(
        `DELETE FROM candidatos WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM postulaciones WHERE candidato_id = $1) RETURNING id`,
        [id],
      );
      console.log('DELETE RETURNING (sin postulación):', typeof borrado, Array.isArray(borrado), 'length=', borrado.length, JSON.stringify(borrado).slice(0, 200));

      // Caso con postulación: candidato + requerimiento + postulación, luego DELETE 0 filas.
      const cand2 = await trx.query(
        `INSERT INTO candidatos (nombres, apellidos, ciudad, created_by)
         SELECT 'DbgEm2', 'Rows2', 'DbgEmCiudad', u.id FROM users u WHERE u.email='it@larco.co'
         RETURNING id`,
      );
      const req = await trx.query(
        `INSERT INTO requerimientos (code, created_by, titulo, jefatura, numero_plazas, perfil_profesional, justificacion)
         SELECT 'REQ-2026-555555', u.id, 'Dbg', 'Talento Humano', 1, 'Perfil', 'Justif' FROM users u WHERE u.email='it@larco.co'
         RETURNING id`,
      );
      await trx.query(
        `INSERT INTO postulaciones (candidato_id, requerimiento_id, created_by) VALUES ($1, $2, $3)`,
        [cand2[0].id, req[0].id, (await trx.query(`SELECT id FROM users WHERE email='it@larco.co'`))[0].id],
      );
      const borrado2 = await trx.query(
        `DELETE FROM candidatos WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM postulaciones WHERE candidato_id = $1) RETURNING id`,
        [cand2[0].id],
      );
      console.log('DELETE RETURNING (con postulación):', typeof borrado2, Array.isArray(borrado2), 'length=', borrado2.length, JSON.stringify(borrado2).slice(0, 200));
    });
  } finally {
    await ds.destroy();
  }
})().catch((e) => { console.error('ERR', e); process.exit(1); });

