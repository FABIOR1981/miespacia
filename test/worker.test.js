'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let worker;
before(async () => { worker = (await import('../src/worker.mjs')).default; });
const env = { MIESPACIA_PROFESIONAL: 'pro-test', ASSETS: { fetch: async () => new Response('pagina') } };
const pedir = (ruta, metodo = 'GET', cuerpo) =>
  worker.fetch(new Request('http://x' + ruta, { method: metodo, body: cuerpo ? JSON.stringify(cuerpo) : undefined }), env);

test('el Worker sirve la página para rutas que no son API', async () => {
  const r = await pedir('/');
  assert.equal(await r.text(), 'pagina');
});

test('flujo de API en el Worker, con validaciones y conflictos', async () => {
  let r = await pedir('/api/clientes', 'POST', { nombre: 'Ana' });
  assert.equal(r.status, 201);
  const cliente = await r.json();

  r = await pedir('/api/clientes', 'POST', { nombre: '' });
  assert.equal(r.status, 400);

  r = await pedir('/api/turnos', 'POST', { clienteId: cliente.id, fecha: '2026-11-04', hora: '10:00' });
  assert.equal(r.status, 201);
  const turno = await r.json();

  r = await pedir('/api/turnos', 'POST', { clienteId: cliente.id, fecha: '2026-11-04', hora: '10:00' });
  assert.equal(r.status, 409);

  r = await pedir('/api/turnos/' + turno.id + '/cancelar', 'POST');
  assert.equal((await r.json()).cancelado, true);

  r = await pedir('/api/turnos?desde=2026-13-01');
  assert.equal(r.status, 400);

  r = await pedir('/api/otra');
  assert.equal(r.status, 404);
});
